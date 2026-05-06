"use client";

import { Home, ListChecks, Inbox, PiggyBank, Plug } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation.ts";

const TABS = [
  { href: "/", icon: Home, key: "today" },
  { href: "/mes", icon: ListChecks, key: "month" },
  { href: "/inbox", icon: Inbox, key: "inbox" } as const,
  { href: "/buckets", icon: PiggyBank, key: "buckets" },
  { href: "/connections", icon: Plug, key: "connections" },
] as const;

export function BottomNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/85 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-md grid-cols-5 px-1">
        {TABS.map(({ href, icon: Icon, key }) => {
          const active = pathname === href;
          return (
            <li key={key}>
              <Link
                href={href}
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
