"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Footprints } from "lucide-react";
import { Card } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Link } from "@/i18n/navigation.ts";
import { ActivityRow } from "./activity-row.tsx";
import { CounterpartyAvatar } from "./counterparty-avatar.tsx";
import { MonthScopeBar, parseSearch } from "./month-scope-bar.tsx";
import {
  OverBudgetPill,
  SpendProgress,
  progressTone,
} from "./spend-progress.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { useMounted } from "@/lib/use-mounted.ts";
import { formatEUR, formatEURPrecise, formatShortDate } from "@/lib/format.ts";
import { fingerprintCounterparty } from "@/lib/matching/fingerprint.ts";
import { isTikkie } from "@/lib/tikkie.ts";
import {
  isRoundUpTx,
  resolveDisplayCounterparty,
} from "@/lib/display-counterparty.ts";
import { SECTION_ORDER, SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app.ts";

type ActivityView = "date" | "amount";
type ActivityData = inferRouterOutputs<AppRouter>["activity"]["get"];
type Txn = ActivityData["txns"][number];
type OptionsAll = ActivityData["optionsAll"];

export function ActivityScreen({
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
  const t = useTranslations("Activity");
  const tSections = useTranslations("Sections");
  const tToday = useTranslations("Today");
  const sp = useSearchParams();
  const { anchor, scope } = parseSearch(sp, defaultAnchor, defaultScope);
  // See useMounted note in today-screen.tsx — guards against the persister
  // restoring data before hydration and tripping a hydration mismatch.
  const mounted = useMounted();
  const query = trpc.activity.get.useQuery({ anchor, scope });
  const data = mounted ? query.data : undefined;
  const isLoading = mounted ? query.isLoading : true;

  // The active view (date timeline vs. merchant grouping) lives in
  // the URL so it survives reloads and can be shared. Default is the
  // chronological "by date" view that the user sees first.
  const viewRaw = sp.get("view");
  const view: ActivityView = viewRaw === "amount" ? "amount" : "date";

  const sectionLabels = useMemo(
    () =>
      SECTION_ORDER.reduce(
        (acc, s) => {
          acc[s] = tSections(SECTION_TR_KEY[s] as never);
          return acc;
        },
        {} as Record<Section, string>,
      ),
    [tSections],
  );

  const dateGroups = useMemo(() => {
    if (!data || view !== "date") return [];
    const out: { date: string; rows: Txn[] }[] = [];
    // Hide round-ups in the chronological timeline — €0.30 sweeps would
    // dominate the list and bury real transactions. They're still
    // tallied separately in the by-amount view's "CC investments round
    // up and save" bucket and on Today's headline round-up chip.
    for (const r of data.txns) {
      if (isRoundUpTx(r)) continue;
      const key = formatGroupDate(new Date(r.bookingDate), locale);
      const last = out[out.length - 1];
      if (last && last.date === key) last.rows.push(r);
      else out.push({ date: key, rows: [r] });
    }
    return out;
  }, [data, locale, view]);

  // Merchant groups: collapse same-counterparty rows (after stripping
  // city tails / terminal IDs / trailing digits) into one bucket so
  // "AH AMSTERDAM" and "AH UTRECHT" land together. Sort by the bigger
  // of total spend / total received so the heaviest impact bubbles to
  // the top.
  const merchantGroups = useMemo(() => {
    if (!data || view !== "amount") return [];
    type Bucket = {
      key: string;
      displayName: string;
      avatarHint: "ing" | "piggy" | null;
      txns: Txn[];
      paidCents: number;
      receivedCents: number;
    };
    const groups = new Map<string, Bucket>();
    for (const tx of data.txns) {
      const cp = (tx.counterparty ?? "").trim() || "—";
      // 1. Synthetic groups (round-ups, bank fees, named savings refs)
      //    take precedence so e.g. round-ups never collapse into the
      //    real "CC investments" bucket and bank fees stay separate.
      const display = resolveDisplayCounterparty({
        counterparty: tx.counterparty,
        description: tx.description,
      });
      // 2. Tikkies surface in two ING shapes: "AAB INZ TIKKIE" (topic +
      //    sender baked into description) and "<Name> via Tikkie".
      //    Collapse them into one canonical Tikkie bucket.
      const tikkieRow =
        !display.groupKey &&
        isTikkie({
          counterparty: tx.counterparty,
          description: tx.description,
        });
      const key =
        display.groupKey ??
        (tikkieRow
          ? "tikkie"
          : fingerprintCounterparty(cp) || cp.toLowerCase());
      const displayName = display.groupKey
        ? display.name
        : tikkieRow
          ? "Tikkie"
          : cp;
      const bucket = groups.get(key) ?? {
        key,
        displayName,
        avatarHint: display.avatar,
        txns: [],
        paidCents: 0,
        receivedCents: 0,
      };
      bucket.txns.push(tx);
      if (tx.amountCents < 0) bucket.paidCents += -tx.amountCents;
      else bucket.receivedCents += tx.amountCents;
      groups.set(key, bucket);
    }
    return [...groups.values()].sort((a, b) => {
      const aMax = Math.max(a.paidCents, a.receivedCents);
      const bMax = Math.max(b.paidCents, b.receivedCents);
      return bMax - aMax;
    });
  }, [data, view]);

  // Headline tone: spent / planned ratio drives the same tone-coloured
  // ring + over-budget pill the Today card uses.
  const spentCents = data?.monthSpend ?? 0;
  const plannedCents = data?.plannedOutflowCents ?? 0;
  const balanceCents = data?.balanceCents ?? 0;
  const balanceSource = data?.balanceSource ?? "inferred";
  const balanceAsOf = data?.balanceAsOf ?? null;
  const balanceHint =
    balanceSource === "synced" && balanceAsOf
      ? tToday("balanceHintSynced", {
          at: formatShortDate(balanceAsOf, locale),
        })
      : balanceSource === "mixed"
        ? tToday("balanceHintMixed")
        : tToday("balanceHintInferred");
  const tone = progressTone(spentCents, plannedCents);
  const overByCents =
    plannedCents > 0 && spentCents > plannedCents
      ? spentCents - plannedCents
      : 0;

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

      <Link href="/settings/banks" className="block" prefetch>
        <Card className="!flex-row items-center justify-between gap-3 border-border/40 bg-card/60 px-5 py-4 transition-colors hover:bg-card/80">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {tToday("balanceTitle")}
            </p>
            {isLoading || !data ? (
              <Skeleton className="mt-1 h-7 w-32" />
            ) : (
              <p
                className={`num mt-1 text-2xl font-semibold tracking-tight ${
                  balanceCents < 0 ? "text-destructive" : ""
                }`}
              >
                {formatEUR(balanceCents / 100, locale)}
              </p>
            )}
            <p className="mt-0.5 text-[10px] text-muted-foreground/70">
              {balanceHint}
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" />
        </Card>
      </Link>

      <Card
        className={`border-border/40 bg-card/60 p-5 ${
          tone === "over"
            ? "ring-1 ring-destructive/40"
            : tone === "warn"
              ? "ring-1 ring-amber-400/40"
              : ""
        }`}
      >
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("monthSpend")}
        </p>
        {isLoading || !data ? (
          <Skeleton className="mt-1 h-7 w-32" />
        ) : (
          <>
            <p
              className={`num mt-1 text-2xl font-semibold tracking-tight ${
                tone === "over"
                  ? "text-destructive"
                  : tone === "warn"
                    ? "text-amber-500"
                    : ""
              }`}
            >
              {formatEUR(spentCents / 100, locale)}
            </p>
            <p className="num mt-1 text-xs text-muted-foreground">
              {tToday("ofPlanned", {
                planned: formatEUR(plannedCents / 100, locale),
              })}
            </p>
          </>
        )}
        <SpendProgress
          actualCents={spentCents}
          plannedCents={plannedCents}
          size="sm"
          className="mt-3"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="num text-xs text-muted-foreground">
            {t("txCount", { n: data?.txns.length ?? 0 })}
          </p>
          {overByCents > 0 ? (
            <OverBudgetPill
              overByCents={overByCents}
              formatter={(c) => formatEUR(c / 100, locale)}
              label={tToday("overBy")}
            />
          ) : null}
        </div>
      </Card>

      {data &&
      (data.forecast.charges.length > 0 ||
        data.forecast.paidRecurring.itemCount > 0) ? (
        <Card className="border-border/40 bg-card/60 p-5">
          {/* Symmetric pair: paid recurring + still-to-pay. Same numbers
              the Today screen surfaces — keeping both views aligned. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {tToday("paidRecurringTitle")}
              </p>
              <p className="num mt-0.5 text-sm font-semibold tracking-tight">
                {formatEUR(
                  data.forecast.paidRecurring.paidCents / 100,
                  locale,
                )}
              </p>
              <p className="num mt-0.5 text-[11px] text-muted-foreground">
                {tToday("upcomingCount", {
                  n: data.forecast.paidRecurring.itemCount,
                })}
              </p>
            </div>
            <div className="border-l border-border/40 pl-3">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("upcomingTitle")}
              </p>
              <p className="num mt-0.5 text-sm font-semibold tracking-tight">
                {formatEUR(data.forecast.totalRemainingCents / 100, locale)}
              </p>
              <p className="num mt-0.5 text-[11px] text-muted-foreground">
                {tToday("upcomingCount", {
                  n: data.forecast.charges.length,
                })}
              </p>
            </div>
          </div>
          {data.forecast.charges.length > 0 && (
            <ul className="mt-3 divide-y divide-border/40 border-t border-border/40 pt-1">
              {data.forecast.charges.slice(0, 6).map((c) => (
              <li key={c.budgetItemId}>
                <Link
                  href={`/month/${c.budgetItemId}` as `/month/${string}`}
                  className="flex items-center gap-3 py-2 transition-colors hover:opacity-80"
                >
                  <div className="num grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {new Date(c.predictedDate).getUTCDate()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{c.name}</p>
                    <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70">
                      {formatShortDate(c.predictedDate, locale)} ·{" "}
                      {forecastSourceLabel(c.source, tToday)}
                    </p>
                  </div>
                  <span className="num text-sm">
                    {formatEURPrecise(Math.abs(c.plannedCents) / 100, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          )}
        </Card>
      ) : null}

      {data && data.txns.length > 0 ? (
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-full border border-border/60 bg-card/50 p-1 text-[11px]">
            <ViewPill href={makeViewHref(sp, "date")} active={view === "date"}>
              {t("viewByDate")}
            </ViewPill>
            <ViewPill
              href={makeViewHref(sp, "amount")}
              active={view === "amount"}
            >
              {t("viewByAmount")}
            </ViewPill>
          </div>
          <Link
            href="/activity/look-back"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
          >
            <Footprints className="size-3.5" strokeWidth={2.2} />
            {t("lookBack")}
          </Link>
        </div>
      ) : null}

      {isLoading ? (
        <Card className="flex flex-col gap-3 border-border/40 bg-card/40 p-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </Card>
      ) : !data || data.txns.length === 0 ? (
        <Card className="border-border/40 bg-card/40 p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </Card>
      ) : view === "date" ? (
        <>
          {dateGroups.map((g) => (
            <section key={g.date} className="flex flex-col gap-1">
              <p className="sticky top-0 z-10 -mx-1 bg-background/85 px-2 py-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground backdrop-blur supports-backdrop-filter:bg-background/70">
                {g.date}
              </p>
              <Card className="border-border/40 bg-card/60 p-1">
                <ul className="divide-y divide-border/40">
                  {g.rows.map((r) => {
                    const optsForScope = data.optionsAll.filter(
                      (o) => o.scope === r.owner,
                    );
                    return (
                      <li key={r.id} className="px-2">
                        <ActivityRow
                          tx={{
                            id: r.id,
                            counterparty: r.counterparty,
                            description: r.description,
                            bookingDate: r.bookingDate,
                            amountCents: r.amountCents,
                            matchedItemId: r.matchedItemId,
                            matchedName: r.matchedName,
                            owner: r.owner,
                          }}
                          options={optsForScope}
                          locale={locale}
                          sectionLabels={sectionLabels}
                        />
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
          <Link
            href="/transactions"
            className="text-center text-xs text-primary underline-offset-2 hover:underline"
          >
            {t("seeAllHistory")}
          </Link>
        </>
      ) : (
        <MerchantGroups
          groups={merchantGroups}
          optionsAll={data.optionsAll}
          locale={locale}
          sectionLabels={sectionLabels}
          txCountLabel={(n: number) => t("txCount", { n })}
          seeAllHref="/transactions"
          seeAllLabel={t("seeAllHistory")}
        />
      )}
    </main>
  );
}

function MerchantGroups({
  groups,
  optionsAll,
  locale,
  sectionLabels,
  txCountLabel,
  seeAllHref,
  seeAllLabel,
}: {
  groups: Array<{
    key: string;
    displayName: string;
    avatarHint: "ing" | "piggy" | null;
    txns: Txn[];
    paidCents: number;
    receivedCents: number;
  }>;
  optionsAll: OptionsAll;
  locale: string;
  sectionLabels: Record<Section, string>;
  txCountLabel: (n: number) => string;
  seeAllHref: "/transactions";
  seeAllLabel: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <>
      <Card className="border-border/40 bg-card/60 p-2">
        <ul className="divide-y divide-border/40">
          {groups.map((g) => {
            // Single-transaction "groups" have nothing to expand into —
            // render the row directly so the user doesn't have to tap
            // through a wrapper that collapses one item.
            if (g.txns.length === 1) {
              const r = g.txns[0];
              const optsForScope = optionsAll.filter(
                (o) => o.scope === r.owner,
              );
              return (
                <li key={g.key} className="px-2">
                  <ActivityRow
                    tx={{
                      id: r.id,
                      counterparty: r.counterparty,
                      description: r.description,
                      bookingDate: r.bookingDate,
                      amountCents: r.amountCents,
                      matchedItemId: r.matchedItemId,
                      matchedName: r.matchedName,
                      owner: r.owner,
                    }}
                    options={optsForScope}
                    locale={locale}
                    sectionLabels={sectionLabels}
                  />
                </li>
              );
            }
            const isOpen = expanded.has(g.key);
            return (
              <li key={g.key} className="px-2">
                <button
                  type="button"
                  onClick={() => toggle(g.key)}
                  aria-expanded={isOpen}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded px-2 py-3 text-left transition-colors hover:bg-card/40"
                >
                  <CounterpartyAvatar
                    name={g.displayName}
                    hint={g.avatarHint}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {g.displayName}
                    </p>
                    <p className="num text-xs text-muted-foreground">
                      {txCountLabel(g.txns.length)}
                    </p>
                  </div>
                  <div className="text-right">
                    {g.paidCents > 0 ? (
                      <p className="num whitespace-nowrap text-sm font-semibold">
                        −{formatEURPrecise(g.paidCents / 100, locale)}
                      </p>
                    ) : null}
                    {g.receivedCents > 0 ? (
                      <p className="num whitespace-nowrap text-sm font-semibold text-primary">
                        +{formatEURPrecise(g.receivedCents / 100, locale)}
                      </p>
                    ) : null}
                  </div>
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden
                  />
                </button>
                {isOpen ? (
                  <ul className="mb-2 ml-1 divide-y divide-border/40 border-l border-border/40 pl-2">
                    {g.txns.map((r) => {
                      const optsForScope = optionsAll.filter(
                        (o) => o.scope === r.owner,
                      );
                      return (
                        <li key={r.id} className="px-1">
                          <ActivityRow
                            tx={{
                              id: r.id,
                              counterparty: r.counterparty,
                              description: r.description,
                              bookingDate: r.bookingDate,
                              amountCents: r.amountCents,
                              matchedItemId: r.matchedItemId,
                              matchedName: r.matchedName,
                              owner: r.owner,
                            }}
                            options={optsForScope}
                            locale={locale}
                            sectionLabels={sectionLabels}
                          />
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
      <Link
        href={seeAllHref}
        className="text-center text-xs text-primary underline-offset-2 hover:underline"
      >
        {seeAllLabel}
      </Link>
    </>
  );
}

function ViewPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  // Plain anchor (not next-intl Link) so we can pass a relative
  // query-string-only href cheaply. Same-page nav, scope/anchor
  // already in `sp`.
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-2.5 py-1 uppercase tracking-[0.08em] transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </a>
  );
}

function makeViewHref(sp: URLSearchParams, view: ActivityView): string {
  const next = new URLSearchParams(sp.toString());
  if (view === "date") next.delete("view");
  else next.set("view", view);
  const s = next.toString();
  return s ? `?${s}` : "?";
}

function formatGroupDate(d: Date, locale: string): string {
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}


function forecastSourceLabel(
  src:
    | "due-day"
    | "payday"
    | "history-median"
    | "counterparty-history"
    | "month-end",
  t: (k: string) => string,
): string {
  if (src === "due-day") return t("forecastDue");
  if (src === "payday") return t("forecastPayday");
  if (src === "history-median") return t("forecastHistory");
  if (src === "counterparty-history") return t("forecastBankHistory");
  return t("forecastMonthEnd");
}
