import { setRequestLocale, getTranslations } from "next-intl/server";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Check, AlertCircle } from "lucide-react";
import { db } from "@/db/index.ts";
import { budgetItem, month, txMatch, transaction } from "@/db/schema.ts";
import { Card } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Link } from "@/i18n/navigation.ts";
import { formatEUR } from "@/lib/format.ts";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
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

  // SAZONAIS items for the current month.
  const rawItems = monthRow
    ? await db
        .select({
          id: budgetItem.id,
          name: budgetItem.name,
          section: budgetItem.section,
          plannedCents: budgetItem.plannedCents,
          sazonalKind: budgetItem.sazonalKind,
        })
        .from(budgetItem)
        .where(
          and(
            eq(budgetItem.monthId, monthRow.id),
            eq(budgetItem.section, "SAZONAIS"),
            inArray(budgetItem.scope, allowed),
          ),
        )
        .orderBy(asc(budgetItem.sazonalKind), asc(budgetItem.name))
    : [];

  // Sum matched transactions per budget item within the payday-month range.
  const sums =
    rawItems.length > 0
      ? await db
          .select({
            budgetItemId: txMatch.budgetItemId,
            sum: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
          })
          .from(txMatch)
          .innerJoin(transaction, eq(transaction.id, txMatch.transactionId))
          .where(
            and(
              inArray(
                txMatch.budgetItemId,
                rawItems.map((i) => i.id),
              ),
              gte(transaction.bookingDate, range.startsOn),
              lte(transaction.bookingDate, range.endsOn),
            ),
          )
          .groupBy(txMatch.budgetItemId)
      : [];

  const sumByItem = new Map<string, number>(
    sums.map((r) => [r.budgetItemId, Number.parseInt(r.sum, 10)]),
  );
  const items = rawItems.map((it) => ({
    ...it,
    actualCents: String(sumByItem.get(it.id) ?? 0),
  }));

  const obrigatorio = items.filter((i) => i.sazonalKind === "O");
  const lazer = items.filter((i) => i.sazonalKind === "L");
  const otros = items.filter((i) => !i.sazonalKind);

  const totalPlannedCents = items.reduce(
    (s, i) => s + Math.abs(i.plannedCents),
    0,
  );
  const totalContributedCents = items.reduce(
    (s, i) => s + Math.abs(Number.parseInt(i.actualCents, 10)),
    0,
  );
  const ratio =
    totalPlannedCents > 0 ? totalContributedCents / totalPlannedCents : 0;

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

      {items.length === 0 ? (
        <Card className="border-border/40 bg-card/40 p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </Card>
      ) : (
        <>
          <Card className="border-border/40 bg-card/60 p-5">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {t("monthlySummary")}
            </p>
            <p className="num mt-1 text-2xl font-semibold tracking-tight">
              {formatEUR(totalContributedCents / 100, locale)}
              <span className="text-sm font-normal text-muted-foreground">
                {" / "}
                {formatEUR(totalPlannedCents / 100, locale)}
              </span>
            </p>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${Math.min(100, ratio * 100).toFixed(2)}%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("monthlyHint", { count: items.length })}
            </p>
          </Card>

          {obrigatorio.length > 0 ? (
            <BucketGroup
              title={t("obrigatorio")}
              hint={t("obrigatorioHint")}
              items={obrigatorio}
              locale={locale}
              t={t}
            />
          ) : null}

          {lazer.length > 0 ? (
            <BucketGroup
              title={t("lazer")}
              hint={t("lazerHint")}
              items={lazer}
              locale={locale}
              t={t}
            />
          ) : null}

          {otros.length > 0 ? (
            <BucketGroup
              title={t("untagged")}
              hint={null}
              items={otros}
              locale={locale}
              t={t}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */

type BucketRow = {
  id: string;
  name: string;
  plannedCents: number;
  actualCents: string;
  sazonalKind: "O" | "L" | null;
};

function BucketGroup({
  title,
  hint,
  items,
  locale,
  t,
}: {
  title: string;
  hint: string | null;
  items: BucketRow[];
  locale: string;
  t: (k: "yearEstimate" | "missed") => string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </h2>
      </header>
      {hint ? <p className="-mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <Card className="border-border/40 bg-card/60 p-1">
        <ul className="divide-y divide-border/40">
          {items.map((it) => {
            const planned = Math.abs(it.plannedCents);
            const actual = Math.abs(Number.parseInt(it.actualCents, 10));
            const done = actual >= planned * 0.95;
            const yearly = planned * 12;
            return (
              <li key={it.id}>
                <Link
                  href={`/mes/${it.id}` as `/mes/${string}`}
                  className="flex items-center gap-3 rounded px-3 py-2.5 transition-colors hover:bg-card/40"
                >
                  <div
                    className={`grid size-8 shrink-0 place-items-center rounded-full ${
                      done
                        ? "bg-primary/20 text-primary"
                        : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    {done ? (
                      <Check className="size-4" strokeWidth={2.4} />
                    ) : (
                      <AlertCircle className="size-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{it.name}</p>
                    <p className="num text-xs text-muted-foreground">
                      {formatEUR(actual / 100, locale)} /{" "}
                      {formatEUR(planned / 100, locale)} ·{" "}
                      {t("yearEstimate")} {formatEUR(yearly / 100, locale)}
                    </p>
                  </div>
                  {!done ? (
                    <Badge
                      variant="secondary"
                      className="shrink-0 bg-destructive/15 px-2 py-0 text-[10px] text-destructive"
                    >
                      {t("missed")}
                    </Badge>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
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
