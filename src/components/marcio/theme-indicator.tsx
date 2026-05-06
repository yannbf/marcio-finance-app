"use client";

import { useTranslations } from "next-intl";
import { Moon } from "lucide-react";

export function ThemeIndicator() {
  const t = useTranslations("Settings.inline");
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{t("themeTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("themeHint")}</p>
      </div>
      <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
        <Moon className="size-3.5" />
        {t("themeDark")}
      </div>
    </div>
  );
}
