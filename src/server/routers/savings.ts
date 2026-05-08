/**
 * tRPC router for the Settings → Savings screen.
 *
 * - `listUnidentified` surfaces "spaarrekening <REF>" mentions where
 *   the ref isn't yet declared in `savings_account`, so the user can
 *   claim them with a nickname.
 * - `create` inserts a `savings_account` row and re-runs the matching
 *   engine across every bank account so prior transactions referring
 *   to the new ref retroactively route to the linked budget item.
 */

import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  savingsAccount,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { protectedProcedure, publicProcedure, router } from "../trpc.ts";
import { detectUnidentifiedSavingsRefs } from "@/lib/savings-detection.ts";
import { runMatchingForAccount } from "@/lib/matching/engine.ts";

const Owner = z.enum(["joint", "camila", "yann"]);

export const savingsRouter = router({
  /** Aggregated list of `[NVA]\d{8}` refs the user hasn't claimed yet. */
  listUnidentified: publicProcedure.query(async ({ ctx }) => {
    return detectUnidentifiedSavingsRefs(ctx.allowedScopes);
  }),

  /**
   * Create a savings_account row for an unidentified ref and rerun the
   * matching engine across every bank account so prior transactions
   * mentioning this ref get routed to the (newly linked) budget item.
   *
   * If `linkedNaturalKeys` are supplied, every SAZONAIS budget_item with
   * that key + scope is linked to the new savings_account (the same way
   * `updateSavingsLinksAction` does). The first key becomes the
   * `defaultBudgetItemNaturalKey`, which the engine uses as a fallback
   * when nothing else points at the savings account in the active
   * payday-month.
   */
  create: protectedProcedure
    .input(
      z.object({
        ref: z.string().trim().min(1).max(64),
        nickname: z.string().trim().min(1).max(80),
        owner: Owner,
        linkedNaturalKeys: z.array(z.string().trim().min(1)).optional(),
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Privacy: a personal savings account can only be created by its
      // owner. Joint is fine for either user.
      if (input.owner !== "joint" && input.owner !== ctx.user.role) {
        throw new Error(
          "You can only create your own personal savings accounts or joint ones.",
        );
      }

      const linked = input.linkedNaturalKeys ?? [];

      const [created] = await db
        .insert(savingsAccount)
        .values({
          ref: input.ref,
          nickname: input.nickname,
          owner: input.owner,
          defaultBudgetItemNaturalKey: linked[0] ?? null,
          notes: input.notes || null,
        })
        .returning();

      if (linked.length > 0) {
        // Mirror the wiring that the existing settings action does — link
        // every SAZONAIS budget_item with one of these natural keys (in
        // the savings account's scope) across all months.
        await db
          .update(budgetItem)
          .set({ savingsAccountId: created.id })
          .where(
            and(
              eq(budgetItem.scope, input.owner),
              eq(budgetItem.section, "SAZONAIS"),
              inArray(budgetItem.naturalKey, linked),
            ),
          );
      }

      // Retroactively re-match: clear any auto-rule tx_match rows whose
      // transaction mentions the newly-claimed ref (so the engine can
      // reroute them on this run). User-confirmed assignments are
      // preserved — the user's intent always beats heuristics.
      const refLower = input.ref.toLowerCase();
      await db
        .delete(txMatch)
        .where(
          and(
            inArray(
              txMatch.transactionId,
              db
                .select({ id: transaction.id })
                .from(transaction)
                .innerJoin(
                  bankAccount,
                  eq(bankAccount.id, transaction.bankAccountId),
                )
                .where(
                  and(
                    inArray(bankAccount.owner, ctx.allowedScopes),
                    sql`(LOWER(COALESCE(${transaction.counterparty}, '')) || ' ' || LOWER(COALESCE(${transaction.description}, ''))) LIKE ${"%" + refLower + "%"}`,
                  ),
                ),
            ),
            eq(txMatch.source, "auto-rule"),
          ),
        );

      // Re-run the matching engine for every bank account the caller can
      // see. The engine's first pass routes any unmatched txn whose
      // description carries this newly-known ref to the linked budget
      // item — exactly what we want for "claim and remap historical
      // transactions in one tap".
      const accounts = await db
        .select({ id: bankAccount.id })
        .from(bankAccount)
        .where(inArray(bankAccount.owner, ctx.allowedScopes));

      let matched = 0;
      for (const a of accounts) {
        const r = await runMatchingForAccount(a.id);
        matched += r.matched;
      }

      return { id: created.id, rematched: matched };
    }),
});
