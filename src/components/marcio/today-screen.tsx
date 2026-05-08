"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Calendar, Inbox, Sparkles, ChevronRight, PieChart } from "lucide-react";
import { AnimatedNumber } from "./animated-number.tsx";
import { MonthScopeBar, parseSearch } from "./month-scope-bar.tsx";
import { formatEUR, formatEURPrecise, formatPercent } from "@/lib/format.ts";
import { trpc } from "@/lib/trpc/client.ts";
import { useMounted } from "@/lib/use-mounted.ts";
import { SectionDrillSheet } from "./section-drill-sheet.tsx";
import {
  OverBudgetPill,
  SpendProgress,
  progressTone,
} from "./spend-progress.tsx";
import { Link } from "@/i18n/navigation.ts";
import type { Section } from "@/lib/import/types.ts";

type ScopeView = "joint" | "yann" | "camila";

export function TodayScreen({
  locale,
  defaultAnchor,
  defaultScope = "joint",
  defaultMeRole = null,
  defaultDaysUntilPayday,
}: {
  locale: string;
  defaultAnchor: { year: number; month: number };
  defaultScope?: "joint" | "yann" | "camila";
  defaultMeRole?: "yann" | "camila" | null;
  /** Server-computed days-until-payday so the badge renders identically
   *  on SSR and first client paint regardless of whether the persister
   *  has restored cached data yet. */
  defaultDaysUntilPayday: number;
}) {
  const t = useTranslations();
  const sp = useSearchParams();
  const { anchor, scope } = parseSearch(sp, defaultAnchor, defaultScope);
  // The persister attaches in a useEffect, so SSR returns
  // `data: undefined`; on the client React's hydration may run AFTER
  // the persister's microtask resolves (concurrent rendering can
  // reorder), which produces "skeleton on server, real value on
  // client" mismatches. The mount gate forces the first client render
  // to also paint a skeleton, then the next render shows real data.
  // Costs ~1 frame per nav; cheaper than a hydration error.
  const mounted = useMounted();
  const utils = trpc.useUtils();
  const query = trpc.today.get.useQuery({ anchor, scope });
  const data = mounted ? query.data : undefined;

  // Boot-time warm-up: as soon as Today's own query has settled, kick
  // off prefetches for every other tab — and crucially for BOTH
  // scopes (the user's current view + the opposite one). Without that
  // second pass, toggling Joint↔Me always paid a cold-function tax
  // because the opposite scope's cache was empty.
  //
  // Three staggered passes:
  //   - Bottom-nav routes for the active scope (after first paint).
  //   - Off-nav routes (tikkie/insights/transactions) for the active
  //     scope on browser idle.
  //   - All bottom-nav routes for the OPPOSITE scope on a longer
  //     idle so they don't stampede the user's primary fetches.
  //
  // Each `prefetch` is a no-op if cache is fresh, so re-mounts (scope
  // toggle, anchor change) don't double-fetch.
  useEffect(() => {
    if (!mounted || !query.data) return;
    let cancelled = false;

    // The "opposite" scope is the user's role when current view is
    // joint, and joint when current view is the user's role. We don't
    // try to prefetch a third scope (the OTHER partner's personal),
    // since the user can't see it anyway.
    const oppositeScope: ScopeView | null =
      scope === "joint"
        ? defaultMeRole
        : "joint";

    const warmNav = (s: ScopeView) => () => {
      if (cancelled) return;
      void utils.month.get.prefetch({ anchor, scope: s });
      void utils.activity.get.prefetch({ anchor, scope: s });
      void utils.buckets.get.prefetch({ anchor, scope: s });
      void utils.inbox.list.prefetch();
    };
    const warmOffNav = (s: ScopeView) => () => {
      if (cancelled) return;
      void utils.tikkie.get.prefetch({ anchor, scope: s });
      void utils.insights.get.prefetch({ anchor, scope: s });
      void utils.transactions.list.prefetch({ scope: s });
    };

    // Active scope first.
    const t1 = setTimeout(warmNav(scope), 80);
    type IdleAPI = (cb: () => void, opts?: { timeout: number }) => number;
    const ric = (window as unknown as { requestIdleCallback?: IdleAPI })
      .requestIdleCallback;
    const off1 = ric
      ? ric(warmOffNav(scope), { timeout: 4000 })
      : setTimeout(warmOffNav(scope), 1500);

    // Opposite scope, deferred further so the active view paints
    // first. Without prefetched opposite scope, the toggle still
    // shows skeletons the first time per session.
    let t2: ReturnType<typeof setTimeout> | undefined;
    let off2: number | ReturnType<typeof setTimeout> | undefined;
    if (oppositeScope) {
      t2 = setTimeout(warmNav(oppositeScope), 600);
      off2 = ric
        ? ric(warmOffNav(oppositeScope), { timeout: 8000 })
        : setTimeout(warmOffNav(oppositeScope), 3000);
    }

    return () => {
      cancelled = true;
      clearTimeout(t1);
      if (t2) clearTimeout(t2);
      const cic = (
        window as unknown as { cancelIdleCallback?: (h: number) => void }
      ).cancelIdleCallback;
      if (typeof cic === "function") {
        cic(off1 as number);
        if (off2) cic(off2 as number);
      } else {
        clearTimeout(off1 as ReturnType<typeof setTimeout>);
        if (off2) clearTimeout(off2 as ReturnType<typeof setTimeout>);
      }
    };
  }, [mounted, query.data, anchor, scope, defaultMeRole, utils]);

  const daysUntilPayday = data?.daysUntilPayday ?? defaultDaysUntilPayday;
  const plannedOutflowCents = data?.plannedOutflowCents ?? 0;
  const spentOutflowCents = data?.spentOutflowCents ?? 0;
  const marginCents = data?.marginCents ?? 0;
  const progress = data?.progress ?? 0;
  const remainingCents = data?.remainingCents ?? 0;
  const forecast = data?.forecast ?? { charges: [], totalRemainingCents: 0 };
  const sectionData = data?.sectionData ?? [];
  const inboxCount = data?.inboxCount ?? 0;
  const recentlyAddedCount = data?.recentlyAddedCount ?? 0;
  const sectionByKey = new Map(sectionData.map((s) => [s.section, s]));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pb-32 pt-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <CachePurgeHandle>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {t("Brand.name")}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {t("Today.spentSoFar")}
            </h1>
          </CachePurgeHandle>
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <Calendar className="size-3" />
            {t("Today.untilPayday", { days: daysUntilPayday })}
          </Badge>
        </div>
        <MonthScopeBar defaultAnchor={defaultAnchor} defaultScope={defaultScope} defaultMeRole={defaultMeRole} />
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
            <Skeleton
              as="span"
              className="inline-block h-3 w-32 align-middle"
            />
          )}
        </p>

        <div className="mt-6">
          <SpendProgress
            actualCents={spentOutflowCents}
            plannedCents={plannedOutflowCents}
          />
        </div>
        <div className="num mt-3 flex items-center justify-between text-xs">
          {data ? (
            <>
              <span
                className={(() => {
                  const tone = progressTone(
                    spentOutflowCents,
                    plannedOutflowCents,
                  );
                  if (tone === "over") return "font-medium text-destructive";
                  if (tone === "warn") return "font-medium text-amber-500";
                  return "text-muted-foreground";
                })()}
              >
                {formatPercent(progress, locale)}
              </span>
              {spentOutflowCents > plannedOutflowCents && plannedOutflowCents > 0 ? (
                <OverBudgetPill
                  overByCents={spentOutflowCents - plannedOutflowCents}
                  formatter={(c) => formatEUR(c / 100, locale)}
                  label={t("Today.overBy")}
                />
              ) : (
                <span className="text-muted-foreground">
                  {t("Today.remaining")}: {formatEUR(remainingCents / 100, locale)}
                </span>
              )}
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
                    {formatEURPrecise(Math.abs(c.plannedCents) / 100, locale)}
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
              <div className="flex items-baseline gap-1.5">
                <p className="text-sm font-medium">{t("Today.inboxTitle")}</p>
                {recentlyAddedCount > 0 ? (
                  <span className="num inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {t("Inbox.newSinceLastSync", {
                      n: recentlyAddedCount,
                    })}
                  </span>
                ) : null}
              </div>
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

      <DeploymentFooter
        locale={locale}
        deployedAtRaw={process.env.BUILD_COMMIT_TIME}
      />
    </main>
  );
}

/**
 * Wraps the Today header brand+heading and turns it into a long-press
 * "nuke the cache" handle. On a 700 ms hold, drop every TanStack
 * Query entry, wipe the persister's sessionStorage key, and refetch
 * everything from scratch. Useful when the cron just landed new sheet
 * data and the user wants to skip the staleTime wait.
 *
 * Visual feedback during the hold so the gesture is discoverable: a
 * subtle ring + scale that grows over the duration, plus a brief
 * "Refreshed" badge after the purge fires.
 */
const PURGE_HOLD_MS = 700;
const PERSISTER_KEY = "marcio-query-cache-v3";

function CachePurgeHandle({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [holding, setHolding] = useState(false);
  const [flash, setFlash] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function start() {
    setHolding(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        window.sessionStorage.removeItem(PERSISTER_KEY);
      } catch {
        // sessionStorage may be disabled; the QueryClient.clear() below
        // is enough on its own.
      }
      queryClient.clear();
      void queryClient.invalidateQueries();
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
      // Light haptic if the browser supports it — confirms the
      // gesture without needing visual focus.
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          (navigator as Navigator).vibrate?.(30);
        } catch {
          // Vibration may be permission-gated; not critical.
        }
      }
    }, PURGE_HOLD_MS);
  }
  function cancel() {
    setHolding(false);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className={
        "-m-2 select-none rounded-lg p-2 transition-[transform,background-color,box-shadow] duration-200 " +
        (flash
          ? "scale-[1.01] bg-primary/10 ring-1 ring-primary/40"
          : holding
            ? "scale-[0.99] bg-card/60 ring-1 ring-primary/20"
            : "")
      }
      style={{ touchAction: "manipulation" }}
      aria-label="Long-press to refresh data"
    >
      {children}
    </div>
  );
}

/**
 * Tiny footer line: when the last sheet/bank sync ran and when this
 * build was cut. Both pinned to Europe/Amsterdam so the household
 * sees the same wall-clock time even if their phone is roaming.
 */
function DeploymentFooter({
  locale,
  deployedAtRaw,
}: {
  locale: string;
  deployedAtRaw: string | undefined;
}) {
  const t = useTranslations();
  // Same persister-vs-SSR hydration gate the screen-level queries
  // use: hold persister-restored data back until after first paint
  // so React doesn't see "no sync line on server, sync line on
  // client" and tear the tree down.
  const mounted = useMounted();
  const lastImport = trpc.settings.lastImportAt.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const deployedAt = formatAmsterdam(deployedAtRaw, locale);
  const syncedAtIso = mounted ? lastImport.data?.at ?? null : null;
  const syncedAt = formatAmsterdam(syncedAtIso, locale);
  if (!deployedAt && !syncedAt) return null;
  return (
    <div className="flex flex-col items-center gap-0.5 pt-2">
      {syncedAt ? (
        <p className="num text-center text-[11px] text-muted-foreground/70">
          {t("Today.lastSync", { at: syncedAt })}
        </p>
      ) : null}
      {deployedAt ? (
        <p className="num text-center text-[11px] text-muted-foreground/60">
          {t("Today.deployedAt", { at: deployedAt })}
        </p>
      ) : null}
    </div>
  );
}

function formatAmsterdam(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Amsterdam",
  }).format(d);
}

/* -------------------------------------------------------------------------- */

function forecastSourceLabel(
  src: "due-day" | "history-median" | "counterparty-history" | "month-end",
  t: (k: string) => string,
): string {
  if (src === "due-day") return t("Today.forecastDue");
  if (src === "history-median") return t("Today.forecastHistory");
  if (src === "counterparty-history") return t("Today.forecastBankHistory");
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
