/**
 * Teste ponta a ponta contra o servidor real (next start + PostgreSQL), simulando um navegador sem JavaScript:
 * lê os formulários, envia com os campos ocultos das Server Actions e segue os redirecionamentos.
 *   BASE_URL=http://127.0.0.1:3100 MAIL_LOG=/tmp/next.log POT_PASSWORD=... VM_PASSWORD=... TECH_PASSWORD=... npm run e2e
 */
import { readFileSync } from "node:fs";
import { totpAt } from "@/core/auth/totp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const LOG = process.env.MAIL_LOG ?? "/tmp/next.log";
let fails = 0, n = 0;
const ok = (c: unknown, m: string) => { n++; if (!c) { fails++; console.log("  ✗", m); } else console.log("  ✓", m); };
const dec = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const mailToken = (kind: string) => { const m = [...readFileSync(LOG, "utf8").matchAll(new RegExp(`${kind}\\?token=([\\w-]+)`, "g"))]; return m[m.length - 1]?.[1]; };

class Browser {
  jar = new Map<string, string>();
  async go(path: string, init: RequestInit = {}, hops = 6): Promise<{ status: number; url: string; html: string }> {
    const res = await fetch(BASE + path, { redirect: "manual", ...init, headers: { ...(init.headers as object), cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(";"); const i = kv.indexOf("=");
      if (attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a))) this.jar.delete(kv.slice(0, i)); else this.jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    // Server Actions do not always emit Location: Next.js communicates redirects
    // through x-action-redirect (url;push|replace;status). Follow both forms.
    const actionRedirect = res.headers.get("x-action-redirect")?.split(";")[0];
    const loc = res.headers.get("location") ?? actionRedirect;
    if (loc && res.status >= 300 && res.status < 400 && hops > 0) return this.go(loc.startsWith("http") ? loc.replace(BASE, "") : loc, {}, hops - 1);
    return { status: res.status, url: path, html: await res.text() };
  }
  get = (p: string) => this.go(p);
  /** Envia o formulário da página que contém `includes`, preenchendo `fields`. */
  async submit(path: string, includes: string, fields: Record<string, string> = {}, origin = BASE) {
    const page = await this.get(path);
    const form = [...page.html.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]).find((f) => f.includes(includes));
    if (!form) throw new Error(`formulário "${includes}" não encontrado em ${path}`);
    const fd = new FormData();
    for (const m of form.matchAll(/<input[^>]*>/g)) {
      const name = /name="([^"]*)"/.exec(m[0])?.[1], value = /value="([^"]*)"/.exec(m[0])?.[1] ?? "";
      if (name && (/type="hidden"/.test(m[0]) || name in fields)) fd.set(dec(name), dec(value));
    }
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return this.go(path, { method: "POST", body: fd, headers: { origin } });
  }
  login = (email: string, password: string) => this.submit("/login", "Entrar", { email, password });
}
const has = (r: { html: string }, t: string) => r.html.includes(t);

/** Ativa o 2FA e devolve os 10 códigos de recuperação exibidos uma única vez. */
async function enroll(b: Browser): Promise<string[]> {
  await b.submit("/settings", "Ativar 2FA");
  const secret = /<code>([A-Z2-7]+)<\/code>/.exec((await b.get("/settings")).html)?.[1];
  if (!secret) throw new Error("segredo do 2FA não exibido");
  const r = await b.submit("/settings", "Confirmar e ativar", { code: totpAt(secret, Date.now()) });
  return [...r.html.matchAll(/<code>([a-z0-9]{5}-[a-z0-9]{5})<\/code>/g)].map((m) => m[1]);
}

(async () => {
  const pot = new Browser(), vm = new Browser(), nov = new Browser(), tec = new Browser(), anon = new Browser();
  const PW = (k: string, d: string) => process.env[k] ?? d;

  console.log("Acesso e cabeçalhos");
  const a = await anon.go("/communities");
  ok(a.url.startsWith("/login"), "sem sessão, áreas internas redirecionam ao login");
  const h = await fetch(BASE + "/login");
  ok(/nonce-/.test(h.headers.get("content-security-policy") ?? ""), "CSP com nonce");
  ok(h.headers.get("x-frame-options") === "DENY" && /noindex/.test(h.headers.get("x-robots-tag") ?? ""), "anti-clickjacking e noindex");
  const evil = await anon.submit("/login", "Entrar", { email: "a@b.c", password: "x" }, "http://evil.example");
  ok(!evil.url.startsWith("/login?e=credenciais") && evil.status !== 200 || !has(evil, "credenciais"), "Server Action rejeita Origin estranha (CSRF)");

  console.log("Login e 2FA das autoridades");
  const bad = await pot.login("pot@teste.org", "errada-errada-12");
  ok(bad.url.includes("credenciais"), "senha errada: mensagem genérica");
  await pot.login("pot@teste.org", PW("POT_PASSWORD", "senha-de-teste-forte-1"));
  await vm.login("vm@teste.org", PW("VM_PASSWORD", "senha-de-teste-forte-2"));
  ok(has(await vm.get("/"), "ainda não confirmou o 2FA"), "autoridade sem 2FA vê o aviso");
  ok(has(await vm.get("/institution"), "Confirme o 2FA"), "área institucional bloqueada sem 2FA");
  const potSettings = await pot.get("/settings");
  if (!has(potSettings, "Ativar 2FA")) console.log("  diagnóstico /settings Potência:", potSettings.status, potSettings.url, potSettings.html.slice(0, 900));
  const vmSettings = await vm.get("/settings");
  if (!has(vmSettings, "Ativar 2FA")) console.log("  diagnóstico /settings Venerável:", vmSettings.status, vmSettings.url, vmSettings.html.slice(0, 900));
  const potCodes = await enroll(pot), vmCodes = await enroll(vm);
  ok(potCodes.length === 10 && vmCodes.length === 10, "2FA ativado para Potência e Venerável, com 10 códigos de recuperação cada");

  console.log("Convite com aprovação dupla e cadastro");
  const inv = await vm.submit("/institution", "Criar convite", { email: "novo@teste.org", degree: "1" });
  ok(has(inv, "Convite criado"), "Venerável cria convite");
  const own = await vm.submit("/institution", "Aprovar");
  ok(has(own, "quem registra não aprova"), "quem criou o convite não o aprova");
  ok(has(await pot.submit("/institution", "Aprovar"), "Convite aprovado"), "Potência aprova");
  const tk = mailToken("register");
  const reg = await nov.submit(`/register?token=${tk}`, "Criar conta", { email: "novo@teste.org", fullName: "Novo Aprendiz", username: "novo", password: "senha-bem-forte-123", password2: "senha-bem-forte-123" });
  ok(has(reg, "Cadastro criado"), "cadastro por convite");
  ok(has(await nov.login("novo@teste.org", "senha-bem-forte-123"), "e-mail não verificado"), "login exige e-mail verificado");
  await nov.submit(`/verify?token=${mailToken("verify")}`, "Confirmar meu e-mail");
  const home = await nov.login("novo@teste.org", "senha-bem-forte-123");
  ok(has(home, "Aprendiz") && has(home, "Novo"), "novo membro entra como Aprendiz");

  console.log("Invisibilidade por Grau");
  await vm.submit("/communities", "Criar", { name: "Estudos de Mestres", slug: "mestres", description: "", minDegree: "3" });
  await vm.submit("/communities", "Criar", { name: "História", slug: "historia", description: "", minDegree: "1" });
  const l = await nov.get("/communities");
  ok(has(l, "História") && !has(l, "Estudos de Mestres"), "Aprendiz lista só o que pode ver");
  const hidden = await nov.get("/communities/mestres"), none = await nov.get("/communities/nao-existe");
  ok(hidden.status === 404 && none.status === 404, "restrita e inexistente respondem 404 igual");
  const mid = await nov.submit("/communities/historia", "Publicar", { title: "Primeira dúvida", body: "Por onde começar?" });
  ok(has(mid, "Primeira dúvida") && has(mid, "Responder"), "Aprendiz publica na comunidade permitida");
  ok(has(await vm.get("/communities"), "Estudos de Mestres"), "Mestre vê as duas");
  ok((await nov.get("/institution")).status === 404 || has(await nov.get("/institution"), "não exerce cargo"), "membro comum não acessa a administração");

  console.log("Amizade e mural");
  const first = (html: string) => /href="\/profile\/([0-9a-f-]{36})"/.exec(html)![1];
  const vmId = first((await vm.get("/")).html), novoId = first((await nov.get("/")).html);
  ok(has(await nov.get(`/profile/${vmId}`), "Somente amigos escrevem no mural"), "não amigo não escreve no mural");
  await nov.submit(`/profile/${vmId}`, "Adicionar aos amigos");
  await vm.submit("/friends", "Aceitar");
  await nov.submit(`/profile/${vmId}`, "Enviar", { body: "Saudações, Venerável!" });
  ok(has(await vm.get(`/profile/${vmId}`), "Saudações, Venerável!"), "depois de amigos, o recado aparece");
  ok(!has(await pot.get(`/profile/${vmId}`), "Saudações, Venerável!"), "quem não é amigo do dono não lê o mural");

  console.log("Progressão de Grau");
  await vm.submit("/communities", "Criar", { name: "Simbolismo", slug: "simbolismo", description: "", minDegree: "2" });
  ok(!has(await nov.get("/communities"), "Simbolismo"), "Aprendiz ainda não vê Simbolismo");
  ok(has(await pot.submit("/institution", `value="${novoId}"`, {}), "Solicitação registrada"), "Potência registra a elevação");
  ok(has(await pot.submit("/institution", "Aprovar"), "quem registra não aprova"), "o mesmo registrante não aprova");
  ok(has(await vm.submit("/institution", "Aprovar"), "Grau atualizado"), "Venerável aprova (aprovação dupla)");
  ok(has(await nov.get("/communities"), "Simbolismo"), "Companheiro passa a ver Simbolismo");

  console.log("Auditoria e conta técnica");
  const au = await vm.get("/audit");
  ok(has(au, "íntegra") && has(au, "invitation.created"), "Venerável lê a auditoria do escopo, cadeia íntegra");
  ok((await nov.get("/audit")).status !== 200 || has(await nov.get("/audit"), "Sem competência"), "membro comum não lê auditoria");
  await tec.login("tec@teste.org", PW("TECH_PASSWORD", "senha-de-teste-forte-3"));
  ok((await tec.get("/communities")).status === 404 && (await tec.get("/institution")).status === 404, "conta técnica não enxerga conteúdo nem administração");
  ok(has(await tec.submit("/admin", "Ativar", { }), "Confirme o 2FA"), "alterar módulos exige 2FA");
  ok((await enroll(tec)).length === 10, "2FA da conta técnica com códigos de recuperação");
  ok(has(await tec.submit("/admin", "Ativar"), "Módulo atualizado"), "administração técnica ativa módulo");
  console.log("Interface das páginas de entrada (só administrador técnico)");
  ok((await nov.get("/settings/interface")).status === 404 && (await vm.get("/settings/interface")).status === 404 && (await pot.get("/settings/interface")).status === 404, "membro, Venerável e Potência não enxergam a página Interface (404)");
  ok(!has(await vm.get("/settings"), "Personalizar a página de entrada"), "a opção nem aparece nas configurações deles");
  ok(has(await tec.get("/settings"), "Personalizar a página de entrada") && has(await tec.get("/settings/interface"), "Frase de boas-vindas"), "o administrador técnico vê a opção");
  const lk = await tec.submit("/settings/interface", "Salvar", { preset: "bordo-dourado", tagline: "Entre, irmão" });
  ok(has(lk, "atualizada"), "administrador técnico salva a aparência");
  const lg = await anon.get("/login");
  ok(has(lg, "Entre, irmão") && has(lg, 'class="noble"') && /--decor:#c9a24b/i.test(lg.html), "página de login usa a paleta nobre escolhida (bordô e dourado)");
  console.log("Convites: e-mail repetido e aprovação direta da Potência");
  ok(has(await vm.submit("/institution", "Criar convite", { email: "novo@teste.org", degree: "1" }), "já existe uma conta com este e-mail"), "convite para e-mail que já tem conta é recusado na hora, com o motivo");
  ok(has(await vm.submit("/institution", "Criar convite", { email: "pend@teste.org", degree: "1" }), "Convite criado"), "convite novo é criado");
  ok(has(await vm.submit("/institution", "Criar convite", { email: "pend@teste.org", degree: "1" }), "convite pendente"), "segundo convite para o mesmo e-mail é recusado");
  ok(has(await vm.submit("/institution", "Cancelar"), "Convite cancelado"), "convite pendente pode ser cancelado");
  ok(has(await vm.submit("/institution", "Criar convite", { email: "tentativa@teste.org", degree: "3", approveNow: "on" }), "somente a Administração da Potência"), "o Venerável não consegue aprovar o próprio convite");
  const dir = await pot.submit("/institution", "Criar convite", { email: "direto@teste.org", degree: "3", approveNow: "on" });
  ok(has(dir, "Já está aprovado"), "a Potência cria convite já aprovado, em Grau de Mestre");
  const dreg = await new Browser().submit(`/register?token=${mailToken("register")}`, "Criar conta", { email: "direto@teste.org", fullName: "Mestre Direto", username: "direto", password: "senha-bem-forte-456", password2: "senha-bem-forte-456" });
  ok(has(dreg, "Cadastro criado"), "o convidado se cadastra sem nova aprovação");
  const dnav = new Browser(); await dnav.submit(`/verify?token=${mailToken("verify")}`, "Confirmar meu e-mail");
  ok(has(await dnav.login("direto@teste.org", "senha-bem-forte-456"), "Mestre"), "entra já como Mestre");

  console.log("2FA: códigos de recuperação");
  const pot2 = new Browser(); const lg2 = await pot2.login("pot@teste.org", PW("POT_PASSWORD", "senha-de-teste-forte-1"));
  ok(lg2.url.startsWith("/login/mfa"), "com 2FA ativo, o login pede o segundo fator");
  const rec = await pot2.submit("/login/mfa", "Confirmar", { code: potCodes[0] });
  ok(!rec.url.startsWith("/login") && !has(await pot2.get("/institution"), "Confirme o 2FA"), "um código de recuperação substitui o do aplicativo (autoridade volta a operar)");
  const pot3 = new Browser(); await pot3.login("pot@teste.org", PW("POT_PASSWORD", "senha-de-teste-forte-1"));
  ok((await pot3.submit("/login/mfa", "Confirmar", { code: potCodes[0] })).url.startsWith("/login/mfa"), "o mesmo código não funciona duas vezes");
  const nova = await pot.submit("/settings", "Gerar", { password: PW("POT_PASSWORD", "senha-de-teste-forte-1") });
  ok([...nova.html.matchAll(/<code>[a-z0-9]{5}-[a-z0-9]{5}<\/code>/g)].length === 10, "novos códigos são gerados mediante a senha");

  console.log("Troca de e-mail pelo próprio usuário");
  const chg = await nov.submit("/settings", "Enviar link de confirmação", { newEmail: "novo.endereco@teste.org", password: "senha-bem-forte-123" });
  ok(has(chg, "Enviamos um link"), "pede a troca (senha + link para o novo endereço)");
  const conf = await new Browser().submit(`/confirm-email?token=${mailToken("confirm-email")}`, "Confirmar troca de e-mail");
  ok(has(conf, "E-mail alterado"), "o link no novo endereço efetiva a troca");
  ok(has(await new Browser().login("novo@teste.org", "senha-bem-forte-123"), "credenciais inválidas"), "o e-mail antigo deixa de entrar");
  ok(has(await nov.login("novo.endereco@teste.org", "senha-bem-forte-123"), "Início"), "o novo e-mail entra normalmente");
  ok(has(await nov.get("/"), "Início"), "sessão segue válida");
  console.log(`\n${n - fails}/${n} verificações passaram`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
