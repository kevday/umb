# Configurador (`npm run setup`)

Automatiza a primeira configuração: valida o banco, gera a chave de criptografia, grava o `.env`, aplica as migrações e cria o **administrador técnico** e as **duas primeiras contas institucionais** (Administração da Potência e Venerável Mestre da primeira Loja).

É uma ferramenta de linha de comando, de propósito: um assistente web de instalação ficaria exposto na internet antes de existir qualquer autoridade para protegê-lo.

## Uso rápido
    npm ci
    npm run setup            # assistente interativo
    npm run doctor           # verifica a qualquer momento (código de saída ≠ 0 se houver ✗)

O assistente pergunta: aplicação (nome, URL, e-mail), banco (testa a conexão na hora), Potência/Loja/evidência e as três contas. Senha em branco gera uma senha forte (exibida **uma única vez** no final).

## O que ele faz, nesta ordem
1. Valida as respostas (formato, senhas, contas distintas, caracteres que quebrariam o `.env`).
2. Verifica o banco: conexão, PostgreSQL ≥ 14, permissão de criar tabelas, papel `app_reader`. Avisa se o usuário é superusuário ou se a URL tem pooling (para migrar, prefira a URL direta).
3. Mostra o plano. `--dry-run` para aqui.
4. Grava o `.env` (permissão 600; se já existir, faz backup `.env.bak-AAAAMMDDHHMMSS`). **Mantém a `DATA_ENCRYPTION_KEY` existente**, pois trocá-la invalida todos os 2FA (`--rotate-key` força nova).
5. Aplica as migrações.
6. Cria a fundação e o administrador técnico, **só se ainda não existirem**. Pode ser executado de novo sem duplicar nada.
7. Roda a verificação final (a mesma do `npm run doctor`) e imprime os próximos passos.

## Modo automático (CI, servidor, scripts)
    npm run setup -- --yes [--generate-passwords] [--vercel] [--dry-run] [--no-env] [--rotate-key]

Variáveis lidas: `DATABASE_URL`, `MIGRATION_DATABASE_URL` (opcional), `APP_NAME`, `APP_URL`, `APP_SLUG`, `APP_MAIL_FROM`, `RESEND_API_KEY`, `DATA_ENCRYPTION_KEY` (opcional) e, para as contas:

| Grupo | Variáveis |
|---|---|
| Fundação | `SETUP_JURISDICTION`, `SETUP_LODGE`, `SETUP_LODGE_NUMBER`, `SETUP_EVIDENCE` |
| Administração da Potência | `SETUP_AUTH_NAME`, `SETUP_AUTH_EMAIL`, `SETUP_AUTH_USER`, `SETUP_AUTH_PASSWORD` |
| Venerável Mestre | `SETUP_VM_NAME`, `SETUP_VM_EMAIL`, `SETUP_VM_USER`, `SETUP_VM_PASSWORD` |
| Administrador técnico | `SETUP_ADMIN_NAME`, `SETUP_ADMIN_EMAIL`, `SETUP_ADMIN_USER`, `SETUP_ADMIN_PASSWORD` |

Omitir `SETUP_AUTH_*` e `SETUP_VM_*` pula a fundação; omitir `SETUP_ADMIN_*` pula a conta técnica. Sem `*_PASSWORD`, use `--generate-passwords`.

## Vercel
`--vercel` gera `.setup/vercel-env.sh` (shell POSIX): envia as variáveis do `.env` para o ambiente *production* com `vercel env add`. Requer `npm i -g vercel`, `vercel login` e `vercel link`. Esse script **não foi testado contra a Vercel** (só a sintaxe); confira o resultado no painel. Depois, faça um novo deploy.

## Neon
Use a URL **com pooling** em `DATABASE_URL` e a URL **direta** (sem `-pooler`) em `MIGRATION_DATABASE_URL` (o assistente pergunta). O usuário padrão do Neon é dono do banco e pode criar o papel `app_reader`.

## Segurança
- Senhas digitadas ficam ocultas no terminal e nunca vão para o `.env` nem para arquivos.
- Senhas geradas são impressas uma vez; troque-as se o terminal for registrado.
- Todo o `.env`, os backups e `.setup/` estão no `.gitignore`.
- Sem `--yes`, nada é alterado antes da sua confirmação.

## Verificações do `npm run doctor`
Node, chave de criptografia, `APP_URL` (HTTPS), nome, e-mail, versão do PostgreSQL, migrações (n de n), RLS, papel `app_reader`, estrutura institucional, Potência e Venerável ativos, administrador técnico, 2FA das autoridades (aviso até ativarem) e integridade da cadeia de auditoria.
