"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card.tsx";
import { formatEUR } from "@/lib/format.ts";
import { OUTFLOW_SECTIONS, SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";

type DailyRow = { day: string; absCents: number };

type ChartsProps = {
  locale: string;
  totalOutCents: number;
  dailySpend: DailyRow[];
  actualBySection: Partial<Record<Section, number>>;
  previousActualBySection?: Partial<Record<Section, number>>;
  rangeStartsOn: string;
  rangeEndsOn: string;
};

type Tab = "daily" | "donut" | "bars";

/**
 * Tabbed visualizations for /insights: trend (daily), share (donut),
 * and detail (bars). One card, three views over the same payday-month
 * outflow data.
 */
export function InsightsCharts({
  locale,
  totalOutCents,
  dailySpend,
  actualBySection,
  previousActualBySection,
  rangeStartsOn,
  rangeEndsOn,
}: ChartsProps) {
  const t = useTranslations("Insights.charts");
  const [tab, setTab] = useState<Tab>("daily");

  const days = useMemo(
    () => zeroFillDays(dailySpend, rangeStartsOn, rangeEndsOn),
    [dailySpend, rangeStartsOn, rangeEndsOn],
  );
  const slices = useMemo(
    () => buildSlices(actualBySection),
    [actualBySection],
  );

  return (
    <Card className="border-border/40 bg-card/60 p-5">
      <header>
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("hint")}</p>
      </header>

      <TabBar tab={tab} onChange={setTab} />

      <div className="mt-4 min-h-[260px]">
        <AnimatePresence mode="wait" initial={false}>
          {tab === "daily" ? (
            <motion.div
              key="daily"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <DailySpendChart days={days} locale={locale} />
            </motion.div>
          ) : null}
          {tab === "donut" ? (
            <motion.div
              key="donut"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <SectionDonut
                slices={slices}
                totalOutCents={totalOutCents}
                locale={locale}
              />
            </motion.div>
          ) : null}
          {tab === "bars" ? (
            <motion.div
              key="bars"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <SectionBars
                actualBySection={actualBySection}
                previousActualBySection={previousActualBySection}
                totalOutCents={totalOutCents}
                locale={locale}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab bar                                                                    */
/* -------------------------------------------------------------------------- */

function TabBar({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
}) {
  const t = useTranslations("Insights.charts");
  const items: { id: Tab; label: string }[] = [
    { id: "daily", label: t("tabDaily") },
    { id: "donut", label: t("tabDonut") },
    { id: "bars", label: t("tabBars") },
  ];
  return (
    <div
      role="tablist"
      className="mt-4 inline-flex rounded-full bg-muted/60 p-0.5 text-xs"
    >
      {items.map((item) => {
        const active = item.id === tab;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className="relative px-3 py-1.5 font-medium transition-colors"
          >
            {active ? (
              <motion.span
                layoutId="chartsTabPill"
                className="absolute inset-0 rounded-full bg-card shadow-sm ring-1 ring-foreground/10"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            ) : null}
            <span
              className={`relative ${active ? "text-foreground" : "text-muted-foreground"}`}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Daily spend — smooth area chart over the active payday-month               */
/* -------------------------------------------------------------------------- */

function DailySpendChart({
  days,
  locale,
}: {
  days: DailyRow[];
  locale: string;
}) {
  const t = useTranslations("Insights.charts");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 320;
  const H = 140;
  const padX = 4;
  const padTop = 8;
  const padBottom = 18;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;

  const max = Math.max(1, ...days.map((d) => d.absCents));
  const stepX = days.length > 1 ? innerW / (days.length - 1) : innerW;

  const points = days.map((d, i) => {
    const x = padX + i * stepX;
    const y = padTop + innerH - (d.absCents / max) * innerH;
    return [x, y] as const;
  });

  const linePath = useMemo(() => smoothPath(points), [points]);
  const areaPath = useMemo(() => {
    const last = points[points.length - 1];
    const first = points[0];
    if (!last || !first) return "";
    return `${smoothPath(points)} L ${last[0]},${padTop + innerH} L ${first[0]},${padTop + innerH} Z`;
  }, [points, innerH]);

  const active = hoverIdx != null ? days[hoverIdx] : null;
  const activePt = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {t("daily")}
        </p>
        {active ? (
          <p className="num text-xs text-muted-foreground">
            {formatShortDay(active.day, locale)} ·{" "}
            <span className="font-medium text-foreground">
              {formatEUR(active.absCents / 100, locale)}
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{t("dailyHint")}</p>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 h-[180px] w-full overflow-visible"
        role="img"
        aria-label="Daily spend"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="dailyArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((p) => (
          <line
            key={p}
            x1={padX}
            x2={W - padX}
            y1={padTop + innerH * p}
            y2={padTop + innerH * p}
            className="stroke-muted-foreground/15"
            strokeDasharray="2 4"
            strokeWidth={0.6}
          />
        ))}

        <motion.path
          d={areaPath}
          className="fill-primary text-primary"
          fill="url(#dailyArea)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        />
        <motion.path
          d={linePath}
          className="stroke-primary"
          fill="none"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />

        {points.map(([x], i) => (
          <rect
            key={i}
            x={x - stepX / 2}
            y={0}
            width={stepX}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}

        {activePt ? (
          <>
            <line
              x1={activePt[0]}
              x2={activePt[0]}
              y1={padTop}
              y2={padTop + innerH}
              className="stroke-primary/40"
              strokeWidth={1}
            />
            <circle
              cx={activePt[0]}
              cy={activePt[1]}
              r={3.6}
              className="fill-primary stroke-card"
              strokeWidth={1.4}
            />
          </>
        ) : null}

        {days.length > 0 ? (
          <>
            <text
              x={padX}
              y={H - 3}
              className="fill-muted-foreground"
              fontSize={9}
              textAnchor="start"
            >
              {formatShortDay(days[0].day, locale)}
            </text>
            <text
              x={W / 2}
              y={H - 3}
              className="fill-muted-foreground"
              fontSize={9}
              textAnchor="middle"
            >
              {formatShortDay(days[Math.floor(days.length / 2)].day, locale)}
            </text>
            <text
              x={W - padX}
              y={H - 3}
              className="fill-muted-foreground"
              fontSize={9}
              textAnchor="end"
            >
              {formatShortDay(days[days.length - 1].day, locale)}
            </text>
          </>
        ) : null}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section donut                                                              */
/* -------------------------------------------------------------------------- */

type Slice = {
  section: Section;
  absCents: number;
  fraction: number;
  startAngle: number;
  endAngle: number;
};

const SECTION_COLOR: Record<Section, string> = {
  FIXAS: "var(--chart-1)",
  VARIAVEIS: "var(--chart-2)",
  SAZONAIS: "var(--chart-3)",
  DIVIDAS: "var(--chart-4)",
  ECONOMIAS: "var(--chart-5)",
  ENTRADAS: "var(--chart-1)",
};

function SectionDonut({
  slices,
  totalOutCents,
  locale,
}: {
  slices: Slice[];
  totalOutCents: number;
  locale: string;
}) {
  const t = useTranslations("Insights.charts");
  const tSections = useTranslations("Sections");
  const [hover, setHover] = useState<Section | null>(null);
  const size = 160;
  const R = 70;
  const r = 50;
  const cx = size / 2;
  const cy = size / 2;

  const active = hover ? slices.find((s) => s.section === hover) : null;
  const centerValue = active ? active.absCents : totalOutCents;
  const centerLabel = active
    ? tSections(SECTION_TR_KEY[active.section] as never)
    : t("totalLabel");

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="size-[160px]"
          role="img"
          aria-label="Spend by section"
        >
          {slices.map((s, i) => (
            <motion.path
              key={s.section}
              d={donutSlice(cx, cy, R, r, s.startAngle, s.endAngle)}
              fill={SECTION_COLOR[s.section]}
              stroke="var(--card)"
              strokeWidth={1.2}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, delay: i * 0.04 }}
              onMouseEnter={() => setHover(s.section)}
              onMouseLeave={() => setHover(null)}
              style={{
                transformOrigin: `${cx}px ${cy}px`,
                cursor: "default",
              }}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="num text-lg font-semibold tracking-tight">
            {formatEUR(centerValue / 100, locale)}
          </p>
          <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            {centerLabel}
          </p>
        </div>
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-2 text-xs">
        {slices.map((s) => (
          <li
            key={s.section}
            className="flex items-center gap-2"
            onMouseEnter={() => setHover(s.section)}
            onMouseLeave={() => setHover(null)}
          >
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: SECTION_COLOR[s.section] }}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {tSections(SECTION_TR_KEY[s.section] as never)}
            </span>
            <span className="num shrink-0 text-foreground">
              {(s.fraction * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section bars — detail view with month-over-month delta chip                */
/* -------------------------------------------------------------------------- */

function SectionBars({
  actualBySection,
  previousActualBySection,
  totalOutCents,
  locale,
}: {
  actualBySection: Partial<Record<Section, number>>;
  previousActualBySection?: Partial<Record<Section, number>>;
  totalOutCents: number;
  locale: string;
}) {
  const t = useTranslations("Insights");
  const tSections = useTranslations("Sections");
  return (
    <ul className="flex flex-col gap-3">
      {OUTFLOW_SECTIONS.map((s) => {
        const cents = Math.abs(actualBySection[s] ?? 0);
        const prevCents = Math.abs(previousActualBySection?.[s] ?? 0);
        const pct = totalOutCents > 0 ? (cents / totalOutCents) * 100 : 0;
        return (
          <li key={s} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="flex items-baseline gap-1.5">
                {tSections(SECTION_TR_KEY[s] as never)}
                <DeltaChip current={cents} previous={prevCents} t={t} compact />
              </span>
              <span className="num text-muted-foreground">
                {formatEUR(cents / 100, locale)} · {pct.toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: SECTION_COLOR[s] }}
                initial={{ width: 0 }}
                animate={{ width: `${pct.toFixed(2)}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Delta chip — duplicated from insights-screen since the bars view owns it   */
/* -------------------------------------------------------------------------- */

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
  const tone =
    pct > 0
      ? "text-destructive bg-destructive/10"
      : "text-primary bg-primary/10";
  const sign = pct > 0 ? "+" : "−";
  return (
    <span
      className={`num inline-flex items-center rounded px-1.5 ${
        compact ? "text-[9px]" : "text-[10px]"
      } font-medium ${tone}`}
      title={t("vsLastMonth")}
    >
      {sign}
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function buildSlices(actual: Partial<Record<Section, number>>): Slice[] {
  const rows = OUTFLOW_SECTIONS.map((section) => ({
    section,
    absCents: Math.abs(actual[section] ?? 0),
  })).filter((r) => r.absCents > 0);
  const total = rows.reduce((s, r) => s + r.absCents, 0);
  if (total === 0) return [];
  let acc = 0;
  return rows.map((r) => {
    const fraction = r.absCents / total;
    const startAngle = acc * 2 * Math.PI - Math.PI / 2;
    acc += fraction;
    const endAngle = acc * 2 * Math.PI - Math.PI / 2;
    return { ...r, fraction, startAngle, endAngle };
  });
}

function donutSlice(
  cx: number,
  cy: number,
  R: number,
  r: number,
  start: number,
  end: number,
): string {
  const fullCircle = Math.abs(end - start) >= 2 * Math.PI - 0.0001;
  if (fullCircle) {
    return [
      `M ${cx + R} ${cy}`,
      `A ${R} ${R} 0 1 1 ${cx - R} ${cy}`,
      `A ${R} ${R} 0 1 1 ${cx + R} ${cy}`,
      `M ${cx + r} ${cy}`,
      `A ${r} ${r} 0 1 0 ${cx - r} ${cy}`,
      `A ${r} ${r} 0 1 0 ${cx + r} ${cy}`,
      "Z",
    ].join(" ");
  }
  const largeArc = end - start > Math.PI ? 1 : 0;
  const x1 = cx + R * Math.cos(start);
  const y1 = cy + R * Math.sin(start);
  const x2 = cx + R * Math.cos(end);
  const y2 = cy + R * Math.sin(end);
  const xi2 = cx + r * Math.cos(end);
  const yi2 = cy + r * Math.sin(end);
  const xi1 = cx + r * Math.cos(start);
  const yi1 = cy + r * Math.sin(start);
  return [
    `M ${x1} ${y1}`,
    `A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${xi2} ${yi2}`,
    `A ${r} ${r} 0 ${largeArc} 0 ${xi1} ${yi1}`,
    "Z",
  ].join(" ");
}

function smoothPath(points: readonly (readonly [number, number])[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  const parts: string[] = [`M ${points[0][0]} ${points[0][1]}`];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const mx = (x0 + x1) / 2;
    parts.push(`C ${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`);
  }
  return parts.join(" ");
}

function zeroFillDays(
  rows: DailyRow[],
  startsOn: string,
  endsOn: string,
): DailyRow[] {
  const map = new Map(rows.map((r) => [r.day, r.absCents]));
  const start = new Date(startsOn);
  const end = new Date(endsOn);
  const out: DailyRow[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.toISOString().slice(0, 10);
    out.push({ day, absCents: map.get(day) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function formatShortDay(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}
