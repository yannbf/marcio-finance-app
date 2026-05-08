/**
 * Re-export shim. The fixture data was moved to `tests/support/` so that
 * the Vitest integration suite can share it with the Playwright E2E
 * suite. Existing imports against this path keep working.
 */
export {
  PAYDAY_DAY,
  TEST_USERS,
  TEST_ACCOUNTS,
  TEST_BUDGET_SHEET,
  TEST_TRANSACTIONS,
} from "../../support/seed-fixtures.ts";
