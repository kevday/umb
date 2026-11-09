import { createDb, type Db } from "@/shared/database/client";
let db: Db | undefined;
export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ausente");
  return (db ??= createDb(url));
}
