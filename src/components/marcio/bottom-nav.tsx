"use client";

import { Home, ListChecks, Activity, PiggyBank, Settings as Cog } from "lucide-react";
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
  const utils = trpc.useUtils();
  // Hide the nav on auth flows — they're full-screen, no in-app navigation.
  if (pathname === "/sign-in" || pathname.startsWith("/sign-in/")) return null;
  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  // Warm the tRPC cache when the user signals intent to navigate. By the
  // time the click resolves, the data is usually already loaded. We pass
  // the cookie-stored scope so the prefetch lines up with what the
  // server-rendered page will read on arrival.
  function prefetch(key: TabKey) {
    const scope = readScopeCookieClient();
    if (key === "today") void utils.today.get.prefetch({ scope });
    else if (key === "month") {
      void utils.month.get.prefetch({ scope });
    } else if (key === "activity")
      void utils.activity.get.prefetch({ scope });
    else if (key === "buckets") void utils.buckets.get.prefetch({ scope });
    else if (key === "settings") void utils.settings.get.prefetch();
  }

  function readScopeCookieClient(): "joint" | "yann" | "camila" {
    if (typeof document === "undefined") return "joint";
    const m = document.cookie.match(/(?:^|; )marcio-month-scope=([^;]+)/);
    const v = m ? decodeURIComponent(m[1]) : null;
    return v === "yann" || v === "camila" ? v : "joint";
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/85 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-md grid-cols-5 px-1">
        {TABS.map(({ href, icon: Icon, key }) => {
          const active = isActive(href);
          return (
            <li key={key}>
              <Link
                href={href}
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
