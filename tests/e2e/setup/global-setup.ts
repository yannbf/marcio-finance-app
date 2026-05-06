import { spawnSync } from "node:child_process";

/**
 * Runs once before the Playwright test session. Spawns the seed script
 * as a child process so it can use top-level await + tsx without
 * polluting Playwright's own runtime.
 */
export default async function globalSetup() {
  if (!process.env.MARCIO_E2E_DATABASE_URL) {
    throw new Error(
      "MARCIO_E2E_DATABASE_URL is not set. Point it at a test Postgres " +
        "branch (see TESTING.md) before running the E2E suite.",
    );
  }

  const result = spawnSync(
    "pnpm",
    ["tsx", "tests/e2e/setup/seed.ts"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
      },
    },
  );

  if (result.status !== 0) {
    throw new Error(`Seed exited with status ${result.status}`);
  }
}
