import "server-only";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { user as userTable } from "@/db/schema.ts";
import { auth } from "./index.ts";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: "camila" | "yann";
};

/**
 * Resolve the current user for a server request.
 *
 * Order:
 *   1. Dev bypass: if NODE_ENV !== "production" and MARCIO_DEV_AS is set,
 *      return a synthetic user (created on first call so FK relations work).
 *   2. Better Auth session via the request headers.
 *   3. Return null → caller redirects to sign-in.
 *
 * The dev bypass is hard-gated to non-production. Even if MARCIO_DEV_AS
 * leaks into a prod env file it's a no-op.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (process.env.NODE_ENV !== "production") {
    const dev = process.env.MARCIO_DEV_AS?.toLowerCase();
    if (dev === "yann" || dev === "camila") {
      return ensureDevUser(dev);
    }
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const u = session.user as {
    id: string;
    email: string;
    name?: string | null;
    role?: "camila" | "yann";
  };
  if (u.role !== "camila" && u.role !== "yann") return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role,
  };
}

async function ensureDevUser(
  role: "yann" | "camila",
): Promise<CurrentUser> {
  const email =
    role === "yann"
      ? (process.env.MARCIO_EMAIL_YANN ?? `${role}@dev.local`).toLowerCase()
      : (process.env.MARCIO_EMAIL_CAMILA ?? `${role}@dev.local`).toLowerCase();

  const [existing] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.email, email));
  if (existing) {
    return {
      id: existing.id,
      email: existing.email,
      name: existing.name,
      role: existing.role as "yann" | "camila",
    };
  }

  const [created] = await db
    .insert(userTable)
    .values({
      id: `dev-${role}`,
      email,
      emailVerified: true,
      name: role === "yann" ? "Yann" : "Camila",
      role,
    })
    .returning();

  return {
    id: created.id,
    email: created.email,
    name: created.name,
    role: created.role as "yann" | "camila",
  };
}
