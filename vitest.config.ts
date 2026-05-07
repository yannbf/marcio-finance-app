import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for unit + integration tests.
 *
 * - Unit tests (`tests/unit/**`) are pure logic — no DB, no external IO.
 * - Integration tests (`tests/integration/**`) get a PGlite-backed Postgres
 *   started in a beforeAll hook (see `tests/support/test-db.ts`). Each
 *   spec file gets its own DB so tests don't fight over fixture state.
 *
 * The same `@/*` path alias the app uses is wired up so test imports look
 * identical to production imports.
 */
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    // Each integration test file boots its own PGlite — running them in
    // separate forks keeps the WASM heap from one suite leaking into the
    // next.
    pool: "forks",
    // PGlite cold-start is ~150 ms; running too many forks in parallel
    // makes machines hot for no real wall-clock win.
    maxConcurrency: 4,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./tests/support/vitest-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
