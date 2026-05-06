/**
 * One-shot seed script: ingest the local budget xlsx + the two mock ING
 * CSVs, then run the matching engine. Use to populate Neon for UI testing.
 *
 *   pnpm tsx scripts/seed-mock.ts
 *
 * Requires DATABASE_URL in .env.local. Reads from src/mockdata/ by default.
 */

import { config } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";

config({ path: ".env.local" });

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..");
const mockDir = join(projectRoot, "src", "mockdata");

async function main() {
  const { readLocalXlsx } = await import("../src/lib/import/source-xlsx.ts");
  const { upsertParsedMonth } = await import("../src/lib/import/upsert.ts");
  const { parseIngCsv } = await import("../src/lib/import/csv-ing.ts");
  const { db } = await import("../src/db/index.ts");
  const { bankAccount, transaction } = await import("../src/db/schema.ts");
  const { runMatchingForAccount } = await import(
    "../src/lib/matching/engine.ts"
  );

  // 1) Ingest the budget xlsx for May 2026.
  const xlsxPath =
    process.env.MARCIO_LOCAL_XLSX ?? "/tmp/budget.xlsx";
  if (existsSync(xlsxPath)) {
    console.log(`📒 Ingesting budget from ${xlsxPath}…`);
    const sheets = await readLocalXlsx(xlsxPath);
    for (const s of sheets) {
      const r = await upsertParsedMonth(s);
      console.log(
        `   ${s.anchorYear}-${String(s.anchorMonth).padStart(2, "0")}: ` +
          `${r.inserted} new · ${r.updated} updated · ${r.unchanged} unchanged`,
      );
    }
  } else {
    console.warn(`⚠️  No xlsx at ${xlsxPath} — skipping budget ingest.`);
  }

  // 2) Ingest each mock CSV under src/mockdata.
  const cases: { file: string; owner: "joint" | "yann" | "camila"; nick: string }[] =
    [
      {
        file: "NL11INGB0661357171_2026-04-25_2026-05-05.csv",
        owner: "yann",
        nick: "Yann personal",
      },
      {
        file: "NL37INGB0110891015_2026-04-25_2026-05-05.csv",
        owner: "joint",
        nick: "Joint checking",
      },
    ];

  for (const c of cases) {
    const path = join(mockDir, c.file);
    if (!existsSync(path)) {
      console.warn(`⚠️  Missing ${c.file} — skipped.`);
      continue;
    }
    console.log(`💳 ${c.file} → ${c.owner}`);
    const buf = readFileSync(path);
    const parsed = parseIngCsv(new Uint8Array(buf));
    if (parsed.rows.length === 0) {
      console.warn(`   no rows parsed: ${parsed.warnings.join("; ")}`);
      continue;
    }

    // Upsert account by IBAN.
    const iban = parsed.accountIban;
    let accountId: string;
    const [existing] = await db
      .select()
      .from(bankAccount)
      .where(eq(bankAccount.iban, iban));
    if (existing) {
      accountId = existing.id;
    } else {
      const [created] = await db
        .insert(bankAccount)
        .values({
          owner: c.owner,
          kind: "checking",
          nickname: c.nick,
          bank: "ING",
          iban,
          lastSyncedAt: new Date(),
        })
        .returning();
      accountId = created.id;
    }

    // Insert transactions (idempotent via dedupe key).
    const result = await db
      .insert(transaction)
      .values(
        parsed.rows.map((r) => ({
          bankAccountId: accountId,
          bookingDate: r.bookingDate,
          amountCents: r.amountCents,
          counterparty: r.counterparty,
          description: r.description,
          dedupeKey: r.dedupeKey,
          status: "booked" as const,
          rawPayload: r.raw,
        })),
      )
      .onConflictDoNothing({
        target: [transaction.bankAccountId, transaction.dedupeKey],
      })
      .returning({ id: transaction.id });

    console.log(
      `   ${result.length} new · ${parsed.rows.length - result.length} duplicates`,
    );

    // Run matching across the account.
    const m = await runMatchingForAccount(accountId);
    console.log(
      `   matched ${m.matched} · skipped (no budget) ${m.skippedNoBudget} · examined ${m.examined}`,
    );
  }

  console.log("✅ done");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
