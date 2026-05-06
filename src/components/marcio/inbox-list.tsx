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

export type InboxListItem = InboxItem & { owner: Owner };

type Props = {
  items: InboxListItem[];
  optionsAll: BudgetItemOption[];
  locale: string;
  sectionLabels: Record<Section, string>;
};

export function InboxList({
  items,
  optionsAll,
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
  const sharedOwner: Owner | null = useMemo(() => {
    if (selectedItems.length === 0) return null;
    const first = selectedItems[0]!.owner;
    return selectedItems.every((it) => it.owner === first) ? first : null;
  }, [selectedItems]);

  const bulkOptions = useMemo(
    () =>
      sharedOwner === null
        ? []
        : optionsAll.filter((o) => o.scope === sharedOwner),
    [optionsAll, sharedOwner],
  );

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

  return (
    <>
      <Card className="border-border/40 bg-card/60 p-2">
        <ul className="divide-y divide-border/40">
          {items.map((tx) => {
            const optsForScope = optionsAll.filter(
              (o) => o.scope === tx.owner,
            );
            const isSelected = selected.has(tx.id);
            return (
              <li key={tx.id} className="flex items-center gap-1.5 px-1.5">
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
            {sharedOwner ? (
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
                align="end"
              />
            ) : (
              <span className="px-2 text-xs text-destructive">
                {t("bulkMixedScopes")}
              </span>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
