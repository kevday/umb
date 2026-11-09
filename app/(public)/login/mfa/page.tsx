import { Flash, type SP } from "@/web/ui";
import { mfaAction } from "../../actions";

export default async function Mfa({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <main className="narrow">
      <h1>Verificação em duas etapas</h1>
      <Flash s={await searchParams} />
      <form action={mfaAction} className="card stack">
        <label htmlFor="code">Código do aplicativo autenticador</label>
        <input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required />
        <button>Confirmar</button>
      </form>
    </main>
  );
}
