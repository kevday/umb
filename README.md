# Rede social maçônica

Plataforma social com acesso hierárquico e progressivo (Grau, cargo, Loja, status), construída como monólito modular em Next.js + PostgreSQL. O nome do produto é a variável `APP_NAME` (`.env.example`, `src/config/brand.ts`).

## Estado atual (v1.0, pronta para o piloto fechado)
- **CORE:** cadastro só por convite, login com Argon2id, sessões revogáveis, 2FA (TOTP), perfil, amizades, mural de recados, comunidades com tópicos e respostas, denúncias, busca, exportação e exclusão de dados (LGPD).
- **ACE (autorização):** uma função (`can`) que nega por padrão, espelhada no banco (`app_can`) e protegida por RLS; teste de paridade TS × SQL.
- **Institucional:** fundação com duas pessoas, Lojas, convites e Graus com aprovação dupla (também no banco), cargos com mandato, status do membro, auditoria encadeada (SHA-256) e imutável.
- **Administração técnica separada:** módulos ligados/desligados sem autoridade maçônica e sem acesso a conteúdo.
- **Segurança web:** CSP com nonce, cabeçalhos, CSRF (Server Actions), limite de tentativas, 404 uniforme para áreas restritas.
- **Verificação:** 62 testes (Postgres real em memória) + 34 verificações ponta a ponta contra o servidor real, no CI.

## Rodar localmente
    cp .env.example .env     # preencha DATABASE_URL e DATA_ENCRYPTION_KEY
    npm ci
    npm test                 # unidade e integração (PGlite: Postgres real em memória)
    npm run db:migrate
    npm run bootstrap        # ver scripts/bootstrap.ts (exige evidência e duas pessoas)
    npm run tech-admin       # conta técnica
    npm run dev
    npm run e2e              # com o servidor rodando (ver .github/workflows/ci.yml)

## Documentação
- [Decisões de arquitetura](docs/adr/0001-decisoes.md)
- [Modelo de ameaça](docs/threat-model.md)
- [LGPD: inventário, bases legais e direitos](docs/lgpd.md) (minuta para validação jurídica)
- [Operação e implantação](docs/operacao.md)
- [Pendências antes da produção](docs/pendencias.md)
- CI executado pelo GitHub Actions em `.github/workflows/ci.yml`.
