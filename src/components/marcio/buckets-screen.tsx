"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, Plus } from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Link } from "@/i18n/navigation.ts";
import { MonthScopeBar, parseSearch } from "./month-scope-bar.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { useMounted } from "@/lib/use-mounted.ts";
import { formatEUR } from "@/lib/format.ts";

export function BucketsScreen({
  locale,
  defaultAnchor,
  defaultScope = "joint",
  defaultMeRole = null,
}: {
  locale: string;
  defaultAnchor: { year: number; month: number };
  defaultScope?: "joint" | "yann" | "camila";
  defaultMeRole?: "yann" | "camila" | null;
}) {
  const t = useTranslations("Buckets");
  const sp = useSearchParams();
  const { anchor, scope } = parseSearch(sp, defaultAnchor, defaultScope);
  const mounted = useMounted();
  const query = trpc.buckets.get.useQuery({ anchor, scope });
  const data = mounted ? query.data : undefined;
  const isLoading = mounted ? query.isLoading : true;

  const groups = useMemo(() => {
    if (!data) return { groups: [], orphans: [], totalPlanned: 0, totalActual: 0 };
    const itemsByAccount = new Map<string, typeof data.items>();
    const orphans: typeof data.items = [];
    for (const it of data.items) {
      if (it.savingsAccountId) {
        const arr = itemsByAccount.get(it.savingsAccountId) ?? [];
        arr.push(it);
        itemsByAccount.set(it.savingsAccountId, arr);
      } else {
        orphans.push(it);
      }
    }
    const groups = data.accounts.map((a) => {
      const list = itemsByAccount.get(a.id) ?? [];
      const planned = list.reduce(
        (s, i) => s + Math.abs(i.plannedMonthlyCents),
        0,
      );
      const actual = list.reduce(
        (s, i) => s + Math.abs(i.actualCents),
        0,
      );
      return { account: a, items: list, planned, actual };
    });
    const totalPlanned = groups.reduce((s, g) => s + g.planned, 0);
    const totalActual = groups.reduce((s, g) => s + g.actual, 0);
    return { groups, orphans, totalPlanned, totalActual };
  }, [data]);

  const ratio =
    groups.totalPlanned > 0 ? groups.totalActual / groups.totalPlanned : 0;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-8 pt-8">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        <MonthScopeBar defaultAnchor={defaultAnchor} defaultScope={defaultScope} defaultMeRole={defaultMeRole} />
      </header>

      {isLoading ? (
        <>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </>
      ) : !data || data.accounts.length === 0 ? (
        <Card className="flex flex-col items-start gap-3 border-border/40 bg-card/40 p-5 text-sm">
          <p className="text-muted-foreground">{t("noAccounts")}</p>
          <Link
            href="/settings/savings"
            className="inline-flex items-center gap-1.5 text-primary hover:underline"
            prefetch
          >
            <Plus className="size-4" />
            {t("addOne")}
          </Link>
        </Card>
      ) : (
        <>
          <Card className="border-border/40 bg-card/60 p-5">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {t("monthlySummary")}
            </p>
            <p className="num mt-1 text-2xl font-semibold tracking-tight">
              {formatEUR(groups.totalActual / 100, locale)}
              <span className="text-sm font-normal text-muted-foreground">
                {" / "}
                {formatEUR(groups.totalPlanned / 100, locale)}
              </span>
            </p>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, ratio * 100).toFixed(2)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("monthlyHint", { count: data.accounts.length })}
            </p>
          </Card>

          {groups.groups.map((g) => (
            <BucketCard
              key={g.account.id}
              account={{
                id: g.account.id,
                nickname: g.account.nickname,
                ref: g.account.ref,
                owner: g.account.owner,
              }}
              items={g.items.map((it) => ({
                id: it.id,
                name: it.name,
                plannedCents: it.plannedMonthlyCents,
                actualCents: Math.abs(it.actualCents),
                sazonalKind: it.sazonalKind as "O" | "L" | null,
              }))}
              plannedCents={g.planned}
              actualCents={g.actual}
              ytdActualCents={g.account.ytdActualCents}
              ytdYearlyTargetCents={g.account.yearlyTargetCents}
              locale={locale}
              t={t}
            />
          ))}
        </>
      )}

      {groups.orphans.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("untagged")}
          </h2>
          <p className="-mt-1 text-xs text-muted-foreground">
            {t("untaggedHint")}
          </p>
          <Card className="border-border/40 bg-card/40 p-1">
            <ul className="divide-y divide-border/40">
              {groups.orphans.map((it) => {
                const planned = Math.abs(it.plannedMonthlyCents);
                const actual = Math.abs(it.actualCents);
                return (
                  <li key={it.id}>
                    <Link
                      href={`/month/${it.id}` as `/month/${string}`}
                      className="flex items-center gap-3 rounded px-3 py-2.5 transition-colors hover:bg-card/40"
                      prefetch
                    >
                      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                        <AlertCircle className="size-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {it.name}
                        </p>
                        <p className="num text-xs text-muted-foreground">
                          {formatEUR(actual / 100, locale)} /{" "}
                          {formatEUR(planned / 100, locale)}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      ) : null}
    </main>
  );
}

/* -------------------------------------------------------------------------- */

type BucketCardProps = {
  account: { id: string; nickname: string; ref: string; owner: string };
  items: {
    id: string;
    name: string;
    plannedCents: number;
    actualCents: number;
    sazonalKind: "O" | "L" | null;
  }[];
  plannedCents: number;
  actualCents: number;
  /** YTD total contributions to this account in the current calendar year. */
  ytdActualCents: number;
  /** Yearly target = sum of SAZONAIS plannedCents linked to this account. */
  ytdYearlyTargetCents: number;
  locale: string;
  t: (
    k:
      | "noLinkedItems"
      | "linkItems"
      | "yearEstimate"
      | "missed"
      | "ytdProgress",
  ) => string;
};

function BucketCard({
  account,
  items,
  plannedCents,
  actualCents,
  ytdActualCents,
  ytdYearlyTargetCents,
  locale,
  t,
}: BucketCardProps) {
  const ratio = plannedCents > 0 ? actualCents / plannedCents : 0;
  const done = ratio >= 0.95;
  const ytdRatio =
    ytdYearlyTargetCents > 0 ? ytdActualCents / ytdYearlyTargetCents : 0;

  return (
    <Card className="border-border/40 bg-card/60 p-4">
      <header className="flex items-center gap-3">
        <div
          className={`grid size-9 shrink-0 place-items-center rounded-full ${
            done
              ? "bg-primary/15 text-primary"
              : plannedCents > 0
                ? "bg-destructive/15 text-destructive"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {done ? <Check className="size-4" strokeWidth={2.4} /> : null}
          {!done && plannedCents > 0 ? (
            <AlertCircle className="size-4" />
          ) : null}
          {plannedCents === 0 ? <Plus className="size-3.5" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.nickname}</p>
          <p className="num truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {account.ref} · {account.owner}
          </p>
        </div>
        <div className="text-right">
          <p className="num text-sm font-semibold">
            {formatEUR(actualCents / 100, locale)}
          </p>
          <p className="num text-[10px] text-muted-foreground">
            / {formatEUR(plannedCents / 100, locale)}
          </p>
        </div>
      </header>

      {plannedCents > 0 ? (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.min(100, ratio * 100).toFixed(2)}%` }}
          />
        </div>
      ) : null}

      {ytdYearlyTargetCents > 0 ? (
        <div className="mt-3 flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <span>
              {t("ytdProgress")}
            </span>
            <span className="num">
              {formatEUR(ytdActualCents / 100, locale)}
              {" / "}
              {formatEUR(ytdYearlyTargetCents / 100, locale)}
              {" · "}
              {Math.round(ytdRatio * 100)}%
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-amber-500/70"
              style={{
                width: `${Math.min(100, ytdRatio * 100).toFixed(2)}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <Link
          href="/settings/savings"
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          prefetch
        >
          <Plus className="size-3" />
          {t("linkItems")}
        </Link>
      ) : (
        <ul className="mt-3 divide-y divide-border/40">
          {items.map((it) => (
            <li key={it.id}>
              <Link
                href={`/month/${it.id}` as `/month/${string}`}
                className="flex items-center gap-2 px-1 py-2 transition-colors hover:opacity-80"
                prefetch
              >
                {it.sazonalKind ? (
                  <Badge
                    variant={it.sazonalKind === "O" ? "default" : "secondary"}
                    className="px-1.5 py-0 text-[10px]"
                  >
                    {it.sazonalKind}
                  </Badge>
                ) : null}
                <span className="flex-1 truncate text-sm">{it.name}</span>
                <span className="num text-xs text-muted-foreground">
                  {formatEUR(Math.abs(it.plannedCents) / 100, locale)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

