/**
 * Aggregations the headline screens (Today, Mês) need on every render:
 *   - Planned amounts per section, summed across the user's visible scopes.
 *   - Actual amounts per section, derived from tx_match → budget_item joins.
 *
 * Both shapes return cents and are signed (negative = outflow).
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { budgetItem, month, txMatch } from "@/db/schema.ts";
import type { Scope, Section } from "./import/types.ts";
import { paydayMonthFor } from "./payday.ts";
import { getHouseholdSettings } from "./settings.ts";

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
): Promise<MonthlyAggregates> {
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
      monthId: null,
      anchorYear: range.anchorYear,
      anchorMonth: range.anchorMonth,
      planned: {},
      actual: {},
    };
  }

  const plannedRows = await db
    .select({
      section: budgetItem.section,
      sum: sql<string>`COALESCE(SUM(${budgetItem.plannedCents}), 0)`,
    })
    .from(budgetItem)
    .where(
      and(
        eq(budgetItem.monthId, monthRow.id),
        inArray(budgetItem.scope, scopes),
      ),
    )
    .groupBy(budgetItem.section);

  const actualRows = await db
    .select({
      section: budgetItem.section,
      sum: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
    })
    .from(txMatch)
    .innerJoin(budgetItem, eq(budgetItem.id, txMatch.budgetItemId))
    .where(
      and(
        eq(budgetItem.monthId, monthRow.id),
        inArray(budgetItem.scope, scopes),
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

/** Sections that count as outflow for the headline "spent" number. */
export const OUTFLOW_SECTIONS: Section[] = [
  "FIXAS",
  "VARIAVEIS",
  "SAZONAIS",
  "DIVIDAS",
];

export function totalOutflow(t: SectionTotals): number {
  let sum = 0;
  for (const s of OUTFLOW_SECTIONS) {
    const v = t[s];
    if (typeof v === "number") sum += v;
  }
  return sum;
}

export function totalIncome(t: SectionTotals): number {
  return t["ENTRADAS"] ?? 0;
}
