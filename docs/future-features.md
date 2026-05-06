# Future features & improvements

A backlog of changes that would meaningfully push Marcio forward. Roughly
ordered by leverage. Each item has enough context that a future agent (or
future you) can pick it up without re-deriving the why.

---

## Tier 1 — finish what's started

These close the loop on work that already landed but isn't fully
exercised.

### 1. Resend domain verification

**Why:** Magic-link is gone but Google OAuth still needs an email address
on the consent screen + your `@anthropic` test users. If the user list
ever grows beyond two, you'll need a verified domain anyway. Spend 10
minutes on this so it isn't blocking later.

### 2. Optimistic UI for inbox + activity assigns

**Why:** tRPC mutations currently invalidate every relevant query and
let TanStack refetch. That's correct but visible — the row briefly
flicks to a loading state. For high-frequency clicks (assigning 5
transactions in a row), users notice.

**How:** add `onMutate` handlers that patch `inbox.list` / `activity.get`
caches in place, then on `onError` roll back. tRPC + TanStack Query has
the `useUtils().inbox.list.setData((old) => …)` pattern for this.

### 3. Loading skeletons for first paint

**Why:** Currently the screens render a small inline skeleton while the
tRPC query lands. App Router supports `loading.tsx` per route — those
skeletons would show *before* the JS bundle parses, which is the real
first-paint window.

**How:** add `src/app/[locale]/<route>/loading.tsx` for inbox, month,
activity, today, insights, buckets, tikkie, transactions. Each is just
the same skeleton blocks already inside the screen, lifted out.

### 4. Persist TanStack Query cache to sessionStorage

**Why:** Right now hard-refreshing a tab re-fetches everything. The data
doesn't change between session-load and session-load, so we can warm the
cache from sessionStorage and avoid the round trip.

**How:** `@tanstack/query-async-storage-persister` + `PersistQueryClientProvider`.
Persist `today`, `month`, `inbox.list` for ~5 min — long enough to feel
"already loaded" when the user comes back to the tab.

---

## Tier 2 — features the user has asked for or will ask for soon

### 5. Recurring rule maintenance UI

**Why:** Right now the Inbox lets you "remember rule" when you assign a
transaction, but there's no way to *unlearn* a rule that turned out to
be wrong. The user has to know to look at the `match_rule` table.

**Build:** a `Settings → Rules` page that lists every learned rule with
its hit count + a delete button. Cheap query, high impact.

### 6. Multiple budget months

**Why:** `month` table supports it but the UI assumes "current
payday-month". You can't drill into "what did April look like?" without
a SQL client.

**Build:** add a month-picker chip to `/month`, `/activity`, `/insights`.
Default to current month; arrow keys / chip carousel to walk back. The
tRPC routers already accept the anchor implicitly via "current month";
add an optional `anchor: { year, month }` input to each.

### 7. Sheet sync as a cron job

**Why:** Already in `FOLLOWUP.md` §3. Adapter exists; just needs a Vercel
cron + a small bearer-secured route.

**Build:**
- `vercel.json`: `{ "crons": [{ "path": "/api/cron/import-sheet", "schedule": "0 6 * * *" }] }`
- `src/app/api/cron/import-sheet/route.ts`: check `Authorization: Bearer ${CRON_SECRET}`, call `readGoogleSheet()` + `upsertParsedMonth()`, return counts.
- Vercel env var `CRON_SECRET`.

### 8. Match-rule confidence learning

**Why:** When the user reassigns a transaction that an auto-rule matched,
that rule was wrong for that case. Right now the rule's confidence
doesn't change. Over time this fills the Inbox with the same wrong
matches.

**Build:** every `inbox.assign` mutation that *replaces* an existing
auto-match should decrement the rule's confidence; every "remember
rule" assign that confirms a previously-suggested match should bump it.
Decay below `0.5` → drop the rule.

### 9. Counterparty fingerprinting

**Why:** ING transactions look like `"AH AMSTERDAM NLD"`, `"AH UTRECHT NLD"`,
`"AH ROTTERDAM NLD"`. The current `escapeForRulePattern` strips trailing
digits but not city tails. Each city becomes its own rule.

**Build:** improve normalization in `src/app/[locale]/inbox/actions.ts`'s
old `escapeForRulePattern` (now in `src/server/routers/inbox.ts`) to
strip Dutch city names from a known list, plus `\sNLD\s*$`, plus
terminal IDs (`Term: BS\d+`).

### 10. Currency support

**Why:** Schema has no `currency` column. Today everything is implicitly
EUR. Travel, salary in another currency, or a partner working remotely
breaks the model.

**Build:** add `currency: text('currency').notNull().default('EUR')` to
both `transaction` and `budget_item`. Store ISO codes. Format helpers
already accept a locale-aware `Intl.NumberFormat`; just pass the actual
currency. Tier-2 because currency conversion (FX rate per day) is a
separate epic.

---

## Tier 3 — production hardening

### 11. Encrypt at rest

**Why:** `bank_account.credentialsEncrypted` is text. The env var
`MARCIO_TOKEN_ENC_KEY` is set but unused. If you ever add Enable Banking
or another aggregator, those tokens land in cleartext.

**Build:** libsodium `secretbox` helper in `src/lib/crypto.ts`,
`encryptForStorage(plain)` / `decryptFromStorage(cipher)`. Wrap in a
test that round-trips a sample.

### 12. Sentry (or similar)

**Why:** A two-user app doesn't need full APM, but a one-line error
tracker catches the kind of "something silently failed when Camila tried
to assign a tx" that you'll otherwise only learn about over coffee.

**Build:** `@sentry/nextjs` free tier, scoped to the locale + auth
routes, with `tunnelRoute` to bypass ad blockers.

### 13. Rate limiting on /api/auth/*

**Why:** Anyone on the internet can hit `/api/auth/sign-in/social` and
trigger a Google OAuth round-trip. Cheap but not free.

**Build:** Vercel Edge Config + a 10/min/IP token bucket OR
`@upstash/ratelimit`.

### 14. 2FA via Better Auth's TOTP plugin

**Why:** Two-user app + financial data + closed allow-list — 2FA is
overkill until the day someone steals one of the Google accounts. Then
it's not.

**Build:** `betterAuth({ plugins: [twoFactor({ ... })] })` + a Settings
page to enroll.

### 15. Audit log UI

**Why:** `tx_match.confirmedByUserId` already records who assigned what.
There's no UI surface — useful for the "wait, did I or did Camila do
this?" moment.

**Build:** small `Settings → Recent activity` showing the last 20
assignments with name + counterparty + timestamp.

### 16. Encrypted nightly DB dump

**Why:** Neon does PITR within a window, but a separately-controlled
backup means a compromised Neon account doesn't take the data.

**Build:** Vercel cron → tiny route that pg_dumps via `pg_dump` (or
Neon's branch-snapshot API), encrypts with a public key, uploads to
Backblaze / R2. Run a restore drill once.

---

## Tier 4 — UX polish

### 17. Pull-to-refresh

**Why:** Mobile-first app, no way to force a sync without nav.

**Build:** small `<PullToRefresh>` wrapper around `<main>` that calls
`utils.invalidate()` on the relevant queries.

### 18. View Transitions on route changes

**Why:** Routes still flash on nav. Even with the cache warm, the
old → new page swap is abrupt. View Transitions API gives a free
cross-fade.

**Build:** `view-transition-name: page-content` on `<main>`, plus a CSS
opt-in. Chrome + Safari 18 support; Firefox graceful degrades.

### 19. Settings page polish

**Why:** Settings is the only page still server-rendered and its theme +
language toggles already write to localStorage / cookies. The payday-day
inline editor still uses a full server action — should move to a
`trpc.settings.setPaydayDay` mutation for consistency + optimistic
update.

**Build:** convert `PaydayInline` to call `trpc.settings.setPaydayDay`
with `onMutate` patching `settings.get` and `today.get` (which renders
the days-until-payday).

### 20. Bottom-sheet pickers feel smoother

**Why:** The hierarchical popover for assigning a transaction is
useful but cramped. On a small phone the section list barely fits.

**Build:** swap the popover for a true bottom-sheet (`<Sheet side="bottom">`,
the same component used elsewhere). Sections list as a horizontal
scrollable chip row at the top, items list below.

### 21. iOS install prompt

**Why:** Manifest is in place but Safari doesn't auto-prompt.

**Build:** detect Safari iOS + standalone mode; if the user is on the
sign-in or today page and not in standalone, show a one-time
"Add to Home Screen" hint.

---

## Tier 5 — adjacent capabilities

### 22. Real bank-sync (Enable Banking / GoCardless)

**Why:** CSV uploads work but require manual effort weekly. A PSD2
aggregator would close the loop.

**Build:** Big project; existing
[FOLLOWUP.md §4](../FOLLOWUP.md) has the shape. Adapter pattern is
already in place (`source-google.ts`, `source-xlsx.ts`, future
`source-enable-banking.ts`).

### 23. Tikkie split-the-bill creation

**Why:** Marcio shows incoming Tikkie payments. It could *generate* one
when the user pays for a shared dinner.

**Build:** Tikkie has a public REST API; create a payment request, embed
the URL into a tx note. Probably needs a Tikkie merchant account.

### 24. AI-assisted categorization for new merchants

**Why:** Seed rules + learned rules cover ~90% of merchants. The long
tail eats Inbox time.

**Build:** when an unmatched tx lands, send `{counterparty, description,
amountCents}` to an LLM with the budget-item list as context, return a
top-3 prediction. Show as a "did you mean…" chip in the picker.

### 25. Native iOS / Android via Expo Router

**Why:** Already discussed in
[architecture-analysis.md](architecture-analysis.md) as Phase C. Now
that everything talks to a tRPC API, the data layer carries over
verbatim — only the UI primitives change.

**Build (when you commit):**
- New repo or workspace, Expo Router app
- Same Better Auth backend, hit
  `${BETTER_AUTH_URL}/api/auth/...` from the native client
- `@trpc/react-query` works in RN — just point at the same `/api/rpc`
  URL
- Replace shadcn primitives with NativeWind + react-native-reusables
- Bottom-sheet via `@gorhom/bottom-sheet`
- Sign-in via the system browser, Better Auth handles the deep-link
  callback (`marcio://auth/callback`).

---

## What I'd leave as-is

A few things look "wrong" but are intentionally simple — adding to them
costs more than it gives back at two-user scale.

- **No multi-tenancy / no orgs.** The app is a household app for two.
  Even an "invite" flow is yagni until there's a third user.
- **No public API.** The tRPC layer is internal; if you want a script
  to talk to Marcio, run it as a server-side script using the same
  internal routers (à la `scripts/seed-mock.ts`).
- **No formal migrations.** Drizzle Kit `push --force` against the prod
  branch is fine for a two-user app on a managed Postgres. When schema
  churn slows, switch to generated migrations — not before.
- **No tests for individual server routers.** The Playwright E2E suite
  exercises the full request → DB → response loop. Unit-testing each
  tRPC procedure on top of that is duplicative.
