import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { bankAccount, transaction } from "@/db/schema.ts";
import { publicProcedure, router } from "../trpc.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { TIKKIE_COUNTERPARTY, parseTikkiePerson } from "@/lib/tikkie.ts";

export const tikkieRouter = router({
  get: publicProcedure.query(async ({ ctx }) => {
    const settings = await getHouseholdSettings();
    const range = paydayMonthFor(new Date(), settings.paydayDay);
    const allowed = ctx.allowedScopes;

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
          sql`(${transaction.counterparty} ~* ${TIKKIE_COUNTERPARTY.source}
              OR ${transaction.description} ~* ${TIKKIE_COUNTERPARTY.source})`,
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
    return { byPerson: sorted, totals };
  }),
});
