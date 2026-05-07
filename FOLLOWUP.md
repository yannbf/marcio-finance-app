# Marcio — follow-up plan

Tracks work surfaced during the build but deliberately deferred. Roughly
ordered by leverage. Each section ends with a concrete starting point.

> Status as of last commit: deployed to Vercel against the Neon production
> branch. The `MARCIO_DEV_AS` bypass is hard-gated to non-production, but
> there is no real sign-in flow yet — see "Auth & sign-in" below.

## 0. Rename app routes and code that is in portuguese. ✅

Done — `/mes` → `/month`, `/atividade` → `/activity`, plus matching
component renames (`MesPage` → `MonthPage`, `AtividadePage` → `ActivityPage`).

## 1. Auth & sign-in (blocker for real prod use)

Magic-link infrastructure exists (`src/lib/auth/index.ts`) and the UI is
now in place.

- [x] **Sign-in page** at `/[locale]/sign-in` with an email input that calls
  `signIn.magicLink({ email })`.
- [x] **Verify page** at `/[locale]/sign-in/verify` (renders error if the
  user lands without a session; Better Auth's callback redirect lands them
  on `/` directly when the link is valid).
- [x] **Auth gate** in `src/proxy.ts` — redirects to `/sign-in` when no
  Better Auth session cookie is present and `MARCIO_DEV_AS` isn't set.
- [x] **Logout button** in Settings.
- [ ] **Resend domain verification** — production magic links currently
  send only to your own email (Resend `onboarding@resend.dev` sender
  limitation). Verify a domain at https://resend.com/domains and update
  `MARCIO_FROM_EMAIL` so Camila can sign in too.

## 2. PWA install on iPhone ✅

Done.

- [x] `public/manifest.webmanifest`.
- [x] `public/icon-192.png`, `public/icon-512.png`, `apple-touch-icon.png`,
  `icon-maskable-512.png`. Source SVG → PNG via `scripts/generate-icons.ts`.
- [x] `<link rel="manifest">` and apple-touch-icon meta in the layout
  (Next 16 Metadata API `manifest` + `icons` fields).
- [x] Test "Add to Home Screen" on an iPhone. (manual verification)

## 3. Daily Google Sheets sync (cron) ✅

Adapter is implemented (`src/lib/import/source-google.ts`) but only runs
on user-triggered import.

- [x] `vercel.json` cron config: `0 6 * * *` → `/api/cron/import-sheet`.
- [x] New route at `src/app/api/cron/import-sheet/route.ts` that
  authenticates via `Authorization: Bearer ${CRON_SECRET}`, calls
  `readGoogleSheet()` + `upsertParsedMonth()` for every returned tab,
  re-runs `runMatchingAllAccounts()`, and returns counts.
- [x] `CRON_SECRET` env var in Vercel.

## 4. Sheet/CSV sources outside dev

CSV upload still works, but auto-sync from banks doesn't.

- [ ] Decide: stay on manual CSV uploads vs. fold in Enable Banking
  (PSD2). The matching engine and dedupe key are already source-agnostic
  — `src/lib/import/source-google.ts` + `source-xlsx.ts` show the
  adapter shape.
- [ ] If Enable Banking: implement `src/lib/bank-sync/source-enable-banking.ts`
  with the OAuth flow stored against `bank_account.credentialsEncrypted`
  (column already in schema, just needs encryption helpers).

## 5. Hardening

Production-readiness gaps that aren't critical day one but bite eventually.

- [ ] **Encrypt at rest** — `bank_account.credentialsEncrypted` is text;
  add libsodium secretbox + key-from-env helpers (`MARCIO_TOKEN_ENC_KEY`
  is already in `.env.example`).
- [ ] **Sentry** free-tier, scoped client + server.
- [ ] **Rate limiting** on `/api/auth/*` so a stranger can't spam magic
  links to the allow-list.
- [ ] **Audit log** of which user assigned what to where (we already
  store `confirmedByUserId` on `tx_match`, just no UI to see it).
- [ ] **2FA** via Better Auth's TOTP plugin once you have a real domain.
- [ ] **Encrypted nightly DB dump** to a private bucket. Restore drill
  once.

## 6. UX polish ✅ (mostly)

- [x] **Light theme** — `Settings → Theme` is now a real Light/Dark/System
  toggle stored in localStorage; layout pre-paint script applies the
  saved value to avoid FOUC.
- [x] **Month scope toggle persistence** — stored in
  `marcio-month-scope` cookie, URL `?scope` still wins when present.
- [x] **Bulk assign in Inbox** — checkboxes on each row with a sticky
  bottom bar for batch assignment using a shared `BudgetItemPicker`.
- [x] **Reassign category** — clicking any row in `/activity` (and
  `/transactions`) opens the same picker; reassigns via
  `assignTransactionAction`.
- [x] **/transactions vs /activity overlap** — split cleanly: Activity
  is the canonical month timeline, Transactions the full searchable
  history. Cross-linked from Activity.
- [x] **Tikkie counterparty grouping view** — `/[locale]/tikkie` groups
  Tikkie movements by parsed person name with paid/received totals,
  linked from Insights.

## 7. Matching improvements

The engine is good for v1; these are the next step.

- [x] **Per-merchant match confidence learning** — Bayesian-ish update
  from confirmed/overridden hits in `lib/matching/rule-confidence.ts`;
  engine drops rules below a confidence floor.
- [ ] **Date-window guard for repeats** — a recurring rent should only
  match the closest single transaction near its due day, not also a
  refund weeks later that happens to share the counterparty.
- [x] **Counterparty fingerprinting** — `lib/matching/fingerprint.ts`
  strips Dutch city tails / terminal IDs / trailing digits before the
  rule pattern lands in `match_rule`.
- [ ] **Currency** — every amount is treated as EUR. Schema doesn't
  store currency anywhere. Adding ISO codes is a future migration when
  someone earns in another currency.

## 8. Mobile / browser quirks observed

- [x] **Bottom sheet drag** — drag now starts from the entire top
  64px header zone (not just the handle pill); body-scroll lock kicks
  in on open so the page underneath doesn't scroll on iOS.
- [x] **Bottom-nav placement on iPhone X+** — body padding is now
  `pb-[calc(5rem+env(safe-area-inset-bottom))]` so content clears the
  home indicator.
- [x] **Numbers larger than the avatar** — `whitespace-nowrap` on the
  amount span landed earlier (see `transaction-row.tsx`).

## 9. Tests

Currently zero. Areas where tests would actually catch regressions:

- [ ] **Sheet parser** — feed `/tmp/budget.xlsx` and snapshot the
  parsed structure. Catches accidental TOTAL_TOKENS regressions and
  column-shift bugs.
- [ ] **Payday-month math** — `paydayMonthFor(date, dayN)` for edge
  cases (Jan 1, Feb 29 leap year, day 28 boundary).
- [ ] **Matching engine** — given fixture rules + transactions,
  assert outputs.

Ship as Vitest in `code/test/` with `pnpm test` script.

## 10. Multi-month backlog (surfaced after 90-day Enable Banking sync)

Until May 2026 the app held ~30 days of CSV data, so several screens were
implicitly built around a single payday-month. The Enable Banking
integration now backfills ~90 days on first connect, exposing assumptions
that don't hold across multiple months.

Items are ordered by impact, not by ease.

### Critical — blocking value extraction from history

- [ ] **Inbox: month-aware budget-item picker.** `inbox.list` loads picker
  options from the current payday-month only. A February transaction can
  only be assigned to a May category. Resolve each row's payday-month via
  `paydayMonthFor(tx.bookingDate, paydayDay)` and fetch its month-specific
  items; group the inbox list by month with collapsible headers. (`inbox.ts`,
  `inbox-screen.tsx`, `BudgetItemPicker`.)
- [ ] **"Re-run matching" button.** Auto-rules and learned rules only fire
  on insert. After a user creates a learned rule, every old unmatched txn
  for that merchant stays in inbox forever. Add a tRPC mutation that calls
  `runMatchingForAccount` for every account; expose as a button on
  `/settings/banks` next to the connection panel.
- [ ] **Empty-month banner.** `/month?anchor=YYYY-MM` for a month with no
  imported sheet returns an empty page with no hint. When `monthRow` is
  null but transactions exist for the range, render a banner: "N
  transactions waiting — import the sheet for `<MonthName YYYY>`".

### Important — silent correctness issues

- [ ] **Bulk assign across mixed payday-months.** The bulk picker uses the
  same single-month options. Selecting Feb + May transactions and assigning
  them all to one Item ID resolves to the wrong month for half of them.
  Mirror the existing mixed-scope guard with a mixed-month one.
- [ ] **Forecast source visibility.** `forecast.ts` now blends 3 months of
  history. Surface `source` ("history-median over 3 months", "due-day from
  sheet", "month-end fallback") on the forecast row so the user can override
  one-offs misclassified as recurring.
- [ ] **Auto-rule confidence on quiet success.** `match_rule.confirmedHits`
  only bumps when the user explicitly confirms. Auto-matches the user
  silently accepts stay at 0.7 forever. Daily job to bump `confirmedHits`
  for any auto-rule match older than N days that wasn't reassigned.
  *Opinionated — defer until the categorization mix has settled.*
- [ ] **CSV/sync false-duplicate detection.** Dedupe is `iban + date + cents
  + normalized(counterparty + description)`. Slight formatting differences
  between CSV and Enable Banking would create two rows for the same
  real-world transaction. Add a secondary looser fingerprint and surface
  matches as "possible duplicate" in `/transactions`.

### Multi-month features (now possible, weren't before)

- [ ] **Tikkie multi-month rollup.** `/tikkie` is single-month. A "all
  available months" tab toggle that aggregates by counterparty across the
  full payday-month range we have data for.
- [ ] **Insights vs last month.** `/insights` shows section breakdown for
  the current month with no comparison. Add a "vs last month" delta chip
  per section and the aggregate.
- [ ] **Buckets YTD progress.** `/buckets` shows monthly contribution but
  not cumulative-vs-yearly-target. Sum allocations across all imported
  payday-months in the current calendar year per `savings_account_id`,
  render alongside `yearlyTarget`.

### UI polish

- [ ] **Date-range filter on `/transactions`.** Pill row at the top: Last
  7 / 30 / 90 days / custom. Currently only text + show + scope.
- [ ] **Inline rename for synced bank accounts.** Synced accounts inherit
  whatever Enable Banking returns from `/accounts/<uid>/details`. Add an
  edit field on `/settings/banks/<id>` so the user can override.
- [ ] **Dim navless months in MonthScopeBar.** Going forward is capped at
  `defaultAnchor + 1`. Going back is unbounded; pre-data months render
  empty. Dim months with zero transactions AND zero budget items.

### Hygiene (defer until they actually bite)

- [ ] **Payday-boundary override.** A transaction posted at 00:00:01 on
  payday-day-itself goes into the next month. Rare; no UI to override.
- [ ] **Old `marcio-query-cache-v1` cleanup.** Pre-fix users have stale v1
  data sitting in sessionStorage. One-line cleanup on app boot.
- [ ] **Drop `revoked` enum value.** `bank_connection.status` still has
  `revoked` even though disconnect now hard-deletes. Cosmetic; needs a
  migration.

### Test infra (own commit when there's an hour to spare)

- [ ] **Swap the E2E Neon branch for PGlite.** `tests/e2e/setup/seed.ts`
  currently requires `MARCIO_E2E_DATABASE_URL` pointing at a separate
  Neon branch. PGlite (`@electric-sql/pglite` + `pglite-server`) is a
  real Postgres compiled to WASM that runs in-process — no Docker, no
  cloud, no second DB to admin. Drizzle has a `drizzle-orm/pglite`
  adapter. Same schema, same SQL semantics. Should remove the
  `MARCIO_E2E_DATABASE_URL` requirement entirely.
- [ ] **Add a Vitest integration layer.** Right now the only test suite
  is Playwright, which forces UI rendering for every assertion. Most
  logic bugs (matching engine, payday math, sync field mapping) would
  be better caught by direct tRPC + DB tests. Vitest + PGlite gives
  millisecond-fast tests that exercise real SQL without a browser.
