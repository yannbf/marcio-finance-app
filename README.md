# Marcio

A calm, mobile-first budgeting app for two. Reads the monthly snapshot from a
Google Sheet, matches real bank transactions to the planned items, and tells
you where you are in the payday-anchored month.

> Months in Marcio open on **day 25** of the previous calendar month and close
> on day 24 — anchored to payday, not to the calendar.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16.2 (App Router, RSC) |
| UI | Tailwind v4 + shadcn/ui + Tremor (charts) |
| Animation | Motion 12 (`motion/react`) |
| State | TanStack Query (client) |
| DB | Postgres (Neon free) |
| ORM | Drizzle |
| Auth | Better Auth — magic link, closed allow-list |
| Email | Resend (free tier) |
| Sheets | googleapis (read-only service account) |
| Bank sync | Phase 2a: CSV import. Phase 2b: Enable Banking |
| i18n | next-intl — pt-BR (default), en |
| Hosting | Vercel Hobby + Neon free |

## Setup

```bash
# 1. Install
pnpm install

# 2. Copy env, fill in DATABASE_URL, BETTER_AUTH_SECRET, allowed emails
cp .env.example .env.local
$EDITOR .env.local

# 3. Push schema to your Neon DB (no migrations yet — schema-first while v1 churns)
pnpm db:push

# 4. Run
pnpm dev
```

The app starts on http://localhost:3000 and redirects to `/pt-BR`.

## Project layout

```
src/
  app/
    [locale]/           # All user-facing routes are locale-prefixed
      layout.tsx        # Root layout: fonts, dark theme, NextIntlClientProvider
      page.tsx          # Hoje / Today
    api/auth/[...all]/  # Better Auth handler
    globals.css         # Design tokens (oklch palette, dark canonical)
  components/
    ui/                 # shadcn primitives
    marcio/             # App-specific components
  db/
    schema.ts           # Drizzle schema (all entities)
    index.ts            # Lazy DB client
  i18n/
    routing.ts          # Locales + default
    request.ts          # Server-side message loader
    navigation.ts       # Locale-aware Link, useRouter
  lib/
    auth/               # Better Auth + closed allow-list
    format.ts           # Intl formatters
    payday.ts           # Day-25 month math
  messages/
    en.json
    pt-BR.json
  middleware.ts         # next-intl locale negotiation
```

## Security

- Magic-link only. No passwords. Closed allow-list (two emails).
- Bank credentials encrypted at rest (libsodium secretbox, key from env).
- All DB queries scope by `userId`; joint resources gate on `accessor in (camila, yann)`.
- No secrets in client bundles. Bank/Sheet calls are server-only.
- Daily nightly DB backup (set up in Phase 7).

## Phases

Shippable increments — every phase produces a usable app.

- ✅ **Phase 0** — Scaffolding, design tokens, i18n, schema sketch (you are here)
- **Phase 1** — Sheet ingestion + Mês screen
- **Phase 2a** — CSV import from ING
- **Phase 2b** — Enable Banking auto-sync
- **Phase 3** — Matching (heuristics, learned rules, Inbox)
- **Phase 4** — Hoje forecast (predicted charge dates, runway curve)
- **Phase 5** — Buckets + Day-25 cycle checklist
- **Phase 6** — i18n polish, PWA, micro-animations, haptics
- **Phase 7** — Hardening (2FA, encrypted backups, Sentry, audit log)
