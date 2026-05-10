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
import { and, eq, sql } from "drizzle-orm";
import { runMatchingAllAccounts } from "@/lib/matching/engine.ts";
import { db } from "@/db/index.ts";
import {
  budgetItem,
  categoryBudgetDefault,
  categoryOverride,
} from "@/db/schema.ts";
import {
  protectedProcedure,
  publicProcedure,
  resolveVisibleScopes,
  router,
} from "../trpc.ts";
import { CATEGORY_KEYS, type Category } from "@/lib/categorization.ts";
import { fingerprintCounterparty } from "@/lib/matching/fingerprint.ts";
import { OUTFLOW_SECTIONS } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";

const CategoryEnum = z.enum(CATEGORY_KEYS as unknown as [string, ...string[]]);
const ScopeEnum = z.enum(["joint", "yann", "camila"]);
const SectionEnum = z.enum([
  "ENTRADAS",
  "DIVIDAS",
  "ECONOMIAS",
  "FIXAS",
  "VARIAVEIS",
  "SAZONAIS",
]);

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

  /* ------------------------------------------------------------------ *
   * Category → budget-item routing                                      *
   *                                                                     *
   * "Every transaction tagged 'shopping' should land on the 'Compras    *
   * geral' budget item." Defaults are scope-keyed so joint and personal *
   * can route the same category to different items.                     *
   * ------------------------------------------------------------------ */

  /**
   * Every routing default the caller can see. Scope is filtered through
   * resolveVisibleScopes so a personal user only sees their own + joint
   * defaults.
   */
  listDefaults: publicProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        id: categoryBudgetDefault.id,
        category: categoryBudgetDefault.category,
        scope: categoryBudgetDefault.scope,
        naturalKey: categoryBudgetDefault.naturalKey,
        section: categoryBudgetDefault.section,
        sampleName: categoryBudgetDefault.sampleName,
      })
      .from(categoryBudgetDefault);
    return rows
      .filter((r) =>
        ctx.allowedScopes.includes(r.scope as "joint" | "yann" | "camila"),
      )
      .map((r) => ({
        ...r,
        category: r.category as Category,
        section: r.section as Section,
        scope: r.scope as "joint" | "yann" | "camila",
      }));
  }),

  /**
   * Budget-item options the user can pick as a routing target. Scoped
   * to the caller's visible scopes and limited to outflow sections —
   * routing income tx ("Salary") via category default would never make
   * sense. Returns the most recent occurrence of each (scope, naturalKey)
   * pair so renames + new monthly imports surface the latest label.
   */
  budgetItemOptions: publicProcedure
    .input(z.object({ scope: ScopeEnum }))
    .query(async ({ ctx, input }) => {
      const allowed = resolveVisibleScopes(ctx.allowedScopes, input.scope);
      const rows = await db
        .select({
          name: budgetItem.name,
          section: budgetItem.section,
          naturalKey: budgetItem.naturalKey,
          scope: budgetItem.scope,
        })
        .from(budgetItem)
        .where(eq(budgetItem.scope, input.scope));
      void allowed;
      // Dedup by (section, naturalKey) — keep the friendliest name.
      const seen = new Map<
        string,
        { name: string; section: Section; naturalKey: string }
      >();
      for (const r of rows) {
        if (!OUTFLOW_SECTIONS.includes(r.section as Section)) continue;
        const key = `${r.section}|${r.naturalKey}`;
        if (!seen.has(key)) {
          seen.set(key, {
            name: r.name,
            section: r.section as Section,
            naturalKey: r.naturalKey,
          });
        }
      }
      return [...seen.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    }),

  /**
   * Set (or upsert) the budget-item routing default for a (category,
   * scope) pair. Triggers a full re-match across every account so any
   * previously-unmatched transaction whose category matches this rule
   * gets routed retroactively.
   */
  setDefault: protectedProcedure
    .input(
      z.object({
        category: CategoryEnum,
        scope: ScopeEnum,
        naturalKey: z.string().trim().min(1).max(200),
        section: SectionEnum,
        sampleName: z.string().trim().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Privacy: a personal default can only be set by its owner. Joint
      // is fine for either user.
      if (input.scope !== "joint" && input.scope !== ctx.user.role) {
        throw new Error(
          "You can only set defaults for your own scope or joint.",
        );
      }
      const [row] = await db
        .insert(categoryBudgetDefault)
        .values({
          category: input.category,
          scope: input.scope,
          naturalKey: input.naturalKey,
          section: input.section,
          sampleName: input.sampleName ?? null,
        })
        .onConflictDoUpdate({
          target: [
            categoryBudgetDefault.category,
            categoryBudgetDefault.scope,
          ],
          set: {
            naturalKey: input.naturalKey,
            section: input.section,
            sampleName: input.sampleName ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();

      const matchOutcome = await runMatchingAllAccounts();

      return {
        id: row.id,
        rematched: matchOutcome.matched,
      };
    }),

  /** Remove a routing default so the matching engine falls back to
   * seed rules / inbox for this category. */
  clearDefault: protectedProcedure
    .input(
      z.object({
        category: CategoryEnum,
        scope: ScopeEnum,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.scope !== "joint" && input.scope !== ctx.user.role) {
        throw new Error(
          "You can only clear defaults for your own scope or joint.",
        );
      }
      const deleted = await db
        .delete(categoryBudgetDefault)
        .where(
          and(
            eq(categoryBudgetDefault.category, input.category),
            eq(categoryBudgetDefault.scope, input.scope),
          ),
        )
        .returning({ id: categoryBudgetDefault.id });
      return { cleared: deleted.length };
    }),
});
