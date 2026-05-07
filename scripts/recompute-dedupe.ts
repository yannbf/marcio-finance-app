/**
 * One-shot cleanup: recompute every transaction's dedupeKey using the
 * weakened formula (no description) and collapse the duplicates that
 * surface. Idempotent — safe to re-run.
 *
 * Strategy per (bankAccountId, newDedupeKey) cluster:
 *   - Keep the OLDEST transaction (lowest createdAt). Reassign every
 *     tx_match row that pointed at the duplicates to the kept row, then
 *     delete the duplicates.
 *   - Update the kept row's dedupeKey to the new value.
 *
 * Run with: pnpm tsx scripts/recompute-dedupe.ts
 *   pnpm tsx scripts/recompute-dedupe.ts --dry-run    (report only, no writes)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createHash } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";

const DRY = process.argv.includes("--dry-run");

function normalizeForHash(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function newDedupeKey(args: {
  iban: string;
  bookingDate: Date;
  amountCents: number;
  counterparty: string;
}): string {
  const ymd = args.bookingDate.toISOString().slice(0, 10);
  return createHash("sha1")
    .update(
      [
        args.iban ?? "",
        ymd,
        String(args.amountCents),
        normalizeForHash(args.counterparty ?? ""),
      ].join("|"),
    )
    .digest("hex");
}

async function main() {
  const { db } = await import("../src/db/index.ts");
  const { transaction, txMatch, bankAccount } = await import(
    "../src/db/schema.ts"
  );

  console.log(
    DRY ? "[dry-run] " : "",
    "Loading every transaction (this may take a moment)…",
  );

  const rows = await db
    .select({
      id: transaction.id,
      bankAccountId: transaction.bankAccountId,
      bookingDate: transaction.bookingDate,
      amountCents: transaction.amountCents,
      counterparty: transaction.counterparty,
      createdAt: transaction.createdAt,
      iban: bankAccount.iban,
    })
    .from(transaction)
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId))
    .orderBy(asc(transaction.createdAt));

  console.log(`Loaded ${rows.length} transactions.`);

  // Group by (bankAccountId, newDedupeKey).
  const clusters = new Map<
    string,
    { keep: typeof rows[number]; dups: typeof rows }
  >();
  for (const r of rows) {
    const k = newDedupeKey({
      iban: r.iban ?? "",
      bookingDate: r.bookingDate,
      amountCents: r.amountCents,
      counterparty: r.counterparty ?? "",
    });
    const groupKey = `${r.bankAccountId}|${k}`;
    const c = clusters.get(groupKey);
    if (!c) {
      clusters.set(groupKey, { keep: r, dups: [] });
    } else {
      // ORDER BY createdAt ASC means later rows are duplicates of the keeper.
      c.dups.push(r);
    }
  }

  const clustersWithDups = [...clusters.values()].filter(
    (c) => c.dups.length > 0,
  );
  const totalDups = clustersWithDups.reduce(
    (s, c) => s + c.dups.length,
    0,
  );
  console.log(
    `Found ${clustersWithDups.length} duplicate clusters covering ${totalDups} extra rows.`,
  );

  if (clustersWithDups.length === 0) {
    console.log("Nothing to do.");
    process.exit(0);
  }

  if (DRY) {
    for (const c of clustersWithDups.slice(0, 10)) {
      console.log(
        `  keep=${c.keep.id} (${c.keep.counterparty}) drop=${c.dups
          .map((d) => d.id)
          .join(", ")}`,
      );
    }
    console.log("Dry run — no writes performed.");
    process.exit(0);
  }

  let migratedMatches = 0;
  let deletedTxns = 0;
  let updatedKeys = 0;

  for (const c of clustersWithDups) {
    const dupIds = c.dups.map((d) => d.id);

    // Move any tx_match rows from duplicates onto the kept transaction.
    // Use ON CONFLICT DO NOTHING semantics by running deletes first when
    // the keeper already has its own match — the tx_match table doesn't
    // have a unique constraint on transactionId, but multiple matches per
    // transaction don't make sense; prefer the kept row's existing match.
    const keptHasMatch =
      (
        await db
          .select({ n: sql<string>`COUNT(*)` })
          .from(txMatch)
          .where(eq(txMatch.transactionId, c.keep.id))
      )[0].n !== "0";

    if (keptHasMatch) {
      // Drop the duplicates' matches outright.
      await db
        .delete(txMatch)
        .where(inArray(txMatch.transactionId, dupIds));
    } else {
      // Reassign exactly one of the duplicates' matches (if any) to the
      // keeper, then delete the rest.
      const candidates = await db
        .select()
        .from(txMatch)
        .where(inArray(txMatch.transactionId, dupIds));
      if (candidates.length > 0) {
        const winner = candidates[0]!;
        await db
          .update(txMatch)
          .set({ transactionId: c.keep.id })
          .where(eq(txMatch.id, winner.id));
        migratedMatches += 1;
        const remaining = candidates.slice(1).map((m) => m.id);
        if (remaining.length > 0) {
          await db.delete(txMatch).where(inArray(txMatch.id, remaining));
        }
      }
    }

    await db.delete(transaction).where(inArray(transaction.id, dupIds));
    deletedTxns += dupIds.length;
  }

  // Recompute dedupeKey for every surviving transaction so future imports
  // collide cleanly with the unique index. Done in a second pass to avoid
  // racing with the deletion logic above.
  const survivors = await db
    .select({
      id: transaction.id,
      bookingDate: transaction.bookingDate,
      amountCents: transaction.amountCents,
      counterparty: transaction.counterparty,
      iban: bankAccount.iban,
    })
    .from(transaction)
    .innerJoin(bankAccount, eq(bankAccount.id, transaction.bankAccountId));

  for (const s of survivors) {
    const k = newDedupeKey({
      iban: s.iban ?? "",
      bookingDate: s.bookingDate,
      amountCents: s.amountCents,
      counterparty: s.counterparty ?? "",
    });
    await db
      .update(transaction)
      .set({ dedupeKey: k })
      .where(eq(transaction.id, s.id));
    updatedKeys += 1;
  }

  console.log(
    `Done. Deleted ${deletedTxns} duplicate transactions, migrated ${migratedMatches} tx_match rows, updated ${updatedKeys} dedupeKeys.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
