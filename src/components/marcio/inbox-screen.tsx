"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card.tsx";
import { InboxList } from "./inbox-list.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { useMounted } from "@/lib/use-mounted.ts";
import { SECTION_ORDER, SECTION_TR_KEY } from "@/lib/import/sections.ts";
import type { Section } from "@/lib/import/types.ts";

export function InboxScreen({ locale }: { locale: string }) {
  const t = useTranslations("Inbox");
  const tSections = useTranslations("Sections");
  const mounted = useMounted();
  const query = trpc.inbox.list.useQuery();
  const data = mounted ? query.data : undefined;
  const isLoading = mounted ? query.isLoading : true;

  const sectionLabels = SECTION_ORDER.reduce(
    (acc, s) => {
      acc[s] = tSections(SECTION_TR_KEY[s] as never);
      return acc;
    },
    {} as Record<Section, string>,
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pb-8 pt-8">
      <header>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("title")}
        </p>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("heading")}
          </h1>
          <div className="flex items-baseline gap-1.5">
            {data?.recentlyAddedCount ? (
              <span className="num inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                {t("newSinceLastSync", { n: data.recentlyAddedCount })}
              </span>
            ) : null}
            <span className="num text-sm text-muted-foreground">
              {t("count", { n: data?.txns.length ?? 0 })}
            </span>
          </div>
        </div>
      </header>

      {isLoading ? (
        <Card className="flex flex-col gap-3 border-border/40 bg-card/40 p-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </Card>
      ) : !data || data.txns.length === 0 ? (
        <Card className="border-border/40 bg-card/60 p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium">{t("emptyTitle")}</p>
          <p className="mt-1 text-xs">{t("emptyHint")}</p>
        </Card>
      ) : (
        <InboxList
          items={data.txns}
          optionsByAnchor={data.optionsByAnchor}
          monthsWithoutSheet={data.monthsWithoutSheet}
          locale={locale}
          sectionLabels={sectionLabels}
        />
      )}
    </main>
  );
}
