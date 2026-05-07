/**
 * tRPC caller factory for tests. Creates a `Caller` against the real
 * `appRouter` with a synthetic context — picking the role lets a test
 * exercise privacy guards (joint-only, yann-only, camila-only) without
 * spinning up Next.js.
 *
 * The return shape mirrors `trpc.router.proc(input)` from the client side
 * but runs in-process: same SQL, same Drizzle, same pglite-backed
 * Postgres.
 */

import { appRouter } from "../../src/server/routers/_app.ts";
import type { Context } from "../../src/server/trpc.ts";
import type { CurrentUser } from "../../src/lib/auth/current-user.ts";

type Role = "yann" | "camila";

export function makeAuthedCaller(role: Role = "yann") {
  const user: CurrentUser = {
    id: `test-user-${role}`,
    email: `tester-${role}@test.local`,
    name: `Tester ${role}`,
    role,
  };
  const ctx: Context = {
    user,
    allowedScopes: ["joint", role],
  };
  return appRouter.createCaller(ctx);
}

/** Anonymous caller — only the joint scope is visible. */
export function makeAnonCaller() {
  const ctx: Context = {
    user: null,
    allowedScopes: ["joint"],
  };
  return appRouter.createCaller(ctx);
}
