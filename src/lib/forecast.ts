import { and, eq, gte, inArray, lte, notExists, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  month,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import type { Scope } from "./import/types.ts";
import { paydayMonthFor, paydayMonthForAnchor } from "./payday.ts";
import { getHouseholdSettings } from "./settings.ts";
import { SEED_RULES } from "./matching/seed-rules.ts";

/** How far back to scan raw bank history when inferring a recurring date. */
const COUNTERPARTY_LOOKBACK_DAYS = 180;

export type UpcomingCharge = {
  budgetItemId: string;
  name: string;
  section: string;
  plannedCents: number;
  /** Predicted day-of-month for the charge, when known. */
  predictedDay: number | null;
  /** Source of `predictedDay`:
   *  - "due-day": explicit vencimento on the sheet row.
   *  - "history-median": median day across prior matched transactions for
   *    this same budget line (joined by naturalKey + scope + section).
   *  - "counterparty-history": median day across raw bank transactions whose
   *    counterparty matches a seed rule pointing at this naturalKey. Used
   *    when the budget side has no history yet (e.g. fresh import) but the
   *    bank side already shows a recurring pattern.
   *  - "month-end": last-resort fallback when nothing else is known. */
  source:
    | "due-day"
    | "history-median"
    | "counterparty-history"
    | "month-end";
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

  // For items with no matched history, look for a recurring pattern in raw
  // bank transactions — this lets us predict a real day even on a freshly
  // imported budget where nothing has been auto-matched yet.
  const itemsNeedingCounterpartyHistory = items.filter((it) => {
    if (it.dueDay) return false;
    const hist = histMap.get(`${it.scope}|${it.section}|${it.naturalKey}`);
    return !hist || hist.length === 0;
  });

  const counterpartyHistory = await getCounterpartyHistory(
    itemsNeedingCounterpartyHistory.map((it) => ({
      scope: it.scope,
      section: it.section,
      naturalKey: it.naturalKey,
    })),
    scopes,
    range.endsOn,
  );

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
        const cpDays = counterpartyHistory.get(
          `${it.scope}|${it.section}|${it.naturalKey}`,
        );
        if (cpDays && cpDays.length > 0) {
          predictedDay = median(cpDays);
          source = "counterparty-history";
        } else {
          predictedDay = lastDayOfCalendarMonth(
            range.anchorYear,
            range.anchorMonth,
          );
        }
      }
    }
    // SEPA direct debits scheduled for a Sat/Sun land on the next business
    // day. We only apply this slip when the predicted day comes from the
    // sheet's static dueDay — history-median and counterparty-history are
    // medians of *actual* booking dates, which already encode any slip.
    if (source === "due-day" && predictedDay !== null) {
      predictedDay = shiftPastWeekend(
        range.anchorYear,
        range.anchorMonth,
        predictedDay,
      );
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

/**
 * For each (scope, section, naturalKey) target, return up to ~6 months of
 * day-of-month values pulled from raw bank transactions whose counterparty
 * matches a seed rule pointing at that naturalKey. Costs one transaction
 * scan regardless of how many items need predictions.
 *
 * `cutoffDate` is the end of the active payday-month — we deliberately
 * exclude transactions on/after that date so a half-imported current month
 * doesn't bias the median.
 */
async function getCounterpartyHistory(
  targets: { scope: Scope; section: string; naturalKey: string }[],
  visibleScopes: Scope[],
  cutoffDate: Date,
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (targets.length === 0) return out;

  // Collect rules grouped by (scope|section|naturalKey). Multiple rules can
  // point at the same key (e.g. Vattenfall + Eneco → Eletricidade); any of
  // them firing counts as a hit for the date.
  const rulesByKey = new Map<
    string,
    { pattern: RegExp; min?: number; max?: number }[]
  >();
  for (const t of targets) {
    const key = `${t.scope}|${t.section}|${t.naturalKey}`;
    const matches = SEED_RULES.filter(
      (r) =>
        r.naturalKey === t.naturalKey &&
        r.section === t.section &&
        r.scopes.includes(t.scope),
    ).map((r) => ({
      pattern: r.pattern,
      min: r.minAbsCents,
      max: r.maxAbsCents,
    }));
    if (matches.length > 0) rulesByKey.set(key, matches);
  }
  if (rulesByKey.size === 0) return out;

  const since = new Date(cutoffDate);
  since.setUTCDate(since.getUTCDate() - COUNTERPARTY_LOOKBACK_DAYS);

  const rows = await db
    .select({
      counterparty: transaction.counterparty,
      description: transaction.description,
      bookingDate: transaction.bookingDate,
      amountCents: transaction.amountCents,
    })
    .from(transaction)
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
    .where(
      and(
        inArray(bankAccount.owner, visibleScopes),
        gte(transaction.bookingDate, since),
        lte(transaction.bookingDate, cutoffDate),
        sql`${transaction.amountCents} < 0`,
      ),
    );

  for (const row of rows) {
    const blob = `${row.counterparty ?? ""} ${row.description ?? ""}`;
    const absCents = Math.abs(row.amountCents);
    for (const [key, rules] of rulesByKey) {
      for (const rule of rules) {
        if (rule.min !== undefined && absCents < rule.min) continue;
        if (rule.max !== undefined && absCents > rule.max) continue;
        if (!rule.pattern.test(blob)) continue;
        const arr = out.get(key) ?? [];
        arr.push(row.bookingDate.getUTCDate());
        out.set(key, arr);
        break; // one hit per (row, target) is enough
      }
    }
  }
  return out;
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

/**
 * If the candidate day in the given calendar month falls on Sat (6) or Sun
 * (0), shift forward to the next Monday — capped at end-of-month so we
 * never overshoot. Days that are already weekdays pass through.
 */
function shiftPastWeekend(
  year: number,
  monthVal: number,
  day: number,
): number {
  const last = lastDayOfCalendarMonth(year, monthVal);
  let d = Math.min(day, last);
  while (d <= last) {
    const dow = new Date(Date.UTC(year, monthVal - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) return d;
    d += 1;
  }
  return last;
}
