"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
        <h1>Algo não saiu como esperado</h1>
        <p>Tente de novo. Se persistir, informe ao administrador o código de referência{error.digest ? `: ${error.digest}` : ""}.</p>
        <button onClick={() => reset()}>Tentar de novo</button>
      </body>
    </html>
  );
}
