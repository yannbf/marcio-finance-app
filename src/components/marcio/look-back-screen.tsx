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
import { trpc } from "@/lib/trpc/client.ts";
import { useMounted } from "@/lib/use-mounted.ts";
import { isInternalTransferTx } from "@/lib/matching/seed-rules.ts";
import { SECTION_ORDER, SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app.ts";

type ActivityData = inferRouterOutputs<AppRouter>["activity"]["get"];
type Txn = ActivityData["txns"][number];

/**
 * Look Back: a full-screen "walk through the month" view inspired by
 * ING's Look Ahead. Transactions render with the OLDEST at the top
 * and the NEWEST at the bottom, the page opens scrolled all the way
 * down (so the most recent activity is in view next to the sticky
 * footer indicator), and as the user scrolls UP the footer's
 * "spent so far" total decreases — each row that crosses the footer
 * line shrinks the cumulative because we're stepping further into the
 * past. A decorative spacer above the oldest txn guarantees there's
 * enough scrollable content for the user to actually walk every
 * transaction past the footer, even on a sparse month.
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

  // Reverse the desc-ordered txns (router returns newest-first) so we
  // can render oldest-at-top, and compute each row's chronological
  // running cumulative (qualifying outflow from start-of-month through
  // and INCLUDING that txn — same filter as monthSpend). The newest
  // txn ends with running == data.monthSpend; the oldest ends with
  // just its own contribution.
  const dateGroups = useMemo(() => {
    if (!data) return [];
    const reversed = [...data.txns].reverse();
    type Row = Txn & { runningCents: number };
    let running = 0;
    const annotated: Row[] = [];
    for (const r of reversed) {
      if (r.amountCents < 0 && !isInternalTransferTx(r)) {
        running += -r.amountCents;
      }
      annotated.push({ ...r, runningCents: running });
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
    dateLabel: string | null;
  }>({ cents: data?.monthSpend ?? 0, dateLabel: null });

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
        // No row has reached the footer yet — show the running for
        // the OLDEST txn (= just its own contribution) so the footer
        // doesn't sit at zero in a weird limbo state.
        const first = rows[0];
        if (first) {
          setRunning({
            cents: Number(first.dataset.txRunning ?? "0"),
            dateLabel: first.dataset.txDate ?? null,
          });
        }
        return;
      }
      setRunning({
        cents: Number(chosen.dataset.txRunning ?? "0"),
        dateLabel: chosen.dataset.txDate ?? null,
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

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top chrome — Done button + title. Mirrors ING's "Done | Look Ahead | (i)". */}
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/40 bg-background/85 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/70">
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

      {isLoading || !data ? (
        <div className="flex flex-1 flex-col gap-3 p-5">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : data.txns.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-sm text-muted-foreground">{tActivity("empty")}</p>
        </div>
      ) : (
        <>
          {/* Decorative top-of-page spacer. Fills any leftover vertical
              room so the user always has enough to scroll, no matter
              how few txns there are this month. */}
          <div className="grid flex-1 place-items-center px-6 py-10 text-muted-foreground/60">
            <div className="flex flex-col items-center gap-3 text-center">
              <Sparkles
                className="size-10 text-muted-foreground/40"
                strokeWidth={1.4}
              />
              <p className="text-sm">{t("topOfMonth")}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 px-5 pb-32">
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
          </div>
        </>
      )}

      {/* Sticky footer — the running indicator that ticks as each
          transaction crosses its top edge. */}
      <div
        ref={footerRef}
        className="sticky bottom-0 z-20 border-t border-border/40 bg-background/90 px-5 py-4 backdrop-blur supports-backdrop-filter:bg-background/75"
      >
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.14em] text-primary">
              {running.dateLabel
                ? t("spentThrough", { date: running.dateLabel })
                : t("spentSoFar")}
            </p>
          </div>
          <AnimatedNumber
            value={running.cents / 100}
            locale={locale}
            currency="EUR"
            duration={0.25}
            className="text-lg font-semibold tracking-tight"
          />
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
