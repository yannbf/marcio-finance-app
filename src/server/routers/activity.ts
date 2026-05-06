import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  month,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { publicProcedure, router } from "../trpc.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { getUpcomingCharges } from "@/lib/forecast.ts";
import { AFRONDING_PATTERN } from "@/lib/matching/seed-rules.ts";
import type { Section } from "@/lib/import/types.ts";

export const activityRouter = router({
  /**
   * Month-anchored timeline + forecast + sticky summary, plus the current
   * payday-month's budget items so per-row reassign popovers have targets.
   */
  get: publicProcedure.query(async ({ ctx }) => {
    const settings = await getHouseholdSettings();
    const range = paydayMonthFor(new Date(), settings.paydayDay);
    const allowed = ctx.allowedScopes;

    const [forecast, txns] = await Promise.all([
      getUpcomingCharges(allowed),
      db
        .select({
          id: transaction.id,
          counterparty: transaction.counterparty,
          description: transaction.description,
          bookingDate: transaction.bookingDate,
          amountCents: transaction.amountCents,
          matchedName: budgetItem.name,
          owner: bankAccount.owner,
        })
        .from(transaction)
        .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
        .leftJoin(txMatch, eq(txMatch.transactionId, transaction.id))
        .leftJoin(budgetItem, eq(budgetItem.id, txMatch.budgetItemId))
        .where(
          and(
            inArray(bankAccount.owner, allowed),
            gte(transaction.bookingDate, range.startsOn),
            lte(transaction.bookingDate, range.endsOn),
            sql`NOT (${transaction.counterparty} ~* ${AFRONDING_PATTERN.source})`,
          ),
        )
        .orderBy(desc(transaction.bookingDate))
        .limit(200),
    ]);

    const [monthRow] = await db
      .select({ id: month.id })
      .from(month)
      .where(
        and(
          eq(month.anchorYear, range.anchorYear),
          eq(month.anchorMonth, range.anchorMonth),
        ),
      );
    const items = monthRow
      ? await db
          .select({
            id: budgetItem.id,
            name: budgetItem.name,
            section: budgetItem.section,
            scope: budgetItem.scope,
          })
          .from(budgetItem)
          .where(eq(budgetItem.monthId, monthRow.id))
          .orderBy(asc(budgetItem.section), asc(budgetItem.name))
      : [];

    const optionsAll = items
      .filter((i) => allowed.includes(i.scope as "joint" | "yann" | "camila"))
      .map((i) => ({
        id: i.id,
        name: i.name,
        section: i.section as Section,
        scope: i.scope as "joint" | "yann" | "camila",
      }));

    const monthSpend = txns
      .filter((r) => r.amountCents < 0)
      .reduce((s, r) => s + Math.abs(r.amountCents), 0);

    return {
      anchor: { year: range.anchorYear, month: range.anchorMonth },
      txns: txns.map((r) => ({
        id: r.id,
        counterparty: r.counterparty,
        description: r.description,
        bookingDate: r.bookingDate.toISOString(),
        amountCents: r.amountCents,
        matchedName: r.matchedName ?? null,
        owner: r.owner as "joint" | "yann" | "camila",
      })),
      forecast,
      monthSpend,
      optionsAll,
    };
  }),
});
