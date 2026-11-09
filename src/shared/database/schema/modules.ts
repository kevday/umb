import { pgTable, text, boolean } from "drizzle-orm/pg-core";
import { ts } from "./_util";

/** Estado dos módulos (o manifesto vive no código). Desativar preserva os dados do módulo. */
export const moduleState = pgTable("module_state", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});
