/**
 * Integration tests for the savings tRPC router.
 *
 *  - `listUnidentified` surfaces every "spaarrekening <REF>" mention
 *    whose ref isn't yet declared in `savings_account`, scoped to the
 *    visible owners.
 *  - `create` inserts a savings_account, links the chosen SAZONAIS
 *    items, and retroactively re-runs the matching engine so prior
 *    transactions referring to the new ref get a tx_match row.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
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
  const [row] = await db
    .select({ id: schema.bankAccount.id })
    .from(schema.bankAccount)
    .where(eq(schema.bankAccount.owner, "joint"));
  return row.id;
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
      dedupeKey:
        `${values.bookingDate}-${values.amountCents}-${values.counterparty}-${values.description}`.slice(
          0,
          180,
        ),
    })
    .returning({ id: schema.transaction.id });
  return t.id;
}

describe("savings.listUnidentified", () => {
  it("aggregates unidentified spaarrekening refs by ref string", async () => {
    const accountId = await getJointAccountId();
    await insertTxn(accountId, {
      bookingDate: "2026-05-02",
      counterparty: "ING Spaarrekening",
      description: "Transfer to spaarrekening V99999991 monthly trip",
      amountCents: -10000,
    });
    await insertTxn(accountId, {
      bookingDate: "2026-05-09",
      counterparty: "ING Spaarrekening",
      description: "Transfer to spaarrekening V99999991 monthly trip",
      amountCents: -10000,
    });
    await insertTxn(accountId, {
      bookingDate: "2026-05-15",
      counterparty: "ING Spaarrekening",
      description: "Transfer to spaarrekening N88888881 yearly tax pot",
      amountCents: -5000,
    });

    const caller = makeAuthedCaller("yann");
    const refs = await caller.savings.listUnidentified();

    expect(refs.length).toBe(2);
    const v = refs.find((r) => r.ref === "V99999991");
    expect(v).toBeDefined();
    expect(v!.txCount).toBe(2);
    expect(v!.totalAbsCents).toBe(20000);
    expect(v!.suggestedOwner).toBe("joint");

    const n = refs.find((r) => r.ref === "N88888881");
    expect(n!.txCount).toBe(1);
  });

  it("excludes refs that are already in savings_account", async () => {
    const accountId = await getJointAccountId();
    await db.insert(schema.savingsAccount).values({
      ref: "V77777771",
      nickname: "Existing",
      owner: "joint",
    });
    await insertTxn(accountId, {
      bookingDate: "2026-05-02",
      counterparty: "ING Spaarrekening",
      description: "Transfer to spaarrekening V77777771 already-known",
      amountCents: -10000,
    });
    await insertTxn(accountId, {
      bookingDate: "2026-05-02",
      counterparty: "ING Spaarrekening",
      description: "Transfer to spaarrekening V66666661 unknown",
      amountCents: -3000,
    });

    const caller = makeAuthedCaller("yann");
    const refs = await caller.savings.listUnidentified();
    expect(refs.map((r) => r.ref)).toEqual(["V66666661"]);
  });
});

describe("savings.create", () => {
  it("inserts the savings_account row and links the chosen SAZONAIS items", async () => {
    const caller = makeAuthedCaller("yann");
    const r = await caller.savings.create({
      ref: "V55555551",
      nickname: "Trip pot",
      owner: "joint",
      linkedNaturalKeys: ["trip-fund"],
    });
    expect(r.id).toBeTruthy();

    const [row] = await db
      .select()
      .from(schema.savingsAccount)
      .where(eq(schema.savingsAccount.ref, "V55555551"));
    expect(row).toBeDefined();
    expect(row.nickname).toBe("Trip pot");
    expect(row.defaultBudgetItemNaturalKey).toBe("trip-fund");

    const linked = await db
      .select()
      .from(schema.budgetItem)
      .where(
        and(
          eq(schema.budgetItem.naturalKey, "trip-fund"),
          eq(schema.budgetItem.scope, "joint"),
        ),
      );
    expect(linked.length).toBeGreaterThan(0);
    for (const item of linked) {
      expect(item.savingsAccountId).toBe(row.id);
    }
  });

  it("retroactively re-matches prior transactions whose description carries the ref", async () => {
    const accountId = await getJointAccountId();
    // A transaction referring to a not-yet-claimed ref. Seed didn't
    // know what to do with it, so it has no tx_match.
    const txId = await insertTxn(accountId, {
      bookingDate: "2026-05-02",
      counterparty: "ING Spaarrekening",
      description: "Transfer to spaarrekening V44444441 trip",
      amountCents: -10000,
    });

    const before = await db
      .select()
      .from(schema.txMatch)
      .where(eq(schema.txMatch.transactionId, txId));
    expect(before.length).toBe(0);

    const caller = makeAuthedCaller("yann");
    const r = await caller.savings.create({
      ref: "V44444441",
      nickname: "Trip pot",
      owner: "joint",
      linkedNaturalKeys: ["trip-fund"],
    });
    expect(r.rematched).toBeGreaterThan(0);

    const after = await db
      .select({
        budgetItemId: schema.txMatch.budgetItemId,
        source: schema.txMatch.source,
      })
      .from(schema.txMatch)
      .where(eq(schema.txMatch.transactionId, txId));
    expect(after.length).toBe(1);

    // The new tx_match should point at a budget_item linked to our new
    // savings_account.
    const [item] = await db
      .select({
        naturalKey: schema.budgetItem.naturalKey,
        savingsAccountId: schema.budgetItem.savingsAccountId,
      })
      .from(schema.budgetItem)
      .where(eq(schema.budgetItem.id, after[0].budgetItemId));
    expect(item.naturalKey).toBe("trip-fund");
    expect(item.savingsAccountId).toBeTruthy();
  });

  it("rejects creating a personal savings account belonging to the other user", async () => {
    const caller = makeAuthedCaller("yann");
    await expect(
      caller.savings.create({
        ref: "V33333331",
        nickname: "Camila personal",
        owner: "camila",
      }),
    ).rejects.toThrow();
  });
});
