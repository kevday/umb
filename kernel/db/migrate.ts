import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { rowsOf, type Db } from "./client";

export interface MigrationSource { module: string; dir: string }

/**
 * Aplica os .sql de cada fonte (núcleo primeiro, depois os módulos), em ordem alfabética e uma única vez.
 * Os comandos de um arquivo são separados por uma linha `-- @@` (funciona em qualquer driver).
 * Todo módulo instalado é migrado, ativo ou não: desativar nunca apaga dados.
 */
export async function runMigrations(db: Db, sources: MigrationSource[], root = process.cwd()): Promise<string[]> {
  await db.execute(sql`create table if not exists kernel_migrations (module text not null, name text not null, applied_at timestamptz not null default now(), primary key (module, name))`);
  const applied: string[] = [];
  for (const src of sources) {
    const dir = join(root, src.dir);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const statements = readFileSync(join(dir, file), "utf8").split(/^-- @@\s*$/m).map((s) => s.trim()).filter(Boolean);
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(7002)`); // deploys simultâneos não migram juntos
        const done = await tx.execute(sql`select 1 as x from kernel_migrations where module = ${src.module} and name = ${file}`);
        if (rowsOf(done).length) return;
        for (const st of statements) await tx.execute(sql.raw(st));
        await tx.execute(sql`insert into kernel_migrations (module, name) values (${src.module}, ${file})`);
        applied.push(`${src.module}/${file}`);
      });
    }
  }
  return applied;
}
