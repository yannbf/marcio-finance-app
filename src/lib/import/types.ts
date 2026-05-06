/**
 * Domain shapes the parser emits, decoupled from the source (xlsx, Sheets).
 * Amounts are stored in cents, signed (negative = outflow), to match the DB.
 */

export type Scope = "joint" | "camila" | "yann";

export type Section =
  | "ENTRADAS"
  | "DIVIDAS"
  | "ECONOMIAS"
  | "FIXAS"
  | "VARIAVEIS"
  | "SAZONAIS";

export type Cadence = "weekly" | "monthly" | "yearly";

export type SazonalKind = "O" | "L"; // Obrigatório / Lazer

export type ParsedItem = {
  scope: Scope;
  section: Section;
  /** Slug derived from `name` — stable within (scope, section). */
  naturalKey: string;
  name: string;
  /** Signed cents (e.g. -27000 for €-270.00, 519955 for €+5199.55). */
  plannedCents: number;
  cadence: Cadence;
  /** 1..31, only for items with a known due day (e.g. mortgage). */
  dueDay?: number;
  /** O = mandatory/tax, L = leisure/travel — only on SAZONAIS rows. */
  sazonalKind?: SazonalKind;
  /** 0..1 contribution ratio — only on personal salary rows in ENTRADAS. */
  contributionRatio?: number;
};

export type ParsedSheet = {
  /** Source-tab year and month (e.g. "Custos Maio 2026" → 2026, 5). */
  anchorYear: number;
  anchorMonth: number;
  items: ParsedItem[];
  /** Non-fatal issues for the import-preview UI. */
  warnings: string[];
};
