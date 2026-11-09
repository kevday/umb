import { Flash, type SP } from "@/web/ui";
import { registerAction } from "../actions";

export default async function Register({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams;
  return (
    <main className="narrow">
      <h1>Criar conta</h1>
      <Flash s={s} />
      <form action={registerAction} className="card stack">
        <input type="hidden" name="token" value={s.token ?? ""} />
        <label htmlFor="email">E-mail do convite</label>
        <input id="email" name="email" type="email" required />
        <label htmlFor="fullName">Nome completo</label>
        <input id="fullName" name="fullName" type="text" required />
        <label htmlFor="username">Nome de usuário</label>
        <input id="username" name="username" type="text" pattern="[a-z0-9._-]{3,30}" required />
        <label htmlFor="password">Senha (mínimo 12 caracteres)</label>
        <input id="password" name="password" type="password" minLength={12} autoComplete="new-password" required />
        <label htmlFor="password2">Repita a senha</label>
        <input id="password2" name="password2" type="password" minLength={12} autoComplete="new-password" required />
        <button>Criar conta</button>
      </form>
    </main>
  );
}
