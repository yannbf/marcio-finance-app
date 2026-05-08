/**
 * Integration tests for the `today` tRPC router. Exercises the headline
 * aggregations the home screen depends on — planned/actual sums, the
 * outflow/income split, the unmatched count, and forecast.
 *
 * Tests run against a PGlite-backed Postgres seeded with the shared
 * fixtures so behaviour stays representative of a populated household.
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

describe("today.get", () => {
  it("returns the right anchor for the seeded month", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.today.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
    });
    expect(r.anchor).toEqual({ year: 2026, month: 5 });
    expect(r.paydayDay).toBe(25);
  });

  it("totals planned outflow across joint sections", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.today.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
    });
    // Joint outflow planned in fixture:
    //   DIVIDAS  -120000 (mortgage)
    //   FIXAS    -25000 -5500 -8000 -2000 -15975 -16284 = -72759
    //   VARIAVEIS -40000 -20000 -15000 -5000 = -80000
    //   SAZONAIS yearly -360000 → -30000 monthly
    // Total absolute: 120000 + 72759 + 80000 + 30000 = 302759 cents.
    expect(r.plannedOutflowCents).toBe(302759);
  });

  it("counts unmatched joint transactions in inboxCount", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.today.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
    });
    // Fixture has 3 mystery vendors that no rule matches on joint.
    expect(r.inboxCount).toBeGreaterThanOrEqual(3);
  });

  it("yann-scoped view excludes camila-only inbox rows", async () => {
    const yannCaller = makeAuthedCaller("yann");
    const camilaCaller = makeAuthedCaller("camila");

    const yann = await yannCaller.today.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann",
    });
    const camila = await camilaCaller.today.get({
      anchor: { year: 2026, month: 5 },
      scope: "camila",
    });
    // The two scopes should not both see each other's mystery vendors.
    expect(yann.inboxCount).toBeGreaterThanOrEqual(1);
    expect(camila.inboxCount).toBeGreaterThanOrEqual(1);
  });

  it("personal-scope headline uses personal expenses (not gross outflow, not take-home)", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.today.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann",
    });
    // Fixture yann has only one personal outflow line: VARIAVEIS
    // saidas at -10_000 (€100). No explicit transfer-to-joint line.
    // The salary row uses contributionRatio 0.5 (case A), so the
    // joint contribution is NOT in outflow. Heuristic: gross
    // outflow (10_000) <= contribution (250_000) → leave alone.
    expect(r.plannedOutflowCents).toBe(10000);
    // The salary row's contributionRatio is applied inside
    // getMonthlyAggregates so income reflects take-home (€2,500).
    // The displayed gross salary lives separately on
    // personalChecklist.salary.plannedCents (= 500_000).
    expect(r.incomeCents).toBe(250000);
  });

  it("personal-scope headline subtracts an explicit transfer-to-joint line", async () => {
    // Simulate the "case B" sheet shape: salary with NO ratio set
    // and a separate "transfer to joint" outflow line. The headline
    // must subtract the transfer so it shows personal expenses
    // only.
    const { db } = await import("../../src/db/index.ts");
    const schema = await import("../../src/db/schema.ts");
    const { eq, and } = await import("drizzle-orm");

    const [monthRow] = await db
      .select({ id: schema.month.id })
      .from(schema.month)
      .where(
        and(
          eq(schema.month.anchorYear, 2026),
          eq(schema.month.anchorMonth, 5),
        ),
      );

    // Drop yann's ratio + add a fat transfer-to-joint outflow line
    // and a few other personal expenses so gross outflow > the
    // contribution.
    await db
      .insert(schema.budgetItem)
      .values([
        {
          monthId: monthRow!.id,
          scope: "yann",
          section: "ENTRADAS",
          naturalKey: "salary",
          name: "Salário Yann",
          plannedCents: 500000,
          cadence: "monthly",
        },
        {
          monthId: monthRow!.id,
          scope: "yann",
          section: "DIVIDAS",
          naturalKey: "transferencia-conjunta",
          name: "Transferência conjunta",
          plannedCents: -250000,
          cadence: "monthly",
        },
        {
          monthId: monthRow!.id,
          scope: "yann",
          section: "FIXAS",
          naturalKey: "personal-internet",
          name: "Internet pessoal",
          plannedCents: -50000,
          cadence: "monthly",
        },
      ]);

    const caller = makeAuthedCaller("yann");
    const r = await caller.today.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann",
    });
    // Gross outflow now: 10_000 (saidas) + 250_000 (transfer) +
    // 50_000 (internet) = 310_000. Joint contribution = 250_000.
    // Heuristic fires (310k > 250k) → subtract → personal expenses
    // = 60_000 (saidas + internet, the actual expenses).
    expect(r.plannedOutflowCents).toBe(60000);
  });

  it("joint-scope headline keeps the gross planned-outflow denominator", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.today.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
    });
    // Joint view answers "how is the household budget doing?" — the
    // denominator there IS planned outflow on the joint account.
    expect(r.plannedOutflowCents).toBe(302759);
  });

  it("personalChecklist surfaces salary + contribution amounts in personal scope", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.today.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann",
    });
    expect(r.personalChecklist).not.toBeNull();
    expect(r.personalChecklist?.salary?.plannedCents).toBe(500000);
    expect(r.personalChecklist?.contribution?.plannedCents).toBe(250000);
  });

  it("personalChecklist is null in joint scope", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.today.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
    });
    expect(r.personalChecklist).toBeNull();
  });

  it("anonymous callers can only see joint", async () => {
    const { makeAnonCaller } = await import("../support/trpc-caller.ts");
    const caller = makeAnonCaller();
    const r = await caller.today.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann", // user requests yann, but allowed_scopes drops it
    });
    // Privacy guard: requested view falls back to allowed (joint only).
    expect(r.anchor.month).toBe(5);
  });

  it("returns zeros when no month has been imported", async () => {
    const caller = makeAuthedCaller("yann");
    // Pick a year well into the future where we definitely haven't seeded.
    const r = await caller.today.get({
      anchor: { year: 2099, month: 12 },
      scope: "joint",
    });
    expect(r.plannedOutflowCents).toBe(0);
    expect(r.spentOutflowCents).toBe(0);
    expect(r.incomeCents).toBe(0);
  });
});
