import { z } from 'zod'
import { month } from '@/db/schema.ts'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { protectedProcedure, publicProcedure, router } from '../trpc.ts'
import { getHouseholdSettings, updatePaydayDay } from '@/lib/settings.ts'
import { db } from '@/db/index.ts'
import { bankAccount, bankConnection } from '@/db/schema.ts'
import {
  syncConnection,
  revokeSessionForConnection,
} from '@/lib/enable_banking/sync.ts'
import { runMatchingAllAccounts } from '@/lib/matching/engine.ts'

export const settingsRouter = router({
  get: publicProcedure.query(async () => {
    return getHouseholdSettings()
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
      .limit(1)
    return { at: row?.importedAt?.toISOString() ?? null }
  }),

  setPaydayDay: protectedProcedure
    .input(z.object({ day: z.number().int().min(1).max(28) }))
    .mutation(async ({ input }) => {
      await updatePaydayDay(input.day)
      return { ok: true as const }
    }),

  /**
   * List bank connections the current user can see.
   *
   * Each user sees only their own connections (the consent is in their name).
   * The returned account list filters to bank_account rows linked to that
   * connection — privacy-safe because the user already owns them.
   */
  connections: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const conns = await db
        .select()
        .from(bankConnection)
        .where(eq(bankConnection.owner, ctx.user.role))
        .orderBy(desc(bankConnection.createdAt))

      const ids = conns.map((c) => c.id)
      const accounts =
        ids.length === 0
          ? []
          : await db
              .select({
                id: bankAccount.id,
                connectionId: bankAccount.connectionId,
                nickname: bankAccount.nickname,
                iban: bankAccount.iban,
                kind: bankAccount.kind,
                owner: bankAccount.owner,
                lastSyncedAt: bankAccount.lastSyncedAt,
              })
              .from(bankAccount)
              .where(inArray(bankAccount.connectionId, ids))

      return conns.map((c) => ({
        id: c.id,
        institutionId: c.institutionId,
        status: c.status,
        expiresAt: c.expiresAt,
        lastSyncedAt: c.lastSyncedAt,
        lastError: c.lastError,
        createdAt: c.createdAt,
        accounts: accounts.filter((a) => a.connectionId === c.id),
      }))
    }),

    /**
     * Disconnect — best-effort delete the session at Enable Banking, then
     * remove the connection row from our DB.
     *
     * Bank accounts and their transactions are preserved (we null the FK
     * first), but the connection itself is hard-deleted so it disappears
     * from the UI list. Errors talking to Enable Banking are swallowed
     * silently — the user's intent is "make this row go away," and a stale
     * remote session expires harmlessly on its own.
     */
    disconnect: protectedProcedure
      .input(z.object({ connectionId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [conn] = await db
          .select({ id: bankConnection.id })
          .from(bankConnection)
          .where(
            and(
              eq(bankConnection.id, input.connectionId),
              eq(bankConnection.owner, ctx.user.role),
            ),
          )
        if (!conn) throw new TRPCError({ code: 'NOT_FOUND' })

        try {
          await revokeSessionForConnection(conn.id)
        } catch (err) {
          // Best-effort: 404 (already gone) and any other failure are both
          // fine — we're deleting the local row regardless. A stale remote
          // session would expire on its own anyway.
          void err
        }

        await db
          .update(bankAccount)
          .set({ connectionId: null })
          .where(eq(bankAccount.connectionId, conn.id))

        await db.delete(bankConnection).where(eq(bankConnection.id, conn.id))

        return { ok: true as const }
      }),

    /**
     * Flip a bank account's owner (joint / yann / camila).
     *
     * Useful right after a sync because Enable Banking returns every
     * account under the connection owner's role, even when the underlying
     * ING account is jointly held. Only an account the caller can already
     * see is flippable — the existing privacy guard on the per-account
     * page enforces that visibility.
     */
    setAccountOwner: protectedProcedure
      .input(
        z.object({
          bankAccountId: z.string().uuid(),
          owner: z.enum(['joint', 'yann', 'camila']),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [acct] = await db
          .select({ id: bankAccount.id, owner: bankAccount.owner })
          .from(bankAccount)
          .where(eq(bankAccount.id, input.bankAccountId))
        if (!acct) throw new TRPCError({ code: 'NOT_FOUND' })

        // Privacy: the caller must already be allowed to see the account
        // (joint, or it's their personal one) to mutate it.
        if (acct.owner !== 'joint' && acct.owner !== ctx.user.role) {
          throw new TRPCError({ code: 'FORBIDDEN' })
        }

        await db
          .update(bankAccount)
          .set({ owner: input.owner })
          .where(eq(bankAccount.id, acct.id))

        return { ok: true as const, owner: input.owner }
      }),

    /**
     * Rename a bank account. Privacy guard reuses the same rule as the
     * ownership toggle — only an account the caller can already see is
     * mutable. Trims whitespace and rejects empty strings.
     */
    renameAccount: protectedProcedure
      .input(
        z.object({
          bankAccountId: z.string().uuid(),
          nickname: z.string().min(1).max(80).trim(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [acct] = await db
          .select({ id: bankAccount.id, owner: bankAccount.owner })
          .from(bankAccount)
          .where(eq(bankAccount.id, input.bankAccountId))
        if (!acct) throw new TRPCError({ code: 'NOT_FOUND' })
        if (acct.owner !== 'joint' && acct.owner !== ctx.user.role) {
          throw new TRPCError({ code: 'FORBIDDEN' })
        }
        await db
          .update(bankAccount)
          .set({ nickname: input.nickname })
          .where(eq(bankAccount.id, acct.id))
        return { ok: true as const, nickname: input.nickname }
      }),

    /** On-demand sync of one connection. */
    refresh: protectedProcedure
      .input(z.object({ connectionId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [conn] = await db
          .select({ id: bankConnection.id })
          .from(bankConnection)
          .where(
            and(
              eq(bankConnection.id, input.connectionId),
              eq(bankConnection.owner, ctx.user.role),
            ),
          )
        if (!conn) throw new TRPCError({ code: 'NOT_FOUND' })
        const result = await syncConnection(conn.id)
        return result
      }),
  }),

  /**
   * Re-run the matching engine across every bank account. Useful after the
   * user creates or refines a learned rule — without this, only newly
   * inserted transactions get re-evaluated, so old unmatched rows of the
   * same merchant stay in inbox forever. Returns the global matched count.
   */
  rematchAll: protectedProcedure.mutation(async () => {
    const result = await runMatchingAllAccounts()
    return result
  }),

})
