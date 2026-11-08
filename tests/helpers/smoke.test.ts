import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDb } from "./db";

describe("migrações", () => {
  it("aplicam em Postgres real", async () => {
    const db = await testDb();
    const r = await db.execute(sql`select count(*)::int as n from pg_policies`);
    expect((r as unknown as { rows: { n: number }[] }).rows[0].n).toBeGreaterThan(10);
  });
});
