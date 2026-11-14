import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { testDb } from "../helpers/db";
import { DOCTOR_NOTE, doctor, leastPrivilege, provision } from "@/setup/steps";
import { envFile, generateKey, generatePassword, validateInput, vercelScript, type SetupInput } from "@/setup/config";

const person = (n: string) => ({ name: `Pessoa ${n}`, email: `${n}@exemplo.org`, username: n, password: generatePassword() });
const base = (): SetupInput => ({
  app: { name: "Rede Exemplo", slug: "rede-exemplo", url: "https://rede.exemplo.org", mailFrom: "Rede <no-reply@exemplo.org>", resendKey: "re_AbCdEf123456" },
  db: { url: "postgres://u:p@host/db?sslmode=require&channel_binding=require" }, encKey: generateKey(),
  inst: { jurisdiction: "Potência", lodge: "Loja", evidence: "Ofício nº 1/2026", authority: person("potencia"), venerable: person("venerado") },
  tech: person("tecnico"),
});
const errs = (i: SetupInput) => validateInput(i).errors.join(" | ");

describe("valores que chegam ao .env", () => {
  it("recusa substituição de comando e aspas em APP_URL, RESEND_API_KEY e chave", () => {
    for (const url of ["https://a.org/$(touch pwn)", "https://a.org/`id`", 'https://a.org/"x', "https://a.org/a\\b", "https://a.org/ x", "https://a;b.org", "https://a.org/\nB=1"]) {
      const i = base(); i.app.url = url; expect(errs(i), url).toMatch(/APP_URL/);
    }
    for (const k of ["re_x$(id)", "re_`id`", 're_"x', "re_ x y z q", "curta", "re_a;b;c;d;e"]) {
      const i = base(); i.app.resendKey = k; expect(errs(i), k).toMatch(/RESEND_API_KEY/);
    }
    const i = base(); i.encKey = generateKey().slice(0, 40) + "$(x)"; expect(errs(i)).toMatch(/DATA_ENCRYPTION_KEY/);
    i.encKey = generateKey() + "$(id)"; expect(errs(i)).toMatch(/DATA_ENCRYPTION_KEY/);
  });
  it("aceita valores normais, inclusive a URL do Neon com & e a chave do Resend", () => expect(errs(base())).toBe(""));
  it("todo valor do .env vai entre aspas", () => {
    const i = base(); i.db.migrationUrl = "postgres://u:p@host2/db?sslmode=require&x=1";
    for (const l of envFile(i).split("\n").filter((x) => x && !x.startsWith("#"))) expect(l, l).toMatch(/^[A-Z_]+=".*"$/);
  });
});

describe("script da Vercel", () => {
  it("lê o .env como texto: nada do arquivo é executado e a URL com & chega inteira", () => {
    const dir = mkdtempSync(join(tmpdir(), "vsh-"));
    writeFileSync(join(dir, "vercel-env.sh"), vercelScript(), { mode: 0o700 });
    writeFileSync(join(dir, "vercel"), '#!/bin/sh\necho "$3=$(cat)" >> "$LOG"\n', { mode: 0o755 }); chmodSync(join(dir, "vercel"), 0o755);
    writeFileSync(join(dir, ".env"), [
      'APP_NAME="a $(touch MARK1) b"', 'APP_URL="http://x/`touch MARK2`"', 'APP_SLUG="rede"; touch MARK3',
      'DATABASE_URL="postgres://u:p@h/db?sslmode=require&channel_binding=require"', 'RESEND_API_KEY=""', "",
    ].join("\n"));
    const log = join(dir, "log");
    const r = spawnSync("sh", ["vercel-env.sh"], { cwd: dir, env: { PATH: `${dir}:${process.env.PATH}`, LOG: log } as unknown as NodeJS.ProcessEnv, encoding: "utf8" });
    expect(r.status).toBe(0);
    for (const m of ["MARK1", "MARK2", "MARK3"]) expect(existsSync(join(dir, m)), m).toBe(false);
    const out = readFileSync(log, "utf8");
    expect(out).toContain("DATABASE_URL=postgres://u:p@h/db?sslmode=require&channel_binding=require");
    expect(out).toContain("APP_NAME=a $(touch MARK1) b"); // literal, sem executar
    expect(r.stdout).toContain("RESEND_API_KEY vazio");
  });
  it("não usa source nem eval", () => { const s = vercelScript(); expect(s).not.toMatch(/(^|\n)\s*(\.|source)\s+\.?\/?\.env/); expect(s).not.toMatch(/\beval\b/); });
});

describe("provision e doctor concordam", () => {
  it("administrador técnico excluído é recriado", async () => {
    const db = await testDb(); const i = base();
    expect(await provision(db, { tech: i.tech })).toMatchObject({ tech: "criado" });
    await db.execute(sql`update users set deleted_at = now(), email = 'removido@invalid.local', username = 'removido' where is_technical_admin`);
    const env = { DATA_ENCRYPTION_KEY: generateKey(), APP_URL: "https://x.org", APP_NAME: "X", RESEND_API_KEY: "re_x" };
    expect((await doctor(db, env)).find((c) => c.name === "Administrador técnico")?.level).toBe("error");
    expect(await provision(db, { tech: i.tech })).toMatchObject({ tech: "criado" });
    expect((await doctor(db, env)).find((c) => c.name === "Administrador técnico")?.level).toBe("ok");
  });
  it("estrutura sem autoridade ativa é sinalizada, não recriada", async () => {
    const db = await testDb(); const i = base();
    await provision(db, { inst: i.inst });
    await db.execute(sql`update office_assignments set ends_at = now() - interval '1 day', starts_at = now() - interval '2 days'`);
    expect((await provision(db, { inst: i.inst })).founders).toBe("já existia, mas sem autoridade ativa");
    expect(Number((await db.execute(sql`select count(*)::int as n from jurisdictions`) as unknown as { rows: { n: number }[] }).rows[0].n)).toBe(1);
  });
});

describe("doctor: indicadores e privilégio mínimo", () => {
  it("privilégios do app_reader batem com o esperado e uma concessão indevida é acusada", async () => {
    const db = await testDb();
    expect(await leastPrivilege(db)).toEqual([]);
    await db.execute(sql`grant select on users to app_reader`);
    await db.execute(sql`grant update (hash) on access_audit_logs to app_reader`);
    const bad = await leastPrivilege(db);
    expect(bad).toContain("SELECT em users");
    expect(bad.join(" ")).toContain("UPDATE (colunas) em access_audit_logs");
    const env = { DATA_ENCRYPTION_KEY: generateKey(), APP_URL: "https://x.org", APP_NAME: "X", RESEND_API_KEY: "re_x" };
    expect((await doctor(db, env)).find((c) => c.name === "Privilégios mínimos do app_reader")?.level).toBe("error");
  });
  it("as verificações de isolamento se apresentam como indicadores, com a ressalva", async () => {
    const db = await testDb();
    const names = (await doctor(db, { DATA_ENCRYPTION_KEY: generateKey() })).map((c) => c.name);
    expect(names).toContain("Indicador: RLS habilitado");
    expect(names).toContain("Indicador: SET ROLE app_reader");
    expect(names).not.toContain("RLS nas tabelas de conteúdo");
    expect(DOCTOR_NOTE).toMatch(/NÃO validam o isolamento/);
  });
});
