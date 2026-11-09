import { notFound } from "next/navigation";
import { requirePage } from "@/web/session";
import { getDb } from "@/web/db";
import { loadRegistry } from "@/modules";

/** Módulo de demonstração: só aparece e responde se estiver ativo e o ACE permitir (Grau ≥ 2). */
export default async function Demo() {
  const p = await requirePage();
  const nav = (await loadRegistry(getDb())).navFor(p.subject);
  if (!nav.some((n) => n.route === "/demo")) notFound();
  return <><h1>Módulo de demonstração</h1><div className="card">Integrado sem alterar o CORE nem o ACE.</div></>;
}
