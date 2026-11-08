import { timestamp } from "drizzle-orm/pg-core";
/** Todos os instantes são gravados com fuso (UTC) para evitar ambiguidade. */
export const ts = (name: string) => timestamp(name, { withTimezone: true });
