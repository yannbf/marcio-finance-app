import type { ParsedSheet } from "./types.ts";

/**
 * Stub for Google Sheets ingest. Activated when GOOGLE_SHEET_ID and the
 * service-account key are configured. Until then, any caller hits this
 * fallback and falls back to the local-xlsx source if available.
 */
export async function readGoogleSheet(): Promise<ParsedSheet[]> {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (!sheetId || !keyB64) {
    throw new Error(
      "Google Sheets source not configured. Set GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON_B64, or use MARCIO_LOCAL_XLSX for dev iteration.",
    );
  }
  // Real implementation lands once the service account is set up.
  // It will: load credentials, call sheets.spreadsheets.values.batchGet
  // for each tab, then feed the rows into parseSheet().
  throw new Error("Google Sheets ingest not implemented yet (Phase 1.b).");
}
