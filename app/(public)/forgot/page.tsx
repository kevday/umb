export const dynamic = "force-dynamic";

import { forgotAction } from "../actions";

export default function Forgot() {
  return (
    <main className="narrow">
      <h1>Redefinir senha</h1>
      <form action={forgotAction} className="card stack">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" required />
        <button>Enviar instruções</button>
      </form>
    </main>
  );
}
