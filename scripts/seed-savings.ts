/**
 * One-off seed: insert the three known household savings accounts.
 *
 *   V12602730 → "CC investments" (joint) — also where ING round-up sweeps land
 *   N14631597 → "CC Big fun"     (joint)
 *   A14753415 → "CC Taxas anuais" (joint)
 *
 * Idempotent: ON CONFLICT (ref) updates nickname/notes; ref is the unique
 * key.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("../src/db/index.ts");

  const accounts = [
    {
      ref: "V12602730",
      nickname: "CC investments",
      notes: "Investment/round-up landing pot.",
    },
    { ref: "N14631597", nickname: "CC Big fun", notes: "" },
    { ref: "A14753415", nickname: "CC Taxas anuais", notes: "Annual taxes." },
  ];

  for (const a of accounts) {
    await db.execute(sql`
      INSERT INTO savings_account (ref, nickname, owner, notes)
      VALUES (${a.ref}, ${a.nickname}, 'joint', ${a.notes})
      ON CONFLICT (ref)
      DO UPDATE SET nickname = EXCLUDED.nickname, notes = EXCLUDED.notes
    `);
    console.log(`  ✓ ${a.ref}  ${a.nickname}`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
