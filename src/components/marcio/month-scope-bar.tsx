"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Users, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { cn } from "@/lib/utils.ts";
import { shiftAnchor } from "@/lib/payday.ts";
import { trpc } from "@/lib/trpc/client.ts";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";

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
  defaultScope = "joint",
  showScope = true,
}: {
  defaultAnchor: { year: number; month: number };
  defaultScope?: Scope;
  showScope?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const me = trpc.session.me.useQuery();
  const knownAnchors = trpc.month.knownAnchors.useQuery(undefined, {
    // Cheap query, but no need to refetch on focus while the user is just
    // toggling a picker — invalidated when an import lands.
    staleTime: 5 * 60_000,
  });
  const knownSet = useMemo(
    () =>
      new Set(
        (knownAnchors.data?.anchors ?? []).map(
          (a) => `${a.year}-${String(a.month).padStart(2, "0")}`,
        ),
      ),
    [knownAnchors.data],
  );

  const { anchor, scope } = useMemo(
    () => parseSearch(sp, defaultAnchor, defaultScope),
    [sp, defaultAnchor, defaultScope],
  );

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

  // Gate session-derived UI behind a mount flag so SSR + first client paint
  // match. The TanStack Query sessionStorage persister restores `me.data`
  // before first paint, which would otherwise render the "Me" pill on the
  // client but not on the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const meScope: Scope | undefined = mounted ? me.data?.role : undefined;
  // A unique layoutId per MonthScopeBar instance so multiple bars on the
  // same page (shouldn't happen, but cheap insurance) don't fight over
  // the shared "active pill" thumb animation.
  const thumbId = useId();
  const localized = anchorLabel(anchor.year, anchor.month, "en");

  // The page's `defaultAnchor` is "today's" payday-month, computed
  // server-side from current date + paydayDay. Cap navigation at one month
  // beyond that — the budget is anchored to a sheet that doesn't yet exist
  // for further-future months, and the planning UX assumes you're at most
  // a month ahead of payday.
  const max = useMemo(
    () => shiftAnchor(defaultAnchor.year, defaultAnchor.month, 1),
    [defaultAnchor],
  );
  const isAtMax = anchor.year === max.year && anchor.month === max.month;
  const isAfterMax =
    anchor.year > max.year ||
    (anchor.year === max.year && anchor.month > max.month);
  const nextDisabled = isAtMax || isAfterMax;

  const [pickerOpen, setPickerOpen] = useState(false);

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
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label="Pick month"
                className="px-1.5 text-xs uppercase tracking-[0.14em] text-foreground hover:text-primary"
              />
            }
          >
            {localized}
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3">
            <MonthGridPicker
              anchor={anchor}
              max={max}
              knownSet={knownSet}
              onPick={(picked) => {
                setPickerOpen(false);
                navigate(picked);
              }}
            />
          </PopoverContent>
        </Popover>
        <button
          type="button"
          onClick={() => {
            if (nextDisabled) return;
            navigate(shiftAnchor(anchor.year, anchor.month, 1));
          }}
          disabled={nextDisabled}
          className="grid size-7 place-items-center rounded-full text-muted-foreground enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Next month"
          aria-disabled={nextDisabled || undefined}
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
 * Year + 12-month grid for jumping back arbitrarily far without spamming
 * the chevron. Capped at `max` (one month past today's payday-month) so
 * the user never lands on a month that has no budget data.
 */
function MonthGridPicker({
  anchor,
  max,
  knownSet,
  onPick,
}: {
  anchor: { year: number; month: number };
  max: { year: number; month: number };
  /** Set of "YYYY-MM" anchors that have an imported sheet — months not
   *  in this set get rendered dim so the user understands navigating
   *  there will land on an empty page. */
  knownSet: Set<string>;
  onPick: (picked: { year: number; month: number }) => void;
}) {
  const [year, setYear] = useState(anchor.year);
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const date = new Date(year, i, 1);
        const label = new Intl.DateTimeFormat(undefined, {
          month: "short",
        }).format(date);
        const beyondMax =
          year > max.year || (year === max.year && m > max.month);
        const known = knownSet.has(
          `${year}-${String(m).padStart(2, "0")}`,
        );
        return { month: m, label, disabled: beyondMax, known };
      }),
    [year, max, knownSet],
  );
  const isCurrentYear = year === anchor.year;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setYear((y) => y - 1)}
          className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          aria-label="Previous year"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="num text-sm font-semibold tracking-tight">
          {year}
        </span>
        <button
          type="button"
          onClick={() => setYear((y) => y + 1)}
          disabled={year >= max.year}
          className="grid size-7 place-items-center rounded-full text-muted-foreground enabled:hover:bg-accent/40 enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Next year"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {months.map((m) => {
          const isActive = isCurrentYear && m.month === anchor.month;
          return (
            <button
              key={m.month}
              type="button"
              disabled={m.disabled}
              onClick={() => onPick({ year, month: m.month })}
              className={cn(
                "rounded-md px-2 py-2 text-xs uppercase tracking-[0.14em] transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : m.disabled
                    ? "cursor-not-allowed text-muted-foreground/40"
                    : !m.known
                      // Months with no imported sheet — clickable but dim
                      // so the user knows they'll land on an empty state.
                      ? "text-muted-foreground/50 hover:bg-accent/50 hover:text-foreground"
                      : "text-foreground hover:bg-accent/50",
              )}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Parse `?anchor=YYYY-MM&scope=…` from the URL. Falls back to defaults.
 * Exported so screens can read the same URL state without re-mounting
 * the bar.
 *
 * `defaultScope` lets a page pass in the user's last-chosen scope (read
 * server-side from the household cookie) so a fresh tab nav without
 * `?scope=` doesn't snap back to "joint".
 */
export function parseSearch(
  sp: URLSearchParams,
  defaultAnchor: { year: number; month: number },
  defaultScope: Scope = "joint",
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
      : defaultScope;
  return { anchor, scope };
}
