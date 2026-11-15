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

## Rotina
- **Backups:** diários com retenção de 30 dias; teste de restauração trimestral.
- **Rotação de `DATA_ENCRYPTION_KEY`:** exige recifrar `user_totp.secret_enc` (ou pedir novo cadastro de 2FA).
- **Módulos:** ligar/desligar em `Técnico`; código novo exige novo deploy.
- **Incidente:** revogar sessões (`update sessions set revoked_at = now()`), rotacionar segredos, preservar logs, acionar o encarregado.

## Perdi o autenticador (2FA)
1. **Com um código de recuperação** (10 códigos exibidos uma única vez ao ativar o 2FA): na tela do código, digite o código de recuperação no lugar dos 6 dígitos. Depois, em *Configurações*, use *Trocar de aplicativo autenticador* e gere novos códigos.
2. **Sem os códigos**: a autoridade redefine o 2FA do membro em *Instituição → Acesso da conta*: o Venerável para membros da Loja; a Administração da Potência para qualquer membro, e só ela redefine o de outra autoridade da Potência. Exige justificativa, é auditado e encerra as sessões do membro, que cadastra um novo aplicativo no próximo acesso.
3. **Administrador técnico, ou nenhuma autoridade disponível**: comando de emergência, com acesso ao banco: `npm run reset-2fa -- email@exemplo.org "motivo com 10+ caracteres"`.

Limite: 10 tentativas de código a cada 10 minutos por conta.

## Trocar o e-mail de acesso
- **Com acesso à conta**: *Configurações → E-mail de acesso*: informa o novo endereço e a senha; um link vai para o NOVO e-mail (prova de posse) e a troca só vale depois de abri-lo. Todas as sessões são encerradas e o endereço antigo é avisado.
- **Sem acesso ao e-mail antigo e sem poder entrar**: o Venerável (ou a Potência) troca em *Instituição → Acesso da conta → Trocar e-mail*, com justificativa. O membro confirma o novo e usa *Esqueci a senha*.

## Convites
- E-mail que já tem conta, ou que já tem convite pendente, é recusado na hora, com o motivo. *Cancelar* invalida um convite pendente.
- **Administração da Potência** pode marcar *Aprovar já* (qualquer Grau). Decisão deliberada: é um convite direto, auditado (`direct`), e o Grau fica com origem `potencia`. O Venerável e o Secretário continuam precisando de outra autoridade para aprovar.
- Se o e-mail não puder ser enviado (Resend não configurado, domínio não verificado ou falha do serviço), o convite é criado mesmo assim e a tela mostra o **link** para entregar ao convidado por outro canal.

## Quando aparece "Application error" (Vercel)
A tela agora mostra "Algo não saiu como esperado" com um **código de referência (Digest)**. Para achar a causa: Vercel → projeto → *Logs* → busque o Digest. Falhas de e-mail não derrubam mais a tela.
