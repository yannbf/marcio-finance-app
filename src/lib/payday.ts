/**
 * Marcio months are payday-anchored: a month "opens" on day 25 of the
 * previous calendar month and "closes" on day 24. The mortgage charge on the
 * 1st falls inside the same payday-month as the salary that paid for it.
 */

export const PAYDAY = 25;

export type PaydayMonth = {
  /** Calendar year/month the payday-month is named after (the "active" month). */
  anchorYear: number;
  anchorMonth: number; // 1..12
  /** The Date this payday-month opens on (day 25 of the previous calendar month). */
  startsOn: Date;
  /** The Date this payday-month closes on (day 24 of the anchor calendar month). */
  endsOn: Date;
};

export function paydayMonthFor(date: Date): PaydayMonth {
  const day = date.getDate();
  // If we're on day 25 or later, we're already in the NEXT payday-month.
  const anchor =
    day >= PAYDAY
      ? new Date(date.getFullYear(), date.getMonth() + 1, 1)
      : new Date(date.getFullYear(), date.getMonth(), 1);

  const anchorYear = anchor.getFullYear();
  const anchorMonth = anchor.getMonth() + 1;

  const startsOn = new Date(anchorYear, anchorMonth - 2, PAYDAY);
  const endsOn = new Date(anchorYear, anchorMonth - 1, PAYDAY - 1, 23, 59, 59);

  return { anchorYear, anchorMonth, startsOn, endsOn };
}

export function daysUntilNextPayday(now: Date): number {
  const month = paydayMonthFor(now);
  const next = new Date(month.endsOn);
  next.setDate(PAYDAY);
  next.setHours(0, 0, 0, 0);
  const ms = next.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}
