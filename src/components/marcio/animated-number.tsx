"use client";

import { useEffect, useMemo, useState } from "react";
import { animate, useMotionValue, useTransform, motion } from "motion/react";

type Props = {
  value: number;
  /** Intl options. Pass a discriminator so the formatter is built once. */
  locale: string;
  currency?: string;
  fractionDigits?: number;
  className?: string;
  /** Animation duration in seconds. */
  duration?: number;
};

/**
 * Tabular-num animated counter. Formats internally via Intl so it can live
 * in a client component without receiving a server-side function as a prop.
 */
export function AnimatedNumber({
  value,
  locale,
  currency,
  fractionDigits = 0,
  className,
  duration = 0.7,
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

  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => formatter.format(v));
  const [text, setText] = useState(() => formatter.format(0));

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
    });
    const unsubscribe = rounded.on("change", setText);
    return () => {
      controls.stop();
      unsubscribe();
    };
  }, [value, duration, motionValue, rounded]);

  return <motion.span className={`num ${className ?? ""}`}>{text}</motion.span>;
}
