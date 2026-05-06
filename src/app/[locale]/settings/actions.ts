"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index.ts";
import { bankAccount, transaction } from "@/db/schema.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { parseIngCsv, type IngTx } from "@/lib/import/csv-ing.ts";
import { updatePaydayDay } from "@/lib/settings.ts";
import { runMatchingForAccount } from "@/lib/matching/engine.ts";

const OwnerSchema = z.enum(["joint", "camila", "yann"]);

export type CsvUploadResult =
  | {
      ok: true;
      accountIban: string;
      bankAccountId: string;
      inserted: number;
      duplicates: number;
      total: number;
      autoMatched: number;
      warnings: string[];
    }
  | { ok: false; error: string };

export async function uploadIngCsv(
  formData: FormData,
): Promise<CsvUploadResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Not signed in." };

  const ownerRaw = formData.get("owner");
  const file = formData.get("file");
  const nicknameRaw = formData.get("nickname");
  const ownerParse = OwnerSchema.safeParse(ownerRaw);
  if (!ownerParse.success) return { ok: false, error: "Pick an account scope." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick a CSV file." };
  }
  const owner = ownerParse.data;
  const nickname =
    typeof nicknameRaw === "string" && nicknameRaw.trim()
      ? nicknameRaw.trim()
      : defaultNicknameFor(owner);

  // Privacy guard: a personal account can only be uploaded by its owner.
  if (owner !== "joint" && owner !== me.role) {
    return {
      ok: false,
      error: "You can only upload your own personal account or the joint one.",
    };
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const parsed = parseIngCsv(buf);
  if (parsed.rows.length === 0) {
    return {
      ok: false,
      error:
        parsed.warnings[0] ?? "Could not parse any rows from this CSV.",
    };
  }

  const account = await ensureBankAccount({
    iban: parsed.accountIban,
    owner,
    nickname,
  });

  const { inserted, duplicates } = await insertTransactions({
    bankAccountId: account.id,
    rows: parsed.rows,
  });

  // Auto-match newly inserted transactions against seed + learned rules.
  // Skipped-no-budget rows simply stay in the Inbox until the matching month
  // is imported from the sheet.
  const matchOutcome = await runMatchingForAccount(account.id);

  revalidatePath("/", "layout");

  return {
    ok: true,
    accountIban: parsed.accountIban,
    bankAccountId: account.id,
    inserted,
    duplicates,
    total: parsed.rows.length,
    autoMatched: matchOutcome.matched,
    warnings: parsed.warnings,
  };
}

/* -------------------------------------------------------------------------- */

async function ensureBankAccount(args: {
  iban: string;
  owner: "joint" | "camila" | "yann";
  nickname: string;
}) {
  if (!args.iban) {
    // CSV without an account IBAN — fall back to a per-owner placeholder so
    // multiple uploads still merge into the same logical account.
    const placeholder = `MARCIO-${args.owner.toUpperCase()}`;
    const [existing] = await db
      .select()
      .from(bankAccount)
      .where(
        and(
          eq(bankAccount.owner, args.owner),
          eq(bankAccount.iban, placeholder),
        ),
      );
    if (existing) return existing;
    const [created] = await db
      .insert(bankAccount)
      .values({
        owner: args.owner,
        kind: "checking",
        nickname: args.nickname,
        bank: "ING",
        iban: placeholder,
      })
      .returning();
    return created;
  }

  const [existing] = await db
    .select()
    .from(bankAccount)
    .where(eq(bankAccount.iban, args.iban));
  if (existing) return existing;

  const [created] = await db
    .insert(bankAccount)
    .values({
      owner: args.owner,
      kind: "checking",
      nickname: args.nickname,
      bank: "ING",
      iban: args.iban,
      lastSyncedAt: new Date(),
    })
    .returning();
  return created;
}

async function insertTransactions(args: {
  bankAccountId: string;
  rows: IngTx[];
}): Promise<{ inserted: number; duplicates: number }> {
  let inserted = 0;
  let duplicates = 0;

  // Use ON CONFLICT DO NOTHING via the unique index (bankAccountId, dedupeKey).
  // Drizzle's onConflictDoNothing returns rowCount; loop in batches of 200.
  const BATCH = 200;
  for (let i = 0; i < args.rows.length; i += BATCH) {
    const batch = args.rows.slice(i, i + BATCH);
    const result = await db
      .insert(transaction)
      .values(
        batch.map((r) => ({
          bankAccountId: args.bankAccountId,
          bookingDate: r.bookingDate,
          amountCents: r.amountCents,
          counterparty: r.counterparty,
          description: r.description,
          dedupeKey: r.dedupeKey,
          status: "booked" as const,
          rawPayload: r.raw,
        })),
      )
      .onConflictDoNothing({
        target: [transaction.bankAccountId, transaction.dedupeKey],
      })
      .returning({ id: transaction.id });
    inserted += result.length;
    duplicates += batch.length - result.length;
  }

  // Update lastSyncedAt on the account.
  await db
    .update(bankAccount)
    .set({ lastSyncedAt: new Date() })
    .where(eq(bankAccount.id, args.bankAccountId));

  return { inserted, duplicates };
}

function defaultNicknameFor(owner: "joint" | "camila" | "yann"): string {
  if (owner === "joint") return "Joint checking";
  if (owner === "yann") return "Yann personal";
  return "Camila personal";
}

export async function setPaydayDayAction(
  day: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Not signed in." };
  try {
    await updatePaydayDay(day);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
