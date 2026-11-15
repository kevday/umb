import { Flash, type SP } from "@/web/ui";
import { mfaResetConfirmAction } from "../../../actions";

export default async function ConfirmMfaReset({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams;
  return (
    <main className="narrow">
      <h1>Recuperar autenticador</h1>
      <Flash s={s} />
      <p>Esta operação remove o autenticador atual da conta. O link é válido por 15 minutos e pode ser usado uma única vez. Todas as sessões serão encerradas.</p>
      <form action={mfaResetConfirmAction} className="card stack">
        <input type="hidden" name="token" value={s.token ?? ""} />
        <button className="danger">Confirmar remoção do autenticador</button>
      </form>
    </main>
  );
}
