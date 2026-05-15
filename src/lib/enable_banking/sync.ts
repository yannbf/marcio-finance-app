import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/index.ts";
import {
  bankAccount,
  bankConnection,
  bankSyncCursor,
  transaction,
} from "@/db/schema.ts";
import { runMatchingForAccount } from "@/lib/matching/engine.ts";
import { decryptSecret } from "@/lib/crypto/secrets.ts";
import {
  EnableBankingError,
  accountsToUids,
  deleteSession,
  getAccountBalances,
  getAccountDetails,
  getAccountTransactions,
  getSession,
  type EbBalance,
  type EbTransaction,
} from "./client.ts";
import { inferAccountOwner } from "./owner-inference.ts";

/* -------------------------------------------------------------------------- */
/* Transaction normalization                                                   */
/* -------------------------------------------------------------------------- */

export type NormalizedTx = {
  bookingDate: Date;
  valueDate: Date | null;
  amountCents: number;
  counterparty: string;
  description: string;
  /** Stable id used for dedupe. Falls back to a hash when missing. */
  externalId: string;
  dedupeKey: string;
  raw: Record<string, unknown>;
};

export function normalizeEbTransaction(
  tx: EbTransaction,
  iban: string,
): NormalizedTx | null {
  const bookingStr = tx.booking_date ?? tx.transaction_date;
  if (!bookingStr) return null;
  const bookingDate = new Date(`${bookingStr}T00:00:00.000Z`);
  if (Number.isNaN(bookingDate.getTime())) return null;

  const valueDate = tx.value_date
    ? new Date(`${tx.value_date}T00:00:00.000Z`)
    : null;

  const amountNum = Number.parseFloat(tx.transaction_amount.amount);
  if (!Number.isFinite(amountNum)) return null;
  // Sign convention. ING via Enable Banking returns `transaction_amount`
  // as an unsigned absolute value; direction comes from `credit_debit_indicator`
  // (Berlin Group's canonical signal: DBIT = outgoing, CRDT = incoming).
  //
  // Earlier versions of this file fell back to creditor/debtor name
  // presence when the indicator was absent, but ALSO trusted the API's
  // raw sign as a last resort — which was wrong because the API never
  // returns a negative number. Result: the May 2026 incident where
  // outgoing payments arrived positive, matched the same budget item as
  // their CSV counterpart, and silently cancelled out spend totals.
  //
  // New order:
  //   1. credit_debit_indicator (deterministic, always trust it)
  //   2. creditor/debtor name presence (fallback for older payloads)
  //   3. Default to outgoing (negative) — ING transactions skew heavily
  //      outgoing, and being wrong toward "spending" is a better failure
  //      mode than silently inflating credits.
  const absCents = Math.abs(Math.round(amountNum * 100));
  const indicator = tx.credit_debit_indicator;
  // Fallback: identify our account by IBAN. If our IBAN is the
  // creditor_account, money entered us (positive). If our IBAN is the
  // debtor_account, money left us (negative).
  const ourIban = (iban || "").replace(/\s+/g, "").toUpperCase();
  const creditorIban = (tx.creditor_account?.iban ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
  const debtorIban = (tx.debtor_account?.iban ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
  const weAreCreditor = !!ourIban && ourIban === creditorIban;
  const weAreDebtor = !!ourIban && ourIban === debtorIban;
  const amountCents =
    indicator === "CRDT"
      ? absCents
      : indicator === "DBIT"
        ? -absCents
        : weAreCreditor
          ? absCents
          : weAreDebtor
            ? -absCents
            : // Last resort: ING transactions skew heavily outgoing,
              // and being wrong toward "spending" is a better failure
              // mode than silently inflating credits.
              -absCents;

  const counterparty = (tx.creditor?.name ?? tx.debtor?.name ?? "").trim();
  const descriptionParts: string[] = [];
  if (tx.remittance_information?.length) {
    descriptionParts.push(tx.remittance_information.join(" "));
  } else if (tx.remittance_information_unstructured) {
    descriptionParts.push(tx.remittance_information_unstructured);
  }
  const description = descriptionParts.join(" ").replace(/\s+/g, " ").trim();

  const externalId =
    tx.entry_reference ??
    tx.transaction_id ??
    hashFallback(iban, bookingStr, amountCents, counterparty, description);

  // Same shape as the ING CSV pipeline so a CSV upload covering the same
  // window dedupes against a sync-inserted row. Description is intentionally
  // excluded — same booking can arrive with NL and EN labels and we want
  // those to collapse, not produce two rows.
  const csvShapeDedupe = createHash("sha1")
    .update(
      [
        iban,
        bookingStr,
        String(amountCents),
        normalizeForHash(counterparty),
      ].join("|"),
    )
    .digest("hex");

  return {
    bookingDate,
    valueDate,
    amountCents,
    counterparty,
    description,
    externalId,
    dedupeKey: csvShapeDedupe,
    raw: tx as unknown as Record<string, unknown>,
  };
}

function hashFallback(...parts: (string | number)[]): string {
  return (
    "fallback:" +
    createHash("sha1").update(parts.map(String).join("|")).digest("hex")
  );
}

function normalizeForHash(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * ING via Enable Banking returns multiple balance entries per account
 * (typically `closingBooked` + `expected`, sometimes `interimAvailable`).
 * Prefer the figure a customer sees in the banking app: "available"
 * first (includes pending), then "interim booked", then "closing booked"
 * as a safe end-of-previous-day fallback. Returns null when nothing
 * useful came back.
 */
function pickPreferredBalance(balances: EbBalance[]): EbBalance | null {
  const priority: EbBalance["balance_type"][] = [
    "interimAvailable",
    "interimBooked",
    "expected",
    "closingBooked",
  ];
  for (const type of priority) {
    const hit = balances.find((b) => b.balance_type === type);
    if (hit) return hit;
  }
  return balances[0] ?? null;
}

function parseBalanceCents(b: EbBalance): number | null {
  const n = Number.parseFloat(b.balance_amount.amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function parseBalanceAsOf(b: EbBalance): Date | null {
  const iso = b.reference_date ?? b.last_change_date_time;
  if (!iso) return null;
  // `reference_date` can be a plain YYYY-MM-DD (closingBooked, often) or a
  // full datetime. Date's constructor handles both.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/* -------------------------------------------------------------------------- */
/* Sync engine                                                                 */
/* -------------------------------------------------------------------------- */

export type ConnectionSyncResult = {
  connectionId: string;
  status: "linked" | "expired" | "error";
  accountsSynced: number;
  inserted: number;
  duplicates: number;
  matched: number;
  error?: string;
};

export type SyncAllResult = {
  connections: number;
  accounts: number;
  inserted: number;
  matched: number;
  expired: string[];
  errors: { connectionId: string; error: string }[];
};

export async function syncAllConnections(): Promise<SyncAllResult> {
  const conns = await db
    .select()
    .from(bankConnection)
    .where(eq(bankConnection.status, "linked"));

  const out: SyncAllResult = {
    connections: 0,
    accounts: 0,
    inserted: 0,
    matched: 0,
    expired: [],
    errors: [],
  };

  for (const conn of conns) {
    const r = await syncConnection(conn.id);
    out.connections++;
    out.accounts += r.accountsSynced;
    out.inserted += r.inserted;
    out.matched += r.matched;
    if (r.status === "expired") out.expired.push(r.connectionId);
    if (r.status === "error" && r.error) {
      out.errors.push({ connectionId: r.connectionId, error: r.error });
    }
  }

  return out;
}

export async function syncConnection(
  connectionId: string,
): Promise<ConnectionSyncResult> {
  const [conn] = await db
    .select()
    .from(bankConnection)
    .where(eq(bankConnection.id, connectionId));
  if (!conn) {
    return {
      connectionId,
      status: "error",
      accountsSynced: 0,
      inserted: 0,
      duplicates: 0,
      matched: 0,
      error: "Connection not found",
    };
  }

  if (!conn.sessionIdEncrypted) {
    return failConnection(conn.id, "no session", new Error("session id missing"));
  }

  let sessionId: string;
  try {
    sessionId = decryptSecret(conn.sessionIdEncrypted);
  } catch (err) {
    return failConnection(conn.id, "decrypt failed", err);
  }

  let session;
  try {
    session = await getSession(sessionId);
  } catch (err) {
    if (
      err instanceof EnableBankingError &&
      (err.status === 401 || err.status === 403 || err.status === 404)
    ) {
      await markExpired(conn.id, `session gone: ${err.status}`);
      return {
        connectionId: conn.id,
        status: "expired",
        accountsSynced: 0,
        inserted: 0,
        duplicates: 0,
        matched: 0,
      };
    }
    return failConnection(conn.id, "getSession failed", err);
  }

  let totalInserted = 0;
  let totalDuplicates = 0;
  let totalMatched = 0;
  let accountsSynced = 0;
  const perAccountErrors: string[] = [];

  const accountUids = accountsToUids(session.accounts);

  for (const accountUid of accountUids) {
    try {
      const r = await syncAccount({
        connectionId: conn.id,
        accountUid,
        owner: conn.owner,
      });
      totalInserted += r.inserted;
      totalDuplicates += r.duplicates;
      totalMatched += r.matched;
      accountsSynced++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      perAccountErrors.push(`${accountUid.slice(0, 8)}…: ${msg}`);
    }
  }

  // Only clear lastError if every per-account run succeeded (or we had
  // nothing to do). Otherwise leave the diagnostic on the row so the user
  // can see what went wrong from the UI.
  await db
    .update(bankConnection)
    .set({
      lastSyncedAt: new Date(),
      lastError:
        perAccountErrors.length > 0
          ? perAccountErrors.join(" | ").slice(0, 500)
          : accountUids.length === 0
            ? "session has no accounts — re-grant consent"
            : null,
    })
    .where(eq(bankConnection.id, conn.id));

  return {
    connectionId: conn.id,
    status: "linked",
    accountsSynced,
    inserted: totalInserted,
    duplicates: totalDuplicates,
    matched: totalMatched,
  };
}

async function syncAccount(args: {
  connectionId: string;
  accountUid: string;
  owner: "yann" | "camila";
}): Promise<{ inserted: number; duplicates: number; matched: number }> {
  // Resolve to an existing bank_account row in three steps:
  //   1. By external_id — already synced under this same Enable Banking uid.
  //   2. By IBAN — was previously created via CSV upload and has no
  //      connection yet. Claim it by stamping connection_id + external_id
  //      so transactions land on the same row going forward.
  //   3. Create a brand-new row.
  let acct: typeof bankAccount.$inferSelect | undefined;

  const [byExternal] = await db
    .select()
    .from(bankAccount)
    .where(eq(bankAccount.externalId, args.accountUid));
  acct = byExternal;

  // Pull the account details up front — we need the IBAN for the claim
  // path AND the nickname/kind for the create path.
  let details:
    | Awaited<ReturnType<typeof getAccountDetails>>
    | undefined;
  let providerIban: string | null = null;
  if (!acct) {
    details = await getAccountDetails(args.accountUid);
    const ibanRaw =
      details.account_id?.iban ??
      details.account_id?.other?.identification ??
      "";
    providerIban = ibanRaw ? ibanRaw.replace(/\s+/g, "").toUpperCase() : null;
  }

  if (!acct && providerIban) {
    // Step 2: try to claim a CSV-created row with the same IBAN.
    const [byIban] = await db
      .select()
      .from(bankAccount)
      .where(eq(bankAccount.iban, providerIban));
    if (byIban && !byIban.externalId) {
      const [updated] = await db
        .update(bankAccount)
        .set({
          externalId: args.accountUid,
          connectionId: args.connectionId,
        })
        .where(eq(bankAccount.id, byIban.id))
        .returning();
      acct = updated;
    }
  }

  if (!acct) {
    // Step 3: brand-new row.
    const d = details ?? (await getAccountDetails(args.accountUid));
    const iban =
      providerIban ??
      ((d.account_id?.iban ??
        d.account_id?.other?.identification ??
        "")
        .replace(/\s+/g, "")
        .toUpperCase() ||
        null);
    const nickname =
      d.name ??
      d.product ??
      `ING ${(iban ?? "").slice(-4) || "account"}`;
    const cashType = (d.cash_account_type ?? "").toLowerCase();
    const product = (d.product ?? "").toLowerCase();
    const isSavings =
      cashType === "svgs" ||
      product.includes("spaar") ||
      product.includes("savings");

    // If the holder line names multiple people ("Y Bezerra,C Ferrer")
    // or the product literally says joint/gezamenlijk, default to the
    // joint scope — the personal scope would silently drop every
    // joint-scoped seed rule (Albert Heijn, Mortgage, Vattenfall, …).
    // The user can still flip via the bank-account titularidade pill.
    const inferredOwner = inferAccountOwner({
      fallback: args.owner,
      name: d.name ?? null,
      product: d.product ?? null,
      accountType: d.cash_account_type ?? d.account_type ?? null,
    });

    const [created] = await db
      .insert(bankAccount)
      .values({
        owner: inferredOwner,
        kind: isSavings ? "savings" : "checking",
        nickname,
        bank: "ING",
        iban,
        connectionId: args.connectionId,
        externalId: args.accountUid,
      })
      .returning();
    acct = created;
  } else if (!acct.connectionId) {
    // Existing row found by external_id but not yet linked to this
    // connection — happens if the connection was rebuilt.
    await db
      .update(bankAccount)
      .set({ connectionId: args.connectionId })
      .where(eq(bankAccount.id, acct.id));
    acct = { ...acct, connectionId: args.connectionId };
  }

  const [cursor] = await db
    .select()
    .from(bankSyncCursor)
    .where(eq(bankSyncCursor.bankAccountId, acct.id));

  const dateFrom = isoDate(
    cursor?.lastBookedAt
      ? subtractDays(cursor.lastBookedAt, 1)
      : subtractDays(new Date(), 90),
  );

  // Page through transactions until Enable Banking stops returning a
  // continuation_key. ASPSPs page in chunks of ~50–500 rows.
  const ibanForHash = acct.iban ?? args.accountUid;
  const normalized: NormalizedTx[] = [];
  let continuationKey: string | undefined;
  do {
    const page = await getAccountTransactions({
      accountUid: args.accountUid,
      dateFrom,
      continuationKey,
      status: "BOOK",
    });
    for (const t of page.transactions ?? []) {
      const n = normalizeEbTransaction(t, ibanForHash);
      if (n) normalized.push(n);
    }
    continuationKey = page.continuation_key ?? undefined;
  } while (continuationKey);

  let inserted = 0;
  let duplicates = 0;
  let maxBooked: Date | null = cursor?.lastBookedAt ?? null;
  let maxExternalId: string | null = cursor?.lastTxnExternalId ?? null;

  const BATCH = 200;
  for (let i = 0; i < normalized.length; i += BATCH) {
    const batch = normalized.slice(i, i + BATCH);
    const result = await db
      .insert(transaction)
      .values(
        batch.map((r) => ({
          bankAccountId: acct.id,
          bookingDate: r.bookingDate,
          valueDate: r.valueDate,
          amountCents: r.amountCents,
          counterparty: r.counterparty,
          description: r.description,
          dedupeKey: r.dedupeKey,
          status: "booked" as const,
          rawPayload: r.raw,
        })),
      )
      .onConflictDoNothing({
        target: [transaction.bankAccountId, transaction.dedupeKey],
      })
      .returning({ id: transaction.id });
    inserted += result.length;
    duplicates += batch.length - result.length;
    for (const r of batch) {
      if (!maxBooked || r.bookingDate > maxBooked) {
        maxBooked = r.bookingDate;
        maxExternalId = r.externalId;
      }
    }
  }

  // Pull the authoritative balance the bank reports right now. Best-effort
  // — we don't want a balances endpoint hiccup to abort the whole txn sync,
  // and a stale balance is much better than missing transactions.
  let balanceUpdate: { balanceCents: number; balanceAsOf: Date } | null = null;
  try {
    const { balances } = await getAccountBalances(args.accountUid);
    const picked = balances?.length ? pickPreferredBalance(balances) : null;
    if (picked) {
      const cents = parseBalanceCents(picked);
      const asOf = parseBalanceAsOf(picked) ?? new Date();
      if (cents !== null) {
        balanceUpdate = { balanceCents: cents, balanceAsOf: asOf };
      }
    }
  } catch {
    // Swallow — fall back to the inferred sum until the next sync.
  }

  await db
    .update(bankAccount)
    .set({
      lastSyncedAt: new Date(),
      ...(balanceUpdate ?? {}),
    })
    .where(eq(bankAccount.id, acct.id));

  await db
    .insert(bankSyncCursor)
    .values({
      bankAccountId: acct.id,
      lastBookedAt: maxBooked,
      lastTxnExternalId: maxExternalId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: bankSyncCursor.bankAccountId,
      set: {
        lastBookedAt: maxBooked,
        lastTxnExternalId: maxExternalId,
        updatedAt: new Date(),
      },
    });

  let matched = 0;
  if (inserted > 0) {
    const r = await runMatchingForAccount(acct.id);
    matched = r.matched;
  }

  return { inserted, duplicates, matched };
}

/* -------------------------------------------------------------------------- */

async function markExpired(connectionId: string, reason: string) {
  await db
    .update(bankConnection)
    .set({
      status: "expired",
      lastError: reason,
      lastSyncedAt: new Date(),
    })
    .where(eq(bankConnection.id, connectionId));
}

async function failConnection(
  connectionId: string,
  label: string,
  err: unknown,
): Promise<ConnectionSyncResult> {
  const msg = err instanceof Error ? err.message : String(err);
  await db
    .update(bankConnection)
    .set({
      status: "error",
      lastError: `${label}: ${msg}`,
      lastSyncedAt: new Date(),
    })
    .where(eq(bankConnection.id, connectionId));
  return {
    connectionId,
    status: "error",
    accountsSynced: 0,
    inserted: 0,
    duplicates: 0,
    matched: 0,
    error: msg,
  };
}

/**
 * Best-effort revoke of the session at Enable Banking.
 * Used by the tRPC disconnect mutation.
 */
export async function revokeSessionForConnection(
  connectionId: string,
): Promise<void> {
  const [conn] = await db
    .select({ sessionIdEncrypted: bankConnection.sessionIdEncrypted })
    .from(bankConnection)
    .where(eq(bankConnection.id, connectionId));
  if (!conn?.sessionIdEncrypted) return;
  try {
    const sessionId = decryptSecret(conn.sessionIdEncrypted);
    await deleteSession(sessionId);
  } catch (err) {
    if (err instanceof EnableBankingError && err.status === 404) return;
    throw err;
  }
}

function subtractDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() - days);
  return out;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
