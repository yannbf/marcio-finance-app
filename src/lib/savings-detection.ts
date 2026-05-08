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

export type UnidentifiedSavingsSample = {
  bookingDate: string;
  /** Cleaned-up description (ref + "Value date:" tail stripped). */
  description: string;
  amountCents: number;
};

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
  /**
   * User-typed labels seen between the ref and the "Value date:" suffix
   * — e.g. "Afronding", "Maio", "Impostos" — ordered by frequency desc.
   * These are the strongest hint about what the savings account is
   * actually used for.
   */
  topPurposes: string[];
  /** Up to 5 most recent transactions, kept for at-a-glance recognition. */
  samples: UnidentifiedSavingsSample[];
};

/**
 * Pull the user-typed purpose label out of the savings transfer
 * description. ING formats the row as
 *   "To/From Oranje spaarrekening <REF> <PURPOSE> Value date: dd/mm/yyyy"
 * so we capture whatever sits between the ref and "Value date:". Falls
 * back to null when the description doesn't follow the canonical shape.
 */
export function extractSavingsPurpose(
  description: string | null,
  ref: string,
): string | null {
  if (!description) return null;
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `spaarrekening\\s+${escaped}\\s+(.+?)\\s+(?:value\\s*date|$)`,
    "i",
  );
  const m = description.match(re);
  if (!m) return null;
  const purpose = m[1].trim();
  if (!purpose || purpose.length > 40) return null;
  return purpose;
}

/**
 * Strip the "Value date: …" suffix from a savings transfer description
 * so the sample preview reads cleanly. The booking date in the parent
 * row already gives the user the temporal context.
 */
export function cleanSavingsDescription(description: string | null): string {
  if (!description) return "";
  return description.replace(/\s*value\s*date:.*$/i, "").trim();
}

const MAX_SAMPLES = 5;

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
    /** Frequency-counted user-typed purposes — surfaces "Afronding" /
     * "Maio" / "Impostos" so the user can recognise the account at a
     * glance instead of squinting at "V12602730". */
    purposeCounts: Map<string, number>;
    /** Recent transactions, kept sorted newest-first up to MAX_SAMPLES. */
    samples: UnidentifiedSavingsSample[];
  };
  const byRef = new Map<string, Bucket>();

  function pushSample(b: Bucket, r: (typeof rows)[number]) {
    const sample: UnidentifiedSavingsSample = {
      bookingDate: r.bookingDate.toISOString(),
      description: cleanSavingsDescription(r.description),
      amountCents: r.amountCents,
    };
    // Insert in newest-first order; cap at MAX_SAMPLES.
    const idx = b.samples.findIndex(
      (s) => new Date(s.bookingDate) < r.bookingDate,
    );
    if (idx === -1) {
      if (b.samples.length < MAX_SAMPLES) b.samples.push(sample);
    } else {
      b.samples.splice(idx, 0, sample);
      if (b.samples.length > MAX_SAMPLES) b.samples.length = MAX_SAMPLES;
    }
  }

  for (const r of rows) {
    const haystack = `${r.counterparty ?? ""} ${r.description ?? ""}`;
    const ref = detectSavingsBucketRef(haystack);
    if (!ref) continue;
    if (knownRefs.has(ref.toUpperCase())) continue;

    const owner = r.owner as Scope;
    const purpose = extractSavingsPurpose(r.description, ref);

    const cur = byRef.get(ref);
    if (cur) {
      cur.txCount += 1;
      cur.totalAbsCents += Math.abs(r.amountCents);
      if (r.bookingDate > cur.latestBookingDate) {
        cur.latestBookingDate = r.bookingDate;
      }
      cur.ownerCounts.set(owner, (cur.ownerCounts.get(owner) ?? 0) + 1);
      if (purpose) {
        cur.purposeCounts.set(
          purpose,
          (cur.purposeCounts.get(purpose) ?? 0) + 1,
        );
      }
      pushSample(cur, r);
    } else {
      const bucket: Bucket = {
        ref,
        txCount: 1,
        totalAbsCents: Math.abs(r.amountCents),
        latestBookingDate: r.bookingDate,
        ownerCounts: new Map([[owner, 1]]),
        purposeCounts: purpose ? new Map([[purpose, 1]]) : new Map(),
        samples: [],
      };
      pushSample(bucket, r);
      byRef.set(ref, bucket);
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
      const topPurposes = [...b.purposeCounts.entries()]
        .sort((a, c) => c[1] - a[1])
        .slice(0, 3)
        .map(([p]) => p);
      return {
        ref: b.ref,
        txCount: b.txCount,
        totalAbsCents: b.totalAbsCents,
        latestBookingDate: b.latestBookingDate.toISOString(),
        suggestedOwner: topOwner,
        topPurposes,
        samples: b.samples,
      };
    })
    .sort((a, b) => b.txCount - a.txCount);
}
