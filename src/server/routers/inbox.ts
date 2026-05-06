import { z } from "zod";
import { and, asc, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  matchRule,
  month,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { protectedProcedure, publicProcedure, router } from "../trpc.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { AFRONDING_PATTERN } from "@/lib/matching/seed-rules.ts";
import type { Section } from "@/lib/import/types.ts";

export const inboxRouter = router({
  /** Unmatched transactions for the visible scopes + budget-item options. */
  list: publicProcedure.query(async ({ ctx }) => {
    const settings = await getHouseholdSettings();
    const range = paydayMonthFor(new Date(), settings.paydayDay);
    const allowed = ctx.allowedScopes;

    const rows = await db
      .select({
        id: transaction.id,
        counterparty: transaction.counterparty,
        description: transaction.description,
        bookingDate: transaction.bookingDate,
        amountCents: transaction.amountCents,
        owner: bankAccount.owner,
      })
      .from(transaction)
      .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
      .where(
        and(
          notExists(
            db
              .select({ one: sql`1` })
              .from(txMatch)
              .where(eq(txMatch.transactionId, transaction.id)),
          ),
          sql`${bankAccount.owner} = ANY (${sql.raw(`ARRAY['${allowed.join("','")}']::account_owner[]`)})`,
        ),
      )
      .orderBy(desc(transaction.bookingDate));

    const visible = rows.filter(
      (r) => !AFRONDING_PATTERN.test(`${r.counterparty ?? ""} ${r.description ?? ""}`),
    );

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

    return {
      txns: visible.map((r) => ({
        id: r.id,
        counterparty: r.counterparty,
        description: r.description,
        bookingDate: r.bookingDate.toISOString(),
        amountCents: r.amountCents,
        owner: r.owner as "joint" | "yann" | "camila",
      })),
      optionsAll,
    };
  }),

  assign: protectedProcedure
    .input(
      z.object({
        transactionId: z.string().uuid(),
        budgetItemId: z.string().uuid(),
        rememberRule: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [tx] = await db
        .select()
        .from(transaction)
        .where(eq(transaction.id, input.transactionId));
      if (!tx) throw new Error("Transaction not found.");

      const [bi] = await db
        .select()
        .from(budgetItem)
        .where(eq(budgetItem.id, input.budgetItemId));
      if (!bi) throw new Error("Budget item not found.");

      await db
        .delete(txMatch)
        .where(eq(txMatch.transactionId, tx.id));

      await db.insert(txMatch).values({
        transactionId: tx.id,
        budgetItemId: bi.id,
        allocatedCents: tx.amountCents,
        source: "user",
        confirmedByUserId: ctx.user.id,
        confirmedAt: new Date(),
      });

      if (input.rememberRule && tx.counterparty) {
        await rememberRule(tx.counterparty, bi);
      }
      return { ok: true as const };
    }),

  assignMany: protectedProcedure
    .input(
      z.object({
        transactionIds: z.array(z.string().uuid()).min(1).max(200),
        budgetItemId: z.string().uuid(),
        rememberRule: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [bi] = await db
        .select()
        .from(budgetItem)
        .where(eq(budgetItem.id, input.budgetItemId));
      if (!bi) throw new Error("Budget item not found.");

      const txns = await db
        .select()
        .from(transaction)
        .where(inArray(transaction.id, input.transactionIds));
      if (txns.length === 0) throw new Error("No transactions.");

      await db
        .delete(txMatch)
        .where(inArray(txMatch.transactionId, txns.map((t) => t.id)));

      const now = new Date();
      await db.insert(txMatch).values(
        txns.map((tx) => ({
          transactionId: tx.id,
          budgetItemId: bi.id,
          allocatedCents: tx.amountCents,
          source: "user" as const,
          confirmedByUserId: ctx.user.id,
          confirmedAt: now,
        })),
      );

      if (input.rememberRule) {
        const counts = new Map<string, number>();
        for (const tx of txns) {
          if (!tx.counterparty) continue;
          counts.set(tx.counterparty, (counts.get(tx.counterparty) ?? 0) + 1);
        }
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (top) await rememberRule(top, bi);
      }
      return { ok: true as const, assigned: txns.length };
    }),
});

async function rememberRule(
  counterparty: string,
  bi: typeof budgetItem.$inferSelect,
): Promise<void> {
  const pattern = counterparty
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+\d+.*/g, "")
    .trim();
  const [existing] = await db
    .select()
    .from(matchRule)
    .where(
      and(
        eq(matchRule.scope, bi.scope),
        eq(matchRule.counterpartyPattern, pattern),
        eq(matchRule.targetSection, bi.section),
        eq(matchRule.targetNaturalKey, bi.naturalKey),
      ),
    );
  if (!existing) {
    await db.insert(matchRule).values({
      scope: bi.scope,
      counterpartyPattern: pattern,
      targetSection: bi.section,
      targetNaturalKey: bi.naturalKey,
      confidence: "0.800",
    });
  }
}
