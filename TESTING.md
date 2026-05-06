# Testing Marcio

End-to-end tests live in `tests/e2e/` and run with **Playwright** against
a real Next dev server pointed at a **dedicated Postgres** you're happy
to wipe.

## One-time setup

1. **Provision a test database.** A dedicated Neon branch is the easiest
   path — clone your dev branch in the Neon console, then copy its
   connection string. Local Postgres is fine too.
2. **Push the schema** to the test DB:

   ```bash
   DATABASE_URL=<test-connection-string> pnpm db:push --force
   ```

3. **Tell the test runner where the DB lives.** Create
   `.env.test.local` (gitignored) with:

   ```
   MARCIO_E2E_DATABASE_URL=<test-connection-string>
   ```

4. **Install Playwright browsers** (one-time):

   ```bash
   pnpm exec playwright install chromium
   ```

## Day-to-day

```bash
pnpm test:e2e            # headless mobile-Chromium run
pnpm test:e2e:ui         # interactive UI mode
pnpm test:e2e:seed       # wipe + reseed only (no test run)
```

`globalSetup` re-seeds the database before every run, so each suite
starts from a known state.

## What's seeded

`tests/e2e/fixtures/seed-data.ts` is the source of truth. Everything is
**fictional** — no real merchant or person names, IBANs all start with
`NL00TEST`. The seed inserts:

- 2 users (Tester Yann, Tester Camila), 3 bank accounts (joint + each
  personal), with `paydayDay = 25`.
- A budget month for **2026-05** with items across ENTRADAS, FIXAS,
  VARIAVEIS, and SAZONAIS.
- ~12 transactions in the May payday-month: a few that match the seed
  rules (rent, utilities, groceries), a few "Mystery Vendor" rows that
  stay unmatched (so the Inbox has work), and a few Tikkie-shaped rows
  (so `/tikkie` has data).

The current date the app considers "today" is **2026-05-06** (set in
`AGENTS.md`'s context). Seed data is anchored to that month.

## Auth in tests

Tests run with `MARCIO_DEV_AS=yann` set on the dev server, which
short-circuits OAuth: `getCurrentUser()` returns a synthetic Yann user
without ever talking to Google. The middleware honors the same env var
and skips the `/sign-in` redirect. The `auth.spec.ts` file deliberately
clears cookies to verify the sign-in screen still renders correctly.

## Adding tests

- One spec per route, named `<route>.spec.ts`.
- Prefer **role/text-based selectors** (`getByRole`, `getByText`) over
  CSS — the app's class names will keep churning, role/text don't.
- Use `data-testid` only when role/text aren't unique; sign-in's Google
  button uses `data-testid="sign-in-google"` for that reason.
- Tests share one DB and run **sequentially** (workers: 1). If you need
  isolation, write data in a `beforeEach` and clean up in `afterEach`.

## CI

Set `MARCIO_E2E_DATABASE_URL` and `CI=true` in the workflow. With CI=true
Playwright retries failed tests once and uses the GitHub reporter.
