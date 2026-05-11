/**
 * Single source of truth for "what should this transaction look like in
 * the UI?" — converts the bank-provided counterparty + description into
 * a friendly display name + an avatar hint.
 *
 * Why: raw NL bank rows are full of opaque strings. ING round-up sweeps
 * surface as NULL-counterparty + a long Dutch description. Bank-fee
 * lines look identical. Savings-account transfers reference a short
 * code (V12602730) instead of "CC investments". This module makes the
 * UI legible without modifying any raw data.
 *
 * Resolution order:
 *   1. ING round-up ("Afronding" / round-up + spaarrekening) →
 *      "CC investments round up and save" + piggy-bank avatar.
 *   2. Bank-fee descriptions (Kosten OranjePakket / Kosten tweede
 *      rekeninghouder / Kosten geldopname / Incasso ING creditcard) →
 *      a friendly Portuguese label + ING avatar.
 *   3. A known savings-account reference (V12602730, N14631597,
 *      A14753415) in counterparty/description → the household's
 *      nickname for that pot (CC investments / CC Big fun / CC Taxas
 *      anuais) + ING avatar.
 *   4. Otherwise: pass-through.
 */

import { AFRONDING_PATTERN } from "./matching/seed-rules.ts";

export type AvatarHint = "ing" | "piggy" | null;

export type DisplayCounterparty = {
  /** Name to show as the counterparty label in any tx row. */
  name: string;
  /** Lookup key for the avatar — "ing" / "piggy" force the right brand
   * glyph regardless of what the original counterparty would resolve to.
   * Null = let CounterpartyAvatar fall back to its normal logic. */
  avatar: AvatarHint;
  /** A stable key per "kind" of transaction so the by-amount grouping in
   * Activity can keep e.g. round-ups in their own bucket. Null = use the
   * counterparty fingerprint as usual. */
  groupKey: string | null;
};

const SAVINGS_NICKNAMES: { ref: string; nickname: string }[] = [
  { ref: "V12602730", nickname: "CC investments" },
  { ref: "N14631597", nickname: "CC Big fun" },
  { ref: "A14753415", nickname: "CC Taxas anuais" },
];

const ROUNDUP_LABEL = "CC investments round up and save";

/**
 * Bank-fee descriptions on the joint / personal ING accounts. These come
 * with NULL counterparty so the only signal is in the description text.
 */
const BANK_FEE_PATTERNS: { pattern: RegExp; label: string }[] = [
  {
    pattern: /kosten\s*tweede\s*rekeninghouder/i,
    label: "ING — bank costs (joint)",
  },
  { pattern: /kosten\s*oranjepakket/i, label: "ING — bank costs" },
  { pattern: /kosten\s*geldopname/i, label: "ING — ATM withdrawal fee" },
  {
    pattern: /incasso\s*ing\s*creditcard/i,
    label: "ING credit card",
  },
];

export function resolveDisplayCounterparty(row: {
  counterparty: string | null;
  description: string | null;
}): DisplayCounterparty {
  const haystack = `${row.counterparty ?? ""} ${row.description ?? ""}`;

  // 1. Round-ups land on CC investments via Afronding/round-up sweeps.
  if (AFRONDING_PATTERN.test(haystack)) {
    return { name: ROUNDUP_LABEL, avatar: "piggy", groupKey: "roundup" };
  }

  // 2. Bank fees — friendly label + ING avatar.
  for (const f of BANK_FEE_PATTERNS) {
    if (f.pattern.test(haystack)) {
      return { name: f.label, avatar: "ing", groupKey: `bank-fee:${f.label}` };
    }
  }

  // 3. Real savings-account transfers (V/N/A ref present).
  for (const s of SAVINGS_NICKNAMES) {
    if (haystack.includes(s.ref)) {
      return {
        name: s.nickname,
        avatar: "ing",
        groupKey: `savings:${s.ref}`,
      };
    }
  }

  // 4. Pass-through.
  return {
    name: (row.counterparty ?? "").trim() || "—",
    avatar: null,
    groupKey: null,
  };
}

/** Whether this transaction is an ING round-up. Centralised so the
 * by-date Activity view can filter them out and the by-amount view can
 * surface them grouped. */
export function isRoundUpTx(row: {
  counterparty: string | null;
  description: string | null;
}): boolean {
  return AFRONDING_PATTERN.test(`${row.counterparty ?? ""} ${row.description ?? ""}`);
}
