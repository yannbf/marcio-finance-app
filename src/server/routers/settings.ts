import { z } from "zod";
import { desc } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { month } from "@/db/schema.ts";
import { protectedProcedure, publicProcedure, router } from "../trpc.ts";
import { getHouseholdSettings, updatePaydayDay } from "@/lib/settings.ts";

export const settingsRouter = router({
  get: publicProcedure.query(async () => {
    return getHouseholdSettings();
  }),

  /**
   * The most recent sheet import timestamp across all months — surfaced on
   * the Settings screen so the user can tell whether the daily cron ran.
   */
  lastImportAt: publicProcedure.query(async () => {
    const [row] = await db
      .select({ importedAt: month.importedAt })
      .from(month)
      .orderBy(desc(month.importedAt))
      .limit(1);
    return { at: row?.importedAt?.toISOString() ?? null };
  }),

  setPaydayDay: protectedProcedure
    .input(z.object({ day: z.number().int().min(1).max(28) }))
    .mutation(async ({ input }) => {
      await updatePaydayDay(input.day);
      return { ok: true as const };
    }),
});
