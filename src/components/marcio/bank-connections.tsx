"use client";

import { useTranslations, useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, Plug, RefreshCw, Unplug, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { trpc } from "@/lib/trpc/client.ts";

/**
 * Bank connections panel for /settings/banks. Lives next to the CSV uploader
 * so the user can choose either path. The CSV flow stays the source of truth
 * during the experimental phase — connections just augment it.
 */
export function BankConnections() {
  const t = useTranslations("Connections");
  const locale = useLocale();
  const search = useSearchParams();
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  // Stable timestamp captured at mount — used for "expires in N days" and
  // "synced X minutes ago" math. React 19's compiler flags `Date.now()` in
  // render as impure; capturing once with useState(() => …) is the fix.
  const [now] = useState(() => Date.now());

  const list = trpc.settings.connections.list.useQuery();
  const utils = trpc.useUtils();

  /** Last result of a manual refresh, keyed by connection id. */
  const [lastResult, setLastResult] = useState<
    Record<string, { inserted: number; matched: number; accountsSynced: number }>
  >({});

  const refresh = trpc.settings.connections.refresh.useMutation({
    onSuccess: (data) => {
      setLastResult((prev) => ({
        ...prev,
        [data.connectionId]: {
          inserted: data.inserted,
          matched: data.matched,
          accountsSynced: data.accountsSynced,
        },
      }));
    },
    onSettled: async () => {
      setRefreshingId(null);
      await utils.settings.connections.list.invalidate();
    },
  });

  const disconnect = trpc.settings.connections.disconnect.useMutation({
    onSettled: async () => {
      await utils.settings.connections.list.invalidate();
    },
  });

  // Surface ?bank_status / ?bank_error from the callback in a one-shot toast.
  const status = search.get("bank_status");
  const error = search.get("bank_error");
  useEffect(() => {
    if (!status && !error) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("bank_status");
    url.searchParams.delete("bank_error");
    window.history.replaceState(null, "", url.pathname + (url.search || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const banner =
    error
      ? { tone: "error" as const, text: t("connectError") }
      : status === "linked"
        ? { tone: "ok" as const, text: t("connectLinked") }
        : status?.startsWith("pending")
          ? { tone: "info" as const, text: t("connectPending") }
          : status === "expired"
            ? { tone: "warn" as const, text: t("connectExpired") }
            : null;

  return (
    <Card className="border-border/40 bg-card/60 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{t("connectionsTitle")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("connectionsHint")}
          </p>
        </div>
        <a
          href={`/api/banks/connect?locale=${encodeURIComponent(locale)}`}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 text-xs font-medium hover:bg-accent"
        >
          <Plug className="size-3.5" />
          {t("connectIng")}
        </a>
      </div>

      {banner ? (
        <div
          className={`mt-3 rounded-md border px-3 py-2 text-xs ${
            banner.tone === "error"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : banner.tone === "warn"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : banner.tone === "ok"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-border/60 bg-muted/40 text-muted-foreground"
          }`}
        >
          {banner.text}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        {list.isLoading ? (
          <p className="text-xs text-muted-foreground">{t("loading")}</p>
        ) : (list.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("noConnections")}
          </p>
        ) : (
          (list.data ?? []).map((c) => {
            // The persisted React Query cache (sessionStorage) restores Date
            // values as strings, so coerce defensively before doing math.
            const expiresAt = toDate(c.expiresAt);
            const lastSyncedAt = toDate(c.lastSyncedAt);
            const expDays = expiresAt
              ? Math.ceil((expiresAt.getTime() - now) / 86400_000)
              : null;
            return (
              <div
                key={c.id}
                className="rounded-md border border-border/40 bg-card/40 p-3 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.institutionId}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {statusLabel(c.status, t)}
                      {lastSyncedAt
                        ? ` · ${t("lastSynced", { when: relativeTime(lastSyncedAt, now, locale) })}`
                        : ""}
                      {expDays !== null
                        ? ` · ${
                            expDays > 0
                              ? t("expiresIn", { days: expDays })
                              : t("expiredAlready")
                          }`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {c.status === "linked" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={refreshingId === c.id}
                        onClick={() => {
                          setRefreshingId(c.id);
                          refresh.mutate({ connectionId: c.id });
                        }}
                      >
                        {refreshingId === c.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3.5" />
                        )}
                      </Button>
                    ) : null}
                    {c.status === "expired" || c.status === "error" ? (
                      <a
                        href={`/api/banks/connect?locale=${encodeURIComponent(locale)}`}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 bg-background px-2 text-[11px] font-medium hover:bg-accent"
                      >
                        {t("reconnect")}
                      </a>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (
                          window.confirm(t("disconnectConfirm"))
                        ) {
                          disconnect.mutate({ connectionId: c.id });
                        }
                      }}
                    >
                      <Unplug className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {c.lastError ? (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    <span className="break-words">{c.lastError}</span>
                  </p>
                ) : null}

                {lastResult[c.id] ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {lastResult[c.id].accountsSynced === 0
                      ? t("syncResultNoAccounts")
                      : lastResult[c.id].inserted > 0
                        ? t("syncResultNew", {
                            inserted: lastResult[c.id].inserted,
                            matched: lastResult[c.id].matched,
                            accounts: lastResult[c.id].accountsSynced,
                          })
                        : t("syncResultUpToDate", {
                            accounts: lastResult[c.id].accountsSynced,
                          })}
                  </p>
                ) : null}

                {c.accounts.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-0.5 pl-1">
                    {c.accounts.map((a) => (
                      <li
                        key={a.id}
                        className="num truncate text-[11px] text-muted-foreground"
                      >
                        · {a.nickname} {a.iban ? `(${a.iban})` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        {t("experimentalNote")}
      </p>
    </Card>
  );
}

function statusLabel(
  status: string,
  t: (k: string) => string,
): string {
  switch (status) {
    case "linked":
      return t("statusLinked");
    case "pending":
      return t("statusPending");
    case "expired":
      return t("statusExpired");
    case "revoked":
      return t("statusRevoked");
    case "error":
      return t("statusError");
    default:
      return status;
  }
}

/**
 * Coerce a Date | string | null | undefined to Date | null. The tRPC
 * superjson transformer delivers Dates correctly on the wire, but
 * TanStack Query's sessionStorage persister rehydrates them as ISO
 * strings. Without this, any code that calls Date methods on a restored
 * cache value crashes with "x.getTime is not a function".
 */
function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function relativeTime(d: Date, now: number, locale: string): string {
  const diffMs = d.getTime() - now;
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const min = Math.round(diffMs / 60000);
  if (Math.abs(min) < 60) return fmt.format(min, "minute");
  const hr = Math.round(min / 60);
  if (Math.abs(hr) < 24) return fmt.format(hr, "hour");
  const day = Math.round(hr / 24);
  return fmt.format(day, "day");
}
