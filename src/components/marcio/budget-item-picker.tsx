"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet.tsx";
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
  /**
   * Budget item this transaction is currently assigned to, if any.
   * The picker marks both the section and the item with a check so the
   * user can see at a glance where it landed (and reassign if it's wrong).
   */
  currentItemId?: string | null;
  /** When true, picker shows the "remember rule" footer toggle. */
  showRemember?: boolean;
  /** Called when the user picks a budget item; should resolve before close. */
  onPick: (budgetItemId: string, remember: boolean) => Promise<void> | void;
  /** Optional: notification of open state changes (used to clear selections). */
  onOpenChange?: (open: boolean) => void;
};

/**
 * Hierarchical picker rendered as a bottom sheet — fits the mobile-first
 * UX better than a popover (bigger touch targets, swipe-to-dismiss,
 * doesn't hover over the row that opened it). The user picks a section
 * first, then an item within it.
 *
 * Sheet swipe-to-dismiss + body scroll lock are handled by ui/sheet.tsx.
 */
export function BudgetItemPicker({
  trigger,
  options,
  sectionLabels,
  title,
  subtitle,
  currentItemId = null,
  showRemember = true,
  onPick,
  onOpenChange,
}: Props) {
  const t = useTranslations("Inbox");
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section | null>(null);
  const [remember, setRemember] = useState(true);
  const [pending, startTransition] = useTransition();
  // Track whether the user has manually changed sections during this open
  // session — once they navigate, we stop auto-drilling on subsequent opens
  // within the same mount. Resets when the sheet closes.
  const [manualSection, setManualSection] = useState(false);

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

  // Section that holds the currently-assigned item — used to decorate the
  // section row at the top level so the user sees the trail without
  // drilling in.
  const currentSection = useMemo<Section | null>(() => {
    if (!currentItemId) return null;
    const hit = options.find((o) => o.id === currentItemId);
    return hit?.section ?? null;
  }, [options, currentItemId]);

  function pick(itemId: string) {
    startTransition(async () => {
      await onPick(itemId, remember);
      setOpen(false);
      setSection(null);
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // On open, jump to the section holding the current assignment so
      // the user lands on the item without an extra tap. They can still
      // chevron-back to the section list to reassign elsewhere.
      setSection(!manualSection && currentSection ? currentSection : null);
    } else {
      setSection(null);
      setManualSection(false);
    }
    onOpenChange?.(next);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger className="block w-full text-left">
        {trigger}
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] rounded-t-2xl"
        showCloseButton
      >
        <div className="flex flex-col">
          <header className="flex items-center gap-2 px-4 pt-1 pb-3">
            {section ? (
              <button
                type="button"
                onClick={() => {
                  setSection(null);
                  setManualSection(true);
                }}
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
              <p className="mt-0.5 truncate text-base font-medium">
                {subtitle}
              </p>
            </div>
          </header>

          <div
            data-sheet-scroll
            className="max-h-[60dvh] overflow-y-auto border-t border-border/60 py-1"
          >
            {grouped.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t("noBudgetItems")}
              </p>
            ) : section ? (
              grouped
                .find((g) => g.section === section)
                ?.items.map((opt) => {
                  const isCurrent = opt.id === currentItemId;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={pending}
                      onClick={() => pick(opt.id)}
                      aria-current={isCurrent ? "true" : undefined}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-base transition-colors hover:bg-accent/40 active:bg-accent/60"
                    >
                      <span
                        className={
                          isCurrent
                            ? "truncate font-medium text-primary"
                            : "truncate"
                        }
                      >
                        {opt.name}
                      </span>
                      {isCurrent ? (
                        <span
                          aria-label={t("currentlyAssigned")}
                          className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"
                        >
                          <Check className="size-3" strokeWidth={3} />
                        </span>
                      ) : null}
                    </button>
                  );
                })
            ) : (
              grouped.map((g) => {
                const sectionHasCurrent = g.section === currentSection;
                return (
                  <button
                    key={g.section}
                    type="button"
                    onClick={() => {
                      setSection(g.section);
                      setManualSection(true);
                    }}
                    aria-current={sectionHasCurrent ? "true" : undefined}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-base transition-colors hover:bg-accent/40 active:bg-accent/60"
                  >
                    <span
                      className={
                        sectionHasCurrent
                          ? "flex items-center gap-2 font-medium text-primary"
                          : "font-medium"
                      }
                    >
                      {sectionLabels[g.section]}
                      {sectionHasCurrent ? (
                        <span
                          aria-hidden
                          className="grid size-4 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"
                        >
                          <Check className="size-2.5" strokeWidth={3} />
                        </span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {g.items.length}
                      <ChevronRight className="size-4" />
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {showRemember ? (
            <footer className="flex items-center justify-between border-t border-border/60 px-4 py-3">
              <Label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.currentTarget.checked)}
                  className="size-4"
                />
                {t("remember")}
              </Label>
              {pending ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : null}
            </footer>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
