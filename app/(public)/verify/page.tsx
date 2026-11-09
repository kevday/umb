import { type SP } from "@/web/ui";
import { verifyAction } from "../actions";

export default async function Verify({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams;
  return (
    <main className="narrow">
      <h1>Confirmar e-mail</h1>
      <form action={verifyAction} className="card stack">
        <input type="hidden" name="token" value={s.token ?? ""} />
        <button>Confirmar meu e-mail</button>
      </form>
    </main>
  );
}
