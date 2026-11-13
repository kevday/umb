import { randomBytes, randomInt } from "node:crypto";
import { assertPasswordPolicy } from "@/core/auth/password";

export interface Person { name: string; email: string; username: string; password: string; generated?: boolean }
export interface SetupInput {
  app: { name: string; slug: string; url: string; mailFrom: string; resendKey?: string };
  db: { url: string; migrationUrl?: string };
  encKey: string;
  inst?: { jurisdiction: string; lodge: string; lodgeNumber?: number; evidence: string; authority: Person; venerable: Person };
  tech?: Person;
}

export const slugify = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "rede";
export const generateKey = () => randomBytes(32).toString("base64");
export const usernameFrom = (email: string) => slugify(email.split("@")[0]).replace(/-/g, ".").slice(0, 30).padEnd(3, "x");

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.";
/** Senha forte sem caracteres ambíguos nem que quebrem shell/.env. */
export function generatePassword(len = 20): string {
  for (;;) {
    const p = Array.from({ length: len }, () => ALPHA[randomInt(ALPHA.length)]).join("");
    if (/[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p)) return p;
  }
}

/** Caracteres que quebrariam o .env ou o script de shell gerado. */
const UNSAFE = /["\\`$\r\n]/;
const EMAIL = /^[^\s@"\\`$]+@[^\s@"\\`$]+\.[^\s@"\\`$]+$/;

export function validateInput(i: SetupInput): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const need = (ok: boolean, m: string) => { if (!ok) errors.push(m); };
  const safe = (v: string, what: string) => need(!UNSAFE.test(v), `${what} contém caractere não permitido (aspas, barra invertida, $, crase ou quebra de linha)`);

  need(i.app.name.trim().length >= 2 && i.app.name.length <= 60, "nome do produto: de 2 a 60 caracteres");
  safe(i.app.name, "nome do produto");
  need(/^[a-z0-9-]{2,40}$/.test(i.app.slug), "identificador (slug): letras minúsculas, números e hífen (2 a 40)");
  try {
    const u = new URL(i.app.url);
    need(/^https?:$/.test(u.protocol), "APP_URL deve começar com http:// ou https://");
    if (u.protocol === "http:" && !/^(localhost|127\.|\[::1\])/.test(u.hostname)) warnings.push("APP_URL sem HTTPS: em produção use https:// (cookies seguros e HSTS)");
  } catch { errors.push("APP_URL inválida"); }
  safe(i.app.mailFrom, "remetente de e-mail");
  if (!i.app.resendKey) warnings.push("sem RESEND_API_KEY: e-mails (convites, redefinição de senha) só vão para o log");
  need(/^postgres(ql)?:\/\//.test(i.db.url), "DATABASE_URL deve começar com postgres:// ou postgresql://");
  safe(i.db.url, "DATABASE_URL (codifique caracteres especiais da senha com %XX)");
  if (i.db.migrationUrl) { need(/^postgres(ql)?:\/\//.test(i.db.migrationUrl), "URL de migração inválida"); safe(i.db.migrationUrl, "URL de migração"); }
  need(Buffer.from(i.encKey, "base64").length === 32, "DATA_ENCRYPTION_KEY deve ter 32 bytes em base64");

  const people: [string, Person][] = [];
  if (i.inst) people.push(["Administração da Potência", i.inst.authority], ["Venerável Mestre", i.inst.venerable]);
  if (i.tech) people.push(["Administrador técnico", i.tech]);
  if (i.inst) {
    need(i.inst.jurisdiction.trim().length >= 2, "nome da jurisdição/Potência obrigatório");
    need(i.inst.lodge.trim().length >= 2, "nome da Loja obrigatório");
    need(i.inst.lodgeNumber === undefined || (Number.isInteger(i.inst.lodgeNumber) && i.inst.lodgeNumber >= 1), "número da Loja inválido");
    need(i.inst.evidence.trim().length >= 10, "evidência da indicação pela Potência: mínimo 10 caracteres (ex.: nº do ofício)");
  }
  for (const [label, p] of people) {
    need(p.name.trim().length >= 2 && p.name.length <= 120, `${label}: nome completo obrigatório`);
    need(EMAIL.test(p.email), `${label}: e-mail inválido`);
    need(/^[a-z0-9._-]{3,30}$/.test(p.username), `${label}: usuário com 3 a 30 caracteres (a-z, 0-9, ponto, hífen, sublinhado)`);
    try { assertPasswordPolicy(p.password, p.email, p.username); } catch (e) { errors.push(`${label}: ${(e as Error).message}`); }
  }
  for (const k of ["email", "username"] as const) {
    const seen = new Set<string>();
    for (const [label, p] of people) {
      const v = p[k].toLowerCase();
      if (seen.has(v)) errors.push(`${label}: ${k === "email" ? "e-mail" : "usuário"} repetido; cada conta deve ser uma pessoa distinta`);
      seen.add(v);
    }
  }
  return { errors, warnings };
}

const q = (v: string) => `"${v}"`;
/** Conteúdo do .env (valores já validados contra caracteres inseguros). */
export function envFile(i: SetupInput): string {
  const host = new URL(i.app.url).host;
  const lines = [
    "# Gerado por `npm run setup`. Não versionar. Permissões 600.",
    `APP_NAME=${q(i.app.name)}`, `APP_SLUG=${i.app.slug}`, `APP_DOMAIN=${host}`, `APP_URL=${i.app.url}`, `APP_MAIL_FROM=${q(i.app.mailFrom)}`,
    `DATABASE_URL=${i.db.url}`,
  ];
  if (i.db.migrationUrl) lines.push(`MIGRATION_DATABASE_URL=${i.db.migrationUrl}`);
  lines.push(`DATA_ENCRYPTION_KEY=${i.encKey}`, `RESEND_API_KEY=${i.app.resendKey ?? ""}`);
  return lines.join("\n") + "\n";
}

/** Script POSIX (sh) que envia as variáveis do .env para a Vercel (produção). Requer `vercel login` e `vercel link`. */
export const vercelScript = () => `#!/bin/sh
# Envia as variáveis do .env para o ambiente "production" da Vercel.
# Pré-requisitos: npm i -g vercel; vercel login; vercel link (na pasta do projeto).
set -eu
[ -f .env ] || { echo "arquivo .env não encontrado" >&2; exit 1; }
set -a; . ./.env; set +a
for v in APP_NAME APP_SLUG APP_DOMAIN APP_URL APP_MAIL_FROM DATABASE_URL DATA_ENCRYPTION_KEY RESEND_API_KEY; do
  eval "val=\\"\\\${$v:-}\\""
  if [ -z "$val" ]; then echo "- $v vazio, ignorado"; continue; fi
  printf '%s' "$val" | vercel env add "$v" production --force >/dev/null && echo "+ $v enviado"
done
echo "Pronto. Faça um novo deploy para aplicar."
`;
