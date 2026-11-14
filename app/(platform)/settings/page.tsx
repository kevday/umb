import QRCode from "qrcode";
import { requirePage } from "@/web/session";
import { getDb } from "@/web/db";
import { brand } from "@/config/brand";
import { Flash, type SP } from "@/web/ui";
import { hasMfa, pendingTotpSecret } from "@/core/auth/service";
import { otpauthUri } from "@/core/auth/totp";
import { eq } from "drizzle-orm";
import { profiles } from "@/shared/database/schema";
import { resolveTheme } from "@/theme/service";
import { accountDelete, passwordChange, profileUpdate, themeReset, themeSet, totpConfirm, totpStart } from "../actions";

export default async function Settings({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams, p = await requirePage(), db = getDb(), me = p.session.userId;
  const [on, secret] = await Promise.all([hasMfa(db, me), pendingTotpSecret(db, me)]);
  const [prof] = await db.select().from(profiles).where(eq(profiles.userId, me));
  const th = prof ? await resolveTheme(db, me) : null;
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
      {th && (
        <>
          <h2>Aparência</h2>
          <div className="card stack">
            <p>Paleta atual: <strong>{th.label}</strong>{th.source === "rito" ? " (segue o Rito da sua Loja)" : th.source === "padrao" ? " (sua Loja ainda não definiu um Rito)" : ""}</p>
            <svg className="swatches" width="176" height="36" role="img" aria-label="Cores da paleta atual">
              <rect x="0" y="0" width="36" height="36" rx="8" fill={th.theme.decor} />
              <rect x="44" y="0" width="36" height="36" rx="8" fill={th.theme.decor2} />
              <rect x="88" y="0" width="36" height="36" rx="8" fill={th.theme.light.link} />
              <rect x="132" y="0" width="36" height="36" rx="8" fill={th.theme.light.bg} stroke={th.theme.light.bd} />
            </svg>
            <form action={themeSet} className="inline">
              <label htmlFor="color">Usar minha própria cor</label>
              <input id="color" name="color" type="color" defaultValue={th.custom ?? th.theme.decor} />
              <button>Aplicar</button>
            </form>
            {th.source === "personal" && <form action={themeReset}><button className="sec">Voltar ao padrão (Rito da minha Loja)</button></form>}
            <p className="mut">O sistema ajusta o tom automaticamente para manter o texto legível nos modos claro e escuro.</p>
          </div>
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
