import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { bankAccount, transaction, txMatch } from "@/db/schema.ts";
import { publicProcedure, router } from "../trpc.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { daysUntilNextPayday } from "@/lib/payday.ts";
import {
  getMonthlyAggregates,
  totalIncome,
  totalOutflow,
} from "@/lib/budget-aggregates.ts";
import { getUpcomingCharges } from "@/lib/forecast.ts";
import { getSectionsForToday } from "@/lib/today-data.ts";
import { AFRONDING_PATTERN } from "@/lib/matching/seed-rules.ts";

export const todayRouter = router({
  /**
   * Headline numbers, forecast, sections, inbox count, days-until-payday.
   * Composite query — every Today screen field comes from this single call,
   * so the client side only needs one cached entry.
   */
  get: publicProcedure.query(async ({ ctx }) => {
    const settings = await getHouseholdSettings();
    const days = daysUntilNextPayday(new Date(), settings.paydayDay);
    const scopes = ctx.allowedScopes;

    const [agg, forecast, sectionData, inboxCount] = await Promise.all([
      getMonthlyAggregates(scopes),
      getUpcomingCharges(scopes),
      getSectionsForToday(scopes),
      unmatchedCount(scopes),
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
    };
  }),
});

async function unmatchedCount(
  scopes: ("joint" | "yann" | "camila")[],
): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<string>`COUNT(*)` })
    .from(transaction)
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
    .where(
      and(
        inArray(bankAccount.owner, scopes),
        notExists(
          db
            .select({ one: sql`1` })
            .from(txMatch)
            .where(eq(txMatch.transactionId, transaction.id)),
        ),
        sql`NOT (${transaction.counterparty} ~* ${AFRONDING_PATTERN.source})`,
      ),
    );
  return Number.parseInt(n, 10);
}
