"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X, Share } from "lucide-react";

const DISMISS_KEY = "marcio-ios-install-dismissed-v1";

/**
 * One-time hint shown to iOS Safari users who aren't already in
 * standalone mode (PWA). Self-dismissing; remembers dismissal in
 * localStorage so it never reappears.
 */
export function IosInstallHint() {
  const t = useTranslations("Install");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    const ua = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/.test(ua);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // Older iOS — non-standard prop.
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isIos && !isStandalone) setShow(true);
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode — ignore */
    }
  }

  if (!show) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
        <Share className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="flex-1 text-xs leading-snug">
          <p className="font-medium">{t("title")}</p>
          <p className="mt-0.5 text-muted-foreground">{t("step")}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("dismiss")}
          className="-m-1 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent/40"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
