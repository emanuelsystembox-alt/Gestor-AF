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
3. **`docs/03-DECISOES.md`** — as 29 decisões e o porquê de cada uma
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
| `/controle/equipes` | equipes, técnicos, aviso de recurso fora do cadastro |
| `/controle/importar` | importação do TOA com prévia |
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

**a) A fonte não tem duas das quatro dimensões.** Conferido nas 470
visitas: o export do TOA **não traz** `Cliente`, `Tipo de pessoa`,
`Edificação` nem `Telefones` — zero preenchidos. Quem traz é o export do
ngestor, justamente o sistema que queremos abandonar. Três caminhos
possíveis estão em `docs/06-PONTUACAO.md`; a escolha é do Emanuel.

**b) Faltam 8 respostas.** Estão listadas no fim daquele documento.
**Não implemente pontuação sem elas.**

### 2. Regras de Comissionamento

O Emanuel confirmou que a comissão da equipe sai de lá, aplicada por
**fatores**. A tela nunca foi aberta. É o próximo levantamento.

### 3. Sub-falhas — falta escolher o conjunto

`CONSOLIDADO_SUBFALHAS_CLARO_2026.xlsx` traz **dois** conjuntos:
`CASO 1` (114 códigos, 534 pares) e `NÍVEL HARD` (155 códigos, 933 pares).
A tabela `sub_falha` e o importador `importar_sub_falhas()` existem; falta
a tela de importação e a decisão de qual vale
(`empresa.conjunto_sub_falha`).

---

## Próximo passo combinado

Ordem acertada com o Emanuel:

1. ~~Detalhe do contrato~~ **feito**
2. **Equipes expandida** — com `OCIOSO`, login On/Off, skill, pontos,
   períodos. A regra de ocioso já está definida (D-026): **10 minutos após
   concluir o contrato anterior sem novo status**. É derivado, não
   armazenado; o `10` é `empresa.minutos_ocioso`; e exige o último evento
   **por equipe**, não por visita.
3. Marcadores — evidências exigidas por tipo de serviço
4. Monitoramento — trajeto, derivável de `visita_evento.lat/lng`
5. Relatórios — depois que a pontuação existir

---

## Dívidas conhecidas

| Dívida | Onde |
|---|---|
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
