/**
 * Detect transfers to/from Dutch ING-style savings accounts whose ref
 * (e.g. "V12602730") is NOT yet declared as a `savings_account` row.
 *
 * Surfaces them on the Settings → Savings screen so the user can
 * "claim" each ref with one tap (nickname + owner) and have the
 * matching engine retroactively route every prior transaction to
 * the new bucket.
 */

import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  savingsAccount,
  transaction,
} from "@/db/schema.ts";
import { detectSavingsBucketRef } from "./matching/seed-rules.ts";
import type { Scope } from "./import/types.ts";

export type UnidentifiedSavingsRef = {
  /** The "[NVA]\d{8}" ref pulled out of the description. */
  ref: string;
  /** Number of transactions seen referring to this ref. */
  txCount: number;
  /** Sum of absolute cents flowing through this ref (always positive). */
  totalAbsCents: number;
  /** Most-recent booking date among the transactions, ISO string. */
  latestBookingDate: string;
  /** Owner of the bank account where this ref's transactions appeared. */
  suggestedOwner: Scope;
};

/**
 * Window for detecting unidentified refs. We look back at the last
 * year — long enough to surface yearly-cadence savings buckets the
 * user hasn't classified yet.
 */
const LOOKBACK_DAYS = 365;

/**
 * Scan recent transactions for "spaarrekening <REF>" mentions whose
 * ref is not in `savings_account`. Aggregates by ref. Scoped to the
 * caller's visible scopes — a personal account's refs only surface
 * to its owner.
 */
export async function detectUnidentifiedSavingsRefs(
  scopes: Scope[],
): Promise<UnidentifiedSavingsRef[]> {
  if (scopes.length === 0) return [];

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const known = await db
    .select({ ref: savingsAccount.ref })
    .from(savingsAccount);
  const knownRefs = new Set(known.map((r) => r.ref.toUpperCase()));

  const rows = await db
    .select({
      counterparty: transaction.counterparty,
      description: transaction.description,
      amountCents: transaction.amountCents,
      bookingDate: transaction.bookingDate,
      owner: bankAccount.owner,
    })
    .from(transaction)
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
    .where(
      and(
        inArray(bankAccount.owner, scopes),
        gte(transaction.bookingDate, since),
      ),
    );

  type Bucket = {
    ref: string;
    txCount: number;
    totalAbsCents: number;
    latestBookingDate: Date;
    /** Track per-owner counts so we can pick the most-frequent one as
     * the suggested owner of the new savings_account row. */
    ownerCounts: Map<Scope, number>;
  };
  const byRef = new Map<string, Bucket>();

  for (const r of rows) {
    const haystack = `${r.counterparty ?? ""} ${r.description ?? ""}`;
    const ref = detectSavingsBucketRef(haystack);
    if (!ref) continue;
    if (knownRefs.has(ref.toUpperCase())) continue;

    const owner = r.owner as Scope;
    const cur = byRef.get(ref);
    if (cur) {
      cur.txCount += 1;
      cur.totalAbsCents += Math.abs(r.amountCents);
      if (r.bookingDate > cur.latestBookingDate) {
        cur.latestBookingDate = r.bookingDate;
      }
      cur.ownerCounts.set(owner, (cur.ownerCounts.get(owner) ?? 0) + 1);
    } else {
      byRef.set(ref, {
        ref,
        txCount: 1,
        totalAbsCents: Math.abs(r.amountCents),
        latestBookingDate: r.bookingDate,
        ownerCounts: new Map([[owner, 1]]),
      });
    }
  }

  return [...byRef.values()]
    .map((b) => {
      let topOwner: Scope = "joint";
      let topCount = -1;
      for (const [o, c] of b.ownerCounts) {
        if (c > topCount) {
          topCount = c;
          topOwner = o;
        }
      }
      return {
        ref: b.ref,
        txCount: b.txCount,
        totalAbsCents: b.totalAbsCents,
        latestBookingDate: b.latestBookingDate.toISOString(),
        suggestedOwner: topOwner,
      };
    })
    .sort((a, b) => b.txCount - a.txCount);
}
