/**
 * One-off: pull facts to author AI insights from.
 *   - Spend by section, month-over-month (last 3 months).
 *   - Top merchants by total absolute spend.
 *   - Spend trends per top budget item.
 *   - Outliers (single-day spikes).
 *   - Tikkie balance (you paid vs you received).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("../src/db/index.ts");

  console.log("\n=== Spend by section (last 3 anchor months, EUR) ===\n");
  const bySection = await db.execute<{
    anchor: string;
    section: string;
    n: string;
    sum: string;
  }>(sql`
    SELECT TO_CHAR(m.starts_on, 'YYYY-MM') AS anchor,
           bi.section::text AS section,
           COUNT(*)::text AS n,
           SUM(tm.allocated_cents)::text AS sum
    FROM transaction_match tm
    JOIN budget_item bi ON bi.id = tm.budget_item_id
    JOIN "month" m ON m.id = bi.month_id
    JOIN "transaction" t ON t.id = tm.transaction_id
    WHERE t.amount_cents < 0
      AND t.booking_date > NOW() - INTERVAL '120 days'
    GROUP BY m.starts_on, bi.section
    ORDER BY m.starts_on DESC, sum
  `);
  for (const r of bySection as unknown as Array<{ anchor: string; section: string; n: string; sum: string }>) {
    console.log(`  ${r.anchor}  ${r.section.padEnd(12)} ${r.n.padStart(4)}x  €${(Number(r.sum)/100).toFixed(2).padStart(10)}`);
  }

  console.log("\n=== Top 15 merchants by absolute spend (last 90 days) ===\n");
  const topMerchants = await db.execute<{
    counterparty: string | null;
    n: string;
    sum: string;
  }>(sql`
    SELECT t.counterparty,
           COUNT(*)::text AS n,
           SUM(t.amount_cents)::text AS sum
    FROM "transaction" t
    JOIN bank_account ba ON ba.id = t.bank_account_id
    WHERE t.amount_cents < 0
      AND t.booking_date > NOW() - INTERVAL '90 days'
      AND NOT (COALESCE(t.counterparty, '') || ' ' || COALESCE(t.description, '')
               ~* 'afronding|spaarrekening|contribu|y[[:space:]]*bezerra|c[[:space:]]*ferrer')
    GROUP BY t.counterparty
    ORDER BY SUM(t.amount_cents) ASC
    LIMIT 15
  `);
  for (const r of topMerchants as unknown as Array<{ counterparty: string | null; n: string; sum: string }>) {
    console.log(`  ${(r.counterparty ?? "—").slice(0, 40).padEnd(40)} ${r.n.padStart(3)}x  €${(Number(r.sum)/100).toFixed(2).padStart(10)}`);
  }

  console.log("\n=== Top budget items by spend (last 90 days) ===\n");
  const topItems = await db.execute<{
    name: string;
    scope: string;
    section: string;
    n: string;
    sum: string;
  }>(sql`
    SELECT bi.name,
           bi.scope::text AS scope,
           bi.section::text AS section,
           COUNT(*)::text AS n,
           SUM(tm.allocated_cents)::text AS sum
    FROM transaction_match tm
    JOIN budget_item bi ON bi.id = tm.budget_item_id
    JOIN "transaction" t ON t.id = tm.transaction_id
    WHERE t.amount_cents < 0
      AND t.booking_date > NOW() - INTERVAL '90 days'
    GROUP BY bi.name, bi.scope, bi.section
    ORDER BY SUM(tm.allocated_cents) ASC
    LIMIT 15
  `);
  for (const r of topItems as unknown as Array<{ name: string; scope: string; section: string; n: string; sum: string }>) {
    console.log(`  [${r.scope.padEnd(5)}/${r.section.padEnd(10)}] ${r.name.slice(0, 35).padEnd(35)} ${r.n.padStart(3)}x  €${(Number(r.sum)/100).toFixed(2).padStart(10)}`);
  }

  console.log("\n=== Daily spend (last 60 days) ===\n");
  const daily = await db.execute<{
    day: string;
    sum: string;
    n: string;
  }>(sql`
    SELECT t.booking_date::date::text AS day,
           SUM(t.amount_cents)::text AS sum,
           COUNT(*)::text AS n
    FROM "transaction" t
    WHERE t.amount_cents < 0
      AND t.booking_date > NOW() - INTERVAL '60 days'
      AND NOT (COALESCE(t.counterparty, '') || ' ' || COALESCE(t.description, '')
               ~* 'afronding|spaarrekening|contribu|y[[:space:]]*bezerra|c[[:space:]]*ferrer')
    GROUP BY day
    ORDER BY day DESC
    LIMIT 15
  `);
  for (const r of daily as unknown as Array<{ day: string; sum: string; n: string }>) {
    console.log(`  ${r.day}  ${r.n.padStart(3)}x  €${(Number(r.sum)/100).toFixed(2).padStart(10)}`);
  }

  console.log("\n=== Other bucket spend ===\n");
  const otherSpend = await db.execute<{
    scope: string;
    month: string;
    n: string;
    sum: string;
    samples: string;
  }>(sql`
    SELECT bi.scope::text AS scope,
           TO_CHAR(m.starts_on, 'YYYY-MM') AS month,
           COUNT(*)::text AS n,
           SUM(tm.allocated_cents)::text AS sum,
           STRING_AGG(DISTINCT COALESCE(t.counterparty, ''), '; ' ORDER BY COALESCE(t.counterparty, '')) AS samples
    FROM transaction_match tm
    JOIN budget_item bi ON bi.id = tm.budget_item_id
    JOIN "month" m ON m.id = bi.month_id
    JOIN "transaction" t ON t.id = tm.transaction_id
    WHERE bi.natural_key = 'other'
      AND t.amount_cents < 0
    GROUP BY bi.scope, m.starts_on
    ORDER BY m.starts_on DESC, bi.scope
  `);
  for (const r of otherSpend as unknown as Array<{ scope: string; month: string; n: string; sum: string; samples: string }>) {
    console.log(`  ${r.month}  [${r.scope.padEnd(5)}]  ${r.n.padStart(3)}x  €${(Number(r.sum)/100).toFixed(2).padStart(10)}`);
    console.log(`             ${r.samples.slice(0, 150)}`);
  }

  console.log("\n=== Tikkie net (last 120 days) ===\n");
  const tikkie = await db.execute<{
    direction: string;
    n: string;
    sum: string;
  }>(sql`
    SELECT CASE WHEN t.amount_cents > 0 THEN 'received' ELSE 'paid' END AS direction,
           COUNT(*)::text AS n,
           SUM(t.amount_cents)::text AS sum
    FROM "transaction" t
    WHERE (COALESCE(t.counterparty, '') || ' ' || COALESCE(t.description, '')) ~* 'tikkie'
      AND t.booking_date > NOW() - INTERVAL '120 days'
    GROUP BY direction
  `);
  for (const r of tikkie as unknown as Array<{ direction: string; n: string; sum: string }>) {
    console.log(`  ${r.direction.padEnd(10)} ${r.n.padStart(3)}x  €${(Number(r.sum)/100).toFixed(2).padStart(10)}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
