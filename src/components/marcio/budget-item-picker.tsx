"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import { Label } from "@/components/ui/label.tsx";
import { SECTION_ORDER } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";
import type { BudgetItemOption } from "@/components/marcio/inbox-row.tsx";

type Props = {
  trigger: ReactNode;
  options: BudgetItemOption[];
  sectionLabels: Record<Section, string>;
  /** Header label/title above the picker. */
  title: string;
  /** Subtitle under the title (counterparty, "X selected", etc.). */
  subtitle: string;
  /** When true, picker shows the "remember rule" footer toggle. */
  showRemember?: boolean;
  /** Called when the user picks a budget item; should resolve before close. */
  onPick: (budgetItemId: string, remember: boolean) => Promise<void> | void;
  /** Optional: side and align for the popover. */
  align?: "start" | "center" | "end";
  /** Optional: notification of open state changes (used to clear selections). */
  onOpenChange?: (open: boolean) => void;
};

export function BudgetItemPicker({
  trigger,
  options,
  sectionLabels,
  title,
  subtitle,
  showRemember = true,
  onPick,
  align = "end",
  onOpenChange,
}: Props) {
  const t = useTranslations("Inbox");
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section | null>(null);
  const [remember, setRemember] = useState(true);
  const [pending, startTransition] = useTransition();

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
      await onPick(itemId, remember);
      setOpen(false);
      setSection(null);
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setSection(null);
    onOpenChange?.(next);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger className="block w-full text-left">
        {trigger}
      </PopoverTrigger>
      <PopoverContent align={align} sideOffset={4} className="w-72 p-0">
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
              {section ? sectionLabels[section] : title}
            </p>
            <p className="mt-0.5 truncate text-sm font-medium">{subtitle}</p>
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
                <span className="font-medium">{sectionLabels[g.section]}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {g.items.length}
                  <ChevronRight className="size-4" />
                </span>
              </button>
            ))
          )}
        </div>

        {showRemember ? (
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
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
