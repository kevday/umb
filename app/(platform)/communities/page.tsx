import Link from "next/link";
import { requireMemberPage } from "@/web/session";
import { getDb } from "@/web/db";
import { Flash, type SP } from "@/web/ui";
import { listCommunities } from "@/core/social/communities";
import { communityCreate } from "../actions";

export default async function Communities({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams, p = await requireMemberPage();
  const list = await listCommunities(getDb(), p.session.userId, s.q);
  return (
    <>
      <h1>Comunidades</h1>
      <Flash s={s} />
      <form className="card row" action="/communities"><input type="search" name="q" defaultValue={s.q} placeholder="Buscar comunidades" /><button>Buscar</button></form>
      {list.length === 0 && <p className="mut">Nenhuma comunidade disponível para você.</p>}
      {list.map((c) => (
        <div className="card" key={c.id}>
          <Link href={`/communities/${c.slug}`}><strong>{c.name}</strong></Link>
          {c.description && <div className="mut">{c.description}</div>}
        </div>
      ))}
      <h2>Criar comunidade</h2>
      <form action={communityCreate} className="card stack">
        <label htmlFor="name">Nome</label><input id="name" name="name" type="text" required />
        <label htmlFor="slug">Identificador (letras minúsculas, números e hífen)</label><input id="slug" name="slug" type="text" pattern="[a-z0-9][a-z0-9-]{1,62}" required />
        <label htmlFor="description">Descrição</label><input id="description" name="description" type="text" />
        <label htmlFor="minDegree">Grau mínimo</label>
        <select id="minDegree" name="minDegree">
          <option value="1">Aprendiz</option>
          <option value="2" disabled={p.subject.degree < 2}>Companheiro</option>
          <option value="3" disabled={p.subject.degree < 3}>Mestre</option>
        </select>
        <label><input type="checkbox" name="lodgeOnly" /> Restrita à minha Loja</label>
        <button>Criar</button>
      </form>
    </>
  );
}
