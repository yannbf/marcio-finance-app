import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/db/index.ts");
  const { txMatch } = await import("../src/db/schema.ts");
  const { runMatchingAllAccounts } = await import(
    "../src/lib/matching/engine.ts"
  );

  // Clear auto-rule matches so updated seed rules can re-categorize.
  // Keeps user-confirmed matches in place.
  const deleted = await db
    .delete(txMatch)
    .where(eq(txMatch.source, "auto-rule"))
    .returning({ id: txMatch.id });
  console.log(`cleared ${deleted.length} auto-rule matches`);

  const r = await runMatchingAllAccounts();
  console.log(
    `examined ${r.examined} · matched ${r.matched} · skipped (no budget) ${r.skippedNoBudget}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
