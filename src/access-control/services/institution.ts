import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { Subject } from "@/contracts/access-control";
import type { Db } from "@/shared/database/client";
import {
  degreeAssignments, degreeRequests, emailTokens, institutionalMemberships, invitations, jurisdictions, lodges,
  accessAuditLogs, officeAssignments, profiles, sessions, userTotp, users,
} from "@/shared/database/schema";
import { Forbidden, Invalid, NotFound } from "@/core/errors";
import { assertPasswordPolicy, hashPassword } from "@/core/auth/password";
import { issueEmailToken } from "@/core/auth/service";
import { clearRecoveryCodes } from "@/core/auth/recovery";
import { randomToken, sha256 } from "@/core/auth/crypto";
import { can, officeActive } from "../engine/can";
import { canApprove, canApproveInLodge, POTENCIA, VM } from "../degrees/approval";
import { loadSubject } from "../subject";
import { appendAudit, readAudit } from "../audit/store";
import { findRite } from "@/theme/rites";

export const SEC = "Secretário";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mask = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");
const DAY = 86_400_000;

/** Contexto do ator: quem é (sessão validada) e se a sessão passou pelo 2FA. */
export interface Ctx { userId: string; mfaVerified: boolean }

type Scope = { lodgeId?: string; jurisdictionId?: string };
export const holds = (s: Subject, names: string[], scope: Scope, now: Date) =>
  can(s, "office", { id: "office", policy: { kind: "office", names, ...scope } }, now).allow;

export async function actorOf(db: Db, ctx: Ctx, now: Date): Promise<Subject> {
  const s = await loadSubject(db, ctx.userId, now);
  if (!s) throw new Forbidden("sem vínculo ativo");
  // quem exerce qualquer cargo só age com sessão que passou pelo 2FA
  if (s.offices.some((o) => officeActive(o, now)) && !ctx.mfaVerified) throw new Forbidden("mfa_required");
  return s;
}

export async function lodgeOf(db: Db, id: string) {
  const [l] = await db.select().from(lodges).where(eq(lodges.id, id));
  if (!l) throw new NotFound("Loja");
  return l;
}

/** Exige cargo (nomes) na Loja, ou Administração da Potência da jurisdição da Loja. */
async function lodgeAuthority(db: Db, ctx: Ctx, lodgeId: string, names: string[], now: Date) {
  const actor = await actorOf(db, ctx, now);
  const lodge = await lodgeOf(db, lodgeId);
  if (!holds(actor, names, { lodgeId }, now) && !holds(actor, [POTENCIA], { jurisdictionId: lodge.jurisdictionId }, now))
    throw new Forbidden("sem competência nesta Loja");
  return { actor, lodge };
}

const scopeOf = (l: { id: string; jurisdictionId: string }) => ({ lodgeId: l.id, jurisdictionId: l.jurisdictionId });
const dup = (e: unknown) => /duplicate key|unique/i.test(String((e as Error)?.message ?? e)) || /duplicate key|unique/i.test(String((e as { cause?: Error })?.cause?.message ?? ""));

interface Person { email: string; username: string; fullName: string; password: string }

/**
 * Fundação: cria a jurisdição, a primeira Loja e DUAS pessoas distintas (a Administração da Potência e o
 * Venerável Mestre), para que a aprovação dupla funcione desde o início. É a única exceção à aprovação
 * dupla de Grau e exige evidência, verificada fora da plataforma, da indicação pela Potência.
 */
export async function bootstrapFounders(
  db: Db,
  i: { jurisdictionName: string; lodgeName: string; lodgeNumber?: number; rite?: string; authority: Person; venerable: Person; evidence: string },
  now = new Date(),
) {
  if (i.evidence.trim().length < 10) throw new Invalid("informe a evidência da indicação pela Potência");
  if (i.authority.email.toLowerCase() === i.venerable.email.toLowerCase()) throw new Invalid("a Potência e o Venerável devem ser pessoas distintas");
  for (const p of [i.authority, i.venerable]) assertPasswordPolicy(p.password, p.email, p.username);
  const hashes = [await hashPassword(i.authority.password), await hashPassword(i.venerable.password)];
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [j] = await tx.insert(jurisdictions).values({ name: i.jurisdictionName }).returning();
    const [l] = await tx.insert(lodges).values({ jurisdictionId: j.id, name: i.lodgeName, number: i.lodgeNumber, rite: i.rite && findRite(i.rite) ? i.rite : null }).returning();
    const ids: string[] = [];
    for (const [k, p] of [i.authority, i.venerable].entries()) {
      const [u] = await tx.insert(users).values({ email: p.email.trim().toLowerCase(), username: p.username, passwordHash: hashes[k], emailVerifiedAt: now }).returning();
      await tx.insert(profiles).values({ userId: u.id, fullName: p.fullName });
      await tx.insert(institutionalMemberships).values({ userId: u.id, lodgeId: l.id, startsAt: now });
      await tx.insert(degreeAssignments).values({ userId: u.id, lodgeId: l.id, degree: 3, origin: "bootstrap", requestedBy: u.id, approvedBy: u.id, at: now });
      ids.push(u.id);
    }
    await tx.insert(officeAssignments).values([
      { userId: ids[0], jurisdictionId: j.id, name: POTENCIA, startsAt: now, appointedBy: ids[0] },
      { userId: ids[1], lodgeId: l.id, name: VM, startsAt: now, appointedBy: ids[0] },
    ]);
    await appendAudit(tx, { actorId: ids[0], action: "bootstrap.founders", subjectId: ids[1], payload: { ...scopeOf(l), authorityId: ids[0], venerableId: ids[1], evidence: i.evidence } }, now);
    return { jurisdictionId: j.id, lodgeId: l.id, authorityId: ids[0], venerableId: ids[1] };
  });
}

export async function createLodge(db: Db, ctx: Ctx, i: { jurisdictionId: string; name: string; number?: number }, now = new Date()) {
  const actor = await actorOf(db, ctx, now);
  if (!holds(actor, [POTENCIA], { jurisdictionId: i.jurisdictionId }, now)) throw new Forbidden("somente a Administração da Potência cria Lojas");
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [l] = await tx.insert(lodges).values({ jurisdictionId: i.jurisdictionId, name: i.name, number: i.number }).returning();
    await appendAudit(tx, { actorId: ctx.userId, action: "lodge.created", payload: { ...scopeOf(l), name: i.name } }, now);
    return l;
  });
}

/** Define o Rito da Loja (paleta do site). Venerável da Loja ou Administração da Potência; null = padrão. */
export async function setLodgeRite(db: Db, ctx: Ctx, lodgeId: string, rite: string | null, now = new Date()) {
  if (rite !== null && !findRite(rite)) throw new Invalid("Rito desconhecido");
  const { lodge } = await lodgeAuthority(db, ctx, lodgeId, [VM], now);
  const [cur] = await db.select({ rite: lodges.rite }).from(lodges).where(eq(lodges.id, lodgeId));
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.update(lodges).set({ rite }).where(eq(lodges.id, lodgeId));
    await appendAudit(tx, { actorId: ctx.userId, action: "lodge.rite", payload: { ...scopeOf(lodge), from: cur?.rite ?? null, to: rite } }, now);
  });
}

/**
 * Cria o convite. Quem tem competência na Loja convida; outra autoridade aprova.
 * Exceção deliberada: a Administração da Potência pode criar o convite já aprovado (`approveNow`), em qualquer Grau.
 * É auditado como convite direto e o Grau fica com origem "potencia".
 */
export async function createInvitation(db: Db, ctx: Ctx, i: { lodgeId: string; email: string; intendedDegree: number; approveNow?: boolean }, now = new Date()) {
  const { actor, lodge } = await lodgeAuthority(db, ctx, i.lodgeId, [SEC, VM], now);
  if (!Number.isInteger(i.intendedDegree) || i.intendedDegree < 1 || i.intendedDegree > 33) throw new Invalid("Grau inválido");
  const email = i.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) throw new Invalid("e-mail inválido");
  const direct = !!i.approveNow;
  if (direct && !holds(actor, [POTENCIA], { jurisdictionId: lodge.jurisdictionId }, now))
    throw new Forbidden("somente a Administração da Potência pode criar um convite já aprovado");
  const [exists] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), isNull(users.deletedAt)));
  if (exists) throw new Invalid("já existe uma conta com este e-mail na plataforma; não é preciso convidar de novo");
  const [pending] = await db.select({ id: invitations.id }).from(invitations).where(and(eq(invitations.email, email), isNull(invitations.usedAt), gt(invitations.expiresAt, now)));
  if (pending) throw new Invalid("já existe um convite pendente para este e-mail; cancele-o antes de criar outro");
  const token = randomToken();
  const [inv] = await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const r = await tx.insert(invitations).values({
      lodgeId: i.lodgeId, email, intendedDegree: i.intendedDegree, approvedBy: direct ? ctx.userId : null,
      tokenHash: sha256(token), createdBy: ctx.userId, expiresAt: new Date(now.getTime() + 14 * DAY),
    }).returning();
    await appendAudit(tx, { actorId: ctx.userId, action: "invitation.created", payload: { ...scopeOf(lodge), invitationId: r[0].id, degree: i.intendedDegree, direct } }, now);
    return r;
  });
  return { invitationId: inv.id, token, approved: direct };
}

/** Cancela um convite pendente (o link deixa de valer). */
export async function revokeInvitation(db: Db, ctx: Ctx, invitationId: string, now = new Date()) {
  const [inv] = await db.select().from(invitations).where(eq(invitations.id, invitationId));
  if (!inv || inv.usedAt || inv.expiresAt <= now) throw new NotFound("convite");
  const { lodge } = await lodgeAuthority(db, ctx, inv.lodgeId, [SEC, VM], now);
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.update(invitations).set({ expiresAt: now }).where(eq(invitations.id, inv.id));
    await appendAudit(tx, { actorId: ctx.userId, action: "invitation.revoked", payload: { ...scopeOf(lodge), invitationId: inv.id } }, now);
  });
}

export async function approveInvitation(db: Db, ctx: Ctx, invitationId: string, now = new Date()) {
  const actor = await actorOf(db, ctx, now);
  const [inv] = await db.select().from(invitations).where(eq(invitations.id, invitationId));
  if (!inv || inv.usedAt || inv.approvedBy || inv.expiresAt <= now) throw new NotFound("convite");
  const lodge = await lodgeOf(db, inv.lodgeId);
  const d = canApproveInLodge(actor, { lodgeId: lodge.id, jurisdictionId: lodge.jurisdictionId, requestedBy: inv.createdBy }, now);
  if (!d.allow) throw new Forbidden(d.reason);
  // Grau acima de Aprendiz é importação de quem já é maçom em outra Loja: só a Potência certifica.
  if (inv.intendedDegree > 1 && !holds(actor, [POTENCIA], { jurisdictionId: lodge.jurisdictionId }, now))
    throw new Forbidden("convite com Grau acima de Aprendiz exige aprovação da Administração da Potência");
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.update(invitations).set({ approvedBy: ctx.userId }).where(eq(invitations.id, inv.id));
    await appendAudit(tx, { actorId: ctx.userId, action: "invitation.approved", payload: { ...scopeOf(lodge), invitationId: inv.id, createdBy: inv.createdBy } }, now);
  });
}

export async function registerWithInvitation(
  db: Db,
  i: { token: string; email: string; username: string; fullName: string; password: string },
  now = new Date(),
) {
  assertPasswordPolicy(i.password, i.email, i.username);
  const [inv] = await db.select().from(invitations).where(eq(invitations.tokenHash, sha256(i.token)));
  if (!inv || inv.usedAt || !inv.approvedBy || inv.expiresAt <= now || inv.email !== i.email.trim().toLowerCase())
    throw new Invalid("convite inválido, não aprovado ou expirado");
  const lodge = await lodgeOf(db, inv.lodgeId);
  const [byEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, inv.email));
  if (byEmail) throw new Invalid("Já existe uma conta com este e-mail. Use “Esqueci a senha” na tela de entrada ou procure a secretaria da sua Loja.");
  const [byUser] = await db.select({ id: users.id }).from(users).where(eq(users.username, i.username));
  if (byUser) throw new Invalid("Este nome de usuário já está em uso. Escolha outro.");
  const passwordHash = await hashPassword(i.password);
  let userId: string;
  try {
    userId = await db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const [used] = await tx.update(invitations).set({ usedAt: now })
        .where(and(eq(invitations.id, inv.id), isNull(invitations.usedAt))).returning();
      if (!used) throw new Invalid("convite já utilizado");
      const [u] = await tx.insert(users).values({ email: inv.email, username: i.username, passwordHash }).returning();
      await tx.update(invitations).set({ usedBy: u.id }).where(eq(invitations.id, inv.id));
      await tx.insert(profiles).values({ userId: u.id, fullName: i.fullName });
      await tx.insert(institutionalMemberships).values({ userId: u.id, lodgeId: inv.lodgeId, startsAt: now });
      await tx.insert(degreeAssignments).values({ userId: u.id, lodgeId: inv.lodgeId, degree: inv.intendedDegree, origin: inv.createdBy === inv.approvedBy ? "potencia" : "regular", requestedBy: inv.createdBy, approvedBy: inv.approvedBy!, at: now });
      await appendAudit(tx, { actorId: u.id, action: "member.registered", subjectId: u.id, payload: { ...scopeOf(lodge), invitationId: inv.id, degree: inv.intendedDegree } }, now);
      return u.id;
    });
  } catch (e) {
    if (dup(e)) throw new Invalid("e-mail ou nome de usuário já cadastrado");
    throw e;
  }
  return { userId, verifyToken: await issueEmailToken(db, userId, "verify", now) };
}

export async function requestDegree(db: Db, ctx: Ctx, targetUserId: string, now = new Date()) {
  const target = await loadSubject(db, targetUserId, now);
  if (!target?.lodgeId) throw new NotFound("membro");
  const { lodge } = await lodgeAuthority(db, ctx, target.lodgeId, [SEC, VM], now);
  if (ctx.userId === targetUserId) throw new Forbidden("ninguém altera o próprio Grau");
  if (target.degree >= 33) throw new Invalid("Grau máximo");
  const [pending] = await db.select().from(degreeRequests).where(and(eq(degreeRequests.userId, targetUserId), eq(degreeRequests.status, "pendente")));
  if (pending) throw new Invalid("já existe solicitação pendente");
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [r] = await tx.insert(degreeRequests).values({
      userId: targetUserId, lodgeId: lodge.id, fromDegree: target.degree, toDegree: target.degree + 1, requestedBy: ctx.userId,
    }).returning();
    await appendAudit(tx, { actorId: ctx.userId, action: "degree.requested", subjectId: targetUserId, payload: { ...scopeOf(lodge), requestId: r.id, from: r.fromDegree, to: r.toDegree } }, now);
    return r;
  });
}

export async function decideDegree(db: Db, ctx: Ctx, requestId: string, approve: boolean, justification?: string, now = new Date()) {
  const actor = await actorOf(db, ctx, now);
  const [r] = await db.select().from(degreeRequests).where(eq(degreeRequests.id, requestId));
  if (!r || r.status !== "pendente") throw new NotFound("solicitação");
  const lodge = await lodgeOf(db, r.lodgeId);
  const d = canApprove(actor, { lodgeId: lodge.id, jurisdictionId: lodge.jurisdictionId, requestedBy: r.requestedBy, targetId: r.userId, fromDegree: r.fromDegree, toDegree: r.toDegree }, now);
  if (!d.allow) throw new Forbidden(d.reason);
  if (!approve && (justification ?? "").trim().length < 5) throw new Invalid("justifique a recusa");
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [done] = await tx.update(degreeRequests)
      .set({ status: approve ? "aprovada" : "recusada", decidedBy: ctx.userId, decidedAt: now, justification })
      .where(and(eq(degreeRequests.id, r.id), eq(degreeRequests.status, "pendente"))).returning();
    if (!done) throw new Invalid("solicitação já decidida");
    if (approve)
      await tx.insert(degreeAssignments).values({ userId: r.userId, lodgeId: r.lodgeId, degree: r.toDegree, requestedBy: r.requestedBy, approvedBy: ctx.userId, at: now });
    await appendAudit(tx, {
      actorId: ctx.userId, action: approve ? "degree.approved" : "degree.rejected", subjectId: r.userId,
      payload: { ...scopeOf(lodge), requestId: r.id, from: r.fromDegree, to: r.toDegree, requestedBy: r.requestedBy, justification: justification ?? null },
    }, now);
  });
}

export async function appointOffice(
  db: Db, ctx: Ctx,
  i: { userId: string; name: string; lodgeId?: string; jurisdictionId?: string; startsAt: Date; endsAt?: Date },
  now = new Date(),
) {
  if (i.endsAt && i.endsAt <= i.startsAt) throw new Invalid("o mandato deve terminar depois de começar");
  const target = await loadSubject(db, i.userId, now);
  if (!target || target.degree < 3) throw new Invalid("o cargo exige Mestre com vínculo ativo");
  let scope: { lodgeId?: string; jurisdictionId?: string };
  if (i.name === POTENCIA) {
    if (!i.jurisdictionId) throw new Invalid("informe a jurisdição");
    const actor = await actorOf(db, ctx, now);
    if (!holds(actor, [POTENCIA], { jurisdictionId: i.jurisdictionId }, now)) throw new Forbidden("somente a Administração da Potência nomeia");
    scope = { jurisdictionId: i.jurisdictionId };
  } else {
    if (!i.lodgeId) throw new Invalid("informe a Loja");
    if (target.lodgeId !== i.lodgeId) throw new Invalid("o nomeado deve ser membro da Loja");
    const names = i.name === VM ? [POTENCIA] : [VM];
    const lodge = await lodgeOf(db, i.lodgeId);
    const actor = await actorOf(db, ctx, now);
    const okPot = holds(actor, [POTENCIA], { jurisdictionId: lodge.jurisdictionId }, now);
    if (!okPot && (i.name === VM || !holds(actor, names, { lodgeId: i.lodgeId }, now))) throw new Forbidden("sem competência para nomear");
    if (i.name === VM) {
      const open = await db.select().from(officeAssignments).where(and(
        eq(officeAssignments.lodgeId, i.lodgeId), eq(officeAssignments.name, VM),
        or(isNull(officeAssignments.endsAt), gt(officeAssignments.endsAt, i.startsAt)),
      ));
      if (open.length) throw new Invalid("já existe Venerável Mestre no período; encerre o mandato anterior");
    }
    scope = scopeOf(lodge);
  }
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [o] = await tx.insert(officeAssignments).values({
      userId: i.userId, name: i.name, lodgeId: scope.lodgeId, jurisdictionId: i.name === POTENCIA ? scope.jurisdictionId : undefined,
      startsAt: i.startsAt, endsAt: i.endsAt, appointedBy: ctx.userId,
    }).returning();
    await appendAudit(tx, { actorId: ctx.userId, action: "office.appointed", subjectId: i.userId, payload: { ...scope, officeId: o.id, name: i.name, startsAt: i.startsAt.toISOString(), endsAt: i.endsAt?.toISOString() ?? null } }, now);
    return o;
  });
}

export async function endOffice(db: Db, ctx: Ctx, officeId: string, endsAt = new Date(), now = new Date()) {
  const [o] = await db.select().from(officeAssignments).where(eq(officeAssignments.id, officeId));
  if (!o) throw new NotFound("cargo");
  const actor = await actorOf(db, ctx, now);
  let scope: Scope;
  if (o.lodgeId) {
    const lodge = await lodgeOf(db, o.lodgeId);
    scope = scopeOf(lodge);
    const mayEnd = holds(actor, [POTENCIA], { jurisdictionId: lodge.jurisdictionId }, now) || (o.name !== VM && holds(actor, [VM], { lodgeId: lodge.id }, now));
    if (!mayEnd) throw new Forbidden("sem competência para encerrar");
  } else {
    scope = { jurisdictionId: o.jurisdictionId ?? undefined };
    if (!o.jurisdictionId || !holds(actor, [POTENCIA], { jurisdictionId: o.jurisdictionId }, now)) throw new Forbidden("sem competência para encerrar");
  }
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.update(officeAssignments).set({ endsAt }).where(eq(officeAssignments.id, o.id));
    await appendAudit(tx, { actorId: ctx.userId, action: "office.ended", subjectId: o.userId, payload: { ...scope, officeId: o.id, name: o.name, endsAt: endsAt.toISOString() } }, now);
  });
}

export async function setMemberStatus(
  db: Db, ctx: Ctx, userId: string,
  status: "regular" | "debito" | "licenciado" | "suspenso" | "eliminado" | "falecido", justification: string, now = new Date(),
) {
  if (justification.trim().length < 5) throw new Invalid("justificativa obrigatória");
  const target = await loadSubject(db, userId, now);
  if (!target?.lodgeId) throw new NotFound("membro");
  const lodge = await lodgeOf(db, target.lodgeId);
  const actor = await actorOf(db, ctx, now);
  if (ctx.userId === userId) throw new Forbidden("ninguém altera o próprio status");
  if (!holds(actor, [VM], { lodgeId: lodge.id }, now) && !holds(actor, [POTENCIA], { jurisdictionId: lodge.jurisdictionId }, now))
    throw new Forbidden("somente o Venerável Mestre ou a Potência alteram o status");
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.update(institutionalMemberships).set({ status })
      .where(and(eq(institutionalMemberships.userId, userId), isNull(institutionalMemberships.endsAt)));
    if (["suspenso", "eliminado", "falecido"].includes(status))
      await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    await appendAudit(tx, { actorId: ctx.userId, action: "member.status", subjectId: userId, payload: { ...scopeOf(lodge), from: target.status, to: status, justification } }, now);
  });
}

async function memberAuthority(db: Db, ctx: Ctx, userId: string, justification: string, now: Date) {
  if (justification.trim().length < 5) throw new Invalid("justificativa obrigatória");
  const target = await loadSubject(db, userId, now);
  if (!target?.lodgeId) throw new NotFound("membro");
  const lodge = await lodgeOf(db, target.lodgeId);
  const actor = await actorOf(db, ctx, now);
  if (ctx.userId === userId) throw new Forbidden("use as opções do seu próprio perfil");
  const isPot = holds(actor, [POTENCIA], { jurisdictionId: lodge.jurisdictionId }, now);
  if (!isPot && !holds(actor, [VM], { lodgeId: lodge.id }, now)) throw new Forbidden("somente o Venerável da Loja ou a Administração da Potência");
  // autoridade da Potência só é mexida por outra autoridade da Potência
  if (target.offices.some((o) => o.name === POTENCIA && officeActive(o, now)) && !isPot) throw new Forbidden("somente a Administração da Potência altera o acesso de outra autoridade da Potência");
  return { lodge };
}

/** Perdeu o autenticador e os códigos de recuperação: a autoridade redefine o 2FA do membro (ele cadastra um novo no próximo acesso). */
export async function resetMemberTotp(db: Db, ctx: Ctx, userId: string, justification: string, now = new Date()) {
  const { lodge } = await memberAuthority(db, ctx, userId, justification, now);
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.delete(userTotp).where(eq(userTotp.userId, userId));
    await clearRecoveryCodes(tx, userId);
    await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    await appendAudit(tx, { actorId: ctx.userId, action: "auth.2fa_reset", subjectId: userId, payload: { ...scopeOf(lodge), justification } }, now);
  });
}

/** Membro sem acesso ao e-mail antigo: a autoridade troca o endereço (sem exibi-los na auditoria). O membro confirma o novo e usa "Esqueci a senha". */
export async function changeMemberEmail(db: Db, ctx: Ctx, userId: string, newEmail: string, justification: string, now = new Date()) {
  const email = newEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) throw new Invalid("e-mail inválido");
  const { lodge } = await memberAuthority(db, ctx, userId, justification, now);
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (taken) throw new Invalid("este e-mail já está em uso por outra conta");
  const [cur] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.update(users).set({ email, emailVerifiedAt: null, failedAttempts: 0, lockedUntil: null }).where(eq(users.id, userId));
    await tx.delete(emailTokens).where(eq(emailTokens.userId, userId));
    await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    await appendAudit(tx, { actorId: ctx.userId, action: "member.email_changed", subjectId: userId, payload: { ...scopeOf(lodge), from: mask(cur.email), to: mask(email), justification } }, now);
  });
  return { verifyToken: await issueEmailToken(db, userId, "verify", now) };
}

/** Autoridades leem a auditoria do próprio escopo: Potência (jurisdição) ou Venerável/Secretário (Loja). */
export async function listAudit(db: Db, ctx: Ctx, now = new Date()) {
  const actor = await actorOf(db, ctx, now);
  const pot = actor.offices.filter((o) => o.name === POTENCIA && officeActive(o, now)).map((o) => o.jurisdictionId);
  const lod = actor.offices.filter((o) => [VM, SEC].includes(o.name) && officeActive(o, now)).map((o) => o.lodgeId);
  if (!pot.length && !lod.length) throw new Forbidden("sem competência para consultar a auditoria");
  // Filtra no PostgreSQL: não carrega a cadeia global inteira para descartar quase todos os eventos em JS.
  const scoped = await db.select().from(accessAuditLogs).where(or(
    pot.length ? inArray(sql<string>`${accessAuditLogs.payload}->>'jurisdictionId'`, pot) : undefined,
    lod.length ? inArray(sql<string>`${accessAuditLogs.payload}->>'lodgeId'`, lod) : undefined,
  )).orderBy(asc(accessAuditLogs.seq));
  return scoped.map((e) => ({
    seq: e.seq, at: e.at.toISOString(), actorId: e.actorId, action: e.action,
    subjectId: e.subjectId, payload: e.payload, prevHash: e.prevHash, hash: e.hash,
  }));
}
