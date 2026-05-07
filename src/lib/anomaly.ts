/**
 * Detect when a recurring matched charge lands at an amount that's
 * unusually high compared to its own history. Used to surface a "looks
 * higher than normal" chip on Activity rows.
 */

import { and, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { budgetItem, transaction, txMatch } from "@/db/schema.ts";
import type { Scope, Section } from "./import/types.ts";

/** Minimum prior samples needed before we trust mean+σ enough to flag. */
const MIN_SAMPLES = 4;
/** σ multiple beyond which we surface a warning. 2.0 = ~upper 2.5%. */
const SIGMA_THRESHOLD = 2.0;

export type AmountAnomaly = {
  /** Mean abs(amountCents) of historical occurrences. */
  meanCents: number;
  /** Number of historical occurrences considered. */
  samples: number;
};

/**
 * For each matched item ID in `current`, return an anomaly record if the
 * txn's amount sits more than SIGMA_THRESHOLD σ above its historical mean.
 * Items without enough history (<MIN_SAMPLES) are silently skipped.
 *
 * `currentMonthRange` excludes transactions in the active month so a
 * one-off spike in this month doesn't pollute its own baseline.
 */
export async function detectAmountAnomalies(
  current: { id: string; matchedItemId: string; absCents: number }[],
  scopes: Scope[],
  currentMonthRange: { startsOn: Date; endsOn: Date },
): Promise<Map<string, AmountAnomaly>> {
  const out = new Map<string, AmountAnomaly>();
  if (current.length === 0) return out;

  // Resolve each matched item to its (scope, section, naturalKey) so we can
  // pool history across months — a 2026-05 budget_item row and a 2026-04
  // one with the same naturalKey share a baseline.
  const matchedItemIds = Array.from(
    new Set(current.map((c) => c.matchedItemId)),
  );
  const itemMeta = await db
    .select({
      id: budgetItem.id,
      naturalKey: budgetItem.naturalKey,
      scope: budgetItem.scope,
      section: budgetItem.section,
    })
    .from(budgetItem)
    .where(inArray(budgetItem.id, matchedItemIds));

  const keyByItemId = new Map<string, string>();
  for (const m of itemMeta) {
    keyByItemId.set(m.id, `${m.scope}|${m.section}|${m.naturalKey}`);
  }

  const naturalKeys = Array.from(
    new Set(itemMeta.map((m) => m.naturalKey)),
  );
  if (naturalKeys.length === 0) return out;

  // Pull historical matched amounts joined by naturalKey across all months.
  // Exclude the active payday-month so this month's spike isn't its own
  // baseline.
  const history = await db
    .select({
      naturalKey: budgetItem.naturalKey,
      scope: budgetItem.scope,
      section: budgetItem.section,
      amountCents: transaction.amountCents,
    })
    .from(txMatch)
    .innerJoin(transaction, eq(transaction.id, txMatch.transactionId))
    .innerJoin(budgetItem, eq(budgetItem.id, txMatch.budgetItemId))
    .where(
      and(
        inArray(budgetItem.naturalKey, naturalKeys),
        inArray(budgetItem.scope, scopes),
        sql`${transaction.amountCents} < 0`,
        or(
          lt(transaction.bookingDate, currentMonthRange.startsOn),
          gt(transaction.bookingDate, currentMonthRange.endsOn),
        ),
      ),
    );

  const samplesByKey = new Map<string, number[]>();
  for (const h of history) {
    const key = `${h.scope}|${h.section as Section}|${h.naturalKey}`;
    const arr = samplesByKey.get(key) ?? [];
    arr.push(Math.abs(h.amountCents));
    samplesByKey.set(key, arr);
  }

  for (const c of current) {
    const key = keyByItemId.get(c.matchedItemId);
    if (!key) continue;
    const samples = samplesByKey.get(key);
    if (!samples || samples.length < MIN_SAMPLES) continue;
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const variance =
      samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
    const sigma = Math.sqrt(variance);
    if (c.absCents > mean + SIGMA_THRESHOLD * sigma) {
      out.set(c.id, {
        meanCents: Math.round(mean),
        samples: samples.length,
      });
    }
  }
  return out;
}
