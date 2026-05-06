/**
 * Convert a budget item's planned amount to its monthly contribution.
 *
 * SAZONAIS items in the sheet are written as YEARLY costs (€567 OZB tax,
 * €4000 trip to Brazil, etc.). What lands in the joint account each month
 * is 1/12 of those amounts — that's what should be displayed everywhere on
 * the monthly screens.
 *
 * Other sections (FIXAS, VARIÁVEIS, DÍVIDAS, ENTRADAS, ECONOMIAS) are
 * already monthly in the sheet, so they pass through unchanged.
 */

import type { Section } from "./import/types.ts";

export function monthlyContributionCents(
  plannedCents: number,
  section: Section,
): number {
  if (section === "SAZONAIS") {
    return Math.round(plannedCents / 12);
  }
  return plannedCents;
}
