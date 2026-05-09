"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import {
  CATEGORY_DISPLAY_ORDER,
  type Category,
} from "@/lib/categorization.ts";

type Props = {
  trigger: ReactNode;
  /**
   * The counterparty whose fingerprint becomes the override key. Pass
   * the raw bank-side name — `categories.set` runs it through
   * fingerprintCounterparty so "AH AMSTERDAM" / "AH UTRECHT" collapse
   * to one rule.
   */
  counterparty: string | null;
  /** The category the row currently shows. Highlighted in the picker. */
  current: Category | null;
};

/**
 * Bottom-sheet picker for reclassifying a transaction's auto-category.
 * Same UX shape as BudgetItemPicker — wraps the trigger, lists every
 * shipped category, and on tap calls trpc.categories.set so the choice
 * applies retroactively to every prior tx with the same counterparty
 * fingerprint AND every future one.
 */
export function CategoryPicker({ trigger, counterparty, current }: Props) {
  const t = useTranslations("Categories");
  const tHeader = useTranslations("CategoryPicker");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const utils = trpc.useUtils();
  const set = trpc.categories.set.useMutation({
    onSuccess: () => {
      utils.activity.get.invalidate();
      utils.transactions.list.invalidate();
      utils.insights.get.invalidate();
    },
  });
  const clear = trpc.categories.clear.useMutation({
    onSuccess: () => {
      utils.activity.get.invalidate();
      utils.transactions.list.invalidate();
      utils.insights.get.invalidate();
    },
  });

  function pick(category: Category) {
    if (!counterparty) return;
    startTransition(async () => {
      await set.mutateAsync({ counterparty, category });
      setOpen(false);
    });
  }

  function reset() {
    if (!counterparty) return;
    startTransition(async () => {
      await clear.mutateAsync({ counterparty });
      setOpen(false);
    });
  }

  // No fingerprint → can't pin an override. Render the trigger as a
  // plain element with no sheet attached.
  if (!counterparty) return <>{trigger}</>;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="block w-full text-left">{trigger}</SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] rounded-t-2xl"
        showCloseButton
      >
        <div className="flex flex-col">
          <header className="flex flex-col gap-1 px-4 pt-1 pb-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {tHeader("title")}
            </p>
            <p className="truncate text-base font-medium">{counterparty}</p>
            <p className="text-[11px] text-muted-foreground">
              {tHeader("hint")}
            </p>
          </header>

          <div
            data-sheet-scroll
            className="max-h-[60dvh] overflow-y-auto border-t border-border/60 py-1"
          >
            {CATEGORY_DISPLAY_ORDER.map((c) => {
              const active = current === c;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={pending}
                  onClick={() => pick(c)}
                  aria-current={active ? "true" : undefined}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-accent/40 active:bg-accent/60"
                >
                  <span
                    className={
                      active
                        ? "truncate font-medium text-primary"
                        : "truncate"
                    }
                  >
                    {t(c as never)}
                  </span>
                  {active ? (
                    <span
                      aria-hidden
                      className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"
                    >
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
            >
              <Sparkles className="size-3" />
              {tHeader("reset")}
            </button>
            {pending ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : null}
          </footer>
        </div>
      </SheetContent>
    </Sheet>
  );
}
