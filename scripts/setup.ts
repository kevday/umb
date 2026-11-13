/**
 * Configurador: valida o banco, gera a chave de criptografia, grava o .env, aplica as migrações e cria
 * o administrador técnico e as duas primeiras contas institucionais (Administração da Potência e Venerável).
 *
 *   npm run setup                 assistente interativo
 *   npm run setup -- --yes        automático, lendo variáveis de ambiente (ver docs/configurador.md)
 *   opções: --dry-run  --vercel  --no-env  --generate-passwords  --rotate-key  --help
 */
import "@/setup/load-env";
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb } from "@/shared/database/client";
import { envFile, generateKey, generatePassword, slugify, usernameFrom, validateInput, vercelScript, type Person, type SetupInput } from "@/setup/config";
import { applyMigrations, checkDatabase, doctor, provision, type Check } from "@/setup/steps";
import { Prompter } from "@/setup/prompt";

const argv = new Set(process.argv.slice(2));
const flag = (f: string) => argv.has(`--${f}`);
const env = process.env;
const icon = { ok: "✓", warn: "!", error: "✗" } as const;
const show = (cs: Check[]) => cs.forEach((c) => console.log(`  ${icon[c.level]} ${c.name}: ${c.detail}`));
const die = (m: string): never => { console.error(`\n✗ ${m}`); process.exit(1); };

if (flag("help")) {
  console.log(`Uso: npm run setup [-- opções]\n  --yes                 não pergunta; lê as variáveis SETUP_* e DATABASE_URL\n  --dry-run             valida tudo e mostra o plano, sem alterar nada\n  --vercel              gera .setup/vercel-env.sh para enviar as variáveis à Vercel\n  --no-env              não grava o arquivo .env\n  --generate-passwords  gera senhas fortes quando não informadas\n  --rotate-key          gera nova DATA_ENCRYPTION_KEY (invalida os 2FA já cadastrados)\nDocumentação: docs/configurador.md`);
  process.exit(0);
}

const gen = flag("generate-passwords");
function personFromEnv(prefix: string, label: string): Person | undefined {
  const email = env[`${prefix}_EMAIL`];
  if (!email) return undefined;
  const pw = env[`${prefix}_PASSWORD`];
  if (!pw && !gen) die(`${label}: defina ${prefix}_PASSWORD ou use --generate-passwords`);
  return { name: env[`${prefix}_NAME`] ?? label, email, username: env[`${prefix}_USER`] ?? usernameFrom(email), password: pw || generatePassword(), generated: !pw };
}

function fromEnv(): SetupInput {
  const url = env.DATABASE_URL ?? die("DATABASE_URL ausente");
  const name = env.APP_NAME ?? die("APP_NAME ausente");
  const appUrl = env.APP_URL ?? "http://localhost:3000";
  const authority = personFromEnv("SETUP_AUTH", "Administração da Potência"), venerable = personFromEnv("SETUP_VM", "Venerável Mestre");
  if (!!authority !== !!venerable) die("informe as duas contas institucionais (SETUP_AUTH_* e SETUP_VM_*) ou nenhuma");
  const inst = authority && venerable ? {
    jurisdiction: env.SETUP_JURISDICTION ?? die("SETUP_JURISDICTION ausente"), lodge: env.SETUP_LODGE ?? die("SETUP_LODGE ausente"),
    lodgeNumber: env.SETUP_LODGE_NUMBER ? Number(env.SETUP_LODGE_NUMBER) : undefined, evidence: env.SETUP_EVIDENCE ?? die("SETUP_EVIDENCE ausente"), authority, venerable,
  } : undefined;
  return {
    app: { name, slug: env.APP_SLUG ?? slugify(name), url: appUrl, mailFrom: env.APP_MAIL_FROM ?? `${name} <no-reply@${new URL(appUrl).hostname}>`, resendKey: env.RESEND_API_KEY || undefined },
    db: { url, migrationUrl: env.MIGRATION_DATABASE_URL || undefined },
    encKey: !flag("rotate-key") && env.DATA_ENCRYPTION_KEY ? env.DATA_ENCRYPTION_KEY : generateKey(),
    inst, tech: personFromEnv("SETUP_ADMIN", "Administrador técnico"),
  };
}

async function wizard(p: Prompter): Promise<SetupInput> {
  const sec = (t: string) => console.log(`\n== ${t} ==`);
  console.log("Configurador da plataforma. Responda às perguntas; Enter aceita o valor entre colchetes.");
  sec("1. Aplicação");
  const name = await p.ask("Nome do produto", { def: env.APP_NAME && !/^\[.*\]$/.test(env.APP_NAME) ? env.APP_NAME : undefined, validate: (v) => (v.length < 2 ? "mínimo 2 caracteres" : null) });
  const slug = await p.ask("Identificador (slug)", { def: env.APP_SLUG ?? slugify(name), validate: (v) => (/^[a-z0-9-]{2,40}$/.test(v) ? null : "use a-z, 0-9 e hífen") });
  const url = await p.ask("Endereço público (URL)", { def: env.APP_URL ?? "http://localhost:3000", validate: (v) => { try { return /^https?:$/.test(new URL(v).protocol) ? null : "use http:// ou https://"; } catch { return "URL inválida"; } } });
  const mailFrom = await p.ask("Remetente dos e-mails", { def: env.APP_MAIL_FROM ?? `${name} <no-reply@${new URL(url).hostname}>` });
  const resendKey = await p.ask("Chave da API do Resend (Enter para pular; e-mails irão para o log)", { def: env.RESEND_API_KEY, secret: true, optional: true });

  sec("2. Banco de dados (PostgreSQL)");
  let dbUrl = "";
  for (;;) {
    dbUrl = await p.ask("DATABASE_URL (com pooling em produção)", { def: env.DATABASE_URL, secret: true, validate: (v) => (/^postgres(ql)?:\/\//.test(v) ? null : "deve começar com postgres://") });
    const migUrlIn = await p.ask("URL direta, sem pooling, para as migrações (Enter para usar a mesma)", { def: env.MIGRATION_DATABASE_URL, secret: true, optional: true });
    console.log("Testando a conexão...");
    const r = await checkDatabase(migUrlIn || dbUrl);
    show(r.checks);
    if (r.ok) { env.MIGRATION_DATABASE_URL = migUrlIn; break; }
    console.log("Corrija os itens com ✗ e informe de novo.");
  }
  const migrationUrl = env.MIGRATION_DATABASE_URL || undefined;
  const keepKey = !flag("rotate-key") && env.DATA_ENCRYPTION_KEY && Buffer.from(env.DATA_ENCRYPTION_KEY, "base64").length === 32;
  console.log(keepKey ? "Chave de criptografia existente mantida." : "Chave de criptografia nova gerada.");
  const encKey = keepKey ? env.DATA_ENCRYPTION_KEY! : generateKey();

  let inst: SetupInput["inst"], tech: Person | undefined;
  const db = createDb(migrationUrl ?? dbUrl);
  const already = await db.execute(sql`select to_regclass('public.jurisdictions') is not null and exists (select 1 from jurisdictions) as x`).then((r) => ((Array.isArray(r) ? r : (r as { rows: { x: boolean }[] }).rows)[0] as { x: boolean }).x).catch(() => false);
  const person = async (label: string, id: string): Promise<Person> => {
    console.log(`\n${label}`);
    const pname = await p.ask("  Nome completo");
    const email = await p.ask("  E-mail", { validate: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "e-mail inválido") });
    const username = await p.ask("  Usuário", { def: usernameFrom(email), validate: (v) => (/^[a-z0-9._-]{3,30}$/.test(v) ? null : "3 a 30 caracteres: a-z, 0-9, ponto, hífen, sublinhado") });
    const pw = await p.ask(`  Senha (mínimo 12; Enter para gerar uma forte)`, { secret: true, optional: true, validate: (v) => (v.length >= 12 ? null : "mínimo 12 caracteres") });
    void id;
    return { name: pname, email, username, password: pw || generatePassword(), generated: !pw };
  };
  sec("3. Contas iniciais");
  if (already) console.log("Já existe estrutura institucional neste banco: a fundação será mantida (nada será recriado).");
  else {
    console.log("São duas pessoas distintas: a Administração da Potência e o Venerável Mestre da primeira Loja.");
    const jurisdiction = await p.ask("Nome da Potência/jurisdição");
    const lodge = await p.ask("Nome da primeira Loja");
    const num = await p.ask("Número da Loja", { optional: true, validate: (v) => (/^[1-9]\d*$/.test(v) ? null : "número inteiro") });
    const evidence = await p.ask("Evidência da indicação pela Potência (ex.: nº do ofício)", { validate: (v) => (v.length >= 10 ? null : "mínimo 10 caracteres") });
    const authority = await person("Administração da Potência (autoridade maçônica)", "a");
    const venerable = await person("Venerável Mestre da primeira Loja", "v");
    inst = { jurisdiction, lodge, lodgeNumber: num ? Number(num) : undefined, evidence, authority, venerable };
  }
  if (await p.confirm("\nCriar o administrador técnico (infraestrutura, sem autoridade maçônica)?", true)) tech = await person("Administrador técnico", "t");
  return { app: { name, slug, url, mailFrom, resendKey: resendKey || undefined }, db: { url: dbUrl, migrationUrl }, encKey, inst, tech };
}

async function main() {
  const prompter = flag("yes") ? undefined : new Prompter();
  const input = prompter ? await wizard(prompter) : fromEnv();
  const v = validateInput(input);
  v.warnings.forEach((w) => console.log(`! ${w}`));
  if (v.errors.length) die(`configuração inválida:\n  - ${v.errors.join("\n  - ")}`);

  console.log("\nVerificando o banco...");
  const chk = await checkDatabase(input.db.migrationUrl ?? input.db.url);
  show(chk.checks);
  if (!chk.ok) die("o banco não atende aos requisitos (itens com ✗).");

  const plan = [
    flag("no-env") ? null : "gravar .env (backup do anterior, permissão 600)", "aplicar as migrações",
    input.inst ? "criar a fundação: Potência, primeira Loja, Administração da Potência e Venerável (se o banco estiver vazio)" : null,
    input.tech ? "criar o administrador técnico (se ainda não existir)" : null,
  ].filter(Boolean);
  console.log("\nPlano:\n" + plan.map((x) => `  - ${x}`).join("\n"));
  if (flag("dry-run")) { console.log("\n--dry-run: nada foi alterado."); process.exit(0); }
  if (prompter) { const ok = await prompter.confirm("\nExecutar agora?", true); prompter.close(); if (!ok) die("cancelado, nada foi alterado."); }

  if (!flag("no-env")) {
    if (existsSync(".env")) { const bak = `.env.bak-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`; copyFileSync(".env", bak); chmodSync(bak, 0o600); console.log(`  backup: ${bak}`); }
    writeFileSync(".env", envFile(input), { mode: 0o600 }); chmodSync(".env", 0o600); console.log("  ✓ .env gravado (permissão 600)");
  }
  console.log("  Aplicando migrações...");
  await applyMigrations(input.db.migrationUrl ?? input.db.url);
  console.log("  ✓ migrações aplicadas");
  const db = createDb(input.db.url);
  const done = await provision(db, input);
  console.log(`  ✓ fundação: ${done.founders}; administrador técnico: ${done.tech}`);

  Object.assign(process.env, { APP_NAME: input.app.name, APP_URL: input.app.url, DATA_ENCRYPTION_KEY: input.encKey, RESEND_API_KEY: input.app.resendKey ?? "" });
  console.log("\nVerificação final:");
  const final = await doctor(db, process.env);
  show(final);

  const made = [["Administração da Potência", input.inst?.authority, done.founders], ["Venerável Mestre", input.inst?.venerable, done.founders], ["Administrador técnico", input.tech, done.tech]] as const;
  const created = made.filter(([, p, st]) => p && st === "criado");
  if (created.length) {
    console.log("\nContas criadas (anote agora; senhas geradas são exibidas apenas desta vez):");
    for (const [label, p] of created) console.log(`  ${label}: ${p!.email}  usuário: ${p!.username}  senha: ${p!.generated ? p!.password : "(a que você informou)"}`);
  }
  if (flag("vercel")) {
    mkdirSync(".setup", { recursive: true }); writeFileSync(".setup/vercel-env.sh", vercelScript(), { mode: 0o700 });
    console.log("\n  ✓ .setup/vercel-env.sh gerado (rode: sh .setup/vercel-env.sh; requer vercel login e vercel link)");
  }
  console.log("\nPróximos passos:\n  1. Entre com cada conta e ative o 2FA em Configurações (obrigatório para cargos).\n  2. O Venerável cria o primeiro convite e a Potência aprova.\n  3. Em produção: configure as mesmas variáveis na Vercel e confirme com: npm run doctor");
  process.exit(final.some((c) => c.level === "error") ? 1 : 0);
}
main().catch((e) => die(e instanceof Error ? e.message : String(e)));
