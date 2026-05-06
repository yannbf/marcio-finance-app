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
} from "@/app/[locale]/settings/savings/actions.ts";

export type SavingsRow = {
  id: string;
  ref: string;
  nickname: string;
  owner: "joint" | "camila" | "yann";
  defaultBudgetItemNaturalKey: string | null;
  notes: string | null;
};

type Props = {
  rows: SavingsRow[];
  ownerOptions: { value: "joint" | "camila" | "yann"; label: string }[];
  defaultOwner: "joint" | "camila" | "yann";
  budgetItemSuggestions: { naturalKey: string; name: string }[];
};

export function SavingsForm({
  rows,
  ownerOptions,
  defaultOwner,
  budgetItemSuggestions,
}: Props) {
  const t = useTranslations("Settings.sections.savings");
  const [adding, setAdding] = useState(false);
  const [owner, setOwner] = useState<"joint" | "camila" | "yann">(defaultOwner);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(formRef.current!);
    startTransition(async () => {
      const r = await createSavingsAccountAction({
        ref: String(fd.get("ref") ?? ""),
        nickname: String(fd.get("nickname") ?? ""),
        owner,
        defaultBudgetItemNaturalKey:
          String(fd.get("defaultKey") ?? "") || undefined,
        notes: String(fd.get("notes") ?? "") || undefined,
      });
      if (r.ok) {
        formRef.current?.reset();
        setAdding(false);
      } else {
        setError(r.error);
      }
    });
  }

  function onDelete(id: string) {
    startTransition(async () => {
      await deleteSavingsAccountAction(id);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <Card className="border-border/40 bg-card/40 p-5 text-center text-sm text-muted-foreground">
          {t("empty")}
        </Card>
      ) : (
        <Card className="border-border/40 bg-card/60 p-1">
          <ul className="divide-y divide-border/40">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 px-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.nickname}</p>
                  <p className="num mt-0.5 truncate text-xs text-muted-foreground">
                    {ownerOptions.find((o) => o.value === r.owner)?.label} ·{" "}
                    {r.ref}
                    {r.defaultBudgetItemNaturalKey
                      ? ` → ${labelOf(r.defaultBudgetItemNaturalKey, budgetItemSuggestions)}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(r.id)}
                  disabled={pending}
                  className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {adding ? (
        <Card className="border-border/40 bg-card/60 p-4">
          <form
            ref={formRef}
            onSubmit={onSubmit}
            className="flex flex-col gap-3"
          >
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
                onValueChange={(v) => setOwner(v as typeof owner)}
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
            {budgetItemSuggestions.length > 0 ? (
              <div>
                <Label htmlFor="defaultKey" className="text-xs">
                  {t("linkedItemLabel")}{" "}
                  <span className="text-muted-foreground">
                    ({t("optional")})
                  </span>
                </Label>
                <select
                  id="defaultKey"
                  name="defaultKey"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  defaultValue=""
                >
                  <option value="">—</option>
                  {budgetItemSuggestions.map((b) => (
                    <option key={b.naturalKey} value={b.naturalKey}>
                      {b.name}
                    </option>
                  ))}
                </select>
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
                }}
              >
                {t("cancel")}
              </Button>
            </div>
          </form>
        </Card>
      ) : (
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
      )}
    </div>
  );
}

function labelOf(
  key: string,
  suggestions: { naturalKey: string; name: string }[],
): string {
  return suggestions.find((s) => s.naturalKey === key)?.name ?? key;
}
