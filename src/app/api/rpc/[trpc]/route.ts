import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/routers/_app.ts";
import { createContext } from "@/server/trpc.ts";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/rpc",
    req,
    router: appRouter,
    createContext,
    onError({ error, path }) {
      // eslint-disable-next-line no-console
      console.error(`[trpc] ${path ?? "<no-path>"}: ${error.message}`);
    },
  });

export { handler as GET, handler as POST };
