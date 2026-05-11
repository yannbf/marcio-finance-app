import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  matchRule,
  month,
  savingsAccount,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { paydayMonthFor } from "../payday.ts";
import { getHouseholdSettings } from "../settings.ts";
import { SEED_RULES, type SeedRule } from "./seed-rules.ts";
import { CONFIDENCE_FLOOR } from "./rule-confidence.ts";
import { ensureOtherBuckets } from "../import/upsert.ts";
import type { Scope, Section } from "../import/types.ts";

export type MatchOutcome = {
  matched: number;
  /** Subset of `matched` — matches that landed on a fallback month's
   * budget item because the txn's own payday-month had no sheet imported
   * with the target line. The match's `projectedFromMonthId` points back
   * at the txn's real month so the UI can show a "projected" hint. */
  projected: number;
  skippedNoBudget: number;
  alreadyMatched: number;
  examined: number;
};

/**
 * Run the matching engine across every transaction belonging to the given
 * bank account that doesn't yet have a tx_match row.
 *
 * Strategy per transaction:
 *   1. Pick the best seed/learned rule (or savings-ref shortcut).
 *   2. Resolve the target budget_item via (payday-month, scope, section,
 *      naturalKey). If the txn's own payday-month doesn't have a row, the
 *      engine auto-creates the month (with `importedAt = null`) and falls
 *      back to the closest existing month that DOES have the target line —
 *      then records that fallback by setting `projectedFromMonthId`.
 *   3. Insert a tx_match row with source='auto-rule'.
 */
export async function runMatchingForAccount(
  bankAccountId: string,
): Promise<MatchOutcome> {
  const settings = await getHouseholdSettings();

  const [account] = await db
    .select()
    .from(bankAccount)
    .where(eq(bankAccount.id, bankAccountId));
  if (!account) throw new Error("Bank account not found");

  const owner = account.owner as Scope;

  const txns = await db
    .select({
      id: transaction.id,
      bookingDate: transaction.bookingDate,
      amountCents: transaction.amountCents,
      counterparty: transaction.counterparty,
      description: transaction.description,
    })
    .from(transaction)
    .leftJoin(txMatch, eq(txMatch.transactionId, transaction.id))
    .where(
      and(eq(transaction.bankAccountId, bankAccountId), isNull(txMatch.id)),
    );

  // Pre-load learned rules for this scope.
  const learnedRules = await db
    .select()
    .from(matchRule)
    .where(eq(matchRule.scope, owner));

  // Pre-load savings accounts the user can see — used to recognize transfers
  // to/from declared savings refs (e.g. "Oranje Spaarrekening V12602730").
  const savings = await db
    .select()
    .from(savingsAccount)
    .where(inArray(savingsAccount.owner, ["joint", owner]));

  // Cache: anchor "YYYY-MM" → monthId, so we don't re-query for every txn.
  const monthIdCache = new Map<string, string>();
  // Cache: monthId+scope+section+key → budgetItemId (own-month hit)
  const budgetCache = new Map<string, string>();
  // Cache: scope+section+key → fallback budgetItemId (any-month hit)
  const fallbackCache = new Map<string, string>();

  let matched = 0;
  let projected = 0;
  let skippedNoBudget = 0;

  for (const t of txns) {
    const text = `${t.counterparty ?? ""} ${t.description ?? ""}`.toLowerCase();
    const absCents = Math.abs(t.amountCents);

    // First pass: savings-account refs win over generic rules.
    let ruleHit: SeedRule | null = null;
    if (/spaarrekening|savings/i.test(text)) {
      const sa = savings.find((s) => text.includes(s.ref.toLowerCase()));
      if (sa) {
        const linked = await db
          .select({ naturalKey: budgetItem.naturalKey })
          .from(budgetItem)
          .where(eq(budgetItem.savingsAccountId, sa.id))
          .limit(1);
        const target =
          linked[0]?.naturalKey ?? sa.defaultBudgetItemNaturalKey;
        if (target) {
          ruleHit = {
            pattern: /./,
            scopes: [sa.owner as Scope],
            section: "SAZONAIS",
            naturalKey: target,
            confidence: 0.95,
            label: `savings:${sa.ref}`,
          };
        }
      }
    }

    if (!ruleHit) {
      ruleHit = bestRuleHit({
        seed: SEED_RULES,
        learned: learnedRules
          .filter((r) => {
            const c = r.confidence ? Number.parseFloat(r.confidence) : 0.7;
            return c >= CONFIDENCE_FLOOR;
          })
          .map((r) => ({
            pattern: new RegExp(r.counterpartyPattern, "i"),
            scopes: [r.scope as Scope],
            section: r.targetSection as Section,
            naturalKey: r.targetNaturalKey,
            minAbsCents: r.minCents ?? undefined,
            maxAbsCents: r.maxCents ?? undefined,
            confidence: r.confidence ? Number.parseFloat(r.confidence) : 0.7,
            label: `learned:${r.id}`,
          })),
        owner,
        text,
        absCents,
      });
    }

    if (!ruleHit) continue;

    const range = paydayMonthFor(t.bookingDate, settings.paydayDay);
    const monthKey = `${range.anchorYear}-${range.anchorMonth}`;
    let txnMonthId = monthIdCache.get(monthKey);
    if (!txnMonthId) {
      txnMonthId = await ensureMonthRow(range);
      monthIdCache.set(monthKey, txnMonthId);
    }

    const targetScope: Scope = ruleHit.scopes[0] ?? owner;
    const ownCacheKey = `${txnMonthId}|${targetScope}|${ruleHit.section}|${ruleHit.naturalKey}`;
    let budgetItemId = budgetCache.get(ownCacheKey);
    let projectedFromMonthId: string | null = null;

    if (!budgetItemId) {
      const [bi] = await db
        .select({ id: budgetItem.id })
        .from(budgetItem)
        .where(
          and(
            eq(budgetItem.monthId, txnMonthId),
            eq(budgetItem.scope, targetScope),
            eq(budgetItem.section, ruleHit.section),
            eq(budgetItem.naturalKey, ruleHit.naturalKey),
          ),
        );
      if (bi) {
        budgetItemId = bi.id;
        budgetCache.set(ownCacheKey, budgetItemId);
      }
    }

    // Fallback: txn's own payday-month doesn't have the target item.
    // Pick the temporally CLOSEST month that does, so old transactions
    // can still get a meaningful match against newer sheet data.
    if (!budgetItemId) {
      const fbKey = `${targetScope}|${ruleHit.section}|${ruleHit.naturalKey}`;
      let fb = fallbackCache.get(fbKey);
      if (fb === undefined) {
        const [hit] = await db
          .select({ id: budgetItem.id })
          .from(budgetItem)
          .innerJoin(month, eq(month.id, budgetItem.monthId))
          .where(
            and(
              eq(budgetItem.scope, targetScope),
              eq(budgetItem.section, ruleHit.section),
              eq(budgetItem.naturalKey, ruleHit.naturalKey),
            ),
          )
          .orderBy(
            // Closest anchor (year, month) to the txn's anchor.
            sql`ABS(
              (${month.anchorYear} * 12 + ${month.anchorMonth}) -
              (${range.anchorYear} * 12 + ${range.anchorMonth})
            )`,
          )
          .limit(1);
        fb = hit?.id ?? "";
        fallbackCache.set(fbKey, fb);
      }
      if (!fb) {
        skippedNoBudget++;
        continue;
      }
      budgetItemId = fb;
      projectedFromMonthId = txnMonthId;
    }

    await db
      .insert(txMatch)
      .values({
        transactionId: t.id,
        budgetItemId,
        allocatedCents: t.amountCents,
        source: "auto-rule",
        projectedFromMonthId,
      })
      .onConflictDoNothing();
    matched++;
    if (projectedFromMonthId) projected++;
  }

  return {
    matched,
    projected,
    skippedNoBudget,
    alreadyMatched: 0,
    examined: txns.length,
  };
}

/**
 * Ensure a `month` row exists for the given payday-month anchor. If the
 * sheet hasn't been imported, the row is created with `importedAt = null`
 * so downstream code (Month screen, matching engine) has a stable id to
 * attach Other buckets + projected matches to. The full sheet import,
 * when it eventually runs, just sees the row and proceeds normally.
 */
async function ensureMonthRow(range: {
  anchorYear: number;
  anchorMonth: number;
  startsOn: Date;
  endsOn: Date;
}): Promise<string> {
  const [existing] = await db
    .select({ id: month.id })
    .from(month)
    .where(
      and(
        eq(month.anchorYear, range.anchorYear),
        eq(month.anchorMonth, range.anchorMonth),
      ),
    );
  if (existing) return existing.id;
  const [created] = await db
    .insert(month)
    .values({
      anchorYear: range.anchorYear,
      anchorMonth: range.anchorMonth,
      startsOn: range.startsOn,
      endsOn: range.endsOn,
      importedAt: null,
    })
    .returning({ id: month.id });
  // Always seed the per-scope Other buckets so the engine has somewhere
  // to land Other-routed txns even in months without a sheet.
  await ensureOtherBuckets(created.id);
  return created.id;
}

/**
 * Run matching across every account at once. Useful after importing a new
 * sheet month so previously-unmatched transactions can resolve.
 */
export async function runMatchingAllAccounts(): Promise<MatchOutcome> {
  const accounts = await db.select({ id: bankAccount.id }).from(bankAccount);
  const totals: MatchOutcome = {
    matched: 0,
    projected: 0,
    skippedNoBudget: 0,
    alreadyMatched: 0,
    examined: 0,
  };
  for (const a of accounts) {
    const r = await runMatchingForAccount(a.id);
    totals.matched += r.matched;
    totals.projected += r.projected;
    totals.skippedNoBudget += r.skippedNoBudget;
    totals.alreadyMatched += r.alreadyMatched;
    totals.examined += r.examined;
  }
  return totals;
}

/* -------------------------------------------------------------------------- */

function bestRuleHit(args: {
  seed: SeedRule[];
  learned: SeedRule[];
  owner: Scope;
  text: string;
  absCents: number;
}): SeedRule | null {
  let best: SeedRule | null = null;
  for (const rule of [...args.learned, ...args.seed]) {
    if (!rule.scopes.includes(args.owner)) continue;
    if (rule.minAbsCents != null && args.absCents < rule.minAbsCents) continue;
    if (rule.maxAbsCents != null && args.absCents > rule.maxAbsCents) continue;
    if (!rule.pattern.test(args.text)) continue;
    if (!best || rule.confidence > best.confidence) best = rule;
  }
  return best;
}
