import Link from "next/link";
import { eq } from "drizzle-orm";
import { requirePage } from "@/web/session";
import { getDb } from "@/web/db";
import { lodges, profiles } from "@/shared/database/schema";
import { listCommunities, recentTopics } from "@/core/social/communities";
import { pendingRequests } from "@/core/social/friends";
import { grau } from "@/web/ui";

export default async function Home() {
  const p = await requirePage(), db = getDb(), me = p.session.userId;
  if (p.subject.technicalAdmin)
    return <><h1>Administração técnica</h1><div className="card">Esta conta opera a infraestrutura. Ela não tem autoridade maçônica nem acesso a conteúdo de membros.</div></>;
  const [prof] = await db.select().from(profiles).where(eq(profiles.userId, me));
  const [lodge] = p.subject.lodgeId ? await db.select().from(lodges).where(eq(lodges.id, p.subject.lodgeId)) : [];
  const [comms, recent, pending] = await Promise.all([listCommunities(db, me), recentTopics(db, me), pendingRequests(db, me)]);
  const offices = p.subject.offices.filter((o) => !o.endsAt || o.endsAt > new Date());
  return (
    <>
      <h1>Olá, {prof?.fullName.split(" ")[0]}</h1>
      {offices.length > 0 && !p.session.mfaVerified && <p className="msg err" role="alert">Sua conta exerce cargo institucional e ainda não confirmou o 2FA. Ative a verificação em duas etapas em Configurações para realizar operações de autoridade.</p>}
      <div className="card">
        <strong>{prof?.fullName}</strong>
        <div className="mut">{grau(p.subject.degree)}{lodge ? ` · ${lodge.name}` : ""}{offices.length ? ` · ${offices.map((o) => o.name).join(", ")}` : ""}</div>
      </div>
      <div className="card row">
        <span><Link href="/communities">{comms.length} {comms.length === 1 ? "comunidade" : "comunidades"}</Link> {comms.length === 1 ? "disponível" : "disponíveis"}</span>
        <span><Link href="/friends">{pending.length} {pending.length === 1 ? "solicitação" : "solicitações"}</Link> de amizade</span>
      </div>
      <h2>Atividade recente</h2>
      {recent.length === 0 && <p className="mut">Nada por aqui ainda.</p>}
      {recent.map((t) => (
        <div className="card" key={t.id}>
          <Link href={`/communities/${t.slug}/t/${t.id}`}>{t.title}</Link>
          <div className="mut">em {t.community}</div>
        </div>
      ))}
    </>
  );
}
