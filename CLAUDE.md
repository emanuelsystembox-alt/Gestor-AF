# Gestor AF — guia para quem (ou o que) for trabalhar neste repositório

**Assumindo o projeto agora? Leia `HANDOFF.md` primeiro.**

Leia isto antes de mexer em qualquer coisa. Este arquivo existe para que
outra pessoa — ou outra IA — entre no projeto sem repetir descobertas que
já custaram caro.

## O negócio em cinco linhas

A **AFLINE** é prestadora da **CLARO**. Recebe ordens de serviço pelo
**TOA (Oracle Field Service)** da CLARO, manda técnico a campo, executa e
dá baixa. Hoje isso roda num sistema de terceiro (**Alfa Gestor /
ngestor**) que fica caro e cujo roadmap não controlamos. Este projeto é a
camada operacional própria: importar, despachar, executar, medir e cobrar.

## Regras de ouro

1. **Não invente regra de negócio.** Se não souber, **pergunte ao
   Emanuel**. Ele pediu isso explicitamente. Preferir uma pergunta a um
   palpite bem-intencionado.
2. **Derive do dado real.** O de/para de grupo de serviço não foi
   inventado: saiu do cruzamento de dois exports pela WO. Faça o mesmo.
3. **Planilha de cliente não entra no Git.** `*.xlsx` e `*.csv` estão no
   `.gitignore`. Nome, telefone e endereço de assinante são LGPD.
4. **Permissão vive no banco.** RLS no Postgres, não na tela.
5. **Documente a decisão E o porquê** em `docs/03-DECISOES.md`.

## Vocabulário — não confunda estes três

| Termo | O que é | Onde vive |
|---|---|---|
| **Visita** (Atividade no TOA) | uma ida a um endereço | `visita` |
| **O.S.** | uma ordem de serviço; **1 visita tem de 1 a 10** | `ordem_servico` |
| **Tipo de atividade** | como o **TOA** chama (`Instalacao`, `Visita Tecnica`) | `tipo_atividade` |
| **Grupo/Tipo de serviço** | como a **operação e a CLARO** agrupam (`ADESAO`, `VISITA TECNICA`, `MIGRACAO GPON`) | `tipo_servico` |
| **Tipo de O.S.** | o código numérico da CLARO (`1`, `43`, `191`) | `tipo_os` |
| **Tipo de O.S. Consolidado** | o item da **LPU** que é faturado | *ainda não modelado* |

> O.S. com número `AF-00000001` nasceu **aqui**, não na CLARO — é
> cadastro manual (D-063). Os números da operadora têm 10 dígitos.
>
> O caso mais comum é **2 O.S. por visita**. Achatar em "1 linha = 1 O.S."
> conta o deslocamento em dobro **e erra o faturamento** — ver Pontuação.

## Armadilhas que já morderam

**A planilha do TOA tem cabeçalhos repetidos.** `Tipo de Atividade`
aparece nas posições 19 e 20 (categoria e tipo real). Ler "pela chave"
perde a primeira em silêncio. `src/lib/toa.ts` lê **por posição** e
sufixa com `__2`. Nunca troque por `sheet_to_json` com header padrão.

**`revoke ... from public` não remove concessão nominal.** O Supabase
concede `EXECUTE` explicitamente a `anon` em toda função criada no
schema `public`. Tem que ser `revoke ... from anon`. E `CREATE OR
REPLACE` preserva a ACL, mas função criada do zero (após um `RENAME`)
nasce aberta de novo. **Confira sempre com
`has_function_privilege('anon', oid, 'EXECUTE')`, não com o lint.**

**RLS não restringe COLUNA.** Policy de `UPDATE` liberada por linha
libera a linha inteira — inclusive as colunas que dão poder. Para
proteger coluna, o instrumento é trigger. Ver D-050.

**Teste de policy escrito como `SECURITY DEFINER` não testa nada.**
Definer roda como o owner, que tem `BYPASSRLS`: todos os cenários passam
sem o RLS ser consultado. Use INVOKER + `set local role authenticated`.
Ver D-054.

**`SECURITY DEFINER` ignora o RLS.** Se a função faz algo privilegiado,
cheque o papel **dentro** dela. Ver `importar_toa`.

**Não meça tempo a partir de `visita.criado_em`.** É a hora da
importação, não do evento. Medir "fila" assim deu 0 min. Medir da
atribuição do TOA deu 878 min (a atribuição é 00:23 e o técnico começa
08:00 — mede a noite). A métrica útil é **aderência à janela**.

**Jornada não entra em produtividade.** `Na Base` e `Refeição` foram 103
de 344 apontamentos num dia. `tipo_atividade.natureza` separa
`PRODUTIVA` de `JORNADA`. Sempre filtre.

**O PostgREST tem cache de schema.** Depois de `ALTER TABLE`, o front
recebe `PGRST100 — failed to parse select parameter` apontando uma coluna
que **está** no banco. Não é sintaxe: é cache. `notify pgrst, 'reload
schema';`

**FK com UNIQUE vira um-para-um, e o embed devolve OBJETO, não array.**
`reincidencia` tem `unique (visita_id)`; `reincidencia[0]` derrubou a
tela de Relatórios inteira. Duas FKs para a mesma tabela deixam o embed
ambíguo e exigem o nome da constraint
(`reincidencia!reincidencia_visita_id_fkey`).

**O `supabase-js` remove TODO espaço em branco do `select`.** Se for
testar um select na unha com `curl`, replique isso — senão você caça um
erro de sintaxe que só existe no seu teste.

**Autor de evento não pode vir do cliente.** A tela do campo mandava
`usuario_id` no INSERT; quem carimba quem fez é o servidor, em
`registrar_etapa` e `baixar_os`. Ver D-061.

**`norm_txt(NULL)` devolve STRING VAZIA, não NULL** — e coluna nula
normaliza para a mesma string vazia, então as duas casam.
`equipe_do_login(base, NULL, data)` devolvia a primeira equipe sem login
e roteava jornada para uma equipe qualquer, em silêncio. Ver D-070.

**Medir desempenho como owner mente igual a testar policy como owner.**
`produtividade_periodo` fazia 402 ms como dono e estourava o timeout como
`authenticated`, porque o RLS reavaliava as funções de escopo por linha.
E CTE com função de conjunto referenciada uma vez é *inline*: use
`as materialized`. Ver D-081.

**Só o cadastro roteia contrato para equipe, e cadastro sem AUTOR não é
cadastro.** O sistema não declara no lugar de quem opera — nem gravando
cadastro que ninguém digitou (D-079), nem roteando por dedução calada
(D-088), nem sugerindo o que o usuário só teria de clicar (D-089).
Login sem cadastro vai para a equipe **"Sem login definido"**, visível,
até alguém dizer de quem é. `equipe_do_login` lê **só**
`equipe_login_toa` com `criado_por is not null`: "estava lá antes" não
é prova de nada — a 039 preservou 9 seeds de migration achando que eram
declaração, e eles rotearam 121 contratos.

**Técnico se desliga, não se apaga.** DELETE em `tecnico`/`equipe` é só
para ADMIN (policy), e trigger recusa quem tem histórico — inclusive
para o ADMIN. A tela só oferece Desligar/Reativar, via
`mudar_situacao_tecnico`. Ver D-090.

**O TOA exporta em dois formatos, e os dois entram.** Diferem em uma
coluna: `Recurso`, o **nome** de quem estava logado — não o login, que
os dois trazem. Coluna a mais no começo não desloca nada, porque
`toa.ts` desduplica por posição e depois indexa por chave. `Recurso`
mora em `dados_origem` e é a resposta para "de quem é este login".
Ver D-091.

**`toISOString()` devolve a data em UTC.** Em Manaus (UTC−4) o dia vira
às 20h e a tela abre no dia seguinte, vazia. Use `isoLocal()` de
`lib/formato.ts`. Ver D-084.

**Objeto novo com conteúdo igual é re-render garantido.** O `supabase-js`
reemite a sessão a cada foco na aba; guardar o objeto no estado
remontava a aplicação inteira. Guarde o ID. Ver D-085.

**`tecnico.skill` não é rótulo: é a chave do dinheiro.** É por ela que
o técnico acha `meta_tecnico` e `faixa_comissao`. Gravar uma skill que
não tem faixa zera o "a receber" em silêncio. `SINGLE MASTER` foi
default nosso (037), não veio do TOA. Ver D-094.

**Códigos de baixa vêm com caixa inconsistente.** `409 - Servico
Concluido` e `409 - SERVICO CONCLUIDO` são o mesmo. Guardamos `codigo`
como inteiro; `extrai_codigo()` lê só o número do início.

## Estrutura

```
app/                     front-end (Vite + React + TS + Tailwind v4)
  src/lib/toa.ts         leitor da planilha do TOA (cabeçalho por posição)
  src/lib/planilha.ts    leitor genérico
  src/lib/metricas.ts    todo o cálculo do painel
  src/lib/relatorio.ts   colunas do relatório + o SELECT que as alimenta
  src/lib/eventos.ts     rótulos do histórico, iguais nas duas telas
  src/lib/tema.ts        tema claro/escuro — só do controle
  src/lib/supabase.ts    cliente + domínios de situação
  src/lib/auth.tsx       sessão, perfil e papéis
  src/components/        Shell (navegação), graficos (SVG puro), ui
  src/pages/             Login · Controle · Servicos · Equipes ·
                         Importacao · Campo · Visita
docs/                    mapeamento, domínio, decisões, mapa do concorrente
supabase/migrations/     schema, em ordem
```

**Gráficos são SVG escrito à mão**, sem biblioteca. Foi decisão: controle
de tema, bundle pequeno, nada para manter. Todo gráfico tem "Ver tabela".

## Duas linguagens visuais (D-011)

- **Controle** (COP/Controlador): escuro, denso. Passa horas na tela.
- **Campo** (Técnico): **claro**, espaçado, alvo de toque 48px. É usado
  no sol — tela clara é muito mais legível sob luz direta.

Classes `.sup-controle` / `.sup-campo` em `src/styles.css`.

## Como rodar

```bash
cd app && npm install && cp .env.example .env && npm run dev
```

Migrations: rodar em ordem no SQL Editor do Supabase, ou via MCP.
Sempre `npx tsc --noEmit` antes de commitar.

## Estado atual — 07/09/2026

> **Leia `docs/08-ESTADO-DO-PROJETO.md`.** Ele consolida tudo: números
> reais do banco, as 38 migrations, as 94 decisões, o que já corrigimos do
> sistema atual e o que está pendente. Este arquivo aqui é o *como
> trabalhar*; aquele é o *onde estamos*.

Resumo: **41 tabelas, 85 funções, 82 policies, zero tabela sem RLS**,
zero função `SECURITY DEFINER` alcançável pelo `anon`. 617 visitas,
736 O.S., 89 equipes, 104 técnicos, 18 praças, 168 códigos de baixa,
1.466 sub-falhas, 1.021 regras de pontuação. **Doze telas no ar.**

**A regra do dinheiro fechou** (D-077): `a receber = pontuação × fator`,
com o fator saindo da faixa do mês. Produtividade e comissão numa tela
só, com três dimensões, no lugar dos 16 relatórios do sistema atual.

O relatório saiu de 25/29 colunas para **72 (por contrato) e 87 (por
O.S.)**, com pontuação, e sai em Excel. O contrato tem **cadastro
manual**, edição e volta de situação. O histórico diz **quem** fez cada
etapa, com o login. O controle tem **tema claro**.

**A pontuação deixou de ser bloqueio** (D-045): a regra é combinação de
O.S. × edificação, derivada do relatório mensal, com 95,4% de cobertura.
O que falta é `pontos_equipe` — o que a equipe recebe —, que não está em
nenhum arquivo e depende do Emanuel levantar as Regras de Comissionamento.

**Antes de commitar mudança em RLS, papel ou permissão:**

```sql
select * from testar_policies();   -- 16 cenários, todos têm que passar
```

## Índice da documentação

| Arquivo | Para quê |
|---|---|
| `HANDOFF.md` | **comece por aqui** — passagem de bastão |
| `docs/08-ESTADO-DO-PROJETO.md` | inventário: números, migrations, pendências |
| `docs/03-DECISOES.md` | as 94 decisões, com o porquê de cada uma |
| `docs/01-MAPEAMENTO-DADOS.md` | o que vem do TOA e do ngestor |
| `docs/02-MODELO-DOMINIO.md` | entidades e máquina de estados |
| `docs/05-MAPA-TELAS-NGESTOR.md` | mapa do sistema concorrente |
| `docs/07-TELAS-DETALHADAS.md` | telas destrinchadas + 12 lacunas |
| `docs/06-PONTUACAO.md` | faturamento — **8 perguntas em aberto** |
| `docs/04-DESCOBERTA-AFLINE-360.md` | o outro Supabase, fora de escopo |
| `supabase/README.md` | ordem das migrations e conferências |
