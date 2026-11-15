import { Flash, type SP } from "@/web/ui";
import { mfaAction, mfaResetRequestAction } from "../../actions";

export default async function Mfa({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <main className="narrow">
      <h1>Verificação em duas etapas</h1>
      <Flash s={await searchParams} />
      <form action={mfaAction} className="card stack">
        <p>Informe o código atual de seis dígitos. Os códigos mudam a cada 30 segundos; confira se a data e a hora do celular estão configuradas automaticamente.</p>
        <label htmlFor="code">Código do aplicativo autenticador</label>
        <input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required />
        <button>Confirmar</button>
      </form>
      <div className="card stack">
        <p>Perdeu o acesso ao aplicativo autenticador?</p>
        <form action={mfaResetRequestAction}>
          <button className="sec">Enviar link de recuperação ao meu e-mail verificado</button>
        </form>
        <p className="mut">A solicitação exige que você tenha acabado de entrar com sua senha. O link expira em 15 minutos, é de uso único e encerra todas as sessões. Depois será necessário cadastrar novamente o autenticador.</p>
      </div>
    </main>
  );
}
