import { z } from "zod";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
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
import { paydayMonthFor, paydayMonthForAnchor } from "@/lib/payday.ts";
import {
  getMonthlyAggregates,
  totalOutflow,
} from "@/lib/budget-aggregates.ts";
import {
  AFRONDING_PG_PATTERN,
  INTERNAL_TRANSFER_PG_PATTERN,
} from "@/lib/matching/seed-rules.ts";

export const insightsRouter = router({
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
      const scopes = resolveVisibleScopes(ctx.allowedScopes, input?.scope);

      const agg = await getMonthlyAggregates(scopes, input?.anchor);
      const totalOutCents = Math.abs(totalOutflow(agg.actual));

      const topMerchants = await db
        .select({
          counterparty: transaction.counterparty,
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
            sql`${transaction.amountCents} < 0`,
            sql`NOT (${transaction.counterparty} ~* ${AFRONDING_PG_PATTERN})`,
            sql`NOT (COALESCE(${transaction.counterparty}, '') || ' ' || COALESCE(${transaction.description}, '') ~* ${INTERNAL_TRANSFER_PG_PATTERN})`,
          ),
        )
        .groupBy(transaction.counterparty)
        .orderBy(asc(sql`SUM(${transaction.amountCents})`))
        .limit(10);

      const topCategories = await db
        .select({
          itemId: budgetItem.id,
          name: budgetItem.name,
          section: budgetItem.section,
          sum: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
        })
        .from(txMatch)
        .innerJoin(budgetItem, eq(budgetItem.id, txMatch.budgetItemId))
        .innerJoin(transaction, eq(transaction.id, txMatch.transactionId))
        .where(
          and(
            inArray(budgetItem.scope, scopes),
            gte(transaction.bookingDate, range.startsOn),
            lte(transaction.bookingDate, range.endsOn),
            sql`${txMatch.allocatedCents} < 0`,
            sql`NOT (COALESCE(${transaction.counterparty}, '') || ' ' || COALESCE(${transaction.description}, '') ~* ${INTERNAL_TRANSFER_PG_PATTERN})`,
          ),
        )
        .groupBy(budgetItem.id, budgetItem.name, budgetItem.section)
        .orderBy(asc(sql`SUM(${txMatch.allocatedCents})`))
        .limit(10);

      return {
        anchor: { year: agg.anchorYear, month: agg.anchorMonth },
        totalOutCents,
        planned: agg.planned,
        actual: agg.actual,
        topMerchants: topMerchants.map((m) => ({
          counterparty: m.counterparty,
          sum: m.sum,
          count: m.count,
        })),
        topCategories: topCategories.map((c) => ({
          itemId: c.itemId,
          name: c.name,
          section: c.section,
          sum: c.sum,
        })),
      };
    }),
});
