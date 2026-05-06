import { setRequestLocale, getTranslations } from "next-intl/server";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { Check, AlertCircle, Plus } from "lucide-react";
import { db } from "@/db/index.ts";
import {
  budgetItem,
  month,
  savingsAccount,
  txMatch,
  transaction,
} from "@/db/schema.ts";
import { Card } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Link } from "@/i18n/navigation.ts";
import { formatEUR } from "@/lib/format.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { monthlyContributionCents } from "@/lib/cadence.ts";
import type { Locale } from "@/i18n/routing.ts";

export default async function BucketsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Buckets");
  const me = await getCurrentUser();
  const settings = await getHouseholdSettings();

  const allowed: ("joint" | "camila" | "yann")[] = me
    ? ["joint", me.role]
    : ["joint"];

  const range = paydayMonthFor(new Date(), settings.paydayDay);
  const [monthRow] = await db
    .select()
    .from(month)
    .where(
      and(
        eq(month.anchorYear, range.anchorYear),
        eq(month.anchorMonth, range.anchorMonth),
      ),
    );

  // All declared savings accounts the user can see.
  const accounts = await db
    .select()
    .from(savingsAccount)
    .where(inArray(savingsAccount.owner, allowed))
    .orderBy(asc(savingsAccount.owner), asc(savingsAccount.nickname));

  // Every SAZONAIS item for the current month, with planned + actual sums.
  const items = monthRow
    ? await db
        .select({
          id: budgetItem.id,
          name: budgetItem.name,
          scope: budgetItem.scope,
          plannedCents: budgetItem.plannedCents,
          sazonalKind: budgetItem.sazonalKind,
          savingsAccountId: budgetItem.savingsAccountId,
        })
        .from(budgetItem)
        .where(
          and(
            eq(budgetItem.monthId, monthRow.id),
            eq(budgetItem.section, "SAZONAIS"),
            inArray(budgetItem.scope, allowed),
          ),
        )
        .orderBy(asc(budgetItem.name))
    : [];

  // Sum of matched-this-month per item.
  const sums = items.length
    ? await db
        .select({
          itemId: txMatch.budgetItemId,
          sum: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
        })
        .from(txMatch)
        .innerJoin(transaction, eq(transaction.id, txMatch.transactionId))
        .where(
          and(
            inArray(
              txMatch.budgetItemId,
              items.map((i) => i.id),
            ),
            gte(transaction.bookingDate, range.startsOn),
            lte(transaction.bookingDate, range.endsOn),
          ),
        )
        .groupBy(txMatch.budgetItemId)
    : [];

  const sumByItem = new Map<string, number>(
    sums.map((s) => [s.itemId, Number.parseInt(s.sum, 10)]),
  );

  // Group items into their savings accounts; orphans go in a separate group.
  const itemsByAccount = new Map<string, typeof items>();
  const orphans: typeof items = [];
  for (const it of items) {
    if (it.savingsAccountId) {
      const arr = itemsByAccount.get(it.savingsAccountId) ?? [];
      arr.push(it);
      itemsByAccount.set(it.savingsAccountId, arr);
    } else {
      orphans.push(it);
    }
  }

  // Aggregate per account. SAZONAIS items hold yearly costs in the sheet,
  // so what counts toward this month's contribution is amount/12. Actuals
  // are already this-month numbers — no conversion needed.
  const groups = accounts.map((a) => {
    const list = itemsByAccount.get(a.id) ?? [];
    const planned = list.reduce(
      (s, i) =>
        s +
        Math.abs(
          monthlyContributionCents(i.plannedCents, "SAZONAIS"),
        ),
      0,
    );
    const actual = list.reduce(
      (s, i) => s + Math.abs(sumByItem.get(i.id) ?? 0),
      0,
    );
    return { account: a, items: list, planned, actual };
  });

  const totalPlanned = groups.reduce((s, g) => s + g.planned, 0);
  const totalActual = groups.reduce((s, g) => s + g.actual, 0);
  const ratio = totalPlanned > 0 ? totalActual / totalPlanned : 0;

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

      {accounts.length === 0 ? (
        <Card className="flex flex-col items-start gap-3 border-border/40 bg-card/40 p-5 text-sm">
          <p className="text-muted-foreground">{t("noAccounts")}</p>
          <Link
            href="/settings/savings"
            className="inline-flex items-center gap-1.5 text-primary hover:underline"
          >
            <Plus className="size-4" />
            {t("addOne")}
          </Link>
        </Card>
      ) : (
        <>
          <Card className="border-border/40 bg-card/60 p-5">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {t("monthlySummary")}
            </p>
            <p className="num mt-1 text-2xl font-semibold tracking-tight">
              {formatEUR(totalActual / 100, locale)}
              <span className="text-sm font-normal text-muted-foreground">
                {" / "}
                {formatEUR(totalPlanned / 100, locale)}
              </span>
            </p>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, ratio * 100).toFixed(2)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("monthlyHint", { count: accounts.length })}
            </p>
          </Card>

          {groups.map((g) => (
            <BucketCard
              key={g.account.id}
              account={g.account}
              items={g.items.map((it) => ({
                ...it,
                plannedCents: monthlyContributionCents(
                  it.plannedCents,
                  "SAZONAIS",
                ),
                actualCents: Math.abs(sumByItem.get(it.id) ?? 0),
              }))}
              plannedCents={g.planned}
              actualCents={g.actual}
              locale={locale}
              t={t}
            />
          ))}
        </>
      )}

      {orphans.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("untagged")}
          </h2>
          <p className="-mt-1 text-xs text-muted-foreground">
            {t("untaggedHint")}
          </p>
          <Card className="border-border/40 bg-card/40 p-1">
            <ul className="divide-y divide-border/40">
              {orphans.map((it) => {
                const planned = Math.abs(
                  monthlyContributionCents(it.plannedCents, "SAZONAIS"),
                );
                const actual = Math.abs(sumByItem.get(it.id) ?? 0);
                return (
                  <li key={it.id}>
                    <Link
                      href={`/mes/${it.id}` as `/mes/${string}`}
                      className="flex items-center gap-3 rounded px-3 py-2.5 transition-colors hover:bg-card/40"
                    >
                      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                        <AlertCircle className="size-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {it.name}
                        </p>
                        <p className="num text-xs text-muted-foreground">
                          {formatEUR(actual / 100, locale)} /{" "}
                          {formatEUR(planned / 100, locale)}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      ) : null}
    </main>
  );
}

/* -------------------------------------------------------------------------- */

type BucketCardProps = {
  account: { id: string; nickname: string; ref: string; owner: string };
  items: {
    id: string;
    name: string;
    plannedCents: number;
    actualCents: number;
    sazonalKind: "O" | "L" | null;
  }[];
  plannedCents: number;
  actualCents: number;
  locale: string;
  t: (k: "noLinkedItems" | "linkItems" | "yearEstimate" | "missed") => string;
};

function BucketCard({
  account,
  items,
  plannedCents,
  actualCents,
  locale,
  t,
}: BucketCardProps) {
  const ratio = plannedCents > 0 ? actualCents / plannedCents : 0;
  const done = ratio >= 0.95;

  return (
    <Card className="border-border/40 bg-card/60 p-4">
      <header className="flex items-center gap-3">
        <div
          className={`grid size-9 shrink-0 place-items-center rounded-full ${
            done
              ? "bg-primary/15 text-primary"
              : plannedCents > 0
                ? "bg-destructive/15 text-destructive"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {done ? <Check className="size-4" strokeWidth={2.4} /> : null}
          {!done && plannedCents > 0 ? (
            <AlertCircle className="size-4" />
          ) : null}
          {plannedCents === 0 ? <Plus className="size-3.5" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.nickname}</p>
          <p className="num truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {account.ref} · {account.owner}
          </p>
        </div>
        <div className="text-right">
          <p className="num text-sm font-semibold">
            {formatEUR(actualCents / 100, locale)}
          </p>
          <p className="num text-[10px] text-muted-foreground">
            / {formatEUR(plannedCents / 100, locale)}
          </p>
        </div>
      </header>

      {plannedCents > 0 ? (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.min(100, ratio * 100).toFixed(2)}%` }}
          />
        </div>
      ) : null}

      {items.length === 0 ? (
        <Link
          href="/settings/savings"
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <Plus className="size-3" />
          {t("linkItems")}
        </Link>
      ) : (
        <ul className="mt-3 divide-y divide-border/40">
          {items.map((it) => (
            <li key={it.id}>
              <Link
                href={`/mes/${it.id}` as `/mes/${string}`}
                className="flex items-center gap-2 px-1 py-2 transition-colors hover:opacity-80"
              >
                {it.sazonalKind ? (
                  <Badge
                    variant={it.sazonalKind === "O" ? "default" : "secondary"}
                    className="px-1.5 py-0 text-[10px]"
                  >
                    {it.sazonalKind}
                  </Badge>
                ) : null}
                <span className="flex-1 truncate text-sm">{it.name}</span>
                <span className="num text-xs text-muted-foreground">
                  {formatEUR(Math.abs(it.plannedCents) / 100, locale)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
