"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Link } from "@/i18n/navigation.ts";
import { ActivityRow } from "./activity-row.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { SECTION_ORDER, SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";

export function TransactionsScreen({ locale }: { locale: string }) {
  const t = useTranslations("Transactions");
  const tSections = useTranslations("Sections");
  const sp = useSearchParams();
  const q = (sp.get("q") ?? "").trim();
  const showRaw = sp.get("show") ?? "all";
  const show = (showRaw === "matched" || showRaw === "unmatched"
    ? showRaw
    : "all") as "all" | "matched" | "unmatched";

  const { data, isLoading } = trpc.transactions.list.useQuery({
    q: q || undefined,
    show,
  });

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
    const out: { date: string; rows: typeof data.rows }[] = [];
    for (const r of data.rows) {
      const key = formatGroupDate(new Date(r.bookingDate), locale);
      const last = out[out.length - 1];
      if (last && last.date === key) last.rows.push(r);
      else out.push({ date: key, rows: [r] });
    }
    return out;
  }, [data, locale]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pb-8 pt-8">
      <header>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
      </header>

      <form className="flex flex-col gap-3">
        <Input
          name="q"
          defaultValue={q}
          placeholder={t("searchPlaceholder")}
          className="num"
        />
        <div className="flex gap-1 rounded-full border border-border/60 bg-card/50 p-1 text-xs">
          <FilterPill href={makeHref(q, "all")} active={show === "all"}>
            {t("filterAll")}
          </FilterPill>
          <FilterPill
            href={makeHref(q, "matched")}
            active={show === "matched"}
          >
            {t("filterMatched")}
          </FilterPill>
          <FilterPill
            href={makeHref(q, "unmatched")}
            active={show === "unmatched"}
          >
            {t("filterUnmatched")}
          </FilterPill>
        </div>
      </form>

      {isLoading ? (
        <Card className="flex flex-col gap-3 border-border/40 bg-card/40 p-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </Card>
      ) : !data || data.rows.length === 0 ? (
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
        ))
      )}

      {data && data.rows.length === data.pageSize ? (
        <p className="text-center text-xs text-muted-foreground">
          {t("limited", { n: data.pageSize })}
        </p>
      ) : null}
    </main>
  );
}

function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  const cls = active
    ? "bg-primary text-primary-foreground"
    : "text-muted-foreground hover:text-foreground";
  return (
    <Link
      href={href as `/transactions${string}`}
      className={`flex-1 rounded-full px-3 py-1.5 text-center uppercase tracking-[0.14em] transition-colors ${cls}`}
    >
      {children}
    </Link>
  );
}

function makeHref(q: string, show: string): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (show && show !== "all") params.set("show", show);
  const qs = params.toString();
  return qs ? `/transactions?${qs}` : "/transactions";
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
