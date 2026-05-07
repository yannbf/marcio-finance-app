/**
 * Idempotent seed routine for both Vitest integration tests and the
 * Playwright E2E suite. Wipes every app table on the configured DB and
 * reinserts the synthetic fixtures from `seed-fixtures.ts`.
 *
 * Reads `DATABASE_URL` from the environment — the caller is responsible
 * for pointing it at a PGlite-backed test database (`startTestPg()` from
 * `pglite-server.ts`) and never at a real DB. There is no second guard
 * here because we no longer rely on a separately-named env var: the test
 * harnesses construct DATABASE_URL themselves and prod code never imports
 * this module.
 */

import { sql } from "drizzle-orm";

export type SeedResult = {
  monthInsertResult: { inserted: number; updated: number; unchanged: number };
  accountsByKey: Record<string, string>;
  matched: number;
};

export async function seedTestDatabase(): Promise<SeedResult> {
  const { db } = await import("../../src/db/index.ts");
  const schema = await import("../../src/db/schema.ts");
  const { upsertParsedMonth } = await import("../../src/lib/import/upsert.ts");
  const { runMatchingForAccount } = await import(
    "../../src/lib/matching/engine.ts"
  );
  const {
    TEST_USERS,
    TEST_ACCOUNTS,
    TEST_BUDGET_SHEET,
    TEST_TRANSACTIONS,
    PAYDAY_DAY,
  } = await import("./seed-fixtures.ts");

  /* ------------------------------------------------------------------ */
  /* 1. Wipe everything in dependency order. Faster than DROP+CREATE.    */
  /* ------------------------------------------------------------------ */
  await db.execute(sql`
    TRUNCATE TABLE
      transaction_match,
      "transaction",
      bank_sync_cursor,
      bank_connection,
      bank_account,
      match_rule,
      savings_account,
      savings_bucket,
      budget_item,
      "month",
      household_setting,
      "session",
      account,
      verification,
      "user"
    RESTART IDENTITY CASCADE;
  `);

  /* ------------------------------------------------------------------ */
  /* 2. Singleton settings.                                              */
  /* ------------------------------------------------------------------ */
  await db
    .insert(schema.householdSetting)
    .values({ id: "singleton", paydayDay: PAYDAY_DAY })
    .onConflictDoUpdate({
      target: schema.householdSetting.id,
      set: { paydayDay: PAYDAY_DAY, updatedAt: new Date() },
    });

  /* ------------------------------------------------------------------ */
  /* 3. Users.                                                           */
  /* ------------------------------------------------------------------ */
  for (const u of Object.values(TEST_USERS)) {
    await db.insert(schema.user).values({
      id: u.id,
      email: u.email,
      emailVerified: true,
      name: u.name,
      role: u.role,
    });
  }

  /* ------------------------------------------------------------------ */
  /* 4. Bank accounts. Capture generated UUIDs by friendly key so we     */
  /*    can wire transactions below.                                     */
  /* ------------------------------------------------------------------ */
  const accountIdByKey = {} as Record<keyof typeof TEST_ACCOUNTS, string>;
  for (const [key, a] of Object.entries(TEST_ACCOUNTS) as [
    keyof typeof TEST_ACCOUNTS,
    (typeof TEST_ACCOUNTS)[keyof typeof TEST_ACCOUNTS],
  ][]) {
    const [row] = await db
      .insert(schema.bankAccount)
      .values({
        iban: a.iban,
        nickname: a.nickname,
        owner: a.owner,
        kind: a.kind,
        bank: a.bank,
      })
      .returning({ id: schema.bankAccount.id });
    accountIdByKey[key] = row.id;
  }

  /* ------------------------------------------------------------------ */
  /* 5. Budget items via the real upsert path.                           */
  /* ------------------------------------------------------------------ */
  const monthInsertResult = await upsertParsedMonth(TEST_BUDGET_SHEET);

  /* ------------------------------------------------------------------ */
  /* 6. Transactions.                                                    */
  /* ------------------------------------------------------------------ */
  const accountIdsTouched = new Set<string>();
  for (const t of TEST_TRANSACTIONS) {
    const accountId = accountIdByKey[t.accountKey];
    accountIdsTouched.add(accountId);
    await db.insert(schema.transaction).values({
      bankAccountId: accountId,
      bookingDate: new Date(`${t.bookingDate}T12:00:00.000Z`),
      counterparty: t.counterparty,
      description: t.description,
      amountCents: t.amountCents,
      dedupeKey: `${t.bookingDate}-${t.amountCents}-${t.counterparty}`.slice(
        0,
        180,
      ),
    });
  }

  /* ------------------------------------------------------------------ */
  /* 7. Run the matching engine across every touched account.           */
  /* ------------------------------------------------------------------ */
  let matched = 0;
  for (const accountId of accountIdsTouched) {
    const r = await runMatchingForAccount(accountId);
    matched += r.matched;
  }

  return {
    monthInsertResult: {
      inserted: monthInsertResult.inserted,
      updated: monthInsertResult.updated,
      unchanged: monthInsertResult.unchanged,
    },
    accountsByKey: accountIdByKey,
    matched,
  };
}
