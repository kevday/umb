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
import { EMAIL, envFile, generateKey, generatePassword, slugify, usernameFrom, validateInput, vercelScript, type Person, type SetupInput } from "@/setup/config";
import { assertPasswordPolicy } from "@/core/auth/password";
import { RITES, findRite } from "@/theme/rites";
import { DOCTOR_NOTE, applyMigrations, checkDatabase, doctor, provision, type Check } from "@/setup/steps";
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
    lodgeNumber: env.SETUP_LODGE_NUMBER ? Number(env.SETUP_LODGE_NUMBER) : undefined, rite: env.SETUP_RITE || undefined, evidence: env.SETUP_EVIDENCE ?? die("SETUP_EVIDENCE ausente"), authority, venerable,
  } : undefined;
  return {
    app: { name, slug: env.APP_SLUG ?? slugify(name), url: appUrl, mailFrom: env.APP_MAIL_FROM ?? `${name} <no-reply@${new URL(appUrl).hostname}>`, resendKey: env.RESEND_API_KEY || undefined },
    db: { url, migrationUrl: env.MIGRATION_DATABASE_URL || undefined },
    encKey: !flag("rotate-key") && env.DATA_ENCRYPTION_KEY ? env.DATA_ENCRYPTION_KEY : generateKey(),
    inst, tech: personFromEnv("SETUP_ADMIN", "Administrador técnico"),
  };
}

async function wizard(p: Prompter): Promise<SetupInput> {
  const sec = (t: string) => console.log(`\n━━ ${t} ━━`);
  console.log("Configurador da plataforma. Cada pergunta explica o que pede; Enter aceita o valor padrão quando houver.");

  sec("1. Aplicação");
  const name = await p.ask("Nome do produto", { help: "O nome da rede. Aparece no topo do site e nos e-mails. Pode ser provisório e alterado depois.", example: "Rede Fraternidade", def: env.APP_NAME && !/^\[.*\]$/.test(env.APP_NAME) ? env.APP_NAME : undefined, validate: (v) => (v.length < 2 || v.length > 60 ? "Use de 2 a 60 caracteres." : /["\\`$]/.test(v) ? "Não use aspas, barra invertida, $ nem crase." : null) });
  const slug = await p.ask("Identificador curto (slug)", { help: "Versão curta do nome, só com letras minúsculas, números e hífen (2 a 40). Usada em arquivos e integrações. Enter aceita a sugestão.", example: "rede-fraternidade", def: env.APP_SLUG ?? slugify(name), validate: (v) => (/^[a-z0-9-]{2,40}$/.test(v) ? null : "Use apenas a-z, 0-9 e hífen (2 a 40 caracteres).") });
  const url = await p.ask("Endereço público do site (URL)", { help: "Onde o site ficará. Para testar no seu computador use http://localhost:3000; em produção, o endereço com https://.", example: "https://rede.seudominio.org", def: env.APP_URL ?? "http://localhost:3000", validate: (v) => { try { return /^https?:$/.test(new URL(v).protocol) ? null : "Comece com http:// ou https://."; } catch { return "Endereço inválido. Exemplo: https://rede.seudominio.org"; } } });
  const mailFrom = await p.ask("Remetente dos e-mails", { help: "Nome e endereço que aparecem como remetente nos convites e avisos. Enter aceita a sugestão.", example: `${name} <no-reply@seudominio.org>`, def: env.APP_MAIL_FROM ?? `${name} <no-reply@${new URL(url).hostname}>`, validate: (v) => (/["\\`$]/.test(v) ? "Não use aspas, barra invertida, $ nem crase." : null) });
  const resendKey = await p.ask("Chave da API do Resend (serviço de e-mail)", { help: "Começa com re_. Sem ela os e-mails de convite e de redefinição de senha não são enviados: ficam apenas no log. Pode configurar depois.", example: "re_AbCdEf123456", def: env.RESEND_API_KEY, secret: true, optional: true });

  sec("2. Banco de dados (PostgreSQL)");
  let dbUrl = "";
  for (;;) {
    dbUrl = await p.ask("DATABASE_URL (conexão com o banco)", { help: "No Neon: botão Connect, versão COM pooling (endereço com -pooler). Começa com postgres://. A digitação fica oculta: cole e dê Enter.", example: "postgres://usuario:senha@ep-xxxx-pooler.regiao.aws.neon.tech/neondb?sslmode=require", def: env.DATABASE_URL, secret: true, validate: (v) => (/^postgres(ql)?:\/\//.test(v) ? (/["\\`$]/.test(v) ? "A URL tem caractere não permitido ($, aspas, crase ou barra invertida): codifique-o na senha (ex.: $ vira %24)." : null) : "Deve começar com postgres:// ou postgresql://.") });
    const migUrlIn = await p.ask("URL direta do banco, para as migrações", { help: "A mesma conexão, mas a versão DIRETA (sem -pooler); evita problemas ao criar as tabelas. Enter usa a mesma URL de cima.", example: "postgres://usuario:senha@ep-xxxx.regiao.aws.neon.tech/neondb?sslmode=require", def: env.MIGRATION_DATABASE_URL, secret: true, optional: true });
    p.say("\nTestando a conexão...");
    const r = await checkDatabase(migUrlIn || dbUrl);
    show(r.checks);
    if (r.ok) { env.MIGRATION_DATABASE_URL = migUrlIn; break; }
    p.warn("Não foi possível usar este banco. Corrija os itens marcados com ✗ e informe de novo.");
  }
  const migrationUrl = env.MIGRATION_DATABASE_URL || undefined;
  const keepKey = !flag("rotate-key") && env.DATA_ENCRYPTION_KEY && Buffer.from(env.DATA_ENCRYPTION_KEY, "base64").length === 32;
  p.say(keepKey ? "\nChave de criptografia existente mantida (trocá-la invalidaria os 2FA)." : "\nChave de criptografia nova gerada automaticamente.");
  const encKey = keepKey ? env.DATA_ENCRYPTION_KEY! : generateKey();

  const db = createDb(migrationUrl ?? dbUrl);
  const already = await db.execute(sql`select to_regclass('public.jurisdictions') is not null and exists (select 1 from jurisdictions) as x`).then((r) => ((Array.isArray(r) ? r : (r as { rows: { x: boolean }[] }).rows)[0] as { x: boolean }).x).catch(() => false);

  const taken: { label: string; email: string; username: string }[] = [];
  const person = async (label: string, who: string): Promise<Person> => {
    p.say(`\n── ${label} ──`);
    p.say(who);
    const pname = await p.ask("Nome completo", { help: "Como a pessoa aparecerá no perfil e na auditoria.", example: "João Carlos da Silva", validate: (v) => (v.length < 2 || v.length > 120 ? "Use de 2 a 120 caracteres." : null) });
    const email = await p.ask("E-mail", { help: "Usado para entrar e receber avisos. Precisa ser exclusivo: cada conta é de uma pessoa diferente.", example: "joao@seudominio.org", validate: (v) => {
      if (!EMAIL.test(v)) return "E-mail inválido. Use o formato nome@dominio.org.";
      const t = taken.find((x) => x.email === v.toLowerCase());
      return t ? `Este e-mail já foi usado para "${t.label}". Cada conta precisa ser de uma pessoa diferente (a aprovação dupla exige pessoas distintas). Informe outro e-mail.` : null;
    } });
    const suggestion = usernameFrom(email);
    const username = await p.ask("Nome de usuário", { help: "Nome de acesso: 3 a 30 caracteres, só letras minúsculas, números, ponto, hífen e sublinhado, sem espaços. Precisa ser exclusivo.", example: "joao.silva", def: taken.some((x) => x.username === suggestion) ? undefined : suggestion, validate: (v) => {
      if (!/^[a-z0-9._-]{3,30}$/.test(v)) return "Use 3 a 30 caracteres: a-z minúsculas, 0-9, ponto, hífen ou sublinhado (sem espaços nem acentos).";
      const t = taken.find((x) => x.username === v);
      return t ? `Este usuário já foi usado para "${t.label}". Informe outro.` : null;
    } });
    let password = "", generated = false;
    for (;;) {
      const pw = await p.ask("Senha", { help: "Mínimo 12 e máximo 128 caracteres; não pode conter o e-mail nem o usuário. A digitação fica oculta. Dica: uma frase longa com várias palavras é forte e fácil de lembrar. Deixe em branco (Enter) para o sistema gerar uma senha forte, exibida uma única vez no final.", secret: true, optional: true });
      if (!pw) { password = generatePassword(); generated = true; break; }
      try { assertPasswordPolicy(pw, email, username); } catch (e) { p.warn(`${(e as Error).message}. Tente de novo.`); continue; }
      const again = await p.ask("Repita a senha", { help: "Digite a mesma senha para confirmar.", secret: true });
      if (again !== pw) { p.warn("As senhas não conferem. Digite novamente."); continue; }
      password = pw; break;
    }
    taken.push({ label, email: email.toLowerCase(), username });
    return { name: pname, email, username, password, generated };
  };

  let inst: SetupInput["inst"], tech: Person | undefined;
  sec("3. Estrutura institucional e contas iniciais");
  if (already) p.say("Já existe estrutura institucional neste banco: a fundação será mantida (nada será recriado).");
  else {
    p.say("Serão criadas duas pessoas distintas: a Administração da Potência e o Venerável Mestre da primeira Loja.");
    const jurisdiction = await p.ask("Nome da Potência (obediência)", { help: "A Potência à qual a Loja pertence.", example: "Grande Oriente Maçônico do Brasil", validate: (v) => (v.length < 2 ? "Mínimo 2 caracteres." : null) });
    const lodge = await p.ask("Nome da primeira Loja", { help: "Nome da Loja, sem o número.", example: "Lealdade e Honra", validate: (v) => (v.length < 2 ? "Mínimo 2 caracteres." : null) });
    const num = await p.ask("Número da Loja", { help: "Somente dígitos.", example: "97", optional: true, validate: (v) => (/^[1-9]\d*$/.test(v) ? null : "Digite apenas um número inteiro, como 97.") });
    p.say("\nRitos disponíveis (definem as cores do site, conforme o avental de Mestre):");
    RITES.forEach((r, k) => p.say(`  ${String(k + 1).padStart(2)}. ${r.name}`));
    const riteN = await p.ask("Rito da Loja", { help: "Digite o NÚMERO do Rito na lista acima. Sem Rito definido, o site usa a paleta padrão. Pode ser alterado depois pelo Venerável.", example: "1", optional: true, validate: (v) => (/^\d+$/.test(v) && RITES[Number(v) - 1] ? null : `Digite um número de 1 a ${RITES.length}.`) });
    const rite = riteN ? RITES[Number(riteN) - 1].id : undefined;
    const evidence = await p.ask("Evidência da indicação pela Potência", { help: "Documento que comprova a indicação (ofício, protocolo etc.). Mínimo 10 caracteres; fica registrado na auditoria.", example: "Ofício nº 12/2026 da Potência", validate: (v) => (v.length >= 10 ? null : "Informe ao menos 10 caracteres (ex.: número e ano do ofício).") });
    const authority = await person("Administração da Potência", "Autoridade maçônica que cria Lojas e aprova Graus acima de Aprendiz.");
    const venerable = await person("Venerável Mestre da primeira Loja", "Aprova elevações de Grau e convites da Loja. Deve ser outra pessoa, diferente da Administração da Potência.");
    inst = { jurisdiction, lodge, lodgeNumber: num ? Number(num) : undefined, rite, evidence, authority, venerable };
  }
  if (await p.confirm("Criar o administrador técnico?", true, "Conta que cuida da infraestrutura e dos módulos. Não tem autoridade maçônica nem acesso ao conteúdo dos membros. Recomendado.")) tech = await person("Administrador técnico", "Pessoa que opera o servidor e os módulos.");
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

  const hostOf = (u: string) => { try { const x = new URL(u); return `${x.hostname}${x.pathname}`; } catch { return "?"; } };
  console.log("\nResumo (senhas não são exibidas):");
  console.log(`  Aplicação: ${input.app.name} (${input.app.slug}) em ${input.app.url}`);
  console.log(`  Banco: ${hostOf(input.db.url)}`);
  if (input.inst) console.log(`  Potência: ${input.inst.jurisdiction} · Loja: ${input.inst.lodge}${input.inst.lodgeNumber ? ` nº ${input.inst.lodgeNumber}` : ""}\n  Rito: ${findRite(input.inst.rite)?.name ?? "padrão (sem Rito definido)"}\n  Evidência: ${input.inst.evidence}`);
  for (const [l, pp] of [["Administração da Potência", input.inst?.authority], ["Venerável Mestre", input.inst?.venerable], ["Administrador técnico", input.tech]] as const) if (pp) console.log(`  ${l}: ${pp.name} <${pp.email}> usuário ${pp.username}${pp.generated ? " (senha será gerada)" : ""}`);
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
  console.log(`  ${done.founders.includes("sem autoridade") ? "✗" : "✓"} fundação: ${done.founders}; administrador técnico: ${done.tech}`);
  if (done.founders.includes("sem autoridade")) console.log("    Há estrutura institucional, mas nenhuma Administração da Potência/Venerável ativa. Isso não é recriado automaticamente: veja docs/operacao.md (recuperação).");

  Object.assign(process.env, { APP_NAME: input.app.name, APP_URL: input.app.url, DATA_ENCRYPTION_KEY: input.encKey, RESEND_API_KEY: input.app.resendKey ?? "" });
  console.log("\nVerificação final:");
  const final = await doctor(db, process.env);
  show(final);
  console.log(`\n  Observação: ${DOCTOR_NOTE}`);

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
