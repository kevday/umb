"use client";

/** Erro inesperado: mensagem amigável com o código de referência (o mesmo aparece nos logs do servidor). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="narrow">
      <h1>Algo não saiu como esperado</h1>
      <p className="mut">Não foi possível concluir a operação. Nada foi perdido. Tente de novo; se persistir, informe ao administrador o código abaixo.</p>
      {error.digest && <p>Código de referência: <code>{error.digest}</code></p>}
      <p><button onClick={() => reset()}>Tentar de novo</button> <a href="/">Voltar ao início</a></p>
    </main>
  );
}
