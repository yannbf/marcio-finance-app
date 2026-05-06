"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Upload, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  uploadIngCsv,
  type CsvUploadResult,
} from "@/app/[locale]/connections/actions.ts";
import { CsvHelp } from "./csv-help.tsx";

type Props = {
  /** Restrict the picker to scopes the current user can upload. */
  ownerOptions: { value: "joint" | "camila" | "yann"; label: string }[];
  defaultOwner: "joint" | "camila" | "yann";
};

export function CsvUpload({ ownerOptions, defaultOwner }: Props) {
  const t = useTranslations("Connections");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CsvUploadResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [owner, setOwner] = useState<"joint" | "camila" | "yann">(defaultOwner);
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    fd.set("owner", owner);
    startTransition(async () => {
      const r = await uploadIngCsv(fd);
      setResult(r);
      if (r.ok) form.reset();
      setFileName(null);
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="csv-file" className="text-sm">
            {t("file")}
          </Label>
          <CsvHelp />
        </div>
        <label
          htmlFor="csv-file"
          className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border/80 bg-card/40 px-4 py-4 text-sm transition-colors hover:bg-card/70"
        >
          <FileSpreadsheet className="size-5 text-muted-foreground" />
          <span className="flex-1 truncate text-foreground">
            {fileName ?? t("filePlaceholder")}
          </span>
          {fileName ? (
            <span className="text-xs text-primary">{t("ready")}</span>
          ) : null}
        </label>
        <Input
          id="csv-file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="hidden"
          onChange={(e) => setFileName(e.currentTarget.files?.[0]?.name ?? null)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="csv-owner" className="text-sm">
          {t("scope")}
        </Label>
        <Select value={owner} onValueChange={(v) => setOwner(v as typeof owner)}>
          <SelectTrigger id="csv-owner">
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

      <div className="flex flex-col gap-2">
        <Label htmlFor="csv-nickname" className="text-sm">
          {t("nickname")}{" "}
          <span className="text-xs text-muted-foreground">
            ({t("optional")})
          </span>
        </Label>
        <Input
          id="csv-nickname"
          name="nickname"
          type="text"
          placeholder={t("nicknamePlaceholder")}
        />
      </div>

      <Button type="submit" disabled={pending} size="lg">
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Upload className="size-4" />
        )}
        {t("upload")}
      </Button>

      {result && !result.ok ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {result.error}
        </p>
      ) : null}

      {result?.ok ? (
        <div className="rounded-md border border-border/60 bg-card/50 px-4 py-3 text-sm">
          <p className="font-medium">{t("doneTitle")}</p>
          <p className="num mt-1 text-muted-foreground">
            {t("doneStats", {
              inserted: result.inserted,
              duplicates: result.duplicates,
              autoMatched: result.autoMatched,
              total: result.total,
            })}
          </p>
          {result.warnings.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
