"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Check } from "lucide-react";
import { Link } from "@/i18n/navigation.ts";
import {
  MonthScopeBar,
  parseSearch,
} from "./month-scope-bar.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { formatEUR } from "@/lib/format.ts";
import { SECTION_ORDER, SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";

type ItemRow = {
  id: string;
  name: string;
  section: Section;
  plannedCents: number;
  dueDay: number | null;
  sazonalKind: "O" | "L" | null;
  matchCount: number;
};

export function MonthScreen({
  locale,
  defaultAnchor,
  defaultScope = "joint",
}: {
  locale: string;
  defaultAnchor: { year: number; month: number };
  defaultScope?: "joint" | "yann" | "camila";
}) {
  const t = useTranslations();
  const sp = useSearchParams();
  const { anchor, scope } = parseSearch(sp, defaultAnchor, defaultScope);

  const { data, isLoading } = trpc.month.get.useQuery({
    scope,
    anchor,
  });

  const grouped = useMemo(() => {
    const out = new Map<Section, ItemRow[]>();
    if (!data) return out;
    for (const i of data.items) {
      const arr = out.get(i.section) ?? [];
      arr.push(i);
      out.set(i.section, arr);
    }
    return out;
  }, [data]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-8 pt-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Nav.month")}
        </h1>
        <MonthScopeBar defaultAnchor={defaultAnchor} defaultScope={defaultScope} />
      </header>

      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          label={t("Month.income")}
          cents={data?.totals.income ?? 0}
          locale={locale}
          loading={isLoading}
        />
        <SummaryCard
          label={t("Month.outflow")}
          cents={data?.totals.outflow ?? 0}
          locale={locale}
          loading={isLoading}
        />
        <SummaryCard
          label={t("Month.margin")}
          cents={data?.totals.margin ?? 0}
          locale={locale}
          loading={isLoading}
          highlight={(data?.totals.margin ?? 0) < 0 ? "negative" : "neutral"}
        />
      </div>

      {isLoading ? (
        <Card className="flex flex-col gap-2 border-border/40 bg-card/40 p-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </Card>
      ) : !data || data.items.length === 0 ? (
        <Card className="border-border/40 bg-card/60 p-6 text-center text-sm text-muted-foreground">
          <p>{t("Month.noData")}</p>
          <Link
            href="/import"
            className="mt-3 inline-block text-primary underline-offset-2 hover:underline"
          >
            {t("Import.run")}
          </Link>
        </Card>
      ) : (
        SECTION_ORDER.map((section) => {
          const list = grouped.get(section);
          if (!list || list.length === 0) return null;
          return (
            <SectionCard
              key={section}
              section={section}
              items={list}
              locale={locale}
              label={t(`Sections.${SECTION_TR_KEY[section]}`)}
            />
          );
        })
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function SummaryCard({
  label,
  cents,
  locale,
  highlight,
  loading,
}: {
  label: string;
  cents: number;
  locale: string;
  highlight?: "negative" | "neutral";
  loading?: boolean;
}) {
  return (
    <Card className="border-border/40 bg-card/60 p-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-1 h-5 w-20" />
      ) : (
        <p
          className={`num mt-1 text-base font-semibold tracking-tight ${
            highlight === "negative" ? "text-destructive" : ""
          }`}
        >
          {formatEUR(cents / 100, locale)}
        </p>
      )}
    </Card>
  );
}

function SectionCard({
  section,
  items,
  locale,
  label,
}: {
  section: Section;
  items: ItemRow[];
  locale: string;
  label: string;
}) {
  const total = items.reduce((s, i) => s + i.plannedCents, 0);
  return (
    <Card className="border-border/40 bg-card/60 p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </h2>
        <p className="num text-sm font-semibold">
          {formatEUR(total / 100, locale)}
        </p>
      </header>
      <ul className="mt-3 divide-y divide-border/40">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/month/${item.id}` as `/month/${string}`}
              className="-mx-2 flex items-center justify-between gap-3 rounded px-2 py-2 text-sm transition-colors hover:bg-card/40"
              prefetch
            >
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-full ${
                  item.matchCount > 0
                    ? "bg-primary/15 text-primary"
                    : "border border-dashed border-border/60"
                }`}
                aria-label={item.matchCount > 0 ? "paid" : "not paid"}
              >
                {item.matchCount > 0 ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : null}
              </span>
              <span className="flex flex-1 items-baseline gap-2 truncate">
                <span className="truncate">{item.name}</span>
                {item.dueDay ? (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {item.dueDay}
                  </Badge>
                ) : null}
                {section === "SAZONAIS" && item.sazonalKind ? (
                  <Badge
                    variant={item.sazonalKind === "O" ? "default" : "secondary"}
                    className="px-1.5 py-0 text-[10px]"
                  >
                    {item.sazonalKind}
                  </Badge>
                ) : null}
              </span>
              <span className="num text-foreground">
                {formatEUR(item.plannedCents / 100, locale)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

