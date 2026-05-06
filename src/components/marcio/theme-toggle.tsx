"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Moon, Sun, MonitorSmartphone } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";

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

const ICONS: Record<Mode, React.ReactNode> = {
  dark: <Moon className="size-3.5" />,
  light: <Sun className="size-3.5" />,
  system: <MonitorSmartphone className="size-3.5" />,
};

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

  const opts: { value: Mode; label: string }[] = [
    { value: "light", label: t("light") },
    { value: "dark", label: t("dark") },
    { value: "system", label: t("system") },
  ];

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{tInline("themeTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("title")}</p>
      </div>
      <Select
        value={mode}
        onValueChange={(v) => pick(v as Mode)}
      >
        <SelectTrigger size="sm" aria-label={t("title")}>
          <SelectValue>
            <span className="flex items-center gap-1.5">
              {ICONS[mode]}
              {opts.find((o) => o.value === mode)?.label}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {opts.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {ICONS[opt.value]}
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
