"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import {
  runImport,
  type ImportActionResult,
} from "@/app/[locale]/import/actions.ts";
import { trpc } from "@/lib/trpc/client.ts";

/**
 * Settings-list row that triggers the same `runImport()` server action
 * the standalone /import page uses. Visually matches the other rows in
 * the settings card (icon → title → hint → trailing affordance) but is
 * a button rather than a link, since the "tap → result" loop fits one
 * row neatly without navigation.
 *
 * Result feedback (inserted / updated / warnings) renders inline below
 * the row so the user sees the outcome without leaving the page.
 */
export function SyncSheetRow() {
  const t = useTranslations("Settings.sections.sync");
  const utils = trpc.useUtils();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportActionResult | null>(null);

  function onClick() {
    startTransition(async () => {
      setResult(null);
      const r = await runImport();
      setResult(r);
      // Re-pull every screen-level query so the new month + items show up.
      utils.today.get.invalidate();
      utils.month.get.invalidate();
      utils.activity.get.invalidate();
      utils.insights.get.invalidate();
      utils.buckets.get.invalidate();
      utils.transactions.list.invalidate();
      utils.inbox.list.invalidate();
    });
  }

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-card/40 disabled:opacity-60"
      >
        <div className="grid size-9 place-items-center rounded-full bg-secondary text-foreground/80">
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
        </div>
      </button>
      {result && !result.ok ? (
        <p className="mx-4 mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {result.error}
        </p>
      ) : null}
      {result?.ok ? (
        <div className="mx-4 mb-3 rounded-md border border-border/60 bg-card/50 px-3 py-2 text-xs">
          {result.results.length === 0 ? (
            <p className="text-muted-foreground">{t("noTabs")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {result.results.map((r) => (
                <li key={r.anchor} className="flex flex-col">
                  <span className="num font-medium">{r.anchor}</span>
                  <span className="num text-muted-foreground">
                    {t("counts", {
                      inserted: r.inserted,
                      updated: r.updated,
                      unchanged: r.unchanged,
                    })}
                  </span>
                  {r.warnings.length > 0 ? (
                    <ul className="mt-1 list-inside list-disc text-[11px] text-muted-foreground/80">
                      {r.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}
