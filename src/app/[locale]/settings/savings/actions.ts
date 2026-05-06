"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index.ts";
import { savingsAccount } from "@/db/schema.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";

const Owner = z.enum(["joint", "camila", "yann"]);

const CreateSchema = z.object({
  ref: z.string().trim().min(1).max(64),
  nickname: z.string().trim().min(1).max(80),
  owner: Owner,
  defaultBudgetItemNaturalKey: z.string().trim().optional(),
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

  try {
    await db.insert(savingsAccount).values({
      ref: parsed.data.ref,
      nickname: parsed.data.nickname,
      owner: parsed.data.owner,
      defaultBudgetItemNaturalKey:
        parsed.data.defaultBudgetItemNaturalKey || null,
      notes: parsed.data.notes || null,
    });
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

  await db.delete(savingsAccount).where(eq(savingsAccount.id, id));
  revalidatePath("/", "layout");
  return { ok: true };
}
