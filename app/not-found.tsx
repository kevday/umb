import Link from "next/link";

/** Mesma tela para área inexistente e área restrita: não revela o que existe. */
export default function NotFound() {
  return (
    <main className="narrow">
      <h1>Página não encontrada</h1>
      <p className="mut">O endereço não existe ou você não tem acesso a ele.</p>
      <p><Link href="/">Voltar ao início</Link></p>
    </main>
  );
}
