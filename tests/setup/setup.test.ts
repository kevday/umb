import { describe, expect, it } from "vitest";
import { parseEnv } from "node:util";
import { testDb } from "../helpers/db";
import { doctor, provision } from "@/setup/steps";
import { envFile, generateKey, generatePassword, slugify, usernameFrom, validateInput, vercelScript, type SetupInput } from "@/setup/config";
import { assertPasswordPolicy } from "@/core/auth/password";
import { lodges } from "@/shared/database/schema";

const person = (n: string, o: Partial<{ email: string; username: string; password: string }> = {}) => ({
  name: `Pessoa ${n}`, email: o.email ?? `${n}@exemplo.org`, username: o.username ?? n, password: o.password ?? generatePassword(),
});
const base = (): SetupInput => ({
  app: { name: "Rede Exemplo", slug: "rede-exemplo", url: "https://rede.exemplo.org", mailFrom: "Rede Exemplo <no-reply@exemplo.org>", resendKey: "re_AbCdEf123456" },
  db: { url: "postgres://u:p@host:5432/db?sslmode=require" }, encKey: generateKey(),
  inst: { jurisdiction: "Potência Exemplo", lodge: "Loja Exemplo", lodgeNumber: 1, evidence: "Ofício nº 1/2026 da Potência", authority: person("potencia"), venerable: person("venerado") },
  tech: person("tecnico"),
});

describe("utilitários", () => {
  it("slug, usuário e senhas gerados", () => {
    expect(slugify("Nome da Rede Maçônica!")).toBe("nome-da-rede-maconica");
    expect(usernameFrom("João.Silva@exemplo.org")).toMatch(/^[a-z0-9._-]{3,30}$/);
    for (let i = 0; i < 20; i++) { const p = generatePassword(); expect(p).toHaveLength(20); expect(() => assertPasswordPolicy(p)).not.toThrow(); expect(p).not.toMatch(/["\\`$ ]/); }
    expect(Buffer.from(generateKey(), "base64")).toHaveLength(32);
  });
  it(".env gerado é lido pelo Node e o script da Vercel é POSIX", () => {
    const i = base(); i.app.mailFrom = "Rede Exemplo <no-reply@exemplo.org>";
    const e = parseEnv(envFile(i));
    expect(e.APP_NAME).toBe("Rede Exemplo");
    expect(e.APP_MAIL_FROM).toBe("Rede Exemplo <no-reply@exemplo.org>");
    expect(e.APP_DOMAIN).toBe("rede.exemplo.org");
    expect(e.DATABASE_URL).toBe(i.db.url);
    expect(Buffer.from(e.DATA_ENCRYPTION_KEY!, "base64")).toHaveLength(32);
    const s = vercelScript();
    expect(s.startsWith("#!/bin/sh")).toBe(true);
    expect(s).not.toMatch(/\[\[|declare -a|\(\s*\)\s*\{.*\n.*\+=\(/); // sem bashismos/arrays
  });
});

describe("validação", () => {
  it("aceita uma configuração correta", () => expect(validateInput(base()).errors).toEqual([]));
  it("recusa dados ruins e contas repetidas", () => {
    const i = base();
    i.app.slug = "Slug Ruim"; i.app.name = 'com "aspas"'; i.db.url = "mysql://x"; i.encKey = "curta";
    i.inst!.evidence = "curto"; i.inst!.venerable = { ...i.inst!.authority }; i.tech!.password = "123";
    const { errors } = validateInput(i);
    for (const t of ["slug", "nome do produto contém", "DATABASE_URL deve", "DATA_ENCRYPTION_KEY", "evidência", "repetido", "senha"]) expect(errors.join("\n").toLowerCase()).toContain(t.toLowerCase());
  });
  it("avisa sobre HTTP fora de localhost e sobre e-mail ausente", () => {
    const i = base(); i.app.url = "http://rede.exemplo.org"; i.app.resendKey = undefined;
    expect(validateInput(i).warnings.join(" ")).toMatch(/HTTPS/);
    expect(validateInput(i).warnings.join(" ")).toMatch(/RESEND/);
  });
  it("recusa senha com o próprio e-mail ou usuário", () => {
    const i = base(); i.tech = person("administrador", { password: "administrador-123456" });
    expect(validateInput(i).errors.join(" ")).toMatch(/senha/);
  });
});

describe("fundação e verificação", () => {
  it("doctor acusa banco vazio e depois aprova após provisionar; repetir é seguro", async () => {
    const db = await testDb();
    const env = { DATA_ENCRYPTION_KEY: generateKey(), APP_URL: "https://rede.exemplo.org", APP_NAME: "Rede Exemplo", RESEND_API_KEY: "re_x" };
    const before = await doctor(db, env);
    expect(before.find((c) => c.name === "Estrutura institucional")?.level).toBe("error");
    const i = base();
    expect(await provision(db, i)).toEqual({ founders: "criado", tech: "criado" });
    expect(await provision(db, i)).toEqual({ founders: "já existia", tech: "já existia" });
    const after = await doctor(db, env);
    expect(after.filter((c) => c.level === "error")).toEqual([]);
    expect(after.find((c) => c.name === "2FA das autoridades")?.level).toBe("warn"); // ainda não ativaram
    expect(after.find((c) => c.name === "Cadeia de auditoria")?.level).toBe("ok");
    expect(after.find((c) => c.name === "Indicador: SET ROLE app_reader")?.level).toBe("ok");
  });
  it("doctor sinaliza chave inválida e URL sem HTTPS", async () => {
    const db = await testDb();
    const r = await doctor(db, { DATA_ENCRYPTION_KEY: "x", APP_URL: "http://rede.exemplo.org" });
    expect(r.find((c) => c.name === "DATA_ENCRYPTION_KEY")?.level).toBe("error");
    expect(r.find((c) => c.name === "APP_URL")?.level).toBe("error");
  });
  it("grava o Rito da Loja na fundação e recusa Rito desconhecido", async () => {
    const db = await testDb();
    const i = base(); i.inst!.rite = "brasileiro";
    expect(validateInput(i).errors).toEqual([]);
    i.inst!.rite = "inventado";
    expect(validateInput(i).errors.join(" ")).toMatch(/Rito desconhecido/);
    i.inst!.rite = "brasileiro";
    await provision(db, { inst: i.inst });
    expect((await db.select().from(lodges))[0].rite).toBe("brasileiro");
  });
  it("recusa administrador técnico com e-mail de outra conta", async () => {
    const db = await testDb();
    const i = base(); await provision(db, { inst: i.inst });
    await expect(provision(db, { tech: { ...person("x"), email: i.inst!.authority.email } })).rejects.toThrow("já pertence");
  });
});
