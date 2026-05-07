/**
 * Heuristic seed rules — derived from real ING NL transaction patterns.
 * These ship with the app and run on every CSV upload.
 *
 * Rules are scoped to one or more account owners so a Coffee Room charge on
 * Yann's personal card never gets attributed to the joint Mercado bucket.
 *
 * Confidence drives ordering when multiple rules match the same transaction:
 * the highest wins. 0.95 = brand-perfect match, 0.7 = name fuzzy.
 *
 * Rules resolve to a budget_item by (month, scope, section, naturalKey).
 * If the target item doesn't exist for the active month, the rule is skipped
 * — it'll auto-apply once the sheet for that month is imported.
 */

import type { Scope, Section } from "../import/types.ts";

export type SeedRule = {
  /** Regex against the lowercased counterparty + description blob. */
  pattern: RegExp;
  /** Owners this rule applies to. */
  scopes: Scope[];
  /** Target budget item. naturalKey is matched against the slug we generate
   * for sheet items, so this MUST match what slugify() emits. */
  section: Section;
  naturalKey: string;
  /** Optional amount filter in cents. Useful when two charges have the
   * same counterparty but different downstream items (Plano saúde × 2). */
  minAbsCents?: number;
  maxAbsCents?: number;
  /** 0..1 — higher beats lower when multiple rules fire. */
  confidence: number;
  /** Internal tag for explainability in the UI ("matched: AH groceries"). */
  label: string;
};

/* -------------------------------------------------------------------------- */
/* Joint account                                                               */
/* -------------------------------------------------------------------------- */

const JOINT: SeedRule[] = [
  // Groceries / supermarket
  {
    pattern: /albert\s*heijn|\bah\s+(to\s+go|amsterdam)|slagerij|bomies\s*fd|simit\s*paleis|paindemie/i,
    scopes: ["joint"],
    section: "VARIAVEIS",
    naturalKey: "mercado",
    confidence: 0.9,
    label: "Mercado / supermarket",
  },
  // General shopping & drugstore
  {
    pattern: /kruidvat|\bbol\.?com\b|\btemu\b|\bmundi\b/i,
    scopes: ["joint"],
    section: "VARIAVEIS",
    naturalKey: "compras-geral",
    confidence: 0.85,
    label: "Compras geral",
  },
  // Outings (couple) — the SumUp & MIUZ-Overtoom kind of small-merchant card hits
  {
    pattern: /sumup|miuz\s*overtoom/i,
    scopes: ["joint"],
    section: "VARIAVEIS",
    naturalKey: "saidas-casal",
    confidence: 0.7,
    label: "Saídas casal",
  },
  // Mortgage
  {
    pattern: /ing\s*hypotheken/i,
    scopes: ["joint"],
    section: "DIVIDAS",
    naturalKey: "mortgage",
    confidence: 0.98,
    label: "Mortgage",
  },
  // VVE
  {
    pattern: /vve\s*de\s*meester|vve\b.*derkinderen/i,
    scopes: ["joint"],
    section: "FIXAS",
    naturalKey: "vve",
    confidence: 0.97,
    label: "VVE",
  },
  // Energy
  {
    pattern: /vattenfall/i,
    scopes: ["joint"],
    section: "FIXAS",
    naturalKey: "eletricidade-aquecimento",
    confidence: 0.95,
    label: "Eletricidade + Aquecimento",
  },
  // Health insurance — Yann's premium (~€159.75 in current data).
  // Tighten the ceiling below Camila's floor so the two premiums don't overlap.
  {
    pattern: /vgz\s*zorgverzekeraar/i,
    scopes: ["joint"],
    section: "FIXAS",
    naturalKey: "plano-saude-yann",
    minAbsCents: 14000,
    maxAbsCents: 16100,
    confidence: 0.93,
    label: "Plano saúde Yann",
  },
  // Health insurance — Camila's premium (~€162.84 in current data).
  {
    pattern: /vgz\s*zorgverzekeraar/i,
    scopes: ["joint"],
    section: "FIXAS",
    naturalKey: "plano-saude-camila",
    minAbsCents: 16200,
    maxAbsCents: 17500,
    confidence: 0.94,
    label: "Plano saúde Camila",
  },
  // Internet KPN
  {
    pattern: /\bkpn\b/i,
    scopes: ["joint"],
    section: "FIXAS",
    naturalKey: "internet-kpn-1000mb",
    confidence: 0.95,
    label: "Internet KPN",
  },
  // Internet Ziggo (alternative ISP)
  {
    pattern: /ziggo/i,
    scopes: ["joint"],
    section: "FIXAS",
    naturalKey: "internet-ziggo",
    confidence: 0.95,
    label: "Internet Ziggo",
  },
  // Energy — Eneco (alternative to Vattenfall)
  {
    pattern: /\beneco\b/i,
    scopes: ["joint"],
    section: "FIXAS",
    naturalKey: "eletricidade-aquecimento",
    confidence: 0.93,
    label: "Eletricidade + Aquecimento (Eneco)",
  },
  // Public transport — GVB (Amsterdam transit operator)
  {
    pattern: /\bgvb\b/i,
    scopes: ["joint"],
    section: "VARIAVEIS",
    naturalKey: "transporte",
    confidence: 0.85,
    label: "Transporte GVB",
  },
  // Food delivery (joint outings)
  {
    pattern: /takeaway|thuisbezorgd|deliveroo/i,
    scopes: ["joint"],
    section: "VARIAVEIS",
    naturalKey: "saidas-casal",
    confidence: 0.8,
    label: "Takeaway / delivery",
  },
  // Drug stores beyond Kruidvat
  {
    pattern: /\betos\b/i,
    scopes: ["joint"],
    section: "VARIAVEIS",
    naturalKey: "compras-geral",
    confidence: 0.85,
    label: "Etos",
  },
  // Discount retailer
  {
    pattern: /\baction\b/i,
    scopes: ["joint"],
    section: "VARIAVEIS",
    naturalKey: "compras-geral",
    confidence: 0.82,
    label: "Action",
  },
  // Department / electronics — usually a higher-value treat purchase
  {
    pattern: /coolblue|bijenkorf|hema/i,
    scopes: ["joint"],
    section: "VARIAVEIS",
    naturalKey: "compras-geral",
    confidence: 0.78,
    label: "Lojas (Coolblue/Bijenkorf/HEMA)",
  },
  // Tax authority — Belastingdienst direct lines (most often Reembolso Juros
  // when it's a credit; for debits we tag it as a SAZONAIS tax line)
  {
    pattern: /belastingdienst/i,
    scopes: ["joint"],
    section: "ENTRADAS",
    naturalKey: "reembolso-juros",
    confidence: 0.85,
    label: "Belastingdienst (refund)",
  },
  // Water
  {
    pattern: /waternet|drinkwater/i,
    scopes: ["joint"],
    section: "FIXAS",
    naturalKey: "agua",
    confidence: 0.9,
    label: "Água",
  },
  // Cleaning
  {
    pattern: /\bfaxina\b|housekeeper/i,
    scopes: ["joint"],
    section: "FIXAS",
    naturalKey: "faxina",
    confidence: 0.7,
    label: "Faxina",
  },
  // ING admin fee
  {
    pattern: /ing\s*basic\s*current|ing\s*kosten|account\s*fee/i,
    scopes: ["joint"],
    section: "FIXAS",
    naturalKey: "custos-admin-conta-ing",
    confidence: 0.9,
    label: "Custos admin conta ING",
  },
  // Income — Yann's salary contribution to joint
  {
    pattern: /y\s*bezerra\s*braga\s*ferreira|contrib\s*(yann|maio|junho|julho)/i,
    scopes: ["joint"],
    section: "ENTRADAS",
    naturalKey: "contrib-yann",
    confidence: 0.9,
    label: "Contrib. Yann",
  },
  // Income — Camila's salary contribution to joint
  {
    pattern: /c\s*ferrer\s*bezerra\s*loureiro|contribuicao\s*(maio|junho|julho)/i,
    scopes: ["joint"],
    section: "ENTRADAS",
    naturalKey: "contrib-camila",
    confidence: 0.9,
    label: "Contrib. Camila",
  },
  // Reembolso Juros (mortgage interest tax refund from Belastingdienst)
  {
    pattern: /belastingdienst.*hyp|reembolso\s*juros|hypotheekrente/i,
    scopes: ["joint"],
    section: "ENTRADAS",
    naturalKey: "reembolso-juros",
    confidence: 0.92,
    label: "Reembolso Juros",
  },
];

/* -------------------------------------------------------------------------- */
/* Tikkie — applies to every scope (joint + personal). Tikkie is a Dutch       */
/* social-payment rail: split-the-bill with friends, pay back / get paid for   */
/* small services. We surface them under their own bucket so Insights can      */
/* aggregate by counterparty (who you paid / received from).                   */
/* -------------------------------------------------------------------------- */

// Tikkie routes to whichever "out with friends" line exists per scope.
// Joint → Saídas casal · Yann → Saídas · Camila → Saídas/compras.
// If the user later adds a dedicated "Tikkie" line, they can re-assign one
// transaction via the Inbox + "remember rule" and the learned rule will
// outrank these going forward.
const TIKKIE_RULES: SeedRule[] = [
  {
    pattern: /\btikkie\b|aab\s*inz\s*tikkie/i,
    scopes: ["joint"],
    section: "VARIAVEIS",
    naturalKey: "saidas-casal",
    confidence: 0.72,
    label: "Tikkie (joint)",
  },
  {
    pattern: /\btikkie\b|aab\s*inz\s*tikkie/i,
    scopes: ["yann"],
    section: "VARIAVEIS",
    naturalKey: "saidas",
    confidence: 0.72,
    label: "Tikkie (Yann)",
  },
  {
    pattern: /\btikkie\b|aab\s*inz\s*tikkie/i,
    scopes: ["camila"],
    section: "VARIAVEIS",
    naturalKey: "saidas-compras",
    confidence: 0.72,
    label: "Tikkie (Camila)",
  },
];

/* -------------------------------------------------------------------------- */
/* Yann personal                                                               */
/* -------------------------------------------------------------------------- */

const YANN: SeedRule[] = [
  // Public transport (OV-pay)
  {
    pattern: /ovpay|nlov\w+\s*www\.ovpay/i,
    scopes: ["yann"],
    section: "FIXAS",
    naturalKey: "transporte-yann-trem-bus",
    confidence: 0.95,
    label: "Transporte (Trem+Bus)",
  },
  // Therapy
  {
    pattern: /martins\s*morais|terapia|psicolog/i,
    scopes: ["yann"],
    section: "FIXAS",
    naturalKey: "terapia",
    confidence: 0.9,
    label: "Terapia",
  },
  // International transfers (Wise) — typically Ajuda família
  {
    pattern: /\bwise\b/i,
    scopes: ["yann"],
    section: "FIXAS",
    naturalKey: "ajuda-familia",
    confidence: 0.7,
    label: "Ajuda família (via Wise)",
  },
  // Credit card transfer
  {
    pattern: /transfer\s*to\s*credit\s*card|^creditcard$/i,
    scopes: ["yann"],
    section: "VARIAVEIS",
    naturalKey: "cartao",
    confidence: 0.95,
    label: "Cartão",
  },
  // iCloud
  {
    pattern: /apple\.?com\/bill|apple\s*icloud/i,
    scopes: ["yann"],
    section: "FIXAS",
    naturalKey: "apple-icloud",
    confidence: 0.95,
    label: "Apple iCloud",
  },
  // HBO
  {
    pattern: /\bhbo\b|max\.com/i,
    scopes: ["yann"],
    section: "FIXAS",
    naturalKey: "hbo-max",
    confidence: 0.9,
    label: "HBO Max",
  },
  // Nubank costs
  {
    pattern: /nubank|nu\s*pagamentos/i,
    scopes: ["yann"],
    section: "FIXAS",
    naturalKey: "custos-nubank",
    confidence: 0.9,
    label: "Custos Nubank",
  },
  // Forró classes / outings
  {
    pattern: /\bforr[oó]\b|samba/i,
    scopes: ["yann"],
    section: "VARIAVEIS",
    naturalKey: "forro",
    confidence: 0.8,
    label: "Forró",
  },
  // Generic outings — cafés, bars, small merchants
  {
    pattern: /coffee\s*room|sumup|paindemie|simit/i,
    scopes: ["yann"],
    section: "VARIAVEIS",
    naturalKey: "saidas",
    confidence: 0.7,
    label: "Saídas",
  },
];

/* -------------------------------------------------------------------------- */
/* Camila personal                                                             */
/* -------------------------------------------------------------------------- */

const CAMILA: SeedRule[] = [
  {
    pattern: /odido|tele2|simyo/i,
    scopes: ["camila"],
    section: "FIXAS",
    naturalKey: "celular-odido",
    confidence: 0.9,
    label: "Celular Odido",
  },
  {
    pattern: /\bovpay\b/i,
    scopes: ["camila"],
    section: "FIXAS",
    naturalKey: "transporte",
    confidence: 0.9,
    label: "Transporte",
  },
  {
    pattern: /chat\s*gpt|openai/i,
    scopes: ["camila"],
    section: "FIXAS",
    naturalKey: "chat-gpt",
    confidence: 0.95,
    label: "Chat GPT",
  },
  {
    pattern: /hp\s*smart|hp\s*instant/i,
    scopes: ["camila"],
    section: "FIXAS",
    naturalKey: "hp-smart",
    confidence: 0.95,
    label: "HP Smart",
  },
  // Generic outings/shopping
  {
    pattern: /sephora|bershka|zara|zalando|hema|action/i,
    scopes: ["camila"],
    section: "VARIAVEIS",
    naturalKey: "saidas-compras",
    confidence: 0.7,
    label: "Saídas / compras",
  },
  // Laser hair removal
  {
    pattern: /depila|laser/i,
    scopes: ["camila"],
    section: "VARIAVEIS",
    naturalKey: "depilacao-laser",
    confidence: 0.85,
    label: "Depilação Laser",
  },
];

/* -------------------------------------------------------------------------- */

export const SEED_RULES: SeedRule[] = [
  ...JOINT,
  ...YANN,
  ...CAMILA,
  // Tikkie last — generic catch-all that runs only when nothing else matched
  // (the engine picks highest confidence regardless of order, so the lower
  // 0.72 here only wins when no merchant-specific rule applies).
  ...TIKKIE_RULES,
];

/**
 * Detect ING round-up "Afronding" transfers — small (sub-€2) automated
 * sweeps to a specific savings account. Worth filtering from the Inbox so
 * they don't drown out real transactions, but still recorded.
 */
export const AFRONDING_PATTERN =
  /afronding|notprovided.*spaarrekening|round\s*up/i;

/**
 * Postgres-flavored equivalent of AFRONDING_PATTERN. JS `\s` becomes
 * literal `s` under POSIX regex (`~*`); use a character class instead.
 * The `.*` flavor is fine — POSIX supports it identically.
 */
export const AFRONDING_PG_PATTERN =
  "afronding|notprovided.*spaarrekening|round[[:space:]]*up";

/**
 * Identify an internal household transfer between Yann's/Camila's personal
 * accounts and the joint account. These show up as outflows on the personal
 * side and inflows on the joint side — but they are *not* spending. Match
 * either account holder's name, or the explicit "contrib(ution)" wording the
 * couple uses in transfer descriptions. The pattern targets the same shape
 * as the JOINT income seed rules above (Y/C ... ferreira / loureiro,
 * "contrib(uicao)"), so excluding it from spent figures cancels out the
 * pair without affecting any merchant transactions.
 */
export const INTERNAL_TRANSFER_PG_PATTERN =
  "y[[:space:]]*bezerra[[:space:]]*braga[[:space:]]*ferreira|c[[:space:]]*ferrer[[:space:]]*bezerra[[:space:]]*loureiro|contribu(icao|ition|ic|tion)|contrib[[:space:]]*(yann|camila|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|janeiro|fevereiro|marco|abril)";

/**
 * Identify a counterparty as a savings-bucket transfer.
 * Returns the bucket reference id when it matches.
 */
export function detectSavingsBucketRef(text: string): string | null {
  const m = text.match(
    /spaarrekening\s+([NVA]\d{8})/i,
  );
  return m ? m[1] : null;
}
