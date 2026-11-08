import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

/** Conexão serverless-friendly: use a URL com pooling do provedor (ex.: Neon pooled). */
export function createDb(url: string): Db {
  return drizzle(postgres(url, { max: 1, prepare: false }), { schema }) as unknown as Db;
}
