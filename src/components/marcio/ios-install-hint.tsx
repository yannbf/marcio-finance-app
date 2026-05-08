"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X, Share } from "lucide-react";

const DISMISS_KEY = "marcio-ios-install-dismissed-v1";
const DISMISS_COOKIE = "marcio-install-dismissed";

function alreadyDismissed(): boolean {
  try {
    if (localStorage.getItem(DISMISS_KEY)) return true;
  } catch {
    /* private mode */
  }
  return document.cookie.includes(`${DISMISS_COOKIE}=1`);
}

function persistDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* private mode — fall back to cookie */
  }
  // Cookie is the belt to localStorage's suspenders — survives Safari
  // "Clear website data" partially and works even in private mode.
  document.cookie = `${DISMISS_COOKIE}=1; max-age=${60 * 60 * 24 * 365}; path=/; samesite=lax`;
}

/**
 * One-time hint shown to iOS Safari users who aren't already in
 * standalone mode (PWA). Self-dismissing — persists dismissal to both
 * localStorage and a cookie so it never reappears even if one storage
 * is wiped.
 */
export function IosInstallHint() {
  const t = useTranslations("Install");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (alreadyDismissed()) return;
    // Browsers under automation (Playwright, Puppeteer, Selenium) set
    // `navigator.webdriver` to true. Suppress the hint there so the
    // overlay doesn't intercept clicks on the buttons being tested.
    if (navigator.webdriver) return;

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
    persistDismissed();
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
