"use server";

import { revalidatePath } from "next/cache";
import { readLocalXlsx } from "@/lib/import/source-xlsx.ts";
import { readGoogleSheet } from "@/lib/import/source-google.ts";
import { upsertParsedMonth } from "@/lib/import/upsert.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import type { ImportResult } from "@/lib/import/upsert.ts";
import type { ParsedSheet } from "@/lib/import/types.ts";

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

  // Source order: Google Sheets (production) → local xlsx (dev fallback).
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheetKey = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  const localPath = process.env.MARCIO_LOCAL_XLSX;

  let parsedSheets: ParsedSheet[];
  let sourceLabel: string;
  if (sheetId && sheetKey) {
    sourceLabel = `Google Sheet ${sheetId.slice(0, 6)}…`;
    try {
      parsedSheets = await readGoogleSheet();
    } catch (err) {
      return {
        ok: false,
        error: `Google Sheets read failed: ${(err as Error).message}`,
      };
    }
  } else if (localPath) {
    sourceLabel = `local xlsx (${localPath})`;
    try {
      parsedSheets = await readLocalXlsx(localPath);
    } catch (err) {
      return {
        ok: false,
        error: `Could not read xlsx at ${localPath}: ${(err as Error).message}`,
      };
    }
  } else {
    return {
      ok: false,
      error:
        "No source configured. Set GOOGLE_SHEET_ID + GOOGLE_SERVICE_ACCOUNT_JSON_B64 (production) or MARCIO_LOCAL_XLSX (dev).",
    };
  }
  void sourceLabel;

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
