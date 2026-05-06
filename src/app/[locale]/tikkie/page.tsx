import { setRequestLocale, getTranslations } from "next-intl/server";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { bankAccount, transaction } from "@/db/schema.ts";
import { Card } from "@/components/ui/card.tsx";
import { CounterpartyAvatar } from "@/components/marcio/counterparty-avatar.tsx";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { formatEUR } from "@/lib/format.ts";
import { TIKKIE_COUNTERPARTY, parseTikkiePerson } from "@/lib/tikkie.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function TikkiePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Tikkie");
  const me = await getCurrentUser();
  const settings = await getHouseholdSettings();

  const allowed: ("joint" | "camila" | "yann")[] = me
    ? ["joint", me.role]
    : ["joint"];

  const range = paydayMonthFor(new Date(), settings.paydayDay);

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
    lastDate: Date;
  };
  const byPerson = new Map<string, Bucket>();
  for (const r of rows) {
    const name = parseTikkiePerson(r.counterparty, r.description);
    const b: Bucket = byPerson.get(name) ?? {
      name,
      paidCents: 0,
      receivedCents: 0,
      txCount: 0,
      lastDate: r.bookingDate,
    };
    if (r.amountCents < 0) b.paidCents += -r.amountCents;
    else b.receivedCents += r.amountCents;
    b.txCount += 1;
    if (r.bookingDate > b.lastDate) b.lastDate = r.bookingDate;
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

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-8 pt-8">
      <header>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">{t("hint")}</p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border/40 bg-card/60 p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("paid")}
          </p>
          <p className="num mt-1 text-base font-semibold tracking-tight">
            {formatEUR(totals.paid / 100, locale)}
          </p>
        </Card>
        <Card className="border-border/40 bg-card/60 p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("received")}
          </p>
          <p className="num mt-1 text-base font-semibold tracking-tight text-primary">
            {formatEUR(totals.received / 100, locale)}
          </p>
        </Card>
      </div>

      {sorted.length === 0 ? (
        <Card className="border-border/40 bg-card/40 p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </Card>
      ) : (
        <Card className="border-border/40 bg-card/60 p-2">
          <ul className="divide-y divide-border/40">
            {sorted.map((b) => (
              <li
                key={b.name}
                className="flex items-center gap-3 px-2 py-3"
              >
                <CounterpartyAvatar name={b.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{b.name}</p>
                  <p className="num text-xs text-muted-foreground">
                    {t("txCount", { n: b.txCount })}
                  </p>
                </div>
                <div className="text-right">
                  {b.paidCents > 0 ? (
                    <p className="num whitespace-nowrap text-sm font-semibold">
                      −{formatEUR(b.paidCents / 100, locale)}
                    </p>
                  ) : null}
                  {b.receivedCents > 0 ? (
                    <p className="num whitespace-nowrap text-sm font-semibold text-primary">
                      +{formatEUR(b.receivedCents / 100, locale)}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
