"use client";

import { useTranslations } from "next-intl";
import { TransactionRow } from "./transaction-row.tsx";
import { BudgetItemPicker } from "./budget-item-picker.tsx";
import { CategoryPicker } from "./category-picker.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { formatEURPrecise } from "@/lib/format.ts";
import type { BudgetItemOption } from "./inbox-row.tsx";
import type { Section } from "@/lib/import/types.ts";
import type { Category } from "@/lib/categorization.ts";
import { categorizeTx } from "@/lib/categorization.ts";

type Props = {
  tx: {
    id: string;
    counterparty: string | null;
    description: string | null;
    bookingDate: string;
    amountCents: number;
    matchedItemId?: string | null;
    matchedName: string | null;
    owner: "joint" | "camila" | "yann";
    anomaly?: { meanCents: number; samples: number } | null;
    /**
     * Auto-tagged category. Pre-computed server-side when the caller's
     * tRPC procedure resolves overrides; falls back to the regex
     * categorizer here so legacy callers without the field keep
     * working. (Override-aware classification only happens server-side.)
     */
    category?: Category;
  };
  options: BudgetItemOption[];
  locale: string;
  sectionLabels: Record<Section, string>;
};

export function ActivityRow({ tx, options, locale, sectionLabels }: Props) {
  const t = useTranslations("Inbox");
  const tCategories = useTranslations("Categories");
  const tActivity = useTranslations("Activity");
  const utils = trpc.useUtils();
  const assign = trpc.inbox.assign.useMutation({
    onSuccess: () => {
      utils.inbox.list.invalidate();
      utils.activity.get.invalidate();
      utils.today.get.invalidate();
      utils.transactions.list.invalidate();
      utils.month.get.invalidate();
      utils.insights.get.invalidate();
      utils.buckets.get.invalidate();
    },
  });
  const category: Category =
    tx.category ?? categorizeTx({
      counterparty: tx.counterparty,
      description: tx.description,
    });
  return (
    <div className="flex flex-col">
      <BudgetItemPicker
        trigger={
          <TransactionRow
            counterparty={tx.counterparty}
            description={tx.description}
            bookingDate={new Date(tx.bookingDate)}
            amountCents={tx.amountCents}
            locale={locale}
            matchedLabel={tx.matchedName}
            unmatched={!tx.matchedName}
            anomaly={tx.anomaly}
            unusualLabel={
              tx.anomaly
                ? tActivity("unusuallyHigh", {
                    mean: formatEURPrecise(tx.anomaly.meanCents / 100, locale),
                  })
                : undefined
            }
          />
        }
        options={options}
        sectionLabels={sectionLabels}
        currentItemId={tx.matchedItemId ?? null}
        title={t("assignTo")}
        subtitle={tx.counterparty || tx.description || ""}
        onPick={async (budgetItemId, applyTo) => {
          await assign.mutateAsync({
            transactionId: tx.id,
            budgetItemId,
            applyTo,
          });
        }}
      />
      {/* Outflow category chip. Sits OUTSIDE the BudgetItemPicker
          trigger so tapping the chip doesn't open the budget sheet,
          and inflow rows (refunds, salary) skip it entirely — those
          aren't part of the spend taxonomy. */}
      {tx.amountCents < 0 ? (
        <div className="flex justify-start pb-2">
          <CategoryPicker
            counterparty={tx.counterparty}
            current={category}
            trigger={
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors ${
                  category === "other"
                    ? "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground"
                    : "border-primary/30 bg-primary/10 text-primary"
                }`}
              >
                {tCategories(category as never)}
              </span>
            }
          />
        </div>
      ) : null}
    </div>
  );
}
