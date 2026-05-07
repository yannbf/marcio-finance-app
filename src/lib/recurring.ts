/**
 * Detect recurring patterns across raw bank transactions. Used to flag
 * unmatched Inbox rows that look like a subscription / monthly bill so the
 * user can categorize once + remember the rule.
 *
 * Heuristic: a fingerprint that has fired in ≥3 distinct payday-months
 * within the lookback window, with at least one occurrence per ~30-day
 * window, is "recurring". Cheap, false-positive-friendly — the user only
 * needs one click to remember it.
 */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { bankAccount, transaction } from "@/db/schema.ts";
import { fingerprintCounterparty } from "./matching/fingerprint.ts";
import { paydayMonthFor } from "./payday.ts";
import type { Scope } from "./import/types.ts";

const LOOKBACK_DAYS = 180;
const MIN_DISTINCT_MONTHS = 3;

export type RecurringSignal = {
  /** Distinct payday-months this fingerprint appeared in. */
  months: number;
  /** Approximate amount in cents (median of historical amounts, abs value). */
  typicalAbsCents: number;
};

/**
 * Returns a Map<transactionId, RecurringSignal> for any unmatched
 * transaction whose counterparty fingerprint shows up in ≥MIN_DISTINCT_MONTHS
 * payday-months across the last LOOKBACK_DAYS. The signal is keyed by the
 * unmatched transaction ID so the caller can attach it directly.
 */
export async function detectRecurringForUnmatched(
  unmatchedIds: string[],
  scopes: Scope[],
  paydayDay: number,
): Promise<Map<string, RecurringSignal>> {
  const out = new Map<string, RecurringSignal>();
  if (unmatchedIds.length === 0) return out;

  // Pull every outflow in the lookback window for the visible scopes —
  // we need to know how many distinct payday-months each fingerprint
  // appears in, so matched rows count too.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);

  const rows = await db
    .select({
      id: transaction.id,
      counterparty: transaction.counterparty,
      bookingDate: transaction.bookingDate,
      amountCents: transaction.amountCents,
    })
    .from(transaction)
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
    .where(
      and(
        inArray(bankAccount.owner, scopes),
        gte(transaction.bookingDate, since),
        sql`${transaction.amountCents} < 0`,
      ),
    )
    .orderBy(desc(transaction.bookingDate));

  // Group by fingerprint; collect distinct payday-month keys + amounts.
  type Group = {
    months: Set<string>;
    amounts: number[];
    txIds: string[];
  };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    if (!r.counterparty) continue;
    const fp = fingerprintCounterparty(r.counterparty);
    if (!fp || fp.length < 2) continue;
    const range = paydayMonthFor(r.bookingDate, paydayDay);
    const monthKey = `${range.anchorYear}-${range.anchorMonth}`;
    const g = groups.get(fp) ?? {
      months: new Set<string>(),
      amounts: [],
      txIds: [],
    };
    g.months.add(monthKey);
    g.amounts.push(Math.abs(r.amountCents));
    g.txIds.push(r.id);
    groups.set(fp, g);
  }

  const unmatchedSet = new Set(unmatchedIds);
  for (const g of groups.values()) {
    if (g.months.size < MIN_DISTINCT_MONTHS) continue;
    const sorted = [...g.amounts].sort((a, b) => a - b);
    const typicalAbsCents = sorted[Math.floor(sorted.length / 2)];
    for (const id of g.txIds) {
      if (unmatchedSet.has(id)) {
        out.set(id, { months: g.months.size, typicalAbsCents });
      }
    }
  }
  return out;
}
