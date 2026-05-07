/**
 * Integration tests for `upsertParsedMonth` — the importer's idempotent
 * write path. Catches the classic bugs:
 *
 *   - Re-importing the same sheet should leave the DB stable (no
 *     duplicate rows, no stale-row deletes that would orphan
 *     transaction matches).
 *   - Renaming the planned amount or due day on a row should produce a
 *     `updated++` outcome, not a fresh insert.
 *   - SAZONAIS items keep their yearly cents in the DB (the /12 happens
 *     in `getMonthlyAggregates`, not the importer).
 *   - Removed-from-sheet rows survive but surface as a warning.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTestDb } from "../support/test-db.ts";

const ctx = withTestDb();

let db: typeof import("../../src/db/index.ts")["db"];
let schema: typeof import("../../src/db/schema.ts");
let upsertParsedMonth: typeof import("../../src/lib/import/upsert.ts")["upsertParsedMonth"];
let TEST_BUDGET_SHEET: typeof import("../support/seed-fixtures.ts")["TEST_BUDGET_SHEET"];

beforeAll(async () => {
  ({ db } = await import("../../src/db/index.ts"));
  schema = await import("../../src/db/schema.ts");
  ({ upsertParsedMonth } = await import("../../src/lib/import/upsert.ts"));
  ({ TEST_BUDGET_SHEET } = await import("../support/seed-fixtures.ts"));
});

beforeEach(async () => {
  await ctx.reset();
});

describe("upsertParsedMonth", () => {
  it("inserts every parsed item on first import", async () => {
    const r = await upsertParsedMonth(TEST_BUDGET_SHEET);
    expect(r.inserted).toBe(TEST_BUDGET_SHEET.items.length);
    expect(r.updated).toBe(0);
    expect(r.unchanged).toBe(0);

    const all = await db.select().from(schema.budgetItem);
    expect(all.length).toBe(TEST_BUDGET_SHEET.items.length);
  });

  it("creates exactly one month row regardless of import count", async () => {
    await upsertParsedMonth(TEST_BUDGET_SHEET);
    await upsertParsedMonth(TEST_BUDGET_SHEET);
    const months = await db.select().from(schema.month);
    expect(months.length).toBe(1);
    expect(months[0]!.anchorYear).toBe(2026);
    expect(months[0]!.anchorMonth).toBe(5);
  });

  it("re-importing the unchanged sheet flips every row to 'unchanged'", async () => {
    await upsertParsedMonth(TEST_BUDGET_SHEET);
    const r2 = await upsertParsedMonth(TEST_BUDGET_SHEET);
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(0);
    expect(r2.unchanged).toBe(TEST_BUDGET_SHEET.items.length);
  });

  it("changes to plannedCents flip the row to 'updated', preserving id", async () => {
    await upsertParsedMonth(TEST_BUDGET_SHEET);

    const before = await db
      .select()
      .from(schema.budgetItem)
      .where(eq(schema.budgetItem.naturalKey, "mortgage"));
    expect(before).toHaveLength(1);
    const originalId = before[0]!.id;

    const next = {
      ...TEST_BUDGET_SHEET,
      items: TEST_BUDGET_SHEET.items.map((i) =>
        i.naturalKey === "mortgage"
          ? { ...i, plannedCents: -150000 }
          : i,
      ),
    };
    const r = await upsertParsedMonth(next);
    expect(r.updated).toBe(1);
    expect(r.unchanged).toBe(TEST_BUDGET_SHEET.items.length - 1);

    const after = await db
      .select()
      .from(schema.budgetItem)
      .where(eq(schema.budgetItem.naturalKey, "mortgage"));
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(originalId); // identity preserved
    expect(after[0]!.plannedCents).toBe(-150000);
  });

  it("a row that disappears from the sheet survives, with a warning", async () => {
    await upsertParsedMonth(TEST_BUDGET_SHEET);

    const trimmed = {
      ...TEST_BUDGET_SHEET,
      items: TEST_BUDGET_SHEET.items.filter(
        (i) => i.naturalKey !== "mortgage",
      ),
    };
    const r = await upsertParsedMonth(trimmed);
    expect(r.warnings.some((w) => w.includes("Mortgage"))).toBe(true);

    // Mortgage item still exists — protects any matched transactions.
    const survivor = await db
      .select()
      .from(schema.budgetItem)
      .where(eq(schema.budgetItem.naturalKey, "mortgage"));
    expect(survivor).toHaveLength(1);
  });

  it("stores SAZONAIS items as their yearly cents (division happens at read time)", async () => {
    await upsertParsedMonth(TEST_BUDGET_SHEET);
    const [trip] = await db
      .select()
      .from(schema.budgetItem)
      .where(
        and(
          eq(schema.budgetItem.naturalKey, "trip-fund"),
          eq(schema.budgetItem.section, "SAZONAIS"),
        ),
      );
    expect(trip).toBeDefined();
    // The fixture stores -240000 cents/year, which becomes -20000 monthly
    // when read through monthlyContributionCents.
    expect(trip!.plannedCents).toBe(-240000);
  });

  it("scopes the natural key — same slug under different scopes is two rows", async () => {
    const sheet = {
      ...TEST_BUDGET_SHEET,
      items: [
        ...TEST_BUDGET_SHEET.items,
        {
          scope: "yann" as const,
          section: "FIXAS" as const,
          naturalKey: "shared-name", // would collide if scope wasn't part of the key
          name: "Shared name (yann)",
          plannedCents: -1000,
          cadence: "monthly" as const,
        },
        {
          scope: "camila" as const,
          section: "FIXAS" as const,
          naturalKey: "shared-name",
          name: "Shared name (camila)",
          plannedCents: -2000,
          cadence: "monthly" as const,
        },
      ],
    };
    await upsertParsedMonth(sheet);
    const rows = await db
      .select()
      .from(schema.budgetItem)
      .where(eq(schema.budgetItem.naturalKey, "shared-name"));
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.scope))).toEqual(
      new Set(["yann", "camila"]),
    );
  });
});
