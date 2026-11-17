import { type SP } from "@/web/ui";
import { resendVerificationAction } from "../../actions";

export default async function ResendVerification({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams;
  return (
    <main className="narrow">
      <h1>Reenviar confirmação de e-mail</h1>
      <p className="mut">Informe o endereço usado no cadastro. Por segurança, a mensagem de retorno não revela se a conta existe.</p>
      <form action={resendVerificationAction} className="card stack">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" defaultValue={s.email ?? ""} required />
        <button>Enviar nova confirmação</button>
      </form>
    </main>
  );
}
