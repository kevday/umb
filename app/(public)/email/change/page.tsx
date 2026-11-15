import { Flash, type SP } from "@/web/ui";
import { emailChangeConfirmAction } from "../actions";

export default async function ConfirmEmailChange({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams;
  return (
    <main className="narrow">
      <h1>Confirmar novo e-mail</h1>
      <Flash s={s} />
      <p>Confirme a alteração do endereço de e-mail da sua conta. O link é válido por uma hora e pode ser usado uma única vez.</p>
      <form action={emailChangeConfirmAction} className="card stack">
        <input type="hidden" name="token" value={s.token ?? ""} />
        <button>Confirmar alteração</button>
      </form>
    </main>
  );
}
