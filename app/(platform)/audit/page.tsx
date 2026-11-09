import { requireMemberPage } from "@/web/session";
import { getDb } from "@/web/db";
import { Forbidden } from "@/core/errors";
import { listAudit } from "@/access-control/services/institution";
import { verifyAuditChain } from "@/access-control/audit/store";

export default async function Audit() {
  const p = await requireMemberPage(), db = getDb();
  let entries;
  try { entries = await listAudit(db, p.ctx); }
  catch (e) {
    if (e instanceof Forbidden) return <><h1>Auditoria</h1><p className="msg err">{e.reason === "mfa_required" ? "Confirme o 2FA em Configurações." : "Sem competência para consultar a auditoria."}</p></>;
    throw e;
  }
  const chain = await verifyAuditChain(db);
  return (
    <>
      <h1>Auditoria</h1>
      <p>Integridade da cadeia de registros: {chain.ok ? <span className="tag">íntegra</span> : <strong className="tag">violação detectada no registro {chain.brokenAt}</strong>}</p>
      <div className="card">
        <table>
          <thead><tr><th>#</th><th>Quando</th><th>Ação</th><th>Detalhes</th></tr></thead>
          <tbody>
            {[...entries].reverse().slice(0, 200).map((e) => (
              <tr key={e.seq}><td>{e.seq}</td><td>{new Date(e.at).toLocaleString("pt-BR")}</td><td>{e.action}</td><td><pre>{JSON.stringify(e.payload)}</pre></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
