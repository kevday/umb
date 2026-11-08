import { brand } from "@/config/brand";

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "15vh auto", padding: 24 }}>
      <h1>{brand.name}</h1>
      <p>Fundação da plataforma (Fase 1): ACE, auditoria, registro de módulos e esquema de dados.</p>
    </main>
  );
}
