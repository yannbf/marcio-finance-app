import type {
  Cadence,
  ParsedItem,
  ParsedSheet,
  Scope,
  Section,
  SazonalKind,
} from "./types.ts";
import { slugify } from "./slug.ts";
import { parseTabName } from "./tab-name.ts";

/**
 * Parse the Yann/Camila planning sheet into a normalized shape.
 *
 * The sheet layout is three "Fotografia do Mês" snapshots stacked vertically
 * (Conjunta, Camila, Yann). Each snapshot has the same column groups:
 *
 *   col B  | col C   col D   col E   |  col F  | col G   col H   |  col J | col K  col L  |  col N | col O   col P
 *   ENTR.  | name    amount  ratio   |  FIXAS  | name    amount  |  VAR.  | name   amount |  SAZ.  | name    amount
 *
 * The left column group rotates between ENTRADAS / DÍVIDAS / ECONOMIAS as you
 * scan top-to-bottom in the snapshot — detected by section-label rows.
 *
 * SAZONAIS items carry an O/L marker in col N (Obrigatório vs Lazer).
 * DÍVIDAS items carry a due day in col B (e.g. mortgage on the 1st).
 */

type Cell = string | number | null | undefined;
type Row = Cell[];

const SECTION_LABEL_COL = 1; // col B
const ENTRY_NAME_COL = 2; // col C
const ENTRY_AMOUNT_COL = 3; // col D
const ENTRY_RATIO_COL = 4; // col E
const FIXAS_NAME_COL = 6; // col G
const FIXAS_AMOUNT_COL = 7; // col H
const VAR_NAME_COL = 10; // col K
const VAR_AMOUNT_COL = 11; // col L
const SAZ_KIND_COL = 13; // col N
const SAZ_NAME_COL = 14; // col O
const SAZ_AMOUNT_COL = 15; // col P

const TOTAL_TOKENS = new Set([
  "total",
  "total no mes",
  "total no mês",
  "por ano",
  "por mes",
  "por mês",
  "por semana",
]);

const SCOPE_LABELS: Record<string, Scope> = {
  conjunta: "joint",
  conjunto: "joint",
  joint: "joint",
  camila: "camila",
  yann: "yann",
};

export function parseSheet(opts: {
  tabName: string;
  rows: Row[];
}): ParsedSheet {
  const warnings: string[] = [];
  const tab = parseTabName(opts.tabName);
  if (!tab) {
    throw new Error(
      `Could not parse tab name "${opts.tabName}" — expected something like "Custos Maio 2026".`,
    );
  }

  const snapshots = findSnapshots(opts.rows);
  if (snapshots.length === 0) {
    throw new Error("No 'FOTOGRAFIA DO MÊS' rows found — is this the right tab?");
  }

  const items: ParsedItem[] = [];
  for (const snap of snapshots) {
    parseSnapshot({
      scope: snap.scope,
      rows: opts.rows,
      startRow: snap.startRow,
      endRow: snap.endRow,
      out: items,
      warnings,
    });
  }

  return {
    anchorYear: tab.year,
    anchorMonth: tab.month,
    items,
    warnings,
  };
}

/* -------------------------------------------------------------------------- */

type SnapshotRange = {
  scope: Scope;
  startRow: number; // inclusive
  endRow: number; // exclusive
};

function findSnapshots(rows: Row[]): SnapshotRange[] {
  const headers: { scope: Scope; row: number }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cell = stringify(rows[i]?.[SECTION_LABEL_COL]);
    if (!cell.toLowerCase().startsWith("fotografia do m")) continue;
    const m = cell.match(/\(([^)]+)\)/);
    if (!m) continue;
    const label = stripDiacritics(m[1].trim().toLowerCase());
    const scope = SCOPE_LABELS[label];
    if (scope) headers.push({ scope, row: i });
  }

  return headers.map((h, idx) => ({
    scope: h.scope,
    startRow: h.row + 1,
    endRow: idx + 1 < headers.length ? headers[idx + 1].row : rows.length,
  }));
}

/* -------------------------------------------------------------------------- */

function parseSnapshot(args: {
  scope: Scope;
  rows: Row[];
  startRow: number;
  endRow: number;
  out: ParsedItem[];
  warnings: string[];
}) {
  const { scope, rows, startRow, endRow, out, warnings } = args;

  // The left column group rotates: ENTRADAS → DÍVIDAS → ECONOMIAS.
  // Detected by section-label rows that put the section name in col B.
  let leftSection: Section = "ENTRADAS";

  // VARIÁVEIS section may be tagged "POR MÊS" (joint) or "POR SEMANA" (personal).
  // The "POR SEMANA" totals row at the bottom of the var column hints cadence,
  // but we also recognize it from snapshot scope: personal scopes default weekly.
  const varCadence: Cadence = scope === "joint" ? "monthly" : "weekly";

  for (let i = startRow; i < endRow; i++) {
    const row = rows[i];
    if (!row) continue;

    // Section-label row in the left group?
    const leftLabel = stringify(row[SECTION_LABEL_COL]).toUpperCase();
    if (leftLabel === "ENTRADAS") {
      leftSection = "ENTRADAS";
      continue;
    }
    if (leftLabel === "DIVIDAS" || leftLabel === "DÍVIDAS") {
      leftSection = "DIVIDAS";
      continue;
    }
    if (leftLabel === "ECONOMIAS") {
      leftSection = "ECONOMIAS";
      continue;
    }

    // Left column group (varies by leftSection)
    parseLeftItem({ row, scope, leftSection, out, warnings });

    // FIXAS
    parseSimpleItem({
      row,
      scope,
      section: "FIXAS",
      nameCol: FIXAS_NAME_COL,
      amountCol: FIXAS_AMOUNT_COL,
      cadence: "monthly",
      out,
      warnings,
    });

    // VARIÁVEIS
    parseSimpleItem({
      row,
      scope,
      section: "VARIAVEIS",
      nameCol: VAR_NAME_COL,
      amountCol: VAR_AMOUNT_COL,
      cadence: varCadence,
      out,
      warnings,
    });

    // SAZONAIS — has a kind marker in col N
    parseSazonalItem({ row, scope, out, warnings });
  }
}

function parseLeftItem(args: {
  row: Row;
  scope: Scope;
  leftSection: Section;
  out: ParsedItem[];
  warnings: string[];
}) {
  const { row, scope, leftSection, out } = args;
  const name = stringify(row[ENTRY_NAME_COL]);
  if (!name || isTotalToken(name)) return;

  const amount = parseAmount(row[ENTRY_AMOUNT_COL]);
  // For ENTRADAS/ECONOMIAS empty amounts are tolerated (e.g. Reembolso Juros
  // is written in but its amount lands later from belastingdienst).
  // For DÍVIDAS we still record the planned amount as 0 if missing, so the
  // app can match the actual transfer later.
  const cents = amount === null ? 0 : Math.round(amount * 100);

  const item: ParsedItem = {
    scope,
    section: leftSection,
    naturalKey: slugify(name),
    name,
    plannedCents: cents,
    cadence: "monthly",
  };

  if (leftSection === "DIVIDAS") {
    const due = parseDueDay(row[SECTION_LABEL_COL]);
    if (due !== null) item.dueDay = due;
  }

  if (leftSection === "ENTRADAS") {
    const ratio = parseRatio(row[ENTRY_RATIO_COL]);
    if (ratio !== null) item.contributionRatio = ratio;
  }

  out.push(item);
}

function parseSimpleItem(args: {
  row: Row;
  scope: Scope;
  section: Section;
  nameCol: number;
  amountCol: number;
  cadence: Cadence;
  out: ParsedItem[];
  warnings: string[];
}) {
  const { row, scope, section, nameCol, amountCol, cadence, out } = args;
  const name = stringify(row[nameCol]);
  if (!name || isTotalToken(name)) return;

  const amount = parseAmount(row[amountCol]);
  if (amount === null) return; // empty row in this column group

  out.push({
    scope,
    section,
    naturalKey: slugify(name),
    name,
    plannedCents: Math.round(amount * 100),
    cadence,
  });
}

function parseSazonalItem(args: {
  row: Row;
  scope: Scope;
  out: ParsedItem[];
  warnings: string[];
}) {
  const { row, scope, out, warnings } = args;
  const name = stringify(row[SAZ_NAME_COL]);
  if (!name || isTotalToken(name)) return;
  const amount = parseAmount(row[SAZ_AMOUNT_COL]);
  if (amount === null) return; // not yet decided (e.g. "Viagem grande - vamos pensar")

  const kindRaw = stringify(row[SAZ_KIND_COL]).toUpperCase();
  let sazonalKind: SazonalKind | undefined;
  if (kindRaw === "O") sazonalKind = "O";
  else if (kindRaw === "L") sazonalKind = "L";
  else {
    warnings.push(
      `SAZONAIS row "${name}" has no O/L marker — defaulting to L (lazer).`,
    );
    sazonalKind = "L";
  }

  out.push({
    scope,
    section: "SAZONAIS",
    naturalKey: slugify(name),
    name,
    plannedCents: Math.round(amount * 100),
    cadence: "yearly",
    sazonalKind,
  });
}

/* -------------------------------------------------------------------------- */

function stringify(c: Cell): string {
  if (c === null || c === undefined) return "";
  return String(c).trim();
}

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function isTotalToken(s: string): boolean {
  return TOTAL_TOKENS.has(stripDiacritics(s).toLowerCase().trim());
}

function parseAmount(c: Cell): number | null {
  if (c === null || c === undefined || c === "") return null;
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const s = String(c)
    .replace(/[€\s]/g, "")
    .replace(",", ".");
  if (s === "") return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseRatio(c: Cell): number | null {
  const n = parseAmount(c);
  if (n === null) return null;
  if (n < 0 || n > 1) return null;
  return n;
}

function parseDueDay(c: Cell): number | null {
  const n = parseAmount(c);
  if (n === null) return null;
  const day = Math.round(n);
  if (day < 1 || day > 31) return null;
  return day;
}
