import { google } from "googleapis";
import type { ParsedSheet } from "./types.ts";
import { parseSheet } from "./parser.ts";

/**
 * Read a Google Sheets workbook and parse every monthly tab.
 *
 * Configuration via env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON_B64 — base64 of the service account JSON.
 *   GOOGLE_SHEET_ID                 — the workbook id (the long path segment).
 *
 * Setup steps:
 *   1. https://console.cloud.google.com/ → create or select a project.
 *   2. Enable "Google Sheets API" on that project.
 *   3. Create a service account, generate a JSON key, download it.
 *   4. Share the sheet (Share button) with the service account's email,
 *      "Viewer" is enough.
 *   5. base64 the JSON and put it in .env.local along with the sheet id.
 *
 * The function returns one ParsedSheet per tab whose name parses as
 * year/month (so non-monthly tabs are silently skipped).
 */
export async function readGoogleSheet(): Promise<ParsedSheet[]> {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (!sheetId || !keyB64) {
    throw new Error(
      "Google Sheets source not configured. Set GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON_B64.",
    );
  }

  const credentials = JSON.parse(
    Buffer.from(keyB64, "base64").toString("utf8"),
  ) as { client_email: string; private_key: string };

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheetsApi = google.sheets({ version: "v4", auth });

  // Discover all tab titles in the workbook.
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets(properties(title))",
  });
  const titles =
    meta.data.sheets
      ?.map((s) => s.properties?.title)
      .filter((t): t is string => typeof t === "string") ?? [];

  if (titles.length === 0) return [];

  // Pull every tab in one batchGet so we don't pay per-tab round-trips.
  const ranges = titles.map((t) => `${t}!A1:Z200`);
  const batch = await sheetsApi.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const out: ParsedSheet[] = [];
  for (let i = 0; i < titles.length; i++) {
    const tab = titles[i];
    const values = batch.data.valueRanges?.[i]?.values ?? [];
    // Normalize to 2D array of (string | number | null) — parser tolerates.
    const rows: (string | number | null)[][] = values.map(
      (row) =>
        row.map((cell): string | number | null => {
          if (cell === null || cell === undefined || cell === "") return null;
          if (typeof cell === "number") return cell;
          if (typeof cell === "boolean") return cell ? 1 : 0;
          return String(cell);
        }) as (string | number | null)[],
    );
    try {
      const parsed = parseSheet({ tabName: tab, rows });
      out.push(parsed);
    } catch {
      // Tab name didn't parse as a month — skip silently.
    }
  }
  return out;
}
