import { useTranslations } from "next-intl";
import {
  AlertTriangle,
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
 * Renders the hardcoded `AI_INSIGHTS` array as a stack of small rows
 * inside one card. Newest first — order in source is preserved.
 * Hidden entirely when the array is empty so we don't leave a "no
 * insights yet" placeholder rotting on the screen.
 */
export function AIInsightsCard() {
  const t = useTranslations("Insights.ai");
  const insights = AI_INSIGHTS;
  if (insights.length === 0) return null;

  return (
    <Card className="border-border/40 bg-card/60 p-5">
      <header className="flex items-center gap-2">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Sparkles className="size-3.5" strokeWidth={2.4} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{t("title")}</h2>
          <p className="text-[11px] text-muted-foreground">{t("hint")}</p>
        </div>
      </header>
      <ul className="mt-3 flex flex-col gap-3">
        {insights.map((i) => (
          <InsightRow key={i.id} insight={i} />
        ))}
      </ul>
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
