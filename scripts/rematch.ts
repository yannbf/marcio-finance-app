import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { runMatchingAllAccounts } = await import(
    "../src/lib/matching/engine.ts"
  );
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
