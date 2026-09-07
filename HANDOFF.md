# Passagem de bastão — leia isto primeiro

Última atualização: **07/09/2026**, por Claude (Opus 5).

---

## Em três linhas

A **AFLINE** presta serviço para a **CLARO** em Manaus e mais 17 praças.
Hoje opera num sistema de terceiro, o **Alfa Gestor (ngestor)**, que ficou
caro. Este projeto é o substituto: recebe as ordens de serviço do **TOA
(Oracle Field Service)** da CLARO, despacha às equipes, recebe a execução
do campo, mede e pontua.

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
2. **`docs/08-ESTADO-DO-PROJETO.md`** — o inventário, com números do banco
3. **`docs/03-DECISOES.md`** — as 56 decisões e o porquê de cada uma
4. **`supabase/README.md`** — banco, conferências e dívida de migrations
5. **`docs/06-PONTUACAO.md`** — como a pontuação foi destravada, e o que sobrou

---

## As três regras que o Emanuel pediu

1. **Não invente regra de negócio. Pergunte.** Ele foi explícito:
   *"não crie nada que achar que é válido, sempre tire dúvida comigo."*
2. **Derive do dado real.** O de/para de grupo de serviço saiu do
   cruzamento de dois exports pela WO; a tabela de pontuação saiu do
   relatório mensal, medida. Faça igual.
3. **Documente a decisão e o porquê**, em `docs/03-DECISOES.md`.

---

## Antes de commitar qualquer coisa

```bash
cd app && npx tsc --noEmit && npm run build
```

```sql
-- 1. bateria de policy: 16 cenários, todos têm que passar
select * from testar_policies();

-- 2. nenhuma tabela sem RLS
select tablename from pg_tables t
join pg_class c on c.relname = t.tablename
join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname
where t.schemaname = 'public' and not c.relrowsecurity;

-- 3. nenhuma funcao SECURITY DEFINER alcancavel pelo anon
select p.proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE');
```

As três devem voltar limpas. **Não confie no lint do Supabase** para a
terceira: ele demora a atualizar.

---

## O que está pronto e testado

**Banco:** 38 tabelas, 62 funções, 74 policies, zero tabela sem RLS, zero
`SECURITY DEFINER` alcançável pelo `anon`, bateria de policy verde (16/16).

**Onze telas**, todas verificadas com dado real:

| Rota | Estado |
|---|---|
| `/entrar` | login |
| `/controle` | painel: cartões de situação, volume × pontos, improdutivas por responsabilidade |
| `/controle/servicos` | 9 filtros, duas densidades, cor por situação, botão direito, contrato em janela, **+ Nova O.S.** |
| `/controle/equipes` | painel por dia: períodos, situações, OCIOSO, contratos por equipe |
| `/controle/relatorios` | por contrato (**72 colunas**) e por O.S. (**87**), com **pontuação** e **serviço anterior**, Excel e CSV |
| `/controle/importar` | importação do TOA com prévia e histórico |
| `/controle/sub-falhas` | importa os conjuntos da CLARO e escolhe o vigente |
| `/controle/configuracoes` | status, indicadores de qualidade e tabela de pontuação |
| `/controle/administracao` | usuários, cargos, perfis de acesso e permissões |
| `/controle/visita/:id` | detalhe completo, histórico **com login**, transferência |
| `/campo` e `/campo/visita/:id` | agenda e execução: a caminho → cheguei → baixa com sub-falha → impedimento com observação → finalizar, e o passo a passo **com o login** |

**Dados:** 551 visitas, 652 O.S., 89 equipes, 104 técnicos, 18 praças,
168 códigos de baixa, 1.466 sub-falhas, 1.021 regras de pontuação.
Três dias: 04, 05 e 06/09/2026.

**Também no ar:** tema claro no controle (o campo continua claro sempre,
por condição de trabalho — D-011/D-065) e
`app/scripts/criar-usuarios-teste.mjs`, que cria os três logins de teste
(controlador, supervisor, técnico) e faz os vínculos que a tela de
Administração não faz. Ver D-067.

---

## O que descobrimos, e que mudou o modelo

Isto é o mais importante desta passagem de bastão. Cada item saiu de
**medir dado real**, não de suposição.

### 1. O mesmo contrato é atendido mais de uma vez (D-041)

No relatório mensal do ngestor (17.987 linhas): **2.656 contratos
aparecem com mais de um ID**, e 536 no mesmo dia. Quebrou de manhã, o
cliente reagendou, foi de novo à tarde — dois atendimentos, dois
deslocamentos, duas baixas, e o TOA emite **WO nova**.

Nosso modelo já acertava (`visita.toa_atividade_id` é o atendimento). O
errado era **um índice único** em `numero_os`, que fazia 8 visitas
entrarem sem as O.S., em silêncio.

### 2. São dois códigos de baixa, e eles divergem (D-042)

`Cod. Baixa Operadora` (TOA) e `Código De Baixa` (ngestor) convivem em
**13.021 linhas**, e discordam com frequência: TOA 425 → 409, TOA 312 →
106. **A da AFLINE é a que manda no comissionamento.**

### 3. A pontuação é combinação de O.S. × edificação (D-045)

Medido: tirar tipo de pessoa da chave **não muda nada** (94,1% contra
94,2%); tirar edificação piora nove pontos. Das 105 combinações presentes
em casa e apartamento, **43 mudam de valor**; das 43 presentes em física
e jurídica, só 5.

> Isso destravou a pontuação. A dimensão que faltava na nossa fonte —
> tipo de pessoa — era justamente a que menos importa.

### 4. Havia uma escalada de privilégio aberta (D-050)

`perfil_autoedicao` liberava `UPDATE` onde `id = auth.uid()`, para a
pessoa arrumar o próprio telefone. **RLS não restringe coluna:** com ela,
qualquer usuário podia trocar o próprio `perfil_acesso_id` e se dar todas
as permissões. Passou 27 migrations despercebido porque só existia um
usuário, e ele era ADMIN.

### 5. O arquivo de sub-falhas é largo, não longo (D-032)

Uma linha por código, com `Subfalha 1..7` em colunas. Lido como longo,
traria 147 pares em vez de 938 — e a conta fecharia sozinha, sem erro.

---

## O que está parado, e por quê

| O quê | Por quê |
|---|---|
| **`pontos_equipe`** | O que a equipe recebe **não está em nenhum arquivo que temos** — o relatório do ngestor só traz o que a CLARO paga. Depende do Emanuel abrir **Regras de Comissionamento** e dizer se é valor próprio por combinação, percentual sobre o faturado, ou fator. Sem ele não há margem por atendimento nem comissão. |
| **Vincular supervisor ao usuário** | `equipe.supervisor_id` está em **0 de 89**. Enquanto ficar assim, o papel SUPERVISOR entra e não enxerga nada — o caminho no RLS já existe desde a 031, falta o dado. `supervisor_nome` (85 de 89) é texto do TOA e não serve de chave. **Depende do Emanuel.** |
| **Formato do número de O.S. manual** | Geramos `AF-00000001` para não colidir com os 10 dígitos da CLARO. Formato escolhido por nós, não observado no dado — **confirmar com o Emanuel**. |
| **"Data de Abertura"** | A tela do sistema atual tem o campo; a planilha do TOA não traz nada equivalente. Não criamos a coluna: daria 100% de vazio no que é importado. Se a CLARO expuser a data em algum lugar, vira coluna de verdade. |
| **ITEM / CONSOLID / VALOR na O.S.** | O detalhe do sistema atual tem essas três colunas, e elas são a **LPU** — o tipo de O.S. consolidado que é faturado. Continua **não modelado** (ver Vocabulário no `CLAUDE.md`); não inventamos rateio de pontos por O.S. |
| **Abas de equipamento na baixa** | Dependem do almoxarifado, que não existe. Sem cadastro de serial e movimento, seriam campo de texto fingindo ser controle de estoque. |
| **Miscelânea** | Não sabemos o que é. No export do ngestor é 100% "Não" em 454 registros — parece funcionalidade morta. |
| **Marcador exigido por tipo de serviço** | Não foi combinado quais indicadores são obrigatórios em cada grupo. |
| **`equipe.skill`** | O sistema atual mostra "SINGLE MASTER"; não modelamos porque não sabemos o domínio. |
| **34 regras de pontuação marcadas `CONFERIR`** | O relatório traz mais de um valor para a mesma chave — provavelmente tabela de preço diferente. |
| **448 regras coringa** | Copiam a de CASA quando o endereço não diz a edificação. É o palpite menos ruim, não o dado. |

---

## Dívidas conhecidas

| Dívida | Onde |
|---|---|
| 7 migrations aplicadas sem arquivo local (`007`, `009`, `016`, `017`, `019`, `021`, `022`) | `supabase/README.md` explica como sincronizar |
| Permissão fina só nas RPCs, não nas 74 policies | decisão consciente, D-055 — o custo em toda linha não compensa |
| Estoque, frota, produtividade, aferição | não iniciados |
| 3 tabelas sem RLS **no outro Supabase**, uma com 183 nomes de técnico | levantado em 04/09, decisão do Emanuel, pendente |

---

## Erros que eu cometi — para você não repetir

**Achei que `Login do Técnico` no TOA era matrícula de pessoa.** É o
recurso da **EQUIPE** — a AFLINE trabalha em dupla. Cheguei a acusar 5
técnicos de "trabalhar sem cadastro"; três eram login de equipe. Pior: o
login **muda de dono**, então guardar só o valor corrente corromperia a
produtividade histórica. Resolvido com `equipe_login_toa` e período.

**Escrevi um teste de policy como `SECURITY DEFINER`.** Definer roda como
o owner, que tem `BYPASSRLS` — todos os 16 cenários "passavam" sem o RLS
ser consultado uma vez sequer. Um teste que roda como superusuário é pior
que nenhum: dá confiança falsa. A versão certa é INVOKER com
`set local role authenticated`.

**Usei `visita.situacao_em` como hora de encerramento.** Numa visita
cancelada ele é a hora da IMPORTAÇÃO — a "última atividade" da equipe
virou 06/09 03:34 para metade da operação. Só vale `fim`, ou
`situacao_em` quando `bloqueado_em` existe.

**Tentei medir "fila" a partir de `visita.criado_em`.** É a hora da
importação. Deu 0 min. Da atribuição do TOA deu 878 min — a noite
inteira, já que a atribuição roda 00:23 e o técnico começa 08:00. A
métrica útil acabou sendo **aderência à janela**.

**Armei a trava do D-006 no INSERT.** Visita que chegava concluída do TOA
nascia travada e o TOA nunca mais a corrigia. A trava tem que significar
"o campo tocou nisto", e só isso.

**Esqueci `usuario_papel.escopo` no `definir_papeis`.** É `NOT NULL` sem
default: o insert morria e o usuário nascia **sem papel nenhum** — um
login que entra e não vê nada, sem erro visível.

**Confiei no lint do Supabase para segurança.** Só a consulta a
`has_function_privilege` mostrou a verdade.

**Achei que a tela do campo podia dizer quem fez a etapa.** Ela mandava
`usuario_id` no INSERT do evento. Autor que vem do cliente não é prova de
nada — e o histórico existe para ser prova. Quem carimba é o servidor,
em `registrar_etapa` e `baixar_os` (D-061).

**Tratei `reincidencia` como array no relatório.** Ela tem
`unique (visita_id)`, então o PostgREST a trata como um-para-um e devolve
**objeto ou null**. `reincidencia[0]` derrubou a tela inteira de
Relatórios com `Cannot read properties of null`.

**Culpei o meu SELECT por um erro que era cache.** Depois de `ALTER
TABLE`, o PostgREST responde `failed to parse select parameter` numa
coluna que **está** no banco. É o cache de schema: `notify pgrst,
'reload schema'`.

**Testei o SELECT na unha com espaços.** O `supabase-js` remove **todo**
espaço em branco do `select` antes de enviar. Meu `curl` de teste
reproduzia um erro que o app nunca teria.

> O padrão: **pergunte ao banco, não à ferramenta que resume o banco.**
