"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Check, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Card } from "@/components/ui/card.tsx";
import { trpc } from "@/lib/trpc/client.ts";

export function PaydaySetting({ initialDay }: { initialDay: number }) {
  const t = useTranslations("Settings");
  const [day, setDay] = useState(String(initialDay));
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const setPayday = trpc.settings.setPaydayDay.useMutation({
    onSuccess: () => {
      setSavedAt(Date.now());
      utils.settings.get.invalidate();
      utils.today.get.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const dirty = Number.parseInt(day, 10) !== initialDay;

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const n = Number.parseInt(day, 10);
    if (!Number.isInteger(n) || n < 1 || n > 28) {
      setError(t("paydayInvalid"));
      return;
    }
    setPayday.mutate({ day: n });
  }

  return (
    <Card className="border-border/40 bg-card/60 p-5">
      <header className="flex items-center gap-2">
        <CalendarDays className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">{t("paydayTitle")}</h2>
      </header>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("paydayHelp", { day: initialDay })}
      </p>
      <form onSubmit={onSave} className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="payday-day" className="text-xs">
            {t("paydayLabel")}
          </Label>
          <Input
            id="payday-day"
            type="number"
            min={1}
            max={28}
            inputMode="numeric"
            value={day}
            onChange={(e) => setDay(e.currentTarget.value)}
            className="num mt-1"
          />
        </div>
        <Button
          type="submit"
          disabled={setPayday.isPending || !dirty}
          size="default"
        >
          {setPayday.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : savedAt && !dirty ? (
            <Check className="size-4" />
          ) : null}
          {savedAt && !dirty ? t("paydaySaved") : t("paydaySave")}
        </Button>
      </form>
      {error ? (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      ) : null}
    </Card>
  );
}
