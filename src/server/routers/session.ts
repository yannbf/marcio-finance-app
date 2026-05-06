import { publicProcedure, router } from "../trpc.ts";

export const sessionRouter = router({
  /**
   * Returns the current viewer or null. Cheap to call from anywhere; used
   * by the client shell to drive scope resolution and auth-aware UI.
   */
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) return null;
    return {
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
      role: ctx.user.role,
    };
  }),
});
