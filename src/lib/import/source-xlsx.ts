import "server-only";
import ExcelJS from "exceljs";
import type { ParsedSheet } from "./types.ts";
import { parseSheet } from "./parser.ts";

/**
 * Read a local .xlsx file and parse the most recent monthly tab.
 * The tab is selected by the first sheet whose name parses as a year/month
 * via parseTabName — typically the only sheet in the file.
 */
export async function readLocalXlsx(filePath: string): Promise<ParsedSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const out: ParsedSheet[] = [];
  for (const ws of wb.worksheets) {
    const rows: (string | number | null)[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const arr: (string | number | null)[] = [];
      // ExcelJS rows are 1-indexed; cell values can be { result } / { text } / strings / numbers / formulas.
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        arr[colNumber - 1] = cellValue(cell.value);
      });
      rows.push(arr);
    });

    try {
      const parsed = parseSheet({ tabName: ws.name, rows });
      out.push(parsed);
    } catch (err) {
      // Sheet didn't parse — likely a non-monthly tab. Skip silently;
      // top-level caller will warn if the workbook produced nothing.
      void err;
    }
  }

  return out;
}

function cellValue(v: ExcelJS.CellValue | null): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined && v.result !== null) {
      return cellValue(v.result as ExcelJS.CellValue);
    }
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((p) => p.text).join("");
    }
  }
  return null;
}
