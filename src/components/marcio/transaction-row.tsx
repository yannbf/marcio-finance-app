import { CounterpartyAvatar } from "./counterparty-avatar.tsx";
import { formatEUR } from "@/lib/format.ts";

type Props = {
  counterparty: string | null;
  description?: string | null;
  bookingDate: Date;
  amountCents: number;
  locale: string;
  /** Optional matched-budget-item label, shown as a subtle pill below name. */
  matchedLabel?: string | null;
  /** When true, render a hint row to indicate this is unmatched. */
  unmatched?: boolean;
};

export function TransactionRow({
  counterparty,
  description,
  bookingDate,
  amountCents,
  locale,
  matchedLabel,
  unmatched,
}: Props) {
  const isCredit = amountCents > 0;
  const amount = formatEUR(amountCents / 100, locale);
  return (
    <div className="flex items-center gap-3 py-3">
      <CounterpartyAvatar name={counterparty} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {counterparty || description || "—"}
        </p>
        <p className="num text-xs text-muted-foreground">
          {bookingDate.toLocaleDateString(locale, {
            day: "2-digit",
            month: "short",
          })}
          {matchedLabel ? ` · ${matchedLabel}` : null}
          {unmatched ? " · ?" : null}
        </p>
      </div>
      <p
        className={`num whitespace-nowrap text-right text-sm font-semibold ${
          isCredit ? "text-primary" : ""
        }`}
      >
        {isCredit ? "+" : ""}
        {amount}
      </p>
    </div>
  );
}
