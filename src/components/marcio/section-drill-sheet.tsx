"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Check, CalendarClock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { formatEUR, formatEURPrecise } from "@/lib/format.ts";
import {
  OverBudgetPill,
  SpendProgress,
  progressTone,
} from "./spend-progress.tsx";
import type { SectionData, SectionItemRow } from "@/lib/today-data.ts";
import type { Section } from "@/lib/import/types.ts";

type Props = {
  data: SectionData;
  label: string;
  locale: string;
  accent?: boolean;
  paidLabel: string;
  expectedLabel: string;
  totalLabel: string;
  daySuffix: string;
};

/**
 * Today section card. Tap to open a bottom sheet showing every item in the
 * section grouped into "paid this month" and "still expected". Each item
 * row links into /month/[itemId] for full match history.
 */
export function SectionDrillSheet({
  data,
  label,
  locale,
  accent,
  paidLabel,
  expectedLabel,
  totalLabel,
  daySuffix,
}: Props) {
  const t = useTranslations();
  const actualAbs = Math.abs(data.totalActualCents);
  const plannedAbs = Math.abs(data.totalPlannedCents);
  const tone = progressTone(actualAbs, plannedAbs);
  const overByCents =
    plannedAbs > 0 && actualAbs > plannedAbs ? actualAbs - plannedAbs : 0;
  const paid = data.items.filter((i) => i.status === "paid");
  const expected = data.items.filter((i) => i.status === "expected");

  return (
    <Sheet>
      <SheetTrigger
        className={`relative w-full overflow-hidden rounded-xl border-0 bg-card/60 p-4 text-left ring-1 transition-colors hover:bg-card/80 ${
          tone === "over"
            ? "ring-destructive/45"
            : tone === "warn"
              ? "ring-amber-400/40"
              : accent
                ? "ring-primary/30"
                : "ring-foreground/10"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          {tone === "over" ? (
            <span
              aria-label={t("Today.overBudget")}
              className="grid size-4 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive"
            >
              <AlertTriangle className="size-2.5" strokeWidth={2.5} />
            </span>
          ) : null}
        </div>
        <p className="num mt-1 text-xl font-semibold tracking-tight">
          {formatEUR(data.totalActualCents / 100, locale)}
        </p>
        <p className="num mt-0.5 text-[11px] text-muted-foreground">
          / {formatEUR(data.totalPlannedCents / 100, locale)}
        </p>
        {plannedAbs > 0 ? (
          <SpendProgress
            actualCents={actualAbs}
            plannedCents={plannedAbs}
            size="sm"
            className="mt-2"
          />
        ) : null}
        {overByCents > 0 ? (
          <p className="num mt-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-destructive">
            +{formatEUR(overByCents / 100, locale)}
          </p>
        ) : null}
      </SheetTrigger>

      <SheetContent
        side="bottom"
        className="max-h-[80dvh] rounded-t-2xl bg-background"
      >
        <SheetHeader className="gap-2 pt-1 pr-12">
          <SheetTitle className="flex items-baseline justify-between text-lg">
            <span>{label}</span>
            <span className="num text-base font-normal text-muted-foreground">
              {formatEUR(data.totalActualCents / 100, locale)} /{" "}
              {formatEUR(data.totalPlannedCents / 100, locale)}
            </span>
          </SheetTitle>
          {plannedAbs > 0 ? (
            <div className="flex flex-col gap-1.5 px-4">
              <SpendProgress
                actualCents={actualAbs}
                plannedCents={plannedAbs}
              />
              {overByCents > 0 ? (
                <OverBudgetPill
                  overByCents={overByCents}
                  formatter={(c) => formatEUR(c / 100, locale)}
                  label={t("Today.overBy")}
                  className="self-start"
                />
              ) : null}
            </div>
          ) : null}
        </SheetHeader>

        <div data-sheet-scroll className="max-h-[70dvh] overflow-y-auto px-4 pb-6">
          {paid.length > 0 ? (
            <Group title={paidLabel} items={paid} locale={locale} daySuffix={daySuffix} />
          ) : null}
          {expected.length > 0 ? (
            <Group
              title={expectedLabel}
              items={expected}
              locale={locale}
              daySuffix={daySuffix}
            />
          ) : null}
          {paid.length === 0 && expected.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {totalLabel}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Group({
  title,
  items,
  locale,
  daySuffix,
}: {
  title: string;
  items: SectionItemRow[];
  locale: string;
  daySuffix: string;
}) {
  return (
    <section className="mt-3">
      <p className="px-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      <Card className="mt-1.5 border-border/40 bg-card/40 p-1">
        <ul className="divide-y divide-border/40">
          {items.map((it) => {
            const aAbs = Math.abs(it.actualCents);
            const pAbs = Math.abs(it.plannedCents);
            const ratio = pAbs !== 0 ? aAbs / pAbs : 0;
            const itemTone = progressTone(aAbs, pAbs);
            const isOver = itemTone === "over";
            return (
              <li key={it.id}>
                <Link
                  href={`/month/${it.id}` as `/month/${string}`}
                  className={
                    "flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-card/40 " +
                    (isOver ? "bg-destructive/5" : "")
                  }
                >
                  <div
                    className={`grid size-8 shrink-0 place-items-center rounded-full text-xs ${
                      isOver
                        ? "bg-destructive/15 text-destructive"
                        : it.status === "paid"
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isOver ? (
                      <AlertTriangle className="size-3.5" strokeWidth={2.4} />
                    ) : it.status === "paid" ? (
                      <Check className="size-4" strokeWidth={2.4} />
                    ) : it.predictedDay ? (
                      <span className="num font-semibold">
                        {it.predictedDay}
                      </span>
                    ) : (
                      <CalendarClock className="size-3.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        "truncate text-sm font-medium " +
                        (isOver ? "text-destructive" : "")
                      }
                    >
                      {it.name}
                    </p>
                    {it.status === "expected" && it.predictedDay ? (
                      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {daySuffix} {it.predictedDay}
                      </p>
                    ) : (
                      <p
                        className={
                          "num text-xs " +
                          (itemTone === "over"
                            ? "text-destructive"
                            : itemTone === "warn"
                              ? "text-amber-500"
                              : "text-muted-foreground")
                        }
                      >
                        {Math.round(ratio * 100)}% ·{" "}
                        {it.matchCount > 0
                          ? `${it.matchCount} tx`
                          : "—"}
                      </p>
                    )}
                    {pAbs > 0 ? (
                      <SpendProgress
                        actualCents={aAbs}
                        plannedCents={pAbs}
                        size="sm"
                        className="mt-1"
                      />
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p
                      className={
                        "num text-sm font-semibold " +
                        (isOver ? "text-destructive" : "")
                      }
                    >
                      {formatEURPrecise(aAbs / 100, locale)}
                    </p>
                    <p className="num text-[10px] text-muted-foreground">
                      / {formatEURPrecise(pAbs / 100, locale)}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
