import Link from "next/link";
import { requireMemberPage } from "@/web/session";
import { getDb } from "@/web/db";
import { orNotFound } from "@/web/form";
import { Flash, fdate, type SP } from "@/web/ui";
import { getCommunity } from "@/core/social/communities";
import { topicCreate, topicPin } from "../../actions";

export default async function CommunityPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params, s = await searchParams, p = await requireMemberPage();
  const { community: c, topics } = await orNotFound(getCommunity(getDb(), p.session.userId, slug));
  const owner = c.createdBy === p.session.userId;
  return (
    <>
      <h1>{c.name}</h1>
      {c.description && <p className="mut">{c.description}</p>}
      <Flash s={s} />
      {topics.length === 0 && <p className="mut">Nenhum tópico ainda.</p>}
      {topics.map((t) => (
        <div className="card row" key={t.id}>
          <span>{t.pinned && <span className="tag">fixado</span>} <Link href={`/communities/${slug}/t/${t.id}`}>{t.title}</Link><span className="mut"> · {fdate(t.createdAt)}</span></span>
          {owner && (
            <form action={topicPin} className="inline">
              <input type="hidden" name="id" value={t.id} /><input type="hidden" name="slug" value={slug} /><input type="hidden" name="pinned" value={t.pinned ? "0" : "1"} />
              <button className="sec">{t.pinned ? "Desafixar" : "Fixar"}</button>
            </form>
          )}
        </div>
      ))}
      <h2>Novo tópico</h2>
      <form action={topicCreate} className="card stack">
        <input type="hidden" name="slug" value={slug} />
        <label htmlFor="title">Título</label><input id="title" name="title" type="text" maxLength={200} required />
        <label htmlFor="body">Texto</label><textarea id="body" name="body" maxLength={5000} required />
        <button>Publicar</button>
      </form>
    </>
  );
}
