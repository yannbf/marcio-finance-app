/**
 * Closed-list auth: only the two configured emails can sign in.
 * Other addresses get a friendly "not authorized" page (we don't even send
 * a magic link, to avoid revealing whether an email exists).
 */
export const ALLOWED_EMAILS: readonly string[] = (
  process.env.MARCIO_ALLOWED_EMAILS ?? ""
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isAllowed(email: string): boolean {
  if (ALLOWED_EMAILS.length === 0) return false;
  return ALLOWED_EMAILS.includes(email.toLowerCase());
}

/** Map an authorized email to a user role. */
export function roleFor(email: string): "camila" | "yann" | null {
  const e = email.toLowerCase();
  if (e === (process.env.MARCIO_EMAIL_CAMILA ?? "").toLowerCase())
    return "camila";
  if (e === (process.env.MARCIO_EMAIL_YANN ?? "").toLowerCase()) return "yann";
  return null;
}
