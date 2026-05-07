/**
 * Integration tests for the buckets router. Pulls SAZONAIS items into
 * Cofres groups, computes per-item monthly contribution + YTD actual,
 * and rolls up under each savings_account.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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

describe("buckets.get", () => {
  it("returns SAZONAIS items with monthly contribution computed (yearly / 12)", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.buckets.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
    });

    // Trip fund stored as -240000/year → -20000/month.
    const trip = r.items.find((i) => i.name === "Trip fund");
    expect(trip).toBeDefined();
    expect(trip!.plannedMonthlyCents).toBe(-20000);
    expect(trip!.plannedCents).toBe(-240000); // raw yearly cents preserved

    // Yearly tax pot stored as -120000/year → -10000/month.
    const tax = r.items.find((i) => i.name === "Yearly tax pot");
    expect(tax).toBeDefined();
    expect(tax!.plannedMonthlyCents).toBe(-10000);
  });

  it("scopes to allowed scopes only", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.buckets.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
    });
    for (const item of r.items) {
      // Only joint items in the joint view (no leaked yann/camila SAZONAIS).
      expect(["joint"]).toContain(item.scope);
    }
  });

  it("returns an empty list when no savings_accounts are configured", async () => {
    // Wipe any existing savings_account rows (none seeded by default).
    await db.delete(schema.savingsAccount);
    const r = await makeAuthedCaller("yann").buckets.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
    });
    expect(r.accounts).toEqual([]);
  });
});
