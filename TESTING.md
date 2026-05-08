# Testing Marcio

Three layers, all of them run locally with **zero cloud dependencies**:

| Layer | Tool | What it covers | Where it lives |
|-------|------|-----------------|----------------|
| **Unit** | Vitest | Pure logic — payday math, fingerprinting, slugs, rule-confidence, Tikkie parser, cadence | `tests/unit/` |
| **Integration** | Vitest + PGlite | tRPC routers, matching engine, sheet upsert, budget aggregates against real SQL | `tests/integration/` |
| **E2E** | Playwright + PGlite | Browser-driven smoke through the actual Next.js dev server | `tests/e2e/` |

The DB everywhere is **PGlite** — Postgres compiled to WASM, running in-process. Same wire protocol, same Drizzle, same SQL semantics, no Docker, no Neon test branch to babysit, no `MARCIO_E2E_DATABASE_URL` to wire up.

## Quick start

```bash
pnpm test              # unit + integration (Vitest, ~5s)
pnpm test:unit         # just the pure-logic tests
pnpm test:integration  # just the DB-backed tests
pnpm test:e2e          # Playwright (~25s, including dev-server boot)
pnpm test:watch        # Vitest watch mode
```

The first time you touch E2E:

```bash
pnpm exec playwright install chromium
```

That's the only setup. No env file required, no DB to provision.

## How the test DB works

`tests/support/pglite-server.ts` boots a PGlite instance, pushes the Drizzle schema using `drizzle-kit/api`, and exposes it as a real Postgres on a TCP socket via `@electric-sql/pglite-socket`. From there:

- **Vitest integration suites** call `withTestDb()` — each spec file gets its own PGlite instance, schema, and connection URL pointed at it via `process.env.DATABASE_URL`. The same `db` proxy in `src/db/index.ts` that production code uses picks up that URL on first call. No driver swap, no module mocking.
- **Playwright** boots one PGlite socket in `globalSetup`, runs the seed once, then spawns the Next.js dev server pointed at the same URL. Tests share the seeded database (workers: 1).

Schema migrations are handled by `pushSchema(...)` from `drizzle-kit/api`, called in-process. If `src/db/schema.ts` ever drifts from the production migrations the tests fail loudly at boot.

## Fixtures

`tests/support/seed-fixtures.ts` is the source of truth for both Vitest and Playwright. Everything is **fictional** — no real merchant or person names, IBANs all start with `NL00TEST`, amounts are obviously round, no PII. Safe to commit, safe to share.

It seeds:

- 2 users (`Tester Yann`, `Tester Camila`), 3 bank accounts (joint + each personal), `paydayDay = 25`.
- A budget month for **2026-05** with items across `ENTRADAS`, `DIVIDAS`, `FIXAS`, `VARIAVEIS`, `SAZONAIS`. Item names + natural keys are picked to match the **real seed-rule patterns** in `src/lib/matching/seed-rules.ts` so the matching-engine integration tests exercise the production path end-to-end.
- ~17 transactions in the May payday-month: matchable rows (mortgage, energy, two AH grocery hits with city tails, two VGZ premiums distinguished by amount), Tikkie-shaped split-the-bill rows (with `Van Alpha,` / `Van Beta,` descriptions so the parser pulls real names out), plus three "Mystery Vendor" rows that intentionally stay unmatched so the Inbox has work to do.

Today's date for the codebase is `2026-05-08` (set in `AGENTS.md`'s context). Seed data is anchored to that month.

## Auth in tests

The dev server runs with `MARCIO_DEV_AS=yann`, which short-circuits OAuth — `getCurrentUser()` returns a synthetic Yann user without ever talking to Google. The middleware honours the same env var and skips the `/sign-in` redirect.

That bypass also redirects `/sign-in` → `/` because the page itself sees a valid user. The `auth.spec.ts` tests are gated behind `MARCIO_E2E_TEST_AUTH=1` for that reason — to verify the sign-in screen, you have to launch a no-bypass dev server manually:

```bash
DATABASE_URL=<pglite-url> pnpm dev -p 3100 &
MARCIO_E2E_TEST_AUTH=1 pnpm test:e2e tests/e2e/auth.spec.ts
```

Day-to-day, those two tests are skipped.

## Adding tests

### Unit (`tests/unit/`)

Plain Vitest, no DB:

```ts
import { describe, expect, it } from "vitest";
import { paydayMonthFor } from "@/lib/payday.ts";

describe("paydayMonthFor", () => {
  it("...", () => { ... });
});
```

### Integration (`tests/integration/`)

Use `withTestDb()` from `tests/support/test-db.ts`. The helper runs `beforeAll`/`afterAll` to bring up PGlite once per spec file, and exposes `reset()` for between-test truncation. tRPC procedures are exercised through `makeAuthedCaller(role)` from `tests/support/trpc-caller.ts` — same context shape as a real request:

```ts
import { withTestDb } from "../support/test-db.ts";
import { makeAuthedCaller } from "../support/trpc-caller.ts";

const ctx = withTestDb();

describe("today.get", () => {
  beforeEach(async () => {
    await ctx.reset();
    await seedTestDatabase();
  });

  it("returns the right anchor", async () => {
    const r = await makeAuthedCaller("yann").today.get({
      anchor: { year: 2026, month: 5 },
      scope: "joint",
    });
    expect(r.anchor).toEqual({ year: 2026, month: 5 });
  });
});
```

Imports of `src/...` happen lazily inside `beforeAll` so `withTestDb()` has time to set `DATABASE_URL` before any application code touches the DB Proxy.

### E2E (`tests/e2e/`)

Plain Playwright. Specs share one DB with the seed already loaded. Conventions:

- One spec file per route (`<route>.spec.ts`).
- Prefer **role/text-based selectors** (`getByRole`, `getByText`) over CSS — class names churn, role/text don't.
- Use `data-testid` only when role/text aren't unique (sign-in's Google button uses `data-testid="sign-in-google"` for that reason).

## Knobs

| Env var | Default | Effect |
|---------|---------|--------|
| `E2E_PORT` | 3100 | Port the Next.js dev server binds to |
| `MARCIO_E2E_PG_PORT` | 5544 | Port the PGlite socket binds to |
| `MARCIO_E2E_TEST_AUTH` | unset | Run the otherwise-skipped sign-in tests (requires a dev server with `MARCIO_DEV_AS` unset) |

`MARCIO_E2E=1` is set automatically by the Playwright harness — `src/db/index.ts` reads it and caps the postgres-js pool at one connection so concurrent tRPC calls serialise through PGlite cleanly.

## CI

In CI, set `CI=true` so Playwright retries failed tests once and uses the GitHub reporter. Nothing else needs configuring — the test stack is fully self-contained.

## Cleaning up after a crashed run

If a previous test run was killed before teardown, you might see a Next.js dev server still bound to port 3100 or a PGlite socket on 5544:

```bash
pkill -f "next dev -p 3100"
pkill -f "tests/support/pglite"
```

The next `pnpm test:e2e` will boot fresh.
