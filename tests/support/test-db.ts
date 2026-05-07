/**
 * Vitest helper: spin up a PGlite-backed Postgres for a test suite, point
 * `DATABASE_URL` at it, and reset between tests.
 *
 * The application imports `db` lazily through a Proxy in
 * `src/db/index.ts` — it reads `DATABASE_URL` and constructs a postgres-js
 * client on first use. By starting our PGlite socket BEFORE any test code
 * touches `db`, and pointing `DATABASE_URL` at it, all the existing app
 * code paths "just work" against PGlite with zero changes to the runtime
 * code. Same SQL, same Drizzle, same wire protocol.
 *
 * Usage in a spec:
 *
 *   import { withTestDb } from "../support/test-db.ts";
 *
 *   describe("my router", () => {
 *     const ctx = withTestDb();
 *     beforeEach(async () => {
 *       await ctx.reset();   // wipes + reseeds nothing
 *     });
 *     it("does the thing", async () => {
 *       // freely use anything from src/, it's wired to PGlite.
 *     });
 *   });
 */

import { afterAll, beforeAll } from "vitest";
import postgres from "postgres";
import {
  startTestPg,
  truncateAllTables,
  type TestPg,
} from "./pglite-server.ts";

export type TestDbCtx = {
  /** Truncate all app tables (users, transactions, etc) — keeps schema. */
  reset: () => Promise<void>;
  /** Connection string in case a test wants its own postgres-js client. */
  url: () => string;
  /** The underlying handle, mainly for diagnostics. */
  pg: () => TestPg;
};

/**
 * Sets up a PGlite-backed Postgres for the suite. The connection string is
 * written to `process.env.DATABASE_URL` before the first test runs and
 * removed in afterAll. The application's lazy db Proxy will pick it up on
 * its first call.
 */
export function withTestDb(): TestDbCtx {
  let testPg: TestPg | null = null;

  beforeAll(async () => {
    testPg = await startTestPg();
    process.env.DATABASE_URL = testPg.url;
    // Force the app's lazy postgres-js client to re-init against this URL.
    // The cached client on `globalThis.__marcioPg` exists to survive HMR;
    // reset it so this suite's process always reaches its own PGlite.
    //
    // We pre-create a postgres-js client tuned for PGlite (`max: 1` keeps
    // every query in a single connection so pglite-socket's per-connection
    // queue can't get into a state where concurrent queries trigger an
    // ECONNRESET). The app's Proxy will pick this up on first read.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (g.__marcioPg) {
      try {
        await g.__marcioPg.end({ timeout: 1 });
      } catch {
        // ignore — old client may already be dead
      }
      g.__marcioPg = undefined;
    }
    g.__marcioPg = postgres(testPg.url, {
      prepare: false,
      max: 1,
      idle_timeout: 0,
      max_lifetime: 0,
    });
  });

  afterAll(async () => {
    // Close any postgres-js client created against our PGlite first, then
    // tear PGlite down. Order matters — closing PGlite while the postgres-js
    // client still has open conns produces noisy logs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (g.__marcioPg) {
      try {
        await g.__marcioPg.end({ timeout: 1 });
      } catch {
        // ignore
      }
      g.__marcioPg = undefined;
    }
    if (testPg) await testPg.stop();
    testPg = null;
  });

  return {
    reset: async () => {
      if (!testPg) throw new Error("withTestDb: PGlite not initialized yet");
      await truncateAllTables(testPg.pglite);
    },
    url: () => {
      if (!testPg) throw new Error("withTestDb: PGlite not initialized yet");
      return testPg.url;
    },
    pg: () => {
      if (!testPg) throw new Error("withTestDb: PGlite not initialized yet");
      return testPg;
    },
  };
}

/**
 * Convenience: open a postgres-js client against the live test DB. Most
 * tests just use Drizzle via `src/db/index.ts`, but raw SQL helpers exist
 * for assertions that don't fit Drizzle nicely.
 */
export function rawClient(url: string) {
  return postgres(url, { prepare: false });
}
