"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Link } from "@/i18n/navigation.ts";
import { ActivityRow } from "./activity-row.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { formatEUR } from "@/lib/format.ts";
import { SECTION_ORDER, SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";

export function ActivityScreen({ locale }: { locale: string }) {
  const t = useTranslations("Activity");
  const tSections = useTranslations("Sections");
  const { data, isLoading } = trpc.activity.get.useQuery();

  const sectionLabels = useMemo(
    () =>
      SECTION_ORDER.reduce(
        (acc, s) => {
          acc[s] = tSections(SECTION_TR_KEY[s] as never);
          return acc;
        },
        {} as Record<Section, string>,
      ),
    [tSections],
  );

  const groups = useMemo(() => {
    if (!data) return [];
    const out: { date: string; rows: typeof data.txns }[] = [];
    for (const r of data.txns) {
      const key = formatGroupDate(new Date(r.bookingDate), locale);
      const last = out[out.length - 1];
      if (last && last.date === key) last.rows.push(r);
      else out.push({ date: key, rows: [r] });
    }
    return out;
  }, [data, locale]);

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
          {t("monthSpend")}
        </p>
        {isLoading ? (
          <Skeleton className="mt-1 h-7 w-32" />
        ) : (
          <p className="num mt-1 text-2xl font-semibold tracking-tight">
            {formatEUR((data?.monthSpend ?? 0) / 100, locale)}
          </p>
        )}
        <p className="num mt-1 text-xs text-muted-foreground">
          {t("txCount", { n: data?.txns.length ?? 0 })}
        </p>
      </Card>

      {data?.forecast.charges.length ? (
        <Card className="border-border/40 bg-card/60 p-5">
          <header className="flex items-baseline justify-between">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {t("upcomingTitle")}
            </p>
            <p className="num text-sm font-semibold">
              {formatEUR(data.forecast.totalRemainingCents / 100, locale)}
            </p>
          </header>
          <ul className="mt-2 divide-y divide-border/40">
            {data.forecast.charges.slice(0, 6).map((c) => (
              <li key={c.budgetItemId}>
                <Link
                  href={`/month/${c.budgetItemId}` as `/month/${string}`}
                  className="flex items-center gap-3 py-2 transition-colors hover:opacity-80"
                >
                  <div className="num grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
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

      {isLoading ? (
        <Card className="flex flex-col gap-3 border-border/40 bg-card/40 p-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </Card>
      ) : !data || data.txns.length === 0 ? (
        <Card className="border-border/40 bg-card/40 p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </Card>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.date} className="flex flex-col gap-1">
              <p className="sticky top-0 z-10 -mx-1 bg-background/85 px-2 py-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground backdrop-blur supports-backdrop-filter:bg-background/70">
                {g.date}
              </p>
              <Card className="border-border/40 bg-card/60 p-1">
                <ul className="divide-y divide-border/40">
                  {g.rows.map((r) => {
                    const optsForScope = data.optionsAll.filter(
                      (o) => o.scope === r.owner,
                    );
                    return (
                      <li key={r.id} className="px-2">
                        <ActivityRow
                          tx={{
                            id: r.id,
                            counterparty: r.counterparty,
                            description: r.description,
                            bookingDate: r.bookingDate,
                            amountCents: r.amountCents,
                            matchedName: r.matchedName,
                            owner: r.owner,
                          }}
                          options={optsForScope}
                          locale={locale}
                          sectionLabels={sectionLabels}
                        />
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
          <Link
            href="/transactions"
            className="text-center text-xs text-primary underline-offset-2 hover:underline"
          >
            {t("seeAllHistory")}
          </Link>
        </>
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
