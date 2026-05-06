"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Calendar, Inbox, Sparkles, ChevronRight, PieChart } from "lucide-react";
import { AnimatedNumber } from "./animated-number.tsx";
import { MonthScopeBar, parseSearch } from "./month-scope-bar.tsx";
import { formatEUR, formatPercent } from "@/lib/format.ts";
import { trpc } from "@/lib/trpc/client.ts";
import { SectionDrillSheet } from "./section-drill-sheet.tsx";
import { Link } from "@/i18n/navigation.ts";
import type { Section } from "@/lib/import/types.ts";

export function TodayScreen({
  locale,
  defaultAnchor,
}: {
  locale: string;
  defaultAnchor: { year: number; month: number };
}) {
  const t = useTranslations();
  const sp = useSearchParams();
  const { anchor, scope } = parseSearch(sp, defaultAnchor);
  const { data } = trpc.today.get.useQuery({ anchor, scope });

  const daysUntilPayday = data?.daysUntilPayday ?? 0;
  const plannedOutflowCents = data?.plannedOutflowCents ?? 0;
  const spentOutflowCents = data?.spentOutflowCents ?? 0;
  const marginCents = data?.marginCents ?? 0;
  const progress = data?.progress ?? 0;
  const remainingCents = data?.remainingCents ?? 0;
  const forecast = data?.forecast ?? { charges: [], totalRemainingCents: 0 };
  const sectionData = data?.sectionData ?? [];
  const inboxCount = data?.inboxCount ?? 0;
  const sectionByKey = new Map(sectionData.map((s) => [s.section, s]));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pb-32 pt-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {t("Brand.name")}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {t("Today.spentSoFar")}
            </h1>
          </div>
          {data ? (
            <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
              <Calendar className="size-3" />
              {t("Today.untilPayday", { days: daysUntilPayday })}
            </Badge>
          ) : (
            <Skeleton className="h-6 w-24 rounded-full" />
          )}
        </div>
        <MonthScopeBar defaultAnchor={defaultAnchor} />
      </header>

      <Card className="relative overflow-hidden border-border/40 bg-card/60 p-6">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("Today.spentSoFar")}
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          {data ? (
            <AnimatedNumber
              value={spentOutflowCents / 100}
              locale={locale}
              currency="EUR"
              className="text-5xl font-semibold tracking-tight"
              cacheKey="today-spent"
            />
          ) : (
            <Skeleton className="h-12 w-40" />
          )}
        </div>
        <p className="num mt-1 text-sm text-muted-foreground">
          {data ? (
            t("Today.ofPlanned", {
              planned: formatEUR(plannedOutflowCents / 100, locale),
            })
          ) : (
            <Skeleton className="inline-block h-3 w-32 align-middle" />
          )}
        </p>

        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
            style={{
              width: `${Math.min(100, progress * 100).toFixed(2)}%`,
            }}
          />
        </div>
        <div className="num mt-3 flex items-center justify-between text-xs text-muted-foreground">
          {data ? (
            <>
              <span>{formatPercent(progress, locale)}</span>
              <span>
                {t("Today.remaining")}: {formatEUR(remainingCents / 100, locale)}
              </span>
            </>
          ) : (
            <>
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-3 w-24" />
            </>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {(["FIXAS", "VARIAVEIS", "SAZONAIS"] as const).map((s) => {
          const sec = sectionByKey.get(s);
          if (sec) {
            return (
              <SectionDrillSheet
                key={s}
                data={sec}
                label={t(`Sections.${labelKeyFor(s)}`)}
                locale={locale}
                accent={s === "FIXAS"}
                paidLabel={t("Today.paidThisMonth")}
                expectedLabel={t("Today.expectedThisMonth")}
                totalLabel={t("Today.sectionEmpty")}
                daySuffix={t("Today.dayPrefix")}
              />
            );
          }
          // Reserve space while data loads so the section grid doesn't shift.
          return (
            <Card
              key={s}
              className="border-border/40 bg-card/60 p-4"
            >
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {t(`Sections.${labelKeyFor(s)}`)}
              </p>
              <Skeleton className="mt-1 h-6 w-24" />
              <Skeleton className="mt-2 h-1 w-full" />
            </Card>
          );
        })}
        <SectionStat
          label={t("Sections.margem")}
          plannedCents={marginCents}
          actualCents={null}
          locale={locale}
          tone={marginCents < 0 ? "negative" : "neutral"}
          signed
        />
      </div>

      {forecast.charges.length > 0 ? (
        <Card className="border-border/40 bg-card/60 p-5">
          <header className="flex items-baseline justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {t("Today.upcomingTitle")}
              </p>
              <p className="num mt-0.5 text-lg font-semibold tracking-tight">
                {formatEUR(forecast.totalRemainingCents / 100, locale)}
              </p>
            </div>
            <p className="num text-xs text-muted-foreground">
              {t("Today.upcomingCount", { n: forecast.charges.length })}
            </p>
          </header>
          <ul className="mt-3 divide-y divide-border/40">
            {forecast.charges.slice(0, 5).map((c) => (
              <li key={c.budgetItemId}>
                <Link
                  href={`/month/${c.budgetItemId}` as `/month/${string}`}
                  className="flex items-center gap-3 py-2 transition-colors hover:opacity-80"
                  prefetch
                >
                  <div className="num grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {c.predictedDay ?? "—"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{c.name}</p>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {forecastSourceLabel(c.source, t)}
                    </p>
                  </div>
                  <span className="num shrink-0 text-sm font-medium">
                    {formatEUR(Math.abs(c.plannedCents) / 100, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {inboxCount > 0 ? (
        <Link href="/inbox" className="block" prefetch>
          <Card className="flex items-center gap-3 border-border/40 bg-card/60 p-5 transition-colors hover:bg-card/80">
            <div className="grid size-9 place-items-center rounded-full bg-primary/15 text-primary">
              <Inbox className="size-4" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{t("Today.inboxTitle")}</p>
              <p className="num text-xs text-muted-foreground">
                {t("Today.inboxCount", { n: inboxCount })}
              </p>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Card>
        </Link>
      ) : (
        <Card className="flex items-center gap-3 border-border/40 bg-card/60 p-5">
          <div className="grid size-9 place-items-center rounded-full bg-primary/15 text-primary">
            <Sparkles className="size-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">{t("Today.allCaughtUp")}</p>
            <p className="text-xs text-muted-foreground">
              {t("Today.allCaughtUpHint")}
            </p>
          </div>
        </Card>
      )}

      <Link href="/insights" className="block" prefetch>
        <Card className="flex items-center gap-3 border-border/40 bg-card/60 p-5 transition-colors hover:bg-card/80">
          <div className="grid size-9 place-items-center rounded-full bg-secondary text-foreground/80">
            <PieChart className="size-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">{t("Today.insightsTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("Today.insightsHint")}
            </p>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Card>
      </Link>

      <p className="text-center text-xs text-muted-foreground">
        {t("Today.monthAnchor")}
      </p>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function forecastSourceLabel(
  src: "due-day" | "history-median" | "month-end",
  t: (k: string) => string,
): string {
  if (src === "due-day") return t("Today.forecastDue");
  if (src === "history-median") return t("Today.forecastHistory");
  return t("Today.forecastMonthEnd");
}

function labelKeyFor(s: Section): string {
  if (s === "FIXAS") return "fixas";
  if (s === "VARIAVEIS") return "variaveis";
  if (s === "SAZONAIS") return "sazonais";
  if (s === "DIVIDAS") return "dividas";
  if (s === "ECONOMIAS") return "economias";
  return "entradas";
}

function SectionStat({
  label,
  plannedCents,
  actualCents,
  locale,
  accent = false,
  tone = "neutral",
  signed: _signed = false,
}: {
  label: string;
  plannedCents: number;
  actualCents: number | null;
  locale: string;
  accent?: boolean;
  tone?: "neutral" | "negative";
  signed?: boolean;
}) {
  const showActual = actualCents !== null;
  const big = showActual ? actualCents : plannedCents;
  const ratio =
    showActual && plannedCents > 0
      ? Math.min(1, actualCents / plannedCents)
      : 0;
  return (
    <Card
      className={`relative overflow-hidden border-border/40 bg-card/60 p-4 ${
        accent ? "ring-1 ring-primary/30" : ""
      }`}
    >
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`num mt-1 text-xl font-semibold tracking-tight ${
          tone === "negative" ? "text-destructive" : ""
        }`}
      >
        {formatEUR((big ?? 0) / 100, locale)}
      </p>
      {showActual ? (
        <p className="num mt-0.5 text-[11px] text-muted-foreground">
          / {formatEUR(plannedCents / 100, locale)}
        </p>
      ) : null}
      {showActual && plannedCents > 0 ? (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${(ratio * 100).toFixed(2)}%` }}
          />
        </div>
      ) : null}
    </Card>
  );
}
