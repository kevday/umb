# Pendências antes da produção

**Bloqueantes (não técnicos):** definir controlador e encarregado (DPO); validar bases legais, termos e política de privacidade; RIPD; nome, domínio e identidade visual; escolher a Potência/Loja do piloto.

**Bloqueantes (técnicos):**
- Ativar o envio real de e-mail (Resend) e configurar SPF/DKIM do domínio.
- Limite de tentativas por IP depende de `x-forwarded-for` confiável (ok na Vercel); avaliar Redis se o volume crescer.
- Registrar o aceite (versão) dos termos no cadastro.
- Teste de invasão externo e revisão do RLS por segunda pessoa.

**Funcionalidades previstas e ainda não feitas:** notificações; fila de moderação de denúncias (hoje as denúncias são gravadas); papéis de moderador por comunidade; foto de perfil e capa; visibilidade por campo do perfil; códigos de recuperação do 2FA; lista de sessões ativas; módulos Biblioteca, Mensagens privadas, Álbuns, Chat e Calendário; Corpos e múltiplas Potências na interface.
