import { z } from "zod";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  month,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { publicProcedure, router } from "../trpc.ts";
import { AnchorInput } from "../inputs.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor, paydayMonthForAnchor } from "@/lib/payday.ts";
import { monthlyContributionCents } from "@/lib/cadence.ts";
import type { Section } from "@/lib/import/types.ts";

const ScopeInput = z.enum(["joint", "yann", "camila"]);

export const monthRouter = router({
  /**
   * Distinct payday-month anchors that have an imported sheet, used by the
   * MonthScopeBar picker to dim months not worth navigating to.
   */
  knownAnchors: publicProcedure.query(async () => {
    const rows = await db
      .select({ year: month.anchorYear, m: month.anchorMonth })
      .from(month)
      .orderBy(asc(month.anchorYear), asc(month.anchorMonth));
    return {
      anchors: rows.map((r) => ({ year: r.year, month: r.m })),
    };
  }),

  /**
   * Month screen payload. Items + match counts for the active scope, plus
   * the active payday-month coordinates so the client can render the header.
   */
  get: publicProcedure
    .input(z.object({ scope: ScopeInput, anchor: AnchorInput }))
    .query(async ({ ctx, input }) => {
      // Privacy guard: reject scopes the viewer isn't allowed to see.
      if (!ctx.allowedScopes.includes(input.scope)) {
        return { items: [], totals: zeroTotals(), anchor: null };
      }

      const settings = await getHouseholdSettings();
      const range = input.anchor
        ? paydayMonthForAnchor(
            input.anchor.year,
            input.anchor.month,
            settings.paydayDay,
          )
        : paydayMonthFor(new Date(), settings.paydayDay);
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
        // No sheet imported for this anchor. If transactions DO exist for
        // the date range though, surface the count so the UI can prompt
        // for an import — silent empty state was wasteful with 90 days
        // of synced history sitting around uncategorized.
        const [{ n }] = await db
          .select({ n: sql<string>`COUNT(*)` })
          .from(transaction)
          .innerJoin(
            bankAccount,
            eq(bankAccount.id, transaction.bankAccountId),
          )
          .where(
            and(
              gte(transaction.bookingDate, range.startsOn),
              lte(transaction.bookingDate, range.endsOn),
              eq(bankAccount.owner, input.scope),
            ),
          );
        const orphanTxCount = Number.parseInt(n, 10);
        return {
          items: [],
          totals: zeroTotals(),
          anchor: { year: range.anchorYear, month: range.anchorMonth },
          needsImport: true as const,
          orphanTxCount,
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

      // Count any tx_match pointing at one of this month's budget items.
      // Don't filter by transaction.bookingDate — the budget item is
      // already month-scoped via monthId, and the user may legitimately
      // assign a transaction whose booking date sits just outside the
      // payday-month window (e.g. salary paid 21 Apr against May's
      // "Salário Yann" line, since payday-month opens 25 Apr).
      const matchCounts = rawItems.length
        ? await db
            .select({
              itemId: txMatch.budgetItemId,
              count: sql<string>`COUNT(*)`,
            })
            .from(txMatch)
            .where(
              inArray(
                txMatch.budgetItemId,
                rawItems.map((i) => i.id),
              ),
            )
            .groupBy(txMatch.budgetItemId)
        : [];

      const matchByItem = new Map<string, number>(
        matchCounts.map((r) => [r.itemId, Number.parseInt(r.count, 10)]),
      );

      // Per-item planned amounts pass through at their full sheet
      // value (only SAZONAIS yearly → monthly division applies).
      // Income rows show gross salary, outflow rows show whatever
      // the user has in their sheet — the user wants to see those
      // numbers as-typed, even when a transfer-to-joint line is in
      // outflow. Headline-level math (Today's "of €Y planned"
      // denominator) handles the transfer-vs-personal-expenses
      // distinction without rewriting the per-item display.
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
        needsImport: false as const,
        orphanTxCount: 0,
      };
    }),
});

function zeroTotals() {
  return { income: 0, outflow: 0, margin: 0 };
}
