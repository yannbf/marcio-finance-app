# Architecture & perf analysis

Why navigating Marcio feels slow today, and how to fix it without
boxing out the future "native app" goal.

> **TL;DR.** App Router is fine for the marketing/auth surface but the
> wrong shape for the **inner mobile-first app** — every tap pays for a
> server round trip + Postgres queries + RSC payload. Move the
> authenticated screens to a **client-routed shell with a TanStack Query
> data layer**, behind a stable API (tRPC or just typed REST). That's
> the smallest change that makes navigation feel instant **and** sets
> you up cleanly for an Expo / React-Native-Web port later.

## Where the slowness comes from (measured)

I sampled cold-then-warm fetches against the local dev server and got
25–55ms server times per route. Production numbers will be similar or
slightly better. So the **server itself is fast**. The slowness lives
elsewhere:

1. **Every nav is a server round trip.** Click `/inbox`, the browser
   asks the server for the page's RSC payload, the server runs
   `getCurrentUser()` + 1–6 Postgres queries + `getHouseholdSettings()`
   + page render, ships back the payload, React reconciles the tree.
   Even if each step is fast in isolation, the **wall-clock cost stacks
   to 200–500ms on a mobile network** because every click is at least
   one round trip on a 100ms-RTT connection. There's no escaping this
   with App Router as long as routes are server-rendered.
2. **No `loading.tsx` skeletons.** While the round trip is in flight the
   user sees the *previous* page or, worse, blank space. Perceived
   speed is mostly about giving the user something visible immediately.
3. **Repeated work per page.** Every screen re-runs `getCurrentUser()`
   (1 query), `getHouseholdSettings()` (1 query), and the page-specific
   queries. None of this is cached across navigations because RSC
   throws the in-memory state away on each navigation. TanStack Query
   on the client would dedupe & cache.
4. **Bottom-nav unmounts on every nav.** It's inside the locale layout,
   which technically remounts on each route change in App Router unless
   you put it in a `template.tsx`. Each remount is cheap but enough
   re-renders + layout shifts add up to "feels twitchy".
5. **Bundle size per route.** Most pages pull in the popover + sheet
   + lucide icons + drizzle types via the client island chain. None of
   this is huge in isolation but it's not great either.

There are also a couple of dev-only effects that **inflate the
slowness in your local experience**:

- Turbopack does first-hit compilation per route — the *very first* nav
  to a route is always slower than subsequent.
- Neon cold-starts: the first query after idle can take 1–2s. Switching
  to a closer region or paying for a hot pool fixes this in production.

## Three architectures, ranked

### Option A — Stay on App Router, tighten what's there (1–2 days of work)

The cheapest path. Won't make navigation truly instant but should move
the feel from "slow" to "acceptable".

- Add `loading.tsx` files for every route group with skeleton cards
  shaped like the real content. Perceived speed goes way up.
- Verify `next-intl`'s `Link` actually prefetches (it should, but
  check). On the bottom-nav, set `prefetch={true}` explicitly. With
  prefetched RSC the round trip happens *before* the click.
- Wrap `getCurrentUser()` in React's `cache()` so multiple calls in one
  render are deduped (probably already cached via Better Auth's headers
  cache, but worth confirming).
- Memoize `getHouseholdSettings()` with `unstable_cache` keyed on
  `settings.updatedAt` (revalidate-on-write).
- Move `BottomNav` into `app/[locale]/template.tsx` so it survives
  navigations.
- Adopt the **View Transitions API** for cross-fade between routes
  (one CSS rule + a tiny opt-in).
- Add a request-cached `useSession()` that reads the session cookie
  client-side so the avatar/name updates without re-running auth.

**Pros**: small diff, ships in a day. Keeps SSR for SEO (irrelevant
here, but harmless) and the simple mental model.

**Cons**: every nav still does a round trip. On mobile networks tap-to-
paint will stay around 200–400ms even when warm. You can't beat physics
with prefetching when the bottom-nav is 5 destinations and the user
clicks one you didn't predict.

### Option B — Authenticated app becomes a client-routed SPA shell (recommended) (1–2 weeks)

The inner authenticated routes become a single SSR'd shell that mounts
a **client router**; pages render as client components hitting a typed
**API** with a TanStack Query cache. Marketing and `/sign-in` stay as
plain App Router pages.

Concrete shape:

```
src/app/
  [locale]/
    sign-in/         (server-rendered, App Router, no nav)
    (app)/
      layout.tsx     (server: fetches session once, mounts client shell)
      app-shell.tsx  ("use client" — TanStack Router, BottomNav, theme)
  api/
    auth/[...all]    (Better Auth)
    rpc/[...all]     (tRPC or simple typed REST: month/inbox/insights/…)
```

What changes:

- Routing inside `(app)` is **client-side only** — clicks don't hit the
  server. Tap-to-paint is sub-50ms because it's just JS + cached data.
- Data fetching uses TanStack Query. First visit fetches; cached visits
  show stale-while-revalidate instantly. Mutations (assign tx, set
  scope) are optimistic; the UI updates before the server replies.
- The whole page-shell (BottomNav, theme provider, scope provider) is
  mounted **once** and never unmounts.
- All your existing server logic becomes endpoints. `assignTransactionAction`
  → `tRPC mutation rpc.transactions.assign`. The matching engine,
  payday math, parsing — none of that changes.
- Better Auth keeps working unchanged.

**Pros**:
- Navigation is **instant**, the way native apps feel.
- Optimistic mutations free.
- The "API + client app" shape is the *exact* shape you need to add a
  React Native Expo client later — same tRPC client, same TanStack
  Query, different navigator.

**Cons**:
- Lose server-rendered HTML for inner pages. Acceptable here — the app
  is gated behind login anyway, no SEO value.
- Need to rewrite each page as a client component reading from queries
  (the JSX largely stays the same; the data-fetching shape changes).
- Have to design the API surface up front. tRPC keeps this cheap.

### Option C — Full rewrite to Expo Router + React Native Web (4–6 weeks)

Skip the middle step and go straight to the cross-platform target.

- File-based routing in Expo (`app/(app)/month.tsx` etc.) covers both
  iOS / Android / web from one codebase.
- React Native primitives + NativeWind (Tailwind-for-RN) replace
  shadcn. Most of the UI ports cleanly; the bottom-sheet would use
  `@gorhom/bottom-sheet` instead of base-ui.
- Web bundle is heavier than a web-only SPA but still tolerable.
- Same Better Auth + same Postgres + tRPC API.

**Pros**: one codebase, real native app on day one of phase 3.

**Cons**:
- Largest rewrite. Throw away the shadcn primitives, the base-ui sheet,
  the Tailwind utility-class muscle memory you've built.
- Web bundle is ~3-5x bigger than a web SPA.
- Some platform-specific work always sneaks in (file pickers, deep
  links, push notifications).

## Recommendation: do A → B, defer C

1. **This week** — Option A's quick wins. They cost a day and they
   visibly improve the feel without committing to anything.
2. **Within 2–4 weeks** — start Option B incrementally. Move one screen
   at a time into `(app)/` (start with `month` since it's the most
   data-heavy and the most-visited). Each migration is independent and
   shippable. By the end you have a fast app *and* a clean API surface.
3. **Whenever you actually want a native app** — Option C is a
   well-defined port from B. The data layer carries over verbatim;
   you're just swapping the UI primitives.

Three reasons not to start at C:
- You don't know yet whether you'll *actually* ship native; B already
  feels native enough on web for many users.
- B unlocks the same perf win in 1/4 the time.
- B's API surface is what you'd need to build for C anyway, so it's
  not throwaway work.

## What I'd avoid

- **Bare `react-router-dom` in a Next shell** — works, but you've now
  got two routers fighting (Next's App Router for the shell + RR for
  the inner). Pick one. If you stay on Next, use Next's router; if you
  go SPA, go all-in.
- **Vite + Express rewrite** — same destination as B but throws away
  the Next middleware (i18n, auth gate, route groups), the Vercel
  deploy pipeline, the existing pages. Not worth the diff.
- **Server Actions as a public API** — they work for in-tree clients
  but they're not stable enough or well-typed enough to be the
  foundation a React Native client calls into. Use tRPC (or even just
  Hono routes returning Zod-validated JSON) for that.

## Next-step checklist if you want me to start Option A

- [ ] Add a top-level `loading.tsx` per route group with skeleton cards
- [ ] Move `BottomNav` into a `template.tsx` so it persists
- [ ] Cache `getCurrentUser()` with `cache()` from `react`
- [ ] Cache `getHouseholdSettings()` with `unstable_cache`, revalidated
      on the settings save action
- [ ] Add `prefetch={true}` to the bottom-nav links
- [ ] Add `view-transition-name` to the main content + a CSS opt-in for
      cross-route fades

Should be ~1 day of work.
