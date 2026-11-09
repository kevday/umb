import { Flash, type SP } from "@/web/ui";
import { resetAction } from "../actions";

export default async function Reset({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams;
  return (
    <main className="narrow">
      <h1>Nova senha</h1>
      <Flash s={s} />
      <form action={resetAction} className="card stack">
        <input type="hidden" name="token" value={s.token ?? ""} />
        <label htmlFor="password">Nova senha (mínimo 12 caracteres)</label>
        <input id="password" name="password" type="password" minLength={12} autoComplete="new-password" required />
        <button>Salvar</button>
      </form>
    </main>
  );
}
