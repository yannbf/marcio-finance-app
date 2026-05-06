"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index.ts";
import {
  budgetItem,
  matchRule,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";

const Schema = z.object({
  transactionId: z.string().uuid(),
  budgetItemId: z.string().uuid(),
  rememberRule: z.boolean().optional(),
});

export type AssignResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Assign a single transaction to a budget item, optionally remembering the
 * rule for future auto-matches. The transaction's counterparty is stored as
 * a regex prefix so re-uploads of the same merchant land in the same bucket.
 */
export async function assignTransactionAction(
  raw: z.input<typeof Schema>,
): Promise<AssignResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Not signed in." };
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const [tx] = await db
    .select()
    .from(transaction)
    .where(eq(transaction.id, parsed.data.transactionId));
  if (!tx) return { ok: false, error: "Transaction not found." };

  const [bi] = await db
    .select()
    .from(budgetItem)
    .where(eq(budgetItem.id, parsed.data.budgetItemId));
  if (!bi) return { ok: false, error: "Budget item not found." };

  // Wipe any prior auto-match so the user choice replaces it cleanly.
  await db.delete(txMatch).where(eq(txMatch.transactionId, tx.id));

  await db.insert(txMatch).values({
    transactionId: tx.id,
    budgetItemId: bi.id,
    allocatedCents: tx.amountCents,
    source: "user",
    confirmedByUserId: me.id,
    confirmedAt: new Date(),
  });

  if (parsed.data.rememberRule && tx.counterparty) {
    const pattern = escapeForRulePattern(tx.counterparty);
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

  revalidatePath("/", "layout");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */

const BulkSchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(200),
  budgetItemId: z.string().uuid(),
  rememberRule: z.boolean().optional(),
});

export type BulkAssignResult =
  | { ok: true; assigned: number }
  | { ok: false; error: string };

/**
 * Assign many transactions to one budget item in a single trip. Each
 * existing match is wiped first so the manual choice replaces any auto
 * rule. The "remember rule" flag stores ONE rule from the most-common
 * counterparty in the batch — bulk-assigning a stack of identical merchant
 * txns is the obvious case.
 */
export async function assignManyTransactionsAction(
  raw: z.input<typeof BulkSchema>,
): Promise<BulkAssignResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Not signed in." };
  const parsed = BulkSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const [bi] = await db
    .select()
    .from(budgetItem)
    .where(eq(budgetItem.id, parsed.data.budgetItemId));
  if (!bi) return { ok: false, error: "Budget item not found." };

  const txns = await db
    .select()
    .from(transaction)
    .where(inArray(transaction.id, parsed.data.transactionIds));
  if (txns.length === 0) return { ok: false, error: "No transactions." };

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
      confirmedByUserId: me.id,
      confirmedAt: now,
    })),
  );

  if (parsed.data.rememberRule) {
    // Pick the most-common non-empty counterparty in the batch.
    const counts = new Map<string, number>();
    for (const tx of txns) {
      if (!tx.counterparty) continue;
      counts.set(tx.counterparty, (counts.get(tx.counterparty) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top) {
      const pattern = escapeForRulePattern(top);
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
  }

  revalidatePath("/", "layout");
  return { ok: true, assigned: txns.length };
}

/* -------------------------------------------------------------------------- */

function escapeForRulePattern(counterparty: string): string {
  // Build a tolerant pattern from the counterparty: lowercase, escape regex
  // metachars, allow trailing variation (city names, location ids).
  const cleaned = counterparty
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+\d+.*/g, "")
    .trim();
  return cleaned;
}
