import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Db } from "@/shared/database/client";
import { users } from "@/shared/database/schema";
import { hashPassword } from "@/core/auth/password";
import { bootstrapFounders } from "@/access-control/services/institution";
import { verifyAuditChain } from "@/access-control/audit/store";
import type { Person, SetupInput } from "./config";

export type Level = "ok" | "warn" | "error";
export interface Check { name: string; level: Level; detail: string }

const rows = <T,>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows ?? []));
const one = async <T,>(db: Db, q: ReturnType<typeof sql>) => rows<T>(await db.execute(q))[0];

/** Testa a conexão e as permissões necessárias antes de qualquer alteração. */
export async function checkDatabase(url: string): Promise<{ checks: Check[]; ok: boolean }> {
  const checks: Check[] = [], add = (name: string, level: Level, detail: string) => checks.push({ name, level, detail });
  const c = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} });
  try {
    const [r] = await c`select current_user as u, current_database() as d, current_setting('server_version_num')::int as v,
      (select rolsuper from pg_roles where rolname = current_user) as su, (select rolcreaterole from pg_roles where rolname = current_user) as cr,
      exists (select 1 from pg_roles where rolname = 'app_reader') as ar,
      has_database_privilege(current_user, current_database(), 'CREATE') as dbc, has_schema_privilege(current_user, 'public', 'CREATE') as sc`;
    add("Conexão", "ok", `${r.d} como ${r.u}`);
    add("Versão do PostgreSQL", r.v >= 140000 ? "ok" : "error", `${Math.floor(r.v / 10000)}.${r.v % 10000} (mínimo 14)`);
    add("Permissão de criar tabelas", r.dbc && r.sc ? "ok" : "error", r.dbc && r.sc ? "ok" : "o usuário precisa poder criar objetos no schema public (use o dono do banco)");
    if (r.su) add("Papel do usuário", "warn", "superusuário ignora o RLS nas tabelas dele; prefira um dono sem SUPERUSER");
    if (!r.cr && !r.su && !r.ar) add("Papel app_reader", "error", `não existe e o usuário não pode criá-lo. Peça ao administrador do banco: CREATE ROLE app_reader NOLOGIN; GRANT app_reader TO ${r.u};`);
    else add("Papel app_reader", "ok", r.ar ? "já existe" : "será criado pelas migrações");
    if (/-pooler\./.test(new URL(url).host)) add("Pooling", "warn", "URL com pooling: para as migrações prefira a URL direta (sem -pooler)");
  } catch (e) {
    add("Conexão", "error", `${(e as Error).message}`);
  } finally {
    await c.end({ timeout: 5 }).catch(() => {});
  }
  return { checks, ok: !checks.some((x) => x.level === "error") };
}

export async function applyMigrations(url: string): Promise<void> {
  const c = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try { await migrate(drizzle(c), { migrationsFolder: "./database/migrations" }); } finally { await c.end({ timeout: 5 }); }
}

export async function createTechAdmin(db: Db, p: Person, now = new Date()) {
  await db.insert(users).values({ email: p.email.toLowerCase(), username: p.username, passwordHash: await hashPassword(p.password), emailVerifiedAt: now, isTechnicalAdmin: true });
}

/** Cria o que falta, sem recriar o que já existe (pode ser executado de novo com segurança). */
export async function provision(db: Db, i: Pick<SetupInput, "inst" | "tech">, now = new Date()) {
  const out = { founders: "ignorado" as "criado" | "já existia" | "ignorado", tech: "ignorado" as "criado" | "já existia" | "ignorado" };
  if (i.inst) {
    const has = await one<{ n: number }>(db, sql`select count(*)::int as n from jurisdictions`);
    if (has.n > 0) out.founders = "já existia";
    else {
      await bootstrapFounders(db, {
        jurisdictionName: i.inst.jurisdiction, lodgeName: i.inst.lodge, lodgeNumber: i.inst.lodgeNumber, rite: i.inst.rite, evidence: i.inst.evidence,
        authority: { email: i.inst.authority.email, username: i.inst.authority.username, fullName: i.inst.authority.name, password: i.inst.authority.password },
        venerable: { email: i.inst.venerable.email, username: i.inst.venerable.username, fullName: i.inst.venerable.name, password: i.inst.venerable.password },
      }, now);
      out.founders = "criado";
    }
  }
  if (i.tech) {
    const has = await one<{ n: number }>(db, sql`select count(*)::int as n from users where is_technical_admin`);
    if (has.n > 0) out.tech = "já existia";
    else {
      const clash = await db.select({ id: users.id }).from(users).where(eq(users.email, i.tech.email.toLowerCase()));
      if (clash.length) throw new Error("o e-mail do administrador técnico já pertence a outra conta");
      await createTechAdmin(db, i.tech, now);
      out.tech = "criado";
    }
  }
  return out;
}

export async function doctor(db: Db, env: Record<string, string | undefined>): Promise<Check[]> {
  const out: Check[] = [], add = (name: string, level: Level, detail: string) => out.push({ name, level, detail });
  const major = Number(process.versions.node.split(".")[0]);
  add("Node.js", major >= 20 ? "ok" : "error", `v${process.versions.node} (mínimo 20)`);
  const kok = Buffer.from(env.DATA_ENCRYPTION_KEY ?? "", "base64").length === 32;
  add("DATA_ENCRYPTION_KEY", kok ? "ok" : "error", kok ? "32 bytes em base64" : "inválida ou ausente: deve ter 32 bytes em base64");
  const url = env.APP_URL ?? "";
  add("APP_URL", /^https:\/\//.test(url) ? "ok" : /^http:\/\/(localhost|127\.)/.test(url) ? "warn" : "error", url ? (/^https:\/\//.test(url) ? url : `${url} (produção exige HTTPS)`) : "ausente");
  add("APP_NAME", env.APP_NAME && !/^\[.*\]$/.test(env.APP_NAME) ? "ok" : "warn", env.APP_NAME ? env.APP_NAME : "ausente (será usado o nome provisório)");
  add("E-mail (Resend)", env.RESEND_API_KEY ? "ok" : "warn", env.RESEND_API_KEY ? "configurado" : "sem RESEND_API_KEY: e-mails só no log (convites e redefinição de senha não chegam)");

  try {
    const v = await one<{ v: number }>(db, sql`select current_setting('server_version_num')::int as v`);
    add("PostgreSQL", v.v >= 140000 ? "ok" : "error", `${Math.floor(v.v / 10000)}.${v.v % 10000}`);
    const journal = JSON.parse(readFileSync("database/migrations/meta/_journal.json", "utf8")).entries.length as number;
    const m = await one<{ n: number }>(db, sql`select count(*)::int as n from drizzle.__drizzle_migrations`).catch(() => ({ n: 0 }));
    add("Migrações", m.n === journal ? "ok" : "error", `${m.n} de ${journal} aplicadas${m.n === journal ? "" : " (rode npm run db:migrate)"}`);
    const rls = await one<{ n: number }>(db, sql`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relrowsecurity`);
    add("RLS nas tabelas de conteúdo", rls.n >= 7 ? "ok" : "error", `${rls.n} tabelas com RLS (esperado: 7 ou mais)`);
    try { await db.transaction(async (tx) => { await tx.execute(sql`set local role app_reader`); await tx.execute(sql`select 1`); }); add("Papel app_reader utilizável", "ok", "SET ROLE funciona"); }
    catch (e) { add("Papel app_reader utilizável", "error", `${(e as Error).message}. Rode: GRANT app_reader TO <usuário da aplicação>;`); }
    const j = await one<{ n: number }>(db, sql`select count(*)::int as n from jurisdictions`);
    add("Estrutura institucional", j.n > 0 ? "ok" : "error", j.n > 0 ? `${j.n} jurisdição(ões)` : "vazia: rode npm run setup para criar a fundação");
    const act = (name: string) => sql`select count(distinct user_id)::int as n from office_assignments where name = ${name} and starts_at <= now() and (ends_at is null or ends_at > now())`;
    const pot = await one<{ n: number }>(db, act("Administração da Potência")), vm = await one<{ n: number }>(db, act("Venerável Mestre"));
    add("Administração da Potência ativa", pot.n > 0 ? "ok" : "error", `${pot.n}`);
    add("Venerável Mestre ativo", vm.n > 0 ? "ok" : "error", `${vm.n}`);
    const t = await one<{ n: number }>(db, sql`select count(*)::int as n from users where is_technical_admin and deleted_at is null`);
    add("Administrador técnico", t.n > 0 ? "ok" : "error", `${t.n}`);
    const p2 = await one<{ n: number }>(db, sql`select count(distinct o.user_id)::int as n from office_assignments o
      left join user_totp t on t.user_id = o.user_id and t.confirmed_at is not null
      where o.starts_at <= now() and (o.ends_at is null or o.ends_at > now()) and t.user_id is null`);
    add("2FA das autoridades", p2.n === 0 ? "ok" : "warn", p2.n === 0 ? "todas ativaram" : `${p2.n} autoridade(s) ainda precisam ativar o 2FA no primeiro acesso`);
    const a = await verifyAuditChain(db);
    add("Cadeia de auditoria", a.ok ? "ok" : "error", a.ok ? "íntegra" : `violação no registro ${a.brokenAt}`);
  } catch (e) {
    add("Banco de dados", "error", (e as Error).message);
  }
  return out;
}
