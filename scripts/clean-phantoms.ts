import { config } from "dotenv";
config({ path: ".env.local" });

import { inArray } from "drizzle-orm";

async function main() {
  const { db } = await import("../src/db/index.ts");
  const { budgetItem } = await import("../src/db/schema.ts");

  const phantoms = [
    "entradas",
    "saidas",
    "saídas",
    "dividas",
    "dívidas",
    "economias",
    "fixas",
    "variaveis",
    "variáveis",
    "sazonais",
    "margem",
    "saldo",
  ];
  const r = await db
    .delete(budgetItem)
    .where(inArray(budgetItem.naturalKey, phantoms))
    .returning({ id: budgetItem.id });
  console.log("Deleted", r.length, "phantom rows");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
