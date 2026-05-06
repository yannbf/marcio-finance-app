"use client";

import { useTranslations } from "next-intl";
import { TransactionRow } from "./transaction-row.tsx";
import { BudgetItemPicker } from "./budget-item-picker.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import type { BudgetItemOption } from "./inbox-row.tsx";
import type { Section } from "@/lib/import/types.ts";

type Props = {
  tx: {
    id: string;
    counterparty: string | null;
    description: string | null;
    bookingDate: string;
    amountCents: number;
    matchedName: string | null;
    owner: "joint" | "camila" | "yann";
  };
  options: BudgetItemOption[];
  locale: string;
  sectionLabels: Record<Section, string>;
};

export function ActivityRow({ tx, options, locale, sectionLabels }: Props) {
  const t = useTranslations("Inbox");
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
        <div className="rounded transition-colors hover:bg-card/40">
          <TransactionRow
            counterparty={tx.counterparty}
            description={tx.description}
            bookingDate={new Date(tx.bookingDate)}
            amountCents={tx.amountCents}
            locale={locale}
            matchedLabel={tx.matchedName}
            unmatched={!tx.matchedName}
          />
        </div>
      }
      options={options}
      sectionLabels={sectionLabels}
      title={t("assignTo")}
      subtitle={tx.counterparty || tx.description || ""}
      onPick={async (budgetItemId, remember) => {
        await assign.mutateAsync({
          transactionId: tx.id,
          budgetItemId,
          rememberRule: remember,
        });
      }}
      align="end"
    />
  );
}
