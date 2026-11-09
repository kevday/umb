import Link from "next/link";
import { requireMemberPage } from "@/web/session";
import { getDb } from "@/web/db";
import { Flash, type SP } from "@/web/ui";
import { listFriends, namesOf, pendingRequests, searchMembers } from "@/core/social/friends";
import { friendBlock, friendRemove, friendRequest, friendRespond } from "../actions";

export default async function Friends({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams, p = await requireMemberPage(), db = getDb(), me = p.session.userId;
  const [friends, pending, found] = await Promise.all([listFriends(db, me), pendingRequests(db, me), s.q ? searchMembers(db, me, s.q) : Promise.resolve([])]);
  const names = await namesOf(db, me, pending.map((r) => r.requesterId));
  const friendIds = new Set(friends.map((f) => f.id));
  return (
    <>
      <h1>Amigos</h1>
      <Flash s={s} />
      {pending.length > 0 && <h2>Solicitações recebidas</h2>}
      {pending.map((r) => (
        <div className="card row" key={r.requesterId}>
          <Link href={`/profile/${r.requesterId}`}>{names.get(r.requesterId) ?? "Membro"}</Link>
          <span className="row">
            <form action={friendRespond} className="inline"><input type="hidden" name="id" value={r.requesterId} /><input type="hidden" name="accept" value="1" /><button>Aceitar</button></form>
            <form action={friendRespond} className="inline"><input type="hidden" name="id" value={r.requesterId} /><input type="hidden" name="accept" value="0" /><button className="sec">Recusar</button></form>
            <form action={friendBlock} className="inline"><input type="hidden" name="id" value={r.requesterId} /><button className="danger">Bloquear</button></form>
          </span>
        </div>
      ))}
      <h2>Meus amigos ({friends.length})</h2>
      {friends.map((f) => (
        <div className="card row" key={f.id}>
          <Link href={`/profile/${f.id}`}>{f.name}</Link>
          <form action={friendRemove} className="inline"><input type="hidden" name="id" value={f.id} /><button className="sec">Remover</button></form>
        </div>
      ))}
      <h2>Procurar membros</h2>
      <form className="card row" action="/friends"><input type="search" name="q" defaultValue={s.q} placeholder="Nome (mín. 2 letras)" /><button>Buscar</button></form>
      {found.filter((m) => m.id !== me).map((m) => (
        <div className="card row" key={m.id}>
          <Link href={`/profile/${m.id}`}>{m.name}</Link>
          {friendIds.has(m.id) ? <span className="tag">amigo</span> : <form action={friendRequest} className="inline"><input type="hidden" name="id" value={m.id} /><button>Adicionar</button></form>}
        </div>
      ))}
    </>
  );
}
