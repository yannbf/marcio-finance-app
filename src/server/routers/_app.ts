/**
 * Root tRPC router. Mounts every per-domain router under a stable namespace
 * so the client can call `trpc.month.get.useQuery()` etc.
 */

import { router } from "../trpc.ts";
import { sessionRouter } from "./session.ts";
import { settingsRouter } from "./settings.ts";
import { todayRouter } from "./today.ts";
import { monthRouter } from "./month.ts";
import { activityRouter } from "./activity.ts";
import { inboxRouter } from "./inbox.ts";
import { insightsRouter } from "./insights.ts";
import { bucketsRouter } from "./buckets.ts";
import { tikkieRouter } from "./tikkie.ts";
import { transactionsRouter } from "./transactions.ts";
import { savingsRouter } from "./savings.ts";

export const appRouter = router({
  session: sessionRouter,
  settings: settingsRouter,
  today: todayRouter,
  month: monthRouter,
  activity: activityRouter,
  inbox: inboxRouter,
  insights: insightsRouter,
  buckets: bucketsRouter,
  tikkie: tikkieRouter,
  transactions: transactionsRouter,
  savings: savingsRouter,
});

export type AppRouter = typeof appRouter;
