import { z } from "zod";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  budgetItem,
  month,
  savingsAccount,
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
import { monthlyContributionCents } from "@/lib/cadence.ts";

export const bucketsRouter = router({
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

    const [monthRow] = await db
      .select()
      .from(month)
      .where(
        and(
          eq(month.anchorYear, range.anchorYear),
          eq(month.anchorMonth, range.anchorMonth),
        ),
      );

    const accounts = await db
      .select()
      .from(savingsAccount)
      .where(inArray(savingsAccount.owner, allowed))
      .orderBy(asc(savingsAccount.owner), asc(savingsAccount.nickname));

    const items = monthRow
      ? await db
          .select({
            id: budgetItem.id,
            name: budgetItem.name,
            scope: budgetItem.scope,
            plannedCents: budgetItem.plannedCents,
            sazonalKind: budgetItem.sazonalKind,
            savingsAccountId: budgetItem.savingsAccountId,
          })
          .from(budgetItem)
          .where(
            and(
              eq(budgetItem.monthId, monthRow.id),
              eq(budgetItem.section, "SAZONAIS"),
              inArray(budgetItem.scope, allowed),
            ),
          )
          .orderBy(asc(budgetItem.name))
      : [];

    const sums = items.length
      ? await db
          .select({
            itemId: txMatch.budgetItemId,
            sum: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
          })
          .from(txMatch)
          .innerJoin(transaction, eq(transaction.id, txMatch.transactionId))
          .where(
            and(
              inArray(
                txMatch.budgetItemId,
                items.map((i) => i.id),
              ),
              gte(transaction.bookingDate, range.startsOn),
              lte(transaction.bookingDate, range.endsOn),
            ),
          )
          .groupBy(txMatch.budgetItemId)
      : [];

    const sumByItem = new Map<string, number>(
      sums.map((s) => [s.itemId, Number.parseInt(s.sum, 10)]),
    );

    return {
      anchor: { year: range.anchorYear, month: range.anchorMonth },
      accounts,
      items: items.map((i) => ({
        ...i,
        plannedMonthlyCents: monthlyContributionCents(
          i.plannedCents,
          "SAZONAIS",
        ),
        actualCents: sumByItem.get(i.id) ?? 0,
      })),
    };
  }),
});
