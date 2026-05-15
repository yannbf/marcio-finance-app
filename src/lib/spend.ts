import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { bankAccount, transaction } from "@/db/schema.ts";
import {
  INTERNAL_TRANSFER_PG_PATTERN,
  SAVINGS_TRANSFER_PG_PATTERN,
} from "@/lib/matching/seed-rules.ts";
import { paydayMonthFor, paydayMonthForAnchor } from "./payday.ts";
import { getHouseholdSettings } from "./settings.ts";

/**
 * Canonical "spent so far this payday-month" figure, used by Today,
 * Activity, and Look Back. Defined as **net non-transfer spend**:
 *
 *   Σ (-amountCents) for every transaction in the active payday-month
 *   range whose owner is in `scopes`, excluding internal household
 *   transfers (yann/camila ↔ joint) and savings-account sweeps.
 *
 * Debits (negative amountCents) contribute positively, credits (refunds,
 * reversals — positive amountCents) contribute negatively. This is the
 * physical "cash that left your accounts net of money coming back",
 * which is what a normal person means by "spent".
 *
 * Notable choices:
 *  - Matched + unmatched. An expense doesn't stop being spending just
 *    because it hasn't been categorized yet — that would let the inbox
 *    backlog hide real money movement.
 *  - Credits count. A refund offsets the original spend; not subtracting
 *    it overstates "spent" against planned outflow.
 *  - Internal transfers and savings sweeps are stripped. Moving money
 *    between household accounts (or to a savings pot) isn't spending.
 *
 * Returns cents as a signed integer; positive means net outflow,
 * negative means net inflow (rare, but possible mid-cycle).
 */
export async function getMonthlyNetSpend(
  scopes: ("joint" | "yann" | "camila")[],
  anchor?: { year: number; month: number },
): Promise<number> {
  if (scopes.length === 0) return 0;
  const settings = await getHouseholdSettings();
  const range = anchor
    ? paydayMonthForAnchor(anchor.year, anchor.month, settings.paydayDay)
    : paydayMonthFor(new Date(), settings.paydayDay);

  const [row] = await db
    .select({
      sum: sql<string>`COALESCE(-SUM(${transaction.amountCents}), 0)`,
    })
    .from(transaction)
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
    .where(
      and(
        inArray(bankAccount.owner, scopes),
        gte(transaction.bookingDate, range.startsOn),
        lte(transaction.bookingDate, range.endsOn),
        sql`NOT (COALESCE(${transaction.counterparty}, '') || ' ' || COALESCE(${transaction.description}, '') ~* ${INTERNAL_TRANSFER_PG_PATTERN})`,
        sql`NOT (COALESCE(${transaction.counterparty}, '') || ' ' || COALESCE(${transaction.description}, '') ~* ${SAVINGS_TRANSFER_PG_PATTERN})`,
      ),
    );
  return Number.parseInt(row.sum, 10);
}
