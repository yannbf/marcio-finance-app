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
import { EnableBankingError } from '@/lib/enable_banking/client.ts'

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
     * mark our row revoked. Bank accounts + their transactions stay; only
     * the FK to the connection is cleared so future syncs don't run.
     */
    disconnect: protectedProcedure
      .input(z.object({ connectionId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [conn] = await db
          .select()
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
          if (!(err instanceof EnableBankingError) || err.status !== 404) {
            // Non-404 failures are logged on the row but we still revoke
            // locally so the user isn't stuck with a zombie connection.
            await db
              .update(bankConnection)
              .set({
                lastError:
                  err instanceof Error
                    ? err.message.slice(0, 500)
                    : String(err),
              })
              .where(eq(bankConnection.id, conn.id))
          }
        }

        await db
          .update(bankAccount)
          .set({ connectionId: null })
          .where(eq(bankAccount.connectionId, conn.id))

        await db
          .update(bankConnection)
          .set({ status: 'revoked' })
          .where(eq(bankConnection.id, conn.id))

        return { ok: true as const }
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
})
