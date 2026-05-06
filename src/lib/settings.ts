import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { householdSetting } from "@/db/schema.ts";

const SINGLETON_ID = "singleton";

export type HouseholdSettings = {
  paydayDay: number;
};

/**
 * Read the singleton household settings row, lazily creating it the first time.
 * Cached on the request via React's deduplication when called from RSCs.
 */
export async function getHouseholdSettings(): Promise<HouseholdSettings> {
  const [row] = await db
    .select()
    .from(householdSetting)
    .where(eq(householdSetting.id, SINGLETON_ID));
  if (row) return { paydayDay: row.paydayDay };

  const [created] = await db
    .insert(householdSetting)
    .values({ id: SINGLETON_ID })
    .onConflictDoNothing()
    .returning();
  return { paydayDay: created?.paydayDay ?? 25 };
}

export async function updatePaydayDay(day: number): Promise<void> {
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    // 28 to keep month math safe for shorter months.
    throw new Error("Payday must be a whole number between 1 and 28.");
  }
  await db
    .insert(householdSetting)
    .values({ id: SINGLETON_ID, paydayDay: day })
    .onConflictDoUpdate({
      target: householdSetting.id,
      set: { paydayDay: day, updatedAt: new Date() },
    });
}
