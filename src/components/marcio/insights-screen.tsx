"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Link } from "@/i18n/navigation.ts";
import { CounterpartyAvatar } from "./counterparty-avatar.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { formatEUR } from "@/lib/format.ts";
import { OUTFLOW_SECTIONS, SECTION_TR_KEY } from "@/lib/import/sections.ts";

export function InsightsScreen({ locale }: { locale: string }) {
  const t = useTranslations("Insights");
  const tSections = useTranslations("Sections");
  const tTikkie = useTranslations("Tikkie");
  const { data, isLoading } = trpc.insights.get.useQuery();

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
            {data?.anchor
              ? anchorLabel(data.anchor.year, data.anchor.month, locale)
              : ""}
          </span>
        </div>
      </header>

      <Card className="border-border/40 bg-card/60 p-5">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("totalSpent")}
        </p>
        {isLoading ? (
          <Skeleton className="mt-1 h-9 w-40" />
        ) : (
          <p className="num mt-1 text-3xl font-semibold tracking-tight">
            {formatEUR((data?.totalOutCents ?? 0) / 100, locale)}
          </p>
        )}
      </Card>

      <Card className="border-border/40 bg-card/60 p-5">
        <h2 className="text-sm font-medium">{t("bySectionTitle")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("bySectionHint")}
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {OUTFLOW_SECTIONS.map((s) => {
            const cents = Math.abs(data?.actual?.[s] ?? 0);
            const total = data?.totalOutCents ?? 0;
            const pct = total > 0 ? (cents / total) * 100 : 0;
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
        prefetch
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
