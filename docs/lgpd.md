# LGPD: minuta para validação jurídica e do encarregado (DPO)

> Rascunho técnico. Não substitui parecer jurídico. Pendente definir o **controlador** e nomear o **encarregado**.

## Dados tratados
| Dado | Finalidade | Sensível? | Retenção |
|---|---|---|---|
| E-mail, usuário, senha (hash Argon2id) | Acesso à conta | Não | Até a exclusão (anonimizado) |
| Nome, apresentação, foto (futuro) | Identidade na rede | Não | Até a exclusão |
| Vínculo com Loja, Grau, cargos, status | Controle de acesso | **Sim** (filiação a organização de caráter filosófico, art. 5º, II) | Vínculo encerrado na exclusão; histórico de Graus mantido sem identificação direta |
| Conteúdo (recados, tópicos, respostas) | Relacionamento entre membros | Pode conter dado sensível | Mantido anonimizado após exclusão |
| Auditoria institucional | Segurança e prestação de contas | Sim | Conforme política (a definir, sugestão: 5 anos), sem dados diretos após exclusão |
| Sessões (IP, navegador) | Segurança | Não | Revogadas/expiram em até 30 dias |

## Bases legais (a confirmar)
Filiação é dado sensível: consentimento específico e destacado no cadastro e/ou tratamento por entidade sem fins lucrativos de caráter filosófico para seus membros (art. 11, II, "a" a "g", conforme o caso). Registrar a versão dos termos aceitos (pendente: tabela de aceite).

## Direitos do titular (implementados)
- **Acesso e portabilidade:** `Configurações → Baixar meus dados` (JSON).
- **Correção:** edição de perfil; dados institucionais por autoridade competente.
- **Eliminação:** `Configurações → Excluir minha conta` (anonimização).

## Segurança
Criptografia em trânsito (HTTPS/HSTS) e em repouso do segredo do 2FA; senhas com Argon2id; RLS; auditoria; mínimo de dados (sem rituais, sem documentos).

## Pendências jurídicas
Controlador e DPO; RIPD final; política de privacidade e termos; política de retenção; plano de resposta a incidentes com comunicação à ANPD; contratos com operadores (hospedagem, banco, e-mail).
