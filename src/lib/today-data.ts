/**
 * Server-side fetch for the Today screen's drill-down panels.
 * For each section we want: every budget item, its planned amount, actual
 * matched amount this payday-month, and whether it's been paid yet (with
 * a predicted day if not).
 */

import { and, asc, eq, gte, inArray, isNull, lte, notExists, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { budgetItem, month, transaction, txMatch } from "@/db/schema.ts";
import type { Scope, Section } from "./import/types.ts";
import { paydayMonthFor, paydayMonthForAnchor } from "./payday.ts";
import { getHouseholdSettings } from "./settings.ts";
import { monthlyContributionCents } from "./cadence.ts";
import {
  INTERNAL_TRANSFER_PG_PATTERN,
  SAVINGS_TRANSFER_PG_PATTERN,
} from "./matching/seed-rules.ts";

export type SectionItemRow = {
  id: string;
  name: string;
  plannedCents: number;
  actualCents: number;
  /** "paid" when actual ≥ 95% of planned and at least one match exists.
   *  "expected" otherwise. */
  status: "paid" | "expected";
  /** Day-of-month prediction for expected items. */
  predictedDay: number | null;
  dueDay: number | null;
  matchCount: number;
};

export type SectionData = {
  section: Section;
  totalPlannedCents: number;
  totalActualCents: number;
  items: SectionItemRow[];
};

const RECURRING_SECTIONS: Section[] = ["FIXAS", "VARIAVEIS", "SAZONAIS"];

export async function getSectionsForToday(
  scopes: Scope[],
  anchor?: { year: number; month: number },
): Promise<SectionData[]> {
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
    return RECURRING_SECTIONS.map((s) => ({
      section: s,
      totalPlannedCents: 0,
      totalActualCents: 0,
      items: [],
    }));
  }

  const items = await db
    .select({
      id: budgetItem.id,
      name: budgetItem.name,
      section: budgetItem.section,
      naturalKey: budgetItem.naturalKey,
      scope: budgetItem.scope,
      plannedCents: budgetItem.plannedCents,
      dueDay: budgetItem.dueDay,
    })
    .from(budgetItem)
    .where(
      and(
        eq(budgetItem.monthId, monthRow.id),
        inArray(budgetItem.scope, scopes),
        inArray(budgetItem.section, RECURRING_SECTIONS),
      ),
    )
    .orderBy(asc(budgetItem.section), asc(budgetItem.name));

  if (items.length === 0) {
    return RECURRING_SECTIONS.map((s) => ({
      section: s,
      totalPlannedCents: 0,
      totalActualCents: 0,
      items: [],
    }));
  }

  // Sums + counts of matches against this month's items. The budget items
  // are already month-scoped via monthId, so any tx_match pointing at one
  // of them counts as paid — even if the transaction's booking date sits
  // just outside the payday-month window (salary on day 21 for a payday-
  // month that opens on day 25, for example). Internal household transfers
  // are still stripped so per-section drill matches the headline "spent".
  const matchSums = await db
    .select({
      budgetItemId: txMatch.budgetItemId,
      sum: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(txMatch)
    .innerJoin(transaction, eq(transaction.id, txMatch.transactionId))
    .where(
      and(
        inArray(
          txMatch.budgetItemId,
          items.map((i) => i.id),
        ),
        sql`NOT (COALESCE(${transaction.counterparty}, '') || ' ' || COALESCE(${transaction.description}, '') ~* ${INTERNAL_TRANSFER_PG_PATTERN})`,
        sql`NOT (COALESCE(${transaction.counterparty}, '') || ' ' || COALESCE(${transaction.description}, '') ~* ${SAVINGS_TRANSFER_PG_PATTERN})`,
      ),
    )
    .groupBy(txMatch.budgetItemId);

  const sumByItem = new Map(
    matchSums.map((r) => [
      r.budgetItemId,
      { sum: Number.parseInt(r.sum, 10), count: Number.parseInt(r.count, 10) },
    ]),
  );

  // Historical day-of-month medians for unmatched items.
  const history = await db
    .select({
      naturalKey: budgetItem.naturalKey,
      scope: budgetItem.scope,
      section: budgetItem.section,
      bookingDate: transaction.bookingDate,
    })
    .from(txMatch)
    .innerJoin(transaction, eq(transaction.id, txMatch.transactionId))
    .innerJoin(budgetItem, eq(budgetItem.id, txMatch.budgetItemId))
    .where(
      and(
        eq(budgetItem.monthId, monthRow.id) === undefined ? sql`TRUE` : sql`${budgetItem.monthId} != ${monthRow.id}`,
      ),
    );

  const histMap = new Map<string, number[]>();
  for (const h of history) {
    const k = `${h.scope}|${h.section}|${h.naturalKey}`;
    const arr = histMap.get(k) ?? [];
    arr.push(h.bookingDate.getUTCDate());
    histMap.set(k, arr);
  }

  const lastDay = lastDayOfMonth(range.anchorYear, range.anchorMonth);

  // Group into sections.
  const grouped = new Map<Section, SectionItemRow[]>();
  for (const it of items) {
    const sec = it.section as Section;
    const cur = grouped.get(sec) ?? [];
    const matched = sumByItem.get(it.id);
    const matchCount = matched?.count ?? 0;
    const actualCents = matched?.sum ?? 0;
    // Any matched transaction means this line was hit this month — partial
    // coverage is still "paid" from the user's perspective. The percentage
    // strip below the row shows how close it is to plan.
    const isPaid = matchCount > 0;

    let predictedDay: number | null = null;
    if (!isPaid) {
      if (it.dueDay) predictedDay = it.dueDay;
      else {
        const hist = histMap.get(
          `${it.scope}|${it.section}|${it.naturalKey}`,
        );
        if (hist && hist.length > 0) predictedDay = median(hist);
        else predictedDay = lastDay;
      }
    }

    cur.push({
      id: it.id,
      name: it.name,
      plannedCents: monthlyContributionCents(it.plannedCents, sec),
      actualCents,
      status: isPaid ? "paid" : "expected",
      predictedDay,
      dueDay: it.dueDay,
      matchCount,
    });
    grouped.set(sec, cur);
  }

  return RECURRING_SECTIONS.map((s) => {
    const list = grouped.get(s) ?? [];
    return {
      section: s,
      totalPlannedCents: list.reduce(
        (sum, r) => sum + Math.abs(r.plannedCents),
        0,
      ),
      totalActualCents: list.reduce(
        (sum, r) => sum + Math.abs(r.actualCents),
        0,
      ),
      items: list.sort((a, b) => {
        // Paid first, then by predicted day, then by name.
        if (a.status !== b.status) return a.status === "paid" ? -1 : 1;
        const ad = a.predictedDay ?? 99;
        const bd = b.predictedDay ?? 99;
        if (ad !== bd) return ad - bd;
        return a.name.localeCompare(b.name);
      }),
    };
  });
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function lastDayOfMonth(year: number, monthVal: number): number {
  return new Date(year, monthVal, 0).getDate();
}
