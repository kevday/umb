import { and, eq, isNull, or } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import {
  communityReplies, communityTopics, degreeAssignments, emailTokens, friendships, institutionalMemberships, lodges, officeAssignments,
  profiles, reports, scrapbookPosts, sessions, userTotp, users, recoveryCodes,
} from "@/shared/database/schema";
import { appendAudit } from "@/access-control/audit/store";
import { hashPassword, verifyPassword } from "./auth/password";
import { randomToken } from "./auth/crypto";
import { Invalid, NotFound } from "./errors";

/** LGPD: cópia dos dados do próprio titular (art. 18). Nunca inclui hash de senha nem segredo do 2FA. */
export async function exportMyData(db: Db, me: string) {
  const [u] = await db.select({ id: users.id, email: users.email, username: users.username, createdAt: users.createdAt }).from(users).where(eq(users.id, me));
  if (!u) throw new NotFound("conta");
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, me));
  return {
    geradoEm: new Date().toISOString(),
    conta: u, perfil: profile ?? null,
    vinculos: await db.select().from(institutionalMemberships).where(eq(institutionalMemberships.userId, me)),
    historicoDeGraus: await db.select({ grau: degreeAssignments.degree, origem: degreeAssignments.origin, em: degreeAssignments.at }).from(degreeAssignments).where(eq(degreeAssignments.userId, me)),
    cargos: await db.select().from(officeAssignments).where(eq(officeAssignments.userId, me)),
    amizades: await db.select().from(friendships).where(or(eq(friendships.requesterId, me), eq(friendships.addresseeId, me))),
    recadosEscritos: await db.select().from(scrapbookPosts).where(eq(scrapbookPosts.authorId, me)),
    recadosRecebidos: await db.select().from(scrapbookPosts).where(eq(scrapbookPosts.profileId, me)),
    topicos: await db.select().from(communityTopics).where(eq(communityTopics.authorId, me)),
    respostas: await db.select().from(communityReplies).where(eq(communityReplies.authorId, me)),
    denuncias: await db.select().from(reports).where(eq(reports.reporterId, me)),
  };
}

/**
 * Exclusão por anonimização: dados pessoais são removidos; o conteúdo permanece sem identificação e a auditoria
 * institucional é mantida (sem dados diretos), conforme a política de retenção.
 */
export async function deleteAccount(db: Db, me: string, password: string, now = new Date()) {
  const [u] = await db.select().from(users).where(eq(users.id, me));
  if (!u || u.deletedAt) throw new NotFound("conta");
  if (!(await verifyPassword(u.passwordHash, password))) throw new Invalid("senha incorreta");
  const dead = await hashPassword(randomToken());
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    // Serializa a exclusão com novas nomeações: o lock da conta é adquirido antes de
    // consultar cargos e impede que outra transação insira uma nomeação concorrente.
    const [locked] = await tx.select({ id: users.id, deletedAt: users.deletedAt }).from(users)
      .where(eq(users.id, me)).for("update");
    if (!locked || locked.deletedAt) throw new NotFound("conta");
    const offs = await tx.select().from(officeAssignments).where(eq(officeAssignments.userId, me));
    if (offs.some((o) => o.startsAt <= now && (!o.endsAt || o.endsAt > now)))
      throw new Invalid("encerre seus cargos antes de excluir a conta (peça à autoridade competente)");
    const [m] = await tx.select({ lodgeId: institutionalMemberships.lodgeId, jurisdictionId: lodges.jurisdictionId }).from(institutionalMemberships)
      .innerJoin(lodges, eq(lodges.id, institutionalMemberships.lodgeId))
      .where(and(eq(institutionalMemberships.userId, me), isNull(institutionalMemberships.endsAt)));
    await tx.update(users).set({ deletedAt: now, email: `removido-${me}@invalid.local`, username: `removido-${me.slice(0, 8)}`, passwordHash: dead }).where(eq(users.id, me));
    await tx.update(profiles).set({ fullName: "Membro removido", displayName: null, bio: null, visibility: {} }).where(eq(profiles.userId, me));
    await tx.update(institutionalMemberships).set({ endsAt: now }).where(and(eq(institutionalMemberships.userId, me), isNull(institutionalMemberships.endsAt)));
    await tx.delete(friendships).where(or(eq(friendships.requesterId, me), eq(friendships.addresseeId, me)));
    await tx.delete(userTotp).where(eq(userTotp.userId, me));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, me));
    await tx.delete(emailTokens).where(eq(emailTokens.userId, me));
    await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, me), isNull(sessions.revokedAt)));
    await appendAudit(tx, { actorId: me, action: "account.deleted", subjectId: me, payload: { lodgeId: m?.lodgeId ?? null, jurisdictionId: m?.jurisdictionId ?? null } }, now);
  });
}

export type BioVisibility = "eu" | "amigos" | "loja";

/** Sem configuração, a biografia é privada. "autorizados" fica fora até existir concessão individual. */
export async function updateProfile(db: Db, me: string, i: { displayName?: string; bio?: string; bioVisibility?: string }) {
  const displayName = (i.displayName ?? "").trim().slice(0, 80) || null, bio = (i.bio ?? "").trim().slice(0, 500) || null;
  const vis: BioVisibility = (["eu", "amigos", "loja"] as const).find((v) => v === i.bioVisibility) ?? "eu";
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, me));
  await db.update(profiles).set({ displayName, bio, visibility: { ...((p?.visibility ?? {}) as object), bio: vis } }).where(eq(profiles.userId, me));
}
