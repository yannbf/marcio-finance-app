/**
 * Integration tests for the matching engine. These exercise the real
 * SEED_RULES against live transactions in a PGlite Postgres — the same
 * SQL, the same Drizzle, the same `runMatchingForAccount` the production
 * cron path runs.
 *
 * Goal: lock down the rule-resolution behaviour that callers actually
 * care about — "does this AH transaction land in the Mercado bucket?",
 * "do learned rules below the floor get ignored?", "do savings refs
 * win over generic rules?" — so future seed-rule edits can't quietly
 * break the categorisation.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTestDb } from "../support/test-db.ts";

const ctx = withTestDb();

let db: typeof import("../../src/db/index.ts")["db"];
let schema: typeof import("../../src/db/schema.ts");
let runMatchingForAccount: typeof import("../../src/lib/matching/engine.ts")["runMatchingForAccount"];
let upsertParsedMonth: typeof import("../../src/lib/import/upsert.ts")["upsertParsedMonth"];
let TEST_BUDGET_SHEET: typeof import("../support/seed-fixtures.ts")["TEST_BUDGET_SHEET"];

beforeAll(async () => {
  ({ db } = await import("../../src/db/index.ts"));
  schema = await import("../../src/db/schema.ts");
  ({ runMatchingForAccount } = await import(
    "../../src/lib/matching/engine.ts"
  ));
  ({ upsertParsedMonth } = await import("../../src/lib/import/upsert.ts"));
  ({ TEST_BUDGET_SHEET } = await import("../support/seed-fixtures.ts"));
});

beforeEach(async () => {
  await ctx.reset();
});

async function makeJointAccount(): Promise<string> {
  const [a] = await db
    .insert(schema.bankAccount)
    .values({
      iban: "NL00TEST0000000001",
      nickname: "Joint",
      owner: "joint",
      kind: "checking",
      bank: "TestBank",
    })
    .returning({ id: schema.bankAccount.id });
  return a.id;
}

async function insertTxn(
  bankAccountId: string,
  values: {
    bookingDate: string;
    counterparty: string;
    description: string;
    amountCents: number;
  },
): Promise<string> {
  const [t] = await db
    .insert(schema.transaction)
    .values({
      bankAccountId,
      bookingDate: new Date(`${values.bookingDate}T12:00:00.000Z`),
      counterparty: values.counterparty,
      description: values.description,
      amountCents: values.amountCents,
      dedupeKey: `${values.bookingDate}-${values.amountCents}-${values.counterparty}`.slice(
        0,
        180,
      ),
    })
    .returning({ id: schema.transaction.id });
  return t.id;
}

async function getMatch(transactionId: string) {
  const [m] = await db
    .select({
      source: schema.txMatch.source,
      budgetItemId: schema.txMatch.budgetItemId,
      ruleId: schema.txMatch.ruleId,
    })
    .from(schema.txMatch)
    .where(eq(schema.txMatch.transactionId, transactionId));
  return m ?? null;
}

async function getBudgetItem(naturalKey: string, scope: "joint" | "yann" | "camila", section: string) {
  const [b] = await db
    .select()
    .from(schema.budgetItem)
    .where(
      and(
        eq(schema.budgetItem.naturalKey, naturalKey),
        eq(schema.budgetItem.scope, scope),
        eq(schema.budgetItem.section, section as "VARIAVEIS"),
      ),
    );
  return b ?? null;
}

describe("runMatchingForAccount — seed rules", () => {
  beforeEach(async () => {
    await upsertParsedMonth(TEST_BUDGET_SHEET);
  });

  it("matches Albert Heijn → mercado regardless of city tail", async () => {
    const accountId = await makeJointAccount();
    const t1 = await insertTxn(accountId, {
      bookingDate: "2026-05-02",
      counterparty: "Albert Heijn 1234",
      description: "Albert Heijn AMSTERDAM NLD",
      amountCents: -3500,
    });
    const t2 = await insertTxn(accountId, {
      bookingDate: "2026-05-03",
      counterparty: "Albert Heijn 9999",
      description: "Albert Heijn UTRECHT NLD",
      amountCents: -2200,
    });

    const out = await runMatchingForAccount(accountId);
    expect(out.matched).toBe(2);

    const target = await getBudgetItem("mercado", "joint", "VARIAVEIS");
    expect(target).not.toBeNull();

    const m1 = await getMatch(t1);
    const m2 = await getMatch(t2);
    expect(m1?.budgetItemId).toBe(target!.id);
    expect(m2?.budgetItemId).toBe(target!.id);
    expect(m1?.source).toBe("auto-rule");
  });

  it("disambiguates the two VGZ premiums by amount range", async () => {
    const accountId = await makeJointAccount();
    const tYann = await insertTxn(accountId, {
      bookingDate: "2026-05-05",
      counterparty: "VGZ Zorgverzekeraar",
      description: "premie",
      amountCents: -15975,
    });
    const tCamila = await insertTxn(accountId, {
      bookingDate: "2026-05-05",
      counterparty: "VGZ Zorgverzekeraar",
      description: "premie",
      amountCents: -16284,
    });

    await runMatchingForAccount(accountId);

    const yannItem = await getBudgetItem(
      "plano-saude-yann",
      "joint",
      "FIXAS",
    );
    const camilaItem = await getBudgetItem(
      "plano-saude-camila",
      "joint",
      "FIXAS",
    );
    expect(yannItem).not.toBeNull();
    expect(camilaItem).not.toBeNull();

    const m1 = await getMatch(tYann);
    const m2 = await getMatch(tCamila);
    expect(m1?.budgetItemId).toBe(yannItem!.id);
    expect(m2?.budgetItemId).toBe(camilaItem!.id);
  });

  it("matches mortgage → DIVIDAS:mortgage", async () => {
    const accountId = await makeJointAccount();
    const tx = await insertTxn(accountId, {
      bookingDate: "2026-05-01",
      counterparty: "ING Hypotheken",
      description: "Mortgage May",
      amountCents: -120000,
    });
    await runMatchingForAccount(accountId);
    const mortgage = await getBudgetItem("mortgage", "joint", "DIVIDAS");
    const m = await getMatch(tx);
    expect(m?.budgetItemId).toBe(mortgage!.id);
  });

  it("falls back to the Tikkie rule for AAB INZ TIKKIE rows", async () => {
    const accountId = await makeJointAccount();
    const tx = await insertTxn(accountId, {
      bookingDate: "2026-05-04",
      counterparty: "AAB INZ TIKKIE",
      description: "Tikkie ID 123, drinks, Van Alice, NL00ABNA",
      amountCents: -1200,
    });
    await runMatchingForAccount(accountId);
    const target = await getBudgetItem("saidas-casal", "joint", "VARIAVEIS");
    const m = await getMatch(tx);
    expect(m?.budgetItemId).toBe(target!.id);
  });

  it("leaves unmatched rows alone (no row in transaction_match)", async () => {
    const accountId = await makeJointAccount();
    const tx = await insertTxn(accountId, {
      bookingDate: "2026-05-04",
      counterparty: "Mystery Vendor One",
      description: "no rule should match this",
      amountCents: -1500,
    });
    const out = await runMatchingForAccount(accountId);
    expect(out.matched).toBe(0);
    expect(await getMatch(tx)).toBeNull();
  });

  it("skips rows whose target item doesn't exist in this month", async () => {
    // Insert a budget month that's missing the AH "mercado" line so the
    // rule has nothing to point at. The engine should mark it
    // skippedNoBudget rather than throw.
    await db
      .delete(schema.budgetItem)
      .where(eq(schema.budgetItem.naturalKey, "mercado"));

    const accountId = await makeJointAccount();
    const tx = await insertTxn(accountId, {
      bookingDate: "2026-05-02",
      counterparty: "Albert Heijn 1234",
      description: "Albert Heijn",
      amountCents: -3500,
    });
    const out = await runMatchingForAccount(accountId);
    expect(out.matched).toBe(0);
    expect(out.skippedNoBudget).toBe(1);
    expect(await getMatch(tx)).toBeNull();
  });

  it("is idempotent — running twice produces the same single match", async () => {
    const accountId = await makeJointAccount();
    const tx = await insertTxn(accountId, {
      bookingDate: "2026-05-02",
      counterparty: "Albert Heijn",
      description: "groceries",
      amountCents: -3500,
    });
    await runMatchingForAccount(accountId);
    const after1 = await getMatch(tx);
    expect(after1).not.toBeNull();

    await runMatchingForAccount(accountId);
    // Still exactly one row, same target.
    const all = await db
      .select()
      .from(schema.txMatch)
      .where(eq(schema.txMatch.transactionId, tx));
    expect(all.length).toBe(1);
    expect(all[0]!.budgetItemId).toBe(after1!.budgetItemId);
  });
});

describe("runMatchingForAccount — learned rules", () => {
  beforeEach(async () => {
    await upsertParsedMonth(TEST_BUDGET_SHEET);
  });

  it("learned rules above the confidence floor outrank seed rules", async () => {
    // Seed-rule for AH (confidence 0.9) → mercado.
    // Add a learned rule (confidence 0.95) → compras-geral. Expect the
    // learned target to win.
    const accountId = await makeJointAccount();
    const target = await getBudgetItem(
      "compras-geral",
      "joint",
      "VARIAVEIS",
    );
    expect(target).not.toBeNull();

    await db.insert(schema.matchRule).values({
      scope: "joint",
      counterpartyPattern: "albert heijn",
      targetSection: "VARIAVEIS",
      targetNaturalKey: "compras-geral",
      confidence: "0.950",
    });

    const tx = await insertTxn(accountId, {
      bookingDate: "2026-05-02",
      counterparty: "Albert Heijn 1234",
      description: "Albert Heijn",
      amountCents: -3500,
    });
    await runMatchingForAccount(accountId);

    const m = await getMatch(tx);
    expect(m?.budgetItemId).toBe(target!.id);
  });

  it("learned rules below the floor are ignored", async () => {
    const accountId = await makeJointAccount();
    const mercado = await getBudgetItem("mercado", "joint", "VARIAVEIS");

    // 0.30 is below CONFIDENCE_FLOOR (0.4) — should be skipped, falling
    // back to the seed rule (0.9 → mercado).
    await db.insert(schema.matchRule).values({
      scope: "joint",
      counterpartyPattern: "albert heijn",
      targetSection: "VARIAVEIS",
      targetNaturalKey: "compras-geral",
      confidence: "0.300",
    });

    const tx = await insertTxn(accountId, {
      bookingDate: "2026-05-02",
      counterparty: "Albert Heijn 1234",
      description: "AH groceries",
      amountCents: -3500,
    });
    await runMatchingForAccount(accountId);

    const m = await getMatch(tx);
    expect(m?.budgetItemId).toBe(mercado!.id);
  });
});

describe("runMatchingForAccount — savings refs", () => {
  beforeEach(async () => {
    await upsertParsedMonth(TEST_BUDGET_SHEET);
  });

  afterEach(async () => {
    await db.delete(schema.savingsAccount);
  });

  it("a transfer that mentions a known savings ref routes there even if seed rules also match", async () => {
    // Wire a savings_account with a default budget item to point at.
    await db.insert(schema.savingsAccount).values({
      owner: "joint",
      ref: "V12602730",
      nickname: "Trip Fund",
      defaultBudgetItemNaturalKey: "trip-fund",
    });

    const accountId = await makeJointAccount();
    const target = await getBudgetItem("trip-fund", "joint", "SAZONAIS");
    expect(target).not.toBeNull();

    const tx = await insertTxn(accountId, {
      bookingDate: "2026-05-02",
      counterparty: "ING Spaarrekening",
      // Mention the ref in the description — this is what the engine
      // looks for.
      description: "Transfer to Spaarrekening V12602730",
      amountCents: -10000,
    });
    await runMatchingForAccount(accountId);

    const m = await getMatch(tx);
    expect(m?.budgetItemId).toBe(target!.id);
  });
});
