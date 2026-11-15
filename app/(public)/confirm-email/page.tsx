import { type SP } from "@/web/ui";
import { emailConfirmAction } from "../actions";

export default async function ConfirmEmail({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams;
  return (
    <main className="narrow">
      <h1>Confirmar novo e-mail</h1>
      <form action={emailConfirmAction} className="card stack">
        <input type="hidden" name="token" value={s.token ?? ""} />
        <p>Ao confirmar, este passa a ser o seu e-mail de acesso e você será desconectado em todos os aparelhos.</p>
        <button>Confirmar troca de e-mail</button>
      </form>
    </main>
  );
}
