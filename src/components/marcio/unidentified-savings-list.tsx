"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { formatEUR } from "@/lib/format.ts";
import type { BudgetSuggestion } from "./savings-form.tsx";

export type UnidentifiedRef = {
  ref: string;
  txCount: number;
  totalAbsCents: number;
  latestBookingDate: string;
  suggestedOwner: "joint" | "yann" | "camila";
};

type Props = {
  refs: UnidentifiedRef[];
  ownerOptions: { value: "joint" | "yann" | "camila"; label: string }[];
  budgetItemSuggestions: BudgetSuggestion[];
  locale: string;
};

/**
 * Renders one card per detected-but-unclaimed `[NVA]\d{8}` ref pulled
 * from recent transaction descriptions. Tapping "Identify" opens a
 * bottom sheet that creates a savings_account row + retroactively
 * re-routes prior transactions to the chosen budget items.
 */
export function UnidentifiedSavingsList({
  refs,
  ownerOptions,
  budgetItemSuggestions,
  locale,
}: Props) {
  const t = useTranslations("Settings.sections.savings");
  const [open, setOpen] = useState<UnidentifiedRef | null>(null);

  if (refs.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-2 px-1">
        <AlertCircle className="size-4 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("unidentifiedTitle")}</p>
          <p className="text-[11px] text-muted-foreground">
            {t("unidentifiedSubtitle", { n: refs.length })}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        {refs.map((r) => (
          <Card
            key={r.ref}
            className="flex flex-col gap-2 border-amber-400/30 bg-amber-500/5 p-4"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-amber-700 dark:text-amber-400">
                    <AlertCircle className="size-3" />
                    {t("unidentifiedBadge")}
                  </span>
                </div>
                <p className="num mt-1 text-sm font-medium">{r.ref}</p>
                <p className="num mt-0.5 text-[11px] text-muted-foreground">
                  {t("unidentifiedActivity", {
                    count: r.txCount,
                    date: formatShortDate(r.latestBookingDate, locale),
                  })}
                </p>
                <p className="num mt-0.5 text-[11px] text-muted-foreground">
                  {t("unidentifiedFlow", {
                    amount: formatEUR(r.totalAbsCents / 100, locale),
                  })}
                </p>
              </div>
              <Button
                type="button"
                size="default"
                onClick={() => setOpen(r)}
                className="shrink-0"
              >
                {t("unidentifiedIdentify")}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Sheet
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle>
                  {t("unidentifiedClaimTitle", { ref: open.ref })}
                </SheetTitle>
              </SheetHeader>
              <ClaimForm
                target={open}
                ownerOptions={ownerOptions}
                budgetItemSuggestions={budgetItemSuggestions}
                onDone={() => setOpen(null)}
              />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function ClaimForm({
  target,
  ownerOptions,
  budgetItemSuggestions,
  onDone,
}: {
  target: UnidentifiedRef;
  ownerOptions: Props["ownerOptions"];
  budgetItemSuggestions: BudgetSuggestion[];
  onDone: () => void;
}) {
  const t = useTranslations("Settings.sections.savings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nickname, setNickname] = useState("");
  const [notes, setNotes] = useState("");
  const [owner, setOwner] = useState<"joint" | "yann" | "camila">(
    target.suggestedOwner,
  );
  const [linked, setLinked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<number | null>(null);

  const candidates = budgetItemSuggestions.filter((b) => b.scope === owner);
  const claim = trpc.savings.create.useMutation();

  function toggle(key: string) {
    setLinked((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!nickname.trim()) return;
    startTransition(async () => {
      try {
        const r = await claim.mutateAsync({
          ref: target.ref,
          nickname: nickname.trim(),
          owner,
          linkedNaturalKeys: linked,
          notes: notes.trim() || undefined,
        });
        setSuccess(r.rematched);
        // Server-rendered settings page reads from DB, so refresh once
        // we know the row landed + the engine has run.
        router.refresh();
        // Brief pause so the user reads the success line, then close.
        setTimeout(onDone, 900);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 px-4 py-3">
      <p className="text-[11px] text-muted-foreground">
        {t("unidentifiedClaimHint")}
      </p>

      <div>
        <Label htmlFor="claim-nickname" className="text-xs">
          {t("nicknameLabel")}
        </Label>
        <Input
          id="claim-nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={t("nicknamePlaceholder")}
          required
          className="mt-1"
        />
      </div>

      <div>
        <Label className="text-xs">{t("ownerLabel")}</Label>
        <Select
          value={owner}
          onValueChange={(v) => {
            setOwner(v as typeof owner);
            setLinked([]);
          }}
        >
          <SelectTrigger className="mt-1">
            <SelectValue>
              {ownerOptions.find((o) => o.value === owner)?.label ?? ""}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ownerOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {candidates.length > 0 ? (
        <div>
          <Label className="text-xs">{t("linkedItemsLabel")}</Label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t("linkedItemsHint")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {candidates.map((c) => {
              const on = linked.includes(c.naturalKey);
              return (
                <button
                  key={c.naturalKey}
                  type="button"
                  onClick={() => toggle(c.naturalKey)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    on
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-border/60 bg-card/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <Label htmlFor="claim-notes" className="text-xs">
          {t("notesLabel")}{" "}
          <span className="text-muted-foreground">({t("optional")})</span>
        </Label>
        <Input
          id="claim-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("notesPlaceholder")}
          className="mt-1"
        />
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {t("unidentifiedFailure", { error })}
        </p>
      ) : null}

      {success !== null ? (
        <p className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          {t("unidentifiedSaved", { n: success })}
        </p>
      ) : null}

      <div className="mt-1 flex gap-2">
        <Button type="submit" disabled={pending} size="default">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="default"
          onClick={onDone}
          disabled={pending}
        >
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function formatShortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
  });
}
