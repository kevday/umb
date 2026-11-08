import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/shared/database/schema";
import type { Db } from "@/shared/database/client";

/** Postgres real em memória (WASM), com todas as migrações, inclusive RLS e triggers. */
export async function testDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "./database/migrations" });
  return db as unknown as Db;
}
