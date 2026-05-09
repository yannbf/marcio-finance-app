import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  categoryOverride,
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
import {
  categorizeTxWithOverrides,
  type Category,
} from "@/lib/categorization.ts";
import type { Section } from "@/lib/import/types.ts";

const PAGE_SIZE = 100;

const ShowFilter = z.enum(["all", "matched", "unmatched", "duplicates"]);

export const transactionsRouter = router({
  // Text search lives entirely on the client — the screen filters the cached
  // page-of-100 instead of refetching per keystroke. The router stays scoped
  // by show/scope so the cache key changes only when the underlying set does.
  // Pagination is offset-based via the optional `cursor` field, which makes
  // the procedure compatible with tRPC's useInfiniteQuery.
  list: publicProcedure
    .input(
      z.object({
        show: ShowFilter.optional(),
        scope: ScopeViewInput,
        cursor: z.number().int().nonnegative().optional(),
        // ISO date strings, inclusive on both ends. The screen surfaces
        // shortcut pills (7 / 30 / 90 days) and a custom range; either or
        // both can be omitted.
        dateFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        dateTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const allowed = resolveVisibleScopes(ctx.allowedScopes, input?.scope);
      const show = input?.show ?? "all";
      const offset = input?.cursor ?? 0;

      const filters = [inArray(bankAccount.owner, allowed)];

      if (input.dateFrom) {
        filters.push(
          gte(transaction.bookingDate, new Date(`${input.dateFrom}T00:00:00.000Z`)),
        );
      }
      if (input.dateTo) {
        filters.push(
          lte(transaction.bookingDate, new Date(`${input.dateTo}T23:59:59.999Z`)),
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
      } else if (show === "duplicates") {
        // Two rows with the same (account, date, amount) but different
        // dedupe-keys are likely the same real-world transaction surfaced
        // through CSV and Enable Banking with slightly different
        // counterparty/description formatting. Surfacing them lets the user
        // delete one half by hand.
        filters.push(
          sql`EXISTS (
            SELECT 1 FROM ${transaction} AS t2
            WHERE t2.bank_account_id = ${transaction.bankAccountId}
              AND t2.booking_date = ${transaction.bookingDate}
              AND t2.amount_cents = ${transaction.amountCents}
              AND t2.id <> ${transaction.id}
          )`,
        );
      }

      const rows = await db
        .select({
          id: transaction.id,
          counterparty: transaction.counterparty,
          description: transaction.description,
          bookingDate: transaction.bookingDate,
          amountCents: transaction.amountCents,
          matchedItemId: budgetItem.id,
          matchedName: budgetItem.name,
          owner: bankAccount.owner,
        })
        .from(transaction)
        .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
        .leftJoin(txMatch, eq(txMatch.transactionId, transaction.id))
        .leftJoin(budgetItem, eq(budgetItem.id, txMatch.budgetItemId))
        .where(and(...filters))
        .orderBy(desc(transaction.bookingDate))
        .limit(PAGE_SIZE)
        .offset(offset);

      // Options only need to be sent on the first page — every subsequent
      // page would re-send the same payload otherwise. The client merges
      // pages but keeps optionsAll from page 0.
      let optionsAll: {
        id: string;
        name: string;
        section: Section;
        scope: "joint" | "yann" | "camila";
      }[] = [];
      if (offset === 0) {
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
        optionsAll = items
          .filter((i) =>
            allowed.includes(i.scope as "joint" | "yann" | "camila"),
          )
          .map((i) => ({
            id: i.id,
            name: i.name,
            section: i.section as Section,
            scope: i.scope as "joint" | "yann" | "camila",
          }));
      }

      // Per-merchant category overrides — applied to the rows below so
      // every screen that lists transactions reflects the user's
      // pinned classifications.
      const overrideRows = await db
        .select({
          fingerprint: categoryOverride.fingerprint,
          category: categoryOverride.category,
        })
        .from(categoryOverride);
      const overrides = new Map<string, Category>(
        overrideRows.map((o) => [o.fingerprint, o.category as Category]),
      );

      const hasMore = rows.length === PAGE_SIZE;
      return {
        rows: rows.map((r) => ({
          id: r.id,
          counterparty: r.counterparty,
          description: r.description,
          bookingDate: r.bookingDate.toISOString(),
          amountCents: r.amountCents,
          matchedItemId: r.matchedItemId ?? null,
          matchedName: r.matchedName ?? null,
          owner: r.owner as "joint" | "yann" | "camila",
          category: categorizeTxWithOverrides(
            { counterparty: r.counterparty, description: r.description },
            overrides,
          ),
        })),
        pageSize: PAGE_SIZE,
        optionsAll,
        nextCursor: hasMore ? offset + PAGE_SIZE : null,
      };
    }),
});
