import { RITES } from "@/theme/rites";
import { readSecretFlash } from "@/web/flash";
import { requireMemberPage } from "@/web/session";
import { getDb } from "@/web/db";
import { Flash, grau, type SP } from "@/web/ui";
import { Forbidden } from "@/core/errors";
import { institutionOverview } from "@/access-control/services/queries";
import {
  degreeDecide, degreeRequest, flashClear, inviteApprove, inviteCreate, inviteRevoke, memberEmailChange, memberTotpReset, lodgeCreate, officeAppoint, officeEnd, riteSet, statusSet,
} from "../actions";

const CARGOS = ["Venerável Mestre", "Primeiro Vigilante", "Segundo Vigilante", "Orador", "Secretário", "Tesoureiro", "Hospitaleiro", "Mestre de Cerimônias", "Administração da Potência"];
const STATUS = ["regular", "debito", "licenciado", "suspenso", "eliminado", "falecido"];

export default async function Institution({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams, p = await requireMemberPage();
  let ov;
  try { ov = await institutionOverview(getDb(), p.ctx); }
  catch (e) {
    if (e instanceof Forbidden) return <><h1>Instituição</h1><p className="msg err">{e.reason === "mfa_required" ? "Confirme o 2FA em Configurações para acessar esta área." : "Você não exerce cargo com competência administrativa."}</p></>;
    throw e;
  }
  const handoff = await readSecretFlash("invite");
  const [handoffMail, handoffLink] = handoff ? handoff.split("|") : [];
  const isPot = ov.jurisdictions.length > 0;
  return (
    <>
      <h1>Instituição</h1>
      <Flash s={s} />
      {handoffLink && (
        <form action={flashClear} className="card stack">
          <input type="hidden" name="name" value="invite" /><input type="hidden" name="path" value="/institution" />
          <strong>Link para entregar a {handoffMail}</strong>
          <code>{handoffLink}</code>
          <p className="mut">Copie e envie por um canal seguro. Este aviso some em 2 minutos.</p>
          <button className="sec">Já copiei</button>
        </form>
      )}
      {ov.jurisdictions.map((j) => (
        <form key={j.id} action={lodgeCreate} className="card row">
          <input type="hidden" name="jurisdictionId" value={j.id} />
          <span><strong>{j.name}</strong> · nova Loja</span>
          <span className="row"><input name="name" placeholder="Nome da Loja" required /><input name="number" type="number" min={1} placeholder="Nº" /><button>Criar Loja</button></span>
        </form>
      ))}
      {ov.lodges.map(({ lodge, members, invitations, requests, offices }) => (
        <section key={lodge.id}>
          <h2>{lodge.name}{lodge.number ? ` nº ${lodge.number}` : ""}</h2>

          <form action={riteSet} className="card row">
            <input type="hidden" name="lodgeId" value={lodge.id} />
            <label htmlFor={`rite-${lodge.id}`}>Rito da Loja (define as cores do site)</label>
            <span className="row">
              <select id={`rite-${lodge.id}`} name="rite" defaultValue={lodge.rite ?? ""}>
                <option value="">Padrão (sem Rito definido)</option>
                {RITES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button>Salvar Rito</button>
            </span>
          </form>

          <h3>Membros</h3>
          <div className="card">
            <table>
              <thead><tr><th>Nome</th><th>Grau</th><th>Status</th><th>Ações</th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId}>
                    <td>{m.name}</td><td>{grau(m.degree)}</td><td><span className="tag">{m.status}</span></td>
                    <td className="stack">
                      <form action={degreeRequest} className="inline"><input type="hidden" name="userId" value={m.userId} /><button className="sec">Solicitar elevação</button></form>
                      <form action={statusSet} className="inline">
                        <input type="hidden" name="userId" value={m.userId} />
                        <select name="status" defaultValue={m.status}>{STATUS.map((x) => <option key={x}>{x}</option>)}</select>
                        <input name="justification" placeholder="Justificativa" required /><button className="sec">Alterar status</button>
                      </form>
                      <details>
                        <summary className="mut">Acesso da conta (2FA e e-mail)</summary>
                        <form action={memberTotpReset} className="inline">
                          <input type="hidden" name="userId" value={m.userId} />
                          <input name="justification" placeholder="Justificativa" required /><button className="sec">Redefinir 2FA</button>
                        </form>
                        <form action={memberEmailChange} className="inline">
                          <input type="hidden" name="userId" value={m.userId} />
                          <input name="newEmail" type="email" placeholder="Novo e-mail" required />
                          <input name="justification" placeholder="Justificativa" required /><button className="sec">Trocar e-mail</button>
                        </form>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Elevações pendentes</h3>
          {requests.length === 0 && <p className="mut">Nenhuma.</p>}
          {requests.map((r) => (
            <div className="card" key={r.id}>
              <strong>{r.name}</strong>: {grau(r.from)} → {grau(r.to)} <span className="mut">· registrada por {r.requestedByName}</span>
              <div className="row">
                <form action={degreeDecide} className="inline"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="approve" value="1" /><button>Aprovar</button></form>
                <form action={degreeDecide} className="inline"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="approve" value="0" /><input name="justification" placeholder="Justificativa da recusa" required /><button className="sec">Recusar</button></form>
              </div>
            </div>
          ))}

          <h3>Convites</h3>
          {invitations.map((i) => (
            <div className="card row" key={i.id}>
              <span>{i.email} · {grau(i.degree)} {i.approved ? <span className="tag">aprovado</span> : <span className="tag">aguardando aprovação</span>}</span>
              <span className="row">
                {!i.approved && <form action={inviteApprove} className="inline"><input type="hidden" name="id" value={i.id} /><button>Aprovar</button></form>}
                <form action={inviteRevoke} className="inline"><input type="hidden" name="id" value={i.id} /><button className="sec">Cancelar</button></form>
              </span>
            </div>
          ))}
          <form action={inviteCreate} className="card row">
            <input type="hidden" name="lodgeId" value={lodge.id} />
            <input name="email" type="email" placeholder="E-mail do convidado" required />
            <select name="degree" aria-label="Grau inicial"><option value="1">Aprendiz</option><option value="2">Companheiro (aprovação da Potência)</option><option value="3">Mestre (aprovação da Potência)</option></select>
            {isPot && <label className="row"><input type="checkbox" name="approveNow" /> Aprovar já (Administração da Potência)</label>}
            <button>Criar convite</button>
          </form>

          <h3>Cargos em exercício</h3>
          {offices.map((o) => (
            <div className="card row" key={o.id}>
              <span>{o.name}: {o.userName}</span>
              <form action={officeEnd} className="inline"><input type="hidden" name="id" value={o.id} /><button className="sec">Encerrar mandato</button></form>
            </div>
          ))}
          <form action={officeAppoint} className="card stack">
            <input type="hidden" name="lodgeId" value={lodge.id} /><input type="hidden" name="jurisdictionId" value={lodge.jurisdictionId} />
            <div className="row">
              <select name="userId">{members.filter((m) => m.degree >= 3).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>
              <select name="name">{CARGOS.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
            <div className="row">
              <label>Início <input name="startsAt" type="date" /></label>
              <label>Fim do mandato <input name="endsAt" type="date" /></label>
              <button>Nomear</button>
            </div>
          </form>
        </section>
      ))}
    </>
  );
}
