import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

/** Conexão serverless: use a URL com pooling do provedor em produção. */
export function createDb(url: string): Db {
  return drizzle(postgres(url, { max: 1, prepare: false, onnotice: () => {} }), { schema }) as unknown as Db;
}
let shared: Db | undefined;
export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ausente");
  return (shared ??= createDb(url));
}
/** postgres-js devolve um array; o PGlite (testes) devolve { rows }. Aceita os dois. */
export const rowsOf = <T,>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows ?? []));
