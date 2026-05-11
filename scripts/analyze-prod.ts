/**
 * Read-only diagnostic — pulls unmatched transactions + frequent
 * merchants from prod so we can spot patterns worth adding to
 * seed-rules.ts. Touch nothing.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("../src/db/index.ts");

  console.log("\n=== UNMATCHED TXNS — top counterparties (last 120 days) ===\n");
  const unmatched = await db.execute<{
    counterparty: string | null;
    n: string;
    total_cents: string;
    sample_desc: string | null;
    sample_owner: string;
  }>(sql`
    SELECT t.counterparty,
           COUNT(*)::text AS n,
           SUM(t.amount_cents)::text AS total_cents,
           MIN(t.description) AS sample_desc,
           MIN(ba.owner::text) AS sample_owner
    FROM "transaction" t
    JOIN bank_account ba ON ba.id = t.bank_account_id
    LEFT JOIN transaction_match tm ON tm.transaction_id = t.id
    WHERE tm.id IS NULL
      AND t.booking_date > NOW() - INTERVAL '120 days'
      AND t.amount_cents < 0
      AND NOT (COALESCE(t.counterparty, '') ~* 'afronding|notprovided.*spaarrekening|round[[:space:]]*up')
      AND NOT (COALESCE(t.counterparty, '') || ' ' || COALESCE(t.description, '')
               ~* 'spaarrekening|savings[[:space:]]*account')
      AND NOT (COALESCE(t.counterparty, '') || ' ' || COALESCE(t.description, '')
               ~* 'y[[:space:]]*bezerra[[:space:]]*braga[[:space:]]*ferreira|c[[:space:]]*ferrer[[:space:]]*bezerra[[:space:]]*loureiro|contribu(icao|ition|ic|tion)')
    GROUP BY t.counterparty
    ORDER BY COUNT(*) DESC, SUM(t.amount_cents) ASC
    LIMIT 40
  `);

  const rows = unmatched as unknown as Array<{
    counterparty: string | null;
    n: string;
    total_cents: string;
    sample_desc: string | null;
    sample_owner: string;
  }>;

  for (const r of rows) {
    const total = (Number(r.total_cents) / 100).toFixed(2);
    const cp = (r.counterparty ?? "—").slice(0, 50).padEnd(50);
    console.log(
      `  [${r.sample_owner.padEnd(6)}] ${cp} ${r.n.padStart(3)}x  €${total.padStart(9)}`,
    );
    if (r.sample_desc) {
      console.log(`             desc: ${r.sample_desc.slice(0, 120)}`);
    }
  }

  console.log("\n=== UNMATCHED with NULL counterparty (description-only) ===\n");
  const noCp = await db.execute<{
    description: string | null;
    n: string;
    total_cents: string;
    sample_owner: string;
  }>(sql`
    SELECT t.description,
           COUNT(*)::text AS n,
           SUM(t.amount_cents)::text AS total_cents,
           MIN(ba.owner::text) AS sample_owner
    FROM "transaction" t
    JOIN bank_account ba ON ba.id = t.bank_account_id
    LEFT JOIN transaction_match tm ON tm.transaction_id = t.id
    WHERE tm.id IS NULL
      AND t.booking_date > NOW() - INTERVAL '120 days'
      AND t.amount_cents < 0
      AND (t.counterparty IS NULL OR t.counterparty = '')
      AND NOT (COALESCE(t.description, '') ~* 'afronding|spaarrekening|savings')
    GROUP BY t.description
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `);

  const noCpRows = noCp as unknown as Array<{
    description: string | null;
    n: string;
    total_cents: string;
    sample_owner: string;
  }>;
  for (const r of noCpRows) {
    const total = (Number(r.total_cents) / 100).toFixed(2);
    console.log(
      `  [${r.sample_owner.padEnd(6)}] ${r.n.padStart(3)}x  €${total.padStart(9)}  ${(r.description ?? "—").slice(0, 120)}`,
    );
  }

  console.log("\n=== INFLOWS unmatched (positive amounts, last 120 days) ===\n");
  const inflows = await db.execute<{
    counterparty: string | null;
    n: string;
    total_cents: string;
    sample_owner: string;
  }>(sql`
    SELECT t.counterparty,
           COUNT(*)::text AS n,
           SUM(t.amount_cents)::text AS total_cents,
           MIN(ba.owner::text) AS sample_owner
    FROM "transaction" t
    JOIN bank_account ba ON ba.id = t.bank_account_id
    LEFT JOIN transaction_match tm ON tm.transaction_id = t.id
    WHERE tm.id IS NULL
      AND t.booking_date > NOW() - INTERVAL '120 days'
      AND t.amount_cents > 0
      AND NOT (COALESCE(t.counterparty, '') || ' ' || COALESCE(t.description, '')
               ~* 'spaarrekening|savings|contribu|y[[:space:]]*bezerra|c[[:space:]]*ferrer')
    GROUP BY t.counterparty
    ORDER BY SUM(t.amount_cents) DESC
    LIMIT 20
  `);

  const inflowRows = inflows as unknown as Array<{
    counterparty: string | null;
    n: string;
    total_cents: string;
    sample_owner: string;
  }>;
  for (const r of inflowRows) {
    const total = (Number(r.total_cents) / 100).toFixed(2);
    console.log(
      `  [${r.sample_owner.padEnd(6)}] ${(r.counterparty ?? "—").slice(0, 50).padEnd(50)} ${r.n.padStart(3)}x  €${total.padStart(9)}`,
    );
  }

  console.log("\n=== TOTAL UNMATCHED count this month ===\n");
  const totalCount = await db.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n
    FROM "transaction" t
    LEFT JOIN transaction_match tm ON tm.transaction_id = t.id
    WHERE tm.id IS NULL
      AND t.booking_date > NOW() - INTERVAL '30 days'
  `);
  console.log(`  ${(totalCount as unknown as Array<{ n: string }>)[0]?.n} unmatched in last 30 days`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
