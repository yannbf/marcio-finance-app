/**
 * Synthetic test data — purely fictional. No real bank, merchant, or
 * person names. Numbers chosen to be obviously fake (rounded amounts,
 * IBANs starting with NL00TEST...). Safe to commit, safe to share.
 */

import type { ParsedSheet } from "@/lib/import/types.ts";

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
 */
export const TEST_BUDGET_SHEET: ParsedSheet = {
  anchorYear: 2026,
  anchorMonth: 5,
  warnings: [],
  items: [
    // ENTRADAS — income
    {
      scope: "joint",
      section: "ENTRADAS",
      naturalKey: "salary-joint-pool",
      name: "Salary pool",
      plannedCents: 500000,
      cadence: "monthly",
    },
    // FIXAS — fixed
    {
      scope: "joint",
      section: "FIXAS",
      naturalKey: "rent-fixed",
      name: "Rent",
      plannedCents: -150000,
      cadence: "monthly",
      dueDay: 1,
    },
    {
      scope: "joint",
      section: "FIXAS",
      naturalKey: "utility-bundle",
      name: "Utility bundle",
      plannedCents: -8000,
      cadence: "monthly",
      dueDay: 5,
    },
    // VARIAVEIS — variable
    {
      scope: "joint",
      section: "VARIAVEIS",
      naturalKey: "groceries-shared",
      name: "Groceries",
      plannedCents: -40000,
      cadence: "monthly",
    },
    {
      scope: "joint",
      section: "VARIAVEIS",
      naturalKey: "outings-shared",
      name: "Outings",
      plannedCents: -20000,
      cadence: "monthly",
    },
    {
      scope: "yann",
      section: "VARIAVEIS",
      naturalKey: "yann-personal-spend",
      name: "Yann pocket",
      plannedCents: -10000,
      cadence: "monthly",
    },
    {
      scope: "camila",
      section: "VARIAVEIS",
      naturalKey: "camila-personal-spend",
      name: "Camila pocket",
      plannedCents: -10000,
      cadence: "monthly",
    },
    // SAZONAIS — yearly contributions
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
 * payday-month (2026-04-25 → 2026-05-24). Counterparties are fictional;
 * a few are unmatched so the Inbox has rows to play with.
 */
export const TEST_TRANSACTIONS: Array<{
  accountKey: keyof typeof TEST_ACCOUNTS;
  bookingDate: string; // ISO yyyy-mm-dd
  counterparty: string;
  description: string;
  amountCents: number;
}> = [
  // Joint account — matched via seed rules / clear counterparties
  {
    accountKey: "joint",
    bookingDate: "2026-05-01",
    counterparty: "Acme Property",
    description: "Acme Property monthly rent test",
    amountCents: -150000,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-05",
    counterparty: "Zorp Energy",
    description: "Zorp Energy utility bundle test",
    amountCents: -8000,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-02",
    counterparty: "Foobar Market",
    description: "Foobar Market grocery test",
    amountCents: -3500,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-03",
    counterparty: "Foobar Market",
    description: "Foobar Market grocery test",
    amountCents: -2200,
  },
  // Unmatched (no rule will catch these — they show up in the Inbox)
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
  // Tikkie-shaped txns so /tikkie has data
  {
    accountKey: "joint",
    bookingDate: "2026-05-03",
    counterparty: "Alpha via Tikkie",
    description: "split test alpha",
    amountCents: -1200,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-04",
    counterparty: "Alpha via Tikkie",
    description: "split test alpha 2",
    amountCents: -800,
  },
  {
    accountKey: "joint",
    bookingDate: "2026-05-04",
    counterparty: "Beta via Tikkie",
    description: "split test beta",
    amountCents: 1500,
  },
  // Yann personal
  {
    accountKey: "yannPersonal",
    bookingDate: "2026-04-30",
    counterparty: "Mystery Yann Vendor",
    description: "yann-only unmatched test",
    amountCents: -2000,
  },
  // Camila personal
  {
    accountKey: "camilaPersonal",
    bookingDate: "2026-04-29",
    counterparty: "Mystery Camila Vendor",
    description: "camila-only unmatched test",
    amountCents: -3000,
  },
];

export const PAYDAY_DAY = 25;
