/**
 * E2E seed runner — wraps `seedTestDatabase()` so Playwright's globalSetup
 * can spawn it as a child process. Reads `DATABASE_URL` from the env that
 * globalSetup set (the PGlite socket URL). Refuses to run without one.
 */

const TARGET_URL = process.env.DATABASE_URL;
if (!TARGET_URL) {
  console.error(
    "[e2e seed] DATABASE_URL is not set. globalSetup is responsible for " +
      "wiring it to a PGlite socket — running seed.ts directly is not " +
      "supported.",
  );
  process.exit(1);
}

async function run() {
  const { seedTestDatabase } = await import("../../support/seed.ts");
  const r = await seedTestDatabase();
  console.log(
    `[e2e seed] inserted ${r.monthInsertResult.inserted} budget items, ` +
      `matched ${r.matched} transactions across ${
        Object.keys(r.accountsByKey).length
      } bank accounts`,
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[e2e seed] FAILED:", err);
    process.exit(1);
  });
