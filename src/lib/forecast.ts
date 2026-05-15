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
  /**
   * Concrete predicted date (ISO) inside the active payday-month window.
   * Materialized from `predictedDay` + the payday anchor so the consumer
   * doesn't have to guess whether day "28" means April 28 or May 28 — for
   * the May 2026 payday-month with paydayDay=25 that's April 28, full stop.
   */
  predictedDate: string;
  /** Source of `predictedDay`:
   *  - "due-day": explicit vencimento on the sheet row.
   *  - "payday": joint-contribution sweep that happens on the household's
   *    configured payday by convention, not via a sheet vencimento.
   *  - "history-median": median day across prior matched transactions for
   *    this same budget line (joined by naturalKey + scope + section).
   *  - "counterparty-history": median day across raw bank transactions whose
   *    counterparty matches a seed rule pointing at this naturalKey. Used
   *    when the budget side has no history yet (e.g. fresh import) but the
   *    bank side already shows a recurring pattern.
   *  - "month-end": last-resort fallback when nothing else is known. */
  source:
    | "due-day"
    | "payday"
    | "history-median"
    | "counterparty-history"
    | "month-end";
};

/**
 * Map a day-of-month (1..31) to a concrete date inside the active
 * payday-month window. A day < paydayDay belongs in the second half of
 * the window (the anchor's own calendar month). A day >= paydayDay
 * belongs in the first half (the previous calendar month). Clamps to
 * the last real day of the target calendar month (April has no day 31).
 */
function materializeForecastDate(
  predictedDay: number,
  paydayDay: number,
  anchorYear: number,
  anchorMonth: number, // 1..12
): Date {
  const useAnchorMonth = predictedDay < paydayDay;
  const calMonth0 = useAnchorMonth ? anchorMonth - 1 : anchorMonth - 2;
  // Date.UTC(year, monthIndex+1, 0) returns the last day of monthIndex;
  // works even when calMonth0 is -1 (December of the prior year). Building
  // in UTC keeps the day-of-month stable regardless of where the server
  // (or the client) lives — otherwise a CEST server emits `…T22:00:00Z`
  // and the browser's `getUTCDate()` ticks one day backward.
  const lastDay = new Date(Date.UTC(anchorYear, calMonth0 + 1, 0)).getUTCDate();
  const day = Math.min(predictedDay, lastDay);
  return new Date(Date.UTC(anchorYear, calMonth0, day));
}

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
): Promise<{
  charges: UpcomingCharge[];
  totalRemainingCents: number;
  paidRecurring: {
    /** Count of FIXAS+DIVIDAS budget items with at least one match. */
    itemCount: number;
    /** Cumulative allocated amount across those matches (absolute cents). */
    paidCents: number;
    /** Sum of planned cents for the matched items (absolute). */
    plannedCents: number;
  };
}> {
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
      charges: [],
      totalRemainingCents: 0,
      paidRecurring: { itemCount: 0, paidCents: 0, plannedCents: 0 },
    };
  }

  // Symmetric pair to the "still to pay" list — recurring outflow lines
  // (FIXAS + DIVIDAS) that DO have at least one matched transaction in
  // the active payday-month, with the cumulative paid amount. Lets the
  // UI render "já pago N itens · €X" next to "a pagar ainda M itens · €Y"
  // so the user sees both halves of the recurring picture instead of
  // only the one that's still outstanding.
  const paidRows = await db
    .select({
      itemId: budgetItem.id,
      plannedCents: budgetItem.plannedCents,
      paidCents: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
    })
    .from(budgetItem)
    .innerJoin(txMatch, eq(txMatch.budgetItemId, budgetItem.id))
    .where(
      and(
        eq(budgetItem.monthId, monthRow.id),
        inArray(budgetItem.scope, scopes),
        inArray(budgetItem.section, ["FIXAS", "DIVIDAS"]),
        sql`${budgetItem.plannedCents} < 0`,
      ),
    )
    .groupBy(budgetItem.id);
  const paidRecurring = {
    itemCount: paidRows.length,
    paidCents: paidRows.reduce(
      (s, r) => s + Math.abs(Number.parseInt(r.paidCents, 10)),
      0,
    ),
    plannedCents: paidRows.reduce(
      (s, r) => s + Math.abs(r.plannedCents),
      0,
    ),
  };

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
        // An item is "still to pay" only if no tx_match exists at all for
        // it. The booking date isn't checked — the budget item is already
        // month-scoped via monthId, so any match is "for this month" by
        // definition (and the user may legitimately have assigned a tx
        // booked just outside the payday-month window).
        notExists(
          db
            .select({ one: sql`1` })
            .from(txMatch)
            .where(eq(txMatch.budgetItemId, budgetItem.id)),
        ),
      ),
    );

  if (items.length === 0) {
    return { charges: [], totalRemainingCents: 0, paidRecurring };
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

  // Day-of-month for the back edge of the active payday-window. The
  // "month-end" fallback lands here (paydayDay-1 of the anchor's own
  // calendar month — e.g. May 24 for paydayDay=25), not the last day of
  // the anchor calendar month, which would fall in the NEXT payday-window.
  const windowEndDay = range.endsOn.getUTCDate();

  // The forecast is forward-looking only. Past-dated items in the active
  // payday-window that haven't matched a transaction by now are
  // categorization gaps (or actually-paid-but-mismatched), not "still to
  // pay" — they belong in the Inbox flow, not the forecast. By dropping
  // them here we mirror the mental model that the month "starts" on
  // payday: once a day passes, anything that should have hit that day is
  // either matched or a data problem, not a future obligation.
  const todayIso = new Date().toISOString().slice(0, 10);

  const charges: UpcomingCharge[] = [];
  for (const it of items) {
    let predictedDay: number | null = null;
    let source: UpcomingCharge["source"] = "month-end";
    if (it.dueDay) {
      predictedDay = it.dueDay;
      source = "due-day";
    } else if (it.naturalKey.startsWith("contrib-")) {
      // Joint-contribution outflows ("Contrib. Conjunta" on a personal
      // scope) happen on payday by household convention — the partner's
      // salary lands and is immediately swept to the joint account. The
      // sheet doesn't track a vencimento for this row, so anchor it to
      // the household's configured paydayDay.
      predictedDay = settings.paydayDay;
      source = "payday";
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
          predictedDay = windowEndDay;
        }
      }
    }
    // SEPA direct debits scheduled for a Sat/Sun land on the next business
    // day. We apply this slip when the predicted day comes from a fixed
    // calendar anchor (sheet vencimento or payday) — history-median and
    // counterparty-history are medians of *actual* booking dates, which
    // already encode any slip.
    if (
      (source === "due-day" || source === "payday") &&
      predictedDay !== null
    ) {
      predictedDay = shiftPastWeekend(
        range.anchorYear,
        range.anchorMonth,
        predictedDay,
      );
    }

    // Materialize to a real date inside the payday-window. Defensive
    // bounds check: if anything still falls outside (shouldn't happen
    // once predictedDay is in 1..31, but guard against bad inputs), drop
    // it from the forecast — it doesn't belong to THIS payday-month and
    // counting it would break the user's "spent + still to pay = planned"
    // mental model.
    const predictedDate = materializeForecastDate(
      predictedDay,
      settings.paydayDay,
      range.anchorYear,
      range.anchorMonth,
    );
    if (predictedDate < range.startsOn || predictedDate > range.endsOn) {
      continue;
    }
    // Forward-only: anything that should have hit before today is no
    // longer "still to pay". The total below is recomputed from this
    // filtered list so the Today + Activity cards stay reconciled.
    if (predictedDate.toISOString().slice(0, 10) < todayIso) {
      continue;
    }

    charges.push({
      budgetItemId: it.id,
      name: it.name,
      section: it.section,
      plannedCents: it.plannedCents,
      predictedDay,
      predictedDate: predictedDate.toISOString(),
      source,
    });
  }

  // Order chronologically by the materialized date — this is the order
  // they'll actually hit the account.
  charges.sort((a, b) => a.predictedDate.localeCompare(b.predictedDate));

  const totalRemainingCents = charges.reduce(
    (s, c) => s + Math.abs(c.plannedCents),
    0,
  );
  return { charges, totalRemainingCents, paidRecurring };
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
