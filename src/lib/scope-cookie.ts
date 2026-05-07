import { cookies } from "next/headers";

export type Scope = "joint" | "yann" | "camila";

const COOKIE_NAME = "marcio-month-scope";

/**
 * Read the user's last-chosen scope from the household cookie. Pages pass
 * this into client Screens as `defaultScope` so the URL is the primary
 * source of truth, but a tab navigation that drops `?scope=` falls back to
 * what the user picked last instead of resetting to "joint".
 */
export async function readScopeCookie(): Promise<Scope> {
  const c = await cookies();
  const v = c.get(COOKIE_NAME)?.value;
  return v === "yann" || v === "camila" || v === "joint" ? v : "joint";
}
