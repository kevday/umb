# Operação e implantação

> Atalho: `npm run setup` executa os passos 3 e 4 abaixo (e grava o `.env`). Veja [configurador.md](configurador.md).

## Variáveis de ambiente
`APP_NAME`, `APP_SLUG`, `APP_DOMAIN`, `APP_URL`, `APP_MAIL_FROM`, `DATABASE_URL`, `DATA_ENCRYPTION_KEY` (32 bytes em base64), `RESEND_API_KEY`. Ver `.env.example`. Segredos ficam no provedor, nunca no repositório.

## Implantação (Vercel + PostgreSQL gerenciado, ex.: Neon)
1. Crie o banco e use a URL **com pooling** em `DATABASE_URL`.
2. O usuário do banco usado pela aplicação deve ser **dono das tabelas e não superusuário** (as migrações criam o papel `app_reader` e fazem `GRANT app_reader TO CURRENT_USER`). Se a aplicação usar outro usuário: `GRANT app_reader TO <usuario>;`.
3. `npm run db:migrate` (a partir de uma máquina de confiança ou etapa de CI).
4. `npm run bootstrap` com as variáveis `BOOT_*` (evidência e duas pessoas) e `npm run tech-admin`. Peça a cada autoridade que ative o 2FA no primeiro acesso.
5. Deploy. `APP_URL` deve ser o endereço HTTPS público.

## Recuperação de conta
- **Perda do autenticador:** na tela de verificação 2FA, após autenticar a senha, o titular pode solicitar um link enviado ao e-mail já verificado. O link expira em 15 minutos, é de uso único e revoga todas as sessões. Depois, o titular entra novamente e cadastra um novo autenticador.
- **Troca de e-mail:** em Configurações, informar o novo endereço e a senha atual. A alteração só ocorre após confirmar o link enviado ao novo endereço; o link expira em uma hora e as sessões são encerradas.
- **E-mail de cadastro não recebido:** usar “Reenviar confirmação de e-mail” na tela de login. A resposta é uniforme para não revelar se o endereço está cadastrado.

## Rotina
- **Backups:** diários com retenção de 30 dias; teste de restauração trimestral.
- **Rotação de `DATA_ENCRYPTION_KEY`:** exige recifrar `user_totp.secret_enc` (ou pedir novo cadastro de 2FA).
- **Módulos:** ligar/desligar em `Técnico`; código novo exige novo deploy.
- **Incidente:** revogar sessões (`update sessions set revoked_at = now()`), rotacionar segredos, preservar logs, acionar o encarregado.
