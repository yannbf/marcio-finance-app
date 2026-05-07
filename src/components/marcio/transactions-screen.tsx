"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Loader2 } from "lucide-react";
import { Link, useRouter, usePathname } from "@/i18n/navigation.ts";
import { ActivityRow } from "./activity-row.tsx";
import { MonthScopeBar, parseSearch } from "./month-scope-bar.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { SECTION_ORDER, SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";

export function TransactionsScreen({
  locale,
  defaultAnchor,
  defaultScope = "joint",
}: {
  locale: string;
  defaultAnchor: { year: number; month: number };
  defaultScope?: "joint" | "yann" | "camila";
}) {
  const t = useTranslations("Transactions");
  const tSections = useTranslations("Sections");
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const q = (sp.get("q") ?? "").trim();
  const showRaw = sp.get("show") ?? "all";
  const show = (showRaw === "matched" || showRaw === "unmatched"
    ? showRaw
    : "all") as "all" | "matched" | "unmatched";
  const { scope } = parseSearch(sp, defaultAnchor, defaultScope);

  // Cache key is (show, scope) only — keystrokes never refetch. Pages
  // accumulate so "Load more" extends the searchable window.
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = trpc.transactions.list.useInfiniteQuery(
    { show, scope },
    {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    },
  );

  const allRows = useMemo(
    () => data?.pages.flatMap((p) => p.rows) ?? null,
    [data],
  );
  const optionsAll = data?.pages[0]?.optionsAll ?? [];
  const pageSize = data?.pages[0]?.pageSize ?? 100;

  // The input is the source of truth while typing. We only seed it from the
  // URL on initial mount and refresh it if the URL changed without us asking
  // (back/forward, deep link). When the user types we never bounce back to
  // the URL value mid-stroke — that's what was eating keystrokes before.
  const [draft, setDraft] = useState(q);
  const lastWroteRef = useRef(q);
  useEffect(() => {
    if (q === lastWroteRef.current) return;
    setDraft(q);
    lastWroteRef.current = q;
  }, [q]);
  useEffect(() => {
    const next = draft.trim();
    if (next === lastWroteRef.current) return;
    const id = window.setTimeout(() => {
      lastWroteRef.current = next;
      const params = new URLSearchParams(sp.toString());
      if (next) params.set("q", next);
      else params.delete("q");
      const qs = params.toString();
      router.replace(
        (qs
          ? `${pathname}?${qs}`
          : pathname) as `/transactions${string}`,
        { scroll: false },
      );
    }, 350);
    return () => window.clearTimeout(id);
  }, [draft, sp, router, pathname]);

  const filteredRows = useMemo(() => {
    if (!allRows) return null;
    const needle = draft.trim().toLowerCase();
    if (!needle) return allRows;
    return allRows.filter((r) => {
      const cp = (r.counterparty ?? "").toLowerCase();
      const desc = (r.description ?? "").toLowerCase();
      const matched = (r.matchedName ?? "").toLowerCase();
      return (
        cp.includes(needle) ||
        desc.includes(needle) ||
        matched.includes(needle)
      );
    });
  }, [allRows, draft]);

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
    if (!filteredRows) return [];
    const out: { date: string; rows: typeof filteredRows }[] = [];
    for (const r of filteredRows) {
      const key = formatGroupDate(new Date(r.bookingDate), locale);
      const last = out[out.length - 1];
      if (last && last.date === key) last.rows.push(r);
      else out.push({ date: key, rows: [r] });
    }
    return out;
  }, [filteredRows, locale]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pb-8 pt-8">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        <MonthScopeBar defaultAnchor={defaultAnchor} defaultScope={defaultScope} />
      </header>

      <div className="flex flex-col gap-3">
        <Input
          name="q"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          type="search"
          inputMode="search"
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
      </div>

      {isLoading ? (
        <Card className="flex flex-col gap-3 border-border/40 bg-card/40 p-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </Card>
      ) : !filteredRows || filteredRows.length === 0 ? (
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
                  const optsForScope = optionsAll.filter(
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
                          matchedItemId: r.matchedItemId,
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

      {hasNextPage && allRows && allRows.length > 0 ? (
        <Button
          variant="outline"
          className="self-center"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          {t("loadMore", { n: pageSize })}
        </Button>
      ) : null}

      {!hasNextPage && allRows && allRows.length > pageSize ? (
        <p className="text-center text-xs text-muted-foreground">
          {t("loadedAll", { n: allRows.length })}
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
