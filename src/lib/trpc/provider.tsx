"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "./client.ts";

/**
 * Mounts a single QueryClient + tRPC client for the lifetime of the app
 * shell. Stale-time defaults are tuned for "freshness within a session":
 * 30s before refetching on focus, infinite for the per-session cache.
 */
export function TrpcProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
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

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
