import { Flash, type SP } from "@/web/ui";
import { mfaAction } from "../../actions";

export default async function Mfa({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <main className="narrow">
      <h1>Verificação em duas etapas</h1>
      <Flash s={await searchParams} />
      <form action={mfaAction} className="card stack">
        <label htmlFor="code">Código do aplicativo autenticador (6 dígitos) ou código de recuperação</label>
        <input id="code" name="code" type="text" autoComplete="one-time-code" maxLength={11} placeholder="123456  ou  abcde-fghij" required />
        <button>Confirmar</button>
        <p className="mut">Perdeu o aparelho? Use um dos 10 códigos de recuperação que você guardou. Sem eles, peça à secretaria da sua Loja (Venerável ou Administração da Potência) para redefinir o seu 2FA.</p>
      </form>
    </main>
  );
}
