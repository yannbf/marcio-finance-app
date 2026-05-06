"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index.ts";
import { budgetItem, savingsAccount } from "@/db/schema.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";

const Owner = z.enum(["joint", "camila", "yann"]);

const CreateSchema = z.object({
  ref: z.string().trim().min(1).max(64),
  nickname: z.string().trim().min(1).max(80),
  owner: Owner,
  /** Comma-separated naturalKeys of SAZONAIS items this savings account
   * draws from (or rather: that the deposits to it serve to fund). */
  linkedNaturalKeys: z.string().trim().optional(),
  notes: z.string().trim().max(500).optional(),
});

export type SavingsActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function createSavingsAccountAction(
  raw: z.input<typeof CreateSchema>,
): Promise<SavingsActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Not signed in." };

  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  // Privacy: a personal savings account can only be created by its owner.
  if (parsed.data.owner !== "joint" && parsed.data.owner !== me.role) {
    return {
      ok: false,
      error: "You can only manage your own personal savings or the joint ones.",
    };
  }

  const linkedKeys = (parsed.data.linkedNaturalKeys ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  try {
    const [created] = await db
      .insert(savingsAccount)
      .values({
        ref: parsed.data.ref,
        nickname: parsed.data.nickname,
        owner: parsed.data.owner,
        defaultBudgetItemNaturalKey: linkedKeys[0] ?? null,
        notes: parsed.data.notes || null,
      })
      .returning();

    if (linkedKeys.length > 0) {
      // Link every SAZONAIS budget item with a matching natural key & scope
      // across every month — so newly imported months stay linked too.
      await db
        .update(budgetItem)
        .set({ savingsAccountId: created.id })
        .where(
          and(
            eq(budgetItem.scope, parsed.data.owner),
            eq(budgetItem.section, "SAZONAIS"),
            inArray(budgetItem.naturalKey, linkedKeys),
          ),
        );
    }

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("unique")) {
      return { ok: false, error: "A savings account with this ref already exists." };
    }
    return { ok: false, error: msg };
  }
}

const UpdateLinksSchema = z.object({
  savingsAccountId: z.string().uuid(),
  linkedNaturalKeys: z.array(z.string().trim().min(1)),
});

/** Replace the set of SAZONAIS items linked to a savings account. */
export async function updateSavingsLinksAction(
  raw: z.input<typeof UpdateLinksSchema>,
): Promise<SavingsActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Not signed in." };
  const parsed = UpdateLinksSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const [acct] = await db
    .select()
    .from(savingsAccount)
    .where(eq(savingsAccount.id, parsed.data.savingsAccountId));
  if (!acct) return { ok: false, error: "Not found." };
  if (acct.owner !== "joint" && acct.owner !== me.role) {
    return { ok: false, error: "Not yours to edit." };
  }

  // Unlink items that aren't in the new set.
  await db
    .update(budgetItem)
    .set({ savingsAccountId: null })
    .where(
      and(
        eq(budgetItem.savingsAccountId, acct.id),
        parsed.data.linkedNaturalKeys.length > 0
          ? sql`${budgetItem.naturalKey} NOT IN (${sql.join(
              parsed.data.linkedNaturalKeys.map((k) => sql`${k}`),
              sql`, `,
            )})`
          : sql`TRUE`,
      ),
    );

  if (parsed.data.linkedNaturalKeys.length > 0) {
    await db
      .update(budgetItem)
      .set({ savingsAccountId: acct.id })
      .where(
        and(
          eq(budgetItem.scope, acct.owner),
          eq(budgetItem.section, "SAZONAIS"),
          inArray(budgetItem.naturalKey, parsed.data.linkedNaturalKeys),
        ),
      );
  }

  await db
    .update(savingsAccount)
    .set({ defaultBudgetItemNaturalKey: parsed.data.linkedNaturalKeys[0] ?? null })
    .where(eq(savingsAccount.id, acct.id));

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteSavingsAccountAction(
  id: string,
): Promise<SavingsActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Not signed in." };

  const [existing] = await db
    .select()
    .from(savingsAccount)
    .where(eq(savingsAccount.id, id));
  if (!existing) return { ok: false, error: "Not found." };

  if (existing.owner !== "joint" && existing.owner !== me.role) {
    return { ok: false, error: "Not yours to delete." };
  }

  // Unlink items first (FK is set null on delete in the absence of an
  // ALTER, so we do it explicitly).
  await db
    .update(budgetItem)
    .set({ savingsAccountId: null })
    .where(eq(budgetItem.savingsAccountId, id));
  await db.delete(savingsAccount).where(eq(savingsAccount.id, id));
  revalidatePath("/", "layout");
  return { ok: true };
}
