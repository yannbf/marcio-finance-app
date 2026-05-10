import { z } from "zod";
import { and, eq, gte, inArray, lte, notExists, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
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
import {
  daysUntilNextPayday,
  paydayMonthFor,
  paydayMonthForAnchor,
} from "@/lib/payday.ts";
import {
  getMonthlyAggregates,
  totalIncome,
  totalOutflow,
} from "@/lib/budget-aggregates.ts";
import { getUpcomingCharges } from "@/lib/forecast.ts";
import { getSectionsForToday } from "@/lib/today-data.ts";
import { getPersonalChecklist } from "@/lib/personal-checklist.ts";
import { AFRONDING_PG_PATTERN } from "@/lib/matching/seed-rules.ts";

export const todayRouter = router({
  get: publicProcedure
    .input(
      z
        .object({ anchor: AnchorInput, scope: ScopeViewInput })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const settings = await getHouseholdSettings();
      const days = daysUntilNextPayday(new Date(), settings.paydayDay);
      const scopes = resolveVisibleScopes(ctx.allowedScopes, input?.scope);
      const anchor = input?.anchor;

      const [agg, forecast, sectionData, inboxCount, recentlyAddedCount] =
        await Promise.all([
          getMonthlyAggregates(scopes, anchor),
          getUpcomingCharges(scopes, anchor),
          getSectionsForToday(scopes, anchor),
          unmatchedCount(scopes),
          unmatchedCount(scopes, RECENTLY_ADDED_HOURS),
        ]);

      const personalRole =
        scopes.length === 1 && scopes[0] !== "joint" ? scopes[0] : null;
      const personalChecklist = personalRole
        ? await getPersonalChecklist(personalRole, agg.monthId)
        : null;

      // ING round-up sweeps: small "Afronding" transfers from the joint
      // account to Oranje Spaarrekening on every card transaction.
      // Filtered out of every other surface so they don't count as
      // spending; surfaced here as a positive "you're passively saving"
      // chip on the Today screen so the user actually sees the cumulative
      // benefit. Same query the Insights screen uses, scoped to the
      // active payday-month.
      const range = anchor
        ? paydayMonthForAnchor(anchor.year, anchor.month, settings.paydayDay)
        : paydayMonthFor(new Date(), settings.paydayDay);
      const [roundupRow] = await db
        .select({
          sum: sql<string>`COALESCE(SUM(${transaction.amountCents}), 0)`,
          count: sql<string>`COUNT(*)`,
        })
        .from(transaction)
        .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
        .where(
          and(
            inArray(bankAccount.owner, scopes),
            gte(transaction.bookingDate, range.startsOn),
            lte(transaction.bookingDate, range.endsOn),
            sql`(COALESCE(${transaction.counterparty}, '') || ' ' || COALESCE(${transaction.description}, '')) ~* ${AFRONDING_PG_PATTERN}`,
          ),
        );
      const roundupCents = Math.abs(Number.parseInt(roundupRow.sum, 10));
      const roundupCount = Number.parseInt(roundupRow.count, 10);

      // The headline answers different questions per view:
      //
      // - Joint view: "how is the household budget doing?" — the
      //   denominator is total planned outflow on the joint account.
      //
      // - Me view: "how much of my personal expenses budget is
      //   left?" — the denominator is **personal expenses only**, NOT
      //   gross salary, NOT take-home, and crucially NOT the
      //   transfer-to-joint line. Transfers aren't spending; they're
      //   how the household funds joint stuff.
      //
      // Two ways the user's sheet might encode the joint
      // contribution, both supported here:
      //
      //   (a) `contribution_ratio` is set on the personal salary
      //       row. The aggregator already nets ENTRADAS by
      //       (1 - ratio), so gross outflow on the personal scope
      //       contains only real personal expenses.
      //
      //   (b) An explicit "transfer to joint" budget line lives in
      //       one of the personal outflow sections (DIVIDAS, FIXAS,
      //       etc.), with the salary row's ratio left at 0. Then
      //       gross outflow inflates by the transfer amount.
      //
      // Heuristic: when gross outflow > the joint contribution
      // amount, we assume case (b) and subtract the contribution to
      // recover personal expenses. Otherwise we trust gross outflow
      // as already-personal-expenses (case a). Both produce the
      // right number for the headline without requiring the user to
      // touch their sheet.
      const grossPlannedOutflowCents = Math.abs(totalOutflow(agg.planned));
      const spentOutflowCents = Math.abs(totalOutflow(agg.actual));
      const incomeCents = totalIncome(agg.planned);
      const marginCents = incomeCents + totalOutflow(agg.planned);

      let plannedOutflowCents = grossPlannedOutflowCents;
      if (personalRole) {
        const transferOutCents =
          personalChecklist?.contribution?.plannedCents ?? 0;
        if (grossPlannedOutflowCents > transferOutCents) {
          plannedOutflowCents = grossPlannedOutflowCents - transferOutCents;
        }
      }

      const progress =
        plannedOutflowCents > 0 ? spentOutflowCents / plannedOutflowCents : 0;
      const remainingCents = Math.max(
        0,
        plannedOutflowCents - spentOutflowCents,
      );

      return {
        paydayDay: settings.paydayDay,
        daysUntilPayday: days,
        anchor: { year: agg.anchorYear, month: agg.anchorMonth },
        planned: agg.planned,
        actual: agg.actual,
        plannedOutflowCents,
        spentOutflowCents,
        incomeCents,
        marginCents,
        progress,
        remainingCents,
        forecast,
        sectionData,
        inboxCount,
        recentlyAddedCount,
        personalChecklist,
        roundup: { totalCents: roundupCents, count: roundupCount },
      };
    }),
});

/**
 * "Recently added" window for the new-transactions banner. 36 hours
 * comfortably covers an overnight cron run (06:00 UTC) plus the user
 * opening the app the morning after — they see "X new" exactly once
 * before the window slides past.
 */
const RECENTLY_ADDED_HOURS = 36;

async function unmatchedCount(
  scopes: ("joint" | "yann" | "camila")[],
  withinHours?: number,
): Promise<number> {
  // When `withinHours` is set, only count transactions inserted in the
  // recent window — used by the "new since last cron" banner.
  const filters = [
    inArray(bankAccount.owner, scopes),
    notExists(
      db
        .select({ one: sql`1` })
        .from(txMatch)
        .where(eq(txMatch.transactionId, transaction.id)),
    ),
    sql`NOT (${transaction.counterparty} ~* ${AFRONDING_PG_PATTERN})`,
  ];
  if (withinHours) {
    filters.push(
      sql`${transaction.createdAt} > NOW() - (${withinHours} || ' hours')::interval`,
    );
  }
  const [{ n }] = await db
    .select({ n: sql<string>`COUNT(*)` })
    .from(transaction)
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
    .where(and(...filters));
  return Number.parseInt(n, 10);
}
