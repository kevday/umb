import { and, eq, ilike, or } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import { withUser } from "@/shared/database/rls";
import { friendships, profiles } from "@/shared/database/schema";
import { Invalid, NotFound } from "../errors";
import { isFk, requireMember } from "./guard";
import { loadSubject } from "@/access-control/subject";

const between = (a: string, b: string) =>
  or(and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)), and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a)));

export async function requestFriend(db: Db, me: string, other: string) {
  await requireMember(db, me);
  if (me === other) throw new Invalid("não é possível adicionar a si mesmo");
  try {
    await withUser(db, me, async (tx) => {
      const rows = await tx.select().from(friendships).where(between(me, other));
      if (rows.some((r) => r.status === "bloqueada")) throw new NotFound("usuário"); // bloqueio não é revelado
      if (rows.length) throw new Invalid("já existe amizade ou solicitação");
      await tx.insert(friendships).values({ requesterId: me, addresseeId: other });
    });
  } catch (e) {
    if (isFk(e)) throw new NotFound("usuário");
    throw e;
  }
}

export async function respondFriend(db: Db, me: string, requesterId: string, accept: boolean) {
  await requireMember(db, me);
  await withUser(db, me, async (tx) => {
    const where = and(eq(friendships.requesterId, requesterId), eq(friendships.addresseeId, me), eq(friendships.status, "pendente"));
    const rows = accept ? await tx.update(friendships).set({ status: "aceita" }).where(where).returning() : await tx.delete(friendships).where(where).returning();
    if (!rows.length) throw new NotFound("solicitação");
  });
}

export async function removeFriend(db: Db, me: string, other: string) {
  await withUser(db, me, (tx) => tx.delete(friendships).where(and(between(me, other), eq(friendships.status, "aceita"))));
}

export async function blockUser(db: Db, me: string, other: string) {
  await requireMember(db, me);
  if (me === other) throw new Invalid("operação inválida");
  await withUser(db, me, async (tx) => {
    await tx.delete(friendships).where(between(me, other));
    await tx.insert(friendships).values({ requesterId: me, addresseeId: other, status: "bloqueada" });
  });
}

export async function listFriends(db: Db, me: string) {
  return withUser(db, me, async (tx) => {
    const rows = await tx.select().from(friendships).where(and(eq(friendships.status, "aceita"), or(eq(friendships.requesterId, me), eq(friendships.addresseeId, me))));
    const ids = rows.map((r) => (r.requesterId === me ? r.addresseeId : r.requesterId));
    const ps = ids.length ? await tx.select().from(profiles) : [];
    return ids.map((id) => ({ id, name: ps.find((p) => p.userId === id)?.displayName ?? ps.find((p) => p.userId === id)?.fullName ?? "" }));
  });
}

export async function pendingRequests(db: Db, me: string) {
  return withUser(db, me, (tx) => tx.select().from(friendships).where(and(eq(friendships.addresseeId, me), eq(friendships.status, "pendente"))));
}

/** Diretório de membros por nome (o perfil é identidade pública entre membros; dados institucionais, não). */
export async function searchMembers(db: Db, me: string, q: string) {
  await requireMember(db, me);
  const term = q.trim();
  if (term.length < 2) return [];
  return withUser(db, me, (tx) =>
    tx.select({ id: profiles.userId, name: profiles.fullName }).from(profiles)
      .where(ilike(profiles.fullName, `%${term.replace(/[%_\\]/g, "\\$&")}%`)).limit(20));
}

export async function namesOf(db: Db, me: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await withUser(db, me, (tx) => tx.select({ id: profiles.userId, name: profiles.fullName }).from(profiles));
  return new Map(rows.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.name]));
}

export async function areFriends(db: Db, me: string, other: string) {
  const rows = await withUser(db, me, (tx) => tx.select().from(friendships).where(and(between(me, other), eq(friendships.status, "aceita"))));
  return rows.length > 0;
}

/** Dados institucionais (Grau, cargos, Loja) só para o próprio, amigos e membros da mesma Loja. */
export async function canSeeInstitutional(db: Db, me: string, other: string) {
  if (me === other) return true;
  if (await areFriends(db, me, other)) return true;
  const [a, b] = await Promise.all([loadSubject(db, me), loadSubject(db, other)]);
  return !!a?.lodgeId && a.lodgeId === b?.lodgeId;
}
