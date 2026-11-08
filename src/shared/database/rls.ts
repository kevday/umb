import { sql } from "drizzle-orm";
import type { Db } from "./client";

/**
 * Executa `fn` como o usuário: papel app_reader + app.user_id na transação.
 * Leituras e escritas de conteúdo passam por aqui, e o RLS do banco é a segunda barreira do ACE.
 */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_reader`);
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx as unknown as Db);
  });
}
