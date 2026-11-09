import { exportMyData } from "@/core/account";
import { getDb } from "@/web/db";
import { getSession } from "@/web/session";

/** Portabilidade (LGPD): JSON com os dados do próprio titular. Leitura, sem efeito colateral. */
export async function GET() {
  const s = await getSession();
  if (!s) return new Response("não autenticado", { status: 401 });
  const data = await exportMyData(getDb(), s.userId);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="meus-dados.json"' },
  });
}
