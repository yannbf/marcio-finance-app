/**
 * Integration tests for the activity router. Covers the Activity
 * screen's headline "Spent this month" sum and the timeline's row
 * shape.
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

describe("activity.get", () => {
  it("returns transactions for the requested month + scope", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.activity.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
    });
    expect(r.txns.length).toBeGreaterThan(0);
    // All rows are in May 2026's payday-month.
    for (const t of r.txns) {
      const d = new Date(t.bookingDate);
      expect(d >= new Date("2026-04-25T00:00:00Z")).toBe(true);
      expect(d <= new Date("2026-05-25T00:00:00Z")).toBe(true);
    }
  });

  it("excludes internal household transfers from the 'spent this month' sum", async () => {
    // Insert an outgoing transfer from yann's account that looks
    // like the household contribution wording. Without the
    // INTERNAL_TRANSFER filter the activity router would add this
    // to monthSpend and inflate the headline by €2,500.
    const [yannAcct] = await db
      .select()
      .from(schema.bankAccount)
      .where(eq(schema.bankAccount.owner, "yann"));
    await db.insert(schema.transaction).values({
      bankAccountId: yannAcct.id,
      bookingDate: new Date("2026-05-01T12:00:00Z"),
      counterparty: "Y Bezerra Braga Ferreira",
      description: "Contribuição maio",
      amountCents: -250000,
      dedupeKey: "yann-contrib-may",
    });

    // Also insert one real personal expense so the "spent this
    // month" sum has something non-zero to assert against.
    await db.insert(schema.transaction).values({
      bankAccountId: yannAcct.id,
      bookingDate: new Date("2026-05-02T12:00:00Z"),
      counterparty: "Coffee Shop",
      description: "Espresso",
      amountCents: -300,
      dedupeKey: "yann-coffee",
    });

    const caller = makeAuthedCaller("yann");
    const r = await caller.activity.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann",
    });
    // Existing seed has a -2000 + -500 yann personal txns. Plus the
    // -300 espresso we just added. Total personal spend:
    //   2000 (Mystery Yann Vendor) + 500 (Tikkie outgoing) + 300 (espresso)
    //   = 2800. The 250_000 transfer is excluded.
    expect(r.monthSpend).toBe(2800);
    // The transfer transaction itself is still in the timeline list
    // so the user can confirm it landed — only the SUM excludes it.
    expect(
      r.txns.some((t) =>
        (t.counterparty ?? "").includes("Bezerra Braga Ferreira"),
      ),
    ).toBe(true);
  });
});
