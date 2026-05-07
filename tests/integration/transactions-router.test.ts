/**
 * Integration tests for the `transactions.list` router. Covers the
 * filters that the screen exposes via UI pills (matched / unmatched /
 * duplicates) and the date-range filter, plus pagination.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "../support/test-db.ts";
import { makeAuthedCaller } from "../support/trpc-caller.ts";

const ctx = withTestDb();

let db: typeof import("../../src/db/index.ts")["db"];
let schema: typeof import("../../src/db/schema.ts");
let seedTestDatabase: typeof import("../support/seed.ts")["seedTestDatabase"];

beforeAll(async () => {
  ({ db } = await import("../../src/db/index.ts"));
  schema = await import("../../src/db/schema.ts");
  ({ seedTestDatabase } = await import("../support/seed.ts"));
});

beforeEach(async () => {
  await ctx.reset();
  await seedTestDatabase();
});

describe("transactions.list", () => {
  it("returns rows with matched item info populated when matched", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.transactions.list({
      show: "matched",
      scope: "joint",
    });
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) {
      expect(row.matchedItemId).not.toBeNull();
      expect(row.matchedName).not.toBeNull();
    }
  });

  it("show=unmatched returns only rows without a tx_match", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.transactions.list({
      show: "unmatched",
      scope: "joint",
    });
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) {
      expect(row.matchedItemId).toBeNull();
    }
  });

  it("returns the budget-item options for the picker on page 0", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.transactions.list({
      show: "all",
      scope: "joint",
    });
    expect(r.optionsAll.length).toBeGreaterThan(0);
    // Privacy guard: yann scope-only filter — but joint still includes
    // joint items.
    const scopes = new Set(r.optionsAll.map((o) => o.scope));
    expect(scopes.has("joint")).toBe(true);
  });

  it("paginates with cursor — second page does not re-send options", async () => {
    // Seed plenty of mystery rows so the first page reaches PAGE_SIZE.
    const accountId = (
      await db
        .select()
        .from(schema.bankAccount)
        .where(eq(schema.bankAccount.owner, "joint"))
    )[0]!.id;
    for (let i = 0; i < 100; i++) {
      await db.insert(schema.transaction).values({
        bankAccountId: accountId,
        bookingDate: new Date(`2026-05-10T12:00:00.000Z`),
        counterparty: `Bulk Vendor ${i}`,
        description: `bulk row ${i}`,
        amountCents: -100 - i,
        dedupeKey: `bulk-${i}`,
      });
    }

    const caller = makeAuthedCaller("yann");
    const page0 = await caller.transactions.list({
      show: "all",
      scope: "joint",
    });
    expect(page0.rows.length).toBe(page0.pageSize);
    expect(page0.optionsAll.length).toBeGreaterThan(0);
    expect(page0.nextCursor).toBe(page0.pageSize);

    const page1 = await caller.transactions.list({
      show: "all",
      scope: "joint",
      cursor: page0.nextCursor!,
    });
    expect(page1.rows.length).toBeGreaterThan(0);
    // Options are only returned on offset=0 — second page omits to save bytes.
    expect(page1.optionsAll).toEqual([]);
  });

  it("dateFrom/dateTo narrows the window inclusively", async () => {
    const caller = makeAuthedCaller("yann");
    const narrow = await caller.transactions.list({
      show: "all",
      scope: "joint",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-01",
    });
    for (const r of narrow.rows) {
      const d = new Date(r.bookingDate).toISOString().slice(0, 10);
      expect(d).toBe("2026-05-01");
    }
  });
});
