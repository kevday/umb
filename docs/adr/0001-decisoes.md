# Decisões de arquitetura

Registro das decisões tomadas na implementação. Onde diferem do PRD v3, está dito.

1. **Monólito modular em Next.js (App Router) + PostgreSQL.** Sem microsserviços. CORE, ACE e módulos separados por pastas, com fronteira por `contracts/` e registro de módulos (`src/modules`). O manifesto vive no código; o banco guarda só o estado (ativo/inativo). Desativar preserva dados.
2. **Autenticação própria e mínima (diverge do PRD, que sugeria Auth.js).** Argon2id (OWASP), token de sessão opaco guardado como hash SHA-256, expiração por inatividade (7 dias) e absoluta (30), TOTP RFC 6238 com proteção contra reuso, segredo do TOTP cifrado em AES-256-GCM. Motivo: o 2FA obrigatório *por cargo* e a revogação por status exigem controle fino; a superfície é pequena, auditável e testada. Reavaliar se o escopo de autenticação crescer (login social, passkeys).
3. **Autorização em duas camadas.** `can(sujeito, ação, recurso)` em TypeScript (única porta; nega por padrão) e `app_can()` em SQL com RLS para leitura/escrita de conteúdo. Um teste de paridade compara as duas em todas as combinações de sujeitos × regras.
4. **Dois papéis de banco.** Conteúdo (comunidades, tópicos, mural, amizades) é acessado como `app_reader` (`SET LOCAL ROLE`) com o RLS ativo. Operações institucionais rodam como dono e são autorizadas em TypeScript, pois mexem em dados de outras pessoas por competência.
5. **Sem `FORCE ROW LEVEL SECURITY`.** Descoberto no teste ponta a ponta com PostgreSQL real: o FORCE barrava os próprios serviços do dono. O isolamento vem do papel `app_reader`.
6. **Fundação com duas pessoas distintas** (Administração da Potência e Venerável), com evidência registrada, para a aprovação dupla funcionar desde o início. Criar uma Loja nova exige uma *segunda* autoridade da Potência (ou o Venerável da Loja) para aprovar o primeiro convite.
7. **Aprovação dupla também no banco:** `CHECK` impede aprovador igual a registrante ou ao alvo (exceto `origin = 'bootstrap'`); histórico de Graus é imutável (trigger).
8. **Auditoria** encadeada por SHA-256 em JSON canônico, tabela append-only (trigger contra UPDATE/DELETE/TRUNCATE). Cada autoridade lê só o próprio escopo (Loja ou jurisdição).
9. **Status do membro (diverge do PRD, que previa aprovação dupla).** O Venerável (ou a Potência) altera status com justificativa obrigatória e auditoria; sem segundo aprovador. Suspensão, eliminação e falecimento revogam as sessões.
10. **Interface server-rendered em HTML/CSS simples (diverge do PRD: sem Tailwind/shadcn na v1).** Menos JavaScript, CSP estrita com nonce, formulários funcionam sem JS (Server Actions). Estilo próprio com tema claro/escuro. Pode-se adotar um sistema de componentes depois, sem mudar o domínio.
11. **Exclusão de conta por anonimização.** Dados pessoais removidos, conteúdo mantido sem identificação, auditoria mantida sem dados diretos. Quem exerce cargo encerra o mandato antes.
12. **Testes:** PGlite (Postgres real em WASM) para unidade/integração, incluindo RLS, triggers e migrações; ponta a ponta contra `next start` + PostgreSQL com dono sem superusuário, também no CI.
