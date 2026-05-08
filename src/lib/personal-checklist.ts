/**
 * Confirmation indicators for the Me view: did this person's salary
 * arrive yet, and did their share of the joint contribution actually
 * transfer? Both are visible in the budget already (yann ENTRADAS
 * salary row, joint ENTRADAS:contrib-yann row), but having a yes/no
 * surface on Today saves a drill-in.
 *
 * Activity uses the same shape to back out the joint-contribution
 * amount from gross planned outflow when computing personal-only
 * "spent vs planned" — same heuristic Today uses, kept in one place
 * so both screens stay in sync.
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/index.ts";
import { budgetItem, txMatch } from "@/db/schema.ts";

export type PersonalChecklist = {
  salary: { plannedCents: number; actualCents: number } | null;
  contribution: { plannedCents: number; actualCents: number } | null;
};

export async function getPersonalChecklist(
  role: "yann" | "camila",
  monthId: string | null,
): Promise<PersonalChecklist> {
  if (!monthId) return { salary: null, contribution: null };

  // Personal salary: any ENTRADAS row in the user's own scope with a
  // contribution_ratio set (the marker for "this is the salary line"
  // — it's the only personal ENTRADAS row that has a ratio).
  const [salary] = await db
    .select({
      plannedCents: sql<string>`COALESCE(SUM(${budgetItem.plannedCents}), 0)`,
      actualCents: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
    })
    .from(budgetItem)
    .leftJoin(txMatch, eq(txMatch.budgetItemId, budgetItem.id))
    .where(
      and(
        eq(budgetItem.monthId, monthId),
        eq(budgetItem.scope, role),
        eq(budgetItem.section, "ENTRADAS"),
        isNotNull(budgetItem.contributionRatio),
      ),
    );

  // Joint contribution from this person: ENTRADAS:contrib-{role} on
  // the joint scope. We only consider the canonical natural keys —
  // any custom rename of those rows would need to keep the same key.
  const [contribution] = await db
    .select({
      plannedCents: sql<string>`COALESCE(SUM(${budgetItem.plannedCents}), 0)`,
      actualCents: sql<string>`COALESCE(SUM(${txMatch.allocatedCents}), 0)`,
    })
    .from(budgetItem)
    .leftJoin(txMatch, eq(txMatch.budgetItemId, budgetItem.id))
    .where(
      and(
        eq(budgetItem.monthId, monthId),
        eq(budgetItem.scope, "joint"),
        eq(budgetItem.section, "ENTRADAS"),
        eq(budgetItem.naturalKey, `contrib-${role}`),
      ),
    );

  return {
    salary:
      salary && Number.parseInt(salary.plannedCents, 10) !== 0
        ? {
            plannedCents: Number.parseInt(salary.plannedCents, 10),
            actualCents: Number.parseInt(salary.actualCents, 10),
          }
        : null,
    contribution:
      contribution && Number.parseInt(contribution.plannedCents, 10) !== 0
        ? {
            plannedCents: Number.parseInt(contribution.plannedCents, 10),
            actualCents: Number.parseInt(contribution.actualCents, 10),
          }
        : null,
  };
}
