import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requirePage } from "@/web/session";
import { getDb } from "@/web/db";
import { orNotFound } from "@/web/form";
import { Flash, fdate, grau, type SP } from "@/web/ui";
import { lodges, profiles } from "@/shared/database/schema";
import { withUser } from "@/shared/database/rls";
import { loadSubject } from "@/access-control/subject";
import { areFriends, canSeeInstitutional } from "@/core/social/friends";
import { listScrap } from "@/core/social/scrapbook";
import { friendRequest, reportCreate, scrapDelete, scrapPost } from "../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Profile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params, s = await searchParams;
  if (!UUID.test(id)) notFound();
  const p = await requirePage(), db = getDb(), me = p.session.userId;
  if (p.subject.technicalAdmin) notFound();
  const [prof] = await withUser(db, me, (tx) => tx.select().from(profiles).where(eq(profiles.userId, id)));
  if (!prof) notFound();
  const own = id === me, friend = own || (await areFriends(db, me, id));
  const inst = await canSeeInstitutional(db, me, id);
  const subj = inst ? await loadSubject(db, id) : null;
  const [lodge] = subj?.lodgeId ? await db.select().from(lodges).where(eq(lodges.id, subj.lodgeId)) : [];
  const posts = await orNotFound(listScrap(db, me, id));
  const offices = subj?.offices.filter((o) => !o.endsAt || o.endsAt > new Date()) ?? [];
  const visibility = (prof.visibility ?? {}) as Record<string, string>;
  // Sem configuração explícita, a biografia é privada. "autorizados" permanece negado
  // até existir um mecanismo de concessão individual verificável.
  const bioScope = visibility.bio ?? "eu";
  const sameLodge = !!p.subject.lodgeId && p.subject.lodgeId === subj?.lodgeId;
  const showBio = own || (bioScope === "amigos" && friend) || (bioScope === "loja" && sameLodge);
  return (
    <>
      <h1>{prof.displayName ?? prof.fullName}</h1>
      <Flash s={s} />
      <div className="card">
        {subj ? (
          <div>{grau(subj.degree)}{lodge ? ` · ${lodge.name}` : ""}{offices.length ? ` · ${offices.map((o) => o.name).join(", ")}` : ""}</div>
        ) : <div className="mut">Informações institucionais restritas.</div>}
        {showBio && prof.bio && <p>{prof.bio}</p>}
        {!own && !friend && (
          <form action={friendRequest}><input type="hidden" name="id" value={id} /><button>Adicionar aos amigos</button></form>
        )}
      </div>
      <h2>Recados</h2>
      {friend ? (
        <form action={scrapPost} className="card stack">
          <input type="hidden" name="profileId" value={id} />
          <label htmlFor="body">Escrever um recado</label>
          <textarea id="body" name="body" maxLength={500} required />
          <button>Enviar</button>
        </form>
      ) : <p className="mut">Somente amigos escrevem no mural.</p>}
      {posts.length === 0 && <p className="mut">Nenhum recado ainda.</p>}
      {posts.map((x) => (
        <div className="card" key={x.id}>
          <div>{x.body}</div>
          <div className="row mut">
            <span><Link href={`/profile/${x.authorId}`}>{x.authorName}</Link> · {fdate(x.createdAt)}</span>
            <span className="row">
              {(x.authorId === me || own) && (
                <form action={scrapDelete} className="inline"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="profileId" value={id} /><button className="sec">Excluir</button></form>
              )}
              {x.authorId !== me && (
                <form action={reportCreate} className="inline">
                  <input type="hidden" name="kind" value="scrap" /><input type="hidden" name="id" value={x.id} /><input type="hidden" name="path" value={`/profile/${id}`} />
                  <input name="reason" placeholder="Motivo da denúncia" required /><button className="danger">Denunciar</button>
                </form>
              )}
            </span>
          </div>
        </div>
      ))}
    </>
  );
}
