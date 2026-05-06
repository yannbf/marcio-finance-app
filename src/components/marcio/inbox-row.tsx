"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { TransactionRow } from "./transaction-row.tsx";
import { assignTransactionAction } from "@/app/[locale]/inbox/actions.ts";

export type InboxItem = {
  id: string;
  counterparty: string | null;
  description: string | null;
  bookingDate: string; // ISO
  amountCents: number;
};

export type BudgetItemOption = {
  id: string;
  name: string;
  section: string;
  scope: "joint" | "camila" | "yann";
};

type Props = {
  tx: InboxItem;
  options: BudgetItemOption[];
  locale: string;
};

export function InboxRow({ tx, options, locale }: Props) {
  const t = useTranslations("Inbox");
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(true);
  const [pending, startTransition] = useTransition();

  function pick(itemId: string) {
    startTransition(async () => {
      const r = await assignTransactionAction({
        transactionId: tx.id,
        budgetItemId: itemId,
        rememberRule: remember,
      });
      if (r.ok) {
        setOpen(false);
      } else {
        console.error(r.error);
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="block w-full rounded text-left transition-colors hover:bg-card/40">
        <TransactionRow
          counterparty={tx.counterparty}
          description={tx.description}
          bookingDate={new Date(tx.bookingDate)}
          amountCents={tx.amountCents}
          locale={locale}
          unmatched
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-72 p-0"
      >
        <header className="border-b border-border/60 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("assignTo")}
          </p>
          <p className="mt-1 truncate text-sm font-medium">
            {tx.counterparty || tx.description}
          </p>
        </header>
        <div className="max-h-72 overflow-y-auto py-1">
          {options.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {t("noBudgetItems")}
            </p>
          ) : (
            options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={pending}
                onClick={() => pick(opt.id)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/40"
              >
                <span className="truncate">{opt.name}</span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {opt.section}
                </span>
              </button>
            ))
          )}
        </div>
        <footer className="flex items-center justify-between border-t border-border/60 p-3">
          <Label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.currentTarget.checked)}
              className="h-3.5 w-3.5"
            />
            {t("remember")}
          </Label>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        </footer>
      </PopoverContent>
    </Popover>
  );
}
