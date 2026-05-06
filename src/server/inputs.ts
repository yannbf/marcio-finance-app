import { z } from "zod";

/**
 * Optional payday-month coordinates. When omitted, routers default to the
 * current payday-month derived from the household setting.
 */
export const AnchorInput = z
  .object({
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
  })
  .optional();

/**
 * Optional explicit visible scope. When omitted, routers fall back to the
 * default policy from the request context (joint + caller's role).
 */
export const ScopeViewInput = z.enum(["joint", "yann", "camila"]).optional();
