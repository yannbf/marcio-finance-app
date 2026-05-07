/**
 * Enable Banking — minimal API client.
 *
 * Docs: https://enablebanking.com/docs/api/reference/
 *
 * Auth: each request carries a JWT (RS256) signed with our app's private key.
 * Enable Banking verifies it with the public certificate we registered on the
 * dashboard. The `kid` header is our application id; tokens are short-lived
 * (we mint new ones every ~15 minutes and cache them in memory).
 *
 * No SDK dep — straight `fetch` + Node's built-in `crypto.sign`.
 */

import { createSign } from "node:crypto";

const BASE = "https://api.enablebanking.com";

const TOKEN_TTL_SECONDS = 15 * 60;

type CachedToken = { value: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

function readPrivateKeyPem(): string {
  const b64 = process.env.ENABLE_BANKING_PRIVATE_KEY_B64;
  if (!b64) {
    throw new Error(
      "ENABLE_BANKING_PRIVATE_KEY_B64 is not configured (base64 of the PEM private key).",
    );
  }
  return Buffer.from(b64, "base64").toString("utf8");
}

function readAppId(): string {
  const id = process.env.ENABLE_BANKING_APP_ID;
  if (!id) {
    throw new Error(
      "ENABLE_BANKING_APP_ID is not configured (the kid for our JWT header).",
    );
  }
  return id;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function mintJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "RS256", kid: readAppId() };
  const payload = {
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign(readPrivateKeyPem());
  return `${signingInput}.${base64url(sig)}`;
}

function getToken(): string {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const value = mintJwt();
  cachedToken = { value, expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000 };
  return value;
}

async function ebFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new EnableBankingError(res.status, text || res.statusText);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export class EnableBankingError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Enable Banking ${status}: ${body.slice(0, 200)}`);
    this.name = "EnableBankingError";
  }
}

/* -------------------------------------------------------------------------- */
/* Types — only the fields we read.                                            */
/* -------------------------------------------------------------------------- */

export type EbAspsp = {
  name: string;
  country: string;
  bic?: string;
  logo?: string;
  psu_types?: ("personal" | "business")[];
  maximum_consent_validity?: number; // seconds
};

export type EbAccessScope = {
  /** ISO datetime — when the consent expires. */
  valid_until: string;
  /** Optional: limit to specific accounts. */
  accounts?: { iban: string }[];
};

export type EbAuthRequest = {
  access: EbAccessScope;
  aspsp: { name: string; country: string };
  state: string;
  redirect_url: string;
  psu_type: "personal" | "business";
  language?: string;
};

export type EbAuthResponse = {
  /** URL the user should be redirected to in order to grant consent. */
  url: string;
  authorization_id: string;
  psu_id_hash?: string;
};

export type EbAccountUid = {
  uid: string;
  identification_hash?: string;
};

/**
 * Enable Banking returns two different shapes for the `accounts` array:
 *   - POST /sessions returns an array of full `AccountResource` objects
 *     ({uid, account_id, …}).
 *   - GET /sessions/{id} returns an array of plain UUID strings.
 * The session type unifies both — the `accountsToUids` helper below
 * collapses to a string[] regardless.
 */
export type EbSessionAccount = string | EbAccountUid;

export type EbSession = {
  session_id: string;
  accounts: EbSessionAccount[];
  /** Detailed account information when returned (varies by ASPSP). */
  accounts_data?: EbAccountDetails[];
  aspsp: { name: string; country: string };
  psu_type: "personal" | "business";
  access: EbAccessScope;
  /** ISO datetime — when this session's consent expires. */
  access_valid_until?: string;
};

export function accountsToUids(accounts: EbSessionAccount[] | undefined): string[] {
  if (!accounts) return [];
  return accounts
    .map((a) => (typeof a === "string" ? a : a.uid))
    .filter((s): s is string => typeof s === "string" && s.length > 0);
}

export type EbAccountDetails = {
  uid?: string;
  account_id?: { iban?: string; other?: { identification?: string } };
  account_type?: string;
  cash_account_type?: string;
  currency?: string;
  name?: string;
  product?: string;
  details?: string;
  usage?: string;
};

export type EbTransaction = {
  /** Stable, bank-issued id. May be missing for some ASPSPs. */
  entry_reference?: string;
  /** Provider-issued id (always present in Enable Banking responses). */
  transaction_id?: string;
  booking_date?: string; // YYYY-MM-DD
  value_date?: string;
  transaction_amount: { amount: string; currency: string };
  creditor?: { name?: string };
  debtor?: { name?: string };
  creditor_account?: { iban?: string };
  debtor_account?: { iban?: string };
  remittance_information?: string[];
  /** Some banks return a single string instead of an array. */
  remittance_information_unstructured?: string;
  bank_transaction_code?: string;
  transaction_date?: string;
  status?: "BOOK" | "PDNG" | "INFO";
};

export type EbTransactionsResponse = {
  transactions: EbTransaction[];
  continuation_key?: string | null;
};

/* -------------------------------------------------------------------------- */
/* API surface                                                                 */
/* -------------------------------------------------------------------------- */

export async function listAspsps(country: string): Promise<{ aspsps: EbAspsp[] }> {
  return ebFetch(`/aspsps?country=${encodeURIComponent(country)}`);
}

export async function startAuth(req: EbAuthRequest): Promise<EbAuthResponse> {
  return ebFetch(`/auth`, {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/**
 * Exchange the `code` returned to our redirect URL for a long-lived session.
 * The session UID is what we encrypt and persist.
 */
export async function createSession(code: string): Promise<EbSession> {
  return ebFetch(`/sessions`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function getSession(sessionId: string): Promise<EbSession> {
  return ebFetch(`/sessions/${sessionId}`);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await ebFetch(`/sessions/${sessionId}`, { method: "DELETE" });
}

export async function getAccountDetails(
  accountUid: string,
): Promise<EbAccountDetails> {
  return ebFetch(`/accounts/${accountUid}/details`);
}

/**
 * Enable Banking's `transaction_status` query param uses the Berlin Group
 * short codes (BOOK / PDNG / INFO / CNCL / HOLD / OTHR), not lowercase
 * descriptive words. Keep the value uppercase on the wire.
 */
export type EbTransactionStatus =
  | "BOOK"
  | "PDNG"
  | "INFO"
  | "CNCL"
  | "HOLD"
  | "OTHR";

export async function getAccountTransactions(args: {
  accountUid: string;
  dateFrom?: string;
  dateTo?: string;
  continuationKey?: string;
  status?: EbTransactionStatus;
}): Promise<EbTransactionsResponse> {
  const qs = new URLSearchParams();
  if (args.dateFrom) qs.set("date_from", args.dateFrom);
  if (args.dateTo) qs.set("date_to", args.dateTo);
  if (args.continuationKey) qs.set("continuation_key", args.continuationKey);
  if (args.status) qs.set("transaction_status", args.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return ebFetch(`/accounts/${args.accountUid}/transactions${suffix}`);
}
