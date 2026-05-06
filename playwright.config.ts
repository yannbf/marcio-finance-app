import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Marcio's E2E tests.
 *
 * Setup expectations:
 *   - MARCIO_E2E_DATABASE_URL must point at a Postgres you're happy to wipe
 *     (a dedicated Neon branch is the intended setup). Required.
 *   - MARCIO_DEV_AS=yann is forced for the dev server so tests bypass real
 *     OAuth.
 *
 * Run:
 *   pnpm test:e2e             headless
 *   pnpm test:e2e:ui          interactive
 *   pnpm test:e2e:seed        wipe + reseed only
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const TEST_DB = process.env.MARCIO_E2E_DATABASE_URL;
if (!TEST_DB) {
  // Don't crash here — let the global-setup print a clean message. Just
  // warn loudly so CI noise points at the right thing.
  // eslint-disable-next-line no-console
  console.warn(
    "[playwright] MARCIO_E2E_DATABASE_URL is not set. The test run will fail in globalSetup.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,        // share one DB → sequential is safer
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  globalSetup: "./tests/e2e/setup/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["iPhone 14"],
        // The app is mobile-first and uses dvh units — keep the iOS
        // viewport but drop touch quirks that complicate testing.
        hasTouch: false,
        isMobile: false,
      },
    },
  ],
  webServer: {
    command: `pnpm dev -p ${PORT}`,
    url: `${BASE_URL}/en/sign-in`,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
    env: {
      // Bypass Google OAuth for the test run — middleware sees this and
      // skips the redirect, getCurrentUser returns the synthetic user.
      MARCIO_DEV_AS: "yann",
      DATABASE_URL: TEST_DB ?? "",
      // i18n cookie etc. don't carry between server restarts; tests set
      // their own cookies/state where needed.
      NODE_ENV: "development",
    },
  },
});
