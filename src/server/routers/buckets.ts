import { z } from "zod";
import { and, asc, eq, gte, inArray, lte, sql, isNotNull } from "drizzle-orm";
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

    // Year-to-date allocations per savings_account.
    //
    // Aggregates SUM(allocated_cents) across every tx_match → budget_item
    // → savings_account for transactions inside the current CALENDAR year
    // (Jan 1 → Dec 31). Plays well with SAZONAIS items, whose plannedCents
    // is a yearly target — the screen can render
    // ytdActualCents / yearlyTargetCents as a progress bar.
    const calYearStart = new Date(Date.UTC(range.anchorYear, 0, 1));
    const calYearEnd = new Date(
      Date.UTC(range.anchorYear + 1, 0, 1, 0, 0, -1),
    );
    const accountIds = accounts.map((a) => a.id);
    const ytdRows =
      accountIds.length === 0
        ? []
        : await db
            .select({
              savingsAccountId: budgetItem.savingsAccountId,
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
                isNotNull(budgetItem.savingsAccountId),
                inArray(budgetItem.savingsAccountId, accountIds),
                inArray(budgetItem.scope, allowed),
                gte(transaction.bookingDate, calYearStart),
                lte(transaction.bookingDate, calYearEnd),
              ),
            )
            .groupBy(budgetItem.savingsAccountId);
    const ytdByAccount = new Map<string, number>(
      ytdRows
        .filter((r) => r.savingsAccountId !== null)
        .map((r) => [
          r.savingsAccountId as string,
          Math.abs(Number.parseInt(r.sum, 10)),
        ]),
    );

    // Yearly target per account = sum of SAZONAIS plannedCents for items
    // linked to that account in the active month. (SAZONAIS plannedCents
    // is the annual amount, so sum of items = total yearly target.)
    const yearlyTargetByAccount = new Map<string, number>();
    for (const item of items) {
      if (!item.savingsAccountId) continue;
      const prev = yearlyTargetByAccount.get(item.savingsAccountId) ?? 0;
      yearlyTargetByAccount.set(
        item.savingsAccountId,
        prev + Math.abs(item.plannedCents),
      );
    }

    return {
      anchor: { year: range.anchorYear, month: range.anchorMonth },
      accounts: accounts.map((a) => ({
        ...a,
        ytdActualCents: ytdByAccount.get(a.id) ?? 0,
        yearlyTargetCents: yearlyTargetByAccount.get(a.id) ?? 0,
      })),
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
