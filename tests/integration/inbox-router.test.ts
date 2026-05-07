/**
 * Integration tests for the `inbox` tRPC router. Covers the three
 * places real users feel pain when this router drifts:
 *
 *  1. The unmatched-list query — returns the right rows for the right
 *     scopes, with the per-anchor budget item options needed to
 *     categorize them.
 *  2. `assign` — moves a transaction to the right item, deletes any
 *     prior auto-rule pick, optionally remembers the rule.
 *  3. Confidence learning — a "remember" of a rule that already exists
 *     bumps confirmedHits; an override punches overriddenHits up.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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

async function findItemByKey(
  naturalKey: string,
  scope: "joint" | "yann" | "camila",
) {
  const [b] = await db
    .select()
    .from(schema.budgetItem)
    .where(
      and(
        eq(schema.budgetItem.naturalKey, naturalKey),
        eq(schema.budgetItem.scope, scope),
      ),
    );
  return b!;
}

async function findUnmatchedTxn(counterpartyContains: string) {
  const all = await db.select().from(schema.transaction);
  return all.find((t) =>
    (t.counterparty ?? "").toLowerCase().includes(counterpartyContains.toLowerCase()),
  )!;
}

describe("inbox.list", () => {
  it("returns only unmatched joint+role transactions", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.inbox.list();

    // Every returned row must be unmatched (the router's own contract).
    for (const t of r.txns) {
      const matches = await db
        .select()
        .from(schema.txMatch)
        .where(eq(schema.txMatch.transactionId, t.id));
      expect(matches.length).toBe(0);
    }

    // None of them should be the camila personal mystery vendor —
    // privacy guard says yann's role only sees joint + yann.
    for (const t of r.txns) {
      expect(t.owner).not.toBe("camila");
    }
  });

  it("groups budget options by anchor month", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.inbox.list();
    expect(r.optionsByAnchor["2026-05"]).toBeDefined();
    // Joint options the picker would show: mortgage, mercado, …
    const keys = (r.optionsByAnchor["2026-05"] ?? []).map((o) => o.scope);
    expect(keys).toContain("joint");
    // Yann is allowed; should also appear.
    expect(keys).toContain("yann");
    // Camila must not.
    expect(keys).not.toContain("camila");
  });
});

describe("inbox.assign", () => {
  it("creates a user match and removes any prior auto-rule pick", async () => {
    const caller = makeAuthedCaller("yann");
    const target = await findItemByKey("mercado", "joint");
    // Find a Tikkie row that auto-matched to saidas-casal so we can move it.
    const r = await db
      .select()
      .from(schema.transaction)
      .innerJoin(
        schema.txMatch,
        eq(schema.txMatch.transactionId, schema.transaction.id),
      )
      .innerJoin(
        schema.budgetItem,
        eq(schema.budgetItem.id, schema.txMatch.budgetItemId),
      )
      .where(eq(schema.budgetItem.naturalKey, "saidas-casal"));
    expect(r.length).toBeGreaterThan(0);
    const moveTx = r[0]!.transaction;
    const priorBudgetItemId = r[0]!.transaction_match.budgetItemId;
    expect(priorBudgetItemId).not.toBe(target.id);

    const result = await caller.inbox.assign({
      transactionId: moveTx.id,
      budgetItemId: target.id,
    });
    expect(result.ok).toBe(true);

    const after = await db
      .select()
      .from(schema.txMatch)
      .where(eq(schema.txMatch.transactionId, moveTx.id));
    expect(after).toHaveLength(1);
    expect(after[0]!.budgetItemId).toBe(target.id);
    expect(after[0]!.source).toBe("user");
    expect(after[0]!.confirmedByUserId).toBe("test-user-yann");
  });

  it("rememberRule creates a learned match_rule row", async () => {
    const caller = makeAuthedCaller("yann");
    const tx = await findUnmatchedTxn("Mystery Vendor One");
    const target = await findItemByKey("mercado", "joint");

    await caller.inbox.assign({
      transactionId: tx.id,
      budgetItemId: target.id,
      rememberRule: true,
    });

    const rules = await db
      .select()
      .from(schema.matchRule)
      .where(
        and(
          eq(schema.matchRule.scope, "joint"),
          eq(schema.matchRule.targetSection, "VARIAVEIS"),
          eq(schema.matchRule.targetNaturalKey, "mercado"),
        ),
      );
    expect(rules.length).toBeGreaterThanOrEqual(1);
    // Pattern is the fingerprinted form — Mystery Vendor One has no city
    // tail / digits, so it's just lowercased & escaped.
    expect(rules[0]!.counterpartyPattern).toBe("mystery vendor one");
  });

  it("overriding an auto-rule pick bumps overriddenHits on the matching rule", async () => {
    // Build a learned rule that auto-matches AH → compras-geral, then
    // user reassigns to mercado. The rule's overriddenHits should bump.
    const accountId = (
      await db.select().from(schema.bankAccount).where(eq(schema.bankAccount.owner, "joint"))
    )[0]!.id;
    const compras = await findItemByKey("compras-geral", "joint");
    const mercado = await findItemByKey("mercado", "joint");

    // Existing AH transactions get auto-matched to mercado by the seed
    // rule. That's actually fine for "confirm" — for "override" we need
    // a learned rule that points elsewhere AND outranks the seed.
    const [rule] = await db
      .insert(schema.matchRule)
      .values({
        scope: "joint",
        counterpartyPattern: "albert heijn",
        targetSection: "VARIAVEIS",
        targetNaturalKey: "compras-geral",
        confidence: "0.950", // beats the 0.9 seed
        confirmedHits: 0,
        overriddenHits: 0,
      })
      .returning();

    // Re-run matching now that the rule exists: an AH transaction should
    // land on compras-geral because the learned rule wins on confidence.
    const { runMatchingForAccount } = await import(
      "../../src/lib/matching/engine.ts"
    );
    // Wipe existing matches for AH txns so the engine reconsiders them.
    const ahTxns = await db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.bankAccountId, accountId));
    const ahRows = ahTxns.filter(
      (t) => (t.counterparty ?? "").toLowerCase().includes("albert heijn"),
    );
    for (const t of ahRows) {
      await db
        .delete(schema.txMatch)
        .where(eq(schema.txMatch.transactionId, t.id));
    }
    await runMatchingForAccount(accountId);

    // Sanity: AH transaction is now matched to compras-geral.
    const sample = ahRows[0]!;
    const beforeAssign = await db
      .select()
      .from(schema.txMatch)
      .where(eq(schema.txMatch.transactionId, sample.id));
    expect(beforeAssign[0]!.budgetItemId).toBe(compras.id);

    // User overrides → mercado.
    const caller = makeAuthedCaller("yann");
    await caller.inbox.assign({
      transactionId: sample.id,
      budgetItemId: mercado.id,
    });

    const [after] = await db
      .select()
      .from(schema.matchRule)
      .where(eq(schema.matchRule.id, rule.id));
    expect(after!.overriddenHits).toBe(1);
    expect(Number.parseFloat(after!.confidence!)).toBeLessThan(0.95);
  });
});

describe("inbox.assignMany", () => {
  it("assigns every transaction in one go", async () => {
    const caller = makeAuthedCaller("yann");
    const target = await findItemByKey("mercado", "joint");

    const mysteries = await db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.bankAccountId, (
        await db
          .select()
          .from(schema.bankAccount)
          .where(eq(schema.bankAccount.owner, "joint"))
      )[0]!.id));
    const ids = mysteries
      .filter((t) =>
        (t.counterparty ?? "").startsWith("Mystery Vendor"),
      )
      .map((t) => t.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);

    const r = await caller.inbox.assignMany({
      transactionIds: ids,
      budgetItemId: target.id,
    });
    expect(r.ok).toBe(true);
    expect(r.assigned).toBe(ids.length);

    for (const id of ids) {
      const [m] = await db
        .select()
        .from(schema.txMatch)
        .where(eq(schema.txMatch.transactionId, id));
      expect(m).toBeDefined();
      expect(m!.budgetItemId).toBe(target.id);
      expect(m!.source).toBe("user");
    }
  });
});
