# Pendências antes da produção

Esta lista é um gate de liberação. A branch `master` é uma integração em validação e não deve receber dados reais antes da conclusão dos bloqueios técnicos e jurídicos.

## Bloqueantes técnicos

- [ ] **Privacidade de biografia no banco:** a visibilidade da biografia ainda é aplicada na camada de aplicação. A policy de SELECT em `profiles` permite leitura ampla pelo papel autenticado. Separar os campos privados ou criar camada de leitura segura e provar o isolamento com testes negativos no PostgreSQL.
- [ ] **RLS e privilégios:** revisar owner das tabelas, papel runtime, `FORCE ROW LEVEL SECURITY`, grants por tabela/coluna e uso real de `SET ROLE app_reader`. Executar testes com o mesmo papel e credenciais usados em produção.
- [ ] **Histórico de Grau:** após aplicar `0011_ace_degree_scope`, resolver todos os registros de `degree_assignments` sem `lodge_id`. Não atribuir contexto por inferência; exigir evidência administrativa.
- [ ] **Dupla aprovação:** a constraint permite origens `bootstrap` e `potencia`; a origem `potencia` ainda depende de autorização no serviço. Implementar validação de defesa em profundidade no banco.
- [ ] **Exclusão de conta/LGPD:** corrigir corrida entre verificação de cargos e exclusão; definir anonimização/retenção de posts, respostas, denúncias, auditoria e históricos institucionais.
- [ ] **Recuperação de conta:** documentar o fluxo para quem perde autenticador, códigos de recuperação e acesso ao e-mail. Hoje há códigos de recuperação, recuperação por e-mail verificado após login com senha e redefinição por autoridade/CLI. Para perda simultânea de senha e acesso ao e-mail, manter procedimento administrativo formal.
- [ ] **Auditoria:** avaliar contenção do advisory lock global de escrita; manter checkpoints externos/WORM, pois um administrador do banco pode alterar a cadeia e recalcular hashes.
- [ ] **E-mail:** configurar Resend, SPF, DKIM, domínio de envio, monitoramento e política de retentativa.
- [ ] **Rate limiting:** confiar em `x-forwarded-for` somente atrás de proxy confiável; avaliar armazenamento distribuído se houver múltiplas instâncias/volume alto.
- [ ] **Testes:** executar CI completo, migrações sobre cópia do banco real, testes de concorrência e benchmark com PostgreSQL.
- [ ] **Pentest:** revisão independente de autorização, RLS, autenticação, recuperação de conta e fluxos administrativos.

## Bloqueantes jurídicos e operacionais

- [ ] Definir controlador e encarregado de dados.
- [ ] Validar bases legais, termos, política de privacidade e versão do aceite no cadastro.
- [ ] Elaborar e validar RIPD.
- [ ] Definir Potência/Loja do piloto, responsáveis e procedimento de suporte.
- [ ] Definir política de retenção, anonimização, exportação e atendimento aos direitos dos titulares.

## Funcionalidades previstas ainda não implementadas

- Notificações.
- Fila de moderação de denúncias (as denúncias são registradas, mas a fila operacional está pendente).
- Papéis de moderador por comunidade.
- Foto de perfil e capa.
- Visibilidade granular de todos os campos do perfil com enforcement no banco.
- Lista e gerenciamento de sessões ativas pelo usuário.
- Módulos Biblioteca, Mensagens privadas, Álbuns, Chat e Calendário.
- Corpos e múltiplas Potências na interface.

## Critérios mínimos para liberar piloto

1. Todos os bloqueantes técnicos de autenticação, autorização, RLS e histórico de Grau resolvidos.
2. `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, migrações e `npm run e2e` aprovados.
3. CI verde no commit exato que será implantado.
4. Migração ensaiada em cópia recente do banco, backup restaurável e plano de rollback.
5. Pentest/revisão independente e aprovação jurídica/operacional documentadas.
