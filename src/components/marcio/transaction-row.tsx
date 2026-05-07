import { CounterpartyAvatar } from "./counterparty-avatar.tsx";
import { formatEURPrecise } from "@/lib/format.ts";
import {
  isTikkie,
  parseTikkiePerson,
  parseTikkieTopic,
} from "@/lib/tikkie.ts";

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
  /** When set, render a warning that this amount is unusually high vs the
   *  recurring baseline for the matched budget item. */
  anomaly?: { meanCents: number; samples: number } | null;
  /** Localized "usually X" template — required when `anomaly` is set. */
  unusualLabel?: string;
  /** Localized "looks recurring" pill, shown in primary tone. */
  recurringLabel?: string | null;
};

export function TransactionRow({
  counterparty,
  description,
  bookingDate,
  amountCents,
  locale,
  matchedLabel,
  unmatched,
  anomaly,
  unusualLabel,
  recurringLabel,
}: Props) {
  const isCredit = amountCents > 0;
  const amount = formatEURPrecise(amountCents / 100, locale);

  // For "AAB INZ TIKKIE" rows the real counterparty + what the Tikkie was
  // for live in the description. Lift them up so the row reads as the
  // actual person/topic instead of the bank's generic intermediary label.
  const tikkie = isTikkie({ counterparty, description: description ?? null });
  const tikkiePerson =
    tikkie ? parseTikkiePerson(counterparty, description ?? null) : null;
  const tikkieTopic = tikkie ? parseTikkieTopic(description ?? null) : null;
  const showTikkieOverride =
    tikkie && tikkiePerson && tikkiePerson !== "—";
  const titleText = showTikkieOverride
    ? tikkiePerson
    : counterparty || description || "—";
  // Always show the Tikkie brand on Tikkie rows — even when we lifted the
  // person's name into the title, the row's brand identity is still Tikkie.
  const avatarName = tikkie ? "Tikkie" : counterparty;

  return (
    <div className="flex items-center gap-3 py-3">
      <CounterpartyAvatar name={avatarName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{titleText}</p>
        <p className="num text-xs text-muted-foreground">
          {bookingDate.toLocaleDateString(locale, {
            day: "2-digit",
            month: "short",
          })}
          {tikkieTopic ? ` · ${tikkieTopic}` : null}
          {matchedLabel ? ` · ${matchedLabel}` : null}
        </p>
        {anomaly && unusualLabel ? (
          <p className="num mt-1 inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-destructive">
            {unusualLabel}
          </p>
        ) : null}
        {recurringLabel ? (
          <p className="num mt-1 inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-primary">
            {recurringLabel}
          </p>
        ) : null}
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
