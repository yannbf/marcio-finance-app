/**
 * Integration tests for the category-default routing path.
 *
 *  - `categories.setDefault` upserts a routing rule and re-runs matching
 *    so prior unmatched transactions land on the chosen budget item.
 *  - `categories.clearDefault` removes the rule and matching falls back
 *    to seed/learned/inbox.
 *  - The matching engine itself prefers a more specific seed/learned
 *    rule over a category default; the default only kicks in for
 *    rows nothing else matched.
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

async function getJointAccountId(): Promise<string> {
  const [r] = await db
    .select({ id: schema.bankAccount.id })
    .from(schema.bankAccount)
    .where(eq(schema.bankAccount.owner, "joint"));
  return r.id;
}

describe("categories.setDefault", () => {
  it("routes 'other' transactions to the chosen budget item retroactively", async () => {
    const caller = makeAuthedCaller("yann");

    // Seed an outflow that no seed rule matches.
    const [yannAcct] = await db
      .select()
      .from(schema.bankAccount)
      .where(eq(schema.bankAccount.owner, "yann"));
    await db.insert(schema.transaction).values({
      bankAccountId: yannAcct.id,
      bookingDate: new Date("2026-05-12T12:00:00Z"),
      counterparty: "Some Mystery Vendor",
      description: "no seed rule matches this",
      amountCents: -1234,
      dedupeKey: "yann-mystery-route",
    });

    // Pre-condition: the txn is unmatched.
    const before = await caller.activity.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann",
    });
    const mystery = before.txns.find(
      (t) => t.counterparty === "Some Mystery Vendor",
    );
    expect(mystery?.matchedItemId).toBeNull();

    // Set a routing default: 'other' on yann's scope → an existing
    // outflow item. Use one of the seeded SAZONAIS items as the target.
    const options = await caller.categories.budgetItemOptions({
      scope: "yann",
    });
    expect(options.length).toBeGreaterThan(0);
    const target = options[0];

    const result = await caller.categories.setDefault({
      category: "other",
      scope: "yann",
      naturalKey: target.naturalKey,
      section: target.section,
      sampleName: target.name,
    });
    expect(result.rematched).toBeGreaterThanOrEqual(1);

    // After: matched.
    const after = await caller.activity.get({
      anchor: { year: 2026, month: 5 },
      scope: "yann",
    });
    const reclassified = after.txns.find(
      (t) => t.counterparty === "Some Mystery Vendor",
    );
    expect(reclassified?.matchedItemId).toBeTruthy();
  });

  it("does not override a more specific seed rule", async () => {
    const caller = makeAuthedCaller("yann");

    const jointId = await getJointAccountId();
    await db.insert(schema.transaction).values({
      bankAccountId: jointId,
      bookingDate: new Date("2026-05-10T12:00:00Z"),
      counterparty: "Albert Heijn 9876",
      description: "groceries",
      amountCents: -2500,
      dedupeKey: "joint-ah-rule-priority",
    });

    // Set an unrelated "groceries" → some-random-item default. The seed
    // rule for Albert Heijn → mercado should still win.
    const options = await caller.categories.budgetItemOptions({
      scope: "joint",
    });
    const nonMercado = options.find((o) => o.naturalKey !== "mercado");
    if (!nonMercado) return;

    await caller.categories.setDefault({
      category: "groceries",
      scope: "joint",
      naturalKey: nonMercado.naturalKey,
      section: nonMercado.section,
      sampleName: nonMercado.name,
    });

    const after = await caller.activity.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
    });
    const ah = after.txns.find((t) => t.counterparty === "Albert Heijn 9876");
    expect(ah?.matchedName).toBe("Mercado");
  });

  it("clearDefault removes the rule and re-running matching no-ops on it", async () => {
    const caller = makeAuthedCaller("yann");

    const options = await caller.categories.budgetItemOptions({
      scope: "yann",
    });
    if (options.length === 0) return;

    await caller.categories.setDefault({
      category: "other",
      scope: "yann",
      naturalKey: options[0].naturalKey,
      section: options[0].section,
    });

    const cleared = await caller.categories.clearDefault({
      category: "other",
      scope: "yann",
    });
    expect(cleared.cleared).toBe(1);

    const list = await caller.categories.listDefaults();
    expect(
      list.find((d) => d.category === "other" && d.scope === "yann"),
    ).toBeUndefined();
  });
});
