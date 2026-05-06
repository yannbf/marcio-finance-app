import { z } from "zod";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  month,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import {
  publicProcedure,
  resolveVisibleScopes,
  router,
} from "../trpc.ts";
import { ScopeViewInput } from "../inputs.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import type { Section } from "@/lib/import/types.ts";

const PAGE_SIZE = 100;

const ShowFilter = z.enum(["all", "matched", "unmatched"]);

export const transactionsRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          q: z.string().optional(),
          show: ShowFilter.optional(),
          scope: ScopeViewInput,
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const allowed = resolveVisibleScopes(ctx.allowedScopes, input?.scope);
      const filterText = (input?.q ?? "").trim();
      const show = input?.show ?? "all";

      const filters = [inArray(bankAccount.owner, allowed)];
      if (filterText) {
        const like = `%${filterText.toLowerCase()}%`;
        filters.push(
          or(
            ilike(transaction.counterparty, like),
            ilike(transaction.description, like),
          )!,
        );
      }
      if (show === "matched") {
        filters.push(
          sql`EXISTS (SELECT 1 FROM ${txMatch} WHERE ${txMatch.transactionId} = ${transaction.id})`,
        );
      } else if (show === "unmatched") {
        filters.push(
          sql`NOT EXISTS (SELECT 1 FROM ${txMatch} WHERE ${txMatch.transactionId} = ${transaction.id})`,
        );
      }

      const rows = await db
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
        .where(and(...filters))
        .orderBy(desc(transaction.bookingDate))
        .limit(PAGE_SIZE);

      // Reuse this payday-month's items as reassign options.
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
        .filter((i) =>
          allowed.includes(i.scope as "joint" | "yann" | "camila"),
        )
        .map((i) => ({
          id: i.id,
          name: i.name,
          section: i.section as Section,
          scope: i.scope as "joint" | "yann" | "camila",
        }));

      return {
        rows: rows.map((r) => ({
          id: r.id,
          counterparty: r.counterparty,
          description: r.description,
          bookingDate: r.bookingDate.toISOString(),
          amountCents: r.amountCents,
          matchedName: r.matchedName ?? null,
          owner: r.owner as "joint" | "yann" | "camila",
        })),
        pageSize: PAGE_SIZE,
        optionsAll,
      };
    }),
});
