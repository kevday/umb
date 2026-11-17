# Entre Colunas — plataforma social maçônica

Aplicação social modular com identidade institucional e autorização contextual por Grau, cargo, Loja, Jurisdição e situação do membro. Arquitetura de monólito modular em Next.js, TypeScript, Drizzle ORM e PostgreSQL.

> **Estado desta branch:** integração técnica em validação. Esta branch não deve ser considerada pronta para produção até que os testes, as migrações sobre uma cópia do banco real, a revisão independente de RLS e os itens bloqueantes abaixo sejam concluídos.

## Objetivos desta linha de integração

A branch `master` foi criada a partir de `main` para preservar as funcionalidades recentes da aplicação e incorporar seletivamente otimizações e correções da branch `fix/security-auth-performance-2026-11`. Não é um merge cego: o histórico de migrações da `main` é a base, e as alterações da outra branch foram reimplementadas onde eram compatíveis.

## Funcionalidades e melhorias aplicadas

### Autenticação e gestão de sessão

- Senhas com Argon2id e comparação de hash fictício para reduzir diferenças de tempo na identificação de contas inexistentes.
- Sessões revogáveis, com prazo absoluto e prazo de inatividade.
- Validação da sessão consulta sessão, estado da conta e existência de TOTP confirmado em uma única consulta com JOIN.
- Atualização de `last_used_at` limitada a uma operação por minuto, em vez de uma escrita em cada navegação.
- A atualização de atividade usa condição SQL para não atualizar sessão revogada ou expirada após a leitura inicial.
- Quando o usuário possui TOTP confirmado, `requirePage()` exige MFA antes de permitir qualquer página privada.
- Ao confirmar um novo autenticador, as sessões existentes perdem a marca de MFA anterior; a ação de ativação valida novamente somente a sessão corrente.
- Incremento de tentativas de senha realizado atomicamente no PostgreSQL para evitar perda de incrementos concorrentes.
- Limitação de tentativas no fluxo de autenticação e nos fluxos de 2FA.

### 2FA e recuperação de conta

- TOTP com segredo cifrado por AES-256-GCM.
- Consumo atômico do passo TOTP para impedir reutilização concorrente do mesmo código.
- Dez códigos de recuperação por ativação; o banco armazena somente hashes e cada código pode ser usado uma única vez.
- Regeneração de códigos mediante confirmação da senha; os códigos anteriores são substituídos.
- Troca de aplicativo autenticador mediante senha e prova do autenticador anterior ou código de recuperação.
- Recuperação autônoma do 2FA por link de uso único enviado ao e-mail verificado, após autenticação por senha; revoga sessões e registra auditoria.\n- Redefinição administrativa do 2FA com justificativa, revogação de sessões e registro de auditoria.
- Ferramenta CLI de emergência exige `RESET_2FA_OPERATOR_ID`, identificando uma conta técnica ativa. O ator da auditoria passa a ser o operador, e não automaticamente a conta afetada.
- Alteração de senha e recuperação por token revogam as demais sessões.

**Limitação conhecida:** a recuperação por e-mail depende de o usuário ainda conseguir entrar com a senha e ter acesso ao e-mail verificado. Se perdeu também o acesso ao e-mail ou a senha, permanece o procedimento de redefinição pela autoridade competente ou pelo operador técnico autorizado.

### Troca de e-mail e tokens

- A troca de e-mail exige a senha atual e confirmação de posse do novo endereço.
- Uma nova solicitação invalida solicitações anteriores do mesmo usuário dentro de uma transação serializada por bloqueio da linha da conta.
- A confirmação consome o token, atualiza o endereço, invalida outros tokens pendentes e revoga sessões na mesma transação.
- A redefinição de senha valida a política antes de consumir o token. Consumo, atualização da senha e revogação de sessões são transacionais.
- Tokens continuam sendo aleatórios e armazenados como hashes.

### Autorização institucional (ACE)

- Depois de resolver o vínculo institucional, Grau e cargos são obtidos em uma única consulta SQL agregada, evitando duas viagens adicionais ao banco (o pool serverless usa uma conexão por instância).
- O sujeito só é carregado quando há exatamente um vínculo vigente; vínculos futuros não contam e vínculos sobrepostos negam acesso.
- O Grau passa a ser contextualizado por Loja, evitando que um Grau registrado em outra Loja eleve as permissões do vínculo atual.
- As funções SQL `app_can()` e `app_eval()` foram atualizadas para considerar a vigência do vínculo e o Grau da Loja correspondente.
- Os novos registros de Grau são gravados com o identificador da Loja.

### Auditoria

- A cadeia SHA-256 continua sendo append-only e encadeada.
- A consulta de auditoria por autoridade agora filtra Loja/Jurisdição no PostgreSQL, em vez de carregar toda a cadeia para filtrar em memória.
- Foram adicionados índices por escopo institucional.
- O bloqueio advisory global de `appendAudit()` foi mantido para preservar a serialização da cadeia. Ele ainda pode limitar throughput em picos de operações auditadas.

### Banco de dados e desempenho

Migrações adicionadas nesta branch:

| Migração | Finalidade |
|---|---|
| `0010_performance_indexes` | Índices para progressões, cargos, tokens, amizades, mural, tópicos e respostas |
| `0011_ace_degree_scope` | Coluna de Loja no histórico de Grau, backfill histórico e paridade de contexto do ACE SQL |
| `0012_audit_scope_indexes` | Índices de expressão para consulta de auditoria por Loja/Jurisdição |\n| `0013_mfa_email_recovery` | Tipo de token para recuperação autônoma de MFA por e-mail verificado |

Índices não substituem medição. O plano de execução deve ser conferido com `EXPLAIN (ANALYZE, BUFFERS)` usando volume representativo. Índices adicionais aumentam o custo de escrita e armazenamento; não devem ser adicionados sem observar as consultas reais.

### Configuração e compatibilidade

- Node.js suportado: `^22.12.0 || ^24.0.0 || >=26.0.0`. Node 26.13 atende a essa faixa.
- `npm run doctor` verifica a faixa de Node compatível com Vite 8/Vitest 5.
- `package.json` e `package-lock.json` declaram a mesma faixa.
- PostgreSQL 14 ou superior.
- CI usa PostgreSQL real para migrações e smoke/e2e, além de testes PGlite.

## Instalação e execução

Requisitos: Node.js em versão suportada, npm e PostgreSQL 14+.

```sh
npm ci
npm run setup
npm run doctor
npm run dev
```

Verificações locais:

```sh
npm run typecheck
npm test
npm run build
```

Para o teste ponta a ponta, configure o ambiente de teste, inicie o servidor e execute:

```sh
npm run start
npm run e2e
```

Consulte `docs/configurador.md` e `docs/operacao.md` para variáveis de ambiente, banco, migrações, provisionamento institucional e implantação.

## Migrações e atualização de bancos existentes

A sequência `0000` a `0009` desta branch preserva o histórico da `main`, incluindo `0009_account_recovery.sql`. As migrações `0009_email_change.sql`, `0010_mfa_recovery.sql` e `0011_potencia_direct_apprentice.sql` da branch de otimização não devem ser copiadas para este histórico: elas pertencem a uma linha divergente.

A atualização desta branch adiciona `0010` a `0013`. Antes de aplicar em qualquer banco com dados:

1. Faça backup consistente e teste a restauração.
2. Aplique as migrações em uma cópia do banco.
3. Verifique os registros históricos de `degree_assignments` sem `lodge_id`.
4. Execute `npm run doctor`.
5. Compare os resultados de autorização antes/depois, especialmente membros com histórico de transferência entre Lojas.

A migração `0011_ace_degree_scope` associa automaticamente um Grau à Loja somente quando encontra exatamente um vínculo que cobria a data da progressão. Como o histórico é append-only, a migração desabilita temporariamente o trigger de imutabilidade apenas durante o backfill, executado pelo owner, e o reabilita na mesma transação. Registros ambíguos permanecem sem Loja e são bloqueados pelo `doctor`; precisam de saneamento administrativo documentado. Não atribua uma Loja por suposição.

## Reset emergencial de 2FA via CLI

A operação exige uma conta de administração técnica ativa para identificar o operador na auditoria:

```sh
RESET_2FA_OPERATOR_ID="<uuid-da-conta-tecnica-ativa>" \
  npm run reset-2fa -- usuario@exemplo.org "justificativa com pelo menos dez caracteres"
```

Use somente em procedimento de emergência, com autorização operacional registrada. A operação remove TOTP e códigos de recuperação da conta alvo e revoga as sessões existentes.

## Pendências bloqueantes antes de produção

Os itens abaixo não devem ser interpretados como resolvidos por esta branch:

1. **Privacidade de biografia no PostgreSQL:** a visibilidade da biografia ainda depende da aplicação. A política de SELECT de `profiles` permite leitura ampla a usuários autenticados pelo papel da aplicação; é necessário separar os dados privados ou criar uma camada de leitura segura com RLS/colunas apropriadas. Não tratar a filtragem na página como isolamento de banco.
2. **Revisão integral de RLS e papéis:** validar owner, runtime role, `FORCE ROW LEVEL SECURITY`, grants por tabela e coluna e testes negativos de isolamento. Indicadores do `doctor` não substituem pentest.
3. **Histórico de Grau:** resolver todos os registros sem `lodge_id` após a migração `0011`, com evidência e revisão institucional.
4. **Dupla aprovação:** a restrição SQL permite as origens especiais `bootstrap` e `potencia`; a autorização da origem `potencia` depende também da lógica de serviço. Acrescentar defesa em profundidade no banco para impedir inserção direta indevida.
5. **Exclusão de conta/LGPD:** revisar concorrência entre exclusão e nomeações/cargos, retenção de registros históricos e anonimização de posts, respostas e denúncias. A política de retenção precisa ser validada juridicamente.
6. **Recuperação de conta:** decidir e documentar o procedimento para quem perde simultaneamente autenticador, códigos e acesso ao e-mail.
7. **Auditoria:** a cadeia global usa lock advisory único; medir contenção sob carga e manter checkpoints externos/WORM para reduzir a capacidade de adulteração por um administrador do banco.
8. **Infraestrutura de e-mail:** configurar SPF, DKIM, domínio de envio e monitoramento de entrega.
9. **Proteção por IP:** confiar em `x-forwarded-for` somente atrás de proxy conhecido e configurado; avaliar Redis/serviço distribuído se a taxa de requisições exigir.
10. **Privacidade e conformidade:** definir controlador, encarregado, bases legais, termos, versão de aceite, política de privacidade e RIPD com assessoria competente.
11. **Dependências npm:** a instalação de CI reportou 7 avisos de auditoria (5 moderados e 2 altos); executar `npm audit`, identificar dependências afetadas e corrigir com atualização compatível, sem aplicar `npm audit fix --force` sem análise.\n12. **Segurança externa:** executar pentest independente e revisão de código/RLS por segunda pessoa.

## Testes e critérios de aceite

Não declarar a branch aprovada apenas pela existência de testes no repositório. Antes de merge:

- `npm ci`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run db:migrate` em banco descartável PostgreSQL 14+
- `npm run e2e`
- CI GitHub Actions verde para o commit exato
- Testes de autorização ACE × SQL, RLS com papéis reais, recuperação de senha/2FA, concorrência de tokens e sessões
- Benchmark de carga com p50/p95/p99, throughput, CPU, conexões, WAL e locks
- Migração testada sobre cópia recente do banco real, com backup e plano de rollback

## Documentação complementar

- [Configurador](docs/configurador.md)
- [Cores por Rito](docs/temas.md)
- [Decisões de arquitetura](docs/adr/0001-decisoes.md)
- [Modelo de ameaça](docs/threat-model.md)
- [LGPD](docs/lgpd.md) — minuta sujeita a validação jurídica
- [Operação e implantação](docs/operacao.md)
- [Pendências antes da produção](docs/pendencias.md)
- [CI](.github/workflows/ci.yml)
