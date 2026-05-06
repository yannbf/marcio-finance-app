"use client";

import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/server/routers/_app.ts";

export const trpc = createTRPCReact<AppRouter>();
