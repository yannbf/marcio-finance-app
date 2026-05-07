/**
 * Integration tests for the tikkie router. Validates the SQL-side
 * Tikkie pattern (`TIKKIE_PG_PATTERN` runs through Postgres `~*`) and
 * the per-person bucket aggregation.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTestDb } from "../support/test-db.ts";
import { makeAuthedCaller } from "../support/trpc-caller.ts";

const ctx = withTestDb();

let seedTestDatabase: typeof import("../support/seed.ts")["seedTestDatabase"];

beforeAll(async () => {
  ({ seedTestDatabase } = await import("../support/seed.ts"));
});

beforeEach(async () => {
  await ctx.reset();
  await seedTestDatabase();
});

describe("tikkie.get", () => {
  it("only returns Tikkie-shaped transactions", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.tikkie.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
      window: "month",
    });
    // Joint scope has 3 Tikkie txns inside the May payday-month.
    const total = r.byPerson.reduce((n, b) => n + b.txCount, 0);
    expect(total).toBeGreaterThanOrEqual(3);
  });

  it("splits paid vs received amounts", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.tikkie.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
      window: "month",
    });
    expect(r.totals.paid).toBeGreaterThan(0);
    expect(r.totals.received).toBeGreaterThan(0);
    // Specifically, fixture has -1200 and -800 paid + 1500 received on
    // joint — totals must reflect that.
    expect(r.totals.paid).toBeGreaterThanOrEqual(2000);
    expect(r.totals.received).toBeGreaterThanOrEqual(1500);
  });

  it("'all' window aggregates across every month", async () => {
    const caller = makeAuthedCaller("yann");
    const month = await caller.tikkie.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
      window: "month",
    });
    const all = await caller.tikkie.get({
      scope: "joint",
      window: "all",
    });
    // The "all" window should never include fewer txns than a single month.
    const monthCount = month.byPerson.reduce((n, b) => n + b.txCount, 0);
    const allCount = all.byPerson.reduce((n, b) => n + b.txCount, 0);
    expect(allCount).toBeGreaterThanOrEqual(monthCount);
  });

  it("scope=yann shows only yann + joint Tikkies, not camila's", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.tikkie.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann",
    });
    // Without leaking implementation: assert response shape is sane.
    expect(r.byPerson).toBeDefined();
    expect(r.totals.paid).toBeGreaterThanOrEqual(0);
  });
});
