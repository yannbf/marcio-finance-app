"use server";

import { revalidatePath } from "next/cache";
import { readLocalXlsx } from "@/lib/import/source-xlsx.ts";
import { upsertParsedMonth } from "@/lib/import/upsert.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import type { ImportResult } from "@/lib/import/upsert.ts";

export type ImportActionResult =
  | { ok: true; results: (ImportResult & { anchor: string })[] }
  | { ok: false; error: string };

/**
 * Run the ingest pipeline end-to-end:
 *   1. Resolve a source — local xlsx (dev) or Google Sheets (prod, when wired).
 *   2. Parse every recognizable monthly tab.
 *   3. Upsert parsed items into the DB.
 */
export async function runImport(): Promise<ImportActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Not signed in." };

  const localPath = process.env.MARCIO_LOCAL_XLSX;
  if (!localPath) {
    return {
      ok: false,
      error:
        "MARCIO_LOCAL_XLSX is not set. Point it at a local xlsx export of the budget sheet.",
    };
  }

  let parsedSheets;
  try {
    parsedSheets = await readLocalXlsx(localPath);
  } catch (err) {
    return {
      ok: false,
      error: `Could not read xlsx at ${localPath}: ${(err as Error).message}`,
    };
  }

  if (parsedSheets.length === 0) {
    return {
      ok: false,
      error: "No monthly tabs found in the workbook.",
    };
  }

  const results: (ImportResult & { anchor: string })[] = [];
  for (const sheet of parsedSheets) {
    const r = await upsertParsedMonth(sheet);
    results.push({
      ...r,
      anchor: `${sheet.anchorYear}-${String(sheet.anchorMonth).padStart(2, "0")}`,
    });
  }

  revalidatePath("/", "layout");
  return { ok: true, results };
}
