"use client";

import { useEffect, useState } from "react";

/**
 * Returns false on the server and on the first client render, then true
 * after the component mounts. Use this to gate UI that depends on
 * client-only state (sessionStorage-restored React Query cache, locale-
 * sensitive formatting, navigator.* probes, etc.) so the SSR markup and
 * the first client paint stay identical and React doesn't throw a
 * hydration mismatch.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
