"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Moon, Sun, MonitorSmartphone } from "lucide-react";

type Mode = "dark" | "light" | "system";

const STORAGE_KEY = "marcio-theme";

function applyMode(mode: Mode) {
  const dark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function ThemeToggle() {
  const t = useTranslations("Theme");
  const tInline = useTranslations("Settings.inline");
  const [mode, setMode] = useState<Mode>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = (localStorage.getItem(STORAGE_KEY) as Mode | null) ?? "dark";
    setMode(saved);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (mode === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyMode("system");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [mode, mounted]);

  function pick(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    applyMode(next);
  }

  const opts: { value: Mode; icon: React.ReactNode; label: string }[] = [
    { value: "light", icon: <Sun className="size-3.5" />, label: t("light") },
    { value: "dark", icon: <Moon className="size-3.5" />, label: t("dark") },
    {
      value: "system",
      icon: <MonitorSmartphone className="size-3.5" />,
      label: t("system"),
    },
  ];

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{tInline("themeTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("title")}</p>
      </div>
      <div
        className="flex gap-1 rounded-full border border-border/60 bg-card/50 p-1 text-xs"
        role="radiogroup"
        aria-label={t("title")}
      >
        {opts.map((opt) => {
          const active = mode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={opt.label}
              onClick={() => pick(opt.value)}
              className={[
                "flex h-7 items-center gap-1 rounded-full px-2.5 transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {opt.icon}
              <span className="uppercase tracking-[0.14em]">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
