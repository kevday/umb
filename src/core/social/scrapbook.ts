import { desc, eq } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import { withUser } from "@/shared/database/rls";
import { profiles, scrapbookPosts } from "@/shared/database/schema";
import { Forbidden, Invalid, NotFound } from "../errors";
import { isFk, isRls, requireMember } from "./guard";

const clean = (b: string) => {
  const t = b.trim();
  if (!t || t.length > 500) throw new Invalid("o recado deve ter de 1 a 500 caracteres");
  return t;
};

export async function postScrap(db: Db, me: string, profileId: string, body: string) {
  await requireMember(db, me);
  const text = clean(body);
  try {
    return await withUser(db, me, async (tx) => (await tx.insert(scrapbookPosts).values({ profileId, authorId: me, body: text }).returning())[0]);
  } catch (e) {
    if (isRls(e)) throw new Forbidden("somente amigos escrevem no scrapbook");
    if (isFk(e)) throw new NotFound("perfil");
    throw e;
  }
}

/** O RLS decide o que cada leitor enxerga: dono, autor ou amigo do dono. */
export async function listScrap(db: Db, me: string, profileId: string, page = { limit: 20, offset: 0 }) {
  await requireMember(db, me);
  return withUser(db, me, async (tx) => {
    const rows = await tx.select().from(scrapbookPosts).where(eq(scrapbookPosts.profileId, profileId))
      .orderBy(desc(scrapbookPosts.createdAt)).limit(Math.min(page.limit, 50)).offset(page.offset);
    const ps = await tx.select().from(profiles);
    return rows.map((r) => ({ ...r, authorName: ps.find((p) => p.userId === r.authorId)?.fullName ?? "" }));
  });
}

export async function deleteScrap(db: Db, me: string, postId: string) {
  const rows = await withUser(db, me, (tx) => tx.delete(scrapbookPosts).where(eq(scrapbookPosts.id, postId)).returning());
  if (!rows.length) throw new NotFound("recado");
}
