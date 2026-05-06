import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { budgetItem, month } from "@/db/schema.ts";
import type { ParsedSheet, Scope, Section } from "./types.ts";
import { paydayMonthFor } from "../payday.ts";
import { getHouseholdSettings } from "../settings.ts";

export type ImportResult = {
  monthId: string;
  inserted: number;
  updated: number;
  unchanged: number;
  warnings: string[];
};

/**
 * Idempotent upsert of a parsed sheet into the DB.
 *
 * Identity is the natural key (anchorYear, anchorMonth, scope, section, slug).
 * Items not present in the parsed set are left alone — stale rows are surfaced
 * as warnings instead of deleted, because real transactions may already be
 * matched to them and we don't want to break that history.
 */
export async function upsertParsedMonth(
  parsed: ParsedSheet,
): Promise<ImportResult> {
  const settings = await getHouseholdSettings();
  const range = paydayMonthForAnchor(
    parsed.anchorYear,
    parsed.anchorMonth,
    settings.paydayDay,
  );

  const monthRow = await ensureMonth({
    anchorYear: parsed.anchorYear,
    anchorMonth: parsed.anchorMonth,
    startsOn: range.startsOn,
    endsOn: range.endsOn,
  });

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  // Pre-load existing items for the month so we can categorize each upsert
  // outcome without N round trips.
  const existing = await db
    .select()
    .from(budgetItem)
    .where(eq(budgetItem.monthId, monthRow.id));
  const byKey = new Map(
    existing.map((row) => [
      keyOf(row.scope as Scope, row.section as Section, row.naturalKey),
      row,
    ]),
  );
  const seen = new Set<string>();

  for (const item of parsed.items) {
    const k = keyOf(item.scope, item.section, item.naturalKey);
    seen.add(k);

    const prev = byKey.get(k);
    const next = {
      monthId: monthRow.id,
      scope: item.scope,
      section: item.section,
      sazonalKind: item.sazonalKind ?? null,
      naturalKey: item.naturalKey,
      name: item.name,
      nameEn: prev?.nameEn ?? null,
      plannedCents: item.plannedCents,
      cadence: item.cadence,
      dueDay: item.dueDay ?? null,
      savingsBucketId: prev?.savingsBucketId ?? null,
      contributionRatio:
        item.contributionRatio !== undefined
          ? item.contributionRatio.toFixed(4)
          : null,
    };

    if (!prev) {
      await db.insert(budgetItem).values(next);
      inserted++;
      continue;
    }

    if (
      prev.name === next.name &&
      prev.plannedCents === next.plannedCents &&
      prev.cadence === next.cadence &&
      (prev.dueDay ?? null) === (next.dueDay ?? null) &&
      (prev.sazonalKind ?? null) === (next.sazonalKind ?? null) &&
      (prev.contributionRatio ?? null) === (next.contributionRatio ?? null)
    ) {
      unchanged++;
      continue;
    }

    await db
      .update(budgetItem)
      .set({
        name: next.name,
        plannedCents: next.plannedCents,
        cadence: next.cadence,
        dueDay: next.dueDay,
        sazonalKind: next.sazonalKind,
        contributionRatio: next.contributionRatio,
      })
      .where(eq(budgetItem.id, prev.id));
    updated++;
  }

  const stale: string[] = [];
  for (const [k, row] of byKey) {
    if (!seen.has(k)) stale.push(`${row.scope}/${row.section}/${row.name}`);
  }
  const warnings = [
    ...parsed.warnings,
    ...(stale.length > 0
      ? [`Existing items not in this import (kept): ${stale.join(", ")}`]
      : []),
  ];

  return {
    monthId: monthRow.id,
    inserted,
    updated,
    unchanged,
    warnings,
  };
}

async function ensureMonth(args: {
  anchorYear: number;
  anchorMonth: number;
  startsOn: Date;
  endsOn: Date;
}) {
  const [existing] = await db
    .select()
    .from(month)
    .where(
      and(
        eq(month.anchorYear, args.anchorYear),
        eq(month.anchorMonth, args.anchorMonth),
      ),
    );
  if (existing) return existing;
  const [created] = await db
    .insert(month)
    .values({
      anchorYear: args.anchorYear,
      anchorMonth: args.anchorMonth,
      startsOn: args.startsOn,
      endsOn: args.endsOn,
      importedAt: new Date(),
    })
    .returning();
  return created;
}

function keyOf(scope: Scope, section: Section, naturalKey: string) {
  return `${scope}|${section}|${naturalKey}`;
}

function paydayMonthForAnchor(
  anchorYear: number,
  anchorMonth: number,
  paydayDay: number,
) {
  // A point inside the calendar month before payday — paydayMonthFor maps
  // it back to the right anchor.
  const middleOfMonth = new Date(anchorYear, anchorMonth - 1, 10);
  return paydayMonthFor(middleOfMonth, paydayDay);
}
