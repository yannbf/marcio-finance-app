"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  PersistQueryClientProvider,
  type Persister,
} from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "./client.ts";

/**
 * Mounts a single QueryClient + tRPC client for the lifetime of the app
 * shell. Stale-time defaults are tuned for "freshness within a session":
 * 30s before refetching on focus, infinite for the per-session cache.
 *
 * The cache is mirrored into sessionStorage (per-tab) via
 * PersistQueryClientProvider so a hard reload of the same tab restores
 * the previous data instantly while the network request fires in the
 * background. localStorage would survive cross-tab but also survives
 * sign-out, which we don't want.
 */
export function TrpcProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 1000 * 60 * 60 * 24, // 24h — kept around for persister
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  const [persister] = useState<Persister | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return createAsyncStoragePersister({
        // sessionStorage is sync, but the async persister accepts it — the
        // get/set methods are awaited regardless and `Promise.resolve` of a
        // sync return value is a no-op. The sync persister was deprecated
        // in @tanstack/query 5.x.
        storage: window.sessionStorage,
        // Bumped from v1 → v2 because the serializer changed shape (plain
        // JSON → superjson). Old entries become unreadable; bumping the key
        // sidesteps that by starting fresh on first load post-deploy.
        key: "marcio-query-cache-v2",
        // superjson preserves Date / Set / Map / BigInt / undefined across a
        // round-trip, which plain JSON.stringify silently drops to strings
        // (or omits). Without this, code that calls Date methods on a
        // restored cache value crashes — see the BankConnections regression
        // where `expiresAt.getTime()` threw because the restored value was
        // an ISO string.
        serialize: (data) => superjson.stringify(data),
        deserialize: (s) => superjson.parse(s),
      });
    } catch {
      return null;
    }
  });

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

  // SSR has no window → no persister → fall back to a plain
  // QueryClientProvider. Hydration creates the persister via the
  // useState init and renders the persistent variant from then on.
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      {persister ? (
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: 1000 * 60 * 30, // 30 min — older entries refetch
            dehydrateOptions: {
              shouldDehydrateQuery: (q) => q.state.status === "success",
            },
          }}
        >
          {children}
        </PersistQueryClientProvider>
      ) : (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )}
    </trpc.Provider>
  );
}
