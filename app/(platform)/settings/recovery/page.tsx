import Link from "next/link";
import { requirePage } from "@/web/session";
import { readSecretFlash } from "@/web/flash";
import { flashClear } from "../../actions";

/** Mostra os códigos de recuperação uma única vez (o texto não fica guardado no servidor). */
export default async function Recovery() {
  await requirePage();
  const raw = await readSecretFlash("recovery");
  let codes: string[] = [];
  try { codes = raw ? (JSON.parse(raw) as string[]) : []; } catch { codes = []; }
  return (
    <>
      <h1>Códigos de recuperação</h1>
      {codes.length === 0 ? (
        <>
          <p className="msg err">Estes códigos só aparecem uma vez e já não estão mais disponíveis. Em Configurações você pode gerar novos (os antigos deixam de valer).</p>
          <p><Link href="/settings">← Configurações</Link></p>
        </>
      ) : (
        <>
          <p className="msg err" role="alert">Guarde estes códigos agora, em local seguro (gerenciador de senhas ou papel). Eles não serão exibidos de novo. Cada um funciona uma única vez, no lugar do código do aplicativo autenticador.</p>
          <div className="card"><table><tbody>{codes.map((c) => <tr key={c}><td><code>{c}</code></td></tr>)}</tbody></table></div>
          <form action={flashClear}><input type="hidden" name="name" value="recovery" /><input type="hidden" name="path" value="/settings" /><button>Já guardei os códigos</button></form>
        </>
      )}
    </>
  );
}
