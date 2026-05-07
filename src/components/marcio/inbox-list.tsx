"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { InboxRow, type BudgetItemOption, type InboxItem } from "./inbox-row.tsx";
import { BudgetItemPicker } from "./budget-item-picker.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import type { Section } from "@/lib/import/types.ts";

type Owner = "joint" | "camila" | "yann";

export type InboxListItem = InboxItem & {
  owner: Owner;
  anchorYear: number;
  anchorMonth: number;
};

type Props = {
  items: InboxListItem[];
  /** Budget-item options keyed by anchor "YYYY-MM". */
  optionsByAnchor: Record<string, BudgetItemOption[]>;
  /** Anchors that have inbox txns but no `month` row imported. */
  monthsWithoutSheet: { year: number; month: number }[];
  locale: string;
  sectionLabels: Record<Section, string>;
};

export function InboxList({
  items,
  optionsByAnchor,
  monthsWithoutSheet,
  locale,
  sectionLabels,
}: Props) {
  const t = useTranslations("Inbox");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const utils = trpc.useUtils();
  const bulk = trpc.inbox.assignMany.useMutation({
    onSuccess: () => {
      utils.inbox.list.invalidate();
      utils.activity.get.invalidate();
      utils.today.get.invalidate();
      utils.transactions.list.invalidate();
      utils.month.get.invalidate();
      utils.insights.get.invalidate();
      utils.buckets.get.invalidate();
    },
  });

  const selectedItems = useMemo(
    () => items.filter((it) => selected.has(it.id)),
    [items, selected],
  );

  // Bulk assign requires every selected row to share both owner AND
  // payday-month — otherwise we'd be filing transactions from one month
  // into another month's budget item by accident.
  const sharedOwner: Owner | null = useMemo(() => {
    if (selectedItems.length === 0) return null;
    const first = selectedItems[0]!.owner;
    return selectedItems.every((it) => it.owner === first) ? first : null;
  }, [selectedItems]);

  const sharedAnchor: { year: number; month: number } | null = useMemo(() => {
    if (selectedItems.length === 0) return null;
    const first = selectedItems[0]!;
    return selectedItems.every(
      (it) =>
        it.anchorYear === first.anchorYear &&
        it.anchorMonth === first.anchorMonth,
    )
      ? { year: first.anchorYear, month: first.anchorMonth }
      : null;
  }, [selectedItems]);

  const bulkOptions = useMemo(() => {
    if (sharedOwner === null || sharedAnchor === null) return [];
    const k = anchorKey(sharedAnchor.year, sharedAnchor.month);
    return (optionsByAnchor[k] ?? []).filter((o) => o.scope === sharedOwner);
  }, [optionsByAnchor, sharedOwner, sharedAnchor]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clear() {
    setSelected(new Set());
  }

  async function bulkPick(budgetItemId: string, remember: boolean) {
    const ids = [...selected];
    const r = await bulk.mutateAsync({
      transactionIds: ids,
      budgetItemId,
      rememberRule: remember,
    });
    if (r.ok) clear();
  }

  // Group rows by payday-month, newest first.
  const groups = useMemo(() => {
    const map = new Map<string, InboxListItem[]>();
    for (const it of items) {
      const k = anchorKey(it.anchorYear, it.anchorMonth);
      const list = map.get(k) ?? [];
      list.push(it);
      map.set(k, list);
    }
    const orderedKeys = [...map.keys()].sort().reverse();
    return orderedKeys.map((k) => {
      const first = map.get(k)![0]!;
      return {
        key: k,
        anchorYear: first.anchorYear,
        anchorMonth: first.anchorMonth,
        rows: map.get(k)!,
      };
    });
  }, [items]);

  const monthsWithoutSheetSet = useMemo(
    () =>
      new Set(
        monthsWithoutSheet.map((m) => anchorKey(m.year, m.month)),
      ),
    [monthsWithoutSheet],
  );

  return (
    <>
      {groups.map((g) => {
        const opts = optionsByAnchor[g.key] ?? [];
        const needsSheet = monthsWithoutSheetSet.has(g.key);
        return (
          <section key={g.key} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {monthHeading(g.anchorYear, g.anchorMonth, locale)}
              </h2>
              <span className="num text-[11px] text-muted-foreground/70">
                {t("count", { n: g.rows.length })}
              </span>
            </div>
            {needsSheet ? (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
                {t("monthNeedsSheet", {
                  month: monthHeading(g.anchorYear, g.anchorMonth, locale),
                })}
              </p>
            ) : null}
            <Card className="border-border/40 bg-card/60 p-2">
              <ul className="divide-y divide-border/40">
                {g.rows.map((tx) => {
                  const optsForScope = opts.filter(
                    (o) => o.scope === tx.owner,
                  );
                  const isSelected = selected.has(tx.id);
                  return (
                    <li
                      key={tx.id}
                      className="flex items-center gap-1.5 px-1.5"
                    >
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-primary"
                        checked={isSelected}
                        onChange={() => toggle(tx.id)}
                        aria-label={t("selectAll")}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="min-w-0 flex-1">
                        <InboxRow
                          tx={{
                            id: tx.id,
                            counterparty: tx.counterparty,
                            description: tx.description,
                            bookingDate: tx.bookingDate,
                            amountCents: tx.amountCents,
                          }}
                          options={optsForScope}
                          locale={locale}
                          sectionLabels={sectionLabels}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        );
      })}

      {selected.size > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4">
          <Card className="pointer-events-auto flex w-full max-w-md items-center gap-2 border-border bg-card/95 p-2 shadow-lg backdrop-blur">
            <span className="px-2 text-xs font-medium text-muted-foreground">
              {t("selected", { n: selected.size })}
            </span>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={clear}>
              {t("clearSelection")}
            </Button>
            {sharedOwner && sharedAnchor ? (
              <BudgetItemPicker
                trigger={
                  <span className="inline-flex h-7 items-center rounded-[12px] bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground">
                    {t("assignSelected", { n: selected.size })}
                  </span>
                }
                options={bulkOptions}
                sectionLabels={sectionLabels}
                title={t("assignTo")}
                subtitle={t("selected", { n: selected.size })}
                onPick={bulkPick}
              />
            ) : (
              <span className="px-2 text-xs text-destructive">
                {sharedOwner === null
                  ? t("bulkMixedScopes")
                  : t("bulkMixedMonths")}
              </span>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}

function anchorKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthHeading(year: number, month: number, locale: string): string {
  // Month name in the current locale, capitalised — "Maio 2026", "May 2026".
  const date = new Date(year, month - 1, 15);
  const label = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
