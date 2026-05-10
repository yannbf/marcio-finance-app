import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  categoryBudgetDefault,
  categoryOverride,
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
import {
  categorizeTxWithOverrides,
  type Category,
} from "../categorization.ts";
import type { Scope, Section } from "../import/types.ts";

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

  // Pre-load savings accounts the user can see — used to recognize transfers
  // to/from declared savings refs (e.g. "Oranje Spaarrekening V12602730").
  const savings = await db
    .select()
    .from(savingsAccount)
    .where(inArray(savingsAccount.owner, ["joint", owner]));

  // Pre-load category overrides + per-category routing defaults. These
  // are the second-chance path for rows that no seed/learned rule
  // matches: if the auto-categorizer tags the txn as 'shopping' AND
  // the user has set 'shopping' → 'Compras geral' for this scope, we
  // route there. Joint defaults are eligible for personal accounts too
  // (transfers TO joint can land on a joint default).
  const overrideRows = await db
    .select({
      fingerprint: categoryOverride.fingerprint,
      category: categoryOverride.category,
    })
    .from(categoryOverride);
  const categoryOverrides = new Map<string, Category>(
    overrideRows.map((o) => [o.fingerprint, o.category as Category]),
  );

  const defaultRows = await db
    .select({
      category: categoryBudgetDefault.category,
      scope: categoryBudgetDefault.scope,
      naturalKey: categoryBudgetDefault.naturalKey,
      section: categoryBudgetDefault.section,
    })
    .from(categoryBudgetDefault)
    .where(
      inArray(categoryBudgetDefault.scope, ["joint", owner]),
    );
  /** category → list of (scope, section, naturalKey). Owner scope
   *  preferred; joint is the fallback. */
  const categoryDefaults = new Map<
    Category,
    Array<{ scope: Scope; section: Section; naturalKey: string }>
  >();
  for (const d of defaultRows) {
    const arr = categoryDefaults.get(d.category as Category) ?? [];
    arr.push({
      scope: d.scope as Scope,
      section: d.section as Section,
      naturalKey: d.naturalKey,
    });
    categoryDefaults.set(d.category as Category, arr);
  }
  // Sort each so the txn-owner scope wins over joint when both exist.
  for (const arr of categoryDefaults.values()) {
    arr.sort((a, b) => {
      if (a.scope === owner && b.scope !== owner) return -1;
      if (b.scope === owner && a.scope !== owner) return 1;
      return 0;
    });
  }

  // Cache: anchor "YYYY-MM" → monthId, so we don't re-query for every txn.
  const monthIdCache = new Map<string, string>();
  // Cache: monthId+scope+section+key → budgetItemId
  const budgetCache = new Map<string, string>();

  let matched = 0;
  let skippedNoBudget = 0;

  for (const t of txns) {
    const text = `${t.counterparty ?? ""} ${t.description ?? ""}`.toLowerCase();
    const absCents = Math.abs(t.amountCents);

    // First pass: savings-account refs win over generic rules. They run
    // when the counterparty mentions "spaarrekening" or "savings" and the
    // description carries a known ref.
    let ruleHit: SeedRule | null = null;
    if (/spaarrekening|savings/i.test(text)) {
      const sa = savings.find((s) => text.includes(s.ref.toLowerCase()));
      if (sa) {
        // Find ANY budget item linked to this savings account in the
        // active payday-month — every match in the same account aggregates
        // in Cofres anyway, so the specific row is fine.
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

    // Final fallback: if no specific rule fired, route via the user's
    // category-default mapping. Outflows only — credits aren't part of
    // the spend taxonomy. Skipped when amount is exactly 0 as well.
    if (!ruleHit && t.amountCents < 0 && categoryDefaults.size > 0) {
      const cat = categorizeTxWithOverrides(
        { counterparty: t.counterparty, description: t.description },
        categoryOverrides,
      );
      const candidates = categoryDefaults.get(cat);
      if (candidates && candidates.length > 0) {
        const top = candidates[0];
        ruleHit = {
          pattern: /./,
          scopes: [top.scope],
          section: top.section,
          naturalKey: top.naturalKey,
          confidence: 0.5,
          label: `category-default:${cat}`,
        };
      }
    }

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

