/**
 * Synthetic test fixtures, shared between Vitest integration suites and
 * the Playwright E2E suite. Purely fictional — no real bank, merchant, or
 * person names. IBANs all start with `NL00TEST`. Numbers are obviously
 * round/fake. Safe to commit, safe to share.
 *
 * The shape mirrors what the production importers (Google Sheets / xlsx)
 * would produce, so reusing the existing upsert path stays representative.
 */

import type { ParsedSheet } from "@/lib/import/types.ts";

export const PAYDAY_DAY = 25;

export const TEST_USERS = {
  yann: {
    id: "test-user-yann",
    email: "tester-yann@test.local",
    name: "Tester Yann",
    role: "yann" as const,
  },
  camila: {
    id: "test-user-camila",
    email: "tester-camila@test.local",
    name: "Tester Camila",
    role: "camila" as const,
  },
};

export const TEST_ACCOUNTS = {
  joint: {
    iban: "NL00TEST0000000001",
    nickname: "Joint Test Checking",
    owner: "joint" as const,
    kind: "checking" as const,
    bank: "TestBank",
  },
  yannPersonal: {
    iban: "NL00TEST0000000002",
    nickname: "Yann Test Personal",
    owner: "yann" as const,
    kind: "checking" as const,
    bank: "TestBank",
  },
  camilaPersonal: {
    iban: "NL00TEST0000000003",
    nickname: "Camila Test Personal",
    owner: "camila" as const,
    kind: "checking" as const,
    bank: "TestBank",
  },
};

/**
 * Budget items, organized as a ParsedSheet so we can reuse the existing
 * upsert path. Anchor month is fixed to 2026-05 (the same payday-month
 * the codebase points at "today" — 2026-05-06).
 *
 * The `naturalKey`s here intentionally line up with what the seed-rule
 * patterns in `src/lib/matching/seed-rules.ts` resolve to (mercado,
 * compras-geral, saidas-casal, mortgage, vve, eletricidade-aquecimento,
 * etc.) so the matching-engine tests can exercise the real production
 * rules end-to-end against a representative budget.
 */
export const TEST_BUDGET_SHEET: ParsedSheet = {
  anchorYear: 2026,
  anchorMonth: 5,
  warnings: [],
  items: [
    /* ENTRADAS — income */
    {
      scope: "joint",
      section: "ENTRADAS",
      naturalKey: "contrib-yann",
      name: "Contrib. Yann",
      plannedCents: 250000,
      cadence: "monthly",
    },
    {
      scope: "joint",
      section: "ENTRADAS",
      naturalKey: "contrib-camila",
      name: "Contrib. Camila",
      plannedCents: 250000,
      cadence: "monthly",
    },
    {
      scope: "joint",
      section: "ENTRADAS",
      naturalKey: "reembolso-juros",
      name: "Reembolso Juros",
      plannedCents: 30000,
      cadence: "monthly",
    },

    /* DIVIDAS */
    {
      scope: "joint",
      section: "DIVIDAS",
      naturalKey: "mortgage",
      name: "Mortgage",
      plannedCents: -120000,
      cadence: "monthly",
      dueDay: 1,
    },

    /* FIXAS — fixed monthly */
    {
      scope: "joint",
      section: "FIXAS",
      naturalKey: "vve",
      name: "VVE",
      plannedCents: -25000,
      cadence: "monthly",
      dueDay: 1,
    },
    {
      scope: "joint",
      section: "FIXAS",
      naturalKey: "internet-kpn-1000mb",
      name: "Internet KPN",
      plannedCents: -5500,
      cadence: "monthly",
    },
    {
      scope: "joint",
      section: "FIXAS",
      naturalKey: "eletricidade-aquecimento",
      name: "Eletricidade + Aquecimento",
      plannedCents: -8000,
      cadence: "monthly",
      dueDay: 5,
    },
    {
      scope: "joint",
      section: "FIXAS",
      naturalKey: "agua",
      name: "Água",
      plannedCents: -2000,
      cadence: "monthly",
    },
    {
      scope: "joint",
      section: "FIXAS",
      naturalKey: "plano-saude-yann",
      name: "Plano saúde Yann",
      plannedCents: -15975,
      cadence: "monthly",
    },
    {
      scope: "joint",
      section: "FIXAS",
      naturalKey: "plano-saude-camila",
      name: "Plano saúde Camila",
      plannedCents: -16284,
      cadence: "monthly",
    },

    /* VARIAVEIS — joint */
    {
      scope: "joint",
      section: "VARIAVEIS",
      naturalKey: "mercado",
      name: "Mercado",
      plannedCents: -40000,
      cadence: "monthly",
    },
    {
      scope: "joint",
      section: "VARIAVEIS",
      naturalKey: "saidas-casal",
      name: "Saídas casal",
      plannedCents: -20000,
      cadence: "monthly",
    },
    {
      scope: "joint",
      section: "VARIAVEIS",
      naturalKey: "compras-geral",
      name: "Compras geral",
      plannedCents: -15000,
      cadence: "monthly",
    },
    {
      scope: "joint",
      section: "VARIAVEIS",
      naturalKey: "transporte",
      name: "Transporte",
      plannedCents: -5000,
      cadence: "monthly",
    },

    /* VARIAVEIS — personal */
    {
      scope: "yann",
      section: "VARIAVEIS",
      naturalKey: "saidas",
      name: "Saídas",
      plannedCents: -10000,
      cadence: "monthly",
    },
    {
      scope: "camila",
      section: "VARIAVEIS",
      naturalKey: "saidas-compras",
      name: "Saídas / compras",
      plannedCents: -10000,
      cadence: "monthly",
    },

    /* SAZONAIS — yearly contributions */
    {
      scope: "joint",
      section: "SAZONAIS",
      naturalKey: "yearly-tax-pot",
      name: "Yearly tax pot",
      plannedCents: -120000,
      cadence: "yearly",
      sazonalKind: "O",
    },
    {
      scope: "joint",
      section: "SAZONAIS",
      naturalKey: "trip-fund",
      name: "Trip fund",
      plannedCents: -240000,
      cadence: "yearly",
      sazonalKind: "L",
    },
  ],
};

/**
 * Synthetic transactions. Booking dates are within the May-2026
 * payday-month (2026-04-25 → 2026-05-24).
 *
 * Counterparties mix three flavours:
 *  - Real production seed-rule keywords (Albert Heijn, ING Hypotheken,
 *    Vattenfall, Tikkie, …) so the matching engine has plenty to chew on.
 *  - "Mystery Vendor N" rows the rules can't possibly catch — these end
 *    up in the Inbox unmatched, which is exactly what the inbox specs
 *    rely on.
 *  - Tikkie-shaped rows so /tikkie has data without leaking real names.
 */
export const TEST_TRANSACTIONS: Array<{
  accountKey: keyof typeof TEST_ACCOUNTS;
  bookingDate: string; // ISO yyyy-mm-dd
  counterparty: string;
  description: string;
  amountCents: number;
}> = [
  /* JOINT — matchable via seed rules */
  {
    accountKey: "joint",
    bookingDate: "2026-05-01",
    counterparty: "ING Hypotheken",
    description: "Mortgage payment May",
    amountCents: -120000,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-05",
    counterparty: "Vattenfall",
    description: "Energy bill May",
    amountCents: -8000,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-02",
    counterparty: "Albert Heijn 1234",
    description: "Albert Heijn AMSTERDAM NLD groceries",
    amountCents: -3500,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-03",
    counterparty: "Albert Heijn 9876",
    description: "Albert Heijn UTRECHT NLD groceries",
    amountCents: -2200,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-04",
    counterparty: "Bol.com",
    description: "Bol.com book purchase",
    amountCents: -2500,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-06",
    counterparty: "VGZ Zorgverzekeraar",
    description: "Health insurance Yann",
    amountCents: -15975,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-06",
    counterparty: "VGZ Zorgverzekeraar",
    description: "Health insurance Camila",
    amountCents: -16284,
  },

  /* JOINT — unmatched (no rule should catch these) */
  {
    accountKey: "joint",
    bookingDate: "2026-05-04",
    counterparty: "Mystery Vendor One",
    description: "no rule should match this 1",
    amountCents: -1500,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-04",
    counterparty: "Mystery Vendor Two",
    description: "no rule should match this 2",
    amountCents: -2500,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-05",
    counterparty: "Mystery Vendor Three",
    description: "no rule should match this 3",
    amountCents: -800,
  },

  /* JOINT — Tikkie-shaped split-the-bill rows */
  {
    accountKey: "joint",
    bookingDate: "2026-05-03",
    counterparty: "AAB INZ TIKKIE",
    description: "Tikkie split with friend Alpha",
    amountCents: -1200,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-04",
    counterparty: "AAB INZ TIKKIE",
    description: "Tikkie split with friend Alpha 2",
    amountCents: -800,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-04",
    counterparty: "AAB INZ TIKKIE",
    description: "Tikkie payback from friend Beta",
    amountCents: 1500,
  },

  /* YANN personal */
  {
    accountKey: "yannPersonal",
    bookingDate: "2026-04-30",
    counterparty: "Mystery Yann Vendor",
    description: "yann-only unmatched test",
    amountCents: -2000,
  },
  {
    accountKey: "yannPersonal",
    bookingDate: "2026-05-01",
    counterparty: "AAB INZ TIKKIE",
    description: "Tikkie outgoing yann",
    amountCents: -500,
  },

  /* CAMILA personal */
  {
    accountKey: "camilaPersonal",
    bookingDate: "2026-04-29",
    counterparty: "Mystery Camila Vendor",
    description: "camila-only unmatched test",
    amountCents: -3000,
  },
  {
    accountKey: "camilaPersonal",
    bookingDate: "2026-05-02",
    counterparty: "AAB INZ TIKKIE",
    description: "Tikkie outgoing camila",
    amountCents: -700,
  },
];
