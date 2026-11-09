import QRCode from "qrcode";
import { requirePage } from "@/web/session";
import { getDb } from "@/web/db";
import { brand } from "@/config/brand";
import { Flash, type SP } from "@/web/ui";
import { hasMfa, pendingTotpSecret } from "@/core/auth/service";
import { otpauthUri } from "@/core/auth/totp";
import { passwordChange, totpConfirm, totpStart } from "../actions";

export default async function Settings({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams, p = await requirePage(), db = getDb(), me = p.session.userId;
  const [on, secret] = await Promise.all([hasMfa(db, me), pendingTotpSecret(db, me)]);
  const qr = secret ? await QRCode.toString(otpauthUri(brand.name, "conta", secret), { type: "svg", margin: 1 }) : null;
  return (
    <>
      <h1>Configurações</h1>
      <Flash s={s} />
      <h2>Verificação em duas etapas (2FA)</h2>
      <div className="card stack">
        {on && <p>2FA ativo.{p.session.mfaVerified ? " Esta sessão está verificada." : ""}</p>}
        {!on && !secret && (
          <>
            <p>Obrigatório para quem exerce cargo. Use um aplicativo autenticador (TOTP).</p>
            <form action={totpStart}><button>Ativar 2FA</button></form>
          </>
        )}
        {!on && secret && (
          <>
            <p>Leia o QR code no aplicativo autenticador ou digite a chave:</p>
            {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />}
            <code>{secret}</code>
            <form action={totpConfirm} className="stack">
              <label htmlFor="code">Código de 6 dígitos</label>
              <input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required />
              <button>Confirmar e ativar</button>
            </form>
          </>
        )}
      </div>
      <h2>Alterar senha</h2>
      <form action={passwordChange} className="card stack">
        <label htmlFor="current">Senha atual</label><input id="current" name="current" type="password" autoComplete="current-password" required />
        <label htmlFor="next">Nova senha (mínimo 12 caracteres)</label><input id="next" name="next" type="password" minLength={12} autoComplete="new-password" required />
        <button>Alterar</button>
      </form>
    </>
  );
}
