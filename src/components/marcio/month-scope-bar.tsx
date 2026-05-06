"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { shiftAnchor } from "@/lib/payday.ts";
import { trpc } from "@/lib/trpc/client.ts";

const SCOPE_COOKIE = "marcio-month-scope";

type Scope = "joint" | "yann" | "camila";

/**
 * Sticky-ish bar with two controls: a month picker (← month →) and a
 * scope toggle (Joint / Me). State lives in URL (`?anchor=YYYY-MM&scope=…`)
 * so it's shareable and survives reloads. Pages read the URL via the
 * router queries and pass it into tRPC hooks.
 *
 * Anchor and scope both default to the current month / "joint" view.
 */
export function MonthScopeBar({
  defaultAnchor,
  showScope = true,
}: {
  defaultAnchor: { year: number; month: number };
  showScope?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const me = trpc.session.me.useQuery();

  const { anchor, scope } = useMemo(() => parseSearch(sp, defaultAnchor), [
    sp,
    defaultAnchor,
  ]);

  function navigate(next: { year: number; month: number; scope?: Scope }) {
    const qs = new URLSearchParams(sp.toString());
    qs.set("anchor", `${next.year}-${String(next.month).padStart(2, "0")}`);
    if (next.scope) {
      qs.set("scope", next.scope);
      // Persist user's last-chosen scope across pages.
      document.cookie = `${SCOPE_COOKIE}=${next.scope}; max-age=31536000; path=/; samesite=lax`;
    }
    // typedRoutes can't infer dynamic ?param values; cast is fine for
    // a same-page replace.
    router.replace(`${pathname}?${qs.toString()}` as never);
  }

  const meScope: Scope | undefined = me.data?.role;
  const localized = anchorLabel(anchor.year, anchor.month, "en");

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1 rounded-full border border-border/60 bg-card/50 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => navigate(shiftAnchor(anchor.year, anchor.month, -1))}
          className="grid size-7 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Previous month"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="px-1.5 text-xs uppercase tracking-[0.14em] text-foreground">
          {localized}
        </span>
        <button
          type="button"
          onClick={() => navigate(shiftAnchor(anchor.year, anchor.month, 1))}
          className="grid size-7 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Next month"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {showScope ? (
        <div className="flex gap-1 rounded-full border border-border/60 bg-card/50 p-1 text-xs">
          <button
            type="button"
            onClick={() =>
              navigate({ ...anchor, scope: "joint" })
            }
            className={pillClass(scope === "joint")}
            aria-current={scope === "joint" ? "true" : undefined}
          >
            {t("Scope.joint")}
          </button>
          {meScope ? (
            <button
              type="button"
              onClick={() =>
                navigate({ ...anchor, scope: meScope })
              }
              className={pillClass(scope !== "joint" && scope === meScope)}
              aria-current={scope === meScope ? "true" : undefined}
            >
              {t("Scope.me")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function pillClass(active: boolean): string {
  return [
    "px-3 py-1.5 rounded-full uppercase tracking-[0.14em] transition-colors",
    active
      ? "bg-primary text-primary-foreground"
      : "text-muted-foreground hover:text-foreground",
  ].join(" ");
}

function anchorLabel(year: number, month: number, locale: string): string {
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Parse `?anchor=YYYY-MM&scope=…` from the URL. Falls back to defaults.
 * Exported so screens can read the same URL state without re-mounting
 * the bar.
 */
export function parseSearch(
  sp: URLSearchParams,
  defaultAnchor: { year: number; month: number },
): {
  anchor: { year: number; month: number };
  scope: Scope;
} {
  const raw = sp.get("anchor");
  let anchor = defaultAnchor;
  if (raw) {
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      if (mo >= 1 && mo <= 12) anchor = { year: y, month: mo };
    }
  }
  const scopeRaw = sp.get("scope");
  const scope: Scope =
    scopeRaw === "yann" || scopeRaw === "camila" || scopeRaw === "joint"
      ? scopeRaw
      : "joint";
  return { anchor, scope };
}
