import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../trpc.ts";
import { getHouseholdSettings, updatePaydayDay } from "@/lib/settings.ts";

export const settingsRouter = router({
  get: publicProcedure.query(async () => {
    return getHouseholdSettings();
  }),

  setPaydayDay: protectedProcedure
    .input(z.object({ day: z.number().int().min(1).max(28) }))
    .mutation(async ({ input }) => {
      await updatePaydayDay(input.day);
      return { ok: true as const };
    }),
});
