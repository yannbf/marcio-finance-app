import { and, asc, eq, gte, inArray, isNull, lte, notExists, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  budgetItem,
  month,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import type { Scope } from "./import/types.ts";
import { paydayMonthFor, paydayMonthForAnchor } from "./payday.ts";
import { getHouseholdSettings } from "./settings.ts";

export type UpcomingCharge = {
  budgetItemId: string;
  name: string;
  section: string;
  plannedCents: number;
  /** Predicted day-of-month for the charge, when known. */
  predictedDay: number | null;
  /** "due-day" when from the sheet's vencimento, "history-median" when learned
   * from past matches, "month-end" when neither is known. */
  source: "due-day" | "history-median" | "month-end";
};

/**
 * Predict charges that haven't hit yet for the current payday-month.
 *
 * For each FIXAS / DIVIDAS budget item that has no matched transaction in the
 * payday-month range, we predict a charge:
 *   1. If the item carries an explicit dueDay from the sheet, use it.
 *   2. Otherwise, look at historical matches across prior months and take
 *      the median day-of-month.
 *   3. Otherwise, fall back to the last day of the calendar anchor month.
 */
export async function getUpcomingCharges(
  scopes: Scope[],
  anchor?: { year: number; month: number },
): Promise<{ charges: UpcomingCharge[]; totalRemainingCents: number }> {
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
  if (!monthRow) return { charges: [], totalRemainingCents: 0 };

  // Recurring outflow lines that haven't been matched in this payday-month.
  const items = await db
    .select({
      id: budgetItem.id,
      name: budgetItem.name,
      section: budgetItem.section,
      plannedCents: budgetItem.plannedCents,
      naturalKey: budgetItem.naturalKey,
      scope: budgetItem.scope,
      dueDay: budgetItem.dueDay,
    })
    .from(budgetItem)
    .where(
      and(
        eq(budgetItem.monthId, monthRow.id),
        inArray(budgetItem.scope, scopes),
        inArray(budgetItem.section, ["FIXAS", "DIVIDAS"]),
        sql`${budgetItem.plannedCents} < 0`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(txMatch)
            .innerJoin(
              transaction,
              eq(transaction.id, txMatch.transactionId),
            )
            .where(
              and(
                eq(txMatch.budgetItemId, budgetItem.id),
                gte(transaction.bookingDate, range.startsOn),
                lte(transaction.bookingDate, range.endsOn),
              ),
            ),
        ),
      ),
    );

  if (items.length === 0) {
    return { charges: [], totalRemainingCents: 0 };
  }

  // Pull historical match dates so we can take a median day-of-month per
  // budget line (joining across months by naturalKey + scope + section).
  const itemKeys = items.map((i) => i.id);
  const history = await db
    .select({
      itemNaturalKey: budgetItem.naturalKey,
      itemScope: budgetItem.scope,
      itemSection: budgetItem.section,
      bookingDate: transaction.bookingDate,
    })
    .from(txMatch)
    .innerJoin(transaction, eq(transaction.id, txMatch.transactionId))
    .innerJoin(budgetItem, eq(budgetItem.id, txMatch.budgetItemId))
    .where(
      sql`${budgetItem.id} NOT IN (${sql.join(
        itemKeys.map((k) => sql`${k}`),
        sql`, `,
      )})`,
    );

  // Aggregate historical days per (scope, section, naturalKey).
  const histMap = new Map<string, number[]>();
  for (const h of history) {
    const k = `${h.itemScope}|${h.itemSection}|${h.itemNaturalKey}`;
    const arr = histMap.get(k) ?? [];
    arr.push(h.bookingDate.getUTCDate());
    histMap.set(k, arr);
  }

  const charges: UpcomingCharge[] = items.map((it) => {
    let predictedDay: number | null = null;
    let source: UpcomingCharge["source"] = "month-end";
    if (it.dueDay) {
      predictedDay = it.dueDay;
      source = "due-day";
    } else {
      const hist = histMap.get(`${it.scope}|${it.section}|${it.naturalKey}`);
      if (hist && hist.length > 0) {
        predictedDay = median(hist);
        source = "history-median";
      } else {
        predictedDay = lastDayOfCalendarMonth(
          range.anchorYear,
          range.anchorMonth,
        );
      }
    }
    return {
      budgetItemId: it.id,
      name: it.name,
      section: it.section,
      plannedCents: it.plannedCents,
      predictedDay,
      source,
    };
  });

  // Order: ascending predicted day, with month-end last.
  charges.sort((a, b) => {
    const da = a.predictedDay ?? 99;
    const db = b.predictedDay ?? 99;
    return da - db;
  });

  const totalRemainingCents = charges.reduce(
    (s, c) => s + Math.abs(c.plannedCents),
    0,
  );
  return { charges, totalRemainingCents };
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function lastDayOfCalendarMonth(year: number, monthVal: number): number {
  return new Date(year, monthVal, 0).getDate();
}
