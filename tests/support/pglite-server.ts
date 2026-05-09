/**
 * PGlite-backed Postgres for tests.
 *
 * Spins up an in-process PGlite instance, exposes it over a TCP socket via
 * `pglite-socket`, and pushes the Drizzle schema to it. Anything that talks
 * Postgres (postgres-js, drizzle-orm/postgres-js, the dev server, the seed
 * script) can connect by URL with no other changes — it's a real Postgres,
 * just compiled to WASM and running inside this process.
 *
 * The same code path serves both Vitest integration tests (which start a
 * private socket per process) and the Playwright E2E suite (which starts
 * one socket in globalSetup and points the dev server at it).
 */

import { createServer } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/db/schema.ts";
// drizzle-kit ships its programmatic push API under `drizzle-kit/api`. It
// takes an `imports` object (the schema module) and a connected drizzle
// instance, and returns the SQL it would run plus an `apply` thunk.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { pushSchema } from "drizzle-kit/api";

export type TestPg = {
  /** Connection string suitable for postgres-js / `DATABASE_URL`. */
  url: string;
  /** Underlying PGlite instance — exposed for direct truncate helpers. */
  pglite: PGlite;
  /** Stop the socket server and free PGlite. */
  stop: () => Promise<void>;
};

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("Could not pick free port"));
      }
    });
  });
}

/**
 * Boot a fresh PGlite-backed test database. Returns a connection URL plus
 * the underlying PGlite handle.
 *
 * The schema is pushed exactly once via drizzle-kit's programmatic API —
 * same DDL the production migration would emit, so any divergence between
 * `src/db/schema.ts` and the test DB surfaces here loudly.
 */
export async function startTestPg(opts?: {
  /** Pin the socket port. Defaults to a randomly chosen free port. */
  port?: number;
}): Promise<TestPg> {
  const pglite = new PGlite();
  await pglite.waitReady;

  // Push the schema using drizzle-kit's programmatic push. We feed it a
  // PGlite-backed drizzle instance directly — no real Postgres needed.
  const drizzleForPush = drizzle(pglite, { schema });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await pushSchema(schema as any, drizzleForPush as any);
  await result.apply();

  const port = opts?.port ?? (await pickFreePort());
  const server = new PGLiteSocketServer({
    db: pglite,
    port,
    host: "127.0.0.1",
  });
  await server.start();

  // postgres-js connection string. PGlite ignores user/password/dbname but
  // postgres-js insists on a valid URL shape.
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;

  return {
    url,
    pglite,
    async stop() {
      await server.stop();
      await pglite.close();
    },
  };
}

/**
 * Truncate every app table in dependency order — fast reset between
 * Vitest tests without rebuilding the schema.
 */
export async function truncateAllTables(pglite: PGlite): Promise<void> {
  await pglite.exec(`
    TRUNCATE TABLE
      transaction_match,
      "transaction",
      bank_sync_cursor,
      bank_connection,
      bank_account,
      match_rule,
      category_override,
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
}
