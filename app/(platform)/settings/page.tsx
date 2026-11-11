import QRCode from "qrcode";
import { requirePage } from "@/web/session";
import { getDb } from "@/web/db";
import { brand } from "@/config/brand";
import { Flash, type SP } from "@/web/ui";
import { hasMfa, pendingTotpSecret } from "@/core/auth/service";
import { otpauthUri } from "@/core/auth/totp";
import { eq } from "drizzle-orm";
import { profiles } from "@/shared/database/schema";
import { accountDelete, passwordChange, profileUpdate, totpConfirm, totpStart } from "../actions";

export default async function Settings({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams, p = await requirePage(), db = getDb(), me = p.session.userId;
  const [on, secret] = await Promise.all([hasMfa(db, me), pendingTotpSecret(db, me)]);
  const [prof] = await db.select().from(profiles).where(eq(profiles.userId, me));
  const qr = secret ? await QRCode.toString(otpauthUri(brand.name, "conta", secret), { type: "svg", margin: 1 }) : null;
  return (
    <>
      <h1>Configurações</h1>
      <Flash s={s} />
      {prof && (
        <>
          <h2>Perfil</h2>
          <form action={profileUpdate} className="card stack">
            <label htmlFor="displayName">Nome de exibição</label><input id="displayName" name="displayName" type="text" maxLength={80} defaultValue={prof.displayName ?? ""} />
            <label htmlFor="bio">Sobre você</label><textarea id="bio" name="bio" maxLength={500} defaultValue={prof.bio ?? ""} />
            <label htmlFor="bioVisibility">Quem pode ler</label>
            <select id="bioVisibility" name="bioVisibility" defaultValue={String((prof.visibility as Record<string, string>)?.bio ?? "eu")}>
              <option value="eu">Somente eu</option><option value="amigos">Meus amigos</option><option value="loja">Membros da minha Loja</option>
            </select>
            <button>Salvar</button>
          </form>
        </>
      )}
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
    <h2>Seus dados</h2>
      <div className="card stack">
        <p>Baixe uma cópia dos seus dados pessoais (LGPD).</p>
        <a href="/settings/export">Baixar meus dados (JSON)</a>
      </div>
      {prof && (
        <form action={accountDelete} className="card stack">
          <h3>Excluir minha conta</h3>
          <p className="mut">Seus dados pessoais são anonimizados e você deixa de ter acesso. Quem exerce cargo deve encerrá-lo antes. Não há como desfazer.</p>
          <label htmlFor="password">Confirme sua senha</label><input id="password" name="password" type="password" autoComplete="current-password" required />
          <button className="danger">Excluir conta</button>
        </form>
      )}
    </>
  );
}
