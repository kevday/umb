import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMemberPage } from "@/web/session";
import { getDb } from "@/web/db";
import { orNotFound } from "@/web/form";
import { Flash, fdate, type SP } from "@/web/ui";
import { getTopic } from "@/core/social/communities";
import { reportCreate, replyCreate } from "../../../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TopicPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<SP> }) {
  const { slug, id } = await params, s = await searchParams;
  if (!UUID.test(id)) notFound();
  const p = await requireMemberPage();
  const { topic, replies } = await orNotFound(getTopic(getDb(), p.session.userId, id));
  const path = `/communities/${slug}/t/${id}`;
  const report = (kind: string, rid: string) => (
    <form action={reportCreate} className="inline">
      <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={rid} /><input type="hidden" name="path" value={path} />
      <input name="reason" placeholder="Motivo da denúncia" required /><button className="danger">Denunciar</button>
    </form>
  );
  return (
    <>
      <p><Link href={`/communities/${slug}`}>← Comunidade</Link></p>
      <h1>{topic.title}</h1>
      <Flash s={s} />
      <div className="card">
        <div>{topic.body}</div>
        <div className="row mut"><span><Link href={`/profile/${topic.authorId}`}>ver autor</Link> · {fdate(topic.createdAt)}</span>{topic.authorId !== p.session.userId && report("topic", topic.id)}</div>
      </div>
      <h2>Respostas ({replies.length})</h2>
      {replies.map((r) => (
        <div className="card" key={r.id}>
          <div>{r.body}</div>
          <div className="row mut"><span><Link href={`/profile/${r.authorId}`}>ver autor</Link> · {fdate(r.createdAt)}</span>{r.authorId !== p.session.userId && report("reply", r.id)}</div>
        </div>
      ))}
      <form action={replyCreate} className="card stack">
        <input type="hidden" name="slug" value={slug} /><input type="hidden" name="topicId" value={id} />
        <label htmlFor="body">Responder</label><textarea id="body" name="body" maxLength={5000} required />
        <button>Enviar resposta</button>
      </form>
    </>
  );
}
