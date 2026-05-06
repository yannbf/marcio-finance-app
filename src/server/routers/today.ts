import { z } from "zod";
import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { bankAccount, transaction, txMatch } from "@/db/schema.ts";
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

      const [agg, forecast, sectionData, inboxCount] = await Promise.all([
        getMonthlyAggregates(scopes, anchor),
        getUpcomingCharges(scopes, anchor),
        getSectionsForToday(scopes, anchor),
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
        sql`NOT (${transaction.counterparty} ~* ${AFRONDING_PG_PATTERN})`,
      ),
    );
  return Number.parseInt(n, 10);
}
