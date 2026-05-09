/**
 * tRPC router for per-merchant category overrides.
 *
 * The auto-categorizer (src/lib/categorization.ts) ships with regex
 * rules. When the user disagrees with a classification — or when a
 * row lands in 'other' — they can pin a category to the merchant's
 * counterparty fingerprint via `set`. One row applies to every
 * variant of that merchant retroactively (Insights re-buckets) and
 * to every future tx.
 */

import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { categoryOverride } from "@/db/schema.ts";
import { protectedProcedure, publicProcedure, router } from "../trpc.ts";
import { CATEGORY_KEYS, type Category } from "@/lib/categorization.ts";
import { fingerprintCounterparty } from "@/lib/matching/fingerprint.ts";

const CategoryEnum = z.enum(CATEGORY_KEYS as unknown as [string, ...string[]]);

export const categoriesRouter = router({
  /**
   * Every override row, sorted alphabetically by sample counterparty.
   * Used by the Insights screen to render a "Your overrides" section
   * and by the per-row picker to know which merchants are pinned.
   */
  list: publicProcedure.query(async () => {
    const rows = await db
      .select({
        id: categoryOverride.id,
        fingerprint: categoryOverride.fingerprint,
        category: categoryOverride.category,
        sampleCounterparty: categoryOverride.sampleCounterparty,
        createdAt: categoryOverride.createdAt,
      })
      .from(categoryOverride)
      .orderBy(sql`COALESCE(${categoryOverride.sampleCounterparty}, '')`);
    return rows.map((r) => ({
      ...r,
      category: r.category as Category,
    }));
  }),

  /**
   * Pin a category to a counterparty's fingerprint. Idempotent —
   * upserts on the unique fingerprint key, so re-classifying the same
   * merchant just rewrites the row instead of creating duplicates.
   */
  set: protectedProcedure
    .input(
      z.object({
        counterparty: z.string().trim().min(1).max(200),
        category: CategoryEnum,
      }),
    )
    .mutation(async ({ input }) => {
      const fp = fingerprintCounterparty(input.counterparty);
      if (!fp) {
        throw new Error("Counterparty has no usable fingerprint");
      }
      const [row] = await db
        .insert(categoryOverride)
        .values({
          fingerprint: fp,
          category: input.category,
          sampleCounterparty: input.counterparty.trim(),
        })
        .onConflictDoUpdate({
          target: categoryOverride.fingerprint,
          set: {
            category: input.category,
            sampleCounterparty: input.counterparty.trim(),
            updatedAt: new Date(),
          },
        })
        .returning();
      return { id: row.id, fingerprint: fp, category: row.category as Category };
    }),

  /** Remove an override so the regex rules take over again. */
  clear: protectedProcedure
    .input(z.object({ counterparty: z.string().trim().min(1).max(200) }))
    .mutation(async ({ input }) => {
      const fp = fingerprintCounterparty(input.counterparty);
      if (!fp) return { cleared: 0 };
      const deleted = await db
        .delete(categoryOverride)
        .where(eq(categoryOverride.fingerprint, fp))
        .returning({ id: categoryOverride.id });
      return { cleared: deleted.length };
    }),
});
