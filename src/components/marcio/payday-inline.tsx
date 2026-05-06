"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Check } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { setPaydayDayAction } from "@/app/[locale]/settings/actions.ts";

/**
 * Compact inline payday control for the Settings index. Saves on blur or
 * Enter — no Save button, no card wrapper. Fits next to language and theme.
 */
export function PaydayInline({ initialDay }: { initialDay: number }) {
  const t = useTranslations("Settings.inline");
  const [day, setDay] = useState(String(initialDay));
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  function commit() {
    const n = Number.parseInt(day, 10);
    if (!Number.isInteger(n) || n < 1 || n > 28) {
      setStatus("error");
      setDay(String(initialDay));
      return;
    }
    if (n === initialDay) return;
    startTransition(async () => {
      const r = await setPaydayDayAction(n);
      setStatus(r.ok ? "saved" : "error");
      if (!r.ok) setDay(String(initialDay));
    });
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{t("paydayTitle")}</p>
        <p className="text-xs text-muted-foreground">
          {t("paydayHint", { day: initialDay })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {pending ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : status === "saved" ? (
          <Check className="size-3.5 text-primary" />
        ) : null}
        <Input
          type="number"
          min={1}
          max={28}
          inputMode="numeric"
          value={day}
          onChange={(e) => setDay(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          className="num h-9 w-16 text-center"
        />
      </div>
    </div>
  );
}
