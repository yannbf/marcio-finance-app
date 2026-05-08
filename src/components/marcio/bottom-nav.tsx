"use client";

import { Home, ListChecks, Activity, PiggyBank, Settings as Cog } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation.ts";
import { trpc } from "@/lib/trpc/client.ts";

type TabKey = "today" | "month" | "activity" | "buckets" | "settings";

const TABS: ReadonlyArray<{
  href: "/" | "/month" | "/activity" | "/buckets" | "/settings";
  icon: typeof Home;
  key: TabKey;
}> = [
  { href: "/", icon: Home, key: "today" },
  { href: "/month", icon: ListChecks, key: "month" },
  { href: "/activity", icon: Activity, key: "activity" },
  { href: "/buckets", icon: PiggyBank, key: "buckets" },
  { href: "/settings", icon: Cog, key: "settings" },
];

export function BottomNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const sp = useSearchParams();
  const utils = trpc.useUtils();
  if (pathname === "/sign-in" || pathname.startsWith("/sign-in/")) return null;
  // Hide the bottom nav on the Look Back full-screen takeover so the
  // sticky footer indicator and "Done" affordance own the chrome.
  if (pathname === "/activity/look-back") return null;
  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  // Carry the active scope and anchor straight from the URL into
  // every nav link's href. Once the user toggles scope anywhere, the
  // URL gets `?scope=…` and every other tab's link picks it up too,
  // so the next-tab page reads the value directly (no cookie race).
  //
  // We read ONLY the URL here, not the cookie, so the href the
  // server renders is byte-identical to what the client renders.
  // The cookie remains the "fresh visit, no ?scope" fallback —
  // handled by each page's server component via readScopeCookie().
  const scopeFromUrl = sp.get("scope");
  const currentScope: "joint" | "yann" | "camila" =
    scopeFromUrl === "yann" ||
    scopeFromUrl === "camila" ||
    scopeFromUrl === "joint"
      ? scopeFromUrl
      : "joint";
  const currentAnchor = sp.get("anchor");
  function buildQuery(): string {
    const qs = new URLSearchParams();
    if (currentAnchor) qs.set("anchor", currentAnchor);
    if (scopeFromUrl) qs.set("scope", scopeFromUrl);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }

  // Warm the tRPC cache when the user signals intent to navigate. By
  // the time the click resolves the data is usually already in cache.
  function prefetch(key: TabKey) {
    const scope = currentScope;
    if (key === "today") void utils.today.get.prefetch({ scope });
    else if (key === "month") {
      void utils.month.get.prefetch({ scope });
    } else if (key === "activity")
      void utils.activity.get.prefetch({ scope });
    else if (key === "buckets") void utils.buckets.get.prefetch({ scope });
    else if (key === "settings") void utils.settings.get.prefetch();
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/85 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-md grid-cols-5 px-1">
        {TABS.map(({ href, icon: Icon, key }) => {
          const active = isActive(href);
          // Settings doesn't use scope — keep its href clean.
          const linkHref = (
            key === "settings" ? href : `${href}${buildQuery()}`
          ) as typeof href;
          return (
            <li key={key}>
              <Link
                href={linkHref}
                prefetch
                onPointerEnter={() => prefetch(key)}
                onTouchStart={() => prefetch(key)}
                className="flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-[0.14em] transition-colors"
                aria-current={active ? "page" : undefined}
              >
                <Icon
                  className={`size-5 ${active ? "text-primary" : "text-muted-foreground"}`}
                  strokeWidth={active ? 2.4 : 1.8}
                />
                <span
                  className={
                    active ? "text-foreground" : "text-muted-foreground"
                  }
                >
                  {t(key)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

