import { setRequestLocale, getTranslations } from "next-intl/server";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { Card } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { TransactionRow } from "@/components/marcio/transaction-row.tsx";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { getUpcomingCharges } from "@/lib/forecast.ts";
import { formatEUR } from "@/lib/format.ts";
import { AFRONDING_PATTERN } from "@/lib/matching/seed-rules.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function AtividadePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Activity");
  const me = await getCurrentUser();
  const settings = await getHouseholdSettings();

  const allowed: ("joint" | "camila" | "yann")[] = me
    ? ["joint", me.role]
    : ["joint"];

  const range = paydayMonthFor(new Date(), settings.paydayDay);

  const [forecast, txns] = await Promise.all([
    getUpcomingCharges(allowed),
    db
      .select({
        id: transaction.id,
        counterparty: transaction.counterparty,
        description: transaction.description,
        bookingDate: transaction.bookingDate,
        amountCents: transaction.amountCents,
        matchedName: budgetItem.name,
      })
      .from(transaction)
      .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
      .leftJoin(txMatch, eq(txMatch.transactionId, transaction.id))
      .leftJoin(budgetItem, eq(budgetItem.id, txMatch.budgetItemId))
      .where(
        and(
          inArray(bankAccount.owner, allowed),
          gte(transaction.bookingDate, range.startsOn),
          lte(transaction.bookingDate, range.endsOn),
          sql`NOT (${transaction.counterparty} ~* ${AFRONDING_PATTERN.source})`,
        ),
      )
      .orderBy(desc(transaction.bookingDate))
      .limit(200),
  ]);

  // Group by date.
  const groups: { date: string; rows: typeof txns }[] = [];
  for (const r of txns) {
    const key = formatGroupDate(r.bookingDate, locale);
    const last = groups[groups.length - 1];
    if (last && last.date === key) {
      last.rows.push(r);
    } else {
      groups.push({ date: key, rows: [r] });
    }
  }

  const monthSpend = txns
    .filter((r) => r.amountCents < 0)
    .reduce((s, r) => s + Math.abs(r.amountCents), 0);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-8 pt-8">
      <header>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <div className="mt-1 flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("heading")}
          </h1>
          <span className="text-xs text-muted-foreground">
            {anchorLabel(range.anchorYear, range.anchorMonth, locale)}
          </span>
        </div>
      </header>

      <Card className="border-border/40 bg-card/60 p-5">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("monthSpend")}
        </p>
        <p className="num mt-1 text-2xl font-semibold tracking-tight">
          {formatEUR(monthSpend / 100, locale)}
        </p>
        <p className="num mt-1 text-xs text-muted-foreground">
          {t("txCount", { n: txns.length })}
        </p>
      </Card>

      {forecast.charges.length > 0 ? (
        <Card className="border-border/40 bg-card/60 p-5">
          <header className="flex items-baseline justify-between">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {t("upcomingTitle")}
            </p>
            <p className="num text-sm font-semibold">
              {formatEUR(forecast.totalRemainingCents / 100, locale)}
            </p>
          </header>
          <ul className="mt-2 divide-y divide-border/40">
            {forecast.charges.slice(0, 6).map((c) => (
              <li key={c.budgetItemId}>
                <Link
                  href={`/mes/${c.budgetItemId}` as `/mes/${string}`}
                  className="flex items-center gap-3 py-2 transition-colors hover:opacity-80"
                >
                  <div className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground num">
                    {c.predictedDay ?? "—"}
                  </div>
                  <span className="flex-1 truncate text-sm">{c.name}</span>
                  <span className="num text-sm">
                    {formatEUR(Math.abs(c.plannedCents) / 100, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {txns.length === 0 ? (
        <Card className="border-border/40 bg-card/40 p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </Card>
      ) : (
        groups.map((g) => (
          <section key={g.date} className="flex flex-col gap-1">
            <p className="px-1 pt-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {g.date}
            </p>
            <Card className="border-border/40 bg-card/60 p-1">
              <ul className="divide-y divide-border/40">
                {g.rows.map((r) => (
                  <li key={r.id} className="px-2">
                    <TransactionRow
                      counterparty={r.counterparty}
                      description={r.description}
                      bookingDate={r.bookingDate}
                      amountCents={r.amountCents}
                      locale={locale}
                      matchedLabel={r.matchedName ?? null}
                      unmatched={!r.matchedName}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}
    </main>
  );
}

function formatGroupDate(d: Date, locale: string): string {
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function anchorLabel(year: number, monthVal: number, locale: string): string {
  const date = new Date(year, monthVal - 1, 1);
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  })
    .format(date)
    .replace(/^\w/, (c) => c.toUpperCase());
}
