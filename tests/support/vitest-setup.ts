/**
 * Per-process Vitest setup. Ensures NODE_ENV is set to "test" before any
 * application code is imported. Individual integration suites pull in a
 * PGlite-backed DB via `withTestDb()` from `./test-db.ts`.
 */

if (!process.env.NODE_ENV) {
  // @ts-expect-error — NODE_ENV is read-only in node types but writable at runtime.
  process.env.NODE_ENV = "test";
}

// Suppress the "DATABASE_URL is not set" warning when a test imports
// `src/db/index.ts` before `withTestDb` has wired one. Tests that need a
// real DB call `withTestDb()` themselves; tests that don't never trigger
// the proxy's `client()` thunk.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://placeholder@127.0.0.1:1/placeholder";
}
