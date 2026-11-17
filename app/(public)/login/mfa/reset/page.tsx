import { type SP } from "@/web/ui";
import { mfaResetConfirmAction } from "../../../actions";

export default async function MfaReset({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams;
  return (
    <main className="narrow">
      <h1>Recuperar autenticador</h1>
      <p className="mut">Confirme a remoção do autenticador. O link é de uso único, expira em 15 minutos e encerra todas as sessões da conta.</p>
      <form action={mfaResetConfirmAction} className="card stack">
        <input type="hidden" name="token" value={s.token ?? ""} />
        <button>Remover autenticador e continuar</button>
      </form>
    </main>
  );
}
