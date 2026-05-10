"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Loader2, Sparkles, X } from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import {
  CATEGORY_DISPLAY_ORDER,
  type Category,
} from "@/lib/categorization.ts";

type Scope = "joint" | "yann" | "camila";

/**
 * "Sempre que uma transação cair em [Compras], categorize como [Compras
 * geral]." — A user-managed mapping table that gives the matching
 * engine a per-category fallback target. Lives on /insights below the
 * "By category" card, scoped to whatever scope the screen is currently
 * looking at.
 *
 * Rows are interactive: tap → bottom sheet listing every outflow
 * budget item in that scope. Picking one upserts the default and
 * triggers a full re-match so prior unmatched transactions in that
 * category retroactively land on the chosen item.
 */
export function CategoryRoutingCard({ scope }: { scope: Scope }) {
  const t = useTranslations("Insights.routing");
  const tCategories = useTranslations("Categories");
  const utils = trpc.useUtils();
  const defaults = trpc.categories.listDefaults.useQuery();
  const options = trpc.categories.budgetItemOptions.useQuery({ scope });
  const setDefault = trpc.categories.setDefault.useMutation({
    onSuccess: () => {
      utils.categories.listDefaults.invalidate();
      utils.activity.get.invalidate();
      utils.transactions.list.invalidate();
      utils.insights.get.invalidate();
      utils.today.get.invalidate();
      utils.month.get.invalidate();
      utils.inbox.list.invalidate();
    },
  });
  const clearDefault = trpc.categories.clearDefault.useMutation({
    onSuccess: () => {
      utils.categories.listDefaults.invalidate();
      utils.activity.get.invalidate();
      utils.transactions.list.invalidate();
      utils.insights.get.invalidate();
    },
  });

  // Build a map (category → existing default for THIS scope) so each
  // row knows what to render in its trailing pill.
  const byCategory = new Map<
    Category,
    { naturalKey: string; sampleName: string | null }
  >();
  for (const d of defaults.data ?? []) {
    if (d.scope === scope) {
      byCategory.set(d.category, {
        naturalKey: d.naturalKey,
        sampleName: d.sampleName,
      });
    }
  }

  return (
    <Card className="border-border/40 bg-card/60 p-5">
      <h2 className="text-sm font-medium">{t("title")}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("hint")}</p>

      <ul className="mt-3 divide-y divide-border/40">
        {CATEGORY_DISPLAY_ORDER.map((c) => {
          const current = byCategory.get(c) ?? null;
          return (
            <li key={c} className="flex items-center gap-2 py-2">
              <p className="min-w-0 flex-1 text-sm">
                {tCategories(c as never)}
              </p>
              <CategoryRoutingPicker
                category={c}
                scope={scope}
                currentNaturalKey={current?.naturalKey ?? null}
                currentLabel={current?.sampleName ?? null}
                options={options.data ?? []}
                pending={
                  setDefault.isPending &&
                  setDefault.variables?.category === c
                }
                onPick={(opt) =>
                  setDefault.mutate({
                    category: c,
                    scope,
                    naturalKey: opt.naturalKey,
                    section: opt.section,
                    sampleName: opt.name,
                  })
                }
                onClear={() =>
                  clearDefault.mutate({ category: c, scope })
                }
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function CategoryRoutingPicker({
  category,
  scope: _scope,
  currentNaturalKey,
  currentLabel,
  options,
  pending,
  onPick,
  onClear,
}: {
  category: Category;
  scope: Scope;
  currentNaturalKey: string | null;
  currentLabel: string | null;
  options: Array<{
    name: string;
    section: "ENTRADAS" | "DIVIDAS" | "ECONOMIAS" | "FIXAS" | "VARIAVEIS" | "SAZONAIS";
    naturalKey: string;
  }>;
  pending: boolean;
  onPick: (opt: {
    name: string;
    section: "ENTRADAS" | "DIVIDAS" | "ECONOMIAS" | "FIXAS" | "VARIAVEIS" | "SAZONAIS";
    naturalKey: string;
  }) => void;
  onClear: () => void;
}) {
  const t = useTranslations("Insights.routing");
  const [open, setOpen] = useState(false);
  const [pendingPick, startTransition] = useTransition();
  void category;

  function pick(opt: {
    name: string;
    section: "ENTRADAS" | "DIVIDAS" | "ECONOMIAS" | "FIXAS" | "VARIAVEIS" | "SAZONAIS";
    naturalKey: string;
  }) {
    startTransition(() => {
      onPick(opt);
      setOpen(false);
    });
  }

  function reset() {
    startTransition(() => {
      onClear();
      setOpen(false);
    });
  }

  const isPending = pending || pendingPick;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
          currentNaturalKey
            ? "border-primary/40 bg-primary/15 text-primary hover:bg-primary/20"
            : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground"
        }`}
      >
        {isPending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : null}
        <span className="truncate max-w-[10ch] sm:max-w-[18ch]">
          {currentLabel ?? t("notSet")}
        </span>
        <ChevronRight className="size-3 opacity-60" />
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-2xl">
        <SheetHeader className="gap-1 px-4 pb-3">
          <SheetTitle className="text-base">{t("pickerTitle")}</SheetTitle>
          <p className="text-[11px] text-muted-foreground">
            {t("pickerHint")}
          </p>
        </SheetHeader>
        <div data-sheet-scroll className="max-h-[60dvh] overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t("noOptions")}
            </p>
          ) : (
            <ul>
              {options.map((opt) => {
                const active = opt.naturalKey === currentNaturalKey;
                return (
                  <li key={`${opt.section}|${opt.naturalKey}`}>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => pick(opt)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-accent/40 active:bg-accent/60 ${
                        active ? "text-primary" : ""
                      }`}
                    >
                      <span className="truncate">{opt.name}</span>
                      <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                        {opt.section}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {currentNaturalKey ? (
          <footer className="flex justify-between gap-2 border-t border-border/60 px-4 py-3">
            <button
              type="button"
              onClick={reset}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
            >
              <X className="size-3" />
              {t("reset")}
            </button>
            {isPending ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <Sparkles className="size-4 text-muted-foreground/60" />
            )}
          </footer>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
