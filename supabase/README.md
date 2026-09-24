# Banco — Supabase `AFLINE manager`

| | |
|---|---|
| Projeto | `kqfflkxjijzdtnfshdlv` |
| Região | `sa-east-1` (São Paulo — perto de Manaus, importa para o técnico no 4G) |
| Postgres | 17 |

**38 tabelas · 2 views · 55 funções · 74 policies · zero tabela sem RLS ·
zero função `SECURITY DEFINER` acessível ao `anon`.**

Desde a migration 029 existe **bateria de teste de policy**. Rode depois
de qualquer mudança em RLS, papel ou permissão:

```sql
select * from testar_policies();   -- esperado: passou = true em tudo
```

---

## ⚠ Leia antes de mexer: o banco é a fonte da verdade

**29 migrations estão aplicadas no Supabase.** A pasta `migrations/` tem
**22 delas**. As restantes (`007`, `009`, `016`, `017`, `019`, `021`,
`022`) foram aplicadas via MCP e não chegaram a virar arquivo local.

As de 023 a 029 têm arquivo local, mas ele é **consolidado**: o corpo de
função que foi criado e depois substituído aparece na versão final, com
NOTA apontando onde mudou. Rodar em ordem reproduz o estado.

Isto é uma dívida conhecida, não um esquecimento silencioso.

### Como sincronizar (jeito certo)

```bash
npx supabase login
npx supabase link --project-ref kqfflkxjijzdtnfshdlv
npx supabase db pull        # traz o schema aplicado para migrations/
```

### Como ver o que está aplicado, sem CLI

```sql
select version, name, array_to_string(statements, E'\n') as sql
from supabase_migrations.schema_migrations
order by version;
```

Essa tabela guarda o SQL completo de cada migration. Nada se perdeu.

### Os arquivos locais são consolidados, não espelho

Onde uma função foi criada e depois substituída, o arquivo local traz a
versão que faz sentido ler, com uma NOTA apontando onde ela é alterada
depois. Rodar `001` → `022` em ordem reproduz o estado; ler os arquivos
conta a história.

---

## As 56 migrations aplicadas

| # | O que faz | Arquivo local |
|---|---|---|
| 001 | Domínios: áreas, tipos de atividade (com natureza), tipos de serviço, tipos de O.S. | ✓ |
| 002 | 166 códigos de baixa da CLARO + classificação própria | ✓ |
| 003 | Base, perfil, papéis, equipe, técnico, carteira, funções de permissão | ✓ |
| 004 | Importação, **visita → ordem_servico**, evidência, equipamento, reincidência, auditoria | ✓ |
| 005 | RLS em todas as tabelas + view do técnico | ✓ |
| 006 | Helpers de leitura do JSONB do TOA | ✓ |
| 007 | Importador do TOA | — |
| 008 | Correção da trava D-006 | ✓ |
| 009 | Importador reconstruído | — |
| 010 | `SECURITY DEFINER` checa papel por dentro; `search_path` fixo | ✓ |
| 011 | Revoga `anon` nominalmente; `unaccent` sai do `public` | ✓ |
| 012 | Pseudo-códigos `-1` e `-2` do NETSMS | ✓ |
| 013 | Tempo de atribuição real do TOA | ✓ |
| 014 | Grupo de serviço derivado do cruzamento TOA × ngestor | ✓ |
| 015 | Cadastro de equipes | ✓ |
| 016 | Multi-tenant: empresa, 18 praças | — |
| 017 | RLS por tenant | — |
| 018 | Carimbo automático de empresa | ✓ |
| 019 | Isolamento por praça | — |
| 020 | Recursos fora do cadastro + `vw_equipe_resumo` | ✓ |
| 021 | Login TOA da equipe, com histórico por período | — |
| 022 | Sub-falha, histórico completo e transferência | — |
| 023 | Conjunto de sub-falha vigente (`definir_conjunto_sub_falha`) + `resumo_sub_falhas` | ✓ |
| 024 | `painel_equipes(data)`: contratos, períodos, situações e OCIOSO por dia | ✓ |
| 025 | Cadastro de situação, indicadores de qualidade e marcador no contrato | ✓ |
| 026 | Reatendimento (O.S. em N visitas), dupla baixa TOA×AFLINE, exclusão com motivo | ✓ |
| 027 | **Pontuação por combinação de O.S.** × edificação + log de alteração | ✓ |
| 028 | **Administração**: cargos, perfis de acesso, permissões e a trava de escalada (D-050) | ✓ |
| 029 | **Bateria de teste de policy** (16 cenários) + permissão fina nas RPCs | ✓ |
| 030 | **Histórico com autor** (`login`, `importacao_id`, evento por mudança de situação) + **cadastro manual** de contrato/O.S. + `reverter_situacao` | ✓ |
| 031 | SUPERVISOR passa a enxergar as equipes de que é supervisor | ✓ |
| 032 | `registrar_etapa` do técnico + escopo de equipe em `baixar_os` + leitura do histórico para quem enxerga a visita | ✓ |
| 033 | **Reincidência derivada do dado** (`detectar_reincidencia`), recalculada a cada importação aplicada | ✓ |
| 034 | **O login do TOA manda na equipe**: importador usa `equipe_do_login`, login único por base, `tecnico.foto_url` | ✓ |
| 035 | **Situação terminal exige todas as O.S. baixadas** (`exige_todas_baixadas`, `baixar_visita`) | ✓ |
| 036 | Equipe abrigo para login não cadastrado — **revertida pela 039** | ✗ |
| 037 | **Meta e comissão do técnico** + `produtividade_periodo` | ✓ |
| 038 | **A receber = pontuação × fator**, e a faixa por piso (sem buraco) | ✓ |
| 039 | Desfaz o cadastro de login deduzido (D-079) e o abrigo (D-080) | ✓ |
| 040 | Vínculo supervisor ↔ equipes e a etiqueta de origem do login | ✓ |
| 041 | **Login TOA no cadastro de acesso** — liga o login ao técnico (`tecnico.usuario_id`) | ✓ |
| 042 | **Só o cadastro roteia** — revoga o critério 3; equipe "Sem login definido"; tela para declarar | ✓ |
| 045 | **Skill do técnico** — domínio em tabela, `definir_skill_tecnico`; comissão deixa de ser fixa em SINGLE MASTER | ✓ |
| 044 | **O nome vem do TOA** — `logins_sem_cadastro` devolve o `Recurso` (nome de quem estava logado) | ✓ |
| 043 | **Sem autor não é cadastro** — `equipe_do_login` exige `criado_por`; desfaz os 9 seeds; DELETE de técnico/equipe só ADMIN e barrado por histórico; `mudar_situacao_tecnico` | ✓ |
| 046 | **O código decide a situação** — `codigo_baixa.situacao_destino` e o parâmetro `baixa_automatica` (D-097) | ✓ |
| 047 | **TEC1 — aderência à janela**, a regra lida do painel do Emanuel | ✓ |
| 048 | Excluir contratos em lote, sem atalho na regra | ✓ |
| 049 | **Exclusão definitiva** — DELETE com registro de auditoria | ✓ |
| 050 | **O status do TOA não conclui**; `finalizado_toa`; baixa automática ligada (D-103) | ✓ |
| 051 | Atividade **suspensa** não entra na importação | ✓ |
| 052 | **Produto pendente** lido da coluna `Produto` do TOA (D-107) | ✓ |
| 053 | O produto é **da O.S., pelo Ponto** — corrige o 052 | ✓ |
| 054 | **Rota do Dia** — `rota_do_dia`, `rota_bairros`, `rota_alertas` (D-111) | ✓ |
| 055 | **O campo no celular** — bucket `evidencia` + policies do Storage, `registrar_evidencia`, `registrar_equipamento`, `pode_anexar_na_visita`, `agenda_do_campo`, `hoje_local`, e as travas da baixa (D-112 a D-116) | ✓ |
| 056 | **`testar_campo()`** — 14 cenários das travas da 055, INVOKER (D-054) | ✓ |

> **A tabela acima para na 056.** As migrations 057 a 074 existem, estão
> aplicadas e estão no diretório — só não foram listadas aqui na época.
> **A pasta é o registro; o banco é o estado.** Antes de supor o que
> existe, consulte o banco (`list_migrations` pelo MCP).

As três últimas, para não repetir o esquecimento:

| # | O que faz | Aplicada |
|---|---|---|
| 072 | **Cancelada não é cinza** — alinha `situacao_visita.cor` ao padrão compilado do front (D-142) | ✓ |
| 073 | **O de/para do grupo vira cadastro** — `definir_grupo_do_tipo_os`, `catalogo_tipo_os`, procedência em `tipo_os` (D-143) | ✓ |
| 074 | **A equipe diz quando baixou e quanto fez** — última baixa com procedência, pontos do dia, e o filtro de dia que faltava em `evt` (D-145) | ✓ |
| 075 | **A rota entrega o que o controlador precisa** — `rota_do_dia` ganha `equipe_id` (para transferir), `tec1` (aderência do servidor) e `finalizado_toa` (D-147) | ✓ |
| 076 | **O cartão da rota mostra a baixa** — códigos das O.S. com procedência AFLINE/TOA e o detalhe das duas (D-147) | ✓ |
| 077 | **O almoxarifado nasce** — `equipamento` serializado, `estoque_posse`, `importar_estoque`, `estoque_posicao`, e as permissões do módulo (D-152) | ✓ |
| 078 | **O romaneio e a miscelânea** — `romaneio`/`romaneio_item`, `item_miscelanea`, o razão `miscelanea_movimento` e `confirmar_romaneio` (D-154) | ✓ |
| 077 | **Cada situação diz quantos pontos carrega** — `painel_equipes.situacoes` ganha `pontos`, `sem_regra` e `produtivas` (D-148) | ✓ |
| 078 | **A jornada acha o dono** — `toa_recurso` (o de/para que o TOA emite), `login_do_recurso`, `reconciliar_importacao`, e o catálogo aprende tipo novo com `conferir` (D-149) | ✓ |
| 079 | **A jornada aparece sem contar como contrato** — sai de `visitas`/`ordens`/`situacoes`/`periodos`/baixa e ganha `jornada jsonb`; entra na `rota_do_dia` com `ordem` nula (D-149) | ✓ |
| 080 | **O TEC1 é por O.S.** — `ordem_servico.tec1`, `tec1_da_os`, carência em `tipo_servico.tec1_carencia_min`; revoga a regra herdada do concorrente (D-150) | ✓ |
| 081 | **A equipe mostra a nota TEC1** — `painel_equipes.tec1`, sobre O.S. (D-150) | ✓ |
| 082 | **O TEC1 do painel sai do cache** — defeito meu: filtro por `visita.importacao_id` refrescava 1 de 30, e o painel lia cache enquanto a linha lia a regra (D-150) | ✓ |
| 083 | **A régua sabe o tipo, e a equipe mostra os tempos** — `periodos[].vt`, `min_deslocamento`, `min_execucao` (D-151) | ✓ |

> **A 075 e a 076 derrubam e recriam `rota_do_dia`, que é `SECURITY
> DEFINER`.** Coluna nova no `returns table` não passa por `create or
> replace`, e função recriada do zero nasce com a ACL aberta ao `anon`.
> Nas duas, o `revoke ... from public, anon` no fim é a diferença entre
> um painel de despacho e um vazamento. Conferido: `anon` não executa.

> **A 074, a 079, a 081, a 082 e a 083 derrubam e recriam
> `painel_equipes`; a 079 derruba também `rota_do_dia`.** Coluna nova no
> `returns table` não passa por `create or replace`, e função recriada
> do zero **nasce com a ACL aberta ao `anon`** — o `revoke`/`grant` no
> fim delas não é decoração (ver o par 059 → 061). Conferido depois de
> cada uma: `anon` não executa.

> **A 078 cria `toa_recurso`, e toda tabela nova precisa de RLS.** Ela
> nasce com `enable row level security` e duas policies (leitura pela
> empresa, escrita só ADMIN), no formato `(select minha_empresa())` —
> função de escopo solta é chamada por linha (D-118).

> **A 055 derruba e recria `baixar_os` e `baixar_visita`.** Assinatura com
> default não convive com a versão antiga: as duas casariam com uma
> chamada de argumentos nomeados, e o PostgREST recusa por ambiguidade.
> Se você reaplicar migrations antigas por cima, a 055 tem de rodar
> **depois** delas.

---

## Conferências obrigatórias depois de qualquer mudança

```sql
-- 1. nenhuma tabela pode ficar sem RLS
select tablename from pg_tables t
join pg_class c on c.relname = t.tablename
join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname
where t.schemaname = 'public' and not c.relrowsecurity;
-- esperado: zero linhas

-- 2. nenhuma funcao SECURITY DEFINER acessivel ao anon
select p.proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE');
-- esperado: zero linhas
-- NAO confie no lint do Supabase para isto: ele demora a atualizar.

-- 3. toda policy operacional filtra por tenant
select tablename, policyname from pg_policies
where schemaname = 'public'
  and tablename in ('visita','equipe','tecnico','perfil','base','importacao')
  and coalesce(qual,'') not like '%minha_empresa%'
  and coalesce(with_check,'') not like '%minha_empresa%'
  and coalesce(qual,'') not like '%auth.uid()%';
-- esperado: zero linhas

-- 4. norm_txt sobrevive ao unaccent fora do public
select norm_txt('  Instalação  de  Assinatura ');
-- esperado: INSTALACAO DE ASSINATURA

-- 5. a bateria de policy, sempre
select * from testar_policies();
-- esperado: passou = true nos 16 cenarios

-- 5b. e a bateria das travas do campo (055)
select * from testar_campo();
-- esperado: passou = true nos 14 cenarios
-- Ela cobre o que a 5 nao alcanca: as regras do campo nao sao policy,
-- sao guarda dentro de funcao SECURITY DEFINER, que ignora RLS por
-- definicao. As duas sao INVOKER de proposito (D-054).

-- 5c. as duas policies do Storage continuam de pe
select policyname from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'evidencia%';
-- esperado: evidencia_arquivo_ver, evidencia_arquivo_enviar
-- Nao ha policy de UPDATE nem de DELETE, e isso e proposital:
-- evidencia e prova (D-115).

-- 6. depois de DDL, o PostgREST precisa saber que a coluna existe
notify pgrst, 'reload schema';
-- sem isto o front recebe "failed to parse select parameter" numa
-- coluna que ESTA no banco. Ver Armadilhas.
```

---

## Armadilhas do Postgres/Supabase que já morderam

**`revoke ... from public` não remove concessão nominal.** O Supabase
concede `EXECUTE` explicitamente a `anon` em toda função criada no schema
`public`. Tem que ser `revoke ... from anon`.

**`CREATE OR REPLACE` preserva a ACL; função criada do zero, não.** Depois
de um `RENAME`, a nova função nasce aberta de novo. Sempre reconfira com
`has_function_privilege`.

**`SECURITY DEFINER` ignora o RLS.** Se a função faz algo privilegiado,
cheque o papel **dentro** dela — revogar do `anon` não impede um técnico
logado de chamar.

**`LIMIT` antes de `UNION ALL` é erro de sintaxe.** Precisa de parênteses
em cada ramo.

**Trigger de histórico dispara em `UPDATE` que você achou inofensivo.**
O `equipe_login_toa` duplicou quando espelhei o valor corrente. Índice
único resolveu.

**RLS não restringe COLUNA.** Uma policy de `UPDATE` liberada por linha
libera a linha inteira. `perfil_autoedicao` deixava qualquer usuário
trocar o próprio `perfil_acesso_id` e se dar todas as permissões. Quando
o alvo é uma coluna, o instrumento é trigger, não policy. Ver D-050.

**Função `SECURITY DEFINER` roda como o owner, que tem `BYPASSRLS`.**
Um teste de policy escrito como definer não testa policy nenhuma — todos
os cenários passam porque o RLS nem é consultado. Ver D-054.

**E medir desempenho como owner mente pelo mesmo motivo.**
`produtividade_periodo` fazia 402 ms como dono e **estourava o statement
timeout** como `authenticated`: o RLS reavaliava `minha_empresa()`,
`bases_visiveis()` e `equipes_visiveis()` a cada linha. Ver D-081.

**CTE com função que retorna conjunto é *inline* se referenciada uma vez**
— e a função passa a ser reexecutada por linha do join. `with x as
materialized (...)` obriga a rodar uma vez e guardar.

**`norm_txt(NULL)` devolve STRING VAZIA, não NULL.** E coluna de texto
nula normaliza para a mesma string vazia, então as duas "casam". Foi
assim que `equipe_do_login(base, NULL, data)` passou a devolver a
primeira equipe sem login cadastrado, roteando jornada para uma equipe
qualquer em silêncio. Ver D-070.

**O PostgREST tem cache de schema, e ele não sabe da sua coluna nova.**
Depois de `ALTER TABLE`, o front recebe `PGRST100 — failed to parse
select parameter` apontando para uma coluna que **está** no banco. Não é
erro de sintaxe do SELECT; é o cache. Resolve com:

```sql
notify pgrst, 'reload schema';
```

**Uma FK com UNIQUE vira relação um-para-um no PostgREST — e ele devolve
OBJETO, não array.** `reincidencia` tem `unique (visita_id)`, então
`reincidencia ( ... )` no select traz `{...}` ou `null`. O código que
fazia `reincidencia[0]` quebrava a tela inteira em `Cannot read
properties of null`. Trate os dois formatos.

**Duas FKs da mesma tabela para a mesma tabela deixam o embed ambíguo.**
`reincidencia` aponta para `visita` por `visita_id` **e** por
`visita_anterior_id`; o PostgREST responde `PGRST201` e recusa. Precisa
do nome da constraint:
`reincidencia!reincidencia_visita_id_fkey ( ... )`.

**`new Date().toISOString()` devolve a data em UTC, não a local.**
Manaus é UTC−4: às 22h do dia 7 o painel já abria no dia 8, vazio. Use
`isoLocal()` de `lib/formato.ts`. Ver D-084.

**O `supabase-js` remove TODO espaço em branco do `select`.** Se você
for testar um select pela API na unha (`curl`), replique isso — senão
você vai caçar um erro de sintaxe que só existe no seu teste.

**`usuario_papel.escopo` é `NOT NULL` sem default.** Esquecer dele faz o
usuário nascer sem papel: um login que entra e não enxerga nada, sem erro
visível. Ver D-052.

---

## Dados carregados (08/09/2026)

1 empresa · 18 praças · 107 equipes · 104 técnicos · **955 visitas** ·
**1.181 O.S.** · 168 códigos de baixa (todos com situação de destino) ·
**1.466 sub-falhas** · **546 combinações de O.S.** e **1.021 regras de
pontuação** · 5.505 itens de produto · 5 dias de dado (04 a 08/09/2026).

> **`tecnico.usuario_id` está em 0 de 104.** É o que falta para alguém
> conseguir usar o aplicativo do campo: sem o vínculo,
> `equipes_visiveis()` não devolve equipe nenhuma e a agenda vem vazia.
> Ver `docs/10-APP-DO-TECNICO.md`.
