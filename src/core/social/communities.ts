import { and, asc, desc, eq, ilike } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import { withUser } from "@/shared/database/rls";
import { communities, communityReplies, communityTopics, reports, scrapbookPosts } from "@/shared/database/schema";
import { parseRule } from "@/contracts/rule-schema";
import { can } from "@/access-control/engine/can";
import { Forbidden, Invalid, NotFound } from "../errors";
import { isRls, requireMember } from "./guard";

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const text = (v: string, max: number, what: string) => {
  const t = v.trim();
  if (!t || t.length > max) throw new Invalid(`${what}: de 1 a ${max} caracteres`);
  return t;
};

/** A comunidade só pode ser criada com uma política que o próprio criador satisfaz. */
export async function createCommunity(db: Db, me: string, i: { slug: string; name: string; description?: string; policy: unknown }) {
  const subject = await requireMember(db, me);
  if (!SLUG.test(i.slug)) throw new Invalid("identificador inválido");
  let policy;
  try { policy = parseRule(i.policy); } catch { throw new Invalid("política de acesso inválida"); }
  if (!can(subject, "create", { id: i.slug, policy }).allow) throw new Forbidden("você não satisfaz a política que está definindo");
  try {
    return await withUser(db, me, async (tx) => (await tx.insert(communities).values({
      slug: i.slug, name: text(i.name, 120, "nome"), description: i.description?.slice(0, 1000), policy, createdBy: me,
    }).returning())[0]);
  } catch (e) {
    if (isRls(e)) throw new Forbidden("política não permitida");
    if (/duplicate|unique/i.test(String((e as { cause?: Error }).cause?.message ?? e))) throw new Invalid("identificador já em uso");
    throw e;
  }
}

/** Lista só as comunidades autorizadas (o RLS filtra no banco). */
export async function listCommunities(db: Db, me: string, q?: string) {
  await requireMember(db, me);
  return withUser(db, me, (tx) =>
    tx.select({ id: communities.id, slug: communities.slug, name: communities.name, description: communities.description })
      .from(communities).where(q ? ilike(communities.name, `%${q.replace(/[%_\\]/g, "\\$&")}%`) : undefined).orderBy(asc(communities.name)));
}

async function community(tx: Db, slug: string) {
  const [c] = await tx.select().from(communities).where(eq(communities.slug, slug));
  if (!c) throw new NotFound("comunidade"); // inexistente e não autorizada são indistinguíveis
  return c;
}

export async function getCommunity(db: Db, me: string, slug: string) {
  await requireMember(db, me);
  return withUser(db, me, async (tx) => {
    const c = await community(tx, slug);
    const topics = await tx.select().from(communityTopics).where(eq(communityTopics.communityId, c.id))
      .orderBy(desc(communityTopics.pinned), desc(communityTopics.createdAt));
    return { community: { id: c.id, slug: c.slug, name: c.name, description: c.description }, topics };
  });
}

export async function createTopic(db: Db, me: string, slug: string, i: { title: string; body: string }) {
  await requireMember(db, me);
  const t = { title: text(i.title, 200, "título"), body: text(i.body, 5000, "texto") };
  return withUser(db, me, async (tx) => {
    const c = await community(tx, slug);
    return (await tx.insert(communityTopics).values({ communityId: c.id, authorId: me, ...t }).returning())[0];
  });
}

export async function getTopic(db: Db, me: string, topicId: string) {
  await requireMember(db, me);
  return withUser(db, me, async (tx) => {
    const [t] = await tx.select().from(communityTopics).where(eq(communityTopics.id, topicId));
    if (!t) throw new NotFound("tópico");
    const replies = await tx.select().from(communityReplies).where(eq(communityReplies.topicId, t.id)).orderBy(asc(communityReplies.createdAt));
    return { topic: t, replies };
  });
}

export async function replyTopic(db: Db, me: string, topicId: string, body: string) {
  await requireMember(db, me);
  const b = text(body, 5000, "resposta");
  try {
    return await withUser(db, me, async (tx) => (await tx.insert(communityReplies).values({ topicId, authorId: me, body: b }).returning())[0]);
  } catch (e) {
    if (isRls(e) || /foreign key/i.test(String((e as { cause?: Error }).cause?.message ?? e))) throw new NotFound("tópico");
    throw e;
  }
}

/** Fixar: só o criador da comunidade (que continua autorizado a vê-la). */
export async function pinTopic(db: Db, me: string, topicId: string, pinned: boolean) {
  await requireMember(db, me);
  const ok = await withUser(db, me, async (tx) => {
    const [t] = await tx.select().from(communityTopics).where(eq(communityTopics.id, topicId));
    if (!t) return false;
    const [c] = await tx.select().from(communities).where(eq(communities.id, t.communityId));
    return !!c && c.createdBy === me;
  });
  if (!ok) throw new NotFound("tópico");
  await db.update(communityTopics).set({ pinned }).where(eq(communityTopics.id, topicId));
}

/** Denúncia: só de conteúdo que o denunciante consegue ver, para não servir de sonda de IDs. */
export async function reportContent(db: Db, me: string, i: { kind: "topic" | "reply" | "scrap"; id: string; reason: string }) {
  await requireMember(db, me);
  const reason = text(i.reason, 1000, "motivo");
  await withUser(db, me, async (tx) => {
    const table = { topic: communityTopics, reply: communityReplies, scrap: scrapbookPosts }[i.kind];
    const rows = await tx.select({ id: table.id }).from(table).where(eq(table.id, i.id));
    if (!rows.length) throw new NotFound("conteúdo");
    await tx.insert(reports).values({ reporterId: me, targetKind: i.kind, targetId: i.id, reason });
  });
}

export { and };
