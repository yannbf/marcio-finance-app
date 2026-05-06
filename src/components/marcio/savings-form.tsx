"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Card } from "@/components/ui/card.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  createSavingsAccountAction,
  deleteSavingsAccountAction,
  updateSavingsLinksAction,
} from "@/app/[locale]/settings/savings/actions.ts";

export type SavingsRow = {
  id: string;
  ref: string;
  nickname: string;
  owner: "joint" | "camila" | "yann";
  defaultBudgetItemNaturalKey: string | null;
  notes: string | null;
  /** naturalKeys of currently-linked SAZONAIS items. */
  linkedNaturalKeys: string[];
};

export type BudgetSuggestion = {
  naturalKey: string;
  name: string;
  scope: "joint" | "camila" | "yann";
};

type Props = {
  rows: SavingsRow[];
  ownerOptions: { value: "joint" | "camila" | "yann"; label: string }[];
  defaultOwner: "joint" | "camila" | "yann";
  budgetItemSuggestions: BudgetSuggestion[];
};

export function SavingsForm({
  rows,
  ownerOptions,
  defaultOwner,
  budgetItemSuggestions,
}: Props) {
  const t = useTranslations("Settings.sections.savings");
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <Card className="border-border/40 bg-card/40 p-5 text-center text-sm text-muted-foreground">
          {t("empty")}
        </Card>
      ) : (
        rows.map((r) => (
          <SavingsRowEditor
            key={r.id}
            row={r}
            ownerOptions={ownerOptions}
            budgetItemSuggestions={budgetItemSuggestions}
          />
        ))
      )}
      <NewSavingsForm
        ownerOptions={ownerOptions}
        defaultOwner={defaultOwner}
        budgetItemSuggestions={budgetItemSuggestions}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SavingsRowEditor({
  row,
  ownerOptions,
  budgetItemSuggestions,
}: {
  row: SavingsRow;
  ownerOptions: Props["ownerOptions"];
  budgetItemSuggestions: BudgetSuggestion[];
}) {
  const t = useTranslations("Settings.sections.savings");
  const [expanded, setExpanded] = useState(false);
  const [linked, setLinked] = useState<string[]>(row.linkedNaturalKeys);
  const [pending, startTransition] = useTransition();

  const candidates = budgetItemSuggestions.filter((b) => b.scope === row.owner);

  function toggle(key: string) {
    setLinked((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function save() {
    startTransition(async () => {
      await updateSavingsLinksAction({
        savingsAccountId: row.id,
        linkedNaturalKeys: linked,
      });
      setExpanded(false);
    });
  }

  function remove() {
    startTransition(async () => {
      await deleteSavingsAccountAction(row.id);
    });
  }

  return (
    <Card className="border-border/40 bg-card/60 p-4">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-medium">{row.nickname}</p>
          <p className="num truncate text-xs text-muted-foreground">
            {row.ref} ·{" "}
            {ownerOptions.find((o) => o.value === row.owner)?.label} ·{" "}
            {row.linkedNaturalKeys.length === 0
              ? t("noLinkedItems")
              : t("linkedCount", { n: row.linkedNaturalKeys.length })}
          </p>
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </header>

      {expanded ? (
        <div className="mt-3 border-t border-border/40 pt-3">
          {candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("noCandidates")}
            </p>
          ) : (
            <>
              <p className="text-xs font-medium">{t("linkedItemsLabel")}</p>
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
            </>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="default"
              onClick={() => {
                setLinked(row.linkedNaturalKeys);
                setExpanded(false);
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="default"
              disabled={pending}
              onClick={save}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("save")}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function NewSavingsForm({
  ownerOptions,
  defaultOwner,
  budgetItemSuggestions,
}: {
  ownerOptions: Props["ownerOptions"];
  defaultOwner: "joint" | "camila" | "yann";
  budgetItemSuggestions: BudgetSuggestion[];
}) {
  const t = useTranslations("Settings.sections.savings");
  const [adding, setAdding] = useState(false);
  const [owner, setOwner] = useState<"joint" | "camila" | "yann">(defaultOwner);
  const [linked, setLinked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const candidates = budgetItemSuggestions.filter((b) => b.scope === owner);

  function toggle(key: string) {
    setLinked((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(formRef.current!);
    startTransition(async () => {
      const r = await createSavingsAccountAction({
        ref: String(fd.get("ref") ?? ""),
        nickname: String(fd.get("nickname") ?? ""),
        owner,
        linkedNaturalKeys: linked.join(","),
        notes: String(fd.get("notes") ?? "") || undefined,
      });
      if (r.ok) {
        formRef.current?.reset();
        setLinked([]);
        setAdding(false);
      } else {
        setError(r.error);
      }
    });
  }

  if (!adding) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="default"
        onClick={() => setAdding(true)}
        className="border border-dashed border-border/60"
      >
        <Plus className="size-4" />
        {t("addNew")}
      </Button>
    );
  }

  return (
    <Card className="border-border/40 bg-card/60 p-4">
      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3">
        <div>
          <Label htmlFor="ref" className="text-xs">
            {t("refLabel")}
          </Label>
          <Input
            id="ref"
            name="ref"
            placeholder={t("refPlaceholder")}
            required
            className="num mt-1"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {t("refHint")}
          </p>
        </div>
        <div>
          <Label htmlFor="nickname" className="text-xs">
            {t("nicknameLabel")}
          </Label>
          <Input
            id="nickname"
            name="nickname"
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
          <Label htmlFor="notes" className="text-xs">
            {t("notesLabel")}{" "}
            <span className="text-muted-foreground">({t("optional")})</span>
          </Label>
          <Input
            id="notes"
            name="notes"
            placeholder={t("notesPlaceholder")}
            className="mt-1"
          />
        </div>
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
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
            onClick={() => {
              setAdding(false);
              setError(null);
              setLinked([]);
            }}
          >
            {t("cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
