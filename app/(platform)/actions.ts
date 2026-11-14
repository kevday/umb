"use server";
import { redirect } from "next/navigation";
import * as auth from "@/core/auth/service";
import { Forbidden } from "@/core/errors";
import { deleteAccount, updateProfile } from "@/core/account";
import { setThemeColor } from "@/theme/service";
import * as inst from "@/access-control/services/institution";
import * as com from "@/core/social/communities";
import * as fr from "@/core/social/friends";
import * as sb from "@/core/social/scrapbook";
import { setModuleEnabled } from "@/modules";
import { getDb } from "@/web/db";
import { back, done, str } from "@/web/form";
import { appUrl, sendMail } from "@/web/mailer";
import { clearSessionCookie, requirePage, sessionToken } from "@/web/session";

type P = Awaited<ReturnType<typeof requirePage>>;
/** Autentica, executa, volta à página com mensagem (ou vai para `next`). */
async function run<T>(path: string, fn: (p: P, db: ReturnType<typeof getDb>) => Promise<T>, ok?: string, next?: (r: T) => string): Promise<never> {
  const p = await requirePage();
  let r: T;
  try { r = await fn(p, getDb()); } catch (e) { back(path, e); }
  return done(next ? next(r) : path, ok);
}
const date = (f: FormData, k: string) => (str(f, k) ? new Date(str(f, k)) : undefined);

export async function logoutAction() {
  const t = await sessionToken();
  if (t) await auth.logout(getDb(), t);
  await clearSessionCookie();
  redirect("/login");
}

// Perfil e scrapbook
export async function scrapPost(f: FormData) {
  const id = str(f, "profileId");
  await run(`/profile/${id}`, (p, db) => sb.postScrap(db, p.session.userId, id, str(f, "body")));
}
export async function scrapDelete(f: FormData) {
  const id = str(f, "profileId");
  await run(`/profile/${id}`, (p, db) => sb.deleteScrap(db, p.session.userId, str(f, "id")));
}

// Amizades
export async function friendRequest(f: FormData) { await run("/friends", (p, db) => fr.requestFriend(db, p.session.userId, str(f, "id")), "Solicitação enviada."); }
export async function friendRespond(f: FormData) { await run("/friends", (p, db) => fr.respondFriend(db, p.session.userId, str(f, "id"), str(f, "accept") === "1")); }
export async function friendRemove(f: FormData) { await run("/friends", (p, db) => fr.removeFriend(db, p.session.userId, str(f, "id")), "Amizade removida."); }
export async function friendBlock(f: FormData) { await run("/friends", (p, db) => fr.blockUser(db, p.session.userId, str(f, "id")), "Usuário bloqueado."); }

// Comunidades
export async function communityCreate(f: FormData) {
  await run("/communities", async (p, db) => {
    const min = Number(str(f, "minDegree")) || 1;
    const lodge = f.get("lodgeOnly") && p.subject.lodgeId ? { kind: "lodge", id: p.subject.lodgeId } : null;
    const policy = lodge ? { kind: "all", rules: [{ kind: "minDegree", value: min }, lodge] } : { kind: "minDegree", value: min };
    return com.createCommunity(db, p.session.userId, { slug: str(f, "slug").toLowerCase(), name: str(f, "name"), description: str(f, "description"), policy });
  }, undefined, (c) => `/communities/${c.slug}`);
}
export async function topicCreate(f: FormData) {
  const slug = str(f, "slug");
  await run(`/communities/${slug}`, (p, db) => com.createTopic(db, p.session.userId, slug, { title: str(f, "title"), body: str(f, "body") }), undefined, (t) => `/communities/${slug}/t/${t.id}`);
}
export async function replyCreate(f: FormData) {
  const path = `/communities/${str(f, "slug")}/t/${str(f, "topicId")}`;
  await run(path, (p, db) => com.replyTopic(db, p.session.userId, str(f, "topicId"), str(f, "body")));
}
export async function topicPin(f: FormData) {
  await run(`/communities/${str(f, "slug")}`, (p, db) => com.pinTopic(db, p.session.userId, str(f, "id"), str(f, "pinned") === "1"));
}
export async function reportCreate(f: FormData) {
  const path = str(f, "path");
  await run(path, (p, db) => com.reportContent(db, p.session.userId, { kind: str(f, "kind") as "topic" | "reply" | "scrap", id: str(f, "id"), reason: str(f, "reason") }), "Denúncia enviada à moderação.");
}

// Instituição
export async function inviteCreate(f: FormData) {
  await run("/institution", async (p, db) => {
    const email = str(f, "email");
    const r = await inst.createInvitation(db, p.ctx, { lodgeId: str(f, "lodgeId"), email, intendedDegree: Number(str(f, "degree")) || 1 });
    await sendMail(email, "Convite para a rede", `Seu convite (válido por 14 dias, após aprovação): ${appUrl()}/register?token=${r.token}`);
  }, "Convite criado e enviado. Ele só vale depois de aprovado por outra autoridade.");
}
export async function inviteApprove(f: FormData) { await run("/institution", (p, db) => inst.approveInvitation(db, p.ctx, str(f, "id")), "Convite aprovado."); }
export async function degreeRequest(f: FormData) { await run("/institution", (p, db) => inst.requestDegree(db, p.ctx, str(f, "userId")), "Solicitação registrada. Falta a aprovação."); }
export async function degreeDecide(f: FormData) {
  const ok = str(f, "approve") === "1";
  await run("/institution", (p, db) => inst.decideDegree(db, p.ctx, str(f, "id"), ok, str(f, "justification")), ok ? "Grau atualizado." : "Solicitação recusada.");
}
export async function officeAppoint(f: FormData) {
  const name = str(f, "name");
  await run("/institution", (p, db) => inst.appointOffice(db, p.ctx, {
    userId: str(f, "userId"), name, lodgeId: name === "Administração da Potência" ? undefined : str(f, "lodgeId"),
    jurisdictionId: name === "Administração da Potência" ? str(f, "jurisdictionId") : undefined,
    startsAt: date(f, "startsAt") ?? new Date(), endsAt: date(f, "endsAt"),
  }), "Cargo registrado.");
}
export async function officeEnd(f: FormData) { await run("/institution", (p, db) => inst.endOffice(db, p.ctx, str(f, "id")), "Mandato encerrado."); }
export async function statusSet(f: FormData) {
  await run("/institution", (p, db) => inst.setMemberStatus(db, p.ctx, str(f, "userId"), str(f, "status") as "regular", str(f, "justification")), "Status atualizado.");
}
export async function lodgeCreate(f: FormData) {
  await run("/institution", (p, db) => inst.createLodge(db, p.ctx, { jurisdictionId: str(f, "jurisdictionId"), name: str(f, "name"), number: Number(str(f, "number")) || undefined }), "Loja criada.");
}

// Configurações de segurança
export async function totpStart() { await run("/settings", async (p, db) => { const u = await db.query.users.findFirst({ where: (t, { eq }) => eq(t.id, p.session.userId) }); await auth.enrollTotp(db, p.session.userId, u?.email ?? "conta"); }); }
export async function totpConfirm(f: FormData) {
  await run("/settings", async (p, db) => { await auth.confirmTotp(db, p.session.userId, str(f, "code")); await auth.markSessionMfa(db, p.session.sessionId); }, "2FA ativado.");
}
export async function passwordChange(f: FormData) {
  await run("/settings", (p, db) => auth.changePassword(db, p.session, String(f.get("current") ?? ""), String(f.get("next") ?? "")), "Senha alterada. As outras sessões foram encerradas.");
}

// Administração técnica
export async function moduleToggle(f: FormData) {
  await run("/admin", async (p, db) => {
    if (!p.subject.technicalAdmin) throw new Forbidden("restrito à administração técnica");
    if (!p.session.mfaVerified) throw new Forbidden("mfa_required");
    await setModuleEnabled(db, str(f, "id"), str(f, "enabled") === "1");
  }, "Módulo atualizado.");
}

export async function profileUpdate(f: FormData) {
  await run("/settings", (p, db) => updateProfile(db, p.session.userId, { displayName: str(f, "displayName"), bio: str(f, "bio"), bioVisibility: str(f, "bioVisibility") }), "Perfil atualizado.");
}
export async function accountDelete(f: FormData) {
  const p = await requirePage();
  try { await deleteAccount(getDb(), p.session.userId, String(f.get("password") ?? "")); } catch (e) { back("/settings", e); }
  await clearSessionCookie();
  redirect("/login?ok=" + encodeURIComponent("Conta excluída. Seus dados pessoais foram anonimizados."));
}

// Aparência
export async function themeSet(f: FormData) { await run("/settings", (p, db) => setThemeColor(db, p.session.userId, str(f, "color")), "Cor aplicada."); }
export async function themeReset(f: FormData) { void f; await run("/settings", (p, db) => setThemeColor(db, p.session.userId, null), "Voltou ao padrão da sua Loja."); }
export async function riteSet(f: FormData) { await run("/institution", (p, db) => inst.setLodgeRite(db, p.ctx, str(f, "lodgeId"), str(f, "rite") || null), "Rito da Loja atualizado."); }
