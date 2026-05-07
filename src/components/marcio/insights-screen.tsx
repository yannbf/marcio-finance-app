"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Link } from "@/i18n/navigation.ts";
import { CounterpartyAvatar } from "./counterparty-avatar.tsx";
import { MonthScopeBar, parseSearch } from "./month-scope-bar.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { useMounted } from "@/lib/use-mounted.ts";
import { formatEUR, formatEURPrecise } from "@/lib/format.ts";
import { PiggyBank } from "lucide-react";
import { OUTFLOW_SECTIONS, SECTION_TR_KEY } from "@/lib/import/sections.ts";

export function InsightsScreen({
  locale,
  defaultAnchor,
  defaultScope = "joint",
}: {
  locale: string;
  defaultAnchor: { year: number; month: number };
  defaultScope?: "joint" | "yann" | "camila";
}) {
  const t = useTranslations("Insights");
  const tSections = useTranslations("Sections");
  const tTikkie = useTranslations("Tikkie");
  const sp = useSearchParams();
  const { anchor, scope } = parseSearch(sp, defaultAnchor, defaultScope);
  const mounted = useMounted();
  const query = trpc.insights.get.useQuery({ anchor, scope });
  const data = mounted ? query.data : undefined;
  const isLoading = mounted ? query.isLoading : true;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-8 pt-8">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        <MonthScopeBar defaultAnchor={defaultAnchor} defaultScope={defaultScope} />
      </header>

      <Card className="border-border/40 bg-card/60 p-5">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("totalSpent")}
        </p>
        {isLoading ? (
          <Skeleton className="mt-1 h-9 w-40" />
        ) : (
          <div className="mt-1 flex items-baseline gap-2">
            <p className="num text-3xl font-semibold tracking-tight">
              {formatEUR((data?.totalOutCents ?? 0) / 100, locale)}
            </p>
            <DeltaChip
              current={data?.totalOutCents ?? 0}
              previous={data?.previous?.totalOutCents ?? 0}
              t={t}
            />
          </div>
        )}
      </Card>

      {data?.roundup && data.roundup.count > 0 ? (
        <Card className="!flex-row items-center gap-3 border-border/40 bg-card/60 px-4 py-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <PiggyBank className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("roundupTitle")}</p>
            <p className="num text-xs text-muted-foreground">
              {t("roundupHint", { n: data.roundup.count })}
            </p>
          </div>
          <p className="num shrink-0 text-lg font-semibold tracking-tight">
            {formatEURPrecise(data.roundup.totalCents / 100, locale)}
          </p>
        </Card>
      ) : null}

      <Card className="border-border/40 bg-card/60 p-5">
        <h2 className="text-sm font-medium">{t("bySectionTitle")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("bySectionHint")}
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {OUTFLOW_SECTIONS.map((s) => {
            const cents = Math.abs(data?.actual?.[s] ?? 0);
            const prevCents = Math.abs(data?.previous?.actual?.[s] ?? 0);
            const total = data?.totalOutCents ?? 0;
            const pct = total > 0 ? (cents / total) * 100 : 0;
            return (
              <li key={s} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="flex items-baseline gap-1.5">
                    {tSections(SECTION_TR_KEY[s] as never)}
                    <DeltaChip
                      current={cents}
                      previous={prevCents}
                      t={t}
                      compact
                    />
                  </span>
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

      <Card className="border-border/40 bg-card/60 p-5">
        <h2 className="text-sm font-medium">{t("topCategoriesTitle")}</h2>
        {(data?.topCategories.length ?? 0) === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("emptyHint")}
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {data!.topCategories.map((row) => {
              const cents = Math.abs(Number.parseInt(row.sum, 10));
              const total = data!.totalOutCents;
              const pct = total > 0 ? (cents / total) * 100 : 0;
              const prevSum = row.naturalKey
                ? data!.previous?.categorySumsByNaturalKey?.[row.naturalKey]
                : undefined;
              const prevCents = prevSum
                ? Math.abs(Number.parseInt(prevSum, 10))
                : 0;
              return (
                <li key={row.itemId} className="flex items-center gap-3 py-1">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <p className="truncate text-sm">{row.name}</p>
                      <DeltaChip
                        current={cents}
                        previous={prevCents}
                        t={t}
                        compact
                      />
                    </div>
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

      <Card className="border-border/40 bg-card/60 p-5">
        <h2 className="text-sm font-medium">{t("topMerchantsTitle")}</h2>
        {(data?.topMerchants.length ?? 0) === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("emptyHint")}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border/40">
            {data!.topMerchants.map((row) => {
              const cents = Math.abs(Number.parseInt(row.sum, 10));
              const count = Number.parseInt(row.count, 10);
              const prevSum = row.counterparty
                ? data!.previous?.merchantSums?.[row.counterparty]
                : undefined;
              const prevCents = prevSum
                ? Math.abs(Number.parseInt(prevSum, 10))
                : 0;
              return (
                <li
                  key={row.counterparty ?? "unknown"}
                  className="flex items-center gap-3 py-2.5"
                >
                  <CounterpartyAvatar name={row.counterparty} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <p className="truncate text-sm font-medium">
                        {row.counterparty ?? "—"}
                      </p>
                      <DeltaChip
                        current={cents}
                        previous={prevCents}
                        t={t}
                        compact
                      />
                    </div>
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
        prefetch
      >
        {tTikkie("heading")} →
      </Link>
    </main>
  );
}


/**
 * "vs last month" delta chip.
 *
 * Renders nothing when there's no comparable previous-month spend (zero or
 * within a 1% noise threshold) — first-time use of insights with only one
 * month of data shouldn't show "+100%" on every section. The colour follows
 * the convention "spending more = bad (red), less = good (green)".
 */
function DeltaChip({
  current,
  previous,
  t,
  compact = false,
}: {
  current: number;
  previous: number;
  t: (k: string, vals?: Record<string, string | number>) => string;
  compact?: boolean;
}) {
  if (previous <= 0) return null;
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 1) return null;
  const direction = pct > 0 ? "up" : "down";
  const tone =
    direction === "up"
      ? "text-destructive bg-destructive/10"
      : "text-primary bg-primary/10";
  const sign = pct > 0 ? "+" : "−";
  const value = `${sign}${Math.abs(pct).toFixed(0)}%`;
  return (
    <span
      className={`num inline-flex items-center rounded px-1.5 ${
        compact ? "text-[9px]" : "text-[10px]"
      } font-medium ${tone}`}
      title={t("vsLastMonth")}
    >
      {value}
    </span>
  );
}
