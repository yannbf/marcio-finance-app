import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  matchRule,
  month,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { paydayMonthFor } from "../payday.ts";
import { getHouseholdSettings } from "../settings.ts";
import { SEED_RULES, type SeedRule } from "./seed-rules.ts";
import type { Scope } from "../import/types.ts";

export type MatchOutcome = {
  matched: number;
  skippedNoBudget: number;
  alreadyMatched: number;
  examined: number;
};

/**
 * Run the matching engine across every transaction belonging to the given
 * bank account that doesn't yet have a tx_match row.
 *
 * Strategy per transaction:
 *   1. Find candidate seed rules whose scope includes the account owner and
 *      whose pattern matches "<counterparty> <description>".
 *   2. Filter by amount range when the rule specifies one.
 *   3. Pick the highest-confidence rule.
 *   4. Resolve the target budget_item via (payday-month for this txn, scope,
 *      section, naturalKey). Skip if not found yet (budget hasn't been
 *      imported for that month).
 *   5. Insert a tx_match row with source='auto-rule'.
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

  // Cache: anchor "YYYY-MM" → monthId, so we don't re-query for every txn.
  const monthIdCache = new Map<string, string>();
  // Cache: monthId+scope+section+key → budgetItemId
  const budgetCache = new Map<string, string>();

  let matched = 0;
  let skippedNoBudget = 0;

  for (const t of txns) {
    const text = `${t.counterparty ?? ""} ${t.description ?? ""}`.toLowerCase();
    const absCents = Math.abs(t.amountCents);

    const ruleHit = bestRuleHit({
      seed: SEED_RULES,
      learned: learnedRules.map((r) => ({
        pattern: new RegExp(r.counterpartyPattern, "i"),
        scopes: [r.scope as Scope],
        section: r.targetSection as SeedRule["section"],
        naturalKey: r.targetNaturalKey,
        minAbsCents: r.minCents ?? undefined,
        maxAbsCents: r.maxCents ?? undefined,
        confidence: r.confidence ? Number.parseFloat(r.confidence) : 0.7,
        label: "learned",
      })),
      owner,
      text,
      absCents,
    });

    if (!ruleHit) continue;

    const range = paydayMonthFor(t.bookingDate, settings.paydayDay);
    const monthKey = `${range.anchorYear}-${range.anchorMonth}`;
    let monthId = monthIdCache.get(monthKey);
    if (!monthId) {
      const [m] = await db
        .select({ id: month.id })
        .from(month)
        .where(
          and(
            eq(month.anchorYear, range.anchorYear),
            eq(month.anchorMonth, range.anchorMonth),
          ),
        );
      if (!m) {
        skippedNoBudget++;
        continue;
      }
      monthId = m.id;
      monthIdCache.set(monthKey, monthId);
    }

    const targetScope: Scope = ruleHit.scopes[0] ?? owner;
    const cacheKey = `${monthId}|${targetScope}|${ruleHit.section}|${ruleHit.naturalKey}`;
    let budgetItemId = budgetCache.get(cacheKey);
    if (!budgetItemId) {
      const [bi] = await db
        .select({ id: budgetItem.id })
        .from(budgetItem)
        .where(
          and(
            eq(budgetItem.monthId, monthId),
            eq(budgetItem.scope, targetScope),
            eq(budgetItem.section, ruleHit.section),
            eq(budgetItem.naturalKey, ruleHit.naturalKey),
          ),
        );
      if (!bi) {
        skippedNoBudget++;
        continue;
      }
      budgetItemId = bi.id;
      budgetCache.set(cacheKey, budgetItemId);
    }

    await db
      .insert(txMatch)
      .values({
        transactionId: t.id,
        budgetItemId,
        allocatedCents: t.amountCents,
        source: "auto-rule",
      })
      .onConflictDoNothing();
    matched++;
  }

  return {
    matched,
    skippedNoBudget,
    alreadyMatched: 0,
    examined: txns.length,
  };
}

/**
 * Run matching across every account at once. Useful after importing a new
 * sheet month so previously-unmatched transactions can resolve.
 */
export async function runMatchingAllAccounts(): Promise<MatchOutcome> {
  const accounts = await db.select({ id: bankAccount.id }).from(bankAccount);
  const totals: MatchOutcome = {
    matched: 0,
    skippedNoBudget: 0,
    alreadyMatched: 0,
    examined: 0,
  };
  for (const a of accounts) {
    const r = await runMatchingForAccount(a.id);
    totals.matched += r.matched;
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

