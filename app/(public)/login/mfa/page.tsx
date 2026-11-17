import Link from "next/link";
import { Flash, type SP } from "@/web/ui";
import { mfaAction, mfaResetRequestAction } from "../../actions";

export default async function Mfa({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <main className="narrow">
      <h1>Verificação em duas etapas</h1>
      <Flash s={await searchParams} />
      <form action={mfaAction} className="card stack">
        <label htmlFor="code">Código do aplicativo autenticador (6 dígitos) ou código de recuperação</label>
        <input id="code" name="code" type="text" autoComplete="one-time-code" maxLength={11} placeholder="123456  ou  abcde-fghij" required />
        <button>Confirmar</button>
        <p className="mut">Perdeu o aparelho e os códigos? Você pode solicitar um link no e-mail verificado da conta.</p>
        <form action={mfaResetRequestAction}><button className="sec">Enviar link de recuperação ao meu e-mail</button></form>
        <p className="mut">O link é de uso único, expira em 15 minutos e encerra todas as sessões.</p>
      </form>
    </main>
  );
}
