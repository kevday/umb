import Link from "next/link";
import { Flash, type SP } from "@/web/ui";
import { loginAction } from "../actions";

export default async function Login({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams;
  return (
    <main className="narrow">
      <Flash s={s} />
      <form action={loginAction} className="card stack">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        <button>Entrar</button>
        <Link href="/forgot" className="mut">Esqueci a senha</Link>
      </form>
      <p className="mut">O cadastro é feito apenas por convite da sua Loja.</p>
    </main>
  );
}
