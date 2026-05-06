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
    globalThis.__marcioPg = postgres(url, { prepare: false });
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
