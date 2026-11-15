import { Flash, type SP } from "@/web/ui";
import { resendVerificationAction } from "../../actions";

export default async function ResendVerification({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams;
  return (
    <main className="narrow">
      <h1>Reenviar confirmação de e-mail</h1>
      <Flash s={s} />
      <p>Informe o endereço usado no cadastro. Se existir uma conta pendente de confirmação, enviaremos um novo link.</p>
      <form action={resendVerificationAction} className="card stack">
        <label htmlFor="email">E-mail cadastrado</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <button>Enviar novo link</button>
      </form>
    </main>
  );
}
