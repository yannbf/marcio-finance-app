/**
 * Aggregations the headline screens (Today, Mês) need on every render:
 *   - Planned amounts per section, summed across the user's visible scopes.
 *   - Actual amounts per section, derived from tx_match → budget_item joins.
 *
 * Both shapes return cents and are signed (negative = outflow).
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { budgetItem, month, transaction, txMatch } from "@/db/schema.ts";
import type { Scope, Section } from "./import/types.ts";
import { paydayMonthFor, paydayMonthForAnchor } from "./payday.ts";
import { getHouseholdSettings } from "./settings.ts";
import { monthlyContributionCents } from "./cadence.ts";
import { INTERNAL_TRANSFER_PG_PATTERN } from "./matching/seed-rules.ts";

export type SectionTotals = Partial<Record<Section, number>>;

export type MonthlyAggregates = {
  monthId: string | null;
  anchorYear: number;
  anchorMonth: number;
  planned: SectionTotals;
  actual: SectionTotals;
};

/**
 * Compute planned and actual totals for the current payday-month, scoped
 * to one or more account owners. Returns zeroed totals if no month row
 * exists yet (i.e. nothing has been imported).
 */
export async function getMonthlyAggregates(
  scopes: Scope[],
  anchor?: { year: number; month: number },
): Promise<MonthlyAggregates> {
  const settings = await getHouseholdSettings();
  const range = anchor
    ? paydayMonthForAnchor(anchor.year, anchor.month, settings.paydayDay)
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
    return {
      monthId: null,
      anchorYear: range.anchorYear,
      anchorMonth: range.anchorMonth,
      planned: {},
      actual: {},
    };
  }

  // Sum of planned amounts per section. SAZONAIS items are stored yearly
  // in the sheet; divide them by 12 in SQL so the monthly screens get
  // the right contribution-per-month figure.
  const plannedRows = await db
    .select({
      section: budgetItem.section,
      sum: sql<string>`COALESCE(SUM(
        CASE
          WHEN ${budgetItem.section} = 'SAZONAIS'
            THEN ROUND(${budgetItem.plannedCents}::numeric / 12)
          ELSE ${budgetItem.plannedCents}
        END
      ), 0)`,
    })
    .from(budgetItem)
    .where(
      and(
        eq(budgetItem.monthId, monthRow.id),
        inArray(budgetItem.scope, scopes),
      ),
    )
    .groupBy(budgetItem.section);

  // Movements between Yann/Camila personal accounts and the joint account
  // aren't spending — they're a transfer. Strip them from the actual sum
  // so headline "spent" figures don't conflate moving money with using it.
  // The matching transactions on the joint side land in ENTRADAS (income),
  // which totalOutflow already ignores; on the personal side they would
  // otherwise inflate any outflow section the user assigned them to.
  const actualRows = await db
    .select({
      section: budgetItem.section,
      sum: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
    })
    .from(txMatch)
    .innerJoin(budgetItem, eq(budgetItem.id, txMatch.budgetItemId))
    .innerJoin(transaction, eq(transaction.id, txMatch.transactionId))
    .where(
      and(
        eq(budgetItem.monthId, monthRow.id),
        inArray(budgetItem.scope, scopes),
        sql`NOT (COALESCE(${transaction.counterparty}, '') || ' ' || COALESCE(${transaction.description}, '') ~* ${INTERNAL_TRANSFER_PG_PATTERN})`,
      ),
    )
    .groupBy(budgetItem.section);

  const planned: SectionTotals = {};
  for (const r of plannedRows) {
    planned[r.section as Section] = Number.parseInt(r.sum, 10);
  }
  const actual: SectionTotals = {};
  for (const r of actualRows) {
    actual[r.section as Section] = Number.parseInt(r.sum, 10);
  }

  return {
    monthId: monthRow.id,
    anchorYear: range.anchorYear,
    anchorMonth: range.anchorMonth,
    planned,
    actual,
  };
}

// Re-exported from import/sections for back-compat (db-free constant).
export { OUTFLOW_SECTIONS } from "./import/sections.ts";
export { monthlyContributionCents };

import { OUTFLOW_SECTIONS as _OUTFLOW_SECTIONS } from "./import/sections.ts";

export function totalOutflow(t: SectionTotals): number {
  let sum = 0;
  for (const s of _OUTFLOW_SECTIONS) {
    const v = t[s];
    if (typeof v === "number") sum += v;
  }
  return sum;
}

export function totalIncome(t: SectionTotals): number {
  return t["ENTRADAS"] ?? 0;
}
