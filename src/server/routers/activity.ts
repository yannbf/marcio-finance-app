import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  month,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import {
  publicProcedure,
  resolveVisibleScopes,
  router,
} from "../trpc.ts";
import { AnchorInput, ScopeViewInput } from "../inputs.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor, paydayMonthForAnchor } from "@/lib/payday.ts";
import { getUpcomingCharges } from "@/lib/forecast.ts";
import { detectAmountAnomalies } from "@/lib/anomaly.ts";
import {
  getMonthlyAggregates,
  totalOutflow,
} from "@/lib/budget-aggregates.ts";
import { getPersonalChecklist } from "@/lib/personal-checklist.ts";
import {
  AFRONDING_PG_PATTERN,
  isInternalTransferTx,
} from "@/lib/matching/seed-rules.ts";
import type { Section } from "@/lib/import/types.ts";

export const activityRouter = router({
  /**
   * Month-anchored timeline + forecast + sticky summary, plus the current
   * payday-month's budget items so per-row reassign popovers have targets.
   */
  get: publicProcedure
    .input(
      z
        .object({ anchor: AnchorInput, scope: ScopeViewInput })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const settings = await getHouseholdSettings();
      const range = input?.anchor
        ? paydayMonthForAnchor(
            input.anchor.year,
            input.anchor.month,
            settings.paydayDay,
          )
        : paydayMonthFor(new Date(), settings.paydayDay);
      const allowed = resolveVisibleScopes(ctx.allowedScopes, input?.scope);

      const [forecast, txns] = await Promise.all([
        getUpcomingCharges(allowed, input?.anchor),
        db
          .select({
            id: transaction.id,
            counterparty: transaction.counterparty,
            description: transaction.description,
            bookingDate: transaction.bookingDate,
            amountCents: transaction.amountCents,
            matchedItemId: budgetItem.id,
            matchedName: budgetItem.name,
            owner: bankAccount.owner,
          })
          .from(transaction)
          .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
          .leftJoin(txMatch, eq(txMatch.transactionId, transaction.id))
          .leftJoin(budgetItem, eq(budgetItem.id, txMatch.budgetItemId))
          .where(
            and(
              inArray(bankAccount.owner, allowed),
              gte(transaction.bookingDate, range.startsOn),
              lte(transaction.bookingDate, range.endsOn),
              sql`NOT (${transaction.counterparty} ~* ${AFRONDING_PG_PATTERN})`,
            ),
          )
          .orderBy(desc(transaction.bookingDate))
          .limit(200),
      ]);

      const [monthRow] = await db
        .select({ id: month.id })
        .from(month)
        .where(
          and(
            eq(month.anchorYear, range.anchorYear),
            eq(month.anchorMonth, range.anchorMonth),
          ),
        );
      const items = monthRow
        ? await db
            .select({
              id: budgetItem.id,
              name: budgetItem.name,
              section: budgetItem.section,
              scope: budgetItem.scope,
            })
            .from(budgetItem)
            .where(eq(budgetItem.monthId, monthRow.id))
            .orderBy(asc(budgetItem.section), asc(budgetItem.name))
        : [];

      const optionsAll = items
        .filter((i) =>
          allowed.includes(i.scope as "joint" | "yann" | "camila"),
        )
        .map((i) => ({
          id: i.id,
          name: i.name,
          section: i.section as Section,
          scope: i.scope as "joint" | "yann" | "camila",
        }));

      // Sum negative transactions for the "Spent this month" headline,
      // but exclude internal household transfers (yann/camila ↔ joint
      // account). Moving money between household accounts isn't
      // spending — without this filter the personal-scope view
      // counted the joint contribution against personal expenses,
      // double-charging the user. The same pattern guards
      // getMonthlyAggregates' actual sums; we apply it here so the
      // Activity headline matches Today's "Spent so far".
      const monthSpend = txns
        .filter((r) => r.amountCents < 0 && !isInternalTransferTx(r))
        .reduce((s, r) => s + Math.abs(r.amountCents), 0);

      // Planned outflow for the active scope/month — same shape Today
      // uses for its headline progress. We piggyback on the monthly
      // aggregator and apply the personal-scope contribution-line
      // heuristic so the Activity headline can render
      // "spent X / planned Y" alongside a SpendProgress bar without
      // requiring the user to fetch /today first.
      const personalRole =
        allowed.length === 1 && allowed[0] !== "joint" ? allowed[0] : null;
      const [agg, checklist] = await Promise.all([
        getMonthlyAggregates(allowed, input?.anchor),
        personalRole
          ? getPersonalChecklist(
              personalRole,
              monthRow?.id ?? null,
            )
          : Promise.resolve(null),
      ]);
      const grossPlannedOutflowCents = Math.abs(totalOutflow(agg.planned));
      let plannedOutflowCents = grossPlannedOutflowCents;
      if (personalRole) {
        const transferOutCents = checklist?.contribution?.plannedCents ?? 0;
        if (grossPlannedOutflowCents > transferOutCents) {
          plannedOutflowCents = grossPlannedOutflowCents - transferOutCents;
        }
      }

      // Anomaly check — only outflows that already auto-matched to a
      // recurring budget item are candidates.
      const anomalyCandidates = txns
        .filter(
          (r): r is typeof r & { matchedItemId: string } =>
            !!r.matchedItemId && r.amountCents < 0,
        )
        .map((r) => ({
          id: r.id,
          matchedItemId: r.matchedItemId,
          absCents: Math.abs(r.amountCents),
        }));
      const anomalies = await detectAmountAnomalies(
        anomalyCandidates,
        allowed,
        { startsOn: range.startsOn, endsOn: range.endsOn },
      );

      return {
        anchor: { year: range.anchorYear, month: range.anchorMonth },
        txns: txns.map((r) => {
          const a = anomalies.get(r.id);
          return {
            id: r.id,
            counterparty: r.counterparty,
            description: r.description,
            bookingDate: r.bookingDate.toISOString(),
            amountCents: r.amountCents,
            matchedItemId: r.matchedItemId ?? null,
            matchedName: r.matchedName ?? null,
            owner: r.owner as "joint" | "yann" | "camila",
            anomaly: a ? { meanCents: a.meanCents, samples: a.samples } : null,
          };
        }),
        forecast,
        monthSpend,
        plannedOutflowCents,
        optionsAll,
      };
    }),
});
