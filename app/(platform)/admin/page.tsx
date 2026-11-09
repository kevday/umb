import { notFound } from "next/navigation";
import { requirePage } from "@/web/session";
import { getDb } from "@/web/db";
import { loadRegistry } from "@/modules";
import { Flash, type SP } from "@/web/ui";
import { moduleToggle } from "../actions";

export default async function Admin({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams, p = await requirePage();
  if (!p.subject.technicalAdmin) notFound(); // para os demais, a área nem existe
  const mods = (await loadRegistry(getDb())).list();
  return (
    <>
      <h1>Administração técnica</h1>
      <Flash s={s} />
      <p className="mut">Gerencia infraestrutura e módulos. Não concede autoridade maçônica nem acesso a conteúdo de membros. Exige sessão com 2FA.</p>
      <h2>Módulos</h2>
      {mods.map((m) => (
        <div className="card row" key={m.id}>
          <span><strong>{m.name}</strong> <span className="tag">v{m.version}</span> <span className="tag">{m.enabled ? "ativo" : "inativo"}</span></span>
          <form action={moduleToggle} className="inline"><input type="hidden" name="id" value={m.id} /><input type="hidden" name="enabled" value={m.enabled ? "0" : "1"} /><button className="sec">{m.enabled ? "Desativar" : "Ativar"}</button></form>
        </div>
      ))}
      <p className="mut">Desativar um módulo preserva os dados dele.</p>
    </>
  );
}
