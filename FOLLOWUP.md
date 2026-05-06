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

## 3. Daily Google Sheets sync (cron)

Adapter is implemented (`src/lib/import/source-google.ts`) but only runs
on user-triggered import.

- [ ] `vercel.json` cron config: `0 6 * * *` → `/api/cron/import-sheet`.
- [ ] New route at `src/app/api/cron/import-sheet/route.ts` that
  authenticates via `Authorization: Bearer ${CRON_SECRET}`, calls
  `readGoogleSheet()` + `upsertParsedMonth()` for every returned tab,
  and returns counts.
- [ ] `CRON_SECRET` env var in Vercel.

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

- [ ] **Per-merchant match confidence learning** — track how often a
  rule's match was overridden vs. confirmed; decay confidence
  accordingly.
- [ ] **Date-window guard for repeats** — a recurring rent should only
  match the closest single transaction near its due day, not also a
  refund weeks later that happens to share the counterparty.
- [ ] **Counterparty fingerprinting** — strip city tails ("AMSTERDAM
  NLD"), terminal IDs ("Term: BS154523"), card sequence numbers from
  the counterparty before learning a rule.
- [ ] **Currency** — every amount is treated as EUR. Schema doesn't
  store currency anywhere. Adding ISO codes is a future migration when
  someone earns in another currency.

## 8. Mobile / browser quirks observed

- [ ] **Drag handle on the bottom sheet** — works in Chrome/iOS, but
  the inertia after release could feel snappier. Try `power: 0.6` or
  velocity-based snap thresholds.
- [ ] **Numbers larger than the avatar** — when an amount like
  `-€ 2.943` shows on a row with a long counterparty name, it can
  wrap. Add `whitespace-nowrap` on the amount span in
  `transaction-row.tsx`.

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
