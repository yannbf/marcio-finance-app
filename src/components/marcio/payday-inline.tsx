"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Check } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { trpc } from "@/lib/trpc/client.ts";

/**
 * Compact inline payday control for the Settings index. Saves on blur or
 * Enter — no Save button, no card wrapper. Fits next to language and theme.
 */
export function PaydayInline({ initialDay }: { initialDay: number }) {
  const t = useTranslations("Settings.inline");
  const [day, setDay] = useState(String(initialDay));
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const utils = trpc.useUtils();
  const setPayday = trpc.settings.setPaydayDay.useMutation({
    onSuccess: async () => {
      setStatus("saved");
      // Days-until-payday + month anchors live downstream of paydayDay,
      // so refresh the screens that derive from it.
      await Promise.all([
        utils.settings.get.invalidate(),
        utils.today.get.invalidate(),
        utils.month.get.invalidate(),
        utils.activity.get.invalidate(),
        utils.insights.get.invalidate(),
        utils.buckets.get.invalidate(),
        utils.tikkie.get.invalidate(),
      ]);
    },
    onError: () => {
      setStatus("error");
      setDay(String(initialDay));
    },
  });

  function commit() {
    const n = Number.parseInt(day, 10);
    if (!Number.isInteger(n) || n < 1 || n > 28) {
      setStatus("error");
      setDay(String(initialDay));
      return;
    }
    if (n === initialDay) return;
    setPayday.mutate({ day: n });
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
        {setPayday.isPending ? (
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
