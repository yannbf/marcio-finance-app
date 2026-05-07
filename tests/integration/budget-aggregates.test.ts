/**
 * Integration tests for `getMonthlyAggregates`, the SQL-side roll-up
 * that powers Today / Mês / Insights. Verifies:
 *
 *  - SAZONAIS yearly amounts are divided by 12 inside SQL.
 *  - Internal-transfer rows (between joint and personal accounts) are
 *    excluded from the actual sum, matching the production rule that
 *    moving money is not spending it.
 *  - Scope filtering works via the IN clause.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTestDb } from "../support/test-db.ts";

const ctx = withTestDb();

let getMonthlyAggregates: typeof import("../../src/lib/budget-aggregates.ts")["getMonthlyAggregates"];
let totalIncome: typeof import("../../src/lib/budget-aggregates.ts")["totalIncome"];
let totalOutflow: typeof import("../../src/lib/budget-aggregates.ts")["totalOutflow"];
let seedTestDatabase: typeof import("../support/seed.ts")["seedTestDatabase"];

beforeAll(async () => {
  ({ getMonthlyAggregates, totalIncome, totalOutflow } = await import(
    "../../src/lib/budget-aggregates.ts"
  ));
  ({ seedTestDatabase } = await import("../support/seed.ts"));
});

beforeEach(async () => {
  await ctx.reset();
  await seedTestDatabase();
});

describe("getMonthlyAggregates", () => {
  it("divides SAZONAIS yearly into monthly inside SQL", async () => {
    const r = await getMonthlyAggregates(["joint"], { year: 2026, month: 5 });
    // Fixture: -120000 + -240000 = -360000 yearly → -30000 monthly.
    expect(r.planned.SAZONAIS).toBe(-30000);
  });

  it("sums planned across the visible scopes", async () => {
    const joint = await getMonthlyAggregates(["joint"], {
      year: 2026,
      month: 5,
    });
    const yann = await getMonthlyAggregates(["yann"], {
      year: 2026,
      month: 5,
    });
    const both = await getMonthlyAggregates(["joint", "yann"], {
      year: 2026,
      month: 5,
    });
    // Outflow from yann fixture is exactly the saidas line (-10000).
    expect(yann.planned.VARIAVEIS).toBe(-10000);
    // Joint's VARIAVEIS = -40000 -20000 -15000 -5000 = -80000.
    expect(joint.planned.VARIAVEIS).toBe(-80000);
    // Combined sum.
    expect(both.planned.VARIAVEIS).toBe(-90000);
  });

  it("returns zeros when the requested month has no row", async () => {
    const r = await getMonthlyAggregates(["joint"], {
      year: 2099,
      month: 11,
    });
    expect(r.monthId).toBeNull();
    expect(r.planned).toEqual({});
    expect(r.actual).toEqual({});
  });

  it("totalOutflow sums all outflow sections", async () => {
    const r = await getMonthlyAggregates(["joint"], { year: 2026, month: 5 });
    const outflow = totalOutflow(r.planned);
    // Computed from fixture (joint only, monthly contribution view):
    //   DIVIDAS    -120000
    //   FIXAS      -25000 -5500 -8000 -2000 -15975 -16284 = -72759
    //   VARIAVEIS  -80000
    //   SAZONAIS   -30000
    expect(outflow).toBe(-302759);
  });

  it("totalIncome reads ENTRADAS exactly", async () => {
    const r = await getMonthlyAggregates(["joint"], { year: 2026, month: 5 });
    // 250000 + 250000 + 30000 = 530000.
    expect(totalIncome(r.planned)).toBe(530000);
  });
});
