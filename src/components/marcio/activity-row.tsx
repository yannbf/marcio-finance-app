"use client";

import { useTranslations } from "next-intl";
import { TransactionRow } from "./transaction-row.tsx";
import { BudgetItemPicker } from "./budget-item-picker.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import { formatEURPrecise } from "@/lib/format.ts";
import type { BudgetItemOption } from "./inbox-row.tsx";
import type { Section } from "@/lib/import/types.ts";

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
  };
  options: BudgetItemOption[];
  locale: string;
  sectionLabels: Record<Section, string>;
};

export function ActivityRow({ tx, options, locale, sectionLabels }: Props) {
  const t = useTranslations("Inbox");
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
  return (
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
  );
}
