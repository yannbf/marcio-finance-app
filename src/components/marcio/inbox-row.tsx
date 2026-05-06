"use client";

import { useTranslations } from "next-intl";
import { TransactionRow } from "./transaction-row.tsx";
import { BudgetItemPicker } from "./budget-item-picker.tsx";
import { trpc } from "@/lib/trpc/client.ts";
import type { Section } from "@/lib/import/types.ts";

export type InboxItem = {
  id: string;
  counterparty: string | null;
  description: string | null;
  bookingDate: string;
  amountCents: number;
};

export type BudgetItemOption = {
  id: string;
  name: string;
  section: Section;
  scope: "joint" | "camila" | "yann";
};

type Props = {
  tx: InboxItem;
  options: BudgetItemOption[];
  locale: string;
  sectionLabels: Record<Section, string>;
};

export function InboxRow({ tx, options, locale, sectionLabels }: Props) {
  const t = useTranslations("Inbox");
  const utils = trpc.useUtils();
  const assign = trpc.inbox.assign.useMutation({
    onSuccess: () => {
      // The same tx may be visible elsewhere — bust everything that could
      // have referenced its prior state.
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
          unmatched
        />
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
    />
  );
}
