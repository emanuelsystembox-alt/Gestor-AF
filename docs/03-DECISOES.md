# Decisões do Projeto (log)

Cada decisão vale até ser revogada explicitamente.

## 2026-09-04 — Rodada 1

### D-001 · Unidade de trabalho = VISITA, com O.S. dentro
Estrutura `atividade (visita)` **1→N** `ordem_servico`.
Deslocamento, tempo e produtividade contam por visita.
Baixa, tipo e faturamento contam por O.S.
> Corrige o achatamento do ngestor, que conta deslocamento em dobro
> quando há 2 O.S. no mesmo endereço (o caso mais comum: 127 de 349).

### D-002 · Login INDIVIDUAL por técnico
Fim do `203@afline.com.br` compartilhado.
Toda foto, check-in, baixa e material fica atribuído a uma pessoa.
Habilita produtividade individual e auditoria real.
> Implica definir como técnico se relaciona com equipe → ver D-005.

### D-003 · Monitor = Controlador (mesmo papel)
O campo `Monitor` do ngestor é o Controlador. O prefixo "SUPERVISOR -"
no texto é bagunça de cadastro, não hierarquia.
Hierarquia: **COP** (visão global) → **Controlador** (carteira).

### D-004 · Importação TOA acontece VÁRIAS VEZES AO DIA
Consequência técnica pesada: a importação **não pode ser append**.
Precisa de `UPSERT` com chave estável e resolução de conflito.
- Chave da visita: `ID da Atividade` (TOA)
- Chave da O.S.: `Número da O.S`
- Guardar sempre o arquivo original + linha crua (JSONB)
> Ver D-006 para a regra de quem vence no conflito.

## 2026-09-04 — Rodada 2

### D-005 · Atribuição para a EQUIPE, com técnico responsável
Visita → `equipe_id` (todos da equipe enxergam) + `tecnico_responsavel_id`.
Cada ação individual (check-in, foto, baixa) grava o `tecnico_id` de quem fez.

### D-006 · Em conflito, o operacional VENCE o TOA
Reimportação atualiza apenas **dado cadastral**: endereço, telefone,
agendamento, segmentação, contrato, coordenadas.
**Nunca sobrescreve:** status, código de baixa, fotos, check-in, materiais,
observações — nada que tenha origem no campo.
Campos protegidos ficam travados a partir do primeiro registro de execução.

### D-007 · Técnico NÃO vê
- visitas de outras equipes
- qualquer valor financeiro (pontuação, custo, faturamento)
- avaliação de qualidade sobre ele (Aferição / Sub-Falha / Avaliado Por)

**Técnico VÊ** o histórico de reincidência do cliente (SERVIÇO-ANTERIOR) —
chega sabendo que já houve visita ali e com que baixa fechou.

### D-008 · SEM modo offline
Sistema online. Reduz muito o escopo e o prazo.
> Mitigação barata: a agenda do dia fica em cache no navegador e o envio de
> foto tem retry automático. Isso cobre a queda momentânea sem custo de
> sincronização bidirecional.

## 2026-09-04 — Rodada 3

### D-009 · Consumo de material por O.S. — funcionalidade NOVA
Hoje não existe: o almoxarifado só faz inventário geral, sem amarrar consumo
à ordem de serviço. Não estamos replicando nada aqui, estamos criando.
Entra na Fase 2. Modelar desde já como movimento (saldo = soma), nunca campo editável.

### D-010 · Abastecimento por cartão/vale, com foto do cupom
Campos: hodômetro, litros, valor, posto, foto, técnico.
Habilita detecção de anomalia: hodômetro retrocedendo, consumo fora da curva
do próprio veículo, dois abastecimentos no mesmo dia. Fase 2.

### D-011 · Duas linguagens visuais na mesma marca
- **Controle (COP/Controlador):** densa, tipo torre de controle. Muita
  informação por tela, tabelas, atalhos de teclado.
- **Campo (Técnico):** espaçada, botões grandes, alto contraste (uso no sol),
  poucos toques, uma mão.

### D-012 · MVP = núcleo de O.S.
Importação TOA → Controlador despacha e acompanha → Técnico executa e dá baixa.
É o que substitui o ngestor no dia a dia. Frota e almoxarifado na Fase 2.

## 2026-09-04 — Execução (banco AFLINE manager)

### D-013 · A planilha do TOA tem cabeçalhos repetidos
`Tipo de Atividade` aparece nos índices 19 e 20; `Janela de Serviço` nos 10 e 11.
- índice 19 = categoria (`Normal`)
- índice 20 = tipo real (`Instalacao`, `Refeicao`...)

Parser que converte para JSON **pela chave** perde a primeira coluna sem erro
nenhum. O front-end desduplica **por posição**, gerando `Tipo de Atividade` e
`Tipo de Atividade__2`. O importador lê `__2`.
> Esse é o tipo de bug que roda meses sem ninguém notar.

### D-014 · A trava do D-006 só arma em ação de CAMPO
Primeira versão armava também no INSERT. Resultado: visita que chegava do TOA
já concluída nascia travada, e o TOA nunca mais conseguia corrigi-la — a
proteção virava ruído.

Corrigido: o trigger só arma em `UPDATE`, só quando a situação realmente muda,
e nunca quando o autor é o importador (que se identifica com
`set_config('app.origem','IMPORTACAO')`).

**Trava = "o campo tocou nisto".** Nada além disso.

### Estado do banco `AFLINE manager` (kqfflkxjijzdtnfshdlv, sa-east-1)
9 migrations aplicadas. 21 tabelas, todas com RLS. 166 códigos de baixa.

Testado com dados reais de 04/09/2026 (15 visitas / 23 O.S.):

| Teste | Resultado |
|---|---|
| Importação inicial | 15 criadas, 23 O.S., **0 erros** |
| Reimportação (D-004) | 0 criadas, 15 atualizadas — **não duplicou** |
| Campo vence TOA (D-006) | nosso `REAGENDAMENTO` preservado; TOA dizia `concluído`; **1 alerta registrado** |
| Códigos 409 maiúsc./minúsc. (D1) | as 13 O.S. apontam para **o mesmo** registro |
| Jornada separada de produção | 12 PRODUTIVA / 3 JORNADA |
| Coordenadas X↔Y | lat −3.06 / lng −60.08 — **corretas para Manaus** |
| Fuso horário | `08:03` grava e lê como 08:03 em Manaus |

> Há 15 visitas de teste no banco. Para limpar:
> `delete from importacao where id = '11111111-1111-1111-1111-111111111111';`
> (as visitas caem junto por cascade)

## 2026-09-05 — Endurecimento de segurança

### D-015 · `SECURITY DEFINER` exige checagem de papel POR DENTRO
`importar_toa` ignora o RLS por definição. Revogar acesso do `anon` não
resolvia: qualquer usuário logado — **inclusive um técnico** — poderia
disparar a importação da planilha.

Solução: a implementação virou `importar_toa_interno`, fora do alcance da
API. A porta de entrada `importar_toa` confere `eh_gestor() or
tem_papel('CONTROLADOR')` antes de delegar.

### D-016 · `revoke from public` NÃO remove concessão nominal
O Supabase concede `EXECUTE` **nominalmente** a `anon` e `authenticated` em
toda função criada no schema `public`. `revoke ... from public` não mexe
nisso — tem que ser `revoke ... from anon`.

Detalhe que me enganou: **`CREATE OR REPLACE` preserva a ACL**, mas função
criada do zero (depois de um `RENAME`, por exemplo) recebe as concessões
padrão de novo. Foi assim que o `importar_toa` voltou a ficar aberto ao
`anon` mesmo depois de eu ter revogado.

> Regra para o time: depois de mexer em função, **não confie no lint** —
> pergunte ao banco com `has_function_privilege('anon', oid, 'EXECUTE')`.

### D-017 · `search_path` fixo em toda função
Sem isso, um schema malicioso no caminho pode sequestrar a resolução de
nomes dentro da função. `unaccent` também saiu do `public` para o schema
`extensions`, e o `norm_txt` passou a declarar os dois no `search_path`.

### Pendência do Emanuel (não é código)
**Proteção contra senha vazada está desligada.** O Supabase pode conferir
toda senha nova contra o HaveIBeenPwned. Ligar em:
*Authentication → Policies → Password protection*.
Com técnico usando senha simples em campo, isso vale muito.

## 2026-09-06 — Multi-tenant

### D-019 · O sistema nasce MULTI-EMPRESA, não só multi-praça
O Emanuel pretende vender o sistema para outras credenciadas. São coisas
diferentes:

- **multi-praça**: a AFLINE em 18 cidades (São Luís, Belém, Palmas…)
- **multi-tenant**: a AFLINE **e** a ENGETEC no mesmo banco, sem nunca
  enxergarem uma linha da outra

Hierarquia: `empresa` → `base` (praça) → `equipe` → `técnico`.

Feito agora, com 470 visitas, custou uma migration. Adiado, custaria um
projeto — e uma migração de dado com risco de vazamento entre clientes.

**O furo que isso fechou.** As policies diziam
`eh_gestor() or equipe_id in (select equipes_visiveis())`, e `eh_gestor()`
só olha o **papel**. Um ADMIN de outra credenciada passaria por esse `or`
e leria a operação inteira da AFLINE. Agora **toda policy começa por
`empresa_id = minha_empresa()`**: o papel decide o que a pessoa faz
dentro da própria empresa, nunca se ela atravessa a fronteira.

Conferido por consulta, não no olho: zero policies sem filtro de tenant
nas tabelas operacionais.

**Domínios são compartilhados.** `tipo_os`, `codigo_baixa`,
`tipo_atividade` etc. têm `empresa_id` nulo = catálogo da CLARO, vale
para todos. Se uma empresa precisar do seu próprio, basta uma linha com
o `empresa_id` dela. Não duplicamos 166 códigos por cliente.

**A empresa nunca é digitada.** Trigger `carimba_empresa()` deriva de
`base_id` no INSERT. Nenhum caminho — importador, tela ou script —
consegue gravar sem tenant, e ninguém precisa lembrar de preencher.

### D-020 · Comissão vem de Regras de Comissionamento, por fatores
Confirmado pelo Emanuel: a comissão da equipe **não** está na tabela de
pontuação. Vem do menu *Regras de Comissionamento*, aplicada por
**fatores**. Ainda não levantado — ver `docs/06-PONTUACAO.md`.

## 2026-09-06 — Isolamento por praça e cadastro importado

### D-021 · Isolamento é em DOIS cercos concêntricos
Regra do Emanuel: *"time de uma cidade não pode ver outra cidade"*.
O isolamento por empresa (D-019) não cobre isso — um controlador de
Manaus e um de São Luís são da **mesma** empresa.

Toda policy agora passa por:
1. `empresa_id = minha_empresa()` — não vê outra credenciada
2. `base_id in (bases_visiveis())` — não vê outra praça

`bases_visiveis()`: quem tem papel com escopo `GLOBAL` enxerga todas as
praças **da própria empresa**; os demais veem `perfil.base_id` mais o que
estiver em `usuario_base` (para supervisor regional e cobertura de férias).

### D-022 · Cadastro importado: 89 equipes, 104 técnicos, 5 supervisores
A planilha tinha 604 linhas, mas só 103 preenchidas — o resto era vazio.
Todas de Manaus. Zero equipes sem área.

Das 470 visitas, 298 ficaram com equipe. As 172 restantes se explicam:
- **124** são jornada (`Na Base`, `Refeição`) **sem login** no TOA —
  corretamente sem equipe
- **48** são de **5 técnicos que trabalham em campo mas não estão na
  planilha**: `Z687967` `Z688266` `Z689678` `Z690579` `Z690580`

### D-023 · Cadastro que envelhece vira aviso, não silêncio
A planilha de equipes desatualiza: técnico contratado depois dela aparece
executando no TOA sem estar cadastrado, e o sistema atual simplesmente
mostra "sem equipe".

A tela de Equipes agora abre com um aviso listando quem está nessa
situação, quantas visitas fez, em que período e **em qual área** — e um
botão que cadastra e religa as visitas dele num clique.

> É o tipo de diferença que o Emanuel pediu: não é a mesma tela mais
> bonita, é a tela respondendo uma pergunta que a outra não faz.

## 2026-09-06 — Correção: o login do TOA é da EQUIPE

### D-024 · Eu estava errado sobre os "técnicos fora do cadastro"
Ontem apontei 5 matrículas como técnicos trabalhando sem cadastro. As
capturas da tela de Equipes mostraram que **três delas são o Login TOA das
equipes 001, 004 e 010**.

No OFSC o "recurso" é a EQUIPE, não a pessoa — a AFLINE trabalha em dupla
e quem loga é a equipe. O campo se chama `Login do Técnico`, o que induz
ao erro; o `ID do Recurso` na mesma planilha é o mesmo para a dupla.

Funcionou para 298 visitas porque, na maioria das equipes, o login da
equipe **é** o login do técnico líder. As 5 exceções eram logins novos,
criados depois da planilha de equipes.

### D-025 · O login do TOA MUDA de equipe ao longo do tempo
`Equipes.xlsx` diz que a equipe 001 usa `Z565249`. A tela de hoje mostra
`Z688266`. Guardar só o valor corrente corromperia o histórico em
silêncio: uma visita de agosto seria atribuída à equipe que usa aquele
login **hoje**, e a produtividade passada mudaria sozinha.

Modelado com `equipe_login_toa (equipe, login, inicio, fim)`. A resolução
`equipe_do_login(base, login, data)` tenta, nesta ordem:
1. histórico válido **naquela data**
2. login corrente da equipe
3. matrícula de técnico (quando o recurso é pessoal)

Resultado: visitas com equipe subiram de 298 para **339**. Restou um
único login sem dono, `Z690579`, e as 124 de jornada sem login — que
corretamente não têm equipe.

> Lição para o repositório: quando um identificador externo pode trocar de
> dono, guardar só o valor atual é bug de dado, não simplificação.

### D-026 · OCIOSO = 10 min após concluir, sem novo status
Definição do Emanuel: a equipe entra em **OCIOSO** quando passam
**10 minutos** desde a conclusão do contrato anterior **sem que ela
registre novo status**.

Consequências para o modelo:
- é **derivado**, não armazenado: `now() - último evento da equipe > 10 min`
  **e** a última situação registrada é terminal (concluída/cancelada)
- o parâmetro `10` vira configuração por empresa, não número no código —
  outra credenciada pode operar com outro tempo
- exige o **último evento por equipe**, não por visita: uma equipe pode ter
  concluído a visita A e ainda não ter tocado a B

## 2026-09-06 — Detalhe do contrato

### D-027 · Sub-falha é o segundo nível da causa
O código de baixa diz *o quê* (`107 - Entrada Não Autorizada`); a
sub-falha diz *por quê* (`RESTRIÇÃO HORÁRIO CONDOMÍNIO`). Sem ela, a
improdutiva vira estatística sem tratativa possível.

Fonte: `CONSOLIDADO_SUBFALHAS_CLARO_2026.xlsx`, que traz **dois
conjuntos**:
- `CASO 1` — 114 códigos, 534 pares
- `NÍVEL HARD` — 155 códigos, 933 pares, 17 categorias

Guardamos os dois com rótulo de conjunto e `empresa.conjunto_sub_falha`
marca qual vale. **A escolha é do Emanuel, não minha.**

### D-028 · O histórico carimba a EQUIPE do momento
`visita_evento.equipe_id` é preenchido por trigger com a equipe corrente
da visita. É o que permite reconstruir uma transferência: o histórico
mostra `014 → 001`, como no sistema atual.

`transferir_visita()` registra origem, destino, quem transferiu e o
motivo — e grava o evento com a equipe **antiga**, porque era ela a
responsável naquele instante.

### D-029 · Carregamento sob demanda por causa do técnico
O pacote inicial tinha 254 kB comprimidos, dos quais 143 kB eram a
biblioteca de planilha — que só as telas de importação usam e o técnico
**nunca** abre.

Passou a ser carregada sob demanda, e cada tela virou um pedaço próprio.
Carga inicial caiu para **115 kB** (−55%). O app do técnico agora são
1,65 kB (agenda) e 3,08 kB (execução) sobre o núcleo.

> Decisão tomada pensando em quem usa 4G em campo, não em métrica de
> build. Sem modo offline (D-008), o tamanho do primeiro carregamento é o
> que separa "abriu" de "não abriu".

## 2026-09-06 (tarde) — Sub-falhas e a fonte do cliente

### D-030 · A dependência do ngestor é aceita, e é permanente
Três caminhos estavam em aberto para trazer `Tipo de pessoa` e
`Edificação` — as duas dimensões da regra de pontuação que o export do
TOA não entrega. O Emanuel decidiu:

- **Caminho 1, escolhido:** importar também o export do ngestor, cruzando
  pela **WO**. Ele foi explícito sobre o motivo: *"sempre haverá essa
  dependência; o que tentamos fazer é espelhar o sistema da CLARO, que é
  muito engessado para o nosso time"*. O objetivo do projeto nunca foi
  cortar a fonte — é deixar de pagar pela camada operacional e ter uma
  tela que a operação consiga usar.
- **Caminho 2, descartado por ora:** buscar a origem real (NETSMS ou
  outra extração da CLARO). *"Isso não vai acontecer por enquanto."*
- **Caminho 3, complementar:** o técnico informa a edificação em campo.
  Continua valendo como complemento, nunca como fonte.

> Consequência de projeto: o importador do ngestor deixa de ser
> contingência e vira **entrada de primeira classe**, com tela própria,
> do mesmo jeito que a do TOA. E o modelo precisa registrar de qual fonte
> veio cada campo do cliente — senão ninguém sabe se um `Tipo de pessoa`
> vazio é falta de dado ou falta de importação.

### D-031 · A tela de sub-falhas não escolhe o conjunto por ninguém
O arquivo da CLARO traz `CASO 1` e `NÍVEL HARD` (D-027). A tela importa
os dois, mostra o que cada um cobre — pares, códigos, categorias, e
quantos códigos não existem na nossa tabela — e a escolha do vigente é um
botão, gravado em `empresa.conjunto_sub_falha` pela RPC
`definir_conjunto_sub_falha()`.

Duas consequências técnicas:

- `empresa` só tem policy de `SELECT`. É de propósito: empresa não é
  cadastro que o operador edite pelo PostgREST. A escolha então passa por
  função com checagem de papel, não por `update` direto.
- O **mapeamento de colunas é manual**, com palpite a partir do
  cabeçalho. O arquivo é da CLARO e o cabeçalho muda sem aviso; adivinhar
  em silêncio é exatamente como se perde uma coluna sem ninguém notar
  (o mesmo risco do D-013, no leitor do TOA).

Sub-falha com código que ainda não existe em `codigo_baixa` entra assim
mesmo, sem vínculo, e a tela conta quantas são. Não é erro: é a CLARO
tendo código que ainda não apareceu na nossa operação.

## 2026-09-06 (noite) — Sub-falhas no banco, Equipes por dia, Serviços mais densa

### D-032 · O arquivo de sub-falhas da CLARO é LARGO, não longo
`CONSOLIDADO_SUBFALHAS_CLARO_2026*.xlsx` tem **uma linha por código**,
com as sub-falhas espalhadas em colunas `Subfalha 1..7`:

```
Categoria     | Código | Descrição                | Subfalha 1 | … | Subfalha 7
IMPRODUTIVOS  | 100    | Agendamento Não Cumprido | Atraso…    | … |
```

Um leitor "uma linha = um par" traz **147 pares em vez de 938** — e a
conta fecha sozinha, sem erro na tela. Por isso o importador desempilha
as colunas (a posição vira `ordem`) e a tela deixa escolher o formato,
com o largo detectado pelo cabeçalho.

`Descrição` é a descrição do **código**, não da sub-falha. Não é
importada — já vive em `codigo_baixa`. Aparece na prévia só para quem
confere não trocar uma pela outra.

**Arquivo usado:** `CONSOLIDADO_SUBFALHAS_CLARO_2026_1_0_REVISADO_OFICIAL.xlsx`,
de `Documentos/API - CADASTRO SUBFALHAS NGESTOR`. É o mais completo dos
quatro que existem na máquina: só ele tem `Subfalha 7` no NÍVEL HARD
(938 pares contra 933 das outras cópias) e está todo em maiúsculo, o que
evita a duplicação por caixa que a D1 já documentou nos códigos de baixa.

Resultado: **CASO 1** com 528 pares / 115 códigos / 11 categorias e
**NÍVEL HARD** com 938 pares / 155 códigos / 17 categorias. Nenhum código
ficou sem vínculo com `codigo_baixa`. **Qual dos dois vale ainda é
escolha do Emanuel** — os dois estão no banco, nenhum marcado.

### D-033 · OCIOSO derivado do que existe, e só para o dia corrente
A regra do D-026 pede o **último evento por equipe**. Hoje
`visita_evento` só tem `IMPORTADA` e `CONFLITO_TOA`, com `equipe_id`
nulo: o campo ainda não registrou nada por aqui.

`painel_equipes()` então usa o maior entre:
- `visita.fim` — o encerramento real, vindo do TOA
- `visita.situacao_em`, **mas só quando `bloqueado_em` existe**, isto é,
  quando o campo tocou na visita (D-006)
- `visita_evento.criado_em` da equipe, quando houver

`situacao_em` puro **não serve**: numa visita cancelada ele é a hora da
importação. Na primeira versão isso deu "última atividade 06/09 03:34"
para metade da operação — a mesma armadilha do `criado_em` que o
CLAUDE.md já documenta. A correção mudou os números para 17:40, 18:03,
18:48 — fim de turno, que é o esperado.

E `ocioso` só é calculado para o **dia corrente**. Ocioso é estado de
agora; para um dia passado a resposta seria "todo mundo ocioso há dois
dias", que não informa nada. Em dia passado a coluna mostra a hora da
última atividade e a situação com que a equipe parou.

### D-034 · Toda tela de operação abre no último dia COM dado
`vw_equipe_resumo` usava `CURRENT_DATE`. Com importação de 04 e 05/09 e
o relógio em 06/09, a tela de Equipes devolvia zero para tudo — parecia
vazia sem estar errada. Serviços tinha o mesmo problema: abria em "hoje".

Agora as duas descobrem o último dia com visita e abrem nele, com a data
no topo para trocar. O sistema atual faz o mesmo, com "DATA DA SITUAÇÃO".

Efeito colateral que virou regra: **inicializar o estado com "hoje" e
corrigir depois dispara dois carregamentos concorrentes**, e o mais velho
pode chegar por último. A data começa vazia, e cada carregamento carimba
um número — resposta de pedido velho é descartada.

### D-035 · Serviços tem duas densidades; a padrão mostra a baixa
A lista estava comprimida demais: para saber **por que** uma visita não
fechou, o COP precisava abrir uma por uma. Na densidade **Detalhada**
(padrão) a linha traz as O.S. com número, tipo e **código de baixa
colorido por natureza**, mais complemento do endereço, supervisor da
equipe, WO e a hora de encerramento. **Compacta** mantém a leitura
anterior, de uma linha por visita.

Não é cópia da tela do concorrente: lá a informação vem em cartões
coloridos com etiquetas de evidência. Aqui continua tabela, na linguagem
escura e densa do Controle (D-011) — o que mudou é quanta informação a
linha carrega antes de precisar de um clique.

## 2026-09-06 (madrugada) — Cadastros, marcadores, relatórios

### D-036 · Situação vira cadastro, mas continua `text` — não virou FK
`situacao_visita` guarda rótulo, cor, cor de fundo, ordem, o tempo de
alerta e se a situação está em aberto ou encerra. A tela inteira lê dali
(`carregarSituacoes()` roda uma vez, junto da sessão), e o que estava em
`SITUACAO_INFO` virou **padrão de partida** para o caso de o banco não
responder.

`visita.situacao` **não** virou chave estrangeira, de propósito: o
domínio quem dita é o TOA, na importação. Com FK, situação nova derruba
a importação inteira em vez de entrar e aparecer. `situacao_visita` é
camada de apresentação, não fonte da verdade — e a tela de Configurações
avisa quando existe situação em uso sem cadastro, em vez de esconder.

### D-037 · Indicador de qualidade é o catálogo; marcador é a aplicação
`indicador_qualidade` são os sete da AFLINE — O.S DIGITAL, BOTÃO ESCADA,
AUTO INSPEÇÃO, URA DE INTERAÇÃO, GEOLOCALIZAÇÃO, CERTIDÃO, BAIXA URA —
cada um com meta e peso, e podendo valer só em algumas praças
(`indicador_qualidade_base`; sem linha nenhuma = vale em todas).

`visita_marcador` é a aplicação: o analista aponta, no contrato, qual
indicador vale ali. Escrita é da gestão (ADMIN/COP/CONTROLADOR/
SUPERVISOR) — é ela que avalia o trabalho do técnico —, e a autoria é
carimbada pelo banco (`usuario_id default auth.uid()`), não mandada pelo
cliente: autoria de avaliação não pode depender de o front-end lembrar.

**Duas coisas ficaram em aberto de propósito**, e estão escritas na
própria tela: quais indicadores são **exigidos** por tipo de serviço, e
se o marcador deve registrar cumprido/não cumprido em vez de só ser
apontado. `visita_marcador.cumprido` existe e fica `null` até essa
resposta.

> As etiquetas do sistema atual são mais amplas que os sete indicadores
> (MIGRACAO GPON, CLIENTE ATIVADO, TEC1 - COM PADRAO, LOG CANCELADO 1…).
> Não modelei essas: não sabemos se são marcador manual, derivado do
> tipo de serviço ou log do próprio sistema. **Perguntar antes.**

### D-038 · Relatório por contrato e por O.S. são leituras diferentes
Não é escolha de formato, é o D-001 aparecendo no papel:

- **por contrato** → uma linha por visita: deslocamento, janela, jornada
- **por O.S.** → uma linha por ordem, contrato repetido: baixa e
  faturamento

Uma visita com 3 O.S. vira 1 linha no primeiro e 3 no segundo. Somar
deslocamento no relatório por O.S. conta em triplo — o defeito que a
gente já corrigiu no modelo e que voltaria pela porta do relatório.

Por isso o relatório por O.S. traz a coluna **"Primeira do endereço"**:
é ela que separa DESLOCAMENTO de AGREGADA na LPU. Sai marcada agora,
antes de a pontuação existir, para não se perder depois.

### D-039 · A lista de Serviços separa contrato por cor de situação
A lista era um bloco só, tudo da mesma cor: não dava para ver onde um
contrato terminava e outro começava. Agora cada linha tem faixa colorida
à esquerda pela situação, fundo levemente tingido da mesma cor e um
separador mais forte entre contratos.

A cor vem do cadastro (D-036), então a operação ajusta sem recompilar.

### D-040 · O log de importação é o que faltava para enxergar erro
`importacao` já guardava tudo — arquivo, quem, quando, contagens — e
nada disso aparecia. A tela agora lista as últimas 30 importações com
resultado e status.

**Na primeira leitura ele já pagou:** toda importação do dia 05/09
registrou **erros que ninguém tinha visto**. Ver a pendência abaixo.

---

## ⚠ Pendência aberta em 06/09 — a mesma O.S. em duas atividades

O log revelou que **8 O.S. do dia 05/09 foram recusadas** com
`duplicate key ... ordem_servico_numero_os_idx`. Investigado:

| atividade recusada | O.S. | já pertence à atividade | do dia |
|---|---|---|---|
| 198847415 | 2607309803 | 199118753 | 04/09 |
| 198973687 | 2607498026 | 199170577 | 04/09 |
| 199117172 | 2607377213 | 198902240 | 04/09 |
| 199119549 | 2607258996 | 198811097 | 04/09 |
| 199154860 | 2607128633 | 198712684 | 04/09 |
| 199155081 | 2607686430 | 199073418 | 04/09 |
| 199189339 | 2607566112 | 199019018 | 04/09 |
| 199260507 | 2607790155 | 199143722 | 05/09 |

Ou seja: **a mesma O.S. aparece em duas atividades diferentes**, quase
sempre uma no dia 04 e outra no 05. Isso tem cara de reagendamento ou
retrabalho — o TOA abre nova atividade para a mesma ordem.

Nosso índice único assume "uma O.S. vive em uma visita só", e isso é
falso. Consequência hoje: essas 8 visitas entraram **sem as O.S.**, o
que subconta produtividade e vai subcontar faturamento.

**Não corrigi porque é regra de negócio, não bug de código.** As saídas
possíveis, para o Emanuel escolher:

1. **A O.S. muda de visita** — a última importação vence e a O.S. migra
   para a atividade nova. Preserva "uma O.S., um pagamento", mas apaga
   que houve duas idas.
2. **A O.S. pode existir em N visitas** — troca o índice por
   `(visita_id, numero_os)`. Preserva as duas idas (e o deslocamento de
   cada uma), mas exige regra de qual delas fatura.
3. **Vira reincidência** — a segunda ida é registrada como retorno da
   primeira, usando a tabela `reincidencia` que já existe.

A 3 parece a mais fiel ao negócio, mas envolve dinheiro. **Pergunta
antes de mexer.**

### D-041 · O mesmo contrato é atendido mais de uma vez — e isso é normal
Medido no relatório mensal do ngestor (`_14-07-2026_23-22.xlsx`, 17.987
linhas):

- 17.987 linhas, **17.987 `ID` distintos** — o ID é do ATENDIMENTO
- **2.656 contratos** aparecem com mais de um ID (18%)
- **536** pares contrato+dia com mais de um ID
- **2.036 O.S.** aparecem em mais de um ID

Exemplo real, contrato `226622995` em 01/07:

| ID | WO | Situação | Baixa |
|---|---|---|---|
| 1272333 | 230133181 | Reagendamento | 101 Endereco Nao Localizado |
| 1272703 | 230264018 | Concluido | 409 Instalacao Efetuada |

Quebrou de manhã, o cliente reagendou, foi de novo à tarde. São **dois
atendimentos, dois deslocamentos, duas baixas** — e o TOA emite **WO
nova** para o segundo.

Nosso modelo já acertava: `visita.toa_atividade_id` é o ID do
atendimento. O errado era **um índice**: `ordem_servico.numero_os` era
único no banco inteiro, como se uma O.S. vivesse numa visita só. Agora é
índice comum; a unicidade real é `(visita_id, sequencia)`.

> Isso responde a pendência aberta mais cedo hoje. A saída não foi
> nenhuma das três que eu tinha listado: o Emanuel mostrou que o próprio
> sistema atual **cria um registro novo por atendimento**, e é isso que
> o modelo tem que espelhar.

### D-042 · São dois códigos de baixa, e eles divergem
O relatório traz as duas colunas lado a lado: `Cod. Baixa Operadora`
(TOA) e `Código De Baixa` (ngestor). **13.021 linhas têm as duas**, e
elas divergem com frequência:

```
TOA  -1 → 800 Desatribuido            549x
TOA 312 → 106 Cliente Ausente          93x
TOA 425 → 409 Instalacao Efetuada      83x
TOA 430 → 409 Instalacao Efetuada      61x
```

Não é erro de um dos lados: a operadora fecha de um jeito e a credenciada
classifica de outro. Guardar só um perde metade da história — e **é a
nossa que manda no comissionamento**.

`ordem_servico.codigo_baixa_id` segue sendo o da **operadora** (é o que o
importador preenche há 25 migrations; renomear mexeria em importador,
view e quatro telas de uma vez). A nossa entra em
`codigo_baixa_afline_id`, junto de `sub_falha_id`, `baixa_em`,
`baixa_por` e `baixa_observacao`.

A `baixar_os()` grava tudo num ato só e registra no histórico — e
**valida que a sub-falha pertence ao código e ao conjunto vigente**.
A lista de sub-falha na tela também filtra pelo conjunto: sem isso vinha
em dobro, CASO 1 e NÍVEL HARD juntos.

**Conjunto escolhido pelo Emanuel: `NÍVEL HARD`** (938 pares, 155
códigos, 17 categorias).

### D-043 · Excluir contrato é arquivar, não apagar
`excluir_visita(visita, motivo)` exige motivo, carimba quem e quando, e
grava evento `EXCLUIDA`. O contrato sai das listas, dos relatórios e do
painel de equipes, mas continua no banco — e `restaurar_visita()` traz de
volta.

Apagar de verdade levaria junto as O.S., o histórico, os marcadores, a
linha de importação que o originou e, quando a pontuação existir, a base
de um mês já faturado. Pior: a visita **voltaria na próxima importação do
TOA**, sem histórico nenhum.

### D-044 · Botão direito abre as ações do contrato
O menu do contrato responde ao clique direito, além do `⋯`. É como o COP
já trabalha no sistema atual.

### D-045 · A pontuação é COMBINAÇÃO DE O.S. × EDIFICAÇÃO
Medido no relatório mensal do ngestor (17.987 linhas, 14.512 com
pontuação):

| chave | chaves distintas | com um valor só |
|---|--:|--:|
| combinação × edificação × pessoa | 674 | **94,2%** |
| combinação × edificação | 579 | **94,1%** |
| combinação × pessoa | 527 | 85,4% |

Tirar o tipo de pessoa **não muda nada**; tirar a edificação piora nove
pontos. E olhando combinação a combinação:

- das **105** que aparecem em CASA e APTO, **43 mudam de valor** (41%)
- das **43** que aparecem em FISICA e JURIDICA, **5 mudam** (12%)

`ADESAO - INSTALACAO DE ASSINATURA + ADESAO - INSTALAR PONTO VIRTUA`
vale **1,4648 em casa** e **1,2925 em apartamento** — o mesmo valor para
pessoa física e jurídica.

> **Isto destrava o `06-PONTUACAO`.** A dimensão que faltava na nossa
> fonte — tipo de pessoa — é justamente a que menos importa. E edificação
> a gente lê do complemento do endereço.

**Modelo:** `tabela_preco` (a "Vigência" deles) → `combinacao_os`
(assinatura = os tipos de O.S. normalizados, na ordem, unidos por ` + `)
→ `regra_pontuacao` (edificação × tipo de pessoa → pontos_claro,
pontos_equipe). `QUALQUER` é coringa nas duas dimensões, e
`pontos_da_visita()` sempre prefere a regra mais específica.

**Semente:** 546 combinações e 579 regras direto do relatório de julho,
mais 448 regras coringa para quando o endereço não diz a edificação —
essas copiam a regra de CASA, que é 72% da operação, e dizem isso na
observação. 34 regras nasceram marcadas `CONFERIR`: o relatório traz mais
de um valor para a mesma chave, provavelmente tabela de preço diferente.

**Cobertura:** 311 de 327 visitas produtivas dos dois dias importados
(**95,1%**). Jornada não pontua, como deve ser. O dia 05/09 fecha em
92,8286 pontos CLARO.

`pontos_equipe` está **vazio de propósito**: é o que a equipe recebe, e
ainda não foi levantado. A diferença entre os dois é a margem por
atendimento — a informação que o Emanuel disse não enxergar em lugar
nenhum.

Toda alteração de regra passa por `regra_pontuacao_log`, com de/para,
autor e hora. Sem isso o recálculo retroativo do D-018 seria irreversível.

### D-046 · O menu do contrato abre onde o mouse está
Antes ele nascia colado na borda direita da tabela, longe do clique.
Agora usa `position: fixed` com as coordenadas do evento, limitadas para
não sair da janela.

### D-047 · Transferir não sai da lista
Era um link para a tela de detalhe. Virou painel na própria linha, com
equipe destino e motivo — dois cliques em vez de trocar de tela e voltar.
A regra continua no banco (`transferir_visita`), que grava de/para, quem
e o motivo.

### D-048 · Na tela de Equipes o cartão inteiro abre o contrato
O botão "abrir" era ruído: o cartão já é o alvo natural do clique.

### D-049 · Papel é a barreira; permissão é a granularidade
As 66 policies decidem por **papel** (`tem_papel`). Isso não mudou: as
caixinhas de permissão da tela de Administração são camada **adicional**,
checada nas RPCs e na interface. Elas **restringem, nunca ampliam** —
quem não tem o papel não passa do RLS, mesmo com tudo marcado.

Reescrever 66 policies para consultar permissão fina numa sessão só seria
o jeito mais rápido de abrir buraco sem perceber. Fica para quando houver
teste automatizado de policy.

ADMIN passa em tudo por definição, senão o primeiro admin se trancaria
para fora ao criar o primeiro perfil de acesso.

`perfil_acesso` guarda o papel correspondente; ao criar um usuário, o
papel vem do perfil escolhido.

### D-050 · Autoedição não pode mudar o que dá poder
A policy `perfil_autoedicao` (migration 005) libera `UPDATE` onde
`id = auth.uid()` — para a pessoa arrumar o próprio telefone.

**Só que RLS não restringe coluna.** Com ela, qualquer usuário podia
trocar o próprio `perfil_acesso_id` e se dar todas as permissões, ou
mudar `empresa_id` e enxergar outra credenciada.

Passou despercebido por 27 migrations porque só existia um usuário, e ele
era ADMIN. Viraria buraco no dia em que o primeiro técnico logasse.

O trigger `perfil_protege_campos` barra `empresa_id`, `base_id`, `ativo`,
`perfil_acesso_id`, `cargo_id`, `tecnico_id` e `email` para quem não é
ADMIN. O resto segue livre.

**Testado com um usuário técnico de verdade**, logado com senha:

| tentativa | resultado |
|---|---|
| trocar o próprio perfil de acesso para Administrador | **403** — trigger |
| inserir `usuario_papel` com ADMIN | **403** — RLS |
| chamar `definir_papeis` para si | **403** — checagem na função |
| chamar a Edge Function de criar usuário | **403** — não é ADMIN |
| chamar a Edge Function sem login | **401** |
| mudar o próprio telefone | **204**, como deve ser |
| listar perfis | vê **só o próprio** |

### D-051 · Criar login passa por Edge Function
Criar conta em `auth.users` exige a `service_role`, que nunca pode ir
para o navegador. A função `admin-usuarios` guarda a chave no servidor e
só age depois de conferir, **com o JWT de quem chamou e consultando o
banco**, que a pessoa é ADMIN. A tela não é a barreira.

A senha é gerada no servidor e devolvida **uma vez**, para o admin
repassar. Se o INSERT do perfil falhar, a função desfaz o usuário do auth
— acesso órfão em `auth.users` é login sem dono.

### D-052 · `usuario_papel.escopo` é obrigatório e não tem default
A primeira versão de `definir_papeis` não passava escopo. O insert morria
em not-null e **o usuário nascia sem papel nenhum** — um login que entra
e não enxerga nada, sem erro visível na tela. Peguei ao conferir o
primeiro usuário criado.

`escopo_padrao()`: ADMIN e COP → `GLOBAL`; TECNICO → `PROPRIO`; demais →
`BASE`, com a base do próprio perfil.

### D-053 · Usuário não se apaga, se desativa
Apagar levaria junto a autoria de cada baixa, marcador, transferência e
exclusão de contrato que a pessoa fez. `definir_situacao_usuario()`
desativa, e o banco recusa dois casos: desativar a si mesmo, e deixar a
empresa sem nenhum ADMIN ativo. **Testado**: tirar o papel do único ADMIN
retorna "Este e o ultimo ADMIN ativo".

### D-054 · Teste de policy vem antes de mexer em policy
`testar_policies()` cria usuários reais (auth + perfil) de cada papel,
troca o role da sessão para `authenticated`, roda a bateria e apaga tudo
no fim — inclusive se estourar no meio.

**A primeira versão não testava nada.** Era `SECURITY DEFINER`, e função
definer roda como o owner, que tem `BYPASSRLS`. Todos os cenários
"passavam" porque o RLS nem chegava a ser consultado. Um teste de policy
que roda como superusuário é pior que nenhum: dá confiança falsa.

A versão boa é INVOKER + `set local role authenticated`. **16 cenários,
todos verdes.** Um deles é o oposto dos outros: o técnico *precisa*
conseguir mudar o próprio telefone. Sem esse, o teste só provaria que
está tudo trancado, não que está certo.

```sql
select * from testar_policies();   -- esperado: passou = true em tudo
```

### D-055 · A permissão fina entra nas RPCs, não nas policies
Com o teste no lugar, dava para reescrever as 74 policies. Não reescrevi,
e o motivo é técnico:

Policy roda em **toda linha de toda consulta**. Trocar `tem_papel('X')`
por uma subconsulta em `perfil_acesso_permissao` multiplica o custo do
RLS na tabela mais lida do sistema (`visita`) — e o ganho é **zero**,
porque permissão sem papel não abre nada.

O lugar certo é a **entrada da ação**: a RPC, que roda uma vez por
operação. É lá que a granularidade importa — um CONTROLADOR que pode
baixar mas não pode excluir, por exemplo.

> **Papel = quem entra na sala. Permissão = o que faz lá dentro.**

`excluir_visita` e `baixar_os` passaram a exigir as duas coisas.
`visita_marcador` teve a policy de escrita afinada com
`tem_permissao('servicos.marcadores')` — essa é barata, porque a tabela é
pequena e só é escrita por ação humana.

Efeito colateral que o teste pegou na hora: usuário **com** o papel e
**sem** perfil de acesso perde as ações. É o comportamento certo, e virou
cenário fixo da bateria.

### D-056 · O contrato abre em janela, não em linha expandida
A expansão empurrava a lista inteira para baixo e, mesmo assim, não cabia
o que o COP precisa ver. A janela abre no clique, mostra detalhe,
histórico, marcadores e as quatro ações, e fecha sem mexer no scroll de
quem está trabalhando na lista.

As duas baixas aparecem lado a lado e **rotuladas por extenso** —
"Baixa da operadora (TOA)" e "Baixa da AFLINE (ngestor)". Na linha da
lista viraram `Baixa TOA` e `Baixa ngestor`: abreviar num campo que
significa dinheiro é economia errada.

### D-057 · O painel mostra volume E pontos, porque são leituras diferentes
DESCONEXÃO faz volume e quase não pontua; ADESÃO faz menos volume e
carrega o faturamento. Um painel que só mostra volume engana quem decide.

A tabela de tipos de serviço tem as duas abas, e os cartões de situação
usam a cor do cadastro (D-036) — a mesma da lista, do modal e do painel.

---

## 2026-09-06 (tarde) — Relatório completo, cadastro manual e visão do técnico

### D-058 · O relatório estava contando menos da metade da história
O export do sistema atual tem **64 colunas**. O nosso tinha **25** (por
contrato) e **29** (por O.S.). O que faltava não era enfeite:

| Faltava | Por que importa |
|---|---|
| **Pontuação** | é o faturamento; sem ela o relatório não fecha conta |
| **Descrição da O.S.** | `2607830497` não diz nada; `ADESAO - INSTALAR PONTO VIRTUA` diz |
| Telefone, tipo de pessoa, edificação | edificação decide a pontuação (D-045) |
| Equipamento instalado/retirado | é patrimônio em campo |
| Quem importou, quando, de qual arquivo | é a origem do dado |
| Os 7 indicadores de qualidade **em coluna** | é exatamente como o relatório dele entrega |

Agora são **71 colunas** por contrato e **86** por O.S., em Excel além de
CSV. A montagem saiu da tela para `app/src/lib/relatorio.ts`: com 70+
colunas ela não cabia mais dentro do componente sem afogá-lo.

**O SELECT mora junto do montador, de propósito.** Coluna nova no
relatório sem campo no SELECT sai vazia **em silêncio** — foi assim que a
pontuação sumiu do export sem ninguém notar.

### D-059 · A pontuação sai só na primeira O.S. do endereço
No relatório por O.S., repetir a pontuação da visita em cada linha faria
uma visita de 3 O.S. valer o triplo numa soma de planilha. É o mesmo erro
de achatar deslocamento (D-001), agora em cima de dinheiro.

A pontuação sai **apenas** na linha marcada `Primeira do endereço = SIM`;
nas demais fica **vazia**. A tela diz isso em letra grande, acima da
prévia, porque quem soma a coluna não vai ler o rodapé.

### D-060 · O histórico só vale se disser QUEM
O sistema atual mostra no contrato um passo a passo em que cada linha tem
o autor: *"Entrada - In Box · VERA LUCIA"*, *"Em deslocamento · 007 -
EQUIPE"*. Nós já tínhamos a tabela (`visita_evento`) e a aba. Faltava o
autor, e faltava linha:

```
IMPORTADA      551 eventos ·   0 com usuario_id
CONFLITO_TOA     2 eventos ·   0 com usuario_id
```

E não havia **um evento por mudança de situação** — só o de criação. O
histórico contava o nascimento do contrato e mais nada.

`visita_evento` ganhou `login` e `importacao_id`. A importação passou a
carimbar autor, arquivo e uma linha a cada vez que a situação muda — e só
quando muda, senão reimportar a mesma planilha polui a trilha.

**Retroativo:** 207 eventos recuperaram o autor pelo cabeçalho da
importação e **407 recuperaram o login**, porque a linha crua do TOA já
estava guardada em `visita.dados_origem` desde a 004. Os 344 restantes
vieram dos dois primeiros arquivos, cujo cabeçalho nasceu sem
`usuario_id` — esses ficam anônimos, e está certo que fiquem.

> **`login` tem dois donos.** Vindo da planilha, é o *Login do Técnico*
> do TOA. Vindo da tela, é o e-mail de quem operou. É a mesma coluna
> porque responde a mesma pergunta.

### D-061 · Autor que vem do cliente não é prova
A tela do campo dava `UPDATE` na visita e `INSERT` no evento por conta
própria, mandando o `usuario_id` junto. Um técnico com o console aberto
assinava evento em nome de qualquer um — e o histórico existe justamente
para ser prova.

`registrar_etapa()` e `baixar_os()` passaram a carimbar `usuario_id`,
`login`, `tecnico_id` e `origem` **no servidor**. A policy de inserção
agora exige `usuario_id = auth.uid()`.

Ambas são `SECURITY DEFINER`, então o escopo da equipe é conferido **por
dentro** — e foi conferindo isto que apareceu o furo: `baixar_os` não
checava equipe nenhuma. **Qualquer técnico baixava a O.S. de qualquer
outro.**

### D-062 · Você lê o histórico do que você já enxerga
`evento_leitura` era `eh_gestor() or tem_papel('CONTROLADOR')`. O
**técnico não lia o histórico do contrato que ele mesmo estava
executando**, e o supervisor também não.

A regra certa é mais simples e mais barata:

```sql
using (visita_id in (select id from visita))
```

O subselect passa pelo RLS da própria `visita`, então ele **não abre nada
novo** — só para de esconder o que a pessoa já tinha direito de ver.

### D-063 · O contrato que não está no TOA entra na mão
Nem todo serviço nasce no TOA. Quando não nasce, precisa entrar mesmo
assim: senão não é despachado, não é medido e não é cobrado.

- **Não criamos tabela `cliente`.** A operação não tem uma — o dado
  cadastral mora na visita, como vem do TOA. A busca de cliente procura
  no histórico de visitas e **copia** o cadastro do atendimento anterior.
  Mesmo efeito prático, sem inventar entidade.
- **Número de O.S. gerado: `AF-00000001`.** A CLARO usa 10 dígitos
  (`2607830497`). Um número nosso no mesmo formato colidiria no dia em
  que o contrato entrasse no TOA, e ninguém saberia qual é qual. O
  prefixo diz na cara que aquela O.S. nasceu aqui.
  ⚠ **Formato escolhido por nós, não observado no dado — confirmar com o
  Emanuel.**
- **A tela avisa quando falta o Tipo de O.S.** A regra de pontuação é a
  combinação de *tipos* × edificação (D-045), e `assinatura_da_visita`
  monta essa combinação pelo `tipo_os_id`. O.S. só com descrição livre
  não casa com regra nenhuma: o contrato entra valendo zero e ninguém
  percebe.
- **O.S. do TOA não se remove**, só a manual e só antes da baixa. Apagar
  uma do TOA seria mentir para a operadora: a importação a recriaria na
  hora, sem a nossa baixa.
- **Não inventamos "Data de Abertura".** A tela dele tem o campo; a
  planilha do TOA não traz nada equivalente. Guardar a coluna daria 100%
  de vazio no que é importado. Ela é o `criado_em`, e a tela diz isso.

### D-064 · Voltar contrato é o diferencial, então tem que deixar rastro
O sistema da CLARO não volta situação. O nosso volta — é uma das razões
de existir deste projeto. `reverter_situacao()` exige papel de gestor ou
controlador, **exige motivo** e grava de onde, para onde, quem e por quê.

O técnico **não** volta. Se ele fechou errado, pede ao controlador. Sem
isso, "voltar" viraria borracha em vez de correção rastreada.

### D-065 · O tema é do controle; o campo não tem chave
D-011 já dizia que o campo é claro por **condição de trabalho** — celular
sob sol direto. Isso não é preferência, e por isso o campo **não ganha
chave**. Quem fica oito horas na tela do controle, sim, tem preferência
legítima: sala clara com tela escura cansa tanto quanto o contrário.

**A troca não reescreveu componente nenhum.** `bg-graf-900` continua
`bg-graf-900`; o que muda é *quanto vale* graf-900. `data-tema="claro"`
redefine as variáveis de cor **dentro de `.sup-controle`**, e as ~1.200
classes utilitárias já escritas seguem junto.

O seletor é `[data-tema="claro"] .sup-controle`, **não `:root`**, e a
razão é dura: o campo usa a mesma rampa (`bg-graf-50`, `border-graf-200`)
esperando os valores **claros**. Invertê-los no documento inteiro
pintaria o fundo do técnico de preto. Só a faixa que serve de tinta e de
texto inverte; as 500/600 são cores de ação e ficam onde estão.

### D-066 · O papel SUPERVISOR não enxergava nada
Apareceu ao montar os logins de teste. `equipes_visiveis()` decidia por
quatro caminhos — gestor, controlador da equipe, carteira, técnico da
equipe — e **o supervisor não estava em nenhum**. Ele entrava e via tela
vazia.

A coluna `equipe.supervisor_id` existia para isto e estava em **0 de 89**
equipes. Acrescentar o caminho é inócuo hoje (não muda uma linha do que
se enxerga) e faz o papel funcionar no instante em que os supervisores
forem vinculados.

`supervisor_nome` (85 de 89) é texto vindo do TOA e **não serve de
chave**: nome bate por acaso e deixa de bater por acento.

⚠ **PENDENTE PARA O EMANUEL:** ligar cada supervisor real ao usuário dele
em `equipe.supervisor_id`. Enquanto isso não acontecer, o papel enxerga
zero — o que está certo, e é melhor que enxergar tudo.

### D-067 · Login de teste é script, login de verdade é tela
Criar usuário exige a `service_role`, que nunca vai para o navegador
(D-051) — por isso a Edge Function `admin-usuarios` continua sendo o
caminho de produção, pela tela de Administração.

O que a tela **não** faz é o vínculo: `tecnico.usuario_id` e
`equipe.supervisor_id`. Sem eles o login entra e não enxerga nada, porque
`equipes_visiveis()` depende dos dois. `app/scripts/criar-usuarios-teste.mjs`
cria os três logins e faz o vínculo, é idempotente e tem `--remover`.

A chave fica na variável de ambiente da máquina de quem roda, no momento
em que roda. As senhas são sorteadas e impressas **uma vez**. O domínio é
`@teste.local`, que não existe: login de teste que parece login de
verdade acaba virando login de verdade, e ninguém lembra de tirar.
