import { z } from "zod";
import { and, eq, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
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
import { daysUntilNextPayday } from "@/lib/payday.ts";
import {
  getMonthlyAggregates,
  totalIncome,
  totalOutflow,
} from "@/lib/budget-aggregates.ts";
import { getUpcomingCharges } from "@/lib/forecast.ts";
import { getSectionsForToday } from "@/lib/today-data.ts";
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

      const plannedOutflowCents = Math.abs(totalOutflow(agg.planned));
      const spentOutflowCents = Math.abs(totalOutflow(agg.actual));
      const incomeCents = totalIncome(agg.planned);
      const marginCents = incomeCents + totalOutflow(agg.planned);
      const progress =
        plannedOutflowCents > 0 ? spentOutflowCents / plannedOutflowCents : 0;
      const remainingCents = Math.max(
        0,
        plannedOutflowCents - spentOutflowCents,
      );

      // Personal-scope confirmation indicators: did the salary land?
      // did the joint contribution transfer? Two booleans plus the
      // raw amounts so the UI can show "received €5,000" or
      // "expected €5,000" depending on whether the matching txn
      // arrived.
      //
      // Only meaningful when the user is viewing their own scope
      // (yann or camila), where the salary lives in the personal
      // ENTRADAS row and the contribution lives in joint
      // ENTRADAS:contrib-{role}.
      const personalRole =
        scopes.length === 1 && scopes[0] !== "joint" ? scopes[0] : null;
      const personalChecklist = personalRole
        ? await getPersonalChecklist(personalRole, agg.monthId)
        : null;

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

/**
 * Confirmation indicators for the Me view: did this person's salary
 * arrive yet, and did their share of the joint contribution actually
 * transfer? Both are visible in the budget already (yann ENTRADAS
 * salary row, joint ENTRADAS:contrib-yann row), but having a yes/no
 * surface on Today saves a drill-in.
 *
 * Returns null fields when the corresponding budget item doesn't exist
 * for the active month — e.g. the user has a payday-month with no
 * salary line yet.
 */
async function getPersonalChecklist(
  role: "yann" | "camila",
  monthId: string | null,
): Promise<{
  salary: { plannedCents: number; actualCents: number } | null;
  contribution: { plannedCents: number; actualCents: number } | null;
}> {
  if (!monthId) return { salary: null, contribution: null };

  // Personal salary: any ENTRADAS row in the user's own scope with a
  // contribution_ratio set (the marker for "this is the salary line"
  // — it's the only personal ENTRADAS row that has a ratio).
  const [salary] = await db
    .select({
      plannedCents: sql<string>`COALESCE(SUM(${budgetItem.plannedCents}), 0)`,
      actualCents: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
    })
    .from(budgetItem)
    .leftJoin(txMatch, eq(txMatch.budgetItemId, budgetItem.id))
    .where(
      and(
        eq(budgetItem.monthId, monthId),
        eq(budgetItem.scope, role),
        eq(budgetItem.section, "ENTRADAS"),
        isNotNull(budgetItem.contributionRatio),
      ),
    );

  // Joint contribution from this person: ENTRADAS:contrib-{role} on
  // the joint scope. We only consider the canonical natural keys —
  // any custom rename of those rows would need to keep the same key.
  const [contribution] = await db
    .select({
      plannedCents: sql<string>`COALESCE(SUM(${budgetItem.plannedCents}), 0)`,
      actualCents: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
    })
    .from(budgetItem)
    .leftJoin(txMatch, eq(txMatch.budgetItemId, budgetItem.id))
    .where(
      and(
        eq(budgetItem.monthId, monthId),
        eq(budgetItem.scope, "joint"),
        eq(budgetItem.section, "ENTRADAS"),
        eq(budgetItem.naturalKey, `contrib-${role}`),
      ),
    );

  return {
    salary:
      salary && Number.parseInt(salary.plannedCents, 10) !== 0
        ? {
            plannedCents: Number.parseInt(salary.plannedCents, 10),
            actualCents: Number.parseInt(salary.actualCents, 10),
          }
        : null,
    contribution:
      contribution && Number.parseInt(contribution.plannedCents, 10) !== 0
        ? {
            plannedCents: Number.parseInt(contribution.plannedCents, 10),
            actualCents: Number.parseInt(contribution.actualCents, 10),
          }
        : null,
  };
}

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
