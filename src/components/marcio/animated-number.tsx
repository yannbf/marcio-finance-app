"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { animate, useMotionValue, useTransform, motion } from "motion/react";

type Props = {
  value: number;
  /** Intl options. */
  locale: string;
  currency?: string;
  fractionDigits?: number;
  className?: string;
  /** Animation duration in seconds. */
  duration?: number;
  /** Stable cache key — when given, animation is skipped on remount if the
   * cached value matches `value`. Use a key per number on the page (e.g.
   * "today-spent"). Cached in sessionStorage so cross-route navigation in the
   * same tab doesn't re-animate every time. */
  cacheKey?: string;
};

const CACHE_PREFIX = "marcio-num:";

/**
 * Tabular-num animated counter that only animates when the value actually
 * changes from what it last rendered for the same `cacheKey`. Cross-route
 * navigation (which remounts the component) reads the cached value and
 * starts already at the right number — no re-animation noise.
 */
export function AnimatedNumber({
  value,
  locale,
  currency,
  fractionDigits = 0,
  className,
  duration = 0.7,
  cacheKey,
}: Props) {
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        ...(currency
          ? { style: "currency", currency }
          : { style: "decimal" }),
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }),
    [locale, currency, fractionDigits],
  );

  const cacheKeyFull = cacheKey ? `${CACHE_PREFIX}${cacheKey}` : null;

  // Render the FINAL formatted value on both server and client. The
  // animation kicks off in useEffect from a cached starting point, so SSR
  // and the first client render agree on the markup.
  const motionValue = useMotionValue(value);
  const rounded = useTransform(motionValue, (v) => formatter.format(v));
  const [text, setText] = useState(() => formatter.format(value));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = cacheKeyFull
      ? Number.parseFloat(sessionStorage.getItem(cacheKeyFull) ?? "")
      : NaN;
    const startFrom = Number.isFinite(cached) ? cached : value;

    if (startFrom === value) {
      // Already at target — no animation noise on tab switches.
      motionValue.set(value);
      setText(formatter.format(value));
      return;
    }

    motionValue.set(startFrom);
    setText(formatter.format(startFrom));
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
    });
    const unsubscribe = rounded.on("change", setText);
    return () => {
      controls.stop();
      unsubscribe();
    };
  }, [value, duration, motionValue, rounded, formatter, cacheKeyFull]);

  useEffect(() => {
    if (!cacheKeyFull || typeof window === "undefined") return;
    sessionStorage.setItem(cacheKeyFull, String(value));
  }, [value, cacheKeyFull]);

  return <motion.span className={`num ${className ?? ""}`}>{text}</motion.span>;
}
