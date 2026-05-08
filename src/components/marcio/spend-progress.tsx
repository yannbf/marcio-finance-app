"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils.ts";

/**
 * Shared spend-progress bar that takes the same `(actual, planned)`
 * cents pair every Today / Month card already computes and:
 *
 *  - Picks a color based on the ratio:
 *      < 75%  → primary (green)
 *      ≥ 75%  → amber (warning — bumping the limit)
 *      ≥ 100% → destructive (red — over)
 *  - Caps the rendered fill at 100%, but exposes a small "ALERT" sliver
 *    that animates in once you cross over so the bar doesn't just sit at
 *    100% silently when you've actually spent 130% of the plan.
 *
 * Variant `track` adds the muted background; variant `inline` is a thin
 * trackless bar suitable for small section cards.
 */

export type SpendProgressTone = "ok" | "warn" | "over";

export function progressTone(
  actualAbs: number,
  plannedAbs: number,
): SpendProgressTone {
  if (plannedAbs <= 0) return "ok";
  const ratio = actualAbs / plannedAbs;
  if (ratio >= 1) return "over";
  if (ratio >= 0.75) return "warn";
  return "ok";
}

const FILL_BY_TONE: Record<SpendProgressTone, string> = {
  ok: "bg-primary",
  warn: "bg-amber-400",
  over: "bg-destructive",
};

const TEXT_BY_TONE: Record<SpendProgressTone, string> = {
  ok: "text-muted-foreground",
  warn: "text-amber-500",
  over: "text-destructive",
};

export function SpendProgress({
  actualCents,
  plannedCents,
  className,
  size = "md",
  showOverlap = true,
}: {
  /** Signed amount actually spent. Sign is ignored. */
  actualCents: number;
  /** Signed amount planned. Sign is ignored. */
  plannedCents: number;
  className?: string;
  size?: "sm" | "md";
  /** When true and over budget, paint a destructive sliver past the cap. */
  showOverlap?: boolean;
}) {
  const planned = Math.abs(plannedCents);
  const actual = Math.abs(actualCents);
  if (planned <= 0) return null;
  const tone = progressTone(actual, planned);
  const ratio = actual / planned;
  const fillWidth = Math.min(100, ratio * 100).toFixed(2);
  const overWidth = showOverlap && ratio > 1
    ? Math.min(20, (ratio - 1) * 100).toFixed(2)
    : null;
  const heightCls = size === "sm" ? "h-1" : "h-1.5";
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-muted",
        heightCls,
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width,background-color] duration-500 ease-out",
          FILL_BY_TONE[tone],
        )}
        style={{ width: `${fillWidth}%` }}
      />
      {overWidth ? (
        // Render the over-budget sliver as a visually-distinct stripe so
        // the user can tell "100%" from "120%" without reading numbers.
        <div
          aria-hidden
          className="absolute right-0 top-0 h-full rounded-full bg-destructive/70 ring-1 ring-destructive/40"
          style={{ width: `${overWidth}%` }}
        />
      ) : null}
    </div>
  );
}

/** Inline-text "Over by €X" pill for cards/lists. */
export function OverBudgetPill({
  overByCents,
  formatter,
  className,
  label,
}: {
  overByCents: number;
  formatter: (cents: number) => string;
  className?: string;
  label: string;
}) {
  if (overByCents <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-destructive",
        className,
      )}
    >
      <AlertTriangle className="size-3" strokeWidth={2.5} />
      <span className="num">{label} {formatter(overByCents)}</span>
    </span>
  );
}

export { TEXT_BY_TONE };
