import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load whatever the developer has in `.env.test.local` first (lets you
// override the PGlite port for debugging), then fall back to `.env.local`.
// Neither file is required.
loadEnv({ path: ".env.test.local" });
loadEnv({ path: ".env.local" });

/**
 * Playwright config for Marcio's E2E tests.
 *
 * Test infrastructure:
 *   - The DB is an in-process PGlite instance exposed over a TCP socket via
 *     `pglite-socket`. globalSetup boots it, pushes the schema, runs the
 *     seed, then leaves the socket alive for the duration of the test
 *     run. The Next.js dev server connects to it through DATABASE_URL like
 *     it would any real Postgres — no driver swap, no second branch to
 *     babysit, no cloud dependency.
 *   - Auth: `MARCIO_DEV_AS=yann` short-circuits OAuth in non-prod builds.
 *
 * Override `MARCIO_E2E_PG_PORT` if 5544 collides with something else on
 * the host. Otherwise everything is zero-config.
 *
 * Run:
 *   pnpm test:e2e             headless
 *   pnpm test:e2e:ui          interactive
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const PG_PORT = Number(process.env.MARCIO_E2E_PG_PORT ?? 5544);
const PG_URL = `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres?sslmode=disable`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  // Per-test cap. PGlite is fast (sub-second cold start) so the previous
  // 90 s buffer for a cold Neon pooler is overkill — but Next 16's first
  // compile of an unvisited route still costs ~10 s, so leave headroom.
  timeout: 60_000,
  // Per-assertion timeout. PGlite + warm Next dev = single-digit ms; keep
  // 15 s for the very first request of a route while Next compiles it.
  expect: { timeout: 15_000 },
  fullyParallel: false, // share one DB → sequential is safer
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  globalSetup: "./tests/e2e/setup/global-setup.ts",
  globalTeardown: "./tests/e2e/setup/global-teardown.ts",
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
  // The dev server is spawned manually inside globalSetup (after PGlite
  // is ready). Playwright's built-in `webServer` would race the DB:
  // `MARCIO_DEV_AS=yann` makes every request hit the user table, and
  // Playwright reaches the readiness URL before globalSetup ever runs.
});

export { PORT, PG_PORT, PG_URL, BASE_URL };
