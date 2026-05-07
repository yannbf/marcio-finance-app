/**
 * Integration tests for the settings router. Covers the read/write of
 * the singleton household setting + the privacy + permissions on the
 * connection management procedures.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "../support/test-db.ts";
import { makeAnonCaller, makeAuthedCaller } from "../support/trpc-caller.ts";

const ctx = withTestDb();

let db: typeof import("../../src/db/index.ts")["db"];
let schema: typeof import("../../src/db/schema.ts");
let seedTestDatabase: typeof import("../support/seed.ts")["seedTestDatabase"];

beforeAll(async () => {
  ({ db } = await import("../../src/db/index.ts"));
  schema = await import("../../src/db/schema.ts");
  ({ seedTestDatabase } = await import("../support/seed.ts"));
});

beforeEach(async () => {
  await ctx.reset();
  await seedTestDatabase();
});

describe("settings.get", () => {
  it("returns the seeded payday day", async () => {
    const r = await makeAuthedCaller("yann").settings.get();
    expect(r.paydayDay).toBe(25);
  });
});

describe("settings.setPaydayDay", () => {
  it("rejects an unauthenticated caller", async () => {
    await expect(
      makeAnonCaller().settings.setPaydayDay({ day: 10 }),
    ).rejects.toThrow();
  });

  it("rejects out-of-range days at the input layer", async () => {
    await expect(
      makeAuthedCaller("yann").settings.setPaydayDay({ day: 0 }),
    ).rejects.toThrow();
    await expect(
      makeAuthedCaller("yann").settings.setPaydayDay({ day: 29 }),
    ).rejects.toThrow();
  });

  it("persists a valid update", async () => {
    await makeAuthedCaller("yann").settings.setPaydayDay({ day: 1 });
    const r = await makeAuthedCaller("yann").settings.get();
    expect(r.paydayDay).toBe(1);
  });
});

describe("settings.connections.setAccountOwner", () => {
  it("a yann-role caller cannot flip a camila personal account", async () => {
    const [camilaAcct] = await db
      .select({ id: schema.bankAccount.id })
      .from(schema.bankAccount)
      .where(eq(schema.bankAccount.owner, "camila"));

    const yannCaller = makeAuthedCaller("yann");
    await expect(
      yannCaller.settings.connections.setAccountOwner({
        bankAccountId: camilaAcct.id,
        owner: "yann",
      }),
    ).rejects.toThrow(); // FORBIDDEN
  });

  it("can flip a joint account to a personal scope", async () => {
    const [jointAcct] = await db
      .select({ id: schema.bankAccount.id })
      .from(schema.bankAccount)
      .where(eq(schema.bankAccount.owner, "joint"));

    const r = await makeAuthedCaller("yann").settings.connections.setAccountOwner({
      bankAccountId: jointAcct.id,
      owner: "yann",
    });
    expect(r.ok).toBe(true);
    expect(r.owner).toBe("yann");

    const [updated] = await db
      .select({ owner: schema.bankAccount.owner })
      .from(schema.bankAccount)
      .where(eq(schema.bankAccount.id, jointAcct.id));
    expect(updated.owner).toBe("yann");
  });
});

describe("settings.connections.renameAccount", () => {
  it("trims whitespace and persists the new nickname", async () => {
    const [acct] = await db
      .select({ id: schema.bankAccount.id })
      .from(schema.bankAccount)
      .where(eq(schema.bankAccount.owner, "joint"));

    await makeAuthedCaller("yann").settings.connections.renameAccount({
      bankAccountId: acct.id,
      nickname: "   Renamed Joint   ",
    });
    const [updated] = await db
      .select({ nickname: schema.bankAccount.nickname })
      .from(schema.bankAccount)
      .where(eq(schema.bankAccount.id, acct.id));
    expect(updated.nickname).toBe("Renamed Joint");
  });

  it("rejects empty nicknames at the input layer", async () => {
    const [acct] = await db
      .select({ id: schema.bankAccount.id })
      .from(schema.bankAccount)
      .where(eq(schema.bankAccount.owner, "joint"));
    await expect(
      makeAuthedCaller("yann").settings.connections.renameAccount({
        bankAccountId: acct.id,
        nickname: "",
      }),
    ).rejects.toThrow();
  });
});
