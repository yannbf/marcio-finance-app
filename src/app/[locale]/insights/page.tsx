import { setRequestLocale, getTranslations } from "next-intl/server";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  budgetItem,
  transaction,
  txMatch,
} from "@/db/schema.ts";
import { Card } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { CounterpartyAvatar } from "@/components/marcio/counterparty-avatar.tsx";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { formatEUR } from "@/lib/format.ts";
import {
  getMonthlyAggregates,
  OUTFLOW_SECTIONS,
  totalOutflow,
} from "@/lib/budget-aggregates.ts";
import { SECTION_TR_KEY } from "@/lib/import/sections.ts";
import { AFRONDING_PATTERN } from "@/lib/matching/seed-rules.ts";
import type { Section, Scope } from "@/lib/import/types.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Insights");
  const tSections = await getTranslations("Sections");
  const tTikkie = await getTranslations("Tikkie");

  const settings = await getHouseholdSettings();
  const me = await getCurrentUser();
  const range = paydayMonthFor(new Date(), settings.paydayDay);

  const scopes: Scope[] = me ? ["joint", me.role] : ["joint"];
  const agg = await getMonthlyAggregates(scopes);
  const totalOutCents = Math.abs(totalOutflow(agg.actual));

  // Top 10 merchants this payday-month, by total outflow.
  const topMerchants = await db
    .select({
      counterparty: transaction.counterparty,
      sum: sql<string>`COALESCE(SUM(${transaction.amountCents}), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(transaction)
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
    .where(
      and(
        inArray(bankAccount.owner, scopes),
        gte(transaction.bookingDate, range.startsOn),
        lte(transaction.bookingDate, range.endsOn),
        sql`${transaction.amountCents} < 0`,
        sql`NOT (${transaction.counterparty} ~* ${AFRONDING_PATTERN.source})`,
      ),
    )
    .groupBy(transaction.counterparty)
    .orderBy(asc(sql`SUM(${transaction.amountCents})`))
    .limit(10);

  // Top categories (matched budget items) by spend.
  const topCategories = await db
    .select({
      itemId: budgetItem.id,
      name: budgetItem.name,
      section: budgetItem.section,
      sum: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
    })
    .from(txMatch)
    .innerJoin(budgetItem, eq(budgetItem.id, txMatch.budgetItemId))
    .innerJoin(transaction, eq(transaction.id, txMatch.transactionId))
    .where(
      and(
        inArray(budgetItem.scope, scopes),
        gte(transaction.bookingDate, range.startsOn),
        lte(transaction.bookingDate, range.endsOn),
        sql`${txMatch.allocatedCents} < 0`,
      ),
    )
    .groupBy(budgetItem.id, budgetItem.name, budgetItem.section)
    .orderBy(asc(sql`SUM(${txMatch.allocatedCents})`))
    .limit(10);

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
          {t("totalSpent")}
        </p>
        <p className="num mt-1 text-3xl font-semibold tracking-tight">
          {formatEUR(totalOutCents / 100, locale)}
        </p>
      </Card>

      {/* By section */}
      <Card className="border-border/40 bg-card/60 p-5">
        <h2 className="text-sm font-medium">{t("bySectionTitle")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("bySectionHint")}
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {OUTFLOW_SECTIONS.map((s) => {
            const cents = Math.abs(agg.actual[s] ?? 0);
            const pct =
              totalOutCents > 0 ? (cents / totalOutCents) * 100 : 0;
            return (
              <li key={s} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span>{tSections(SECTION_TR_KEY[s] as never)}</span>
                  <span className="num text-muted-foreground">
                    {formatEUR(cents / 100, locale)} · {pct.toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${pct.toFixed(2)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Top categories */}
      <Card className="border-border/40 bg-card/60 p-5">
        <h2 className="text-sm font-medium">{t("topCategoriesTitle")}</h2>
        {topCategories.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("emptyHint")}
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {topCategories.map((row) => {
              const cents = Math.abs(Number.parseInt(row.sum, 10));
              const pct =
                totalOutCents > 0 ? (cents / totalOutCents) * 100 : 0;
              return (
                <li key={row.itemId} className="flex items-center gap-3 py-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{row.name}</p>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct.toFixed(2)}%` }}
                      />
                    </div>
                  </div>
                  <span className="num shrink-0 text-sm font-medium">
                    {formatEUR(cents / 100, locale)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Top merchants */}
      <Card className="border-border/40 bg-card/60 p-5">
        <h2 className="text-sm font-medium">{t("topMerchantsTitle")}</h2>
        {topMerchants.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("emptyHint")}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border/40">
            {topMerchants.map((row) => {
              const cents = Math.abs(Number.parseInt(row.sum, 10));
              const count = Number.parseInt(row.count, 10);
              return (
                <li
                  key={row.counterparty ?? "unknown"}
                  className="flex items-center gap-3 py-2.5"
                >
                  <CounterpartyAvatar name={row.counterparty} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {row.counterparty ?? "—"}
                    </p>
                    <p className="num text-xs text-muted-foreground">
                      {t("hits", { n: count })}
                    </p>
                  </div>
                  <span className="num shrink-0 text-sm font-medium">
                    {formatEUR(cents / 100, locale)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Link
        href="/tikkie"
        className="text-center text-xs text-primary underline-offset-2 hover:underline"
      >
        {tTikkie("heading")} →
      </Link>
    </main>
  );
}

function anchorLabel(year: number, month: number, locale: string): string {
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  })
    .format(date)
    .replace(/^\w/, (c) => c.toUpperCase());
}
