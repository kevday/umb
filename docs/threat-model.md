# Modelo de ameaça (resumo)

| Ameaça | Controle | Verificado por |
|---|---|---|
| Vazamento da lista de membros | Cadastro por convite aprovado; RLS; dados institucionais só para o próprio, amigos e mesma Loja; sem páginas públicas; `noindex` | `social.test`, `rls`, e2e |
| Infiltração de não maçons | Convite criado e aprovado por pessoas diferentes; e-mail do convite deve coincidir; validade de 14 dias | `institution.test`, e2e |
| Conta de autoridade sequestrada | 2FA obrigatório para cargo (sessão sem 2FA é bloqueada); bloqueio após 5 falhas; revogação de sessões | `auth.test`, `institution.test`, e2e |
| Elevação indevida de Grau | Aprovação dupla (código e `CHECK` no banco); sem autoalteração; progressão sequencial; histórico imutável | `approval.test`, `institution.test` |
| Abuso pela administração técnica | Sem autoridade maçônica nem acesso a conteúdo (ACE e RLS); módulos exigem 2FA | `can.test`, e2e |
| Enumeração de áreas restritas | 404 idêntico para restrito e inexistente; busca, listas e tópicos filtrados pelo RLS | `social.test`, e2e |
| Divergência entre regra e banco | Teste de paridade `can` × `app_can` | `parity.test` |
| Adulteração de auditoria | Append-only no banco; cadeia SHA-256; verificação na tela de auditoria | `institution.test` |
| CSRF / clickjacking / XSS | Server Actions com checagem de Origin; `X-Frame-Options`; CSP com nonce; React escapa saída | e2e |
| Força bruta e credential stuffing | Bloqueio por conta e limite por IP (estado no banco) | `auth.test`, `account.test` |
| Reuso de código 2FA | Passo de 30 s já usado é recusado | `auth.test` |
| Captura de tela e repasse por membros | Não mitigável tecnicamente; coberto por termos de conduta e orientação | (processo) |

Fora do escopo técnico: validação da condição maçônica na origem (feita pela Potência/Loja), e segurança do dispositivo do usuário.
