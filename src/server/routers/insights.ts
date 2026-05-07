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
import {
  paydayMonthFor,
  paydayMonthForAnchor,
  shiftAnchor,
} from "@/lib/payday.ts";
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

      // ING round-up: small "Afronding" sweeps from the joint account to
      // Oranje spaarrekening on every card transaction. Filtered out of
      // Inbox/Insights breakdowns; surfaced here as its own line so the
      // user sees the cumulative passive-savings effect.
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

      // Comparison vs the previous payday-month — used by the "vs last
      // month" delta chip on the insights screen. Only meaningful once the
      // user has more than one month of imported data; the screen treats
      // a missing previous month as "no comparison available".
      const prevAnchor = shiftAnchor(
        agg.anchorYear,
        agg.anchorMonth,
        -1,
      );
      const prevAgg = await getMonthlyAggregates(scopes, prevAnchor);
      const prevTotalOutCents = Math.abs(totalOutflow(prevAgg.actual));
      const prevRange = paydayMonthForAnchor(
        prevAnchor.year,
        prevAnchor.month,
        settings.paydayDay,
      );
      // Has any data been imported for the prior payday-month? If not we
      // skip the per-category / per-merchant delta queries entirely — they
      // would just return empty rows.
      const hasPrev = prevAgg.monthId !== null || prevTotalOutCents > 0;

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

      // Previous-month per-merchant / per-category (joined by stable keys —
      // counterparty for merchants, naturalKey for categories) so the
      // screen can render a delta chip next to each row.
      const [prevMerchantSums, prevCategorySums] = hasPrev
        ? await Promise.all([
            db
              .select({
                counterparty: transaction.counterparty,
                sum: sql<string>`COALESCE(SUM(${transaction.amountCents}), 0)`,
              })
              .from(transaction)
              .innerJoin(
                bankAccount,
                eq(bankAccount.id, transaction.bankAccountId),
              )
              .where(
                and(
                  inArray(bankAccount.owner, scopes),
                  gte(transaction.bookingDate, prevRange.startsOn),
                  lte(transaction.bookingDate, prevRange.endsOn),
                  sql`${transaction.amountCents} < 0`,
                  sql`NOT (${transaction.counterparty} ~* ${AFRONDING_PG_PATTERN})`,
                  sql`NOT (COALESCE(${transaction.counterparty}, '') || ' ' || COALESCE(${transaction.description}, '') ~* ${INTERNAL_TRANSFER_PG_PATTERN})`,
                ),
              )
              .groupBy(transaction.counterparty),
            db
              .select({
                naturalKey: budgetItem.naturalKey,
                sum: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
              })
              .from(txMatch)
              .innerJoin(
                budgetItem,
                eq(budgetItem.id, txMatch.budgetItemId),
              )
              .innerJoin(
                transaction,
                eq(transaction.id, txMatch.transactionId),
              )
              .where(
                and(
                  inArray(budgetItem.scope, scopes),
                  gte(transaction.bookingDate, prevRange.startsOn),
                  lte(transaction.bookingDate, prevRange.endsOn),
                  sql`${txMatch.allocatedCents} < 0`,
                  sql`NOT (COALESCE(${transaction.counterparty}, '') || ' ' || COALESCE(${transaction.description}, '') ~* ${INTERNAL_TRANSFER_PG_PATTERN})`,
                ),
              )
              .groupBy(budgetItem.naturalKey),
          ])
        : [[], []];

      // Resolve naturalKey for the current top categories so the client can
      // join against prevCategorySums.
      const currentItemIds = topCategories.map((c) => c.itemId);
      const naturalKeys =
        currentItemIds.length === 0
          ? []
          : await db
              .select({
                id: budgetItem.id,
                naturalKey: budgetItem.naturalKey,
              })
              .from(budgetItem)
              .where(inArray(budgetItem.id, currentItemIds));
      const naturalKeyByItemId = new Map(
        naturalKeys.map((n) => [n.id, n.naturalKey]),
      );

      const prevMerchantMap: Record<string, string> = {};
      for (const m of prevMerchantSums) {
        if (m.counterparty) prevMerchantMap[m.counterparty] = m.sum;
      }
      const prevCategoryMap: Record<string, string> = {};
      for (const c of prevCategorySums) {
        prevCategoryMap[c.naturalKey] = c.sum;
      }

      return {
        anchor: { year: agg.anchorYear, month: agg.anchorMonth },
        totalOutCents,
        planned: agg.planned,
        actual: agg.actual,
        roundup: { totalCents: roundupCents, count: roundupCount },
        previous: {
          anchor: prevAnchor,
          totalOutCents: prevTotalOutCents,
          actual: prevAgg.actual,
          available: hasPrev,
          merchantSums: prevMerchantMap,
          categorySumsByNaturalKey: prevCategoryMap,
        },
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
          naturalKey: naturalKeyByItemId.get(c.itemId) ?? null,
        })),
      };
    }),
});
