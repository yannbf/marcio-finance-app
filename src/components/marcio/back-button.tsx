"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRouter as useIntlRouter } from "@/i18n/navigation.ts";

/**
 * Browser-history-aware back. Falls back to a deterministic destination
 * when the user landed deep-linked (no history) so we never strand them
 * on a chevron that goes nowhere. The fallback is locale-aware via the
 * next-intl router so the path stays prefixed correctly.
 */
export function BackButton({
  fallbackHref,
  ariaLabel,
  className,
}: {
  fallbackHref: "/month" | "/activity" | "/" | "/inbox";
  ariaLabel: string;
  className?: string;
}) {
  const router = useRouter();
  const intl = useIntlRouter();

  function onClick() {
    // history.length includes the synthetic entry pushed on first load,
    // so anything > 1 means there's somewhere to go back to within the SPA.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    intl.replace(fallbackHref);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={
        className ??
        "-m-2 mt-0 rounded p-2 text-muted-foreground transition-colors hover:text-foreground"
      }
    >
      <ChevronLeft className="size-5" />
    </button>
  );
}
