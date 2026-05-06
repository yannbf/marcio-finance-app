"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation.ts";
import { routing, type Locale } from "@/i18n/routing.ts";

const LABELS: Record<Locale, string> = {
  "pt-BR": "PT",
  en: "EN",
};

export function LanguageSwitch({ current }: { current: Locale }) {
  const t = useTranslations("Settings.inline");
  const pathname = usePathname();

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{t("languageTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("languageHint")}</p>
      </div>
      <div className="flex gap-1 rounded-full border border-border/60 bg-card/50 p-1 text-xs">
        {routing.locales.map((l) => (
          <Link
            key={l}
            href={pathname}
            locale={l}
            className={`min-w-10 rounded-full px-3 py-1 text-center font-semibold uppercase tracking-[0.14em] transition-colors ${
              l === current
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-current={l === current ? "true" : undefined}
          >
            {LABELS[l]}
          </Link>
        ))}
      </div>
    </div>
  );
}
