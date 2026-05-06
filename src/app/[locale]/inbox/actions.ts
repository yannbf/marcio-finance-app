"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
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
