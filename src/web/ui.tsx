export type SP = { e?: string; ok?: string; q?: string; token?: string };
export const sp = async (p: Promise<SP>) => p;
export function Flash({ s }: { s: SP }) {
  return (
    <>
      {s.e && <p className="msg err" role="alert">{s.e}</p>}
      {s.ok && <p className="msg good" role="status">{s.ok}</p>}
    </>
  );
}
export const grau = (n: number) => ["Sem Grau", "Aprendiz", "Companheiro", "Mestre"][n] ?? `Grau ${n}`;
export const fdate = (d: Date | string) => new Date(d).toLocaleDateString("pt-BR");
