# Passagem de bastão — leia isto primeiro

Última atualização: **06/09/2026**, por Claude (Opus 5).

---

## Em três linhas

A **AFLINE** presta serviço para a **CLARO** em Manaus e mais 17 praças.
Hoje opera num sistema de terceiro, o **Alfa Gestor (ngestor)**, que ficou
caro. Este projeto é o substituto: recebe as ordens de serviço do **TOA
(Oracle Field Service)** da CLARO, despacha às equipes, recebe a execução
do campo e mede.

Nasce **multi-empresa** — o Emanuel pretende vendê-lo a outras credenciadas.

---

## Onde está tudo

| | |
|---|---|
| Repositório | `github.com/emanuelsystembox-alt/Gestor-AF` |
| Pasta local | `C:\Users\Emanu\OneDrive\Documentos\PROJETO - NGESTOR AFLINE` |
| Banco | Supabase `AFLINE manager` · `kqfflkxjijzdtnfshdlv` · sa-east-1 |
| App | `cd app && npm install && npm run dev` → localhost:5173 |
| Login | `admin@afline.com.br` · senha só com o Emanuel |

O `.env` já está preenchido e **não** vai para o Git.

> **Fora de escopo:** existe outro Supabase, `BANCO PRO - AFLINE 360`, com
> 350+ migrations. É a camada analítica, outro projeto. Não foi tocado
> desde 04/09. Ver `docs/04-DESCOBERTA-AFLINE-360.md`.

---

## Ordem de leitura

1. **`CLAUDE.md`** — como trabalhar aqui: vocabulário, armadilhas, regras
2. **`docs/08-ESTADO-DO-PROJETO.md`** — onde estamos, com números
3. **`docs/03-DECISOES.md`** — as 52 decisões e o porquê de cada uma
4. **`supabase/README.md`** — banco, conferências e dívida de migrations
5. **`docs/06-PONTUACAO.md`** — o que está bloqueado e por quê

---

## As três regras que o Emanuel pediu

1. **Não invente regra de negócio. Pergunte.** Ele foi explícito:
   *"não crie nada que achar que é válido, sempre tire dúvida comigo."*
2. **Derive do dado real.** O de/para de grupo de serviço saiu do
   cruzamento de dois exports pela WO, não de suposição. Faça igual.
3. **Documente a decisão e o porquê**, em `docs/03-DECISOES.md`.

---

## O que está pronto e testado

**Banco:** 26 tabelas, 35 funções, 50 policies, zero tabela sem RLS,
zero função `SECURITY DEFINER` alcançável pelo `anon`.

**Telas** (todas verificadas com dado real):

| Rota | Estado |
|---|---|
| `/entrar` | login |
| `/controle` | painel do controlador |
| `/controle/servicos` | lista com 9 filtros + CSV |
| `/controle/visita/:id` | detalhe com 4 abas + transferência |
| `/controle/equipes` | painel por dia: períodos, situações, OCIOSO, contratos por equipe |
| `/controle/importar` | importação do TOA com prévia |
| `/controle/sub-falhas` | importa os conjuntos da CLARO e escolhe o vigente |
| `/controle/relatorios` | relatório por contrato e por O.S., com CSV |
| `/controle/configuracoes` | status, indicadores de qualidade e tabela de pontuação |
| `/controle/administracao` | usuários, cargos, perfis de acesso e permissões |
| `/campo` e `/campo/visita/:id` | agenda e execução do técnico |

**Dados:** 470 visitas, 564 O.S., 89 equipes, 104 técnicos, 18 praças,
168 códigos de baixa classificados. Dois dias: 04 e 05/09/2026.

---

## O que está bloqueado, e por quê

### 1. Pontuação e faturamento — o item mais importante

É **dinheiro em duas direções**: o que a CLARO paga e o que a equipe
recebe, valores diferentes. A regra é
**tabela de preço × tipo de pessoa × edificação × tipo de O.S.**

**Dois bloqueios:**

**a) A fonte não tem duas das quatro dimensões.** ~~Bloqueio~~ **decidido
em 06/09 (D-030):** o export do ngestor entra também, cruzado pela WO. A
dependência é aceita e permanente — o objetivo é a camada operacional
própria, não cortar a fonte.

O export do TOA continua sem `Cliente`, `Tipo de pessoa`, `Edificação` e
`Telefones`. Mas há dois sinais nele que ninguém tinha olhado —
`Segmentação` (PME, `PURPLE PME PF`) e `Complemento Endereço` (CASA, APT,
BL, LJ) — que leem 60% dos casos. São **derivações, não o dado**;
confirmar com o Emanuel antes de valerem para faturamento. Números e as
três perguntas estão em `docs/06-PONTUACAO.md`.

**b) Faltam 8 respostas.** Estão listadas no fim daquele documento.
**Não implemente pontuação sem elas.**

### 2. Regras de Comissionamento

O Emanuel confirmou que a comissão da equipe sai de lá, aplicada por
**fatores**. A tela nunca foi aberta. É o próximo levantamento.

### 3. Sub-falhas — ~~falta a tela~~ ~~falta o arquivo~~ falta ESCOLHER

O arquivo da CLARO traz **dois** conjuntos, `CASO 1` e `NÍVEL HARD`.
(A contagem antiga aqui — 114/534 e 155/933 — era de uma cópia mais
velha; os números medidos no arquivo oficial estão abaixo.)

Os dois já estão no banco (06/09, noite), do arquivo
`CONSOLIDADO_SUBFALHAS_CLARO_2026_1_0_REVISADO_OFICIAL.xlsx`:

| conjunto | pares | códigos | categorias | sem vínculo |
|---|--:|--:|--:|--:|
| CASO 1 | 528 | 115 | 11 | 0 |
| NÍVEL HARD | 938 | 155 | 17 | 0 |

**Nenhum está marcado como vigente — a escolha é do Emanuel**, no botão
"Usar este" em `/controle/sub-falhas`. Pode ser trocada depois sem
reimportar. Enquanto ninguém escolhe, o campo não tem lista de sub-falha
para oferecer.

O arquivo é **largo** (uma linha por código, `Subfalha 1..7` em colunas)
— ver D-032. Lido como longo, traria 147 pares em vez de 938.

---

## Próximo passo combinado

Ordem acertada com o Emanuel:

1. ~~Detalhe do contrato~~ **feito**
1a. ~~Tela de importação das sub-falhas~~ **feita** — `/controle/sub-falhas`
2. ~~**Equipes expandida**~~ **feita** — painel por dia, com períodos,
   situações, OCIOSO (D-026/D-033) e cada equipe abrindo os contratos com
   as O.S. e o código de baixa. Falta ainda `skill` e `pontos`: skill não
   existe no modelo (lacuna conhecida) e pontos depende da pontuação.
3. ~~**Marcadores**~~ **feito em parte** — os 7 indicadores de qualidade
   viraram cadastro, e o analista aponta o marcador no contrato pela tela
   de Serviços (D-037). Falta combinar quais são **exigidos** por tipo de
   serviço e se o marcador registra cumprido/não cumprido.
4. Monitoramento — trajeto, derivável de `visita_evento.lat/lng`
5. Relatórios — depois que a pontuação existir

---

## Dívidas conhecidas

| Dívida | Onde |
|---|---|
| ~~8 O.S. recusadas~~ **resolvido**: era reatendimento, não duplicata | D-041 |
| ~~Administração de usuários~~ **feita** (D-049 a D-053) | falta reescrever policies para permissão fina |
| 7 migrations aplicadas sem arquivo local | `supabase/README.md` explica como sincronizar |
| 12 lacunas de modelo (skill, marcadores, geo cerca…) | `docs/07-TELAS-DETALHADAS.md` |
| Frota, almoxarifado, produtividade, aferição | não iniciados |
| 3 tabelas sem RLS **no outro Supabase**, uma com 183 nomes de técnico | levantado em 04/09, decisão do Emanuel, pendente |

---

## Erros que eu cometi — para você não repetir

**Achei que `Login do Técnico` no TOA era matrícula de pessoa.** É o
recurso da **EQUIPE** — a AFLINE trabalha em dupla. Cheguei a acusar 5
técnicos de "trabalhar sem cadastro"; três eram login de equipe. Pior: o
login **muda de dono**, então guardar só o valor corrente corromperia a
produtividade histórica. Resolvido com `equipe_login_toa` e período.

**Usei `visita.situacao_em` como hora de encerramento.** Numa visita
cancelada ele é a hora da IMPORTAÇÃO — a "última atividade" da equipe
virou 06/09 03:34 para metade da operação. Só vale com `fim`, ou com
`situacao_em` **quando `bloqueado_em` existe** (o campo tocou). Corrigido
antes de a tela ir ao ar; ver D-033. É a mesma armadilha do `criado_em`.

**Tentei medir "fila" a partir de `visita.criado_em`.** É a hora da
importação. Deu 0 min. Da atribuição do TOA deu 878 min — que é a noite
inteira, já que a atribuição roda 00:23 e o técnico começa 08:00. A
métrica útil acabou sendo **aderência à janela**.

**Armei a trava do D-006 no INSERT.** Visita que chegava concluída do TOA
nascia travada e o TOA nunca mais a corrigia. A trava tem que significar
"o campo tocou nisto", e só isso.

**Confiei no lint do Supabase para segurança.** Ele dizia que `anon` ainda
alcançava `importar_toa` depois de eu revogar. Só a consulta a
`has_function_privilege` mostrou a verdade — e ela era pior do que o lint
dizia por outro motivo (concessão nominal vs `PUBLIC`).

> O padrão: **pergunte ao banco, não à ferramenta que resume o banco.**
