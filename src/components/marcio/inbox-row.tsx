"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import { Label } from "@/components/ui/label.tsx";
import { TransactionRow } from "./transaction-row.tsx";
import { assignTransactionAction } from "@/app/[locale]/inbox/actions.ts";
import { SECTION_ORDER, SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";

export type InboxItem = {
  id: string;
  counterparty: string | null;
  description: string | null;
  bookingDate: string;
  amountCents: number;
};

export type BudgetItemOption = {
  id: string;
  name: string;
  section: Section;
  scope: "joint" | "camila" | "yann";
};

type Props = {
  tx: InboxItem;
  options: BudgetItemOption[];
  locale: string;
  /** Translated labels for each section, keyed by enum value. */
  sectionLabels: Record<Section, string>;
};

export function InboxRow({ tx, options, locale, sectionLabels }: Props) {
  const t = useTranslations("Inbox");
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section | null>(null);
  const [remember, setRemember] = useState(true);
  const [pending, startTransition] = useTransition();

  // Build [section -> items[]] in a stable, displayable order.
  const grouped = useMemo(() => {
    const map = new Map<Section, BudgetItemOption[]>();
    for (const o of options) {
      const arr = map.get(o.section) ?? [];
      arr.push(o);
      map.set(o.section, arr);
    }
    return SECTION_ORDER.map((s) => ({
      section: s,
      items: (map.get(s) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.items.length > 0);
  }, [options]);

  function pick(itemId: string) {
    startTransition(async () => {
      const r = await assignTransactionAction({
        transactionId: tx.id,
        budgetItemId: itemId,
        rememberRule: remember,
      });
      if (r.ok) {
        setOpen(false);
        setSection(null);
      } else {
        console.error(r.error);
      }
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Reset to the section list whenever the popover closes.
    if (!next) setSection(null);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger className="block w-full rounded text-left transition-colors hover:bg-card/40">
        <TransactionRow
          counterparty={tx.counterparty}
          description={tx.description}
          bookingDate={new Date(tx.bookingDate)}
          amountCents={tx.amountCents}
          locale={locale}
          unmatched
        />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={4} className="w-72 p-0">
        <header className="flex items-center gap-2 border-b border-border/60 p-3">
          {section ? (
            <button
              type="button"
              onClick={() => setSection(null)}
              className="-m-1 rounded p-1 hover:bg-accent/40"
              aria-label={t("back")}
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {section ? sectionLabels[section] : t("assignTo")}
            </p>
            <p className="mt-0.5 truncate text-sm font-medium">
              {tx.counterparty || tx.description}
            </p>
          </div>
        </header>

        <div className="max-h-72 overflow-y-auto py-1">
          {grouped.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {t("noBudgetItems")}
            </p>
          ) : section ? (
            grouped
              .find((g) => g.section === section)
              ?.items.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={pending}
                  onClick={() => pick(opt.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/40"
                >
                  <span className="truncate">{opt.name}</span>
                </button>
              ))
          ) : (
            grouped.map((g) => (
              <button
                key={g.section}
                type="button"
                onClick={() => setSection(g.section)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/40"
              >
                <span className="font-medium">
                  {sectionLabels[g.section]}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {g.items.length}
                  <ChevronRight className="size-4" />
                </span>
              </button>
            ))
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-border/60 p-3">
          <Label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.currentTarget.checked)}
              className="h-3.5 w-3.5"
            />
            {t("remember")}
          </Label>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        </footer>
      </PopoverContent>
    </Popover>
  );
}
