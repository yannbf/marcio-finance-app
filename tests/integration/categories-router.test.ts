/**
 * Integration tests for the categories tRPC router.
 *
 *  - `set` upserts an override keyed by counterparty fingerprint.
 *  - `clear` removes it.
 *  - Subsequent `activity.get` and `insights.get` calls reflect the
 *    override retroactively (no tx-level mutation needed).
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

describe("categories.set + clear", () => {
  it("pins a category to a counterparty fingerprint and surfaces it in activity", async () => {
    const caller = makeAuthedCaller("yann");

    // Default classification: Mystery Yann Vendor → 'other'.
    const before = await caller.activity.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann",
    });
    const mystery = before.txns.find(
      (t) => t.counterparty === "Mystery Yann Vendor",
    );
    expect(mystery).toBeDefined();
    expect(mystery!.category).toBe("other");

    // Pin it to entertainment.
    const set = await caller.categories.set({
      counterparty: "Mystery Yann Vendor",
      category: "entertainment",
    });
    expect(set.category).toBe("entertainment");
    expect(set.fingerprint.length).toBeGreaterThan(0);

    // Same activity query now reports entertainment for that row.
    const after = await caller.activity.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann",
    });
    const reclassified = after.txns.find(
      (t) => t.counterparty === "Mystery Yann Vendor",
    );
    expect(reclassified!.category).toBe("entertainment");
  });

  it("re-buckets the insights breakdown without touching tx data", async () => {
    const caller = makeAuthedCaller("yann");

    const insightsBefore = await caller.insights.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann",
    });
    const otherBefore = insightsBefore.byCategory.find(
      (c) => c.category === "other",
    );
    const entertainmentBefore = insightsBefore.byCategory.find(
      (c) => c.category === "entertainment",
    );
    expect(otherBefore).toBeDefined();
    expect(otherBefore!.count).toBeGreaterThan(0);

    await caller.categories.set({
      counterparty: "Mystery Yann Vendor",
      category: "entertainment",
    });

    const insightsAfter = await caller.insights.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann",
    });
    const otherAfter = insightsAfter.byCategory.find(
      (c) => c.category === "other",
    );
    const entertainmentAfter = insightsAfter.byCategory.find(
      (c) => c.category === "entertainment",
    );

    // 'other' shrunk by exactly one tx; 'entertainment' grew by one.
    expect(otherAfter?.count ?? 0).toBe((otherBefore?.count ?? 0) - 1);
    expect(entertainmentAfter?.count ?? 0).toBe(
      (entertainmentBefore?.count ?? 0) + 1,
    );
  });

  it("set is idempotent — second call rewrites the same row", async () => {
    const caller = makeAuthedCaller("yann");

    const first = await caller.categories.set({
      counterparty: "Mystery Yann Vendor",
      category: "entertainment",
    });
    const second = await caller.categories.set({
      counterparty: "Mystery Yann Vendor",
      category: "shopping",
    });
    expect(second.id).toBe(first.id);

    const list = await caller.categories.list();
    const matches = list.filter(
      (o) => o.fingerprint === first.fingerprint,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].category).toBe("shopping");
  });

  it("clear removes the override and the regex rules take over again", async () => {
    const caller = makeAuthedCaller("yann");

    await caller.categories.set({
      counterparty: "Mystery Yann Vendor",
      category: "entertainment",
    });

    const cleared = await caller.categories.clear({
      counterparty: "Mystery Yann Vendor",
    });
    expect(cleared.cleared).toBe(1);

    const after = await caller.activity.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann",
    });
    const reverted = after.txns.find(
      (t) => t.counterparty === "Mystery Yann Vendor",
    );
    expect(reverted!.category).toBe("other");
  });
});
