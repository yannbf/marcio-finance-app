import { getLocale, getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { ArrowRight, Calendar, Sparkles } from "lucide-react";
import { AnimatedNumber } from "./animated-number.tsx";
import { formatEUR, formatPercent } from "@/lib/format.ts";
import { daysUntilNextPayday } from "@/lib/payday.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";

/**
 * v1 demo Today screen. Real data hooks come in Phase 2 (CSV ingest) and
 * Phase 4 (forecast). Numbers below are deliberately fabricated placeholders.
 */
export async function TodayScreen() {
  const locale = await getLocale();
  const t = await getTranslations();
  const settings = await getHouseholdSettings();
  const days = daysUntilNextPayday(new Date(), settings.paydayDay);

  const planned = 5500;
  const spent = 1820;
  const remaining = planned - spent;
  const progress = spent / planned;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pb-32 pt-8">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("Brand.name")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {t("Today.spentSoFar")}
          </h1>
        </div>
        <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
          <Calendar className="size-3" />
          {t("Today.untilPayday", { days })}
        </Badge>
      </header>

      <Card className="relative overflow-hidden border-border/40 bg-card/60 p-6">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("Today.spentSoFar")}
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <AnimatedNumber
            value={spent}
            locale={locale}
            currency="EUR"
            className="text-5xl font-semibold tracking-tight"
          />
        </div>
        <p className="mt-1 text-sm text-muted-foreground num">
          {t("Today.ofPlanned", { planned: formatEUR(planned, locale) })}
        </p>

        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${Math.min(100, progress * 100).toFixed(2)}%` }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground num">
          <span>{formatPercent(progress, locale)}</span>
          <span>
            {t("Today.remaining")}: {formatEUR(remaining, locale)}
          </span>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <MiniStat
          label={t("Sections.fixas")}
          value={966}
          locale={locale}
          accent
        />
        <MiniStat
          label={t("Sections.variaveis")}
          value={770}
          locale={locale}
        />
        <MiniStat
          label={t("Sections.sazonais")}
          value={580}
          locale={locale}
        />
        <MiniStat
          label={t("Sections.margem")}
          value={-232}
          locale={locale}
          tone={-232 < 0 ? "negative" : "neutral"}
        />
      </div>

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
        <ArrowRight className="size-4 text-muted-foreground" />
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        {t("Today.monthAnchor")}
      </p>
    </main>
  );
}

function MiniStat({
  label,
  value,
  locale,
  tone = "neutral",
  accent = false,
}: {
  label: string;
  value: number;
  locale: string;
  tone?: "neutral" | "negative";
  accent?: boolean;
}) {
  return (
    <Card
      className={`border-border/40 bg-card/60 p-4 ${accent ? "ring-1 ring-primary/30" : ""}`}
    >
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`num mt-1 text-xl font-semibold tracking-tight ${tone === "negative" ? "text-destructive" : ""}`}
      >
        {formatEUR(value, locale)}
      </p>
    </Card>
  );
}
