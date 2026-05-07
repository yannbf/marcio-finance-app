"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { CounterpartyAvatar } from "./counterparty-avatar.tsx";
import { MonthScopeBar, parseSearch } from "./month-scope-bar.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { useMounted } from "@/lib/use-mounted.ts";
import { formatEUR } from "@/lib/format.ts";

export function TikkieScreen({
  locale,
  defaultAnchor,
  defaultScope = "joint",
}: {
  locale: string;
  defaultAnchor: { year: number; month: number };
  defaultScope?: "joint" | "yann" | "camila";
}) {
  const t = useTranslations("Tikkie");
  const sp = useSearchParams();
  const { anchor, scope } = parseSearch(sp, defaultAnchor, defaultScope);
  // window=all aggregates Tikkie totals across every payday-month we have
  // data for — useful with 90+ days of synced history where one month
  // undercounts who really owes whom.
  const windowMode = sp.get("window") === "all" ? "all" : "month";
  const mounted = useMounted();
  const query = trpc.tikkie.get.useQuery({ anchor, scope, window: windowMode });
  const data = mounted ? query.data : undefined;
  const isLoading = mounted ? query.isLoading : true;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-8 pt-8">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
        <MonthScopeBar defaultAnchor={defaultAnchor} defaultScope={defaultScope} />
        <div className="-mt-2 flex gap-1 self-start rounded-full border border-border/60 bg-card/50 p-1 text-[11px]">
          <WindowPill href={makeWindowHref(sp, "month")} active={windowMode === "month"}>
            {t("windowMonth")}
          </WindowPill>
          <WindowPill href={makeWindowHref(sp, "all")} active={windowMode === "all"}>
            {t("windowAll")}
          </WindowPill>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border/40 bg-card/60 p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("paid")}
          </p>
          {isLoading ? (
            <Skeleton className="mt-1 h-5 w-20" />
          ) : (
            <p className="num mt-1 text-base font-semibold tracking-tight">
              {formatEUR((data?.totals.paid ?? 0) / 100, locale)}
            </p>
          )}
        </Card>
        <Card className="border-border/40 bg-card/60 p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("received")}
          </p>
          {isLoading ? (
            <Skeleton className="mt-1 h-5 w-20" />
          ) : (
            <p className="num mt-1 text-base font-semibold tracking-tight text-primary">
              {formatEUR((data?.totals.received ?? 0) / 100, locale)}
            </p>
          )}
        </Card>
      </div>

      {!data || data.byPerson.length === 0 ? (
        <Card className="border-border/40 bg-card/40 p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </Card>
      ) : (
        <Card className="border-border/40 bg-card/60 p-2">
          <ul className="divide-y divide-border/40">
            {data.byPerson.map((b) => (
              <li
                key={b.name}
                className="flex items-center gap-3 px-2 py-3"
              >
                <CounterpartyAvatar name={b.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{b.name}</p>
                  <p className="num text-xs text-muted-foreground">
                    {t("txCount", { n: b.txCount })}
                  </p>
                </div>
                <div className="text-right">
                  {b.paidCents > 0 ? (
                    <p className="num whitespace-nowrap text-sm font-semibold">
                      −{formatEUR(b.paidCents / 100, locale)}
                    </p>
                  ) : null}
                  {b.receivedCents > 0 ? (
                    <p className="num whitespace-nowrap text-sm font-semibold text-primary">
                      +{formatEUR(b.receivedCents / 100, locale)}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}

function WindowPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={`rounded-full px-3 py-1 transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </a>
  );
}

function makeWindowHref(
  sp: URLSearchParams,
  next: "month" | "all",
): string {
  const params = new URLSearchParams(sp.toString());
  if (next === "month") params.delete("window");
  else params.set("window", "all");
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
}
