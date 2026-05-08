"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/query-persist-client-core";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "./client.ts";

/**
 * Mounts a single QueryClient + tRPC client for the lifetime of the app
 * shell. Stale-time defaults are tuned for "freshness within a session":
 * 30s before refetching on focus, infinite for the per-session cache.
 *
 * The cache is mirrored into sessionStorage (per-tab) so a hard reload of
 * the same tab restores the previous data instantly. localStorage would
 * survive cross-tab but also survives sign-out, which we don't want.
 *
 * The persister attaches via `persistQueryClient` in a layout effect
 * AFTER the first render, instead of going through
 * `PersistQueryClientProvider`. The provider gates every query behind
 * `isRestoring` until the async persister's restoreClient resolves —
 * that gate never lifted in our fresh-tab traces (the queries simply
 * never fired), which produced empty pages in headless browsers and
 * recurring "stuck on skeleton" reports. Detaching the persister from
 * the provider keeps the cache mirroring behaviour while letting
 * queries fire on the very first paint.
 */
export function TrpcProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Source data refreshes once a day via Vercel cron at 06:00
            // UTC (Google Sheet + Enable Banking). Real-time mutations
            // by either partner invalidate the relevant queries
            // explicitly, so a stale window of an hour is safe and
            // dramatically reduces cold-function calls. The
            // refetch-on-focus below catches the cross-partner case
            // (Camila assigns a tx → Yann opens his tab) for free.
            staleTime: 60 * 60_000, // 1 hour
            gcTime: 1000 * 60 * 60 * 24, // 24h — kept around for persister
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );

  const [client] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/rpc",
          transformer: superjson,
        }),
      ],
    }),
  );

  // Attach the sessionStorage persister after first paint. Subsequent
  // cache events flow through `persistQueryClientSubscribe` (started by
  // `persistQueryClient`'s restorePromise.then(...)). Restoring on a
  // fresh tab is a no-op (sessionStorage starts empty), so the small
  // delay is invisible to the user. On a hard reload the previous
  // dehydrated state lands once the effect resolves.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem("marcio-query-cache-v1");
    } catch {
      // sessionStorage may be disabled (private mode / quota) — ignore.
    }
    let storage: Storage | null;
    try {
      storage = window.sessionStorage;
    } catch {
      return;
    }
    const persister = createAsyncStoragePersister({
      storage,
      // Bumped to v2 when the serializer changed to superjson; bumping
      // the key starts everyone fresh post-deploy. Bumped to v3 when we
      // detached from PersistQueryClientProvider — entries written by
      // the old code path were never restored under the new flow, so a
      // version bump avoids stale reads on first load.
      key: "marcio-query-cache-v3",
      // superjson preserves Date / Set / Map / BigInt / undefined across
      // a round-trip; plain JSON would drop them.
      serialize: (data) => superjson.stringify(data),
      deserialize: (s) => superjson.parse(s),
    });
    const [unsubscribe] = persistQueryClient({
      queryClient,
      persister,
      maxAge: 1000 * 60 * 30, // 30 min — older entries refetch
      dehydrateOptions: {
        shouldDehydrateQuery: (q) => q.state.status === "success",
      },
    });
    return () => unsubscribe();
  }, [queryClient]);

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
