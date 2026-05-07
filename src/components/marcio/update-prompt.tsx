"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, X } from "lucide-react";

/**
 * "New version available" banner for PWA users.
 *
 * Marcio doesn't ship a service worker, so iOS PWA installs hold onto the
 * loaded JS bundle until you explicitly reload — pushed deploys can sit
 * unnoticed for days. This component:
 *
 *   1. Receives the SHA the page was rendered against (from the server-side
 *      layout, captured at first paint).
 *   2. Polls /api/version on a focus / visibility / interval schedule.
 *   3. When the live SHA differs from the captured one, surfaces a small
 *      banner with a "Refresh" CTA.
 *
 * The banner is dismissable for the current session — once the user taps X
 * we don't nag again until the next page load. Tapping "Refresh" does a
 * hard reload with a cache-bust query param so iOS WebView fetches the new
 * HTML shell instead of replaying its cached copy.
 */
export function UpdatePrompt({ buildVersion }: { buildVersion: string }) {
  const t = useTranslations("UpdatePrompt");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't poll in dev — the API returns "dev" forever, so the comparison
    // is meaningless and would just spam the network tab.
    if (buildVersion === "dev") return;

    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version?: string };
        if (cancelled) return;
        if (version && version !== buildVersion) {
          setUpdateAvailable(true);
        }
      } catch {
        // Network errors during checks are silent — we'll try again next tick.
      }
    }

    // Initial probe after a short delay so we don't pile work on first paint.
    const initial = setTimeout(check, 30_000);
    // Periodic re-check while the app is open.
    const interval = setInterval(check, 5 * 60_000);
    // Also re-check whenever the user comes back to the tab — covers the
    // common iOS case of "open the PWA, it was backgrounded for a day".
    const onFocus = () => void check();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [buildVersion]);

  if (!updateAvailable || dismissed) return null;

  function refresh() {
    // Hard reload with a cache-bust query so iOS WebView refetches the HTML
    // shell. Asset filenames are hashed by Next, so JS chunks pick up new
    // versions automatically once the shell points at them.
    const url = new URL(window.location.href);
    url.searchParams.set("_v", String(Date.now()));
    window.location.replace(url.toString());
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 z-50 flex justify-center"
      style={{
        bottom: "calc(5rem + env(safe-area-inset-bottom) + 0.5rem)",
      }}
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-border/60 bg-card/95 p-3 pl-4 shadow-lg backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("body")}</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          <RefreshCw className="size-3.5" />
          {t("refresh")}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("dismiss")}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
