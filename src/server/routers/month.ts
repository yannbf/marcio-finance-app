import { z } from "zod";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { budgetItem, month, transaction, txMatch } from "@/db/schema.ts";
import { publicProcedure, router } from "../trpc.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { monthlyContributionCents } from "@/lib/cadence.ts";
import type { Section } from "@/lib/import/types.ts";

const ScopeInput = z.enum(["joint", "yann", "camila"]);

export const monthRouter = router({
  /**
   * Month screen payload. Items + match counts for the active scope, plus
   * the active payday-month coordinates so the client can render the header.
   */
  get: publicProcedure
    .input(z.object({ scope: ScopeInput }))
    .query(async ({ ctx, input }) => {
      // Privacy guard: reject scopes the viewer isn't allowed to see.
      if (!ctx.allowedScopes.includes(input.scope)) {
        return { items: [], totals: zeroTotals(), anchor: null };
      }

      const settings = await getHouseholdSettings();
      const range = paydayMonthFor(new Date(), settings.paydayDay);
      const [monthRow] = await db
        .select({ id: month.id })
        .from(month)
        .where(
          and(
            eq(month.anchorYear, range.anchorYear),
            eq(month.anchorMonth, range.anchorMonth),
          ),
        );

      if (!monthRow) {
        return {
          items: [],
          totals: zeroTotals(),
          anchor: { year: range.anchorYear, month: range.anchorMonth },
        };
      }

      const rawItems = await db
        .select()
        .from(budgetItem)
        .where(
          and(
            eq(budgetItem.monthId, monthRow.id),
            eq(budgetItem.scope, input.scope),
          ),
        )
        .orderBy(asc(budgetItem.section), asc(budgetItem.name));

      const matchCounts = rawItems.length
        ? await db
            .select({
              itemId: txMatch.budgetItemId,
              count: sql<string>`COUNT(*)`,
            })
            .from(txMatch)
            .innerJoin(transaction, eq(transaction.id, txMatch.transactionId))
            .where(
              and(
                inArray(
                  txMatch.budgetItemId,
                  rawItems.map((i) => i.id),
                ),
                gte(transaction.bookingDate, range.startsOn),
                lte(transaction.bookingDate, range.endsOn),
              ),
            )
            .groupBy(txMatch.budgetItemId)
        : [];

      const matchByItem = new Map<string, number>(
        matchCounts.map((r) => [r.itemId, Number.parseInt(r.count, 10)]),
      );

      const items = rawItems.map((it) => ({
        id: it.id,
        name: it.name,
        section: it.section as Section,
        plannedCents: monthlyContributionCents(
          it.plannedCents,
          it.section as Section,
        ),
        dueDay: it.dueDay,
        sazonalKind: it.sazonalKind as "O" | "L" | null,
        matchCount: matchByItem.get(it.id) ?? 0,
      }));

      let income = 0;
      let outflow = 0;
      for (const row of items) {
        if (row.section === "ECONOMIAS") continue;
        if (row.plannedCents > 0) income += row.plannedCents;
        else outflow += row.plannedCents;
      }

      return {
        items,
        totals: { income, outflow, margin: income + outflow },
        anchor: { year: range.anchorYear, month: range.anchorMonth },
      };
    }),
});

function zeroTotals() {
  return { income: 0, outflow: 0, margin: 0 };
}
