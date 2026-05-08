import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  matchRule,
  month,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { protectedProcedure, publicProcedure, router } from "../trpc.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { AFRONDING_PATTERN } from "@/lib/matching/seed-rules.ts";
import { fingerprintCounterparty } from "@/lib/matching/fingerprint.ts";
import { computeRuleConfidence } from "@/lib/matching/rule-confidence.ts";
import { detectRecurringForUnmatched } from "@/lib/recurring.ts";
import type { Section } from "@/lib/import/types.ts";

/**
 * "Apply to" mode — controls whether an assign acts on a single tx, fans
 * out to other unmatched txns with the same counterparty, or creates a
 * learned rule for future ones.
 *
 *  - "this":    just this transaction. Default.
 *  - "similar": this + every other UNMATCHED transaction whose
 *               fingerprint matches, each routed to its own
 *               payday-month's budget item.
 *  - "future":  just this transaction, AND a learned rule that captures
 *               future similar transactions automatically.
 */
const ApplyToInput = z.enum(["this", "similar", "future"]).default("this");
type ApplyTo = z.infer<typeof ApplyToInput>;

export const inboxRouter = router({
  /**
   * Unmatched transactions for the visible scopes, tagged with the
   * payday-month each one belongs to + the budget-item options for that
   * specific month.
   *
   * With ~90 days of synced history the inbox spans 3+ payday-months. The
   * old shape returned options from `paydayMonthFor(now)` only, which forced
   * a February transaction to be filed under a May category. Now each
   * transaction carries `anchorYear`/`anchorMonth`, and we return
   * `optionsByAnchor` keyed by `"YYYY-MM"` so the picker can offer the
   * categories that actually exist for that month — or surface
   * `monthsWithoutSheet` so the UI can prompt for a sheet import.
   */
  list: publicProcedure.query(async ({ ctx }) => {
    const settings = await getHouseholdSettings();
    const allowed = ctx.allowedScopes;

    const rows = await db
      .select({
        id: transaction.id,
        counterparty: transaction.counterparty,
        description: transaction.description,
        bookingDate: transaction.bookingDate,
        amountCents: transaction.amountCents,
        owner: bankAccount.owner,
        // Used to flag rows added since the last cron / sync — surfaced
        // as a "X new" banner on /today and /inbox.
        createdAt: transaction.createdAt,
      })
      .from(transaction)
      .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
      .where(
        and(
          notExists(
            db
              .select({ one: sql`1` })
              .from(txMatch)
              .where(eq(txMatch.transactionId, transaction.id)),
          ),
          sql`${bankAccount.owner} = ANY (${sql.raw(`ARRAY['${allowed.join("','")}']::account_owner[]`)})`,
        ),
      )
      .orderBy(desc(transaction.bookingDate));

    const visible = rows.filter(
      (r) =>
        !AFRONDING_PATTERN.test(`${r.counterparty ?? ""} ${r.description ?? ""}`),
    );

    // Tag each transaction with the payday-month it belongs to. Also flag
    // rows whose counterparty fingerprint shows up across multiple months
    // — likely a subscription / recurring bill the user can categorize once
    // and remember.
    const recurringSignals = await detectRecurringForUnmatched(
      visible.filter((r) => r.amountCents < 0).map((r) => r.id),
      allowed,
      settings.paydayDay,
    );
    const txns = visible.map((r) => {
      const range = paydayMonthFor(r.bookingDate, settings.paydayDay);
      const sig = recurringSignals.get(r.id);
      return {
        id: r.id,
        counterparty: r.counterparty,
        description: r.description,
        bookingDate: r.bookingDate.toISOString(),
        amountCents: r.amountCents,
        owner: r.owner as "joint" | "yann" | "camila",
        anchorYear: range.anchorYear,
        anchorMonth: range.anchorMonth,
        recurring: sig
          ? { months: sig.months, typicalAbsCents: sig.typicalAbsCents }
          : null,
      };
    });

    // Collect every distinct anchor referenced by the inbox + the current
    // month (so the picker still shows current-month items even when the
    // inbox is empty). Keep current month at the end so it doesn't override
    // older anchor entries.
    const distinctAnchors = new Map<
      string,
      { year: number; month: number }
    >();
    for (const t of txns) {
      const k = anchorKey(t.anchorYear, t.anchorMonth);
      if (!distinctAnchors.has(k))
        distinctAnchors.set(k, { year: t.anchorYear, month: t.anchorMonth });
    }
    const currentRange = paydayMonthFor(new Date(), settings.paydayDay);
    const currentKey = anchorKey(
      currentRange.anchorYear,
      currentRange.anchorMonth,
    );
    if (!distinctAnchors.has(currentKey)) {
      distinctAnchors.set(currentKey, {
        year: currentRange.anchorYear,
        month: currentRange.anchorMonth,
      });
    }

    // Look up which of those anchors have a `month` row (and therefore
    // could possibly have budget items). OR of equality predicates — clean
    // and parameterised; the row-tuple IN form would have required raw SQL.
    const anchorPredicates = [...distinctAnchors.values()].map((a) =>
      and(
        eq(month.anchorYear, a.year),
        eq(month.anchorMonth, a.month),
      ),
    );
    const monthRows =
      anchorPredicates.length === 0
        ? []
        : await db
            .select({
              id: month.id,
              anchorYear: month.anchorYear,
              anchorMonth: month.anchorMonth,
            })
            .from(month)
            .where(or(...anchorPredicates));

    const monthIdByKey = new Map<string, string>();
    for (const m of monthRows) {
      monthIdByKey.set(anchorKey(m.anchorYear, m.anchorMonth), m.id);
    }

    // Fetch all budget items for those months in one query.
    const monthIds = monthRows.map((m) => m.id);
    const allItems =
      monthIds.length === 0
        ? []
        : await db
            .select({
              id: budgetItem.id,
              name: budgetItem.name,
              section: budgetItem.section,
              scope: budgetItem.scope,
              monthId: budgetItem.monthId,
            })
            .from(budgetItem)
            .where(inArray(budgetItem.monthId, monthIds))
            .orderBy(asc(budgetItem.section), asc(budgetItem.name));

    // Group options by anchor, filtered to scopes the caller can see.
    const optionsByAnchor: Record<
      string,
      {
        id: string;
        name: string;
        section: Section;
        scope: "joint" | "yann" | "camila";
      }[]
    > = {};
    for (const m of monthRows) {
      const k = anchorKey(m.anchorYear, m.anchorMonth);
      optionsByAnchor[k] = allItems
        .filter((i) => i.monthId === m.id)
        .filter((i) =>
          allowed.includes(i.scope as "joint" | "yann" | "camila"),
        )
        .map((i) => ({
          id: i.id,
          name: i.name,
          section: i.section as Section,
          scope: i.scope as "joint" | "yann" | "camila",
        }));
    }

    // Months that have inbox transactions but no `month` row at all —
    // these are the ones that need a sheet import.
    const monthsWithoutSheet: { year: number; month: number }[] = [];
    for (const t of txns) {
      const k = anchorKey(t.anchorYear, t.anchorMonth);
      if (!monthIdByKey.has(k)) {
        if (
          !monthsWithoutSheet.some(
            (m) => m.year === t.anchorYear && m.month === t.anchorMonth,
          )
        ) {
          monthsWithoutSheet.push({
            year: t.anchorYear,
            month: t.anchorMonth,
          });
        }
      }
    }

    // Backwards-compatible flat options list — used by older consumers
    // (kept until the bulk picker is moved to per-anchor).
    const optionsAll = Array.from(
      new Map(
        Object.values(optionsByAnchor)
          .flat()
          .map((o) => [o.id, o]),
      ).values(),
    );

    // Count how many of the visible inbox txns landed in the last 36h —
    // covers an overnight 06:00 UTC cron + the user opening the app the
    // morning after. Drives the "X new since last sync" banner.
    const RECENTLY_ADDED_HOURS = 36;
    const recentlyAddedCutoff =
      Date.now() - RECENTLY_ADDED_HOURS * 60 * 60 * 1000;
    const recentlyAddedCount = visible.filter(
      (r) => r.createdAt.getTime() >= recentlyAddedCutoff,
    ).length;

    return {
      txns,
      optionsByAnchor,
      monthsWithoutSheet,
      optionsAll,
      recentlyAddedCount,
    };
  }),

  assign: protectedProcedure
    .input(
      z.object({
        transactionId: z.string().uuid(),
        /**
         * The budget item the user picked from the UI. We treat this as
         * a *template* — its (scope, section, naturalKey) is the
         * intent; the actual `tx_match.budget_item_id` is resolved per-
         * transaction to the item in the transaction's own payday-
         * month. That keeps cross-month assignments accurate when the
         * user is browsing past months on /transactions.
         */
        budgetItemId: z.string().uuid(),
        applyTo: ApplyToInput,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const settings = await getHouseholdSettings();

      const [tx] = await db
        .select()
        .from(transaction)
        .where(eq(transaction.id, input.transactionId));
      if (!tx) throw new Error("Transaction not found.");

      const [tplItem] = await db
        .select()
        .from(budgetItem)
        .where(eq(budgetItem.id, input.budgetItemId));
      if (!tplItem) throw new Error("Budget item not found.");

      const tplKey = {
        scope: tplItem.scope as "joint" | "yann" | "camila",
        section: tplItem.section as Section,
        naturalKey: tplItem.naturalKey,
      };

      const result = await assignTxToTemplate(
        tx,
        tplKey,
        ctx.user.id,
        settings.paydayDay,
      );

      if (input.applyTo === "similar" && tx.counterparty) {
        const fanout = await applySimilarFanout(
          tx,
          tplKey,
          ctx.user.id,
          settings.paydayDay,
        );
        return {
          ok: result.ok,
          assigned: 1 + fanout.assigned,
          skippedNoBudget: (result.skipped ? 1 : 0) + fanout.skippedNoBudget,
        };
      }

      if (input.applyTo === "future" && tx.counterparty) {
        await rememberRule(tx.counterparty, tplItem);
      }

      return {
        ok: result.ok,
        assigned: result.ok ? 1 : 0,
        skippedNoBudget: result.skipped ? 1 : 0,
      };
    }),

  assignMany: protectedProcedure
    .input(
      z.object({
        transactionIds: z.array(z.string().uuid()).min(1).max(200),
        budgetItemId: z.string().uuid(),
        applyTo: ApplyToInput,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const settings = await getHouseholdSettings();
      const [tplItem] = await db
        .select()
        .from(budgetItem)
        .where(eq(budgetItem.id, input.budgetItemId));
      if (!tplItem) throw new Error("Budget item not found.");

      const tplKey = {
        scope: tplItem.scope as "joint" | "yann" | "camila",
        section: tplItem.section as Section,
        naturalKey: tplItem.naturalKey,
      };

      const txns = await db
        .select()
        .from(transaction)
        .where(inArray(transaction.id, input.transactionIds));
      if (txns.length === 0) throw new Error("No transactions.");

      let assigned = 0;
      let skippedNoBudget = 0;
      for (const tx of txns) {
        const r = await assignTxToTemplate(
          tx,
          tplKey,
          ctx.user.id,
          settings.paydayDay,
        );
        if (r.ok) assigned++;
        if (r.skipped) skippedNoBudget++;
      }

      if (input.applyTo === "future") {
        // Pick the most common counterparty across the selection and
        // remember it as a rule. (Bulk-assigning a heterogeneous set
        // doesn't have a "most representative" merchant — the user
        // probably picked them up because they share a bucket, not
        // because they share a name. Best-effort.)
        const counts = new Map<string, number>();
        for (const tx of txns) {
          if (!tx.counterparty) continue;
          counts.set(tx.counterparty, (counts.get(tx.counterparty) ?? 0) + 1);
        }
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (top) await rememberRule(top, tplItem);
      }

      return { ok: true as const, assigned, skippedNoBudget };
    }),
});

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

type TemplateKey = {
  scope: "joint" | "yann" | "camila";
  section: Section;
  naturalKey: string;
};

/**
 * Resolve the budget item to assign a single transaction to (its OWN
 * payday-month, not the user's current view) and write the tx_match.
 * Also bumps confirmed/overridden hits on any matching learned rule.
 *
 * Returns `{ ok: true }` if the txn was assigned, or `{ skipped: true }`
 * if the destination month doesn't have an imported budget yet.
 */
async function assignTxToTemplate(
  tx: typeof transaction.$inferSelect,
  tpl: TemplateKey,
  userId: string,
  paydayDay: number,
): Promise<{ ok: boolean; skipped: boolean }> {
  const range = paydayMonthFor(tx.bookingDate, paydayDay);

  const [m] = await db
    .select({ id: month.id })
    .from(month)
    .where(
      and(
        eq(month.anchorYear, range.anchorYear),
        eq(month.anchorMonth, range.anchorMonth),
      ),
    );
  if (!m) return { ok: false, skipped: true };

  const [target] = await db
    .select()
    .from(budgetItem)
    .where(
      and(
        eq(budgetItem.monthId, m.id),
        eq(budgetItem.scope, tpl.scope),
        eq(budgetItem.section, tpl.section),
        eq(budgetItem.naturalKey, tpl.naturalKey),
      ),
    );
  if (!target) return { ok: false, skipped: true };

  // Punish/reward the rule that picked the prior auto-match, if any.
  const [prior] = await db
    .select({
      source: txMatch.source,
      budgetItemId: txMatch.budgetItemId,
    })
    .from(txMatch)
    .where(eq(txMatch.transactionId, tx.id));
  if (tx.counterparty && prior?.source === "auto-rule") {
    if (prior.budgetItemId !== target.id) {
      await bumpRule(tx.counterparty, "overridden");
    } else {
      await bumpRule(tx.counterparty, "confirmed");
    }
  }

  await db.delete(txMatch).where(eq(txMatch.transactionId, tx.id));
  await db.insert(txMatch).values({
    transactionId: tx.id,
    budgetItemId: target.id,
    allocatedCents: tx.amountCents,
    source: "user",
    confirmedByUserId: userId,
    confirmedAt: new Date(),
  });
  return { ok: true, skipped: false };
}

/**
 * Find every UNMATCHED transaction with the same fingerprint as the
 * source, in the same scope, and assign each to its own payday-month's
 * matching budget item. Skips months that don't have an imported sheet.
 */
async function applySimilarFanout(
  source: typeof transaction.$inferSelect,
  tpl: TemplateKey,
  userId: string,
  paydayDay: number,
): Promise<{ assigned: number; skippedNoBudget: number }> {
  const fp = fingerprintCounterparty(source.counterparty ?? "");
  if (!fp) return { assigned: 0, skippedNoBudget: 0 };

  // Match the same scope as the source so we don't accidentally drag
  // someone else's personal account into a joint category.
  const candidates = await db
    .select({
      id: transaction.id,
      bankAccountId: transaction.bankAccountId,
      bookingDate: transaction.bookingDate,
      valueDate: transaction.valueDate,
      amountCents: transaction.amountCents,
      counterparty: transaction.counterparty,
      description: transaction.description,
      dedupeKey: transaction.dedupeKey,
      status: transaction.status,
      rawPayload: transaction.rawPayload,
      createdAt: transaction.createdAt,
    })
    .from(transaction)
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
    .leftJoin(txMatch, eq(txMatch.transactionId, transaction.id))
    .where(
      and(
        isNull(txMatch.id),
        eq(bankAccount.owner, tpl.scope),
        sql`${transaction.counterparty} ~* ${fp}`,
        // Don't re-process the source — it's handled separately.
        sql`${transaction.id} <> ${source.id}`,
      ),
    );

  let assigned = 0;
  let skippedNoBudget = 0;
  for (const tx of candidates) {
    const r = await assignTxToTemplate(
      tx as typeof transaction.$inferSelect,
      tpl,
      userId,
      paydayDay,
    );
    if (r.ok) assigned++;
    if (r.skipped) skippedNoBudget++;
  }
  return { assigned, skippedNoBudget };
}

/**
 * Find learned rules whose pattern matches the given counterparty in
 * the user's scope and bump confirmedHits / overriddenHits accordingly.
 * Recomputes confidence after each bump.
 */
async function bumpRule(
  counterparty: string,
  kind: "confirmed" | "overridden",
): Promise<void> {
  const text = counterparty.toLowerCase();
  // We don't know the scope a priori — try across all rows. Cheap; the
  // table is tiny in a two-user app.
  const candidates = await db.select().from(matchRule);
  for (const r of candidates) {
    let re: RegExp;
    try {
      re = new RegExp(r.counterpartyPattern, "i");
    } catch {
      continue;
    }
    if (!re.test(text)) continue;
    const confirmed =
      r.confirmedHits + (kind === "confirmed" ? 1 : 0);
    const overridden =
      r.overriddenHits + (kind === "overridden" ? 1 : 0);
    const conf = computeRuleConfidence(confirmed, overridden);
    await db
      .update(matchRule)
      .set({
        confirmedHits: confirmed,
        overriddenHits: overridden,
        confidence: conf.toFixed(3),
        lastUsedAt: new Date(),
      })
      .where(eq(matchRule.id, r.id));
  }
}

function anchorKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

async function rememberRule(
  counterparty: string,
  bi: typeof budgetItem.$inferSelect,
): Promise<void> {
  const pattern = fingerprintCounterparty(counterparty);
  const [existing] = await db
    .select()
    .from(matchRule)
    .where(
      and(
        eq(matchRule.scope, bi.scope),
        eq(matchRule.counterpartyPattern, pattern),
        eq(matchRule.targetSection, bi.section),
        eq(matchRule.targetNaturalKey, bi.naturalKey),
      ),
    );
  if (existing) {
    // Same rule already exists — count this as a confirmation.
    const confirmed = existing.confirmedHits + 1;
    const overridden = existing.overriddenHits;
    await db
      .update(matchRule)
      .set({
        confirmedHits: confirmed,
        confidence: computeRuleConfidence(confirmed, overridden).toFixed(3),
        lastUsedAt: new Date(),
      })
      .where(eq(matchRule.id, existing.id));
    return;
  }
  await db.insert(matchRule).values({
    scope: bi.scope,
    counterpartyPattern: pattern,
    targetSection: bi.section,
    targetNaturalKey: bi.naturalKey,
    confidence: "0.800",
    lastUsedAt: new Date(),
  });
}
