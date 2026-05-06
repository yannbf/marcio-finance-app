<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Marcio — agent guide

A calm, mobile-first budgeting app for two. Reads the household budget from a
Google Sheet, matches real bank transactions to planned items, and tells you
where you are in the **payday-anchored** month.

If you're picking up this codebase mid-flight, read `FOLLOWUP.md` first for
the deferred-work backlog, then this file for orientation.

## TL;DR for the next session

- Stack: **Next.js 16.2 (App Router), Tailwind v4, base-ui via shadcn, Drizzle, Postgres (Neon), Better Auth + Google OAuth, next-intl 4 (pt-BR default + en), Motion 12, tRPC 11 + TanStack Query 5**.
- Two users only (Yann + Camila), declared by allow-list (Better Auth `databaseHooks.user.create.before`).
- Months are **payday-anchored** (default day 25). Don't think calendar months — think `paydayMonthFor(date, paydayDay)` and `paydayMonthForAnchor(year, month, paydayDay)` everywhere.
- **Scope** is `joint | yann | camila`. Privacy guards on every server boundary: a personal item / account / savings is only visible to its owner; joint is visible to both. The `scope` URL param + `MonthScopeBar` (a compact `Joint / Me` two-pill toggle with icons) lets the user filter on every page that supports it. The cookie `marcio-month-scope` carries the last-chosen scope across pages.
- **Inner pages are client-rendered** from a tRPC API at `/api/rpc/*` cached by TanStack Query (with sessionStorage persistence). The page boundary is a thin server component that resolves the locale + the default month anchor and mounts a `<…Screen>` client component. The screen reads URL state (`?anchor=YYYY-MM&scope=…`) and calls `trpc.<router>.<proc>.useQuery({ anchor, scope })`. Sign-in and the import flow stay server-rendered.
- Matching engine: hand-tuned **seed rules** in `src/lib/matching/seed-rules.ts` + learned rules in `match_rule` table. Confidence is updated by a Bayesian-ish formula (`lib/matching/rule-confidence.ts`); rules below 0.4 are dropped from the candidate pool. Counterparty fingerprints are normalized via `lib/matching/fingerprint.ts` (city tails, terminal IDs, trailing digits stripped) before learning.
- **Postgres regex gotcha**: `~*` runs POSIX regex, which treats JS-style `\b` as backspace and `\s` as the literal "s". Hardcoded patterns that get shipped to SQL live as separate constants (e.g. `TIKKIE_PG_PATTERN`, `AFRONDING_PG_PATTERN`).
- Production is on Vercel. Dev uses `MARCIO_DEV_AS=yann|camila` to short-circuit auth (hard-gated to `NODE_ENV !== "production"`).

## Layout

```
src/
  app/[locale]/
    layout.tsx                    Root: dark theme, fonts, NextIntlClientProvider, BottomNav
    page.tsx                      → TodayScreen (Hoje)
    month/
      page.tsx                    Month: items per section + scope toggle + paid/unpaid signals
      [itemId]/page.tsx           Item drill-down: planned vs actual + matched txns
    activity/page.tsx             Activity: month txns timeline + forecast + sticky date headers
    inbox/page.tsx                Inbox: unmatched txns, hierarchical assignment popover
    insights/page.tsx             Insights: section breakdown + top categories + top merchants
    buckets/page.tsx              Buckets: SAZONAIS savings progress, grouped by savings_account
    transactions/page.tsx         All Transactions (full searchable history; reachable via /activity "see full history")
    import/page.tsx               Trigger sheet ingest
    settings/
      page.tsx                    Settings index (banks/savings/inbox links + inline payday/lang/theme)
      banks/                      CSV upload + bank-account list + per-account drill
      savings/                    Manage savings_account rows + multi-link to SAZONAIS items
    api/auth/[...all]/route.ts    Better Auth handler
    api/rpc/[trpc]/route.ts       tRPC fetch handler (everything inner UI talks to)
    api/cron/import-sheet/route.ts  Daily Vercel cron — pulls Google Sheets,
                                  upserts each tab, runs the matching engine.
                                  Auth via Authorization: Bearer ${CRON_SECRET}.

  components/
    ui/                           shadcn primitives (button, card, input, select, popover, sheet…)
    marcio/                       App-specific components, including:
                                    - …-screen.tsx files: client components for each route
                                    - month-scope-bar.tsx: ← month → + Joint/Me pill toggle
                                    - budget-item-picker.tsx: hierarchical bottom-sheet
                                    - theme-applier.tsx: keeps html.dark in sync
                                                         across locale switches
                                    - theme-toggle.tsx: Light/Dark/System dropdown
                                    - ios-install-hint.tsx: one-time A2HS hint

  db/
    schema.ts                     ALL tables; single source of truth
    index.ts                      Lazy Drizzle client (Proxy)

  i18n/
    routing.ts                    Locales + default
    request.ts                    Server-side message loader
    navigation.ts                 Locale-aware Link, useRouter

  server/
    trpc.ts                       initTRPC + context (user, allowedScopes) +
                                  resolveVisibleScopes (privacy guard)
    inputs.ts                     Shared zod inputs: AnchorInput, ScopeViewInput
    routers/_app.ts               Root router, mounts everything below
    routers/{today,month,activity,inbox,insights,buckets,tikkie,
            transactions,settings,session}.ts

  lib/
    auth/                         Better Auth + closed allow-list + getCurrentUser()
    trpc/                         createTRPCReact + Provider (incl. sessionStorage persistence)
    matching/                     Seed rules + engine + fingerprint + rule-confidence
    import/                       Sheet/CSV parsers + adapters + DB upsert
    payday.ts                     Payday-month math + paydayMonthForAnchor + shiftAnchor
    settings.ts                   Singleton household_setting helpers
    cadence.ts                    monthlyContributionCents (SAZONAIS yearly → monthly)
    budget-aggregates.ts          Per-section sums for headline screens
    today-data.ts                 Section drill data (paid + expected per item)
    forecast.ts                   Predicted upcoming charges with day-of-month
    format.ts                     Intl formatters
    tikkie.ts                     parseTikkiePerson + TIKKIE_PG_PATTERN

  messages/{en,pt-BR}.json        i18n strings — pt-BR is the canonical copy
  proxy.ts                        next-intl middleware (renamed in Next 16) +
                                  auth gate (redirects to /sign-in when no session)

scripts/
  seed-mock.ts                    Ingest /tmp/budget.xlsx + mockdata CSVs end-to-end
  rematch.ts                      Clear auto-rule matches and re-run matching
  clean-phantoms.ts               Delete phantom budget_item rows from older parser bug
  generate-icons.ts               PWA icons from a single SVG source
  test-fingerprint.ts             Smoke-tests for fingerprintCounterparty

vercel.json                       Cron config: 0 6 * * * → /api/cron/import-sheet
public/theme-init.js              Pre-paint theme bootstrap (loaded from <head>)

tests/e2e/                        Playwright suite — see TESTING.md

public/logos/                     23 brand SVGs/PNGs for the counterparty avatar
public/manifest.webmanifest       PWA manifest + icons
src/mockdata/                     Two ING NL CSVs (gitignored)
```

## Core concepts (worth committing to memory)

### Payday-anchored months

A "May 2026" payday-month runs **April 25 → May 24** when `paydayDay = 25`.
Mortgage on the 1st falls inside the payday-month named after May, not April.

```ts
import { paydayMonthFor } from "@/lib/payday.ts";
const range = paydayMonthFor(new Date(), settings.paydayDay);
// → { anchorYear, anchorMonth, startsOn, endsOn }
```

`startsOn` and `endsOn` are the inclusive timestamp range to filter
transactions for "this month". `anchorYear` / `anchorMonth` keys the `month`
table.

### Scope and privacy

`scope: "joint" | "yann" | "camila"` shows up on `bank_account.owner`,
`budget_item.scope`, `savings_account.owner`, `match_rule.scope`. Server
code resolves the visible scopes once via `getCurrentUser()`:

```ts
const me = await getCurrentUser();
const allowed = me ? ["joint", me.role] : ["joint"];
```

Every page and server action enforces this: a personal item is only readable
by its owner; joint is shared. The schema doesn't enforce it — code does.
Don't skip the check.

### Natural keys

`budget_item.naturalKey` is `slugify(item.name)` and is the **stable handle**
across months. Re-importing the same sheet next month upserts by
`(monthId, scope, section, naturalKey)`. Renaming a row in the sheet creates
a NEW row in the new month — that's a known limitation; we tolerate it
because renames are rare.

### SAZONAIS items are yearly costs

The sheet stores annual amounts on SAZONAIS rows (e.g. €567 OZB tax,
€4000 trip). What lands in the joint account each month is **1/12** of those.
Always run `monthlyContributionCents(planned, "SAZONAIS")` before showing or
summing. Aggregations in `budget-aggregates.ts` use a SQL `CASE` to do this
in one round trip.

### Matching engine flow

1. New transaction lands (CSV upload or future bank sync).
2. `runMatchingForAccount(bankAccountId)` fires.
3. For each unmatched txn:
   - **Savings refs win first**: if counterparty mentions "spaarrekening" and
     description contains a known `savings_account.ref`, route to a budget
     item linked to that account.
   - Otherwise score every seed rule (`SEED_RULES` array) + learned rule
     (`match_rule` table) by confidence, picking the highest-confidence rule
     that matches (regex on counterparty + description, optional amount
     range filter). **Learned rules below `CONFIDENCE_FLOOR` (0.4) are
     skipped** — they exist in the DB for review but don't auto-match.
   - Resolve the target via `(payday-month, scope, section, naturalKey)`. If
     the target item doesn't exist this month, skip — it'll match next time
     the sheet for that month is imported.
   - Insert a `tx_match` row with `source = "auto-rule"`.
4. User can override anything via the Inbox + "remember rule" toggle. The
   counterparty is normalized through `fingerprintCounterparty` (city tail
   + terminal ID + trailing-digit stripper) so similar merchants collapse
   to one rule. On every `inbox.assign` mutation we look at the prior
   `tx_match`: if it was an auto-rule pick that disagreed with the user's
   choice, we bump the matching rule's `overridden_hits`; if the user
   confirmed an existing auto-match (or remembered a rule that already
   exists), we bump `confirmed_hits`. Confidence is recomputed via
   `computeRuleConfidence` (Bayesian-ish, prior 0.7 with weight 4).

### Page → tRPC data flow

Every authenticated page is a thin server boundary that resolves the
locale + the default month anchor and mounts a `<…Screen>` client
component. The screen reads `?anchor=YYYY-MM&scope=…` from the URL
(via `parseSearch` in `month-scope-bar.tsx`) and calls
`trpc.<router>.<proc>.useQuery({ anchor, scope })`. Mutations go via
`trpc.<router>.<proc>.useMutation` and invalidate every query that
could have referenced the changed row (inbox/activity/today/etc.).

Routers are organized one-per-page:

- `today.get` — composite headline numbers + sections + forecast + inboxCount
- `month.get(scope, anchor)` — items + match counts for the chosen scope
- `activity.get` — month timeline + forecast + budget-item options
- `inbox.list` + `inbox.assign` + `inbox.assignMany`
- `insights.get` — section breakdown + top categories + top merchants
- `buckets.get` — savings-account groups + orphans
- `tikkie.get` — per-person totals (uses `TIKKIE_PG_PATTERN` for SQL match)
- `transactions.list({q, show, scope})` — full searchable history
- `settings.get` + `settings.setPaydayDay`
- `session.me`

The TanStack Query cache is **persisted to sessionStorage** for 30 min
so a hard refresh of a tab restores the previous data instantly while
a background refetch lands updates.

### iOS-style bottom sheet

`src/components/ui/sheet.tsx` wraps base-ui Dialog with motion drag.
`side="bottom"` opens with a drag handle pill at top center; the whole
content drags vertically and closes past 120px or a strong fling. The X
button lives **inside** the motion wrapper so it follows the drag.

The sheet now also:
- Drag starts from anywhere inside the motion.div via a single
  `onPointerDown` that calls `controls.start(e)`. If the gesture
  starts inside an element marked `data-sheet-scroll` AND that element
  is scrolled past the top, we let the inner scroll take it — iOS
  pattern.
- Locks `body { overflow: hidden; touch-action: none; }` while open via
  `body[data-sheet-open]` so the page underneath doesn't scroll on iOS
  when a vertical drag escapes the sheet.
- Adds `padding-bottom: env(safe-area-inset-bottom)` so the close button
  isn't behind the iPhone home indicator.

`BudgetItemPicker` (the hierarchical "assign to" picker for inbox /
activity / transactions / bulk-assign) renders as a Sheet rather than a
Popover so it gets the swipe behavior + bigger touch targets for free.

### Daily Google Sheets sync

`vercel.json` schedules `0 6 * * *` (06:00 UTC) → `/api/cron/import-sheet`.
The route authenticates via `Authorization: Bearer ${CRON_SECRET}` (Vercel
sends this automatically), then runs `readGoogleSheet()` →
`upsertParsedMonth()` per tab → `runMatchingAllAccounts()`. Returns
`{ months, inserted, updated, unchanged, matched }`. Manual user-triggered
import via `/import` still works the same way.

### Theme application

The theme has two parts:
- `public/theme-init.js` runs synchronously from `<head>`, reads
  localStorage, sets `.dark` + `color-scheme` before the first paint
  to avoid FOUC.
- `<ThemeApplier />` is a tiny client component mounted in the locale
  layout body that re-runs the same logic in `useLayoutEffect` on
  every render. Without it, switching locale via next-intl's
  `<Link locale={…} />` would have React's reconciler wipe the `.dark`
  class back to the static server value during a soft navigation.

Theme is a compact `<Select>` dropdown; scope (Joint / Me) is a
two-pill radiogroup with `Users` / `User` icons — keeps the toggle
one tap away while staying narrow.

## Conventions

- **TS imports use explicit `.ts` / `.tsx` extensions** (tsconfig has
  `allowImportingTsExtensions: true`). This is non-standard for Next.js
  but lets the same modules be loaded by `tsx` for `scripts/`.
- **Don't add `import "server-only"` to lib modules** — it breaks the dev
  scripts. Next.js is already smart enough about server/client boundaries
  given the deps these files use (postgres, exceljs).
- **next-intl namespaces** — use the namespace argument, not full keys:
  ```ts
  const t = await getTranslations("Inbox");      // good
  t("Inbox.title")                                // bad: namespace duplication
  ```
- **ICU placeholder syntax**: angle-bracket text `<like-this>` is parsed as
  XML tags by next-intl's MessageFormat. Use brackets `[like-this]` instead
  in user-facing copy.
- **Server / client boundary**: don't pass functions from RSCs to client
  components. Pass primitives + locale + currency, format inside the client
  component (see `AnimatedNumber`).
- **PT-BR is the canonical copy**, EN is the translation. Add new keys to
  both files — missing keys throw at runtime.
- **`pnpm db:push --force`** to apply schema changes (TTY-safe). Drizzle
  Kit reads `.env.local` via `dotenv-cli` per the package scripts.
- **Branding/numbers**: every numeric amount uses `.num` class for tabular
  alignment. The `formatEUR()` helper takes a locale; the `AnimatedNumber`
  component caches values in `sessionStorage` so cross-route nav doesn't
  re-animate.

## Common tasks

### Add a new merchant rule

1. `src/lib/matching/seed-rules.ts` — append to the appropriate scope's
   array (`JOINT`, `YANN`, `CAMILA`, `TIKKIE_RULES`).
2. `naturalKey` must match what `slugify()` would emit for the sheet item
   name (e.g. "Plano saúde Yann" → `"plano-saude-yann"`).
3. Re-run `pnpm tsx scripts/rematch.ts` to clear `auto-rule` matches and
   reapply with the new rule.

### Add a brand logo

1. Drop the file into `public/logos/<slug>.<ext>` (svg/png/jpg all work).
2. Add an entry to `LOGO_MAP` in `src/components/marcio/counterparty-avatar.tsx`
   with a regex against `counterparty + description`.
3. The avatar component falls through to a deterministic letter avatar if
   the file 404s, so adding a new logo is non-breaking.

### Add a Settings sub-page

If it's a single control, **inline it on `/settings`** — see
`PaydayInline`, `LanguageSwitch`, `ThemeIndicator` for the pattern. The
user pushed back on dedicated pages for trivial settings. Reserve sub-pages
for list/CRUD work (Banks, Savings).

### Modify the schema

1. Edit `src/db/schema.ts`.
2. `pnpm db:push --force` (this hits the DB pointed at by `DATABASE_URL` in
   `.env.local`).
3. There are no formal migrations yet — Drizzle Kit just diffs and applies.
   For prod, point `DATABASE_URL` at the prod branch and run again.

## Known gotchas

- **`MARCIO_DEV_AS`** sets a synthetic user but only when
  `NODE_ENV !== "production"`. In prod the magic-link flow is the only path
  — and there's no UI for it yet (see `FOLLOWUP.md` §1).
- **Brandfetch downloads** require a real `User-Agent` and `Referer` header
  or you get an HTML consent page back. See the curl in
  `git log --grep "real brand logos"` for the working invocation.
- **Drizzle Kit with `.env.local`** — the package scripts wrap each
  `drizzle-kit` command with `dotenv -e .env.local --` so the same env file
  the app reads is the one Drizzle Kit reads. Don't bypass with `npx`.
- **Round-up "Afronding" sweeps** in ING transactions are filtered from the
  Inbox and Insights via `AFRONDING_PATTERN` (matches "afronding" or
  "notprovided" + "spaarrekening"). Adjust the regex if banks change the
  description format.
- **base-ui Popover/Sheet** uses `render` props for asChild-style behavior;
  it doesn't accept `asChild`. Don't try to port radix patterns directly.

## Production setup status

- Vercel project deployed against the `marcio-app` repo's `main` branch.
- Neon **production** branch created and `DATABASE_URL` points at it in the
  Vercel env vars.
- All other env vars set in Vercel: `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`, `MARCIO_TRUSTED_ORIGINS`, allow-list emails,
  `MARCIO_TOKEN_ENC_KEY`, `RESEND_API_KEY`, `MARCIO_FROM_EMAIL`,
  `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON_B64`.
- `MARCIO_DEV_AS` and `MARCIO_LOCAL_XLSX` deliberately NOT set in prod.
- What's still missing for a real prod log-in flow is in `FOLLOWUP.md` §1.
