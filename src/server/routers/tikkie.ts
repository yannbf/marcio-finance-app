import { z } from "zod";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { bankAccount, transaction } from "@/db/schema.ts";
import {
  publicProcedure,
  resolveVisibleScopes,
  router,
} from "../trpc.ts";
import { AnchorInput, ScopeViewInput } from "../inputs.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor, paydayMonthForAnchor } from "@/lib/payday.ts";
import { TIKKIE_PG_PATTERN, parseTikkiePerson } from "@/lib/tikkie.ts";

export const tikkieRouter = router({
  get: publicProcedure
    .input(
      z
        .object({ anchor: AnchorInput, scope: ScopeViewInput })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
    const settings = await getHouseholdSettings();
    const range = input?.anchor
      ? paydayMonthForAnchor(
          input.anchor.year,
          input.anchor.month,
          settings.paydayDay,
        )
      : paydayMonthFor(new Date(), settings.paydayDay);
    const allowed = resolveVisibleScopes(ctx.allowedScopes, input?.scope);

    const rows = await db
      .select({
        id: transaction.id,
        counterparty: transaction.counterparty,
        description: transaction.description,
        bookingDate: transaction.bookingDate,
        amountCents: transaction.amountCents,
      })
      .from(transaction)
      .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
      .where(
        and(
          inArray(bankAccount.owner, allowed),
          gte(transaction.bookingDate, range.startsOn),
          lte(transaction.bookingDate, range.endsOn),
          sql`(${transaction.counterparty} ~* ${TIKKIE_PG_PATTERN}
              OR ${transaction.description} ~* ${TIKKIE_PG_PATTERN})`,
        ),
      )
      .orderBy(desc(transaction.bookingDate));

    type Bucket = {
      name: string;
      paidCents: number;
      receivedCents: number;
      txCount: number;
    };
    const byPerson = new Map<string, Bucket>();
    for (const r of rows) {
      const name = parseTikkiePerson(r.counterparty, r.description);
      const b: Bucket = byPerson.get(name) ?? {
        name,
        paidCents: 0,
        receivedCents: 0,
        txCount: 0,
      };
      if (r.amountCents < 0) b.paidCents += -r.amountCents;
      else b.receivedCents += r.amountCents;
      b.txCount += 1;
      byPerson.set(name, b);
    }
    const sorted = [...byPerson.values()].sort(
      (a, b) =>
        b.paidCents + b.receivedCents - (a.paidCents + a.receivedCents),
    );
    const totals = sorted.reduce(
      (acc, b) => {
        acc.paid += b.paidCents;
        acc.received += b.receivedCents;
        return acc;
      },
      { paid: 0, received: 0 },
    );
    return {
      anchor: { year: range.anchorYear, month: range.anchorMonth },
      byPerson: sorted,
      totals,
    };
  }),
});
