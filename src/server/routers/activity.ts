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
  categorizeTxWithOverrides,
  type Category,
} from "@/lib/categorization.ts";
import { categoryOverride } from "@/db/schema.ts";
import {
  getMonthlyAggregates,
  totalOutflow,
} from "@/lib/budget-aggregates.ts";
import { getPersonalChecklist } from "@/lib/personal-checklist.ts";
import {
  AFRONDING_PG_PATTERN,
  isInternalTransferTx,
  isSavingsTransferTx,
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
        .filter(
          (r) =>
            r.amountCents < 0 &&
            !isInternalTransferTx(r) &&
            !isSavingsTransferTx(r),
        )
        .reduce((s, r) => s + Math.abs(r.amountCents), 0);

      // Planned outflow for the active scope — same shape Today uses
      // for its headline progress, computed in one place. The personal
      // scope subtracts the joint-contribution row when present so
      // "spent of planned" reflects personal expenses only.
      const personalRole =
        allowed.length === 1 && allowed[0] !== "joint" ? allowed[0] : null;
      const agg = await getMonthlyAggregates(allowed, input?.anchor);
      const checklist = personalRole
        ? await getPersonalChecklist(personalRole, agg.monthId)
        : null;
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

      // Per-merchant category overrides so each row's `category` field
      // reflects the user's pinned choice when one exists. A single
      // SELECT covers every override; the categorizer keys them by
      // counterparty fingerprint.
      const overrideRows = await db
        .select({
          fingerprint: categoryOverride.fingerprint,
          category: categoryOverride.category,
        })
        .from(categoryOverride);
      const overrides = new Map<string, Category>(
        overrideRows.map((o) => [o.fingerprint, o.category as Category]),
      );

      return {
        anchor: { year: range.anchorYear, month: range.anchorMonth },
        // Inclusive payday-month range (April 25 → May 24 for "May 2026"
        // when paydayDay = 25). Surfaced so client screens can show the
        // start/end dates inline without recomputing — e.g. Look Back's
        // footer reads "From {startsOn} until {current row date}".
        rangeStartsOn: range.startsOn.toISOString(),
        rangeEndsOn: range.endsOn.toISOString(),
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
            category: categorizeTxWithOverrides(
              { counterparty: r.counterparty, description: r.description },
              overrides,
            ),
          };
        }),
        forecast,
        monthSpend,
        plannedOutflowCents,
        optionsAll,
      };
    }),
});
