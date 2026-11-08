# Rede social maçônica — Fase 1 (Fundação)

Nome do produto: variável `APP_NAME` (ver `.env.example` e `src/config/brand.ts`).

## Rodar
    cp .env.example .env
    npm install
    npm test          # ACE, aprovação dupla, auditoria, registro de módulos
    npm run typecheck
    npm run dev

## O que existe
- `src/access-control/engine/can.ts`: única porta de autorização (negar por padrão, 404 uniforme).
- `src/access-control/degrees/approval.ts`: aprovação dupla de Grau.
- `src/access-control/audit/chain.ts`: auditoria encadeada por SHA-256.
- `src/core/module-registry`: registro de módulos filtrado pelo ACE.
- `src/shared/database/schema`: esquema Drizzle do CORE e do ACE; `database/rls`: esboço de RLS.

## Próximos passos (Fase 2)
Autenticação com 2FA, funções SQL de RLS, telas institucionais e fluxo de convite.
