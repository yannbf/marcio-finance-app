"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ChevronDown,
  Lightbulb,
  PartyPopper,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import {
  AI_INSIGHTS,
  type AIInsight,
  type InsightTone,
} from "@/lib/ai-insights.ts";

const ICON_BY_TONE: Record<
  InsightTone,
  React.ComponentType<{ className?: string }>
> = {
  info: Sparkles,
  tip: Lightbulb,
  warn: AlertTriangle,
  celebrate: PartyPopper,
};

const TONE_CLASSES: Record<
  InsightTone,
  { ring: string; iconBg: string; iconFg: string }
> = {
  info: {
    ring: "ring-foreground/10",
    iconBg: "bg-secondary",
    iconFg: "text-foreground/80",
  },
  tip: {
    ring: "ring-primary/30",
    iconBg: "bg-primary/15",
    iconFg: "text-primary",
  },
  warn: {
    ring: "ring-amber-400/40",
    iconBg: "bg-amber-500/15",
    iconFg: "text-amber-600 dark:text-amber-400",
  },
  celebrate: {
    ring: "ring-primary/40",
    iconBg: "bg-primary/15",
    iconFg: "text-primary",
  },
};

/**
 * Renders `AI_INSIGHTS` as a collapsible card. Header behaves like a
 * button — tap it to expand/collapse the report. Showing the count of
 * findings as a small badge so the value is visible even when collapsed.
 * Hidden entirely when the array is empty.
 */
export function AIInsightsCard() {
  const t = useTranslations("Insights.ai");
  const insights = AI_INSIGHTS;
  const [open, setOpen] = useState(false);
  if (insights.length === 0) return null;

  return (
    <Card className="!gap-0 border-border/40 bg-card/60 p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/30"
      >
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Sparkles className="size-4" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-sm font-medium">{t("title")}</h2>
            <span className="num inline-flex items-center rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {insights.length}
            </span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {open ? t("hint") : t("hintCollapsed")}
          </p>
        </div>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 text-muted-foreground/70"
        >
          <ChevronDown className="size-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <ul className="flex flex-col gap-3 border-t border-border/40 p-4">
              {insights.map((i) => (
                <InsightRow key={i.id} insight={i} />
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Card>
  );
}

function InsightRow({ insight }: { insight: AIInsight }) {
  const Icon = ICON_BY_TONE[insight.tone];
  const tone = TONE_CLASSES[insight.tone];
  return (
    <li
      className={`flex gap-3 rounded-lg bg-background/40 p-3 ring-1 ${tone.ring}`}
    >
      <span
        className={`grid size-7 shrink-0 place-items-center rounded-full ${tone.iconBg} ${tone.iconFg}`}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{insight.title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {insight.body}
        </p>
        {insight.link ? (
          <Link
            href={insight.link.href as `/${string}`}
            className="mt-2 inline-block text-[11px] font-medium uppercase tracking-[0.08em] text-primary underline-offset-2 hover:underline"
          >
            {insight.link.label} →
          </Link>
        ) : null}
      </div>
    </li>
  );
}
