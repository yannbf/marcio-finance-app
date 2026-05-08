"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet.tsx";
import { Label } from "@/components/ui/label.tsx";
import { SECTION_ORDER } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";
import type { BudgetItemOption } from "@/components/marcio/inbox-row.tsx";

/**
 * "Apply to" — controls whether the assignment hits a single transaction,
 * fans out to similar past unmatched transactions, or also creates a
 * learned rule for future ones.
 */
export type ApplyTo = "this" | "similar" | "future";

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
  /**
   * When true, picker shows the "Apply to" footer (this/similar/future).
   * Bulk-assign hides this — it only makes sense for single-tx flows.
   */
  showApplyTo?: boolean;
  /** Called when the user picks a budget item; should resolve before close. */
  onPick: (budgetItemId: string, applyTo: ApplyTo) => Promise<void> | void;
  /** Optional: notification of open state changes (used to clear selections). */
  onOpenChange?: (open: boolean) => void;
};

/**
 * Hierarchical picker rendered as a bottom sheet — fits the mobile-first
 * UX better than a popover (bigger touch targets, swipe-to-dismiss,
 * doesn't hover over the row that opened it). Sections render as
 * accordion rows: tapping FIXAS / VARIÁVEIS / SAZONAIS expands the row
 * inline and reveals its items, the chevron rotates 180°. Same pattern
 * as the Activity / Tikkie merchant groups.
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
  showApplyTo = true,
  onPick,
  onOpenChange,
}: Props) {
  const t = useTranslations("Inbox");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<Section>>(new Set());
  const [applyTo, setApplyTo] = useState<ApplyTo>("this");
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

  // Section that holds the currently-assigned item — used to auto-expand
  // it on open and decorate it with a check so the user sees where the
  // tx already lives.
  const currentSection = useMemo<Section | null>(() => {
    if (!currentItemId) return null;
    const hit = options.find((o) => o.id === currentItemId);
    return hit?.section ?? null;
  }, [options, currentItemId]);

  function toggleSection(section: Section) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  function pick(itemId: string) {
    startTransition(async () => {
      await onPick(itemId, applyTo);
      setOpen(false);
      // Reset apply-to to "this" so the next open doesn't accidentally
      // apply a rule the user didn't ask for again.
      setApplyTo("this");
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // On open, auto-expand the section holding the current assignment
      // so the user can spot it without an extra tap.
      setExpanded(currentSection ? new Set([currentSection]) : new Set());
    } else {
      setExpanded(new Set());
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
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {title}
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
            ) : (
              grouped.map((g) => {
                const isOpen = expanded.has(g.section);
                const sectionHasCurrent = g.section === currentSection;
                return (
                  <div key={g.section}>
                    <button
                      type="button"
                      onClick={() => toggleSection(g.section)}
                      aria-expanded={isOpen}
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
                        <ChevronDown
                          className={`size-4 transition-transform ${
                            isOpen ? "rotate-180" : ""
                          }`}
                          aria-hidden
                        />
                      </span>
                    </button>
                    {isOpen ? (
                      <ul className="border-l border-border/40 pb-1 pl-2 ml-4">
                        {g.items.map((opt) => {
                          const isCurrent = opt.id === currentItemId;
                          return (
                            <li key={opt.id}>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => pick(opt.id)}
                                aria-current={isCurrent ? "true" : undefined}
                                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/40 active:bg-accent/60"
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
                                    <Check
                                      className="size-3"
                                      strokeWidth={3}
                                    />
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {showApplyTo ? (
            <footer className="flex flex-col gap-2 border-t border-border/60 px-4 py-3">
              <Label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {t("applyToLabel")}
              </Label>
              <div
                role="radiogroup"
                aria-label={t("applyToLabel")}
                className="grid grid-cols-3 gap-1 rounded-full border border-border/60 bg-background/40 p-0.5"
              >
                {(
                  [
                    ["this", t("applyToThis")],
                    ["similar", t("applyToSimilar")],
                    ["future", t("applyToFuture")],
                  ] as const
                ).map(([value, label]) => {
                  const active = applyTo === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={pending}
                      onClick={() => setApplyTo(value)}
                      className={
                        "rounded-full px-2 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] transition-colors " +
                        (active
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground")
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {pending ? (
                <div className="flex justify-end">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : null}
            </footer>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
