"use client";

import { useId, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Users, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { cn } from "@/lib/utils.ts";
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
  // A unique layoutId per MonthScopeBar instance so multiple bars on the
  // same page (shouldn't happen, but cheap insurance) don't fight over
  // the shared "active pill" thumb animation.
  const thumbId = useId();
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
        <div
          className="relative flex items-center gap-0.5 rounded-full border border-border/60 bg-card/50 p-0.5 text-xs"
          role="radiogroup"
          aria-label={t("Scope.joint")}
        >
          <ScopePill
            active={scope === "joint"}
            label={t("Scope.joint")}
            onClick={() => navigate({ ...anchor, scope: "joint" })}
            icon={<Users className="size-3.5" />}
            thumbId={thumbId}
          />
          {meScope ? (
            <ScopePill
              active={scope === meScope}
              label={t("Scope.me")}
              onClick={() => navigate({ ...anchor, scope: meScope })}
              icon={<User className="size-3.5" />}
              thumbId={thumbId}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ScopePill({
  active,
  label,
  onClick,
  icon,
  thumbId,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  thumbId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className="relative flex h-7 items-center gap-1 rounded-full px-2.5"
      title={label}
    >
      {/* Sliding background — Motion's layoutId animates the same DOM
          node between pills so the highlight glides instead of popping. */}
      {active ? (
        <motion.span
          layoutId={`scope-thumb-${thumbId}`}
          className="absolute inset-0 -z-0 rounded-full bg-primary"
          transition={{ type: "spring", stiffness: 500, damping: 38 }}
          aria-hidden
        />
      ) : null}
      <span
        className={cn(
          "relative z-10 flex items-center gap-1 transition-colors duration-150",
          active
            ? "text-primary-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {icon}
        <span className="uppercase tracking-[0.14em]">{label}</span>
      </span>
    </button>
  );
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
