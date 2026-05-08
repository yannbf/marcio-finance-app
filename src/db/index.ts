import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

declare global {
  // eslint-disable-next-line no-var
  var __marcioPg: ReturnType<typeof postgres> | undefined;
}

function client() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example → .env.local and fill in your Neon connection string.",
    );
  }
  if (!globalThis.__marcioPg) {
    // PGlite-backed test setups expose Postgres over a socket but the
    // wire layer is single-threaded — concurrent connections from
    // postgres-js trigger ECONNRESET under load. The Playwright/Vitest
    // harnesses set MARCIO_E2E=1; in that mode we cap the pool at one
    // connection so queries serialise. Production keeps the default.
    const pgliteMode = process.env.MARCIO_E2E === "1";
    globalThis.__marcioPg = postgres(url, {
      prepare: false,
      ...(pgliteMode
        ? { max: 1, idle_timeout: 0, max_lifetime: 0 }
        : {}),
    });
  }
  return globalThis.__marcioPg;
}

/**
 * Lazy-initialized Drizzle client. Throws clearly if DATABASE_URL is missing,
 * so server pages without DB needs (e.g. the demo Today screen) still load.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    const real = drizzle(client(), { schema });
    return Reflect.get(real, prop, real);
  },
});

export { schema };
