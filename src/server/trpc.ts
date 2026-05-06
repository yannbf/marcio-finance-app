/**
 * tRPC server bootstrap. Defines the request context (user + scope) and the
 * shared `t` helpers. Routers in src/server/routers/ build on these.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user.ts";

export type Scope = "joint" | "yann" | "camila";

export type Context = {
  user: Awaited<ReturnType<typeof getCurrentUser>>;
  /** The scopes the current user can read. Joint is always included. */
  allowedScopes: Scope[];
};

export async function createContext(): Promise<Context> {
  const user = await getCurrentUser();
  const allowedScopes: Scope[] = user
    ? ["joint", user.role]
    : ["joint"];
  return { user, allowedScopes };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** Procedure that requires a signed-in user. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
