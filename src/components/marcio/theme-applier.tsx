"use client";

import { useLayoutEffect } from "react";

/**
 * Re-applies the saved theme to <html> after every render of the
 * locale layout. Without this, switching locale via next-intl's Link
 * causes React to reconcile the <html> className back to the static
 * server value — wiping the .dark class the pre-paint script added.
 *
 * useLayoutEffect runs synchronously after render but before paint,
 * so the user never sees a flash on locale switch.
 */
export function ThemeApplier() {
  useLayoutEffect(() => {
    try {
      const t = localStorage.getItem("marcio-theme") ?? "dark";
      const dark =
        t === "dark" ||
        (t === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    } catch {
      document.documentElement.classList.add("dark");
    }
  });

  return null;
}
