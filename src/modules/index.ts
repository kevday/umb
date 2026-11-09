import { eq } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import { moduleState } from "@/shared/database/schema";
import { ModuleRegistry } from "@/core/module-registry/registry";
import { demoModule } from "./demo/manifest";

/** Todo módulo novo é registrado aqui (e entra no próximo deploy). */
const ALL = [demoModule];

export async function loadRegistry(db: Db): Promise<ModuleRegistry> {
  const r = new ModuleRegistry();
  const rows = await db.select().from(moduleState);
  for (const m of ALL) r.register(m, rows.find((x) => x.id === m.id)?.enabled ?? false);
  return r;
}

export async function setModuleEnabled(db: Db, id: string, enabled: boolean) {
  if (!ALL.some((m) => m.id === id)) throw new Error("módulo desconhecido");
  await db.insert(moduleState).values({ id, enabled }).onConflictDoUpdate({ target: moduleState.id, set: { enabled, updatedAt: new Date() } });
}
