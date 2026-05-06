/**
 * E2E test seeding. Wipes the configured Postgres (transactions, matches,
 * accounts, budget items, months, settings, users, sessions, accounts,
 * verifications) and reinserts the synthetic fixtures from
 * tests/e2e/fixtures/seed-data.ts.
 *
 * GATED: refuses to run unless MARCIO_E2E_DATABASE_URL is set. This must
 * point at a DB you're happy to wipe (a dedicated Neon branch is the
 * intended setup). DATABASE_URL by itself is NOT enough — we don't want
 * to nuke a dev DB by accident.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.test.local" });
loadEnv({ path: ".env.local" });

import { sql } from "drizzle-orm";

const TARGET_URL = process.env.MARCIO_E2E_DATABASE_URL;
if (!TARGET_URL) {
  console.error(
    "[e2e seed] MARCIO_E2E_DATABASE_URL is not set. Refusing to wipe the DB.",
  );
  process.exit(1);
}
process.env.DATABASE_URL = TARGET_URL;

async function run() {
  const { db } = await import("../../../src/db/index.ts");
  const schema = await import("../../../src/db/schema.ts");
  const { upsertParsedMonth } = await import(
    "../../../src/lib/import/upsert.ts"
  );
  const { runMatchingForAccount } = await import(
    "../../../src/lib/matching/engine.ts"
  );
  const {
    TEST_USERS,
    TEST_ACCOUNTS,
    TEST_BUDGET_SHEET,
    TEST_TRANSACTIONS,
    PAYDAY_DAY,
  } = await import("../fixtures/seed-data.ts");

  // 1) Wipe all app tables in dependency order.
  console.log("[e2e seed] wiping target DB...");
  // Truncate everything inside a single transaction for speed.
  await db.execute(sql`
    TRUNCATE TABLE
      tx_match,
      "transaction",
      bank_account,
      match_rule,
      savings_account,
      budget_item,
      "month",
      household_setting,
      "session",
      account,
      verification,
      "user"
    RESTART IDENTITY CASCADE;
  `);

  // 2) Singleton settings.
  await db
    .insert(schema.householdSetting)
    .values({ id: "singleton", paydayDay: PAYDAY_DAY })
    .onConflictDoUpdate({
      target: schema.householdSetting.id,
      set: { paydayDay: PAYDAY_DAY, updatedAt: new Date() },
    });

  // 3) Users.
  for (const u of Object.values(TEST_USERS)) {
    await db.insert(schema.user).values({
      id: u.id,
      email: u.email,
      emailVerified: true,
      name: u.name,
      role: u.role,
    });
  }
  console.log(`[e2e seed] inserted ${Object.keys(TEST_USERS).length} users`);

  // 4) Bank accounts. IDs are auto-generated UUIDs — capture them so we
  //    can wire transactions to the right account by friendly key below.
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
  console.log(
    `[e2e seed] inserted ${Object.keys(TEST_ACCOUNTS).length} bank accounts`,
  );

  // 5) Budget items via the real upsert path.
  const r = await upsertParsedMonth(TEST_BUDGET_SHEET);
  console.log(
    `[e2e seed] upserted budget month ${TEST_BUDGET_SHEET.anchorYear}-` +
      `${String(TEST_BUDGET_SHEET.anchorMonth).padStart(2, "0")}: ` +
      `${r.inserted} new · ${r.updated} updated · ${r.unchanged} unchanged`,
  );

  // 6) Transactions.
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
      // dedupeKey is set automatically by the schema default? if not, supply.
      dedupeKey: `${t.bookingDate}-${t.amountCents}-${t.counterparty}`.slice(
        0,
        180,
      ),
      currency: "EUR",
    });
  }
  console.log(
    `[e2e seed] inserted ${TEST_TRANSACTIONS.length} transactions across ${accountIdsTouched.size} accounts`,
  );

  // 7) Match each touched account so the Inbox/Activity/Insights pages
  //    have realistic state.
  for (const accountId of accountIdsTouched) {
    const matchRes = await runMatchingForAccount(accountId);
    console.log(
      `[e2e seed] matching ${accountId}: ${matchRes.matched} matched · ${matchRes.skippedNoBudget} skipped`,
    );
  }

  console.log("[e2e seed] done.");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[e2e seed] FAILED:", err);
    process.exit(1);
  });
