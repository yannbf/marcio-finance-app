"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Link } from "@/i18n/navigation.ts";
import { ActivityRow } from "./activity-row.tsx";
import { AnimatedNumber } from "./animated-number.tsx";
import { CounterpartyAvatar } from "./counterparty-avatar.tsx";
import { MonthScopeBar, parseSearch } from "./month-scope-bar.tsx";
import {
  OverBudgetPill,
  SpendProgress,
  progressTone,
} from "./spend-progress.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { useMounted } from "@/lib/use-mounted.ts";
import { formatEUR, formatEURPrecise } from "@/lib/format.ts";
import { fingerprintCounterparty } from "@/lib/matching/fingerprint.ts";
import { isInternalTransferTx } from "@/lib/matching/seed-rules.ts";
import { isTikkie } from "@/lib/tikkie.ts";
import { SECTION_ORDER, SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app.ts";

type ActivityView = "date" | "amount";
type ActivityData = inferRouterOutputs<AppRouter>["activity"]["get"];
type Txn = ActivityData["txns"][number];
type OptionsAll = ActivityData["optionsAll"];

export function ActivityScreen({
  locale,
  defaultAnchor,
  defaultScope = "joint",
  defaultMeRole = null,
}: {
  locale: string;
  defaultAnchor: { year: number; month: number };
  defaultScope?: "joint" | "yann" | "camila";
  defaultMeRole?: "yann" | "camila" | null;
}) {
  const t = useTranslations("Activity");
  const tSections = useTranslations("Sections");
  const tToday = useTranslations("Today");
  const sp = useSearchParams();
  const { anchor, scope } = parseSearch(sp, defaultAnchor, defaultScope);
  // See useMounted note in today-screen.tsx — guards against the persister
  // restoring data before hydration and tripping a hydration mismatch.
  const mounted = useMounted();
  const query = trpc.activity.get.useQuery({ anchor, scope });
  const data = mounted ? query.data : undefined;
  const isLoading = mounted ? query.isLoading : true;

  // The active view (date timeline vs. merchant grouping) lives in
  // the URL so it survives reloads and can be shared. Default is the
  // chronological "by date" view that the user sees first.
  const viewRaw = sp.get("view");
  const view: ActivityView = viewRaw === "amount" ? "amount" : "date";

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

  // Per-transaction running totals: cumulative qualifying outflow AND
  // cumulative txn count, both from the start of the payday-month up to
  // and INCLUDING this txn. Same filter monthSpend uses (negative
  // amount, internal transfers excluded). Powers the single animated
  // "spent so far" headline that ticks as each row scrolls past —
  // mirrors ING's running-balance UX.
  const txRunning = useMemo(() => {
    type Cumulative = { runningCents: number; runningCount: number };
    if (!data) return new Map<string, Cumulative>();
    const map = new Map<string, Cumulative>();
    let runningCents = data.monthSpend;
    let runningCount = data.txns.length;
    for (const r of data.txns) {
      map.set(r.id, { runningCents, runningCount });
      runningCount -= 1;
      if (r.amountCents < 0 && !isInternalTransferTx(r)) {
        runningCents -= -r.amountCents;
      }
    }
    return map;
  }, [data]);

  const dateGroups = useMemo(() => {
    if (!data || view !== "date") return [];
    const out: { date: string; rows: Txn[] }[] = [];
    for (const r of data.txns) {
      const key = formatGroupDate(new Date(r.bookingDate), locale);
      const last = out[out.length - 1];
      if (last && last.date === key) last.rows.push(r);
      else out.push({ date: key, rows: [r] });
    }
    return out;
  }, [data, locale, view]);

  // Merchant groups: collapse same-counterparty rows (after stripping
  // city tails / terminal IDs / trailing digits) into one bucket so
  // "AH AMSTERDAM" and "AH UTRECHT" land together. Sort by the bigger
  // of total spend / total received so the heaviest impact bubbles to
  // the top.
  const merchantGroups = useMemo(() => {
    if (!data || view !== "amount") return [];
    type Bucket = {
      key: string;
      displayName: string;
      txns: Txn[];
      paidCents: number;
      receivedCents: number;
    };
    const groups = new Map<string, Bucket>();
    for (const tx of data.txns) {
      const cp = (tx.counterparty ?? "").trim() || "—";
      // Tikkies surface in two ING shapes: "AAB INZ TIKKIE" (topic +
      // sender baked into description) and "<Name> via Tikkie" (counter-
      // party already names the sender). Plain counterparty fingerprinting
      // would split those — collapse them into one canonical Tikkie
      // bucket so the "by amount" view doesn't fragment. The dedicated
      // /tikkie screen already breaks them out per person.
      const tikkieRow = isTikkie({
        counterparty: tx.counterparty,
        description: tx.description,
      });
      const key = tikkieRow
        ? "tikkie"
        : fingerprintCounterparty(cp) || cp.toLowerCase();
      const displayName = tikkieRow ? "Tikkie" : cp;
      const bucket = groups.get(key) ?? {
        key,
        displayName,
        txns: [],
        paidCents: 0,
        receivedCents: 0,
      };
      bucket.txns.push(tx);
      if (tx.amountCents < 0) bucket.paidCents += -tx.amountCents;
      else bucket.receivedCents += tx.amountCents;
      groups.set(key, bucket);
    }
    return [...groups.values()].sort((a, b) => {
      const aMax = Math.max(a.paidCents, a.receivedCents);
      const bMax = Math.max(b.paidCents, b.receivedCents);
      return bMax - aMax;
    });
  }, [data, view]);

  // The single animated "spent so far" indicator. As the user scrolls,
  // we track which row sits at the indicator line just below the sticky
  // headline card and feed its per-txn running cumulative into the
  // headline's AnimatedNumber. ING-style — the headline ticks as every
  // transaction crosses the line.
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const [scrolledRunningCents, setScrolledRunningCents] = useState<
    number | null
  >(null);
  const [scrolledRunningCount, setScrolledRunningCount] = useState<
    number | null
  >(null);
  const [scrolledDateLabel, setScrolledDateLabel] = useState<string | null>(
    null,
  );
  // True once any tx row has crossed the headline indicator line.
  // Drives the compact / opaque-header presentation — the headline
  // shrinks to a single thin row while the user is actively
  // scrolling through the month's transactions.
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (view !== "date" || !data || data.txns.length === 0) {
      setScrolledRunningCents(null);
      setScrolledRunningCount(null);
      setScrolledDateLabel(null);
      setCompact(false);
      return;
    }
    let raf: number | null = null;
    const tick = () => {
      raf = null;
      const indicatorEl = indicatorRef.current;
      if (!indicatorEl) return;
      const rect = indicatorEl.getBoundingClientRect();
      // Use a line just below the sticky headline. Rows whose top is at
      // or above this line have already scrolled "past" the indicator;
      // the most recently-passed one drives the displayed value.
      const lineY = rect.bottom + 8;
      const rows = document.querySelectorAll<HTMLElement>(
        "[data-tx-running]",
      );
      let chosen: HTMLElement | null = null;
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (r.top <= lineY) chosen = row;
        // Newest-first DOM order: once a row sits below the line, every
        // subsequent (older) row is also below — bail out early.
        else break;
      }
      if (!chosen) {
        setScrolledRunningCents(null);
        setScrolledRunningCount(null);
        setScrolledDateLabel(null);
        setCompact(false);
        return;
      }
      const cents = Number(chosen.dataset.txRunning ?? "0");
      const count = Number(chosen.dataset.txRunningCount ?? "0");
      const date = chosen.dataset.txDate ?? null;
      setScrolledRunningCents(Number.isFinite(cents) ? cents : null);
      setScrolledRunningCount(Number.isFinite(count) ? count : null);
      setScrolledDateLabel(date);
      setCompact(true);
    };
    const onScroll = () => {
      if (raf == null) raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [view, data]);

  // Indicator value: while in date view and a row has crossed the line,
  // show the per-txn cumulative; otherwise show the headline month total.
  const headlineCents =
    view === "date" && scrolledRunningCents != null
      ? scrolledRunningCents
      : (data?.monthSpend ?? 0);
  const headlineCount =
    view === "date" && scrolledRunningCount != null
      ? scrolledRunningCount
      : (data?.txns.length ?? 0);
  const headlineTitle =
    view === "date" && scrolledDateLabel
      ? t("spentThrough", { date: scrolledDateLabel })
      : t("monthSpend");
  const plannedCents = data?.plannedOutflowCents ?? 0;
  const tone = progressTone(headlineCents, plannedCents);
  const overByCents =
    plannedCents > 0 && headlineCents > plannedCents
      ? headlineCents - plannedCents
      : 0;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-8 pt-8">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        <MonthScopeBar defaultAnchor={defaultAnchor} defaultScope={defaultScope} defaultMeRole={defaultMeRole} />
      </header>

      <div ref={indicatorRef} className="sticky top-2 z-20">
        <Card
          className={`border-border/40 backdrop-blur transition-[padding,background-color,border-radius] duration-200 supports-backdrop-filter:bg-card/70 ${
            compact
              ? "rounded-full bg-card/90 px-4 py-2 ring-foreground/10"
              : "bg-card/85 p-4"
          } ${
            tone === "over"
              ? "ring-1 ring-destructive/40"
              : tone === "warn"
                ? "ring-1 ring-amber-400/40"
                : ""
          }`}
        >
          {compact ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {headlineTitle}
                </p>
                <div className="num mt-0.5 flex items-baseline gap-1.5">
                  <AnimatedNumber
                    value={headlineCents / 100}
                    locale={locale}
                    currency="EUR"
                    duration={0.25}
                    className={`text-base font-semibold tracking-tight ${
                      tone === "over"
                        ? "text-destructive"
                        : tone === "warn"
                          ? "text-amber-500"
                          : ""
                    }`}
                  />
                  {plannedCents > 0 ? (
                    <span className="num text-[10px] text-muted-foreground">
                      / {formatEUR(plannedCents / 100, locale)}
                    </span>
                  ) : null}
                </div>
              </div>
              <p
                className="num shrink-0 text-[11px] text-muted-foreground"
                aria-live="polite"
              >
                <AnimatedNumber
                  value={headlineCount}
                  locale={locale}
                  duration={0.25}
                  className="font-medium"
                />{" "}
                {t("txCountShort")}
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {headlineTitle}
              </p>
              {isLoading ? (
                <Skeleton className="mt-1 h-7 w-32" />
              ) : (
                <div className="num mt-1 flex items-baseline gap-2">
                  <AnimatedNumber
                    value={headlineCents / 100}
                    locale={locale}
                    currency="EUR"
                    duration={0.25}
                    className={`text-2xl font-semibold tracking-tight ${
                      tone === "over"
                        ? "text-destructive"
                        : tone === "warn"
                          ? "text-amber-500"
                          : ""
                    }`}
                  />
                  {plannedCents > 0 ? (
                    <span className="num text-xs text-muted-foreground">
                      / {formatEUR(plannedCents / 100, locale)}
                    </span>
                  ) : null}
                </div>
              )}
              {plannedCents > 0 ? (
                <SpendProgress
                  actualCents={headlineCents}
                  plannedCents={plannedCents}
                  size="sm"
                  className="mt-2"
                />
              ) : null}
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="num text-xs text-muted-foreground">
                  <AnimatedNumber
                    value={headlineCount}
                    locale={locale}
                    duration={0.25}
                    className="font-medium"
                  />{" "}
                  {t("txCountShort")}
                </p>
                {overByCents > 0 ? (
                  <OverBudgetPill
                    overByCents={overByCents}
                    formatter={(c) => formatEUR(c / 100, locale)}
                    label={tToday("overBy")}
                  />
                ) : null}
              </div>
            </>
          )}
        </Card>
      </div>

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
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{c.name}</p>
                    <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70">
                      {forecastSourceLabel(c.source, tToday)}
                    </p>
                  </div>
                  <span className="num text-sm">
                    {formatEURPrecise(Math.abs(c.plannedCents) / 100, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {data && data.txns.length > 0 ? (
        <div className="-mt-2 flex gap-1 self-start rounded-full border border-border/60 bg-card/50 p-1 text-[11px]">
          <ViewPill href={makeViewHref(sp, "date")} active={view === "date"}>
            {t("viewByDate")}
          </ViewPill>
          <ViewPill href={makeViewHref(sp, "amount")} active={view === "amount"}>
            {t("viewByAmount")}
          </ViewPill>
        </div>
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
      ) : view === "date" ? (
        <>
          {dateGroups.map((g) => (
            <section key={g.date} className="flex flex-col gap-1">
              <p className="sticky top-24 z-10 -mx-1 bg-background/85 px-2 py-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground backdrop-blur supports-backdrop-filter:bg-background/70">
                {g.date}
              </p>
              <Card className="border-border/40 bg-card/60 p-1">
                <ul className="divide-y divide-border/40">
                  {g.rows.map((r) => {
                    const optsForScope = data.optionsAll.filter(
                      (o) => o.scope === r.owner,
                    );
                    return (
                      <li
                        key={r.id}
                        className="px-2"
                        data-tx-running={txRunning.get(r.id)?.runningCents ?? 0}
                        data-tx-running-count={
                          txRunning.get(r.id)?.runningCount ?? 0
                        }
                        data-tx-date={g.date}
                      >
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
          ))}
          <Link
            href="/transactions"
            className="text-center text-xs text-primary underline-offset-2 hover:underline"
          >
            {t("seeAllHistory")}
          </Link>
        </>
      ) : (
        <MerchantGroups
          groups={merchantGroups}
          optionsAll={data.optionsAll}
          locale={locale}
          sectionLabels={sectionLabels}
          txCountLabel={(n: number) => t("txCount", { n })}
          seeAllHref="/transactions"
          seeAllLabel={t("seeAllHistory")}
        />
      )}
    </main>
  );
}

function MerchantGroups({
  groups,
  optionsAll,
  locale,
  sectionLabels,
  txCountLabel,
  seeAllHref,
  seeAllLabel,
}: {
  groups: Array<{
    key: string;
    displayName: string;
    txns: Txn[];
    paidCents: number;
    receivedCents: number;
  }>;
  optionsAll: OptionsAll;
  locale: string;
  sectionLabels: Record<Section, string>;
  txCountLabel: (n: number) => string;
  seeAllHref: "/transactions";
  seeAllLabel: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <>
      <Card className="border-border/40 bg-card/60 p-2">
        <ul className="divide-y divide-border/40">
          {groups.map((g) => {
            // Single-transaction "groups" have nothing to expand into —
            // render the row directly so the user doesn't have to tap
            // through a wrapper that collapses one item.
            if (g.txns.length === 1) {
              const r = g.txns[0];
              const optsForScope = optionsAll.filter(
                (o) => o.scope === r.owner,
              );
              return (
                <li key={g.key} className="px-2">
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
            }
            const isOpen = expanded.has(g.key);
            return (
              <li key={g.key} className="px-2">
                <button
                  type="button"
                  onClick={() => toggle(g.key)}
                  aria-expanded={isOpen}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded px-2 py-3 text-left transition-colors hover:bg-card/40"
                >
                  <CounterpartyAvatar name={g.displayName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {g.displayName}
                    </p>
                    <p className="num text-xs text-muted-foreground">
                      {txCountLabel(g.txns.length)}
                    </p>
                  </div>
                  <div className="text-right">
                    {g.paidCents > 0 ? (
                      <p className="num whitespace-nowrap text-sm font-semibold">
                        −{formatEURPrecise(g.paidCents / 100, locale)}
                      </p>
                    ) : null}
                    {g.receivedCents > 0 ? (
                      <p className="num whitespace-nowrap text-sm font-semibold text-primary">
                        +{formatEURPrecise(g.receivedCents / 100, locale)}
                      </p>
                    ) : null}
                  </div>
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden
                  />
                </button>
                {isOpen ? (
                  <ul className="mb-2 ml-1 divide-y divide-border/40 border-l border-border/40 pl-2">
                    {g.txns.map((r) => {
                      const optsForScope = optionsAll.filter(
                        (o) => o.scope === r.owner,
                      );
                      return (
                        <li key={r.id} className="px-1">
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
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
      <Link
        href={seeAllHref}
        className="text-center text-xs text-primary underline-offset-2 hover:underline"
      >
        {seeAllLabel}
      </Link>
    </>
  );
}

function ViewPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  // Plain anchor (not next-intl Link) so we can pass a relative
  // query-string-only href cheaply. Same-page nav, scope/anchor
  // already in `sp`.
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-2.5 py-1 uppercase tracking-[0.08em] transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </a>
  );
}

function makeViewHref(sp: URLSearchParams, view: ActivityView): string {
  const next = new URLSearchParams(sp.toString());
  if (view === "date") next.delete("view");
  else next.set("view", view);
  const s = next.toString();
  return s ? `?${s}` : "?";
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


function forecastSourceLabel(
  src: "due-day" | "history-median" | "counterparty-history" | "month-end",
  t: (k: string) => string,
): string {
  if (src === "due-day") return t("forecastDue");
  if (src === "history-median") return t("forecastHistory");
  if (src === "counterparty-history") return t("forecastBankHistory");
  return t("forecastMonthEnd");
}
