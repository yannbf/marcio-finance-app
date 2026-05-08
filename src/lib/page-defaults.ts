/**
 * Server-side defaults that every authenticated page needs:
 *   - The current payday-month anchor (server-computed so the client
 *     doesn't need paydayDay).
 *   - The user's last-chosen scope (cookie).
 *   - The current user's role — passed straight through to the
 *     MonthScopeBar so the "Me" pill can render on the very first
 *     paint without waiting for `session.me` to resolve client-side.
 *     Without this, every route navigation flashed the "Me" pill out
 *     of existence for ~50 ms (it's gated on `mounted && me.data`),
 *     which read like the scope toggle had reverted.
 *
 * Ten lines of SQL, called from every page — pull it into one helper
 * so the page bodies stay focused on what's specific to them.
 */

import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { getHouseholdSettings } from "@/lib/settings.ts";
import { paydayMonthFor } from "@/lib/payday.ts";
import { readScopeCookie, type Scope } from "@/lib/scope-cookie.ts";

export type PageDefaults = {
  defaultAnchor: { year: number; month: number };
  defaultScope: Scope;
  /** Role of the signed-in user, or `null` for the public/anon path. */
  defaultMeRole: "yann" | "camila" | null;
  /** Useful for the Today header badge — survives the persister round-trip. */
  paydayDay: number;
};

export async function getPageDefaults(): Promise<PageDefaults> {
  const [settings, scope, me] = await Promise.all([
    getHouseholdSettings(),
    readScopeCookie(),
    getCurrentUser(),
  ]);
  const range = paydayMonthFor(new Date(), settings.paydayDay);
  return {
    defaultAnchor: { year: range.anchorYear, month: range.anchorMonth },
    defaultScope: scope,
    defaultMeRole: me?.role ?? null,
    paydayDay: settings.paydayDay,
  };
}
