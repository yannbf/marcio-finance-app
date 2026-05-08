"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Link } from "@/i18n/navigation.ts";
import { ActivityRow } from "./activity-row.tsx";
import { AnimatedNumber } from "./animated-number.tsx";
import { parseSearch } from "./month-scope-bar.tsx";
import { SpendProgress, progressTone } from "./spend-progress.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { useMounted } from "@/lib/use-mounted.ts";
import { formatEUR } from "@/lib/format.ts";
import {
  isInternalTransferTx,
  isSavingsTransferTx,
} from "@/lib/matching/seed-rules.ts";
import { SECTION_ORDER, SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app.ts";

type ActivityData = inferRouterOutputs<AppRouter>["activity"]["get"];
type Txn = ActivityData["txns"][number];

/**
 * Look Back: a full-screen "walk through the month" view inspired by
 * ING's Look Ahead. Transactions render with the NEWEST at the top
 * and the OLDEST at the bottom (router order — desc by booking date),
 * and the page opens scrolled all the way DOWN so the very first
 * thing the user sees is the start-of-month activity sitting next to
 * the sticky footer indicator. As the user scrolls UP the bottommost
 * txn at the footer line gets chronologically NEWER, the footer's
 * "Spent through {date}" cumulative grows accordingly, and the
 * tall decorative spacer at the top of the doc — labelled with the
 * "today" end of the timeline — guarantees there's always enough
 * scrollable content for every transaction to cross the indicator,
 * even on a sparse month.
 */
export function LookBackScreen({
  locale,
  defaultAnchor,
  defaultScope = "joint",
}: {
  locale: string;
  defaultAnchor: { year: number; month: number };
  defaultScope?: "joint" | "yann" | "camila";
  defaultMeRole?: "yann" | "camila" | null;
}) {
  const t = useTranslations("LookBack");
  const tToday = useTranslations("Today");
  const tSections = useTranslations("Sections");
  const tActivity = useTranslations("Activity");
  const sp = useSearchParams();
  const { anchor, scope } = parseSearch(sp, defaultAnchor, defaultScope);
  const mounted = useMounted();
  const query = trpc.activity.get.useQuery({ anchor, scope });
  const data = mounted ? query.data : undefined;
  const isLoading = mounted ? query.isLoading : true;

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

  // Render the txns newest-at-top, oldest-at-bottom (router already
  // returns desc(bookingDate)). Each row carries a chronological
  // cumulative spend INCLUDING itself (same filter as monthSpend) —
  // so the newest txn's running == data.monthSpend and the oldest
  // txn's running == just its own contribution. Walk newest-first
  // and subtract each row's contribution AFTER assigning its running,
  // which gives "running through this point in time".
  const dateGroups = useMemo(() => {
    if (!data) return [];
    type Row = Txn & { runningCents: number };
    let running = data.monthSpend;
    const annotated: Row[] = [];
    for (const r of data.txns) {
      annotated.push({ ...r, runningCents: running });
      if (
        r.amountCents < 0 &&
        !isInternalTransferTx(r) &&
        !isSavingsTransferTx(r)
      ) {
        running -= -r.amountCents;
      }
    }
    const groups: { date: string; rows: Row[] }[] = [];
    for (const r of annotated) {
      const key = formatGroupDate(new Date(r.bookingDate), locale);
      const last = groups[groups.length - 1];
      if (last && last.date === key) last.rows.push(r);
      else groups.push({ date: key, rows: [r] });
    }
    return groups;
  }, [data, locale]);

  // Sticky footer indicator: tracks the bottommost transaction whose
  // top is still above the footer line. As the user scrolls toward the
  // top of the page (older content) the chosen row gets older and the
  // running cumulative shrinks accordingly.
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [running, setRunning] = useState<{
    cents: number;
    // ISO booking date of the row currently at the footer line. We
    // store ISO (not the friendly "Today / Yesterday" label) so the
    // footer's "From X until Y" range can format both ends with the
    // same short month + day style regardless of how recent the row is.
    dateIso: string | null;
  }>({ cents: data?.monthSpend ?? 0, dateIso: null });

  // On first render with txns, jump straight to the bottom of the
  // page so the most recent activity is the first thing the user
  // sees. Use useLayoutEffect to avoid a visible jump from top.
  const didInitialScroll = useRef(false);
  useLayoutEffect(() => {
    if (didInitialScroll.current) return;
    if (!data || data.txns.length === 0) return;
    // Run on the next frame so the just-rendered txn list contributes
    // to scrollHeight before we measure it.
    const id = requestAnimationFrame(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      didInitialScroll.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [data]);

  useEffect(() => {
    if (!data || data.txns.length === 0) return;
    let raf: number | null = null;
    const tick = () => {
      raf = null;
      const footerEl = footerRef.current;
      if (!footerEl) return;
      // The "line" that drives the indicator is just above the footer
      // chrome — leave a few px of breathing room so a row whose
      // bottom edge brushes the footer's top still counts as "passed".
      const lineY = footerEl.getBoundingClientRect().top - 8;
      const rows = document.querySelectorAll<HTMLElement>("[data-tx-running]");
      let chosen: HTMLElement | null = null;
      // Oldest-first DOM order: walk forward, the LAST row whose top
      // sits above the line is the bottommost-visible-above-footer.
      // Once a row's top crosses below the line, every newer row is
      // also below — bail out.
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (r.top <= lineY) chosen = row;
        else break;
      }
      if (!chosen) {
        // The user has scrolled past every transaction (into the
        // "today" spacer at the very top of the doc). With newest-
        // first DOM order, rows[0] is the newest txn, whose running
        // == data.monthSpend — i.e. "spent through today, all of it".
        const first = rows[0];
        if (first) {
          setRunning({
            cents: Number(first.dataset.txRunning ?? "0"),
            dateIso: first.dataset.txDateIso ?? null,
          });
        }
        return;
      }
      setRunning({
        cents: Number(chosen.dataset.txRunning ?? "0"),
        dateIso: chosen.dataset.txDateIso ?? null,
      });
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
  }, [data]);

  // Footer tone tracks the running cumulative against the planned
  // outflow goal. As the user scrolls upward the cumulative grows; if
  // it climbs past planned the bar/text turns destructive and the
  // over-by amount surfaces inline.
  const plannedCents = data?.plannedOutflowCents ?? 0;
  const footerTone = progressTone(running.cents, plannedCents);
  const overByCents =
    plannedCents > 0 && running.cents > plannedCents
      ? running.cents - plannedCents
      : 0;

  // Heights of the fixed chrome — used to pad the scroll content so
  // it doesn't slide underneath the header/footer. Approximate but
  // they're the only sizes the layout cares about, and keeping them
  // here next to the markup makes the relationship obvious. The
  // chrome itself sits in fixed position so it's pinned from the
  // very first paint, not after the user has scrolled enough for
  // sticky thresholds to kick in.
  const HEADER_PX = 52;
  const FOOTER_PX = 112;

  return (
    <div className="min-h-dvh">
      {/* Top chrome — Done button + title. Mirrors ING's "Done | Look Ahead | (i)". */}
      <header
        className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-border/40 bg-background/85 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/70"
        style={{ height: HEADER_PX }}
      >
        <Link
          href="/activity"
          className="-m-1 inline-flex items-center gap-1 rounded p-1 text-sm font-medium text-foreground/80 hover:text-foreground"
        >
          <ChevronLeft className="size-4" strokeWidth={2.4} />
          {t("done")}
        </Link>
        <p className="flex-1 text-center text-sm font-semibold tracking-tight">
          {t("title")}
        </p>
        {/* Spacer keeps the title visually centred. */}
        <span className="w-12" aria-hidden />
      </header>

      {/* Scroll content — clears both fixed bars via padding. */}
      <div
        className="flex flex-col"
        style={{ paddingTop: HEADER_PX, paddingBottom: FOOTER_PX }}
      >
        {isLoading || !data ? (
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : data.txns.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <p className="text-sm text-muted-foreground">
              {tActivity("empty")}
            </p>
          </div>
        ) : (
          <>
            {/* Decorative top-of-doc spacer. Sits ABOVE the newest txn
                and represents the "now / today" end of the timeline:
                with the list ordered newest-at-top and oldest-at-bottom,
                the user reaches this spacer after scrolling all the way
                UP through the month. The min-h gives plenty of scroll
                travel even on a sparse month so every transaction can
                cross the footer indicator. */}
            <div className="grid min-h-[100dvh] place-items-center px-6 py-10 text-muted-foreground/60">
              <div className="flex flex-col items-center gap-3 text-center">
                <Sparkles
                  className="size-12 text-muted-foreground/40"
                  strokeWidth={1.4}
                />
                <p className="text-sm">{t("upToToday")}</p>
              </div>
            </div>

            <div className="flex flex-col gap-2 px-5">
              {dateGroups.map((g) => (
                <section key={g.date} className="flex flex-col gap-1">
                  <p className="px-2 py-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
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
                            data-tx-running={r.runningCents}
                            data-tx-date-iso={r.bookingDate}
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
            </div>
          </>
        )}
      </div>

      {/* Fixed footer — the running indicator that ticks as each
          transaction crosses its top edge. The progress bar fills as
          the cumulative grows past the planned outflow goal, sharing
          the same tone treatment Today and the Activity headline use.
          Pinned with position: fixed so it's at the bottom from the
          very first paint, no sticky-threshold quirk. */}
      <div
        ref={footerRef}
        className={`fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 px-5 py-4 backdrop-blur supports-backdrop-filter:bg-background/75 ${
          footerTone === "over"
            ? "border-destructive/40"
            : footerTone === "warn"
              ? "border-amber-400/40"
              : "border-border/40"
        }`}
      >
        <div className="mx-auto flex max-w-md flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-primary">
              {data && running.dateIso
                ? t("dateRange", {
                    from: formatShortDate(data.rangeStartsOn, locale),
                    until: formatShortDate(running.dateIso, locale),
                  })
                : t("spentSoFar")}
            </p>
            <AnimatedNumber
              value={running.cents / 100}
              locale={locale}
              currency="EUR"
              duration={0.25}
              className={`text-lg font-semibold tracking-tight ${
                footerTone === "over"
                  ? "text-destructive"
                  : footerTone === "warn"
                    ? "text-amber-500"
                    : ""
              }`}
            />
          </div>
          <SpendProgress
            actualCents={running.cents}
            plannedCents={plannedCents}
            size="sm"
          />
          <div className="num flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {tToday("ofPlanned", {
                planned: formatEUR(plannedCents / 100, locale),
              })}
            </span>
            {overByCents > 0 ? (
              <span className="font-medium uppercase tracking-[0.08em] text-destructive">
                +{formatEUR(overByCents / 100, locale)}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
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

/**
 * "May 14" — short month + day, no weekday or "Today / Yesterday"
 * shortcuts. Used inside the footer "From X until Y" range so both
 * ends format the same way regardless of how recent the row is.
 */
function formatShortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}
