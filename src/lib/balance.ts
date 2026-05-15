import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { bankAccount, transaction } from "@/db/schema.ts";

export type AccountScope = "joint" | "yann" | "camila";

export type BalanceSummary = {
  totalCents: number;
  /**
   * "synced" — every visible account has a bank-reported balance.
   * "inferred" — no account does; the figure is the txn-sum estimate.
   * "mixed" — some accounts have a real balance, others fall back. Treat
   * the total as approximate.
   */
  source: "synced" | "inferred" | "mixed";
  /**
   * Oldest `balanceAsOf` across synced accounts in scope — surfacing the
   * staleness floor lets the UI say "as of {date}" without overstating
   * how fresh more recently synced accounts are. Null when no account in
   * scope has a synced balance.
   */
  asOf: Date | null;
};

/**
 * Compute the "money in the bank" figure for a set of scopes.
 *
 * Prefers each account's bank-reported `balanceCents` when present; falls
 * back to summing `transaction.amountCents` per account otherwise. Mixing
 * the two is intentional — accounts connected via Enable Banking land
 * here as authoritative, CSV-only accounts stay inferred, and we don't
 * want to penalize a household for not having every account on a feed.
 */
export async function getBalanceSummary(
  scopes: AccountScope[],
): Promise<BalanceSummary> {
  if (scopes.length === 0) {
    return { totalCents: 0, source: "inferred", asOf: null };
  }

  const rows = await db
    .select({
      id: bankAccount.id,
      balanceCents: bankAccount.balanceCents,
      balanceAsOf: bankAccount.balanceAsOf,
      txSum: sql<string>`COALESCE(SUM(${transaction.amountCents}), 0)`,
    })
    .from(bankAccount)
    .leftJoin(transaction, eq(transaction.bankAccountId, bankAccount.id))
    .where(inArray(bankAccount.owner, scopes))
    .groupBy(bankAccount.id);

  if (rows.length === 0) {
    return { totalCents: 0, source: "inferred", asOf: null };
  }

  let totalCents = 0;
  let synced = 0;
  let oldestAsOf: Date | null = null;
  for (const r of rows) {
    if (r.balanceCents !== null) {
      totalCents += r.balanceCents;
      synced++;
      if (r.balanceAsOf && (!oldestAsOf || r.balanceAsOf < oldestAsOf)) {
        oldestAsOf = r.balanceAsOf;
      }
    } else {
      totalCents += Number.parseInt(r.txSum, 10);
    }
  }

  const source: BalanceSummary["source"] =
    synced === rows.length
      ? "synced"
      : synced === 0
        ? "inferred"
        : "mixed";
  return { totalCents, source, asOf: oldestAsOf };
}
