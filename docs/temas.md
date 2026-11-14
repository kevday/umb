# Cores do site (temas por Rito)

## Como a paleta é escolhida
1. **Cor própria do irmão**, se ele definiu em *Configurações → Aparência*.
2. Senão, o **Rito da Loja** (definido pelo Venerável ou pela Administração da Potência em *Instituição → Rito da Loja*).
3. Senão, a **paleta padrão** (azul-lavanda suave com acento magenta, no estilo de rede social clássica).

Cada irmão pode voltar ao padrão da Loja com um clique.

## Cores por Rito (orla do avental de Mestre)
| Rito | Cor da orla | Adorno |
|---|---|---|
| REAA | #B22222 | #DC143C |
| RER | #4682B4 | #1F3A5F (filete) |
| Schröder | #87CEFA | #5B8DB8 |
| York | #7BAFD4 | #6495ED |
| Inglês, Emulação | #008B8B | #C0C0C0 (borlas prateadas) |
| Francês | #5D8AA8 | #00BFFF |
| Adonhiramita (azul) | #1E90FF | #5D8AA8 |
| Adonhiramita (vermelho) | #C8102E | #8E0B21 |
| Brasileiro | #002366 | #D4AF37 (dourado) |
| Memphis-Misraïm | #00BFFF | #D4AF37 |

A lista fica em `src/theme/rites.ts`. Para ajustar uma cor ou incluir um Rito, edite ali (e a lista de valores aceitos pelo banco é gerada dela: rode `npx drizzle-kit generate` e aplique a migração).

## Bom gosto e legibilidade (automático)
A cor do Rito é usada como **orla**: faixa no topo, linha dupla sob o menu e sublinhado dos títulos. Links, botões e textos usam um **tom derivado** da mesma cor, ajustado para cumprir contraste **WCAG AA** nos modos claro e escuro (texto 7:1, links e botões 4,5:1). Cores claras como o azul do Schröder ou o celeste do Memphis não viram texto ilegível: a orla fica na cor original e o texto usa um tom mais profundo. Vale também para qualquer cor escolhida pelo irmão (testado com branco, preto, cinza, amarelo e 300 cores aleatórias).

## Detalhes técnicos
- O CSS do tema é injetado no layout com *nonce* (compatível com a CSP estrita) e só contém variáveis hexadecimais geradas no servidor.
- `lodges.rite` e `profiles.theme_color` têm `CHECK` no banco. A mudança de Rito é auditada (`lodge.rite`).
- No configurador: pergunta de Rito (ou `SETUP_RITE=brasileiro` no modo automático).
