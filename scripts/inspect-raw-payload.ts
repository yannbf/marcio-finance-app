import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const rows = await sql<{ counterparty: string; amount_cents: number; raw_payload: any }[]>`
    SELECT counterparty, amount_cents, raw_payload
    FROM "transaction"
    WHERE counterparty = 'KPN B.V.'
      AND raw_payload ? 'transaction_amount'
    ORDER BY booking_date DESC
    LIMIT 1
  `;
  for (const r of rows) {
    console.log("counterparty:", r.counterparty);
    console.log("amount_cents:", r.amount_cents);
    console.log("raw_payload keys:", Object.keys(r.raw_payload));
    console.log("raw_payload:", JSON.stringify(r.raw_payload, null, 2));
  }
  await sql.end();
}
main();
