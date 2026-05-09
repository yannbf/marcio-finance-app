import {
  pgTable,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  uuid,
  uniqueIndex,
  index,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

export const userRole = pgEnum("user_role", ["camila", "yann"]);

/* -------------------------------------------------------------------------- */
/* Household settings — singleton row keyed by a fixed id                      */
/* -------------------------------------------------------------------------- */

export const householdSetting = pgTable("household_setting", {
  id: text("id").primaryKey().default("singleton"),
  /** Day of the month payday lands on. Defaults to 25, can be changed in UI. */
  paydayDay: integer("payday_day").notNull().default(25),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const accountKind = pgEnum("account_kind", ["checking", "savings"]);
export const accountOwner = pgEnum("account_owner", [
  "camila",
  "yann",
  "joint",
]);
export const budgetSection = pgEnum("budget_section", [
  "ENTRADAS",
  "DIVIDAS",
  "ECONOMIAS",
  "FIXAS",
  "VARIAVEIS",
  "SAZONAIS",
]);
export const sazonalKind = pgEnum("sazonal_kind", ["O", "L"]); // Obrigatório / Lazer
export const cadence = pgEnum("cadence", ["weekly", "monthly", "yearly"]);
export const txStatus = pgEnum("tx_status", ["pending", "booked"]);
export const matchSource = pgEnum("match_source", [
  "auto-rule",
  "learned",
  "user",
]);
export const bankConnectionStatus = pgEnum("bank_connection_status", [
  "pending",
  "linked",
  "expired",
  "revoked",
  "error",
]);

/* -------------------------------------------------------------------------- */
/* Auth (Better Auth core tables — kept aligned with their schema)             */
/* -------------------------------------------------------------------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name"),
  image: text("image"),
  role: userRole("role").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Domain                                                                      */
/* -------------------------------------------------------------------------- */

export const bankAccount = pgTable(
  "bank_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner: accountOwner("owner").notNull(),
    kind: accountKind("kind").notNull(),
    nickname: text("nickname").notNull(),
    bank: text("bank").notNull(), // "ING", "Nubank", etc.
    iban: text("iban"), // last 4 digits in plaintext only
    /** Encrypted (libsodium secretbox) bank-aggregator credentials. */
    credentialsEncrypted: text("credentials_encrypted"),
    consentExpiresAt: timestamp("consent_expires_at"),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /** Optional link to a bank_connection. Null for CSV-only accounts. */
    connectionId: uuid("connection_id"),
    /** Provider-issued account handle (Enable Banking account uid). */
    externalId: text("external_id"),
  },
  (t) => [
    index("bank_account_owner_idx").on(t.owner),
    index("bank_account_connection_idx").on(t.connectionId),
    uniqueIndex("bank_account_external_uniq").on(t.externalId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Bank connections — one row per provider session (Enable Banking session).  */
/* A session can hold multiple bank_account rows (joint + savings under the   */
/* same login). CSV-only flows leave bank_account.connection_id null.          */
/* -------------------------------------------------------------------------- */

export const bankConnection = pgTable(
  "bank_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Who clicked Connect — not the same as the account's privacy scope. */
    owner: userRole("owner").notNull(),
    /** Provider-specific institution id, e.g. Enable Banking's "ING_NL". */
    institutionId: text("institution_id").notNull(),
    /** Provider session id — Enable Banking session_id, encrypted. Null
     *  while pending consent; set on a successful callback. */
    sessionIdEncrypted: text("session_id_encrypted"),
    /** Hosted consent URL returned by the provider. Cleared once linked. */
    redirectLink: text("redirect_link"),
    status: bankConnectionStatus("status").notNull().default("pending"),
    /** When the underlying consent expires. Null until linked. */
    expiresAt: timestamp("expires_at"),
    /** Last attempted sync (success or failure). */
    lastSyncedAt: timestamp("last_synced_at"),
    /** Last error message if a sync or link step failed. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("bank_connection_owner_idx").on(t.owner)],
);

/* -------------------------------------------------------------------------- */
/* Per-account sync cursor. One row per bank_account that's connected via a   */
/* provider session. Tracks the last booked date we successfully ingested so  */
/* the next cron call can ask for a small delta.                               */
/* -------------------------------------------------------------------------- */

export const bankSyncCursor = pgTable("bank_sync_cursor", {
  bankAccountId: uuid("bank_account_id")
    .primaryKey()
    .references(() => bankAccount.id, { onDelete: "cascade" }),
  lastBookedAt: timestamp("last_booked_at"),
  lastTxnExternalId: text("last_txn_external_id"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const savingsBucket = pgTable("savings_bucket", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankAccountId: uuid("bank_account_id")
    .notNull()
    .references(() => bankAccount.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // "Viagem", "Imposto"
  nameEn: text("name_en"),
  yearlyTargetCents: integer("yearly_target_cents").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Savings accounts — the "Oranje Spaarrekening V12602730" type entities the  */
/* user can declare. Each owns a checking account (joint or personal) and a   */
/* unique ref pattern that appears in transfer descriptions.                  */
/* -------------------------------------------------------------------------- */

export const savingsAccount = pgTable(
  "savings_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner: accountOwner("owner").notNull(),
    /** Unique ref appearing in CSV descriptions, e.g. "V12602730" or
     * "N14631597". Matched case-insensitive substring against the
     * transaction description. */
    ref: text("ref").notNull(),
    nickname: text("nickname").notNull(),
    /** Optional link to a SAZONAIS budget item that gets auto-matched when
     * a transfer to this savings account is detected. */
    defaultBudgetItemNaturalKey: text("default_budget_item_natural_key"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("savings_account_ref_uniq").on(t.ref),
    index("savings_account_owner_idx").on(t.owner),
  ],
);

export const month = pgTable(
  "month",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Anchor year/month — e.g. "May 2026" payday-month spans Apr 25 → May 24. */
    anchorYear: integer("anchor_year").notNull(),
    anchorMonth: integer("anchor_month").notNull(),
    startsOn: timestamp("starts_on").notNull(),
    endsOn: timestamp("ends_on").notNull(),
    importedAt: timestamp("imported_at"),
  },
  (t) => [uniqueIndex("month_anchor_uniq").on(t.anchorYear, t.anchorMonth)],
);

export const budgetItem = pgTable(
  "budget_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monthId: uuid("month_id")
      .notNull()
      .references(() => month.id, { onDelete: "cascade" }),
    scope: accountOwner("scope").notNull(), // joint | camila | yann
    section: budgetSection("section").notNull(),
    sazonalKind: sazonalKind("sazonal_kind"),
    /** Stable natural key within (monthId, scope, section) — slug of name. */
    naturalKey: text("natural_key").notNull(),
    name: text("name").notNull(),
    nameEn: text("name_en"),
    /** Negative for outflows, positive for inflows. Cents in EUR. */
    plannedCents: integer("planned_cents").notNull(),
    cadence: cadence("cadence").notNull().default("monthly"),
    dueDay: integer("due_day"), // 1..31, when known (e.g. mortgage)
    savingsBucketId: uuid("savings_bucket_id").references(
      () => savingsBucket.id,
      { onDelete: "set null" },
    ),
    /** Optional link to a savings account that the user has declared in
     * Settings → Cofres. When set, Cofres aggregates this item under that
     * account, and the matching engine treats transfers to the account's
     * ref as candidates for this item. */
    savingsAccountId: uuid("savings_account_id"),
    /** Income contribution ratio (0..1) — only set on personal salary rows. */
    contributionRatio: numeric("contribution_ratio", {
      precision: 6,
      scale: 4,
    }),
  },
  (t) => [
    uniqueIndex("budget_item_natural_uniq").on(
      t.monthId,
      t.scope,
      t.section,
      t.naturalKey,
    ),
    index("budget_item_month_idx").on(t.monthId),
  ],
);

export const transaction = pgTable(
  "transaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => bankAccount.id, { onDelete: "cascade" }),
    bookingDate: timestamp("booking_date").notNull(),
    valueDate: timestamp("value_date"),
    amountCents: integer("amount_cents").notNull(),
    counterparty: text("counterparty"),
    description: text("description"),
    /** Hash of (date, amount, normalized description) for idempotent upsert. */
    dedupeKey: text("dedupe_key").notNull(),
    status: txStatus("status").notNull().default("booked"),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transaction_dedupe_uniq").on(t.bankAccountId, t.dedupeKey),
    index("transaction_booking_idx").on(t.bookingDate),
  ],
);

export const matchRule = pgTable(
  "match_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Owner: either a userId or 'joint' for shared rules. */
    scope: accountOwner("scope").notNull(),
    /** Counterparty regex — matched case-insensitively. */
    counterpartyPattern: text("counterparty_pattern").notNull(),
    minCents: integer("min_cents"),
    maxCents: integer("max_cents"),
    /** Resolves at apply time to a budget_item via (scope, section, naturalKey). */
    targetSection: budgetSection("target_section").notNull(),
    targetNaturalKey: text("target_natural_key").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).default(
      "0.700",
    ),
    /** Bumped when the user confirms (assigns to the same item the rule
     *  would have picked, or accepts an existing auto-match). */
    confirmedHits: integer("confirmed_hits").notNull().default(0),
    /** Bumped when the user reassigns away from this rule's pick. */
    overriddenHits: integer("overridden_hits").notNull().default(0),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("match_rule_scope_idx").on(t.scope)],
);

/* -------------------------------------------------------------------------- */
/* Category overrides — per-merchant user reclassifications.                  */
/*                                                                            */
/* The auto-categorizer in src/lib/categorization.ts ships with a fixed set  */
/* of regex rules (Albert Heijn → groceries, KLM → travel, …). When the      */
/* user disagrees they can pin a category to a counterparty fingerprint —     */
/* one row here applies retroactively to every prior tx with that fingerprint */
/* AND to every future one. Same shape as `match_rule` but for the curated   */
/* category taxonomy instead of budget items.                                 */
/* -------------------------------------------------------------------------- */

export const categoryOverride = pgTable(
  "category_override",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** fingerprintCounterparty(counterparty) — collapses "AH AMSTERDAM" /
     * "AH UTRECHT" into one rule. Stored lower-cased + escaped already. */
    fingerprint: text("fingerprint").notNull(),
    /** One of CATEGORY_KEYS. Stored as plain text so adding a new
     * category later doesn't require a schema change. */
    category: text("category").notNull(),
    /** Free-form label the user saw when they made the choice — used in
     * the override-management UI and to seed the next match. */
    sampleCounterparty: text("sample_counterparty"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("category_override_fingerprint_uniq").on(t.fingerprint),
  ],
);

export const txMatch = pgTable(
  "transaction_match",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transaction.id, { onDelete: "cascade" }),
    budgetItemId: uuid("budget_item_id")
      .notNull()
      .references(() => budgetItem.id, { onDelete: "cascade" }),
    /** Cents allocated to this budget item — for splits, multiple rows per tx. */
    allocatedCents: integer("allocated_cents").notNull(),
    source: matchSource("source").notNull(),
    ruleId: uuid("rule_id").references(() => matchRule.id, {
      onDelete: "set null",
    }),
    confirmedByUserId: text("confirmed_by_user_id").references(() => user.id),
    confirmedAt: timestamp("confirmed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("tx_match_tx_idx").on(t.transactionId),
    index("tx_match_item_idx").on(t.budgetItemId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const monthRelations = relations(month, ({ many }) => ({
  items: many(budgetItem),
}));

export const budgetItemRelations = relations(budgetItem, ({ one, many }) => ({
  month: one(month, {
    fields: [budgetItem.monthId],
    references: [month.id],
  }),
  bucket: one(savingsBucket, {
    fields: [budgetItem.savingsBucketId],
    references: [savingsBucket.id],
  }),
  matches: many(txMatch),
}));

export const transactionRelations = relations(transaction, ({ one, many }) => ({
  account: one(bankAccount, {
    fields: [transaction.bankAccountId],
    references: [bankAccount.id],
  }),
  matches: many(txMatch),
}));

export const txMatchRelations = relations(txMatch, ({ one }) => ({
  transaction: one(transaction, {
    fields: [txMatch.transactionId],
    references: [transaction.id],
  }),
  budgetItem: one(budgetItem, {
    fields: [txMatch.budgetItemId],
    references: [budgetItem.id],
  }),
  rule: one(matchRule, {
    fields: [txMatch.ruleId],
    references: [matchRule.id],
  }),
}));
