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
> ⚠ **REVOGADA em 10/09/2026 pela D-123.** A tela passou a abrir em
> HOJE. O que está abaixo é o raciocínio original, mantido porque
> explica o problema que a D-123 teve de resolver de outro jeito.

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

### D-068 · Reincidência sai do dado, não de palpite
O relatório dele tem cinco colunas `SERVICO-ANTERIOR-*`. O nosso emitia
as colunas e **nunca punha nada nelas**: a tabela `reincidencia` existia
desde a 004 e jamais foi preenchida.

A regra é a mesma dele: **visita anterior no mesmo contrato**, com data,
dias decorridos, equipe e o código de baixa **da operadora** — que é o
que a CLARO reconhece (D-042). Quando a visita anterior tinha várias
O.S., vale a de menor sequência que tenha baixa.

Nos três dias carregados: **12 reincidências em 11 contratos**, de 373
distintos. Cinco com `dias_desde = 0` — retorno no mesmo dia, que é
exatamente o caso do D-041. Uma delas conta a história inteira: contrato
227011035, ADESAO em 06/09 pela equipe 062, **dois dias depois** de a
equipe 014 fechar em `110 - Problema Na Tubulação`.

O recálculo pendura em `importar_toa`, não em `importar_toa_interno`: a
prévia estoura de propósito para desfazer a transação, e recalcular
reincidência num ensaio que vai ser descartado é trabalho jogado fora.

---

## 2026-09-07 (tarde/noite) — Roteamento por login, comissão e produtividade

### D-069 · O login do TOA manda na equipe — e a importação o ignorava
Cada contrato do TOA traz um **Login do Técnico**. Esse login pertence a
uma equipe, e é ele que decide para onde o contrato vai. Existia função
pronta para isso desde a 021 — `equipe_do_login()`, com três critérios em
ordem de prioridade.

**A importação não usava a função.** Usava só o *terceiro* critério, a
matrícula do técnico. O que o usuário cadastrava em `equipe.login_toa`
era simplesmente ignorado, e 7 contratos estavam na equipe 203 quando o
cadastro dizia 020 e 026.

Passou a usar a cascata. `equipe.login_toa` ganhou índice único por base
— se um login apontar para duas equipes, a importação tem duas respostas
para a mesma pergunta e escolhe uma por acaso. No histórico
(`equipe_login_toa`), o mesmo login não pode ter duas atribuições
**abertas**: trocar de dono é fechar a anterior com `fim`, porque o login
muda de equipe com o tempo e a produtividade histórica depende de saber
de quem ele era em cada dia.

### D-070 · `norm_txt(NULL)` devolve string vazia — e isso roteava contrato
Bug latente desde a 021, achado ao rodar o realinhamento em lote.

`norm_txt(NULL)` não devolve NULL: devolve `''`. E equipe sem `login_toa`
também normaliza para `''`. Portanto:

```
equipe_do_login(base, NULL, data)  →  a primeira equipe SEM login
```

Contrato sem login no TOA — **todo apontamento de jornada é assim** — era
atribuído a uma equipe qualquer, em silêncio. Só apareceu porque um
comando em lote jogou 158 apontamentos na equipe 002 de uma vez; um a um,
teria passado despercebido por meses.

A função passou a dizer "não sei" quando não sabe, e cada ramo passa a
exigir que o próprio cadastro tenha login.

> **A lição:** função que normaliza texto tem de decidir o que faz com
> nulo, e dizer isso no nome ou no comentário. `''` e `NULL` são coisas
> diferentes e o Postgres não vai lembrar disso por você.

### D-071 · Situação terminal exige TODAS as O.S. baixadas
Um contrato de 3 O.S. que fecha com 1 baixada mente duas vezes: diz que
o serviço acabou, e deixa duas ordens sem resultado — que é justamente o
que a CLARO fatura.

`exige_todas_baixadas()` mora num lugar só e as três portas chamam ela:
`baixar_visita`, `registrar_etapa` e a tela. A mensagem diz **quais**
faltam, com número de O.S. — "faltam 2" manda o usuário procurar.

A janela do contrato passou a baixar todas as O.S. de uma vez, uma linha
por ordem, com código, sub-falha e observação em cada.

### D-072 · O status espelha o TOA mesmo com a trava do D-006
O D-006 dizia: em conflito com o TOA, o dado do campo vence. O Emanuel
reviu — o sistema é **espelho** do TOA, e status que não espelha não
serve para despachar.

A trava continua protegendo o **trabalho** do campo (baixa da AFLINE,
foto, observação). O **status**, não: a importação sobrepõe, e o evento
`CONFLITO_TOA` continua sendo gravado, então nada se perde da trilha.

> ⚠ **Consequência declarada:** com o app do técnico em uso, uma planilha
> do TOA mais velha que a última etapa dele vai desfazer essa etapa. Foi
> decisão do Emanuel, tomada com esse risco na mesa. Hoje afeta 1 visita.

### D-073 · A lista de equipes abre só com quem tem contrato
89 equipes na tela, 7 com serviço no dia. As 82 linhas vazias empurravam
as 7 que importam para fora da primeira tela. "Só com serviço no dia"
passou a vir ligado.

E cada equipe ganhou a **bolinha do técnico** — foto (`tecnico.foto_url`)
ou iniciais. O matiz sai do nome, então a mesma pessoa tem sempre a mesma
cor, em qualquer tela e em qualquer sessão; bolinha que muda de cor a
cada carregamento não ajuda a reconhecer ninguém, que é a única razão de
ela existir. A **luminosidade** sai do CSS, que sabe o tema (D-065): no
escuro é chip escuro com texto claro, no claro é o inverso — senão 89
bolinhas saturadas numa lista branca viram confete.

### D-074 · Buscar um contrato é perguntar pela história dele
Digitar um número de contrato na busca deixou de ser filtro dentro do
período e passou a ser "o que já aconteceu neste contrato": traz **todas**
as visitas, dia a dia, com as baixas.

O período esconderia justamente as outras visitas, que são o que
interessa quando alguém digita um contrato inteiro. A tela avisa que saiu
do período, com um atalho para voltar — filtro que muda de sentido sem
avisar é pior que filtro que não muda.

### D-075 · A janela abre e o Esc devolve
Fade no fundo e subida curta com escala na caixa: 160 ms e 200 ms, curva
`cubic-bezier(.32,.72,0,1)` — a que assenta em vez de parar seco. Curto
de propósito: 400 ms atrasa quem fica na tela o dia inteiro. Quem pediu
menos movimento continua sem movimento.

E **Esc na página cheia do contrato volta para onde a pessoa estava**. Na
janela o Esc já fechava; abrir a página e ficar preso nela quebrava o
hábito. Não intercepta quem está digitando — Esc dentro de campo tem dono.

### D-076 · Uma tela de produtividade, não dezesseis relatórios
O menu de Relatórios do sistema atual tem 16 itens: Insights, Por
Serviços, Por LPU, Por Equipamentos, Batidas de Ponto x Serviço, Dias
Trabalhados, Indicadores de Qualidade, Pontuação Geral, Pontuação
Técnico, Tabela Pontuação, Pontuação Monitor, Período, Ranking Geral,
Log's Retorno, COP 360, Produtividade Geral.

Boa parte é a **mesma pergunta agrupada de outro jeito**: "Pontuação
Técnico", "Pontuação Monitor" e "Ranking Geral" são a mesma soma por
técnico, por supervisor e ordenada.

Virou **uma tela e um seletor de dimensão**. Quem procura o ranking acha
na tela em que já estava, em vez de voltar ao menu.

Só conta **contrato concluído**: contrato em execução não virou dinheiro,
e contá-lo faz a comissão oscilar para baixo quando o contrato cai.
Jornada não entra.

Meta e fator só aparecem na dimensão **técnico**: somar os pontos de uma
equipe e comparar com a meta individual dava 86% para um supervisor de
três técnicos — número bonito e sem sentido.

### D-077 · A receber = pontuação × fator
Fecha a pendência que estava aberta desde a 027 (`pontos_equipe`).

O fator sai da faixa em que a pontuação do mês caiu. Fica no **banco**, e
não na tela, porque dinheiro tem de ter uma fórmula só: relatório, tela e
futura folha precisam concordar sem ninguém reimplementar a
multiplicação.

Conferido: 120 × 2 = R$ 240,00 · 150 × 4 = R$ 600,00 · 300 × 12 =
R$ 3.600,00.

**O buraco entre as faixas.** A tabela é escrita em inteiros — 190→199,
depois 200→219. A nossa pontuação não é inteira (1,4648 · 20,3331):

```
199,00 pts → fator 5,8 → R$ 1.154,20
199,50 pts → SEM FATOR → R$ 0,00      ← o técnico perde tudo
200,00 pts → fator 7,0 → R$ 1.400,00
```

Um centésimo de ponto zerando a comissão não é regra de negócio, é
defeito de arredondamento da tabela. A busca passou a ser por **piso**:
vale a maior faixa cujo início já foi alcançado. Sem buraco, e quem passa
do teto (400) fica no fator do teto em vez de perder tudo.

> ⚠ Isto muda o comportamento em relação à tabela literal do sistema
> atual. Se a AFLINE quiser faixa estrita mesmo, é `>= pontos_de` de
> volta para `between` em dois lugares.

A meta **não se sobrescreve**: a antiga fecha e a nova começa hoje. Sem
isso, mudar a meta em outubro reescreveria a comissão de setembro.

### D-078 · Pontuação com duas casas na tela, quatro no arquivo
`2,16 pts` em toda tela. Quatro casas só atrapalhavam: ninguém compara
`20,3331` com `17,3176` de relance, e a coluna fica larga à toa.

**O export continua com quatro.** Arredondar cada linha antes de somar
centenas delas move dinheiro de verdade. A tela é para ler; a planilha é
para contar. `lib/formato.ts` guarda os dois formatos e a razão.

Na lista de Serviços, o **contrato virou a primeira coluna** — é por ele
que se procura, se fala ao telefone e se confere com a CLARO; a janela é
importante, mas não é a identidade da linha. A **data** ocupou o lugar
que era do contrato, no fim: sem ela, a busca por contrato (que agora
traz várias datas) seria uma pilha de linhas indistinguíveis.

### D-079 · Cadastro é declaração; dedução minha não vira cadastro
**Erro meu, pego pelo Emanuel.**

A migration 034 semeou 45 registros em `equipe.login_toa`, deduzidos da
matrícula do técnico. Ninguém cadastrou aquilo. A tela de Equipes passou
a mostrar "Login TOA Z125771" como se fosse declaração do usuário, e não
havia como distinguir o que ele registrou do que eu inferi.

Apagadas as 45; voltaram as 9 que já estavam lá. Isso **não** mudou para
onde os contratos vão — as 45 linhas eram cópia do terceiro critério da
cascata no lugar do segundo.

> **A regra:** dado que o sistema deduz pode alimentar uma decisão, mas
> não pode se sentar na cadeira do dado que a pessoa declarou. Se ficar
> nos dois lugares, ninguém mais sabe qual é qual.

### D-080 · Sem cadastro, sem equipe
A 036 mandava o contrato de login desconhecido para uma equipe abrigo
("SEM-LOGIN"). O Emanuel pediu isso num dia e reviu no outro — e a
revisão está certa.

Contrato dentro de uma equipe — qualquer equipe — já entra em contagem,
em produtividade e em comissão. O abrigo tinha **nome de alarme mas
cheiro de atribuição**. Fora de equipe, o contrato aparece no cartão
"Fora do cadastro" da tela de Equipes, que é onde ele deve incomodar até
alguém cadastrar o login.

Onde cada contrato vai parar hoje:

| Como a equipe é encontrada | Visitas | Logins |
|---|---|---|
| Sem login no TOA (jornada) → sem equipe | 158 | — |
| 1 · cadastro de login da equipe | 118 | 9 |
| 3 · matrícula do técnico → equipe (planilha de equipes) | **323** | **45** |
| 4 · não cadastrado em lugar nenhum → sem equipe | 8 | 1 |

> ⚠ **PENDENTE DO EMANUEL:** o critério 3 conta como cadastro? Não é
> palpite — sai da planilha de equipes, dado declarado —, mas é frase
> diferente de "esta equipe usa o login X do TOA". Se **não** valer, 323
> visitas (73% das produtivas) ficam sem equipe até alguém cadastrar
> login por login, e a produtividade fica quase vazia.

### D-081 · A produção do mês na mão do técnico
O técnico abre a agenda e vê, no topo: pontos concluídos, meta, barra do
quanto falta e — quando já entrou em faixa — o fator e o valor em reais.
É a pergunta que ele faz todo dia e que hoje só era respondida no fim do
mês, por outra pessoa.

`produtividade_periodo` é `SECURITY DEFINER` com o escopo conferido por
dentro, então a mesma função serve o COP e o técnico sem vazar nada.

**Por que DEFINER, e por que `as materialized`.** A primeira versão era
INVOKER e morria de duas mortes:

1. `pontos_por_periodo` numa CTE referenciada uma vez é *inline* pelo
   planejador — e passa a ser reexecutada por linha do join.
2. Como INVOKER, o RLS da `visita` reavaliava `minha_empresa()`,
   `bases_visiveis()` e `equipes_visiveis()` a cada linha.

Media **402 ms como owner** e **estourava o statement timeout como
`authenticated`**. É o mesmo engano do D-054 — testar como dono —, agora
em desempenho. Virou DEFINER com escopo calculado uma vez: 844 ms.

Conferido com usuário temporário ligado a um técnico real, e desfeito:
19 visitas visíveis (só a equipe dele), 0 de outras, 1 linha de produção,
etapa gravada com `login Z656921 · origem MOBILE`, e conclusão sem baixa
barrada nomeando a O.S.

### D-082 · O critério 3 vale — mas a tela diz que é ele
> ⚠ **REVOGADA em 07/09 pelo D-088.** O Emanuel tinha delegado a decisão;
> eu escolhi manter o critério 3 e escolhi errado. Fica registrada porque
> o raciocínio abaixo é o que precisou ser desfeito — e porque a etiqueta
> de origem do login, que nasceu aqui, continua valendo.

O Emanuel delegou a decisão. **Fica valendo.**

`tecnico.matricula → tecnico.equipe_id` saiu da planilha de equipes: é
dado declarado por quem opera, não dedução minha. Tirá-lo deixaria 323
visitas — 73% das produtivas — sem equipe, e a produtividade quase
vazia, sem ganho nenhum em troca.

O que estava errado na 034 nunca foi *usar* o critério 3. Foi **copiá-lo
para dentro de `equipe.login_toa`** e fazê-lo passar por cadastro
(D-079). O conserto certo não é remover o critério: é dizer de onde cada
login veio.

A lista de equipes passou a mostrar a etiqueta ao lado do login:

- **CADASTRADO** — alguém digitou o login nesta equipe
- **PELA MATRÍCULA** — veio da planilha de equipes, pelo técnico

Medido em 07/09, no dia com serviço: 6 equipes resolvem pela matrícula
(45 visitas) e 1 por cadastro (7 visitas). `cadastrar_login_da_equipe()`
promove uma dedução a cadastro quando o gestor confirma — e aí a
declaração é dele, com autor e data.

> **A regra geral:** dado deduzido pode decidir, desde que a tela diga
> que foi deduzido. O problema nunca é a dedução; é a dedução calada.

### D-083 · Vincular supervisor é do gestor, e exige o papel antes
`equipe.supervisor_nome` é texto do TOA — 85 de 89 equipes, 5
supervisores. `equipe.supervisor_id` é o vínculo com o login, e estava em
**0 de 89**: por isso o papel SUPERVISOR entrava e via a tela vazia
(D-066).

Nome não serve de chave: bate por acaso e deixa de bater por acento. Mas
serve de **filtro** para o gestor dizer "estas 21 equipes são do Luiz
Henrique, e o login dele é este". A aba *Supervisores* em Administração
faz isso em um clique por supervisor, em vez de 21.

`definir_supervisor_das_equipes()` **exige que o usuário já tenha o papel
SUPERVISOR**. Sem o papel, o vínculo não abre nada — e a pessoa acharia
que estava feito.

> ⚠ **Ainda depende do Emanuel:** os cinco supervisores não têm login
> nenhum. Criar conta é ação dele — a tela de Administração faz isso pela
> Edge Function `admin-usuarios` (D-051). Depois de criado o login com o
> papel SUPERVISOR, o vínculo é um clique.

---

## 2026-09-07 (noite) — Fuso, sessão, e quem tem o direito de declarar

### D-084 · O painel abria no dia seguinte, porque a data era UTC
`new Date().toISOString().slice(0,10)` devolve a data em **UTC**. Manaus
é UTC−4: às 22h do dia 7, em UTC já é dia 8. O painel abria em 08/09 e
dizia *"Nenhuma visita neste período"* para uma operação que ainda
estava trabalhando.

Eram **nove cópias da mesma linha errada** — toda tela que abre "em
hoje" passava por ela, e `metricas.ts` também usava no cálculo do que é
"hoje". Viraram uma só: `isoLocal()` em `lib/formato.ts`, que monta a
data pelos getters locais em vez de converter para UTC.

Conferido às 22:06 em Manaus: relógio local 07/09, UTC 08/09,
`isoLocal()` 07/09, tela 07/09.

> ⚠ Ela usa o fuso do computador de quem olha. Para as 18 praças (AM e
> RO em UTC−4, as demais em UTC−3) cada um vê o próprio dia — certo
> enquanto a tela for de uma praça só. No dia em que o COP em Manaus
> precisar olhar o dia de Belém, isto vira `base.fuso` e uma conversão
> explícita.

### D-085 · Sessão renovada não pode remontar a tela
O `supabase-js` renova o token sozinho e dispara `onAuthStateChange`
**toda vez que a aba recupera o foco**. O objeto de sessão vem novo a
cada disparo: mesma pessoa, mesma permissão, referência diferente.

Guardar esse objeto direto no estado fazia o React remontar a árvore
inteira — piscava o "Carregando…", refazia perfil, papéis e permissões,
e **cada página refazia as consultas dela**. Sair para olhar outra coisa
e voltar recarregava tudo.

O que a aplicação usa da sessão é o **ID de quem está logado**. Se o ID
não mudou, nada mudou para a tela; o token renovado o próprio cliente já
usa por dentro. O efeito passou a depender do ID, não do objeto.

Conferido com `refreshSession()` de verdade: 51 linhas antes, 51 depois,
zero reconsulta, sem piscar.

> **A regra:** estado derivado de biblioteca externa deve guardar o
> **valor** que interessa, não o objeto que a biblioteca devolve. Objeto
> novo com conteúdo igual é re-render garantido.

### D-086 · Arquivo certo na tela errada não é erro de arquivo
Os dois botões se chamam "Importar planilha": um na tela de Equipes
(planilha de equipes), outro em Importar TOA (atividades). A planilha de
atividades largada na primeira devolvia *"Colunas ausentes: LOGIN, NOME
DO TÉCNICO, EQUIPE, SUPERVISOR, ÁREA"* — o que manda a pessoa procurar
defeito num arquivo que não tem defeito.

A tela passou a reconhecer a assinatura do TOA (`ID da Atividade` +
`Status da Atividade`, que a planilha de equipes não tem) e a dizer:
*"Esta é a planilha de ATIVIDADES do TOA. O arquivo está certo; só está
na tela errada"*, com link para a tela certa.

> Mensagem de erro que descreve o sintoma custa uma hora de quem lê.
> Mensagem que nomeia a causa custa um clique.

### D-087 · O Login TOA entra na hora de criar o acesso
Criar o acesso não bastava: `tecnico.usuario_id` continuava nulo, e é ele
que o RLS consulta (`meu_tecnico_id`, `equipes_visiveis`) para saber qual
agenda a pessoa enxerga. **O técnico entrava no app e via tela vazia** —
e ninguém sabia por quê.

O elo é o **Login do TOA**, que é a matrícula do técnico: o mesmo valor
que a importação usa para rotear o contrato. Pedi-lo na hora de criar o
acesso é pedir a coisa certa no momento certo.

Duas travas, porque cada uma corrompe uma conta diferente:

- **um técnico só pode ter um login** — dois acessos para a mesma pessoa
  fariam a produtividade dela contar em dois lugares
- **um acesso só responde por um técnico** — o anterior é solto

Se o vínculo falhar, o recado diz as **duas** coisas — acesso criado,
vínculo não —, para ninguém criar o usuário de novo achando que nada
aconteceu. E se o login não existir, o erro manda importar a planilha de
equipes, em vez de criar o acesso e deixar o problema para o técnico
descobrir em campo.

### D-088 · Só o cadastro roteia — REVOGA o critério 3 do D-082
> *"Está jogando para equipes que eu nem disse que o login x é da equipe
> x. Os contratos deveriam ir para a equipe 'Sem login definido'. O
> usuário, ao cadastrar, vai dizer: login tal é do Fernando, vai para
> equipe X."* — Emanuel, 07/09

`equipe_do_login` tinha três critérios. O terceiro casava o login com a
**matrícula** do técnico e usava a equipe dele — mandando contrato para
equipe que ninguém declarou.

No D-082 eu tinha decidido manter esse critério, com o argumento de que
vinha da planilha de equipes. **Estava errado, e a decisão nunca foi
minha.** A matrícula diz de *quem* é o login; não diz de qual *equipe*
ele é. São perguntas diferentes.

Deduzir pela matrícula parecia inofensivo porque acerta na maioria das
vezes — e é exatamente isso que faz ninguém perceber quando erra.

| Situação | Destino |
|---|---|
| Login cadastrado | vai para a equipe |
| Login sem cadastro | vai para **"Sem login definido"** |
| Sem login (jornada) | não vai para lugar nenhum |

Depois de realinhar: 337 visitas de 46 logins no abrigo, 121 de 9 logins
em equipe cadastrada, 159 de jornada sem equipe.

**Cadastrar leva os contratos junto**, e vale desde a **primeira visita
daquele login**, não desde hoje. Sem isso o usuário cadastraria, veria a
etiqueta mudar e continuaria com 337 contratos no abrigo — concluindo,
com razão, que o cadastro não serviu para nada.

A tela de Equipes lista os logins sem dono com o nome do técnico e a
equipe dele como **sugestão** da planilha; quem confirma é o usuário, no
botão "é desta equipe".

> **A regra que sobra das três voltas neste assunto (D-079, D-082,
> D-088):** o sistema pode sugerir, e deve mostrar que sugeriu. O que
> ele não pode é declarar no lugar de quem opera — nem gravando cadastro
> que ninguém digitou (D-079), nem roteando por dedução calada (D-088).

### D-089 · Sem autor não é cadastro — e a tela para de sugerir
> *"A sugestão não quero que apareça, todos sabem que precisa ter
> cadastro. Outra coisa: por que tem 1 técnico que tem os contratos na
> equipe? Eu não cadastrei nenhum usuário ainda."* — Emanuel, 07/09

Duas coisas na mesma frase, e a segunda é a mais grave.

**A sugestão sai.** O nome do técnico e a equipe dele saíam de casar o
login com a matrícula da planilha — a mesma dedução que o D-088 tirou do
roteamento, sobrevivendo como texto na tela e como valor já escolhido no
select. Botão que só precisa de um clique para confirmar um palpite não
é confirmação, é aprovação automática. O bloco mostra agora só login,
número de visitas e datas; quem sabe de quem é o login é quem opera.

**A 039 preservou 9 cadastros que ninguém fez.** Ela apagou os 45 que eu
tinha deduzido e manteve 9 porque "já estavam lá em 06/09". Só que as
nove linhas de `equipe_login_toa` têm o **mesmo `criado_em`**
(2026-09-06 04:06:04.121795) e **`criado_por` nulo**: seed de migration,
não declaração. Eram elas que punham 121 contratos em equipe sem
ninguém ter dito nada — inclusive os 7 da 011 que o Emanuel viu.

> **"Estava lá antes" não é prova de cadastro. Prova de cadastro é ter
> AUTOR.**

Por isso o autor virou **critério**, não só carimbo de auditoria:
`equipe_do_login` exige `criado_por is not null`, `equipe_login_toa`
ganhou `check (criado_por is not null)` e default `auth.uid()`. Nenhum
seed futuro consegue se passar por declaração.

Junto saiu o critério 2 (`equipe.login_toa` solto): a coluna não guarda
quem disse nem desde quando, então qualquer rotina que a preenchesse
voltaria a rotear calada. Ela continua existindo para a tela mostrar o
login corrente da equipe; deixou é de decidir. **Fonte única de
roteamento: `equipe_login_toa` com autor.**

Depois de desfazer: 1 cadastro (027 · Z428441, feito pelo Emanuel na
tela), 455 contratos no abrigo, 3 em equipe, 159 de jornada. Os 121 que
voltaram levaram **evento de transferência** — ninguém descobre depois
que a equipe mudou sozinha.

### D-090 · Técnico se desliga; apagar é conserto de cadastro
> *"Quando um técnico for desligado, o usuário não vai poder apagar ele,
> somente o admin, só pode aparecer o botão desativar — não podemos
> perder o histórico de contratos executados da equipe, tudo precisa
> ficar gravado."* — Emanuel, 07/09
>
> *"Ninguém precisa apagar, até porque precisamos muito do histórico.
> Porém só pode ser apagado se for cadastrado errado, ou seja, o técnico
> não tem histórico nenhum."* — Emanuel, 07/09

São **duas operações diferentes** que a tela tratava como uma só:

| | Desligar | Apagar |
|---|---|---|
| O que é | a pessoa saiu da empresa | o cadastro nunca deveria existir |
| Quem faz | quem tem `equipes.editar` | só **ADMIN** |
| Histórico | fica inteiro | não há |
| Onde está | botão na tela | em lugar nenhum da tela |

`tecnico_escrita` era uma policy `ALL` para gestor: **qualquer COP podia
dar DELETE** e levar junto a autoria de cada baixa. Virou três policies
— insert/update para gestor, delete só para `tem_papel('ADMIN')`.

A policy diz *quem* apaga. Quem diz *o que* não se apaga é **trigger**:
policy não olha as outras tabelas, e um DELETE barrado por FK devolveria
`violates foreign key constraint` — verdade, e ilegível para quem só
queria desligar o técnico que saiu. `tecnico_nao_se_apaga` conta visita,
evento, evidência, movimento de equipamento e perfil vinculado, e manda
desligar. Vale **para o ADMIN também**: com histórico, ninguém apaga.
Mesma proteção na `equipe`, mais a recusa de apagar o abrigo.

Desligar não é UPDATE direto: RLS não restringe COLUNA (D-050), e um
update liberado por linha deixaria mexer em matrícula e equipe de
carona. A tela chama `mudar_situacao_tecnico`, que muda só a situação e
grava `situacao_em` e `situacao_por` — quem desligou, e quando.

### D-091 · Os dois exports do TOA entram; o que muda é o nome
> *"Vi que meu sistema está importando informações a mais e a menos. Os
> dois são aceitos? Um tem o nome do login, o outro não tem."*
> — Emanuel, 07/09

Conferidos os dois arquivos de 07/09 — 66 linhas cada, mesmas colunas na
mesma ordem, uma diferença:

| | Colunas | Login do Técnico | Recurso |
|---|---|---|---|
| `Atividades…(5).xlsx` | 120 | sim | **não** |
| `Atividades…(4).xlsx` | 121 | sim | **sim** |

**Os dois têm o login.** A coluna a mais no (4) é `Recurso`, e ela não é
o login: é o **nome** de quem estava logado — `Z634559` → `FABIO SOUZA
DA SILVA`.

Os dois são aceitos, e a coluna extra no começo não desloca a leitura:
`toa.ts` desduplica os cabeçalhos **por posição** (D-013) e depois monta
o objeto **pela chave**. Coluna a mais na frente não empurra nada.

O defeito estava em outro lugar: **o `Recurso` já vinha sendo gravado em
`dados_origem` e ninguém lia**. 207 das 617 visitas o têm — 27 dos 55
logins —, e a tela de Equipes perguntava "de quem é o Z634559?" com a
resposta dentro do próprio registro.

Isto **não revoga o D-089**. Lá o nome era dedução nossa, de casar o
login com a matrícula da planilha de equipes. Aqui é o campo que o TOA
emite junto do apontamento.

> **Sugestão continua fora; dado da fonte entra.** O nome diz *de quem é
> o login* — que é a pergunta que trava o cadastro. Quem diz a *equipe*
> continua sendo quem opera.

A prévia da importação passa a dizer o que o arquivo traz, porque a
escolha do export tem consequência operacional: sem `Recurso`, o login
aparece na tela sem nome e alguém tem de saber de cor de quem ele é.

Sobra uma pista para depois: **50 apontamentos de jornada sem login têm
`Recurso` preenchido** — é o caminho para ligar jornada ao técnico sem
inventar nada.

### D-092 · A grade da lista de contratos é translúcida
> *"No print de contratos deve haver uma divisão melhor, uma linha
> transparente separando contrato por contrato, e coluna por coluna."*
> — Emanuel, 07/09

A lista tinha faixa colorida à esquerda e fundo tingido por situação,
mas nenhuma divisória: com endereço em duas linhas e até 10 O.S. na
mesma célula, os blocos encostavam um no outro.

Divisória de cor fixa não serve: a rampa grafite **inverte** no tema
claro (D-011), e uma borda escura fixa viraria risco preto sobre branco.
A grade usa `graf-500` **com alpha** — 25% entre contratos, 15% entre
colunas —, que é cinza médio nos dois temas e se apoia sobre o fundo
tingido da situação em vez de brigar com ele.

### D-093 · Jornada sem login fica sem equipe, e está certo assim
> *"Vai ficar sem equipe. Sabemos quem executou, o login que executou,
> porém vai ficar sem equipe, pois o usuário não cadastrou ninguém com
> todos os dados: CPF, data e etc."* — Emanuel, 07/09

Eu tinha apontado que **50 dos 159 apontamentos de jornada** trazem o
`Recurso` preenchido (D-091) e sugerido que era "o caminho para ligar
jornada ao técnico sem inventar nada". **Não é**, e a resposta do
Emanuel fecha a questão: saber *quem* executou não é o mesmo que ter
*cadastro* — e sem cadastro não há equipe.

É a mesma regra do D-088 e do D-089, aplicada a outro campo. Trocaria a
dedução pela matrícula por uma dedução pelo nome do recurso, que é
igualmente uma conclusão minha sobre a qual ninguém foi consultado.
**Reconhecer a pessoa não a cadastra.**

O estado do banco confirma o argumento — dos **104 técnicos**:

| Campo | Preenchidos |
|---|---|
| matrícula, nome, equipe, skill | 104 |
| CPF, telefone, admissão, foto, acesso | **0** |

Os 104 saíram todos da planilha de equipes. Nenhuma pessoa foi
cadastrada; o que existe é o eco de um import. Atribuir jornada a uma
equipe com base nisso daria número de produtividade a um cadastro que
ninguém conferiu.

> **Fica como está:** jornada sem login não entra em equipe nenhuma. O
> `Recurso` continua servindo para *identificar* o login na hora de
> cadastrar (D-091) — não para atribuir.

**Em aberto:** a ficha de cadastro do técnico (CPF, admissão, telefone,
foto, contato) não existe em tela. Enquanto não existir, "técnico
cadastrado" e "técnico que apareceu na planilha" são indistinguíveis —
e o D-090 (desligar em vez de apagar) opera sobre linhas de planilha.

### D-094 · A skill do técnico é a chave do dinheiro, não um rótulo
> *"Falo do cadastro do técnico, que precisa ser nessa parte. Precisa ter
> skill, se é ADESÃO, MANUTENÇÃO, DESCONEXÃO. Não precisa mudar nada,
> somente dados a mais na tela de cadastro, como RG e nascimento e
> skill, que está faltando."* — Emanuel, 07/09

O cadastro do técnico é a tela de **Administração → Usuários** — a mesma
que cria o acesso. Não há ficha separada, e não precisa haver.

**RG e nascimento não custaram nada:** `perfil.rg` e
`perfil.data_nascimento` já existiam, e a Edge Function `admin-usuarios`
já os aceitava no corpo. Só a tela não mandava.

**A skill custou**, porque `tecnico.skill` não é rótulo: é a chave por
onde o técnico acha `meta_tecnico` e `faixa_comissao` (D-077). Os 104
valem `SINGLE MASTER` — valor que **eu** pus como default na 037, não
que veio do TOA. A "Habilidade de Trabalho" da planilha é outra coisa
(`Instalação(1/100), Escada(1/100)…`).

Gravar `ADESÃO` num técnico sem existir faixa de ADESÃO faz o "a
receber" dele virar **R$ 0 em silêncio**. Perguntado, o Emanuel decidiu:
as três substituem, **e cada uma terá meta e faixas próprias**, que ele
vai levantar.

Daí as três peças:

1. **Domínio em tabela, não em `check`** — skill nova é decisão de
   operação; ninguém deveria precisar de migration para acrescentar uma.
   As três entram ativas; `SINGLE MASTER` fica **inativa**: não se
   escolhe mais, mas continua valendo para os 104 que ainda são ela e
   cujas faixas funcionam. **Esta migration não converte ninguém** —
   converter seria mandar 104 técnicos para uma tabela de comissão que
   não existe.

2. **`definir_skill_tecnico(login_toa, skill)`** grava e **devolve
   quantas faixas aquela skill tem**. Quem cadastra precisa saber na
   hora que acabou de deixar o técnico fora da tabela — a tela repete o
   aviso ao escolher e ao salvar.

3. **A tabela de comissão deixou de ser fixa em SINGLE MASTER.** Estava
   escrita no código em 4 lugares. Enquanto havia uma skill só, dava
   para fixar; com três, fixar significaria *não ter onde cadastrar as
   outras duas* — a decisão do Emanuel ("cada uma tem faixas próprias")
   seria impossível de executar na tela que ele tem. Agora há um seletor,
   e a skill sem tabela diz isso em amarelo em vez de devolver R$ 0.

### D-095 · Uma linha de contrato só, para as duas telas
> *"Faixa de visão de Serviço: precisa passar esse modelo do contrato
> para a faixa de visão por equipe. Quando abre a equipe é diferente,
> precisa ser igual, é melhor."* — Emanuel, 07/09

Serviços mostrava o contrato numa **tabela**: faixa de situação à
esquerda, colunas fixas, O.S. e as duas baixas na própria linha.
Equipes, ao abrir uma equipe, mostrava **os mesmos contratos** como
cartão empilhado — outra ordem de leitura, outros rótulos, menos
informação (sem pontuação, sem baixa da AFLINE, sem sub-falha, sem
marcadores).

Duas linguagens para o mesmo objeto obrigam quem opera a reaprender a
ler quando muda de tela. Pior: elas **divergem sozinhas** — a coluna
nova entra numa e não na outra, e ninguém percebe.

Por isso não foi "copiar o visual": a linha virou **um componente só**,
`components/TabelaContratos.tsx`, com o `SELECT` que a alimenta
exportado ao lado. Quem consulta usa o mesmo `SELECT_CONTRATO` e não
descobre na tela que faltou um campo.

O que muda entre as telas são **as colunas de contexto**, opcionais:
dentro de uma equipe, num dia, repetir "Equipe" e "Data" em cada linha é
ruído. O resto é idêntico — de propósito. As ações também são da tela:
Serviços passa o menu de botão direito; Equipes passa só "abrir".

Efeito colateral bom: a expansão da equipe ganhou o que só existia em
Serviços — **pontuação, baixa da AFLINE com sub-falha e marcadores de
qualidade**. Não foi feature nova; era informação que já estava no banco
e a outra tela não mostrava.

### D-096 · A fila de cadastro vai para o rodapé
> *"Essa sugestão para atualizar equipes tem que ficar no final da
> página; essa de baixo, com os cadastrados, tem que ficar em cima."*
> — Emanuel, 08/09

Os blocos de pendência — os logins sem cadastro e os técnicos fora da
planilha — abriam a tela de Equipes. Com 58 logins, o painel do dia
ficava a **duas telas de rolagem** de quem só queria ver como as equipes
estão indo.

Quem abre Equipes vem ver o dia das equipes que **existem**. A fila de
cadastro é trabalho de fundo: precisa aparecer — e continua aparecendo
inteira, com o contador na linha do abrigo —, mas não empurra o painel
para fora da primeira tela.

### D-097 · O código de baixa decide a situação — o status, não
> *"Analise os 2 meses do analítico do concorrente: quais códigos devem
> ir para cancelado, concluído ou reagendado. (…) Quando o técnico
> finaliza no TOA, com status concluído ou não concluído, o contrato foi
> baixado de fato — aí o sistema deve baixar automático, ou ter um
> controle para habilitar e desativar."* — Emanuel, 08/09

Cruzamento de **67.485 linhas** (meses 06 e 07/2026), `Código De Baixa`
× `Situação`:

| Situação | Linhas |
|---|---|
| Concluido | 41.952 |
| Reagendamento | 11.779 |
| Cancelado | 9.829 |
| Entrada / execução / deslocamento / pendente | 3.925 |

**203 dos 206 códigos são determinísticos** — cada um cai sempre na
mesma situação, em 57.281 das 63.560 linhas com resultado final. Não é
tendência, é regra:

```
409 · Instalacao Efetuada ....... CONCLUIDA      21.222×  100%
106 · Cliente Ausente ........... REAGENDAMENTO   3.550×  100%
301 · Tipo de OS Incorreta ...... CANCELADA         882×  100%
```

Os 3 que não são puros entram com a **pureza medida**, em vez de virarem
regra silenciosa: `800 · Desatribuido` (90,2% cancelado) e `217 ·
BACKBONE GPON` (85,6% reagendado); o terceiro é linha sem código.

> ⚠ **O status da operadora NÃO decide a situação.** Foi a primeira
> hipótese que testei, porque era o caminho óbvio — e o dado desmentiu:
>
> ```
> EXECUTADA     → Concluído 33.688 · Reagendamento 1.075 · Cancelado 657
> NÃO EXECUTADA → Reagendamento 6.597 · Cancelado 2.090 · Concluído 502
> ```
>
> O status diz que **houve baixa**; o código diz **o que ela significa**.
> Confundir os dois mandaria 1.732 contratos EXECUTADA para "concluída"
> sendo que foram reagendados ou cancelados.

Por isso as duas coisas são separadas no banco:
`codigo_baixa.situacao_destino` (o significado) e o parâmetro
`baixa_automatica` (se agimos sozinhos quando a baixa chega).

**A baixa automática nasce desligada**, e ligá-la é ato de ADMIN, na
tela — não da migration. Quando ligada, na importação:

- só age se **todas** as O.S. da visita têm código com destino — meia
  baixa não é baixa;
- o resultado é o da O.S. **mais grave**: cancelada > reagendada >
  concluída, senão o cancelamento sumiria do painel;
- **não sobrescreve contrato tocado pelo campo** (`bloqueado_em`);
- deixa **evento** — situação que muda sozinha sem registro é a que
  ninguém consegue explicar depois.

Hoje, ligada, ela mudaria **104 das 935 visitas**. O número aparece
antes de ligar, não depois.

O painel fica em **Configurações → Baixa e situação**, e distingue o que
veio de `análise` do que alguém declarou (`cadastro`) — pela mesma razão
do D-089: dedução minha, ainda que de 67 mil linhas, não é declaração de
quem opera. O que o usuário muda vira cadastro e não é mais tocado.

**23 dos 168 códigos ficaram sem destino** — nenhum deles aparece em
O.S. do banco hoje. A tela lista e avisa: visita com código sem destino
não é baixada sozinha.

### D-098 · O menu recolhe, e lembra disso
> *"Menu precisa ser retrátil, por favor."* — Emanuel, 08/09

A lateral fixa come 224px. Em tela de 1366 isso é a diferença entre ver
a coluna "Ordens de serviço" inteira ou não.

Recolhido, o menu **não some**: vira uma faixa de 56px com as iniciais e
o nome no `title`. Sumir de vez tiraria a navegação da tela — a ideia é
ganhar espaço, não se perder. A preferência fica no navegador, como a do
tema (D-084): preferência que volta ao normal a cada F5 não é
preferência. No celular nada muda — lá a navegação é a barra inferior, e
não há lateral para recolher.

### D-099 · TEC1 — a regra veio do painel dele, não de mim
> *"Analise o HTML e busque a regra do TEC1: quando o contrato for
> finalizado no TOA, deve subir um sinalizador — TEC1 PADRÃO, TEC1 SEM
> PADRÃO. Precisa subir na situação e aparecer como coluna no
> relatório."* — Emanuel, 08/09

A regra foi **lida** de `painel_produtividade.html` (função
`classifyTEC1Row`), o painel que ele já usa. Não inventei nada — e é
justamente o tipo de coisa que a regra de ouro nº 1 manda não inventar.

| | Manutenção | Instalação |
|---|---|---|
| O que é | `VISITA TECNICA` ou `RETORNO`, exceto `RETORNO DE CREDENCIADA` | todo o resto |
| Carência | 59 min | 119 min |

**Só entram atividades Concluído ou Não Concluído no TOA** — que é
exatamente o "quando for finalizado no TOA" que ele descreveu. Cancelado,
Suspenso, Iniciado e Pendente nem são avaliados.

```
1) encerrou até o fim da janela ....... PADRÃO (qualquer status)
2) passou da janela e EXECUTADO ....... PADRÃO se dentro da carência
3) passou da janela, não executado:
     manutenção .......................  não se aplica
     instalação ....................... SEM PADRÃO
```

Expurgos, que contam à parte e não como falha: `Não Concluído` +
"Cancelado no Sistema NETSMS", e janela `Imediata`.

Nos 935 contratos de hoje: **363 PADRÃO · 14 SEM PADRÃO · 24 expurgadas
· 534 sem regra aplicável** — 96,3%, contra a meta de 95% do painel.

> ⚠ **Não substitui a coluna "Aderência à janela"** que o relatório já
> tinha. Aquela mede se o técnico **chegou** dentro da janela; o TEC1
> olha o **fim**, com carência. São perguntas diferentes e as duas
> continuam no relatório, em colunas separadas.

Duas armadilhas que esta função pagou, e que ficam registradas:
`unaccent_simples` não existe (quem normaliza é `norm_txt`), e a
variável record não pode se chamar `v` quando a tabela tem alias `v` —
o plpgsql resolve `v.id` como a variável ainda não atribuída e estoura
*"record v is not assigned yet"*.

O TEC1 é recalculado **a cada importação, sempre** — mesmo com a baixa
automática desligada. Ele é medição, não decisão: não muda o contrato,
só diz se a janela foi respeitada.

### D-100 · Excluir em lote, sem atalho na regra
> *"Deve ter uma função de clicar no lado direito e apagar individual,
> ou caixa seletora para apagar todas as atividades ou somente
> algumas."* — Emanuel, 08/09

`excluir_visitas` chama `excluir_visita` **uma por uma**. Parece
desperdício e não é: a barreira (papel + permissão `servicos.excluir` +
motivo obrigatório) e o evento por contrato continuam idênticos. Lote
que toma um atalho pela regra é a forma clássica de apagar em massa o
que a exclusão individual teria recusado.

Três decisões de segurança:

- **Limite de 500 por vez.** Seleção de milhares é quase sempre engano
  de "selecionar tudo" num filtro largo.
- **"Selecionar todos" marca o que está NA TELA**, não o que existe no
  banco. Marcar 900 linhas invisíveis seria uma armadilha.
- **Se nenhum contrato saiu mas houve erro, a função levanta exceção.**
  "0 excluídos" numa mensagem verde esconderia a recusa.

A exclusão continua **lógica**: o contrato sai da tela e permanece no
banco, com autor e motivo.


### D-101 · Apagar de vez — REVOGA a exclusão lógica no lote
> *"Eles precisam sair do banco de vez ok."* — Emanuel, 08/09

A exclusão era lógica (`excluido_em`): fora da tela, dentro do banco.
Agora o lote dá **DELETE**. Vai junto, por CASCADE: O.S., eventos,
marcadores, evidências, equipamentos e a reincidência.

Três travas, porque isto não se desfaz:

- **Só ADMIN.** A exclusão lógica é de gestor e controlador; esta não.
  Quem marca é um papel, quem apaga é outro.
- **Duas confirmações**: o motivo (que o banco exige) e a palavra
  `APAGAR` digitada. Clicar "ok" duas vezes é fácil de fazer sem ler.
- **Registro em `exclusao_definitiva`**, gravado *antes* do delete — só
  a função escreve nele, e ele não guarda nome, telefone nem endereço:
  dado pessoal também tem de sair do banco (LGPD). Guarda o que responde
  "quem apagou o contrato X, quando e por quê".

> ⚠ **O contrato apagado volta se o mesmo arquivo for reimportado.** O
> importador procura por `toa_atividade_id` e não filtra excluídas — com
> exclusão lógica ele encontrava a linha e a mantinha excluída; sem a
> linha, ele cria de novo. Por isso o registro guarda o
> `toa_atividade_id`: a lista para o importador respeitar a exclusão já
> existe, e vira uma linha de código no dia em que o Emanuel disser que
> é para respeitar.


### D-102 · O log da exclusão, e a visão de equipe fica igual mesmo
> *"Definitivo. Depois só tem que ter um log, caso tenha alguma
> investigação de fraude ou algo do tipo, sabermos quem excluiu o
> contrato tal."*
>
> *"Na visão equipe ainda falta alguns campos que na visão serviço tem
> com relação aos contratos."* — Emanuel, 08/09

**O individual também apaga de vez.** O botão direito e o modal
passaram a chamar `excluir_visitas_definitivo`, com as mesmas duas
travas do lote: motivo e a palavra `APAGAR` digitada — aqui num campo,
não num `prompt`. Ficou um caminho só: em qualquer lugar da tela,
apagar é apagar.

**O log ganhou tela**, em Administração → *Contratos apagados*: quando,
quem, contrato, WO, ID do TOA, data, equipe, situação, quantas O.S. e o
motivo. Só gestor lê; ninguém escreve por ali — quem grava é a própria
função de exclusão, que é `SECURITY DEFINER`. Registro de auditoria que
a tela pode editar não é auditoria.

**A visão de equipe estava mesmo incompleta**, e o D-095 tinha resolvido
só metade: as colunas ficaram iguais, mas as *ações* não. Faltavam o
menu de botão direito, o `⋯`, e o contrato abria numa página em vez do
modal — ou seja, dentro da equipe não dava para baixar, transferir,
marcar nem apagar sem sair da tela.

Agora as duas telas têm o mesmo modal e o mesmo menu. Tirar a coluna
**Data** foi economia mal-feita: o painel é por dia, mas quem olha um
contrato quer a data escrita nele — o Emanuel pediu de volta e ela
voltou. Fora fica só a coluna **Equipe**, que dentro da equipe
repetiria o cabeçalho em cada linha.


### D-103 · O status do TOA não conclui contrato — e o "encerrou" some
> *"Esse 'encerrou' tira, se o técnico nem encerrou ainda."*
>
> *"Uma W.O. foi reagendada, código 101, e a outra foi executada. O
> sistema acabou baixando uma de forma automática."* — Emanuel, 08/09

Um contrato só, o **227014948**, mostrou as duas pontas do mesmo
defeito:

| WO | Status no TOA | A tela dizia | O código diz |
|---|---|---|---|
| 231344870 | concluído | **CONCLUÍDA** | 101 Endereço Não Localizado → **reagendamento** |
| 231380148 | iniciado | **EM EXECUÇÃO** | 409 Instalação Efetuada → **concluída** |

Uma concluída sem ter sido feita; a outra feita sem ser concluída. É o
D-097 outra vez, agora doendo: **o status diz que a atividade encerrou;
o código diz o que aconteceu.**

Medido no banco antes de corrigir: **110 contratos com a situação
errada, 77 deles marcados como concluídos** sem terem sido. Esse número
ia direto para produtividade e faturamento.

Daqui em diante `situacao_do_toa` **não conclui nada**. Ela leva até
onde é operação — entrada, deslocamento, execução, cancelada — e a
conclusão vem de quem tem competência para dizer: a baixa automática,
pelo código, ou o técnico, na tela de campo. É exatamente o modo
desligado que o Emanuel descreveu no D-097: *"fazer somente a leitura
dos códigos e contratos e dá deslocamento e em execução"*.

**O "encerrou" era o mesmo erro na camada de cima.** `fim` vem
preenchido mesmo em atividade só iniciada — a tela mostrava "encerrou
12:00" em **329 das 947 visitas** que ninguém tinha fechado. Agora a
coluna `finalizado_toa` guarda se o status é Concluído ou Não Concluído,
e só aí o horário aparece.

Duas decisões dele, perguntado com os números na mão:

- **A baixa automática foi ligada.** Sem ela, com o status já não
  concluindo, todo contrato ficaria em execução esperando baixa manual.
- **Os 110 contratos antigos ficam como estão.** A correção vale daqui
  para a frente; quem quiser acertar um dia antigo reimporta o arquivo
  daquele dia.


### D-104 · Atividade suspensa não entra
> *"225853870 foi baixado e tem código de baixa, porém o sistema colocou
> como impedimento. Acho que ele pode ter lido a atividade suspensa —
> não vamos ler ela, pois é uma ação que foi suspensa, ou seja não
> aconteceu."* — Emanuel, 08/09

Ele acertou o diagnóstico antes de eu abrir o arquivo. A WO
`00121|231317484` tem **duas atividades** no TOA, do mesmo técnico, no
mesmo dia:

| Atividade | Status | Horário | Baixa |
|---|---|---|---|
| 199375883 | **suspenso** | 08:29–09:40 | nenhuma, nem status de O.S. |
| 199020500 | concluído | 10:28–10:56 | 409 nas duas O.S. |

A suspensa entrava como visita e virava COM IMPEDIMENTO — um contrato
"parado" que na verdade tinha sido executado às 10:56.

Suspensa é **tentativa abortada**: sem baixa, sem O.S. executada, sem
trabalho feito e sem pontuação. Deixa de ser lida, como a linha sem "ID
da Atividade" já era (D-004).

> ⚠ Medido antes de aplicar: das 3 suspensas no banco, **2 estão
> sozinhas na WO**. Para essas, ignorar significa o contrato não
> aparecer em lugar nenhum. Por isso a importação passou a **contar** as
> suspensas e mostrar o número no resumo: some da tela, não do relatório
> da importação.

As 3 que já estão no banco continuam lá — a decisão de não mexer no
histórico (D-103) vale aqui também. Quem quiser tirá-las agora tem o
botão de apagar; quem reimportar o dia já não as recebe.

### D-105 · Buscar um grupo de contratos, dentro do período
> *"Na aba serviço deve ter um filtro no qual eu posso pesquisar um
> grupo de contrato e ele trazer somente do dia, ou do mês conforme a
> data que eu escolher."* — Emanuel, 08/09

A busca já entendia **um** contrato e, ao encontrá-lo, ignorava o
período de propósito (D-069): quem digita um contrato inteiro quer o
histórico dele, e o período esconderia justamente as outras visitas.

Agora ela entende **vários**, colados como vierem — espaço, vírgula,
ponto-e-vírgula ou uma por linha. E a regra do período muda com a
quantidade, porque a intenção muda junto:

| O que se digita | Período |
|---|---|
| um contrato | **ignorado** — histórico completo, dia a dia |
| dois ou mais | **respeitado** — é o dia (ou mês) da tela |

Quem cola quarenta contratos quase sempre quer conferir a lista *do
dia*; quem digita um quer a vida inteira dele. Os dois casos têm um
botão para trocar — "ver todas as datas" / "limitar ao período" — porque
o palpite acerta na maioria, não sempre.

Só vira busca de contrato quando o texto é **só número e separador**:
`R JOAO 123456` continua sendo busca de endereço, não de contrato.


### D-106 · O produto pendente — o que vai ser feito no cliente
> *"Quero visualizar o produto pendente da O.S. Ela fica no analítico do
> TOA, no meio de um monte de texto. Ela mostra o que vai ser feito no
> cliente."* — Emanuel, 08/09

O "monte de texto" é a coluna **Produto**, com até **1.309 caracteres
numa célula só**. Os itens vêm colados, sem separador entre eles:

```
34655828|ACESSO VIRTUA PON|pendente34655829|FIBRA 600MEGA…|pendente
^id      ^nome              ^situação^^ já é o id do próximo item
```

Dá para ler porque a situação é sempre uma palavra em minúsculas e o id
seguinte começa com dígito — `(\d+)\|([^|]+?)\|([a-z]+)` resolve. Na
planilha de 08/09: 240 linhas, **1.858 itens**, duas situações:
`pendente` (695) e `instalado` (1.163). No banco: 5.488 itens, **1.933
pendentes em 441 contratos**.

> ⚠ **O id do item não é o número da O.S.** Tem 8 dígitos, a O.S. tem 10,
> e em 240 linhas conferidas **nenhum bateu** — é o identificador do
> item na assinatura. Por isso o produto amarra no **contrato**, não na
> O.S. Chamar de "produto da O.S." seria inventar um vínculo que o dado
> não tem, e a tela ficaria dizendo uma precisão que não existe.

O dado cru fica em `visita_produto` (item a item, com id e situação); o
resumo do que falta fica em `visita.produtos_pendentes`, para a tela não
ter de embutir 5.488 linhas por consulta.

**A repetição é real e precisa ser lida como tal.** Um contrato com 3
pontos traz "NETFLIX INCLUSO" três vezes — um deles chegou a 33
pendentes. A tela agrupa e mostra `NETFLIX ANUNCIO - INCLUSO ×3`: 33
etiquetas iguais não se leem, e esconder a repetição mentiria sobre o
tamanho do serviço.

Aparece nas duas telas (é o mesmo componente, D-095) e vira coluna
**Produtos pendentes** no relatório exportado.


### D-107 · O produto é da O.S. — pelo Ponto. CORRIGE o D-106
> *"Ele trouxe mais produto do que devia. Quero que traga somente o
> primeiro pendente que aparece da O.S. selecionada; se tiver mais
> pendentes, não vamos trazer da mesma O.S."* — Emanuel, 08/09

**Eu errei no D-106.** Escrevi lá que o produto não amarrava na O.S.
porque comparei o id do item com o **número** da O.S., não bateu em
nenhuma das 240 linhas, e conclui que o vínculo não existia.

O vínculo existia. A tela "Produtos" do TOA chama aquela coluna de
**Ponto** — e a planilha traz `Ponto 1..10` bem ao lado de `Número da
O.S 1..10`. Eu tinha a coluna certa em mãos e comparei com a errada; a
captura de tela que o Emanuel mandou trazia o cabeçalho escrito.

Conferido contra a tela do TOA, contrato 225826503:

| O.S. | Ponto | Pendentes daquele ponto |
|---|---|---|
| 2607853470 | 34668915 | ACESSO VIRTUA |
| 2607853481 | 34668916 | BL 500M SINGLE…, COMODATO, ACESSO GRATIS |

Cobertura: das **1.128 O.S. com ponto, 1.127 casam** com produto.

Cada O.S. passa a mostrar **o primeiro pendente do ponto dela** — o que
vai ser feito ali. Os outros continuam em `visita_produto`, para quem
precisar do detalhe; o que a lista precisa é do primeiro. O maior
contrato saiu de **33 etiquetas para 7**, e as 7 dizem alguma coisa.

> A lição, que já é a terceira do mesmo tipo: **não concluir que um
> vínculo não existe sem olhar todas as colunas que poderiam carregá-lo.**
> "Comparei com o número da O.S. e não bateu" respondia uma pergunta
> menor do que a que eu tinha feito.


### D-108 · A linha da O.S. em dois andares
> *"Precisa organizar melhor a visualização das informações em cada
> linha. Pra mim o produto fica ao lado da O.S. e o código mais abaixo."*
> — Emanuel, 08/09

A célula de O.S. tinha virado uma fila corrida: número, tipo, baixa TOA,
produto e baixa AFLINE, tudo lado a lado, quebrando onde a largura
mandasse. Com cinco O.S. no mesmo contrato ninguém achava onde uma
terminava e a outra começava.

Agora cada O.S. é um bloco de **dois andares**, com barra à esquerda:

```
| 2607386471  12 · MUDANCA DE ENDERECO          ACESSO VIRTUA
| 409 · INSTALAÇÃO EFETUADA
```

- **Andar de cima — identidade e pendência.** Número, tipo e o produto
  que falta fazer, à direita. É o que se procura primeiro: qual O.S. é
  esta e o que ela pede.
- **Andar de baixo — resultado.** As baixas, recuadas. Só interessam
  depois de saber de qual O.S. se fala.

Três detalhes que vieram junto:

- O rótulo "Baixa TOA" saiu da etiqueta. Numa coluna chamada "Ordens de
  serviço", onde a baixa está sempre no mesmo lugar, repetir a palavra
  em toda linha era ruído. A da AFLINE mantém o rótulo, porque é a
  exceção e precisa se distinguir.
- **Situação e Grupo passaram a alinhar no topo.** Numa linha com cinco
  O.S. eles flutuavam no meio da célula, desalinhados de tudo.
- O.S. marcada como não executada pelo TOA ganhou etiqueta discreta —
  antes só dava para saber abrindo o contrato.


### D-109 · A baixa do TOA é cheia; a da AFLINE, vazada
> *"Falta ele informar melhor a baixa TOA do que é baixa ngestor — ele
> meio que colocou todos como igual."* — Emanuel, 08/09

No D-108 eu tirei o rótulo "Baixa TOA" da etiqueta para reduzir ruído.
Foi longe demais: as duas baixas ficaram **idênticas** na tela, porque
elas costumam ser idênticas no conteúdo — mesmo código, mesma descrição,
mesma cor. `409 · INSTALAÇÃO EFETUADA` duas vezes seguidas parece
repetição, não duas fontes.

Cor não distingue o que já é igual em cor — as duas são verdes quando
deu certo, vermelhas quando não deu, e a natureza precisa continuar
mandando na cor. **O que distingue é a forma:**

| | Aparência | Significado |
|---|---|---|
| `TOA` | etiqueta **cheia** | a palavra da operadora, veio no arquivo |
| `AFLINE` | etiqueta **vazada** (só contorno) | a nossa, lançada aqui |

Mais o prefixo curto dentro de cada uma, que resolve no texto o que a
forma resolve no relance. Cheio = veio de fora e não se discute;
vazado = é nosso, foi alguém aqui que digitou.


### D-110 · Ícones no menu, e a lateral que abre no hover
> *"Atribua ícones para cada categoria do menu."* · *"Quando eu encolher
> o retrátil, quando eu colocar o mouse em cima ele pode abrir
> novamente."* — Emanuel, 08/09

Onze ícones SVG escritos à mão, na mesma grade de 24 e com
`currentColor` — a mesma decisão dos gráficos (D-010): uma biblioteca de
ícones traria milhares para usar onze, e teria de ser mantida.

O ganho não é decorativo. Recolhido, o menu mostrava **iniciais**, e `S`
servia para *Serviços* e para *Sub-falhas*. Símbolo distingue onde letra
não distinguia.

E a lateral recolhida **abre sozinha no hover**. A faixa de 56px segura
o espaço no layout; o painel que cresce é `absolute`, por cima do
conteúdo. Menu que empurra a tabela a cada passada de cursor é pior que
menu estreito. O hover não toca na preferência guardada: tirou o mouse,
volta a faixa.

### D-111 · Rota do Dia — a terceira visão
> *"Se eu quisesse olhar a rota como um todo, pra saber se está ajustada
> de fato, queria criar uma visão Router."* — Emanuel, 08/09
>
> *"Autorizado, pode fazer."* — depois de ver a proposta com os números

**Medi antes de desenhar, e a medição é que justificou a tela.** No dia
08/09, com as 248 visitas produtivas que têm login e coordenada:

| | |
|---|---|
| 676 km | rodados no dia, somados os deslocamentos de 45 técnicos |
| 38 de 50 | bairros com mais de um técnico |
| 11 | técnicos diferentes em Alvorada, para 19 visitas |
| 50 | visitas em que o técnico voltou a um bairro onde já tinha estado |

O caso que resume tudo: **Z683677 esteve em Tancredo Neves às 11:37 e
voltou às 21:32**, depois de passar por Lago Azul, Jorge Teixeira, Nova
Cidade e N. Aleixo.

O TOA aloca por habilidade, janela e capacidade — não por geografia.
Não é defeito dele; é o que ele faz. O Console de Alocação mostra *se o
técnico está ocupado*, não *se faz sentido onde ele está*. Serviços
responde pelo contrato, Equipes pela equipe. Ninguém respondia **"a rota
está ajustada?"**.

Três painéis, na ordem em que o COP pensa:

1. **O que precisa de olho** — retorno a bairro já visitado, salto acima
   de 10 km, bairro dividido entre 5+ técnicos. Clicar no alerta foca o
   técnico na linha do tempo.
2. **O dia no tempo** — uma faixa por técnico, um bloco por visita, com
   o **bairro escrito no bloco**. O Console do TOA escreve o tipo de
   serviço ali; trocar pelo bairro é o que faz o zigue-zague aparecer
   sem abrir nada.
3. **O dia no espaço** — bairros pela coordenada média, tamanho por
   visitas e cor por número de técnicos.

Duas decisões que valem registro:

- **A escala do tempo não é fixa em 8h–18h.** Ela vai do primeiro
  início ao último fim do dia. Fixar cortaria justamente o técnico que
  encerrou às 23:30 — que é o que interessa olhar.
- **Os limites (10 km, 5 técnicos) saíram do próprio dia**, do que ficou
  fora da curva. Não são meta da CLARO nem regra da operação, e a tela
  diz isso na cara: número inventado que parece meta vira cobrança
  errada.

> ⚠ **O que a tela não sabe, e admite:** o trajeto percorrido (o TOA
> manda pontos, não caminho), onde o técnico está agora (sem GPS ao
> vivo, isto é o dia agendado, não rastreamento) e a distância de rua —
> o km aqui é linha reta. Serve para comparar e ordenar, não para
> calcular combustível.

Jornada fica de fora: "Na Base" e "Refeição" não são deslocamento para
cliente. A proposta que o Emanuel aprovou está em
`docs/proposta-rota-do-dia.html`.


### D-112 · O aplicativo do técnico é Expo, e mora em `campo/`
> *"tenho que desenvolver para Android e iPhone, técnico tem que tirar
> foto, vídeos e usar a geolocalização"* — Emanuel, 08/09

A tela `/campo` da web já fazia o passo a passo e a baixa. O que ela não
faz — e não vai fazer — é **câmera de verdade e GPS de verdade**. No
navegador do celular a foto passa por um seletor de arquivos, o vídeo
depende de codec, e a localização só existe enquanto a aba está aberta e
o usuário disse "permitir" naquela sessão.

Escolhas, com o porquê:

- **Expo (SDK 57), não React Native puro.** O técnico testa hoje pelo
  **Expo Go**, sem loja, sem build. Câmera, vídeo e GPS funcionam no
  Expo Go — nada que a gente use exige build nativo. Publicar na Play
  Store e na App Store é `eas build` depois, com o mesmo código.
- **Projeto separado, não monorepo.** `app/` é Vite + Tailwind, `campo/`
  é Metro + StyleSheet. As duas árvores não compartilham build, e
  compartilhar `node_modules` entre elas custaria mais do que os ~150
  linhas de domínio que realmente se repetem (`src/lib/dominio.ts` e
  `formato.ts` são gêmeos de propósito — a duplicação é escrita e
  declarada, não acidental).
- **A web `/campo` continua.** Serve o controlador conferindo do
  computador e o técnico sem o aplicativo instalado.

A tela inicial é a **agenda**, não um menu. O concorrente abre com doze
ícones (Ranking, Meta, Premiação, Portaria, Abastecer…) e enterra o
trabalho do dia atrás de dois toques. O técnico abre o aplicativo para
fazer visita.


### D-113 · O técnico só baixa com o GPS ligado
> *"o técnico só pode baixar se estiver ligado"* — Emanuel, 08/09

**Ligado é o GPS** — perguntado e confirmado antes de escrever
qualquer linha.

A baixa é o momento em que a AFLINE afirma à CLARO o que aconteceu no
endereço do assinante. Afirmar isso sem dizer **de onde** é exatamente o
que o sistema atual permite. `baixar_os` agora recusa a chamada do campo
sem `lat/lng` (055-G), e o mesmo vale para **encerrar a visita**
(`registrar_etapa` para situação terminal): encerrar é a mesma
afirmação, feita pela outra porta.

Três limites deliberados:

- **Andar pela tela não exige coordenada.** "A caminho" e "Cheguei"
  passam sem GPS. Travar o passo a passo por causa de satélite é pior
  que registrar sem ele.
- **Foto sem GPS ainda sobe.** Ela guarda `lat`, `lng` e `precisao_m`
  quando dá, e a tela marca "sem GPS" quando não deu. Prova fraca é
  melhor que nenhuma prova — desde que ninguém confunda as duas.
- **Não é cerca eletrônica.** Não conferimos se a coordenada bate com o
  endereço. A tela mostra a distância ("340 m do endereço") e deixa a
  leitura para quem audita. Definir raio aceitável é regra de negócio
  que ninguém pediu.

A assinatura de `baixar_os` mudou de 5 para 7 parâmetros, e a de
`baixar_visita` de 3 para 5. A versão antiga foi **derrubada**, não
mantida ao lado: duas funções com o mesmo nome e defaults deixariam a
chamada de 5 argumentos ambígua para o PostgREST.


### D-114 · Baixa dada não se desfaz pelo campo
> *"o técnico não tem o poder de tirar do cancelado, reagendado,
> executado, uma vez que o sistema baixa ou ele baixar não vai poder"*
> — Emanuel, 08/09

Duas travas, uma ideia:

1. **O.S. com baixa da AFLINE não aceita segunda baixa do campo.** A
   tela web tinha um "Trocar código" que agora só o controlador vê.
2. **Situação terminal não volta.** A trava de 032 pegava `CONCLUIDA` e
   `CANCELADA` e **deixava `REAGENDAMENTO` passar** — justamente a
   situação que a baixa automática do TOA aplica sozinha 1.075 vezes
   (D-097). Agora a lista é `situacoes_terminais()` (035), a mesma que
   as outras portas usam.

Quem corrige é o controlador, que tem `reverter_situacao` e deixa motivo
(D-030). "Campo" aqui é quem **só** tem o papel do campo: um controlador
que também está cadastrado como técnico não perde os poderes de
controlador por abrir o aplicativo.


### D-115 · Depois de baixado ele ainda anexa — mas só no dia
> *"ele vai poder editar foto depois de baixado, ou anexar equipamento
> ou foto não lançada"* — Emanuel, 08/09

Foto que não subiu e equipamento que ele esqueceu de lançar são o caso
comum, não a exceção. Fechar a visita para anexo empurraria isso para o
WhatsApp — que é onde está hoje.

A janela é **o dia do contrato**, escolha do Emanuel entre "sem prazo",
"48 horas" e "só hoje". `pode_anexar_na_visita` (055-D) é o único lugar
onde essa conta é feita, e ela usa **`hoje_local()`**, não
`current_date`: o Postgres da Supabase está em UTC, e em Manaus o dia
vira às 20h — a regra medida em UTC tiraria o celular do técnico do ar
quatro horas antes da meia-noite dele. É o D-084 do lado do banco.

Anexo é **inserção, nunca edição**: não há policy de UPDATE nem de
DELETE no bucket, e não há RPC para apagar evidência. Prova que se
apaga não é prova.

> **Em aberto:** foto errada (dedo na lente, contrato trocado) hoje só
> sai pelo `service_role`. Se isso incomodar na prática, a saída é uma
> RPC de *ocultar com motivo*, não um DELETE.


### D-116 · O caminho do arquivo é a chave da permissão
Evidência mora no bucket privado `evidencia`, sempre em
`<visita_id>/<arquivo>`. O prefixo não é organização: é o que a policy
do Storage usa para descobrir de qual contrato o arquivo é. A regra
inteira é uma linha:

```sql
visita_do_path(name) in (select id from visita)
```

O subselect passa pelo RLS da `visita`, então o arquivo é visível para
**exatamente** quem já podia ver o contrato — sem uma segunda cópia da
regra de escopo para divergir da primeira.

`visita_do_path` existe porque `substring(name,1,36)::uuid` estoura em
qualquer objeto cujo nome não seja um UUID, e policy que estoura vira
negação silenciosa em cima de tudo. O `CASE` garante a ordem de
avaliação.

A foto é reduzida a 1600 px e qualidade 0,7 **antes** de subir: a câmera
de um celular atual entrega 4 a 8 MB por foto, o que no 4G de rua é meio
minuto por evidência — e técnico não espera meio minuto. Vídeo tem teto
de 60 s e 50 MB, checado na gravação e no bucket.

Quando a rede cai, a evidência **entra numa fila** no aparelho e sobe
sozinha depois. Item que falha cinco vezes sai da fila: o arquivo
temporário já foi limpo pelo sistema e insistir só trava a tela.


### D-117 · O cartão do técnico diz quanto vale, e onde é
> *"faltou mais informações na tela dele — número do contrato, pts do
> contrato, node"* — Emanuel, 09/09, depois de rodar o aplicativo

Três campos, e um deles trouxe uma decisão junto.

**O contrato e o node saíram da letra miúda.** O contrato é o que o
técnico fala ao telefone com o COP; o node é o pedaço da planta onde ele
está, e é por ele que se abre chamado com a operadora. Estavam em cinza
12 px — o node nem estava. A coluna `visita.node` vinha do TOA desde a
004 e **nunca tinha sido lida por tela nenhuma** (249 das 364 visitas de
hoje têm valor).

**Os pontos são `pontos_claro`, e não outro número.** É exatamente o que
`produtividade_periodo` soma para dizer "Minha produção no mês" (037), na
mesma tela. Dois números diferentes ali seriam lidos como erro — e com
razão. `pontos_equipe` continua fora: não está em arquivo nenhum
(D-045).

**E aqui está a decisão que o dado forçou.** Ao medir para escrever a
função, apareceu isto:

```
visitas de 09/09:  364
com regra de pontuação:  239
sem regra:               125   ← 34%
```

A cobertura histórica é de 95,4% (D-045); a do dia corrente, não. Se a
coluna devolvesse `0` nas 125, a tela afirmaria **"este serviço não vale
nada"** — e o técnico que lê isso reclama do pagamento. A verdade é
outra: *ainda não sabemos quanto vale*. Então `agenda_do_campo` devolve
`pontos` **NULO** com `pontos_achou = false`, e o cartão escreve **"sem
regra"** em âmbar em vez de um zero.

> Zero e desconhecido não são a mesma coisa, e a diferença entre os dois
> é quem leva a culpa quando o pagamento sai errado.

**De quebra, uma lição de D-081 repetida.** A primeira versão calculava
a pontuação com `pontos_por_periodo(dia, dia)` — o dia inteiro, 364
visitas, para o técnico usar 4. Medido como `authenticated` (não como
dono, que mente): **474 ms**. Trocando por um `cross join lateral` sobre
as visitas que a pessoa já enxerga: **31 ms** para o técnico, 173 ms
para o ADMIN com 250. Quinze vezes.

E `create or replace` não aceita coluna nova no `returns table`
("cannot change return type"). Tem de derrubar — e função recriada do
zero **nasce com a ACL aberta** (CLAUDE.md), então o `revoke ... from
anon` logo abaixo não é decoração.

> **Recusado no mesmo pedido:** um menu de "baixadas · pendentes · em
> entrada" abaixo das abas. O próprio Emanuel voltou atrás — *"acho que
> já tá separado, deixa, não precisa"*. As duas abas **A fazer** e
> **Baixadas** já fazem esse corte, e um terceiro nível dentro delas
> seria navegação para esconder quatro cartões.


### D-118 · O escopo resolve uma vez, não uma vez por linha
> *"pensa que esse sistema vai atender muitas pessoas... quero que seja
> otimizado, sistema rápido sem travamento"* — Emanuel, 09/09

Medido antes de mexer, como `authenticated` e nunca como dono (D-081),
contando as 1.320 visitas:

```
RLS como estava .......... 121 ms
escopo resolvido 1 vez ....  34 ms
```

A causa: `minha_empresa()` e `eh_gestor()` escritos **soltos** dentro da
policy são chamados **uma vez por linha avaliada**. 45 das 86 policies
faziam isso com `minha_empresa()`, 19 com `eh_gestor()`, 29 com
`tem_papel()`.

O custo é **linear no número de linhas** — e é aí que a coisa muda de
tamanho. O banco tem 5 dias de dado hoje. A operação gera ~190 visitas
por dia, ou **~70 mil por ano**. A mesma consulta que hoje leva 121 ms
passaria a levar segundos, e segundos numa lista que o COP abre o dia
inteiro não é lentidão: é a tela travando.

A correção é a mesma ideia do D-081, do lado da policy: `(select f())`
em vez de `f()`. O planner resolve como **InitPlan**, uma vez por
consulta. O resultado é idêntico — função STABLE sem argumento da linha
devolve o mesmo valor de qualquer jeito.

Foi junto uma troca semântica que vale mais amanhã do que hoje:

```sql
-- materializa TODAS as visitas visíveis para decidir sobre UMA evidência
visita_id IN (SELECT visita.id FROM visita)
-- usa a chave primária e para na primeira linha
EXISTS (SELECT 1 FROM visita v WHERE v.id = visita_id)
```

**A reescrita foi automática, e isso foi decisão.** Mexer à mão em 86
regras de acesso é onde se abre buraco sem perceber: um `AND` que vira
`OR`, um parêntese que fecha no lugar errado, e uma equipe passa a ver a
de outra. A transformação é textual, feita a partir do que o próprio
Postgres devolve em `pg_policies`, e a prova são as duas baterias.

```
depois:  visita 121 ms → 7 ms   (17x)
         ordem_servico 5 ms · visita_evento 4 ms
         função de escopo solta: 0 de 86
         testar_policies() 16/16 · testar_campo() 14/14
```

> **A pegadinha que quase me enganou.** A conferência de que não sobrou
> função solta acusou **53 policies**. Não sobrou nenhuma: o Postgres
> devolve o sub-select na forma canônica dele —
> `( SELECT minha_empresa() AS minha_empresa)`, com `SELECT` em
> maiúscula — e a minha expressão procurava `select` minúsculo. A
> conferência tem de ser `~*`, e o `regexp_replace` da migration tem de
> usar o flag `gi`; senão uma segunda passada envolve tudo de novo.


### D-119 · O aviso chega ao campo — e sobrevive à falta de sinal
> *"apenas status do contrato... o operador tem esse poder de mudar o
> status e colocar obs para cada mudança, quando ele fizer isso o
> técnico precisa ver essa mudança"* — Emanuel, 09/09

Hoje o técnico só descobre o que mudou se puxar a tela. O controlador
cancela às 9h e o técnico chega no endereço às 10h.

**A "mensagem livre" não virou chat, e isso foi decisão do Emanuel.**
Perguntei se ele queria conversa COP ↔ técnico; a resposta foi que a
mensagem é a **observação que já acompanha cada mudança de status**.
Isso poupa um recurso inteiro — leitura, resposta, histórico, quem
respondeu a quem — e resolve o que trava a operação: o porquê viaja
colado à mudança, não num canal paralelo que alguém tem de abrir.

**A linha é a verdade; o Realtime é só o carregador.** Realtime é
*fire-and-forget*: quem estava no elevador, no subsolo ou sem 4G não
recebe o evento e nunca saberia que ele existiu. No campo isso não é
exceção, é o dia. Por isso o aviso é uma **linha em `aviso`**; a
assinatura só encurta o caminho quando há sinal.

**O gatilho mora em `visita_evento`, e não nas RPCs.** Toda mudança já
passa por lá — são cinco portas:

```
IMPORTADA/IMPORTACAO ..... 1.320   contrato novo
SITUACAO/IMPORTACAO ......   530   a operadora mexeu
TRANSFERENCIA/SISTEMA ....   465   trocou de equipe
SITUACAO/WEB|TELA ........     8   o controlador mexeu
REVERSAO/WEB .............     —   o controlador reabriu
```

Pendurar o aviso em cada RPC seria escrever a mesma regra cinco vezes e
esquecer na sexta. Um gatilho no funil pega todas — inclusive as que
ainda não existem.

Três detalhes que o dado obrigou:

- **`origem = 'MOBILE'` não vira aviso.** O que o próprio técnico fez no
  celular ele já viu acontecer.
- **A transferência gera DOIS avisos, de lugares diferentes.**
  `transferir_visita` grava a equipe **antiga** no evento e só *depois*
  altera a visita — então, no instante do gatilho, `visita.equipe_id`
  ainda é a antiga. O "saiu" sai de `evento.equipe_id`; o "chegou" sai
  de `para->>'equipe'`, que guarda o **código**, não o id.
- **O gatilho engole o próprio erro.** Se ele estourar, leva junto a
  baixa do técnico ou a importação inteira. Aviso é conveniência; baixa
  é dinheiro. Falhou, vira `raise warning` no log e a vida segue.

**Só `aviso` entra no Realtime, e é o ponto que faz isto aguentar 300
técnicos** (o número que o Emanuel deu):

- a linha é **magra** — não trafega nome, telefone nem endereço de
  assinante pela rede (LGPD). O aparelho recebe o aviso e vai buscar o
  contrato se precisar;
- o aplicativo assina **filtrando por `equipe_id`**, então cada evento
  vai para os poucos aparelhos daquela equipe. Publicar `visita` seria o
  contrário: uma importação que mexe em 300 linhas viraria 90 mil
  entregas, cada uma com o RLS avaliado por conexão. O travamento que
  ele quer evitar, empurrado para a rede.

Lido é por **pessoa**, não por aviso (`aviso_leitura`): uma equipe pode
ter mais de um técnico, e o que um leu o outro não leu.

Testado ponta a ponta dentro de uma transação desfeita no fim — o
controlador reabriu, mudou o status e transferiu; o técnico recebeu os
três, com a observação de cada um:

```
[REABERTO] O controlador reabriu este contrato
           — "Cliente ligou pedindo para ir depois das 14h"
[SITUACAO] O status mudou
           — "Sem viabilidade na rua — nao va"
[SAIU]     Contrato saiu da sua agenda
           — "Passando para a 027, mais perto"
```


### D-120 · A evidência tem de ser olhada, não listada
> *"como faço para essas fotos subirem na visão que temos hoje do web?
> era pra ser nessa aba quando clica em página inteira"* — Emanuel, 09/09

A aba **Anexos** existia desde antes e listava **nome de arquivo**, data
e tamanho. O controlador sabia que a foto existia e não conseguia
olhar — meia funcionalidade: servia para o técnico cumprir a obrigação,
não para a AFLINE provar nada para a CLARO.

Agora a aba traz a imagem, e clicar abre em tela cheia com a **ficha da
prova** ao lado: quem registrou (nome e matrícula, carimbados pelo
servidor), quando, onde com link para o mapa, a origem (aplicativo ou
web) e a observação.

**Três coisas que estavam no banco e nenhuma tela mostrava:**

**1. A precisão do GPS, ao lado da coordenada.** É a diferença entre
prova e enfeite. A primeira foto real do sistema saiu com **±55 m** —
suficiente para registrar, insuficiente para afirmar presença na porta.
Com ±8 m o técnico estava lá; com ±2.000 m ele podia estar na antena
mais próxima. Mostrar a coordenada sem a incerteza faz quem audita
concluir errado, com confiança.

**2. "sem GPS" em cima da miniatura** quando a foto não trouxe
coordenada. Prova fraca continua sendo prova — desde que ninguém
confunda as duas. É a mesma regra do D-117: *zero e desconhecido não são
a mesma coisa*.

**3. Vídeo tem player e duração.** Antes nem aparecia que era vídeo.

**As URLs são assinadas em lote.** O bucket é privado (D-116): um
`<img src>` no caminho cru volta 400 e a tela mostra um quadrado cinza
sem explicação — pior que não mostrar nada. `createSignedUrls` assina o
lote inteiro numa ida; assinar uma a uma seriam N viagens para abrir uma
aba.

Conferido com a foto real que já estava no bucket, simulando os papéis:

```
técnico da 074 abre a foto de outra equipe?  false
admin abre?                                  true
caminho inválido derruba a policy?           false, sem erro
```

O terceiro é o que importa e quase ninguém testa:
`substring(name,1,36)::uuid` num objeto cujo nome não é UUID **estoura e
derruba a policy inteira, em silêncio** — negando tudo, para todos. É a
razão de `visita_do_path` existir com `CASE`.

---

### D-121 · A tela deixa de contar em texto e passa a mostrar proporção

> "me ajude a melhorar mais esta visão do meu acompanhamento de
> contratos e da visão de equipes também, pra não ficar muito copiado da
> concorrente" — Emanuel

O que fazia Serviços e Equipes parecerem o concorrente não era a cor
nem a fonte: era a **gramática de leitura**. Os dois contam tudo em
texto de tamanho igual, e o texto de tamanho igual esconde proporção.

Três lugares onde isso doía, e o que entrou no lugar:

**1. As situações da equipe.** `CONCLUÍDA (163)` e `CANCELADA (17)`
lado a lado, na mesma etiqueta, do mesmo tamanho: o olho lê "parecido".
Entrou a **barra de composição** — uma fatia é dez vezes a outra, e
isso se vê antes de ler. A contagem exata continua escrita embaixo,
ordenada do maior para o menor. Ninguém deve **medir** num desenho de 8
pixels; o desenho responde à pergunta anterior, que é *onde olhar*.

**2. Os períodos da equipe.** A `SEM-LOGIN` trazia **dez linhas** de
`08:00 - 11:00 (20)` empilhadas — meia tela por equipe, e ainda assim
sem responder "a manhã está cheia?". Entrou a **régua do dia** (06h às
22h): cada janela é um bloco, e a intensidade do bloco é a quantidade.
A tabela de equipes encolheu de ~700px para ~120px.

**3. A janela do contrato.** `08:00–12:00 / encerrou 09:48` obriga a
fazer a conta de cabeça, contrato por contrato. Entrou a mesma régua,
com um **risco vertical** no encerramento. A cor do risco **não é
opinião nossa**: é o TEC1 que o servidor calculou (D-099) — verde
dentro do padrão, vermelho fora, **cinza quando não há TEC1**. Sem
janela não há régua e sai escrito "sem janela": janela ausente não é
janela de largura zero (D-117).

Os seis cartões de número grande no topo de Equipes viraram **uma
régua só**. Seis cartões iguais afirmam "seis coisas igualmente
importantes", e não são: a pergunta de quem abre a tela é *quantas
equipes estão rodando hoje*. Essa ocupa a primeira célula, com a
proporção desenhada; o resto é contagem de apoio.

**O filtro de situação virou a própria etiqueta da situação.** Estava
pintando o botão ligado de **vermelho da marca** — ou seja, "Concluída"
ligada acendia exatamente na cor que a tela inteira usa para dizer que
algo deu errado. Agora ligado acende na cor **dela**.

**O que se mexe é o que está acontecendo.** Trilho e bolinha pulsam só
em `EM_DESLOCAMENTO` e `EM_EXECUCAO` — 32 das 265 linhas do dia. Se a
lista inteira pulsasse, o pulso não separaria nada. E o pulso nunca é o
único portador: o rótulo continua escrito, e quem pediu
`prefers-reduced-motion` vê tudo parado com a mesma informação.

**Recusado:** barra de composição clicável. Seria o mesmo comando duas
vezes na mesma tela, e fatia de 5% é alvo de clique ruim para qualquer
pessoa. A barra é `aria-hidden`; quem filtra são os botões, com nome,
contagem e `aria-pressed`.

### D-122 · O quadro rola por dentro, e o cabeçalho fica

Na segunda tela de 265 linhas o cabeçalho já foi embora, e a partir
dali a coluna do meio é um número sem nome. A tabela passou a ter
rolagem própria (`.quadro`), com `thead` grudado no topo dela.

Duas consequências que valem tanto quanto:

**A barra de exclusão em lote saiu de dentro do quadro.** Ela fala das
linhas selecionadas e some de vista enquanto se rola a lista que ela
apaga — o pior lugar possível para um botão que não se desfaz (D-101).
Agora fica presa no topo do cartão.

**A gaveta da equipe também rola por dentro** (26rem). A `SEM-LOGIN`
tem 270 contratos: despejá-los inteiros no meio da página empurra as
outras 106 equipes para fora do mundo.

E a seta da equipe virou **botão de verdade**, com `aria-expanded` e
nome: `<tr onClick>` não é alcançável por Tab, e quem trabalha no
teclado — que é como o Controlador trabalha — não tinha como abrir uma
equipe.

**Não verificado:** o comportamento com 1.320 linhas (o dia cheio, sem
filtro) só foi medido com as 265 de 09/09.

---

### D-123 · A tela abre em HOJE, e dia vazio aparece vazio

> "preciso que nosso sistema quando virar o dia ele mostre somente
> coisas do dia, se não tiver nada, ele não mostra nada entende? ele
> ainda mostra coisas do dia anterior na data de hoje." — Emanuel

**Revoga a D-034.** Serviços, Equipes, Rota do dia e Relatórios abriam
no último dia COM visita. A intenção era evitar tela vazia; o preço era
a tela **mentir a data**. Em 10/09 o painel abria com o movimento de
09/09 — e a data corrigida ficava num campo pequeno no topo, que
ninguém lê quando os números abaixo já parecem os de hoje. Um COP olha
"165 concluídas" e entende "165 concluídas hoje".

É a D-117 outra vez, do outro lado: **quando o sistema não sabe, ele
diz que não sabe.** Dia sem importação não é um defeito a esconder — é
a informação "ainda não chegou nada", e ela vale mais que um número
antigo no lugar certo.

O que se perdeu — descobrir sozinho onde estava o movimento — volta
como **atalho, não como padrão**: o estado vazio oferece *"ver 09/09 —
último dia com movimento"* num clique. A diferença é quem decide.
Mora em `app/src/lib/dia.ts`, num lugar só, porque eram quatro cópias
da mesma consulta.

Some junto o efeito colateral que a D-034 tinha virado regra: como a
data já nasce certa, não há mais o segundo carregamento que corrigia o
primeiro — e nem a corrida entre os dois.

### D-124 · O número da equipe agrupa; quem identifica é a pessoa

> "na concorrência o id era o número da equipe, eu não quero isso […] o
> número da equipe pode se repetir para mais de um técnico, porém o que
> vai diferenciar mesmo é o nome dele e o cpf e rg" — Emanuel

Administração → Novo usuário ganhou o campo **Número da equipe**,
liberado quando o Login TOA é digitado — a mesma regra da Skill, e pela
mesma razão: equipe é do TÉCNICO, e sem login não há em quem gravar.
O login **continua opcional**; sem ele o acesso é criado e simplesmente
não fica ligado a técnico nenhum.

Duas coisas que a tela passou a fazer, e que não são enfeite:

**1. Ela diz de quem é o login ANTES de gravar.** O login do TOA é a
chave do roteamento — `importar_toa` casa `tecnico.matricula` com a
coluna "Login do Técnico" para carimbar `tecnico_responsavel_id`.
Digitar um login que já é de outra pessoa não é um erro de digitação
qualquer: é passar a rota de alguém para outro alguém. A tela mostra
nome e equipe atuais, e avisa quando aquele técnico já tem acesso —
em vez de deixar a descoberta para a mensagem de erro do servidor.

**2. O técnico passa a existir.** `vincular_tecnico_ao_usuario` só LIGA
um acesso a um técnico que já existe; quem criava técnico era a
planilha de equipes. Cadastrar quem ainda não veio na planilha morria
em *"Nao existe tecnico com o login X"*. Agora o cadastro chama antes
`cadastrar_tecnico_avulso`, que cria quando não existe e, quando já
existe, move de equipe e religa os contratos órfãos daquele login.

**O nome que vai para o técnico é o que já estava no cadastro dele**,
não o digitado no formulário: renomear em silêncio o técnico que veio
da planilha seria mudar dado da fonte por efeito colateral de criar um
acesso.

Um defeito apareceu no próprio teste da tela e está consertado: a
equipe sugerida por um login **ficava grudada** ao trocar de login. Com
Z674378 na tela ela vinha "033 - EQUIPE"; apagando e digitando outro
login, a sugestão continuava lá — e gravar dali moveria o técnico novo
para a equipe de alguém que nada tem a ver, em silêncio. Agora a tela
marca o que foi ELA que preencheu: sugestão velha é substituída,
escolha feita à mão sobrevive.

CONFERIDO como `authenticated` (nunca como dono — D-081), em transação
desfeita:

```
login Z999001, que não existia
antes=0  depois=1  nome=FULANO DA SIMULACAO  equipe=022
vincular={"equipe":"022","tecnico":"FULANO DA SIMULACAO","matricula":"Z999001"}
sobrou depois do rollback: 0
```

**EM ABERTO, e é do Emanuel:** hoje o contrato importado só chega numa
equipe se alguém tiver declarado o login dela (`equipe_login_toa`, com
autor — D-079); sem isso vai para o abrigo "Sem login definido", mesmo
com o técnico já identificado. Em 09/09 isso são **270 contratos no
abrigo, dos quais 238 têm técnico com equipe conhecida**. Deixar a
equipe do técnico valer como último critério tiraria 238 do limbo — e
seria exatamente o "roteamento por dedução" que a D-088 proíbe. Não
mexi.

### D-125 · O código da equipe tem três dígitos

> "o padrão que eu quero é esse: '001 - EQUIPE' '022 - EQUIPE'"
> — Emanuel

A mesma equipe aparecia de três jeitos: `74` na coluna da tabela, `074`
no painel e `074 · 074 - EQUIPE` no seletor de transferência — porque
uns lugares mostravam `codigo`, outros `codigo · nome`, e o `nome` no
banco **já é** "074 - EQUIPE". Agora é uma função só, `equipeRotulo()`
em `app/src/lib/formato.ts`, usada em toda tela que escreve equipe.

Mais grave que a feiura, e o motivo da migration **062**:
`importar_equipes` tirava o código de `split_part(nome,'-',1)`. Planilha
com "45 - EQUIPE" cria a equipe `45`; com "045 - EQUIPE" cria a `045`.
Como a chave é `unique (base_id, codigo)`, **as duas convivem como
equipes diferentes** — mesma equipe de campo, dois cadastros, contrato
dividido e produtividade pela metade em cada um. O zero à esquerda
deixa de ser enfeite e vira identidade.

CONFERIDO ANTES de aplicar: as 107 equipes já estão em três dígitos (as
18 fora do padrão são as `SEM-LOGIN`, uma por base). Por isso a 062 **não
reescreve dado existente** — não há o que reescrever, e renumerar código
de equipe sem ninguém precisar é risco sem ganho. A normalização vale
da próxima importação em diante.

### D-126 · O Dashboard vira régua, e dois gráficos param de mentir

> "acho que tem muito espaço ou tem informações de forma incorreta
> melhore isso por favor, precisa ser fácil de entender e as informações
> precisam fazer sentido" — Emanuel

**O mesmo fato, três vezes, em duas telas de rolagem.** O painel abria
com sete cartões de situação (188, 9, 48, 373, 41, 44, 10), mostrava a
matriz — cuja linha **Total** é a mesma sequência —, e mais abaixo um
quadro "Distribuição por situação" com **os mesmos sete números** outra
vez, agora em barra empilhada com legenda. Entre eles, quatro cartões de
indicador do mesmo tamanho dos sete primeiros.

Onze cartões iguais afirmam onze assuntos igualmente importantes. São
dois: **quanto e como está indo** (uma régua de quatro leituras) e
**onde o dia está** (a composição). Foi o mesmo raciocínio da D-124 em
Equipes, e a peça de CSS é literalmente a mesma (`.painel-estado` e
`.regua` compartilham a regra).

Medido no rascunho, com os números de 01–10/09: a abertura saiu de
**~420px** (7 cartões + 4 indicadores + o quadro repetido) para **110px**
em 1600px de largura. A primeira tela passou a caber régua + composição
+ a matriz inteira.

**Dois defeitos de leitura, não de layout:**

**1. "Encerramentos por hora" desenhava toda barra com 2px.** A coluna
era filha de um flex com `items-end`, então a altura dela era o
CONTEÚDO — e `height: 42%` de um pai sem altura definida não resolve.
Todas caíam no `minHeight: 2`. Medido no navegador antes e depois:
`items-end` sem `h-full` → **2px**; `stretch` com `h-full` → **88px**
para os mesmos 50%. O gráfico existia, ocupava um quadro de largura
inteira e não dizia nada. De quebra o eixo ia de 00h às 23h: oito horas
mortas comiam um terço da largura. Agora o eixo é a faixa com
movimento, e o rodapé escreve qual é — eixo cortado sem dizer onde
corta é gráfico que mente.

**2. "% do dia" em cima de um mês.** Os cartões de situação escreviam
"26,4% do dia" com o filtro em `Este mês` (01/09 a 10/09). Sumiu junto
com os cartões.

**"Equipes por volume concluído" era o retrato de um cadastro
incompleto, não um ranking.** No período, **534 das 556** concluídas
produtivas (medido no banco, excluindo jornada como a tela faz) caem em
`SEM-LOGIN` ou em visita sem equipe nenhuma. Desenhado na mesma
escala, isso é uma barra cheia e duas riscas. O abrigo saiu do ranking e
virou contagem escrita, com o caminho do conserto (`concluidasSemDono`
em `metricas.ts`). Sumir com ele seria sumir com a única coisa acionável
da tela — zero e desconhecido não são a mesma coisa, e aqui o
desconhecido é a maioria.

**O painel deixou de ser um beco sem saída.** As etiquetas de situação
agora são links para Serviços levando `situacao`, `de` e `ate`; o nome
do grupo na matriz leva `grupo`. Antes o cartão "Cancelada 41" abria a
lista de HOJE, sem filtro — o drill-down mentia sobre o que tinha sido
clicado. `Servicos.tsx` valida os parâmetros: data fora do formato ou
situação inexistente voltam ao padrão.

**O que ainda está lá, de propósito:** os dois recortes que pareciam
duplicados não eram. A matriz conta `situacao = CONCLUIDA` (160 em
ADESÃO); o quadro "Visitas por grupo de serviço" contava concluída SEM
O.S. improdutiva (141) e mais 19 improdutivas — 141+19 = 160. Como o
segundo quadro só existia por causa do alternador grupo/tipo do TOA e do
CSV, os dois viraram botões no cabeçalho da matriz, e a coluna `%
concl.` foi para o lado da própria coluna CONCLUÍDA: percentual cujo
numerador está três colunas à esquerda é conta de cabeça.

**Removido por ficar sem uso:** `Indicador`, `Sparkline` e
`BarraEmpilhada` em `graficos.tsx` — a régua e o `.mistura` fazem o que
os três faziam.

VERIFICADO ATE ONDE DEU: `tsc --noEmit` limpo e `npm run build` nos dois
casos; as pecas novas foram montadas numa pagina de rascunho (apagada
depois) e conferidas no navegador em 1600px, 1024px e 784px, com os
numeros reais de 01-10/09. NAO verificado: a tela logada de verdade --
nao tenho credencial e nao entro com senha; e nada abaixo de 784px, que
e o minimo que o painel de visualizacao desta sessao aceita, entao o
`@media (max-width: 640px)` da regua esta escrito e nao exercitado.

---

### D-127 · A operação do técnico: de qual cidade ele atua

> "Temos que ter agora o nome da operação que o técnico atua qual a
> cidade […] isso tem que estar também na tela de cadastro […] é
> importante saber de qual cidade ele atua." — Emanuel

A operação **já existia**: é a `base` (praça), e as 18 linhas do banco
batem uma a uma com o relatório — Manaus - AM, Belém - PA, Brasília -
DF, São Luís - MA, Palmas - TO, Imperatriz - MA, Araguaína - TO,
Marabá - PA, Gurupi - TO, Caxias - MA, Timon - MA, Paraíso - TO, mais
seis que o relatório não mostrava (RO, PI e as duas de Rede Externa).

O que faltava era a **tela perguntar**. `tecnico.base_id` é `NOT NULL`,
então todo técnico sempre teve uma operação — só que ninguém escolhia:
`cadastrar_tecnico_avulso` pegava `bases_visiveis() limit 1`, um palpite
silencioso. É a D-088 de novo, do lado do cadastro: o sistema declarava
no lugar de quem opera.

Agora, em Administração → Novo usuário:

- **Operação (cidade)**, liberada pelo login do TOA como a skill e a
  equipe — pela mesma razão: operação é do TÉCNICO, e sem login não há
  em quem gravar.
- **A operação filtra a equipe.** Equipe mora numa praça; sem o filtro
  dava para cadastrar técnico de Manaus em equipe de Belém, e o banco
  recusava depois sem explicar bem. Trocar de cidade limpa a equipe
  escolhida. Operação sem nenhuma equipe cadastrada diz isso em vez de
  mostrar um seletor vazio, que parece defeito.
- O aviso do login agora diz as três coisas: **quem é, em que equipe e
  em que operação** — "O login Z674378 já é do técnico ODSON FRANK DE
  SOUZA TEIXEIRA, hoje na equipe 033 - EQUIPE, operação Manaus - AM."
- A aba **Técnicos** ganhou a coluna Operação, com a região embaixo, e a
  busca passa a achar por cidade.

A migration **063** leva a coluna `base.regiao` e troca a assinatura de
`cadastrar_tecnico_avulso`, que passa a aceitar `p_base_id`. A antiga foi
**derrubada** em vez de conviver com a nova: 3 e 4 parâmetros com default
ao mesmo tempo deixam a chamada de 3 argumentos nomeados ambígua para o
PostgREST — a armadilha do `baixar_os` (`agent_docs/traps.md`).

**A região do relatório NÃO é a do IBGE.** Pelo IBGE, TO é Norte e MA é
Nordeste; no anexo, as quatro praças de TO são CENTRO-OESTE e as quatro
de MA são NORTE. É agrupamento comercial. A regra saiu do **dado real**,
por UF: `AM, PA, MA → NORTE` e `DF, TO → CENTRO-OESTE`.

**EM ABERTO:** RO (Cacoal, Ji-Paraná, Vilhena) e PI (Teresina) não
aparecem no relatório. Ficaram com região **nula**, e a tela escreve
"sem região definida" em vez de chutar — zero e desconhecido não são a
mesma coisa (D-117). São dois `update` quando o Emanuel disser.

**NÃO foi mexido:** `perfil.base_id`, que é o que o RLS lê para decidir
quais praças a pessoa **enxerga** (`bases_visiveis`). A operação
gravada aqui diz onde o técnico TRABALHA; amarrar as duas coisas seria
transformar um campo de cadastro em mudança de permissão, calado.

CONFERIDO como `authenticated` (nunca como dono — D-081), em transação
desfeita:

```
criado sem equipe, operação explícita:
  {"base": "Belém - PA", "visitas_religadas": 0}   base gravada = Belém - PA
trava (equipe de Manaus + operação Belém):
  "A operacao escolhida nao e a da equipe. Escolha uma equipe da mesma operacao."
sobrou depois do rollback: 0
```

---

### D-128 · Cadastro de pessoa com forma, e senha que não passa batido

> "campos de cadastro estão deixando eu colocar qualquer coisa,
> inclusive numero de telefone fora do padrão, cpf e etc […] pra onde
> foi a senha do técnico eu nem criei uma" — Emanuel

Não havia **nenhuma** conferência. Os três cadastros de teste provaram:

```
cpf              123123123213    (12 dígitos)
whatsapp         213123213213    (12 dígitos)
data_nascimento  22222-02-22     ← ano vinte e dois mil
apelido          12234234324
```

O ano 22222 entrou porque `date` no Postgres vai até 5874897 AD.

**Duas camadas, e a de baixo é a que vale.** A tela confere na hora
(`app/src/lib/validacao.ts`, 19 casos testados, inclusive dígito
verificador de CPF); o **banco** recusa (migration 064, `CHECK` em
`perfil`). Tela não é barreira — um `insert` pelo PostgREST, um script
ou uma tela futura passam pelo mesmo lugar.

**CPF e telefone são guardados só com dígitos.** Guardar
"123.456.789-09" e "12345678909" na mesma coluna faz duas linhas do
mesmo CPF nunca se encontrarem. A máscara é da tela.

A dureza de cada regra é escolhida:

| campo | regra | por quê |
|---|---|---|
| CPF | barra, com dígito verificador | 11 dígitos quaisquer deixam passar `111.111.111-11` |
| Telefone | barra: DDD + 8 ou 9 dígitos | regra objetiva |
| Nascimento | barra: 16 a 90 anos (tela) / ano plausível (banco) | `current_date` não é IMMUTABLE e não entra em `CHECK` |
| RG | só tamanho e caracteres | **não existe padrão nacional** — cada estado emite o seu. Inventar dígito verificador reprovaria documento de gente de verdade |
| Login do TOA | **avisa, não barra** | o padrão (letra + 6 ou 7 dígitos, T ou Z) saiu dos 106 técnicos reais, mas quem emite é a operadora; barrar pararia o cadastro por regra nossa |

As constraints são **`NOT VALID`**: não olham para trás, mas valem em
todo `INSERT` e em todo `UPDATE` daquela linha. Os cadastros de teste
ficam onde estão até alguém editá-los — e aí precisam ser arrumados
para salvar. É o conserto na mão de quem sabe o número, não um `update`
meu adivinhando dado de pessoa.

**A edição virou janela.** Editar alcançava três campos dentro da linha
da tabela — cargo, perfil de acesso e papéis. Nome, CPF, telefone,
nascimento, operação, equipe, login do TOA e skill só existiam na hora
de criar: **errou ali, errou para sempre**, que foi exatamente o que
aconteceu. Agora são 15 campos em quatro blocos (Pessoa · Operação e
campo · Acesso · Senha), só para ADMIN.

O **e-mail é só de leitura**, e é decisão: ele é a chave do login em
`auth.users`, que a tela não alcança (só a `service_role`, pela função
de borda). Trocar aqui mudaria o `perfil` e deixaria o login antigo
funcionando — dois e-mails para a mesma pessoa, e o de baixo é o que
vale. O sistema do concorrente também deixa esse campo cinza.

**Dado errado aparece errado.** `formataCPF` corta em 11 dígitos; num
CPF de 12 ela mostrava "123.123.123-21" e o décimo segundo sumia da
tela — quem abrisse para corrigir veria um CPF de aparência normal e não
entenderia a recusa. Agora, valor que não cabe na máscara aparece cru.

**A senha virou janela.** Era um aviso âmbar logo abaixo do recado verde
de "acesso criado" — dois blocos parecidos, e o olho lê o primeiro. Foi
por isso que ela passou batido nos três cadastros. Agora interrompe, tem
botão de copiar e só sai com um clique. Não é zelo excessivo: o servidor
não guarda senha em texto, então fechar sem anotar significa gerar
outra.

CONFERIDO na tela, com o dado real:

```
criar com lixo → 5 erros no campo + "Confira os campos marcados";
                 nenhuma conta criada (Usuários continuou 4)
máscara        → 123.123.123-21   e   (92) 99123-4567
abrir JEFERSON → mostra 234234535345 e 22/02/22222 como estão gravados
salvar sem arrumar → recusado, com o erro em cada campo
banco          → update com cpf de 12 dígitos: "violates check
                 constraint perfil_cpf_forma"
```

**O que eu mexi no seu dado:** no cadastro de teste
`01_equipe@afline.com.br` limpei CPF, WhatsApp e nascimento (estavam
impossíveis e travavam qualquer edição) e **gerei uma senha nova** para
conferir a janela — a antiga ninguém tinha. O `02_equipe` está intacto,
com o lixo original, de propósito: é o caso de teste da tela nova.

---

### D-129 · Cadastrar o técnico na equipe não roteava nada

> "importe e não foi para o técnico" — Emanuel, depois de importar a
> rota de 10/09

**Foi para o técnico.** O que não foi é a EQUIPE — e como a tela de
Equipes é organizada por equipe, o resultado parece o mesmo.

Medido na importação real de 10/09, com 40 visitas:

```
foram para o TÉCNICO certo     24   (Z384041 → 13, Z515564 → 11)
sem técnico (login não cadastrado) 16
                    ── e a equipe ──
SEM-LOGIN (o abrigo)           34
sem equipe nenhuma              6   ← JORNADA (Na Base, Refeição): não têm login
equipe de verdade               0
```

A causa: `equipe_do_contrato` roteia por **`equipe_login_toa`**, e essa
tabela estava **vazia** para os três logins. Os técnicos tinham equipe
no cadastro (Z384041 → 001, Z515564 → 002, Z656921 → 074) — só que
`tecnico.equipe_id` **nunca foi critério de roteamento**. Cadastrar o
técnico numa equipe e esperar que o contrato dele caia lá é a suposição
que todo mundo faz, e ela estava errada.

**O conserto NÃO mexeu na regra de roteamento.** Usa o mecanismo que já
existia — `cadastrar_login_da_equipe`, com autor, evento por contrato
movido e o desfazer do controlador. O que mudou é que agora a tela de
cadastro **oferece** o vínculo, numa caixa que diz o que vai acontecer:

- no cadastro novo, **marcada** — quem escolheu login e equipe já disse
  o que queria;
- na edição, **desmarcada** — editar é mexer em quem já está rodando, e
  mover o histórico de contratos de alguém tem de ser um ato pedido,
  não efeito de abrir a janela.

**O que eu recusei:** fazer `equipe_do_contrato` cair na equipe do
técnico como último critério. Resolveria os 238 contratos do abrigo de
09/09 de uma vez, e é exatamente o "roteamento por dedução calada" da
D-088 — `tecnico.equipe_id` não tem autor, e para 106 dos técnicos ele
veio de uma planilha em lote. A 039 já custou 121 contratos roteados por
uma origem que ninguém tinha declarado.

CONFERIDO na tela, com o dado real de 10/09:

```
antes    SEM-LOGIN 34 · equipe 001: 0 · "1 de 107 equipes com serviço"
marcar a caixa e salvar o GABRIEL (Z384041, equipe 001):
         "login roteado para a equipe (13 contrato(s) movidos)"
depois   SEM-LOGIN 21 · equipe 001: 13 · "2 de 107 equipes com serviço"
         equipe_login_toa: Z384041 → 001, desde 2026-09-10, com autor
```

Os outros dois logins (Z515564 e Z656921) continuam sem vínculo de
propósito: são o caso de teste para o Emanuel repetir. Dá para fazer
pela janela de edição ou pelo botão **"é desta equipe"**, na lista de
logins sem dono, que sempre existiu e chama a mesma função.

---

### D-130 · O roteamento virou uma chave na lista, não uma caixa no formulário

> "agora eu vi a opção, eu acho que é bom essa função ficar fora do
> editar, ao lado do técnico, ligar router e desligar router, uma chave
> ao lado, melhor — por isso não achei" — Emanuel

A caixa que a D-129 criou funcionava e estava no lugar errado: dentro de
uma janela de edição com quinze campos, atrás de dois cliques. **O
Emanuel não a achou** — foi preciso eu apontar onde estava, na mensagem
anterior. Comando que precisa de guia não é comando: é um esconderijo.

Agora é uma **chave ao lado do login**, na lista de usuários, e ela diz
o estado por extenso:

```
GABRIEL ALVES MARTINS   [●—]  roteando para 001 - EQUIPE
JEFERSON RODRIGUES      [—●]  sem roteamento — o contrato dele cai em Sem login definido
```

O estado **é lido do banco** (`equipe_login_toa` com `fim is null`), não
guardado na tela: a chave mostra o que está valendo, não o que a tela
acha que mandou.

**Chave que só liga não é chave**, então a migration 065 traz
`desligar_login_da_equipe`. E aqui está a decisão que importa:

**Desligar NÃO move contrato de volta.** O contrato de ontem foi para a
equipe porque naquele dia o vínculo valia — e depois de roteado ele pode
ter sido despachado, transferido à mão, baixado. Puxar tudo de volta
para o abrigo apagaria trabalho real para "consertar" um cadastro. A
tela diz isso na confirmação, e o recado depois conta quantos ficaram:
*"13 contrato(s) continuam onde estavam."* Quem precisa mover contrato
tem `transferir_visita`, que pede motivo e registra evento.

`equipe_login_toa` é tabela de PERÍODO, então encerrar é `fim = ontem`
— os dias em que o vínculo valeu continuam valendo, e a leitura de
qualquer data passada não muda. O caso degenerado é o vínculo que
começou **hoje**: encerrá-lo com `fim = ontem` deixaria `fim < inicio`,
um período que nunca existiu guardado para sempre. Esse é **removido**.

Medido com `hoje_local()`, nunca `current_date`: em Manaus o dia vira às
20h, e o relógio do servidor desligaria o roteamento quatro horas antes
da meia-noite de quem opera.

Na janela de edição ficou uma frase no lugar da caixa, dizendo onde a
chave está — trocar a equipe ali muda o **cadastro** do técnico, que é
outra coisa do roteamento do login.

CONFERIDO na tela, nos dois sentidos, com o dado real de 10/09:

```
ligar  Z515564  → "11 contrato(s) já importado(s) foram para lá"   equipe 002
desligar Z384041 → "13 contrato(s) continuam onde estavam"         (nada se moveu)
religar  Z384041 → volta a rotear para a 001
tela de Equipes  → "3 de 107 equipes com serviço no dia"
banco            → 001: 13 · 002: 11 · SEM-LOGIN: 10 · sem equipe: 6 (jornada)
```

Um recado meu mentia e foi corrigido no teste: religar sem nada a mover
dizia *"nenhum contrato importado ainda usava este login"* — falso, os 13
usavam, só já estavam no lugar certo. Agora diz *"nenhum contrato
precisou ser movido"*. Zero movido não é zero existente (D-117).

---

### D-131 · A rota fixada: o TOA não desfaz o que a pessoa decidiu

> "quando eu quiser mandar para outro técnico, o contrato não deve
> retornar quando importado de novo […] quero tipo desativar a ligação
> daquele contrato em questão" — Emanuel

O controlador transferia o contrato para outra equipe e **a importação
seguinte desfazia**. Não era bug obscuro, estava escrito no importador:

```sql
equipe_id = coalesce(v_equipe, equipe_id),
tecnico_responsavel_id = coalesce(v_tecnico, tecnico_responsavel_id),
```

`v_equipe` quase nunca é nulo — na falta de vínculo ele cai no abrigo —,
então o `coalesce` **sempre** sobrescrevia. O despacho da véspera
evaporava na importação da manhã, sem uma linha de aviso.

Agora `visita.rota_fixada_em` (com autor e motivo) marca "a rota deste
contrato foi decidida por gente", e o importador pula essas duas colunas
naquele contrato.

**O que fixar NÃO faz:** congelar o resto. Situação, janela, endereço e
O.S. continuam espelhando o TOA a cada importação — que é o que o
Emanuel pediu na mesma frase: *"os status devem mudar a cada
importação, quando houve alteração no relatório"*. Fixar a rota não pode
virar fixar o contrato.

**Transferir passa a fixar sozinho.** Quem transfere está dizendo "este
contrato é daquela equipe"; deixar isso desprotegido era o defeito. A
chave por contrato existe para os outros dois casos: soltar de volta ao
automático, e segurar um contrato onde está **sem** transferir.

**As varreduras em lote param na porta.** `cadastrar_login_da_equipe` e
`cadastrar_tecnico_avulso` ganharam `and v.rota_fixada_em is null` — e o
filtro entrou no `WHERE`, não num gatilho que reverte calado: assim a
contagem que elas devolvem ("11 contratos movidos") continua verdadeira.

Já existia meia solução — `bloqueado_em` (D-006) —, e o ramo bloqueado
do importador de fato já não mexia em equipe. Mas ele nasce do **campo**
tocar no contrato, não do controle decidir. São duas perguntas:

```
bloqueado_em    "o campo já mexeu aqui"
rota_fixada_em  "a rota deste contrato foi decidida por gente"
```

**Cirurgia com âncora, não reescrita.** `importar_toa_interno` tem ~300
linhas e todas as outras regras dela continuam valendo, então a
migration 066 lê a definição corrente, troca dois trechos exatos e
recria — **abortando** se a âncora não existir mais. `replace()` que não
acha nada não reclama, e migration que "passa" sem mudar nada é pior que
migration que falha.

CONFERIDO como `authenticated`, em transação desfeita, reimportando o
arquivo real de 10/09:

```
equipe:    001 → transferi para 002 (fixada=t) → REIMPORTEI → continuou 002
situação:  forcei ENTRADA → REIMPORTEI → voltou a REAGENDAMENTO (o que o TOA diz)
fora da planilha: 1.338 visitas, nenhuma tocada pela importação
sobrou fixado depois dos testes: 0
```

O terceiro número responde a outra frase da mesma mensagem — *"as
mudanças só devem ocorrer no que estiver na planilha de importação
naquele momento"*: já era assim, e agora está medido.

**NÃO foi feito:** a importação não conta quantos contratos deixou de
remanejar por estarem fixados. O número seria útil na tela de
Importação; acrescentá-lo exige mexer em mais três pontos daquela função
de 300 linhas, e não valia o risco no mesmo dia da mudança. A marca ⚲ na
linha do contrato diz o estado um a um.

---

### D-132 · O supervisor ganha rosto: quais técnicos são dele

> "como eu sei que um supervisor é pai de um nome de técnico? tem que
> adicionar no sistema, casa o técnico com o supervisor" — Emanuel

A corrente já existia inteira e **nunca chegou a uma tela**:

```
planilha → equipe.supervisor_nome  ("SUPERVISOR - RAPHAEL FELIPE", texto)
técnico  → equipe                  (técnico.equipe_id)
usuário  → equipe.supervisor_id    ← este elo estava em 0 de 107
```

As funções `supervisores_das_equipes()` e
`definir_supervisor_das_equipes()` existem desde a **040** e nenhuma
tela as chamava — um `grep` no front não achava uma linha. O nome do
supervisor era texto solto na equipe; o acesso "Supervisor X" era outra
coisa; nada ligava os dois. Por isso a pergunta não tinha resposta.

Agora, no cadastro e na edição de quem tem o papel **SUPERVISOR**, um
campo **"Supervisor da planilha"** lista os cinco nomes reais com o
tamanho de cada um:

```
SUPERVISOR - LEANDRO DE LIMA          22 equipe(s), 25 téc.
SUPERVISOR - LUIZ HENRIQUE            21 equipe(s), 27 téc.
SUPERVISOR - RAPHAEL FELIPE           21 equipe(s), 29 téc.
SUPERVISOR ADARLAN LOPES DOS SANTOS   14 equipe(s), 15 téc.
SUPERVISOR - JORGE SUSSUARANA          7 equipe(s),  7 téc.
```

E a lista de usuários passa a dizer, na linha da pessoa:
*"SUPERVISOR · SUPERVISOR - JORGE SUSSUARANA · 7 equipe(s), 7 técnico(s)
abaixo"*.

O campo aparece **pelo papel, não pelo cargo**: papel é o que o banco
lê. E a gravação acontece **depois** dos papéis no mesmo salvamento —
`definir_supervisor_das_equipes` recusa quem ainda não é SUPERVISOR, e
no mesmo clique o papel pode ter acabado de ser dado.

**Um comando morto foi consertado junto.** Na janela de edição,
"Operação" e "Número da equipe" ficavam habilitados para quem não tem
login do TOA — e escolher não fazia nada, porque o salvamento só toca no
técnico quando há login. Seletor aberto que não faz nada é pior que
seletor travado: agora ficam travados, com o motivo escrito.

CONFERIDO na tela, ligando e desligando:

```
ligar   Supervisor X → SUPERVISOR - JORGE SUSSUARANA
        "supervisiona 7 equipe(s)"   banco: 7 equipes com supervisor_id, 7 técnicos
desligar → "deixou de supervisionar equipes"   banco: volta a 0
```

**Desfiz o vínculo depois do teste**, de propósito: não sei quem
"Supervisor X" é de verdade, e deixar gravado seria afirmar um fato que
ninguém me disse. Os cinco supervisores reais continuam sem acesso
vinculado — são dois cliques por pessoa, na tela nova.

---

### D-133 · A equipe própria do supervisor tem o nome dele, não um número

> "o supervisor pode ir pra campo quando necessário, porém para o
> supervisor repita o nome dele no número da equipe, para que seja
> possível passar rota pra ele quando necessário." — Emanuel

Escolhido por ele entre três opções apresentadas. A equipe do supervisor
é identificada pelo **nome**:

```
EQUIPE                          CONTRATOS
001 - EQUIPE                          13
002 - EQUIPE                          11
SUPERVISOR - JORGE SUSSUARANA          3   ← rota do supervisor
```

Código `SUP-JORGE`, derivado do nome. **Não numérico de propósito**: o
padrão de três dígitos (D-125) é das equipes de campo, e a graça desta é
ser reconhecível de longe. `equipeRotulo()` já devolve o nome quando o
código não é numérico, então a tela mostra o nome inteiro **sem uma
exceção escrita nela** — a regra velha já cobria o caso novo.

Depende do vínculo da D-132: o nome sai de `equipe.supervisor_nome` das
equipes que ele já supervisiona. Sem vínculo não há nome, e inventar um
seria inventar quem a pessoa é. A função **recusa** com essa mensagem.

**Idempotente**: a tela chama a cada salvamento do supervisor, e salvar
duas vezes não pode criar duas equipes. Segunda chamada devolve a mesma,
com `ja_existia: true`.

**Um erro meu, pego no teste:** a primeira versão gerava `SUP-SUP` para
todos — supus que `norm_txt` minusculizava, e ele MAIUSCULIZA, então o
`^supervisor` da expressão nunca casava. Consertado com `lower()`
(migration 067, aplicada por cima no mesmo dia). Nenhuma equipe real
nasceu com o código errado: o teste rodou em transação desfeita.

**Não deixei nada gravado.** Testei com o acesso "Supervisor X" e
desfiz: não sei de qual supervisor ele é, e gravar seria afirmar um fato
que ninguém me disse. Os cinco supervisores reais continuam sem acesso
vinculado — dois cliques cada, na tela nova.

---

### D-134 · O seletor de técnicos do supervisor

> "precisa ter um botão seletor em alguma parte selecionando supervisor
> X vai ser supervisor dos nomes x, y, z, e quando quisesse trocar seria
> fácil" — Emanuel

O vínculo da D-132 é pelo **nome da planilha** e pega tudo de uma vez —
21 equipes, 29 técnicos. Casa o acesso com o que a CLARO manda, e não
serve para dizer "estes três são dele".

Agora, na janela de quem tem o papel SUPERVISOR, há uma lista com busca
e caixinha, com contador em cima:

```
TÉCNICOS DESTE SUPERVISOR    3 marcado(s) de 107    limpar
[buscar por nome, matrícula ou equipe…]
  ☑ Z384041  GABRIEL ALVES MARTINS          001 - EQUIPE
  ☑ Z515564  JEFERSON RODRIGUES DE ARAUJO   002 - EQUIPE
  ☑ Z656921  LUCAS DA SILVA FERNANDES       074 - EQUIPE
```

Lista com busca, e não um campo por técnico: são 106, e trocar um tem de
ser um clique. O contador existe porque marcar numa lista rolante sem
saber quantos estão marcados é adivinhação. Técnico que já é de outro
supervisor aparece com o aviso **"de outro"** antes de ser trazido.

**Soltar é tão importante quanto ligar.** A função solta quem era
daquele supervisor e saiu da lista — sem isso, desmarcar não desmarcaria
nada, só acrescentaria. É o que faz "trocar ser fácil", que era o pedido.

**A precedência tinha de aparecer.** `tecnico.supervisor_id` vale mais
que `equipe.supervisor_nome`, e os dois vão divergir: dos três técnicos
do teste, **dois herdam `SUPERVISOR - RAPHAEL FELIPE` da planilha**.
Esconder um dos dois faria a tela mentir metade do tempo, então a aba
Técnicos mostra assim:

```
Supervisor X  DECLARADO
planilha: SUPERVISOR - RAPHAEL FELIPE
```

Mesmo padrão do login (CADASTRADO / SEM CADASTRO). Técnico que ninguém
marcar continua com o supervisor da equipe: não usar isto não quebra
nada.

CONFERIDO na tela, com o acesso "Supervisor X" — **a pedido do Emanuel,
e desta vez ficou gravado**:

```
marcar os três        → "3 técnico(s) sob ele (+3)"
desmarcar o Z515564   → "2 técnico(s) sob ele (−1)"
marcar de volta       → "3 técnico(s) sob ele (+1)"
banco                 → os três com supervisor_id, autor e hora
busca por "Supervisor X" na aba Técnicos → acha os três
```

---

### D-135 · O supervisor que a tela mostra é o desta casa

> "não aparece em nenhum canto que o supervisor é o Supervisor X,
> aparece o nome Raphael Felipe, não sei de onde […] nosso time é só
> isso, não tem por que ter mais nomes de fora e nem suposições"
> — Emanuel

**De onde vinha:** `painel_equipes` mostrava
`norm_supervisor(equipe.supervisor_nome)` — o texto da coluna SUPERVISOR
da planilha de equipes importada, com o prefixo "SUPERVISOR - " tirado.
Nunca foi suposição do sistema: é dado que a própria planilha traz. Mas
aparecia **sem etiqueta**, do mesmo jeito que um nome de gente com
acesso — e aí não há como distinguir "quem é da casa" de "o que a
planilha diz".

A precedência agora é explícita, e vale nas duas telas:

```
1. tecnico.supervisor_id     o que ALGUÉM declarou (D-134)
2. equipe.supervisor_id      o acesso ligado ao nome da planilha (D-132)
3. equipe.supervisor_nome    o texto da planilha  → sai marcado "da planilha"
```

Onde alguém declarou, a tela escreve o nome do usuário e mais nada.
Onde ninguém declarou, o texto da planilha aparece **acinzentado, com a
etiqueta "da planilha"** e a explicação na dica. Não some: some seria
pior — 100 das 107 equipes ainda não têm supervisor declarado, e deixá-
las em branco trocaria um nome imperfeito por nenhuma informação.

E **Administração ganhou a coluna SUPERVISOR** ao lado do cargo, com a
mesma regra.

**O que eu NÃO fiz:** apagar `equipe.supervisor_nome` das 85 equipes.
Seria destruir dado da fonte — e inútil: a próxima importação da
planilha de equipes escreve tudo de volta, porque é a coluna SUPERVISOR
do arquivo. O caminho para "só o nosso time aparecer" é declarar os
supervisores, não apagar a planilha.

CONFERIDO com o dado real de 10/09, depois de o Emanuel marcar os
técnicos dele:

```
antes    001 - EQUIPE   RAPHAEL FELIPE · MA1
depois   001 - EQUIPE   Supervisor X · MA1
         074 - EQUIPE   Supervisor X · MA5
         002 - EQUIPE   Supervisor X · MA1
Administração → coluna SUPERVISOR: Supervisor X nos três técnicos
```

Nota: `painel_equipes` teve de ser **derrubada e recriada** (coluna nova
no `returns table` — `create or replace` recusa: *cannot change return
type*), então levou `revoke`/`grant` explícito junto. Ver `traps.md`.

---

### D-136 · A limpeza do ciclo, e o abrigo que virou ruído

> "limpe todos os contratos importados desde o início da operação deste
> site […] vai começar um novo ciclo […] tem que deixar apenas o que
> cadastramos manual" — Emanuel

Limpeza pedida e confirmada em duas perguntas antes de executar (fotos
de evidência: apagar; equipes: manter as dos técnicos). Rodou como
**ensaio primeiro** — a mesma transação com `raise exception` no fim —,
e só depois de ver os números é que rodou de verdade.

```
apagado   1.382 visitas · 1.697 O.S. · 3.210 eventos · 7.702 produtos
          823 avisos · 68 reincidências · 3 evidências · 2 equipamentos
          32 importações · 5.065 linhas · 104 técnicos · 86 equipes
          3 vínculos login→equipe
ficou     5 usuários · 3 técnicos · equipes 001, 002, 003 + 18 abrigos
          todo o cadastro de domínio (códigos de baixa, pontuação,
          perfis, cargos, permissões, bases, áreas)
```

**O Storage não se apaga por SQL.** `delete from storage.objects`
devolve *"Direct deletion from storage tables is not allowed. Use the
Storage API instead."* — proteção do próprio Supabase contra órfão. As 3
linhas de `evidencia` saíram; os 3 arquivos ficaram e saem pelo painel.

**O efeito colateral que a limpeza revelou.** `SEM-LOGIN` existe **uma
vez por base** — 18 linhas que não são equipe de campo, e sim a sala de
espera do contrato cujo login ninguém declarou. Com 107 equipes elas se
diluíam; com 21 viraram a maioria, e o painel passou a dizer *"21
equipes, 18 sem técnico"* — contando prateleira vazia como equipe sem
gente.

Agora o abrigo **só aparece quando está segurando alguma coisa**.
Abrigo com contrato continua na lista, e tem de continuar: é o aviso de
que há trabalho sem dono. Vazio, não é notícia.

```
antes da regra   0 de 21 equipes · 18 SEM TÉCNICO
depois           0 de  3 equipes ·  0 SEM TÉCNICO
```

**Um vínculo ficou órfão de propósito:** o login `Z359048` (Tecnico de
Teste) roteava para a equipe **074**, que foi apagada. Ele está
cadastrado na **003**. A chave de roteamento dele está desligada, e
religar é escolher a equipe — decisão de quem opera, não minha.

---

### D-137 · Desligar técnico saiu da tela do dia

> "esse botão técnicos deve sair, ninguém pode ver essa opção de
> desligamento fácil, isso tem que ser na tela do administrador"
> — Emanuel

A aba **Técnicos** morava em Equipes, ao lado do painel do dia — e o
botão **Desligar** ficava a um clique de quem está despachando. Não é
questão de permissão (o banco já conferia `equipes.editar`, e
`mudar_situacao_tecnico` confere de novo): é questão de **lugar**.
Equipes é a tela de quem está rodando agora; desligar técnico é
cadastro, e cadastro mora em Administração.

A tabela virou componente (`TabelaTecnicos`) e mudou de tela inteira,
com a busca da tela nova. Nada foi perdido — e Equipes ficou só com o
que se olha no dia.

### D-138 · O cartão da equipe: rótulo e valor

> "precisamos melhorar mais essa parte da foto do técnico, equipe […]
> colocar as informações completas" — Emanuel

Era uma linha corrida onde login, contagem de técnicos e supervisor se
misturavam:

```
Login TOA Z384041 CADASTRADO · 1 téc.
Supervisor X · MA1
```

Virou rótulo e valor, um por linha — o olho acha o LOGIN sempre no mesmo
lugar, em qualquer equipe da lista:

```
001 - EQUIPE
NOME        GABRIEL ALVES MARTINS
LOGIN       Z384041  CADASTRADO
SUPERVISOR  Supervisor X
ÁREA        MA1
```

O abrigo `SEM-LOGIN` não ganha rótulo de NOME: ele não é equipe, é a
fila de quem ainda não tem dono, e escrever "nome" ali seria inventar
gente. Ele mostra `AGUARDANDO · N login(s) esperando cadastro`.

### D-139 · O supervisor errado em Serviços, e o filtro que o repetia

> "ainda enxergo supervisor Raphael Felipe, nem é esse o supervisor da
> equipe" — Emanuel

A linha do contrato mostrava `v.equipe.supervisor_nome` — o texto da
planilha —, enquanto o painel de Equipes já mostrava o declarado. **Dois
nomes para o mesmo contrato, em duas telas.**

Agora a coluna Equipe mostra o supervisor **do técnico do contrato**
(`tecnico.supervisor_id`, D-134), e só cai no nome da planilha quando
ninguém declarou — aí sai marcado `· da planilha`, acinzentado.

O filtro **"Todo supervisor"** seguia a mesma fonte velha e continuava
oferecendo `SUPERVISOR - RAPHAEL FELIPE` mesmo depois de a linha mostrar
`Supervisor X`. Passou a usar a mesma precedência, numa função só
(`supervisorDo`), para filtro, busca e exibição não poderem divergir.

CONFERIDO na tela, com os contratos de 10/09:

```
coluna Equipe   002 - EQUIPE Z515564 / Supervisor X
                001 - EQUIPE Z384041 / Supervisor X
filtro          deixou de listar SUPERVISOR - RAPHAEL FELIPE
```

---

### D-140 · O catálogo aprende com a planilha

> "você pegou o código, o número da O.S., mas não pegou o nome dela […]
> a área que fica depois do endereço não pegou também, sendo que eu fui
> olhar no analítico ela aparece" — Emanuel

Os dois defeitos tinham a **mesma causa**: o importador procura no
catálogo, não acha, e **joga fora o que estava no arquivo**.

```sql
tipo_os_id = (select id from tipo_os where codigo = extrai_codigo(...))
area_id    = (select id from area_trabalho where norm_txt(codigo) = ...)
```

Nulo silencioso nos dois casos. E o dado estava lá, escrito:

```
Tipo O.S 1        "87 - RETIRAR EMTA"          ← código E nome
Área de Trabalho  "ARN-AREA01"
```

O catálogo tinha 37 tipos (faltavam 32, 79 e 87) e cinco áreas —
`MAN-AREA01..05`, de Manaus. A planilha era de **Araguaína**.

Agora o catálogo **aprende com a planilha**, que é a fonte: tipo de O.S.
e área de trabalho que aparecem no arquivo e não existem entram no
cadastro. É a regra de sempre deste repositório — *derive do dado real*.

**Só entra quando há descrição de verdade.** Se a célula trouxer só o
número, nada é inventado: fica nulo e a tela continua dizendo que não
sabe. `tipo_os.descricao` é NOT NULL justamente para não aceitar nome
vazio.

### D-141 · A área só era gravada no INSERT

Achado ao testar a D-140: com a área já no catálogo, as 40 visitas
**continuavam sem área**. O `area_id` era atribuído apenas na criação da
visita — o ramo de ATUALIZAÇÃO do importador nunca o tocava.

Consequência: visita importada antes de a área existir no catálogo
ficava sem área **para sempre**, e reimportar não consertava. O mesmo
valia para qualquer área criada depois.

Agora a área entra também na atualização, com `coalesce` para nunca
apagar o que já havia, nos dois ramos (o normal e o da visita tocada
pelo campo — endereço e geografia continuam espelhando o TOA ali, e área
é geografia).

CONFERIDO reimportando o arquivo real de 10/09:

```
antes    sem área: 40 de 40 · sem tipo de O.S.: 8 de 45
depois   sem área:  8 de 40 · sem tipo de O.S.: 0 de 45
```

Os 8 que ficam sem área são os apontamentos de JORNADA (Na Base,
Refeição): a planilha não traz "Área de Trabalho" para eles. Sem área na
fonte, sem área no banco — o certo.

Entraram no catálogo: `32 DESCONEXAO I C/ RETIRADA DE EQUIPAMENTO`,
`79 DESCONEXAO OPCAO C/ RETIRADA DE EQUIPAMENTO`, `87 RETIRAR EMTA`, e a
área `ARN-AREA01`.

**EM ABERTO, e é do Emanuel:** a importação grava **sempre na base
MAN** — está escrito em `app/src/pages/Importacao.tsx`:
`.from('base').select('id').eq('codigo','MAN')`. A planilha de 10/09 é
de **Araguaína** (cidade ARAGUAINA, UF TO, área ARN-AREA01) e foi
registrada como Manaus. Enquanto for uma praça só isso não aparece; com
duas, a produtividade e o faturamento somam operações diferentes no
mesmo lugar. Não mexi: escolher a operação da importação é regra de
negócio.

---

### D-142 · Cancelada não é cinza, e o cadastro não chegava a tempo

> *"Cancelado não é cinza, e uma cor mais vermelho claro, tem que
> corrigir."* — Emanuel, 14/09

O cadastro **já dizia vermelho**: `situacao_visita.cor` = `#d33724`
desde a 025. Quem pintava de cinza era o padrão compilado do front —
`--st-cancelada: #6b7280` — e ele ganha porque `carregarSituacoes()` é
disparada sem `await` no login e só sobrepõe o objeto de módulo **depois**
que a tela desenhou. Mutar objeto de módulo não provoca render no React,
então a lista abre cinza e fica cinza.

Ou seja: não era uma cor errada, eram **duas verdades** — e a que
aparecia era a compilada. As duas passam a dizer `#d9736e` (migration
072 no cadastro; `styles.css` e `campo/src/lib/dominio.ts` no código),
justamente para não piscar de um tom para o outro quando a consulta
chega.

**Por que vermelho apagado e não o vermelho da marca:** `--st-conflito`
(`#e4262f`) é o ALARME da tela — TEC1 fora do padrão, conflito de
importação. Um dia com 7 cancelamentos normais pintado no mesmo vermelho
vivo vira sete alarmes falsos. Cancelado é fato encerrado e ruim:
vermelho, mas baixo.

**RECUSADO:** consertar a corrida do `carregarSituacoes()` agora. É
defeito real e continua de pé — a tela usa o padrão compilado no
primeiro quadro em TODAS as situações, não só nesta. Alinhar os dois
valores resolve o sintoma hoje sem esconder a causa, que está escrita
aqui.

---

### D-143 · O de/para do grupo de serviço vira cadastro

> *"tem serviços que ainda não ganha categoria, por exemplo: ctt
> 1143258, ele não sabe qual grupo de serviço ou tipo de serviço ele é,
> ele é uma desconexão […] eu preciso que no menu configurações habilite
> uma função para 'Tipo de Serviço', dá acesso ao usuário para editar e
> escolher o tipo de serviço para determinado tipo de o.s."* — Emanuel,
> 14/09

O grupo pertence à VISITA e é **derivado**: `grupo_da_visita()` escolhe,
entre as O.S. do contrato, a de maior prioridade de negócio (D-045 e
migration 014). Tipo de O.S. sem grupo ⇒ contrato sem grupo ⇒ `—` na
coluna. Não há como consertar contrato a contrato: o lugar é o tipo.

Os três sem grupo eram exatamente os três que a **070** aprendeu da
planilha de Araguaína, e que por isso nunca passaram pelo cruzamento
TOA × ngestor de 04/09 que produziu o de/para original:

```
32  DESCONEXAO I C/ RETIRADA DE EQUIPAMENTO      7 O.S.
79  DESCONEXAO OPCAO C/ RETIRADA DE EQUIPAMENTO  3 O.S.
87  RETIRAR EMTA                                 3 O.S.
```

**Por que cadastro e não um UPDATE na migration:** o catálogo continua
aprendendo tipo novo a cada planilha nova (070). Um UPDATE de três
linhas fecharia um buraco que se reabre sozinho na próxima praça.

**Por que RPC e não escrita direta:** `tipo_os_admin` exige
`empresa_id = minha_empresa()`, e **37 dos 40** tipos são do catálogo
seed, com `empresa_id` nulo. Escrita por RLS acertaria os 3 que a 070
criou e falharia **calada** nos 37. `definir_grupo_do_tipo_os` é
`security definer` e confere o papel dentro, como
`definir_situacao_do_codigo` (046-C).

A tabela passa a dizer de onde veio cada mapeamento — `CRUZAMENTO` ou
`CADASTRO`, com autor e data —, pela mesma razão que `codigo_baixa` diz
(D-097): o que a pessoa declarou vale mais do que o que eu deduzi.

**"Só daqui pra frente", e é escolha do Emanuel.** Perguntado se o
de/para novo deveria recalcular os contratos já importados, ele escolheu
não. Então nenhuma visita é tocada, e a tela **escreve isso**: o ctt
1143258 de 14/09 continua com `—` até a planilha daquele dia ser
importada de novo — aí o gatilho da 014 roda em `ordem_servico` e o
grupo se refaz.

**Ainda em aberto:** `24`, `156` e `208` são `depende_de_contexto` — no
cruzamento o grupo deles variava conforme as outras O.S. da mesma
visita. A tela marca com etiqueta; escolher um grupo fixo para eles é
uma simplificação consciente, não um conserto.

---

### D-144 · A capacidade do turno pinta a régua de períodos

> *"é a capacidade da janela: o técnico consegue fazer 3 execuções de 08
> às 12, 1 de 12 às 15 e 2 de 15 às 18. Se tiver manutenção, que fica no
> horário 08 às 11, 11 às 14 e 14 às 17, tem que considerar como se
> fosse um contrato da instalação normal"* — Emanuel, 14/09

A régua de períodos pintava a intensidade do bloco pela **maior janela
da própria equipe**: uma equipe com 1, 1 e 2 contratos pintava o 2 de
azul sólido como se fosse muito, e uma com 9 pintava o 3 de fantasma.
Comparação sem referência não responde nada.

Agora a cor compara com a **capacidade do turno**. São dois calendários
de janela — instalação e manutenção —, e a última frase do Emanuel é a
que resolve: não são dois orçamentos, é o mesmo turno chamado de dois
jeitos. Então a faixa não é pelo par início–fim (seriam seis regras que
divergem), é pelo **início** da janela:

```
começa antes das 11h  →  turno da manhã  →  cabem 3   (08–12 e 08–11)
começa 11h–14h        →  turno do meio   →  cabe  1   (12–15 e 11–14)
começa 14h em diante  →  turno da tarde  →  cabem 2   (15–18 e 14–17)
```

Até a capacidade a cor é o azul da execução, variando de intensidade.
Passou, sai do azul: âmbar logo acima, o vermelho de conflito ao dobro —
mais listra diagonal, porque numa barra de 8 px o tom sozinho não se lê
e nem todo mundo separa as duas cores. E sai **escrito** embaixo:
*"11h–14h acima da capacidade (2 para 1)"*.

**`SEM JANELA` não ganha cor de carga.** Sem hora não há turno, logo não
há capacidade para comparar. Não saber não é estar folgado (D-117).

**É média padrão, não regra da CLARO** — serve para apontar onde olhar,
não para cobrar ninguém. Está em `TURNOS`, em `telemetria.tsx`, num
lugar só. Se variar por praça, vira cadastro; hoje é constante porque
existe **um** conjunto de números, dito uma vez.

---

### D-145 · A equipe diz quando baixou, quanto fez — e a hora que mentia

> *"precisamos encher um pouco mais de informação por exemplo: último
> horário baixado do último contrato, e preciso saber quantos pontos ele
> fez concluído hoje"* — Emanuel, 14/09

Ao ir buscar o horário, o defeito apareceu: a coluna ESTADO mostrava
**20:47 nas três equipes**. A CTE `evt` de `painel_equipes` era

```sql
select ve.equipe_id, max(ve.criado_em) from visita_evento ve
 where ve.equipe_id is not null group by 1
```

— **sem filtro de dia**. Devolvia o evento mais recente da equipe em
qualquer dia, que na prática é a hora da importação. A tela dizia "a
equipe parou às 20:47" quando ninguém tinha parado às 20:47. A 074
restringe `evt` às visitas daquele dia.

**"Último horário baixado" tem duas fontes, e elas divergem.** São duas
baixas: a da operadora, que vem do TOA e não se edita (D-042), e a
nossa. Então a coluna vem com a procedência ao lado:

```
AFLINE   max(ordem_servico.baixa_em)
TOA      visita.fim, e SÓ com finalizado_toa (D-103: `fim` vem
         preenchido em atividade apenas INICIADA)
```

Hoje, nesta base: **83 O.S., zero com `baixa_em`** — tudo veio de
importação. Então o que aparece é `TOA`, e é a etiqueta que impede
alguém de ler aquilo como baixa da AFLINE. Vai junto o **contrato**
daquela baixa: um horário solto não deixa ninguém ir conferir.

**Pontos:** soma de `pontos_claro` das CONCLUÍDAS do dia — o mesmo
número que `produtividade_periodo` soma (D-046 e 057), para a tela não
ter dois totais da mesma coisa. Jornada fora (`natureza = PRODUTIVA`),
só no cálculo de pontos: `visitas` e `ordens` continuam contando tudo.

E vai junto `pontos_sem_regra`. Somar as sem regra como zero é afirmar
que o serviço não vale nada (D-117); a tela escreve
`7,53 pts concluídos · +1 sem regra`.

**MEDIDO como `authenticated`, nunca como dono (D-081):** o painel de
14/09 (3 equipes, 32 visitas, 17 concluídas) custa **167 ms** a quente,
dos quais **133 ms são a pontuação** — ~7 ms por visita concluída,
`pontos_da_visita` chamada por linha. `pontos_por_periodo` no mesmo dia
custou 280 ms para 38 linhas: mesma ordem, não é atalho.

**FICA EM ABERTO, e está escrito de propósito:** num dia cheio (364
visitas, ~240 concluídas) isso projeta **~1,7 s**. Não estourou nada
hoje e não foi otimizado hoje — mas é exatamente a forma do defeito que
matou `produtividade_periodo` (D-081), e quem voltar aqui tem de saber
disso antes de o painel ficar lento.

---

### D-146 · O mapa do dia sobe para o Google, e o SVG fica de rede

> *"devemos colocar o mapa do google aí com as camadas de visão satélite
> e visão street view"* — Emanuel, 14/09

"O dia no espaço" era SVG puro: as bolhas numa caixa vazia, posição
**relativa** entre bairros. Respondia *"está espalhado?"* e não respondia
*"onde"* — quem não conhece Manaus de cor via um diagrama, não uma
cidade. Com o mapa embaixo, a mesma bolha diz qual bairro, o satélite
mostra se é área densa ou ramal, e o Street View põe o COP na esquina
antes de despachar.

**A codificação não mudou de propósito:** tamanho = visitas, cor e
número = técnicos, as mesmas da tabela ao lado. Trocar o fundo não é
motivo para trocar a gramática da tela.

**O SVG não foi apagado — virou a rede.** `MapaBairrosSVG` é o que
aparece sem chave no `.env`, com o Google fora do ar e em qualquer clone
novo do repositório. Tela que depende de terceiro para existir é tela
que some quando o terceiro cai.

**A chave vai para o bundle, e não tem como não ir:** quem chama a API é
o navegador de quem abre a tela. Isso é previsto pelo Google, mas só é
seguro com **restrição por referenciador HTTP** no Cloud Console
(`https://gestor-af.pages.dev/*` e `http://localhost:5173/*`). A chave
mora em `app/.env`, que está no `.gitignore`; o `.env.example` traz só o
nome, vazio.

**LGPD:** o que vai para o Google é a área da tela, para desenhar o
ladrilho. As bolhas são posicionadas no navegador e são **médias por
bairro** — não o endereço do assinante. Nenhum nome, telefone ou
endereço sai daqui, e a janela de informação do mapa não mostra nenhum.

**RECUSADO: `AdvancedMarkerElement`.** É o sucessor de
`google.maps.Marker`, que está marcado como legado — mas exige um
`mapId` criado no Cloud Console e um estilo hospedado lá. Não vale
trocar uma tela que funciona por uma dependência de console. Quando o
`mapId` existir, muda um bloco só.

**A cor do bairro deixou de ser `var(--st-…)`,** porque tinha de deixar:
o Maps pinta em canvas e `fillColor` com variável CSS não resolve — sai
preto, calado. As três cores passam a ser hex escritos e iguais aos da
rampa da casa (conflito, reagendamento, execução); antes eram três tons
soltos do ngestor (`#d33724`, `#DAA520`, `#3c8dbc`) que não batiam com
nenhuma outra tela.

---

### D-147 · A Rota deixa de ser painel e vira mesa de despacho

> *"precisamos melhorar essa visão dos quadrados, nele é bom mostrar
> bairro, se é uma adesão, VT, hora início e fim, e mostrar talvez o km
> de um para o outro […] pense que tem um controlador de rota olhando
> isso, ele deve ser avisado de alguma divergência de rota […] o que
> está pendente para trás ele possa mexer e arrastar para outra linha,
> aí o contrato automaticamente seria transferido […] quero uma visão de
> rota muito lisa e fluida"* — Emanuel, 14/09

**A direção: mesa de despacho, não painel de indicador.** A tela era de
leitura; passa a ser de ação.

#### 1. O Gantt não cabia o que ele pedia

Cada visita era um retângulo posicionado pela hora. Num dia real a visita
de 20 minutos vira um bloco de **14 px** — e 14 px não cabem "SETOR
CENTRAL", muito menos o tipo de serviço e as duas horas. O desenho
respondia **quando** e escondia **o quê**.

Agora a faixa é uma **sequência de paradas**, e o espaço vai para o
**trecho entre elas**, que é a unidade do despachante: o km e o tempo
parado moram na linha que liga dois cartões, porque é exatamente isso que
eles são — o deslocamento. A hora continua escrita, com precisão de
minuto, que é melhor do que deduzir de um pixel.

O cartão carrega, de cima para baixo:

```
LOT SAO FRANCIS…      bairro
08:00–11:00           a janela COMBINADA
09:14 → 09:22         a execução REAL
SEM GRUPO   312   ↩   grupo · código de baixa · divergências
```

**A janela e a execução juntas, distintas pelo peso.** O controlador
compara as duas o tempo todo; separá-las em telas diferentes era obrigá-lo
a decorar uma delas.

**O que se perdeu, e é honesto dizer:** a leitura proporcional do dia —
"a manhã está cheia, a tarde vazia" — some. Ela continua em **Equipes**,
na régua de períodos (D-144). Aqui a pergunta é outra: a rota está
ajustada?

#### 1b. A sequência QUEBRA, não rola

> *"diminua mais a fonte para não ter que usar muito o scroll […] o ideal
> é olhar a rota inteira sem o scroll"* — Emanuel

A primeira versão rolava na horizontal, uma barra por técnico. Diminuir a
fonte não resolve: **13 paradas num cartão legível dão ~2.400 px**, e não
existe corpo pequeno o bastante para caber em 950 px sem virar borrão.

Então a sequência **quebra linha**, como texto: continua na linha de
baixo e a rota inteira fica visível de uma vez. Medido: **zero barras
horizontais** — nem nas faixas, nem na página, nem a 375 px de largura.

O cartão encolheu de 9,5 para **7,5 rem** — o menor em que "LOT SAO
FRANCISCO" ainda se reconhece truncado e as duas horas cabem lado a lado.
Abaixo disso a economia de pixel sai do entendimento.

#### 1c. Os códigos de baixa no cartão (076)

> *"adicione os códigos de baixa também dentro da caixa"* — Emanuel

**São duas baixas, e elas divergem** (D-042). O cartão mostra a **nossa**
quando existe — em verde, como em toda a casa — e a da **operadora**
quando não. A dica do cartão traz as duas por extenso, com descrição: é
lá que a divergência aparece inteira.

E é uma **lista**, não um código: a visita tem de 1 a 10 O.S., o caso mais
comum é 2, e cada uma tem o seu. "O código do contrato" não existe;
existe o conjunto. Duas O.S. com 409 e 430 viram `409 · 430`, não a
primeira que o banco devolver.

#### 2. A divergência sai da tabela e entra no trecho

A seção *"O que precisa de olho"* foi **removida a pedido**. Os três
avisos que ela dava passam a aparecer onde a pessoa está olhando:

| aviso | onde aparece | de onde vem |
|---|---|---|
| voltou ao bairro | `↩` no cartão | `voltou_ao_bairro`, da 054 |
| salto de 10 km+ | o trecho fica vermelho, com `⚑ salto` | mesmo corte de `rota_alertas` |
| fora da janela | `⧗` no cartão | **`visita.tec1`**, calculado pelo servidor |

**`tec1` e não uma conta nova.** Comparar `inicio` com `janela_inicio` no
front seria escrever uma segunda aderência, que diverge da primeira no dia
em que a regra mudar. A regra é do servidor desde a 047 (D-047), lida do
painel do próprio Emanuel. A 075 só passou a devolvê-la.

**O tempo parado entre duas paradas é escrito, e NÃO é julgado.** Não
existe regra combinada de quanto é "parado demais"; pintar de vermelho
seria inventar meta. Ele aparece em cinza, ao lado do km.

`rota_alertas` continua no banco, intacta. Nada a chama hoje.

#### 3. Arrastar transfere — e a armadilha está dita na tela

Arrastar um cartão para outra faixa abre a confirmação e chama
`transferir_visita`, a mesma RPC do modal de contrato. Fica no histórico
com autor e motivo, e **fixa a rota** (066): a próxima importação do TOA
não desfaz.

> ⚠ **A faixa é o LOGIN do TOA; a transferência é por EQUIPE.** Dois
> logins da mesma equipe são duas faixas e um dono só — arrastar entre
> elas devolve `mudou: false`. A tela avisa **antes** de tentar, com o
> nome da equipe, em vez de deixar o banco recusar em silêncio.

Só arrasta o que **não encerrou** — escolha do Emanuel entre três opções.
Concluída, cancelada e reagendamento ficam travadas: já acabaram, e mover
produção de um técnico para outro é outra conversa.

**Arrastar sozinho seria inacessível.** Todo cartão móvel tem um botão
`⇄` que abre a MESMA confirmação pelo teclado — e em tela de toque ele
deixa de ser discreto, porque ali não existe *hover* e o arrasto não é
confiável. Um caminho, duas portas.

#### 4. O mapa mostra quem está onde

Era bolha por bairro (agregado). Agora é **um pino por contrato, na cor da
equipe** — pendente sólido, encerrado vazado, para o que falta não
disputar atenção com o que já acabou. Ao lado, *Equipes em campo*: quantos
cada uma ainda tem **a executar**.

A cor da equipe é **categórica e fica fora da rampa `--st-*`**: aquela
significa situação. Verde de "concluída" para a equipe 001 faria o mapa
mentir duas vezes.

**LGPD:** o pino fica no endereço do assinante, então a janela mostra
contrato, bairro, janela e situação — e nada mais. Nome e telefone não vêm
de `rota_do_dia` e não vão entrar.

A tabela de bairros saiu da lateral: com pinos por contrato, um agregado
por bairro ao lado respondia outra pergunta. O número de bairros continua
no resumo do topo.

#### 5. Dois defeitos achados medindo, não olhando

**O mapa não trocava de tema.** `colorScheme` é opção de **construção** —
não existe `setOptions({colorScheme})`. O mapa nascia com o tema do
primeiro desenho e ficava branco de holofote numa tela grafite depois de
alternar. Agora ele se refaz quando o tema muda. Passou na primeira
conferência porque o defeito só aparece **depois** de alternar.

**Contraste medido no navegador, não no olho:**

```
"5 min" (tempo parado)   1,70:1   graf-600  -> graf-400   4,76:1
botão ⇄                  3,31:1   graf-500  -> graf-400   5,73:1
"30 km · 8 bairros"      2,75:1   graf-500  -> graf-400
código de baixa "312"    4,35:1   graf-400  -> graf-300   6,26:1
```

Conferência final: **256 textos da tela medidos, nenhum abaixo de
4,5:1**.

`graf-600` sobre o fundo escuro dá **1,7:1**: serve para filete, não para
palavra. Onde havia palavra, subiu. A hierarquia passa a vir de **peso e
tamanho**, não de mais tons de cinza.

> **FICA REGISTRADO, e é maior que esta tela:** `text-graf-500` e
> `text-graf-600` são usados como texto no aplicativo inteiro, e reprovam
> em contraste do mesmo jeito. Só a Rota foi corrigida — arrumar a rampa
> mexeria em todas as telas e não era o pedido.

**Um falso positivo, para ninguém repetir:** medidor de contraste escrito
com `match(/\d+/g)` lê `oklch(0.879 0.169 91.605)` como se fosse RGB e
acusa 1,04:1 numa etiqueta que tem 9,6:1. O Tailwind 4 emite cor em
`oklch`/`oklab`.

### D-148 · Cada situação diz quanto vale, e o "Estado" vira hora

> "é bom colocar a soma da quantidade de pontos concluidos, reagendados,
> em entrada [...] quantos pontos tem cada segmento de status seria muito
> bom" · "o estado na entrada eu não sei o que é? deveria ser, horário
> ultimo status, apenas isso" · "nem sempre vai dar status pelo TOA, pode
> ser que ele coloque o status manual" — Emanuel, 15/09

**1. O ponto ao lado da contagem (migration 077).** A barra de situação
dizia onde estão os CONTRATOS e calava sobre onde está o DINHEIRO. Seis
contratos na entrada podem ser 5,51 pontos ou 0,90 — mesma barra, mesmo
"6", faturamento seis vezes diferente. `painel_equipes.situacoes` passa a
trazer `pontos`, `sem_regra` e `produtivas` por situação.

**Zero e desconhecido continuam sem se misturar** (D-117). Medido no dia
15/09: a CANCELADA da equipe 001 tem 1 contrato e **nenhuma** regra de
pontuação — a tela escreve "sem regra", não `0,00`. O asterisco marca a
situação em que só PARTE achou regra, e o total do dia some se nada achou
("sem regra de pontuação" em vez de zero).

O total da coluna e o segmento CONCLUÍDA passam a sair da **mesma** CTE:
dois caminhos para o mesmo número são dois números para divergir.
Conferido — 3,1603 na 001, exatamente o que a tela já mostrava.

**O que custou, e é preciso dizer.** Medido como `authenticated` (nunca
como dono — D-081), no dia 15/09 com 29 visitas:

| | ms |
|---|---|
| `painel_equipes` depois da 077 | 318 |
| só o lateral de pontos, todas as situações | 237 |
| só o lateral de pontos, só concluídas (era assim até a 074) | 124 |

Derivando das duas amostras: **~5,9 ms por visita**, mais ~65 ms fixos.
Projetado para as 1.300 visitas/dia que a operação real tem, isso é
**~8 s — estouraria o timeout do PostgREST**. E antes da 077 já projetava
~3 s: o gargalo não nasceu aqui, é `pontos_da_visita` ser chamada por
linha (ela chama `assinatura_da_visita` e `edificacao_da_visita`, esta
última duas vezes). A 077 amplia o problema em ~2,5×.

**Não consertei isso aqui**, e o motivo é escopo: a saída é uma versão em
conjunto (`pontos_das_visitas(uuid[])`) substituindo o lateral por linha,
em `pontos_da_visita`, `pontos_por_periodo` e `painel_equipes` de uma vez
— é trabalho próprio, não um apêndice de "somar pontos na barra". Fica
declarado como limite conhecido. A base hoje tem 29–40 visitas/dia porque
foi reiniciada; **quando o volume real voltar, Equipes vai ficar lenta.**

`left join lateral`, não `cross`: o cross DERRUBA a visita se a função não
devolver linha, e aí `qtd` passaria a contar menos contratos do que a
equipe tem, em silêncio, dentro de uma mudança que era "só somar pontos".
Conferido: hoje são 29 de 29 com exatamente uma linha — o cross daria o
mesmo. Mas a contagem de situação não pode depender da função de
pontuação continuar se comportando.

**2. "Estado" virou "Último status".** A coluna mostrava
`12:26 · Na entrada · mexido 17:40`. "Na entrada" era a situação do
último contrato ENCERRADO — informação verdadeira e ilegível, e o Emanuel
disse que não sabia o que era. Agora é uma hora só.

**Não caí em `ultima_atividade` quando não há baixa**, e é decisão: ela
inclui o evento da IMPORTAÇÃO. Escrever aquele horário sob o título
"último status" diria "o último status foi às 17:40" quando ninguém mudou
status nenhum às 17:40 — foi a hora em que a planilha entrou. Sem
encerramento, a célula diz **"sem encerramento"**. Hora errada é pior que
hora nenhuma. `ultima_atividade` continua viva no `title` e continua
sendo quem decide OCIOSO.

**3. A baixa do ngestor aparece (anexo 4).** A coluna JANELA escreve
"encerrou HH:MM" e aquilo é SEMPRE o TOA (`visita.fim`). Quando alguém
baixa aqui dentro, esse horário não existe no TOA — e a tela não mostrava
a hora de jeito nenhum. A coluna Data virou **"Data · baixa"**: a nossa
baixa (`max(ordem_servico.baixa_em)`) tem precedência, marcada **AQUI**;
sem ela, repete-se a do TOA marcada **TOA**, "só para registro", como o
Emanuel pediu. A etiqueta é o que impede de ler uma como a outra — são
duas baixas e elas divergem (D-042).

O ramo do TOA exige `finalizado_toa`: `fim` vem preenchido em atividade
apenas INICIADA (D-103). Conferido no rascunho — contrato EM EXECUÇÃO com
`fim` preenchido e `finalizado_toa` falso não mostra hora em nenhuma das
duas colunas.

**4. "Produtividade" virou "Meta técnica"** — só o rótulo. Rota
(`/controle/produtividade`), arquivo e componente ficam como estão:
renomear rota quebra link que alguém salvou.

**Contraste, medido de verdade.** O `traps.md` avisa que regex de dígitos
mente com as cores `oklch` do Tailwind 4, então medi pintando a cor num
canvas e lendo o pixel (o medidor foi conferido: preto sobre branco = 21).
`text-graf-600` no tema claro dá **2,04:1** — e "sem regra" e "sem
encerramento" não são enfeite, são a afirmação de que não sabemos.
Passaram para `graf-400`: **5,88** no claro e **4,76** no escuro. As
etiquetas AQUI/TOA ficaram em 4,74–6,51, e as horas em 5,06–9,45.

NÃO consertei, e é anterior a esta mudança: a etiqueta **TOA** dentro da
coluna Ordens de Serviço (`bg-black/25`) dá **3,83:1** no tema claro.

VERIFICADO ATE ONDE DEU: `tsc --noEmit` e `npm run build` limpos;
`testar_policies()` 16/16 e `testar_campo()` 14/14 depois da 077;
`has_function_privilege` confirma anon=false, authenticated=true; as
pecas novas foram montadas numa pagina de rascunho (apagada depois) e
conferidas nos DOIS temas, com os numeros reais lidos do banco.
NAO verificado: a tela logada de verdade -- nao tenho credencial e nao
entro com senha; e o comportamento em volume real, pelo motivo acima.

### D-149 · A jornada acha o dono — e continua não sendo contrato

> "refeição, na base, é bom entrar no banco, pra gente saber de fato por
> que o técnico está parado [...] porém não pode contar como um contrato
> que soma na produtividade ou na quebra, reagendamento ou algo do tipo
> [...] e os status devem subir tanto na visão da equipe como na rota do
> dia" — Emanuel, 15/09

**O que já estava certo.** Jornada sempre entrou: `Na Base` e `Refeicao`
estão no catálogo com `natureza = 'JORNADA'`, e toda conta de
produtividade já as excluía. Suspensa já não entrava (051). O que faltava
era **atribuição**.

**O TOA não manda o login na jornada.** Conferido na planilha de 15/09 e
no banco: as 6 linhas de jornada vêm com `Login do Técnico` VAZIO — e a
`Refeicao` vem sem `Concluiu Atividade` também. Sem login,
`equipe_do_contrato` devolve nulo, e está certo devolver: o D-070 conta o
estrago de `norm_txt(NULL)` rotear jornada para uma equipe qualquer.
Resultado: **6 de 29 atividades sem equipe e sem técnico**, invisíveis em
Equipes e na Rota.

Mas o TOA manda o **`ID do Recurso`** em todas as linhas — 29 de 29 — e
as linhas produtivas do mesmo técnico trazem login e recurso juntos:

```
35996 → Z384041      50399 → Z515564      32950 → Z359048
```

Cada recurso casa com **exatamente um** login. Não é dedução nossa: é um
de/para que a própria fonte emite, no mesmo arquivo.

**Por que isto não fere o D-088.** Aquela decisão proíbe deduzir a
EQUIPE a partir da matrícula — "a matrícula diz de quem é o login; não
diz de qual equipe ele é". Aqui a corrente é outra, e para em cadastro:

```
ID do Recurso ──(o TOA diz)──▶ login ──(o CADASTRO diz)──▶ equipe
```

O segundo elo continua sendo `equipe_do_contrato`, intocada: login não
cadastrado cai no abrigo "Sem login definido", igual a contrato. A linha
do D-088 que dizia *"Sem login (jornada) → não vai para lugar nenhum"*
passa a ser **"sem login E sem recurso conhecido"**.

**Dar visibilidade e dar PESO são coisas diferentes** — e a 078 quase
confundiu as duas. Assim que a jornada ganhou equipe, o painel passou a
contá-la como contrato: a equipe 001 saltou de **11 para 13** "Contratos"
e nasceu uma situação fantasma `EM_EXECUCAO` com `qtd: 2, produtivas: 0`,
que era a Refeição posando de serviço em andamento. A 079 tira jornada de
`visitas`, `ordens`, `situacoes`, `periodos`, `ultima_baixa`,
`situacao_final` e do cálculo de OCIOSO — e dá a ela um campo só,
`jornada jsonb`. Conferido depois: 11 / 4 / 8 contratos, como antes.

Ela fica **abaixo** da régua de períodos, não dentro: a régua mede
capacidade de turno, e uma Refeição ocupando vaga de instalação diria que
o turno está cheio quando não está. Na Rota entra na sequência pelo
relógio, com `ordem` nula e sem km — numerá-la faria "a 7ª parada do dia"
ser o almoço, e medir deslocamento até um ponto sem coordenada
inventaria distância.

**O catálogo perdia tipo, e isso era 31% do arquivo.** 9 das 29 linhas
entraram com `tipo_atividade_id` NULO porque seis tipos não estavam no
catálogo. Sem tipo não há natureza, e todo lugar que lê
`coalesce(ta.natureza,'PRODUTIVA')` estava assumindo produtiva **no
escuro**. Mesmo remédio da 070 para a área: o catálogo aprende com a
planilha, que é a fonte.

Escolha do Emanuel entre três: tipo novo entra como PRODUTIVA e fica
**marcado** (`tipo_atividade.conferir`) até alguém confirmar. E a marca
provou o próprio valor na hora: o backfill criou **`Almoxarifado` e
`Reuniao`** como produtiva — dois tipos que quase certamente são jornada.
Estão contando como produção **agora**, e a aba nova em Configurações →
Tipo de atividade existe para o Emanuel decidir. Mudar a natureza vale
para todo o histórico, porque as contagens leem a natureza na hora.

**Por que uma passada DEPOIS, e não mexer no importador.**
`importar_toa_interno` tem 17.870 caracteres; reescrevê-la para enfiar
duas regras no meio é arriscar o que funciona por causa do que falta.
`reconciliar_importacao` é função própria, chamada pela `importar_toa`
logo depois — mesma transação, então ou entra tudo ou não entra nada. E
roda depois da inserção de propósito: numa importação a linha de Refeição
pode vir ANTES da linha produtiva que ensina o login daquele recurso.

CONFERIDO DEPOIS DE APLICAR: de/para aprendido com 27–33 ocorrências por
recurso; 0 visitas sem tipo; 0 jornada sem equipe; as 6 ligadas ao
tecnico certo; contratos de volta a 11/4/8; `produtividade_periodo` em
8/10/4 sem jornada; a Rota do Z384041 com a Refeicao entre o contrato 5
(12:26) e o 6 (14:38), contratos numerados 1-10 e km preservado.

VERIFICADO ATE ONDE DEU: `tsc --noEmit` e `npm run build` limpos;
`testar_policies()` 16/16 e `testar_campo()` 14/14; nenhuma tabela sem
RLS; nenhuma SECURITY DEFINER alcancavel pelo anon; contraste das pecas
novas medido com o motor do navegador nos DOIS temas (rotulo e total
subiram de 3,66/2,75 para 5,88/4,76; o horario de 4,35 para 6,25).
NAO verificado: a tela logada de verdade -- nao tenho credencial e nao
entro com senha. NAO consertado, e e anterior: o eixo `06h/14h/22h` da
regua de periodos da 1,70:1 no tema escuro.

EM ABERTO: a jornada fica em `EM_EXECUCAO` para sempre, porque quem
decide situacao e o codigo de baixa (050) e jornada nunca tem um. Nao
mexi -- e regra de negocio, e a pergunta e do Emanuel.

**Ajuste no mesmo dia, depois de ver na tela.**

> "o na base e fora de contrato vamos tirar esses nomes, vamos deixar o
> refeição, hora e total de hora, e nas cores azul vamos colocar um
> amarelo suave para refeição quando ele iniciar e finalizar"
> — Emanuel, 15/09

Em Equipes sobrou só a refeição: `Refeição 12:26–14:26 2h`. Caiu o rótulo
"FORA DE CONTRATO" e caiu o chip de `Na Base` — que dura 1, 7 e 11
minutos nos três técnicos do dia e é registro, não explicação. As duas
continuam no BANCO; só a que informa ocupa a tela. O total só aparece com
**mais de uma** refeição: com uma só ele repetiria a duração que está dois
centímetros à esquerda.

E a refeição passou a ser desenhada na régua do dia. **Duas tentativas
até acertar**, e a primeira está registrada porque o erro é instrutivo:
comecei com uma lavagem amarela ATRÁS dos blocos, para o alarme de
capacidade não perder espaço. Na tela ela **sumiu** — uma equipe com
janela `08h–22h` tem bloco cobrindo a régua inteira, e a refeição ficava
invisível exatamente onde mais importa. Virou faixa PRÓPRIA, de 3px, no
rodapé da régua, na frente.

Posição diferente também resolve a ambiguidade que a cor criaria sozinha:
esta régua **já** usa âmbar e vermelho, e ali eles significam "acima da
capacidade do turno". Âmbar em BLOCO é alarme; âmbar na FAIXA DE BAIXO é
refeição. Duas pistas — lugar e cor — em vez de só cor. Conferido com as
duas juntas na mesma régua: o bloco estourado continua sólido e listrado
por cima, e a faixa aparece inteira embaixo.

Sem hora de fim, a faixa marca só o começo, com 4px: refeição aberta não
ganha largura inventada, e o texto escreve `12:00–? ?`.

MEDIDO no navegador: no tema claro o preenchimento amarelo dá **2,15:1**
contra o branco — abaixo do 3:1 que a WCAG 1.4.11 pede para elemento
gráfico com significado. O amarelo continua suave, como pedido; quem
carrega o contraste é o **contorno** (`#b45309`, 5,02:1). No escuro o
preenchimento sozinho já dá 11,32:1.

NA ROTA não mexi, e é decisão: lá a jornada é uma linha do tempo, onde
cada bloco explica um buraco específico entre dois contratos. `Na Base`
continua aparecendo por isso. Em Equipes é resumo; na Rota é sequência.
Se for para alinhar as duas, é uma linha.

### D-150 · O TEC1 vira regra da AFLINE: por O.S., com carência em cadastro

> "Esses serviços precisam ser iniciados antes do fim da janela, ou antes
> de iniciar a janela e baixado até 1h:59 minutos depois do fim da janela
> para ser padrão [...] se for não executado, depois do fim da janela, o
> caso é considerado como sem padrão [...] agora se ele baixar não
> executado dentro da janela de atendimento ou antes? aí sim é dentro do
> padrão na certa." · "status executado e não executado, ela que mostrará
> o TEC1, ele também é por o.s" — Emanuel, 15/09

**Isto REVOGA a regra herdada do concorrente.** A D-099 transcreveu o
TEC1 do `painel_produtividade.html` (`classifyTEC1Row`) porque era o que
existia. Agora o Emanuel **definiu** a regra da AFLINE, e ela difere em
três pontos — está escrito para ninguém "consertar" de volta:

| | antes (painel) | agora |
|---|---|---|
| RETORNO DE CREDENCIADA | 119 min | **59 min** |
| DESCONEXAO | 119 min (caía em "o resto") | **59 min** |
| hora de início | não olhava | **tem de começar até o fim da janela** |

A inversão do RETORNO eu perguntei antes de aplicar, porque o painel
antigo tinha uma exceção escrita de propósito — `RETORNO(?! DE
CREDENCIADA)` — para tirá-lo do balde de 59. Ele confirmou.

**A regra, inteira.** Carência por grupo: 119 min para ADESAO, SERVICO,
REINSTALACAO, MUDANCA DE ENDERECO e MIGRACAO GPON; 59 min para VISITA
TECNICA, RETORNO DE CREDENCIADA e DESCONEXAO.

```
não executado   fim ≤ fim da janela ............ PADRÃO
                fim > fim da janela ............ SEM PADRÃO   (sem carência)
executado       início ≤ fim da janela
                  E fim ≤ fim da janela + carência ... PADRÃO
                senão ......................... SEM PADRÃO
```

A assimetria é dele e faz sentido: quem **não** fez o serviço devia ao
menos ter avisado dentro da janela, então improdutiva não ganha carência.

**A carência saiu do código e virou cadastro.** Estava num regex dentro
da função. Regex escondido em função é onde regra de negócio vai morrer:
para mudar 59 → 45 alguém precisa de migration, e por isso ninguém muda.
Agora é `tipo_servico.tec1_carencia_min`, ao lado do grupo que ela
governa. Grupo sem carência assume **59** — escolha dele, "o mais
rígido": falta de cadastro nunca afrouxa a cobrança.

**O TEC1 nasce na O.S., não na visita.** Uma visita tem de 1 a 10 O.S., e
é a O.S. que a CLARO fatura; o `Status da O.S.` é por O.S. (a planilha
traz `Status da O.S 1` a `Status da O.S 10`). `visita.tec1` passa a ser o
**consolidado**, e é severo: uma O.S. fora do padrão põe o contrato fora
do padrão — mesma lógica da 035, e pela mesma razão.

`inicio` e `fim` continuam sendo da VISITA: o TOA não manda hora por O.S.
As O.S. de um contrato compartilham as duas pontas e só se separam pelo
status.

**Qual hora conta.** Perguntei, porque são duas baixas e elas divergem
(D-042). Ele escolheu **só a do TOA** (`visita.fim`). O TEC1 passa a
medir o que a CLARO enxerga — que é quem cobra. Contrato baixado só aqui
dentro fica sem TEC1: consequência declarada, não esquecimento.

**Comparação por timestamp, não por minuto-do-dia.** A função antiga
fazia `extract(hour)*60 + extract(minute)` nos dois lados. Janela que
fecha 22:00 mais 119 min dá 24:59, que não existe nesse esquema, e o
encerramento depois da meia-noite voltava para o começo do dia. Somar
`data_agendada + janela_fim` resolve.

CONFERIDO ramo a ramo depois de aplicar, nas 107 visitas do banco:

| ramo | visitas | TEC1 |
|---|---|---|
| jornada (sem O.S.) | 22 | nulo |
| não encerrado no TOA | 22 | nulo |
| sem janela | 3 | nulo |
| **começou depois do fim da janela** | 1 | **SEM PADRÃO** |
| encerrou dentro da janela | 48 | PADRÃO (1 expurgada) |
| encerrou dentro da carência | 11 | PADRÃO |
| estourou a carência | 0 | — |

Antes: PADRÃO 60, SEM PADRÃO 2, expurgada 1, nulo 44. Depois: 58 / 1 / 1
/ 47. Os 3 nulos a mais são jornada, que agora não tem O.S. e portanto
não tem TEC1 — antes a função olhava a visita direto e classificava
almoço. A única SEM PADRÃO é o contrato 1149280: ADESÃO, janela
12:00–15:00, **não executada**, encerrada 16:11 — 71 min depois do fim.

**A nota da equipe (081).** Sobre O.S., com denominador = padrão + sem
padrão. Expurgo e "sem regra" ficam **fora**: somá-los como acerto
inflaria a nota, como erro puniria quem não errou. Os dois vão no JSON
assim mesmo, para a tela dizer quanto ficou de fora. `pct` NULO quando o
denominador é zero — equipe sem O.S. avaliável não tem nota 0%, tem nota
desconhecida (D-117), e a tela escreve "sem O.S. avaliável". A meta de
**95%** não é palpite: está na 047, lida do painel que ele já usava.

VERIFICADO ATE ONDE DEU: `tsc --noEmit` e `npm run build` limpos;
`testar_policies()` 16/16 e `testar_campo()` 14/14; nenhuma tabela sem
RLS; nenhuma SECURITY DEFINER alcancavel pelo anon; `recalcular_tec1` ja
era SECURITY DEFINER com checagem de papel ANTES desta migration --
conferi para nao rebaixar seguranca sem perceber. Os sete estados da nota
conferidos no navegador nos dois temas; o pior contraste do cartao ficou
em 4,76:1 (escuro) e 5,48:1 (claro), depois de trocar tres `text-graf-500`
-- e o TERCEIRO lugar nesta sessao onde esse token reprova.
NAO verificado: a tela logada de verdade -- nao tenho credencial.

EM ABERTO: `recalcular_tec1` nao filtra por empresa (`empresa_id`). E
anterior a esta migration e nao mexi, mas num segundo cliente ela
recalcularia o banco inteiro.

**Defeito meu, no mesmo dia, e o Emanuel achou primeiro.**

> "por que mostra 4 os? se tem mais que isso? tem 6 o.s so nessa tela,
> tem que ver essa contagem" — Emanuel, 15/09

A equipe 002 mostrava `TEC1 100% · 4/4 O.S.` com **8 O.S.** na coluna ao
lado. E, na mesma tela, o contrato 1010746 estava escrito **TEC1 SEM
PADRÃO** — o cabeçalho e a linha se contradiziam.

**Causa 1: filtrei pelo campo errado.** A 080 refrescava
`ordem_servico.tec1` com `where visita.importacao_id = p_importacao_id`.
Mas o importador só carimba `importacao_id` no **INSERT** — visita que já
existia e foi ATUALIZADA guarda o id da importação que a criou. Medido: a
importação das 18:31 trouxe 30 linhas e carimbou **uma** visita. O
refresh pegou 1 de 30; as outras ficaram com a coluna nula, e 4 O.S. da
002 sumiram do denominador — inclusive a única SEM PADRÃO. Daí o
"4/4 · 100%". O conjunto certo é `importacao_linha.visita_id`, que é
exatamente o que a importação tocou e vem cheio (30 de 30).

**Causa 2, mais grave: eu criei duas fontes para o mesmo fato.** O painel
lia a coluna guardada; a linha do contrato lia `visita.tec1`, que o
importador refaz linha a linha. Basta uma das duas atrasar para a tela
mentir contra si mesma.

E era pior do que um descuido: a 080 tirou a carência do código e pôs em
**cadastro** justamente para poder mudar — e aí eu cacheei o resultado.
No dia em que alguém trocar 119 por 90, todo valor guardado fica errado
sem aviso.

**Medido antes de escolher o conserto**, como `authenticated`:

| | ms |
|---|---|
| `painel_equipes` inteiro | 340 |
| `tec1_da_os` ao vivo, TODAS as O.S. do dia | **4,8** |

O cache não estava comprando nada. O painel passou a calcular na hora
(082), então o cabeçalho e a linha leem a mesma regra no mesmo instante e
não podem divergir. `ordem_servico.tec1` continua existindo para
relatório e filtro não chamarem função por linha — mas deixou de ser o
que o painel lê.

CONFERIDO depois: equipe 002 passou a mostrar **87,5% · 7/8 O.S.**, com a
SEM PADRÃO na conta. Em todo o banco, **0 de 119 O.S.** e **0 de 108
visitas** com valor guardado diferente da regra ao vivo, e **0** contratos
SEM PADRÃO dentro de equipe marcando 100%.

A LIÇÃO, que vale além deste caso: cache de regra que é cadastro precisa
de quem o invalide, ou não deve existir. Aqui não devia existir — e o
número que provou isso (4,8 ms) levou trinta segundos para ser medido,
contra as duas horas que a regra passou mentindo na tela.

CORRIGIDO TAMBEM: o cabecalho da 080 afirmava que a carencia era
"editavel em Configuracoes". Nao e -- essa tela nao existe, so muda por
SQL, e quem mudar precisa rodar `recalcular_tec1()` depois. A afirmacao
estava errada e foi reescrita.

### D-151 · A régua sabe o tipo, a refeição vira bloco, e a equipe mostra os tempos

> "a linha laranja precisa entrar toda na caixa de separação como se
> fosse uma atividade, não sobrepondo a caixa azul" · "janela de 08 as 22
> horas não devem entrar nessa caixinha azul, é um serviço que não é tão
> importante" · "se for uma rota inteira de Visita técnica a capacidade
> é: 08 as 11 - 3, 11 as 14 - 2, 14 as 17 - 3" · "use mais esse espaço
> para não ficar tudo imprensado, vamos colocar mais informações da
> equipe, como tempo médio de deslocamento, tempo médio de execução"
> — Emanuel, 15/09

**A refeição virou bloco — na quarta tentativa.** Vale registrar as
quatro, porque cada uma falhou por um motivo diferente e o motivo é a
lição:

| tentativa | o que era | por que falhou |
|---|---|---|
| 1 | lavagem atrás dos blocos | sumia: janela `08h–22h` cobre a régua |
| 2 | faixa própria no rodapé | virava uma segunda régua colada |
| 3 | barra fina dentro do bloco | lia-se como enfeite do bloco azul |
| 4 | **mesma altura e forma dos outros** | é o que ele pediu desde o começo |

Agora `.refeicao` só troca `--bloco-cor`: posição, degradê e anel vêm de
`.bloco`. Ela é uma atividade na régua, do tamanho das outras, ocupando o
seu pedaço do dia. Não se confunde com o bloco **estourado** porque
aquele é listrado na diagonal — a "segunda leitura" que já existia. Forma,
não só cor.

Vem por último no DOM de propósito: o almoço **aconteceu**, ele não
divide a hora com a instalação, ele a tomou.

**A janela larga sai do desenho.** As janelas de verdade têm 3h (08–11,
11–14, 14–17) ou 4h (08–12, 12–15, 15–18). A `08h–22h` tem **quatorze** —
não é janela, é a ausência de uma: o TOA marca assim o serviço que pode
ser feito a qualquer hora. Desenhá-la ocupa a régua inteira e faz todo
turno parecer cheio. O corte ficou em **4h**, que é a maior janela real.
No dia 15/09 isso tira duas: `08h–22h` (14h) e **`12h–18h` (6h)** — esta
eu encontrei nos dados, ele tinha citado só a primeira.

A contagem continua **escrita** embaixo, com a etiqueta "livre". Some do
desenho, nunca do dado — sem a etiqueta, o número sem bloco em cima
pareceria defeito.

**Duas tabelas de capacidade.** VT é mais rápida que instalação:

```
instalação    manhã 3   meio 1   tarde 2
visita técn.  manhã 3   meio 2   tarde 3
```

Os cortes de turno são os mesmos (11h e 14h); muda só o vetor de
capacidade. Sem isso a régua comparava uma rota inteira de VT contra a
tabela de instalação e pintava de vermelho um dia que cabia.

⚠ **Leitura minha, e está marcada no código:** ele disse "rota inteira de
visita técnica"; apliquei **por janela** — quando toda a janela é VT,
vale a tabela da VT. É mais fino (a capacidade é do TURNO, e um turno
pode ser todo de VT num dia misto) e degrada para o lado seguro: janela
misturada usa a tabela de instalação, que é a mais restritiva. Errar para
o lado do alarme é melhor que errar para o lado do silêncio. Se ele
quiser pelo dia inteiro, é trocar um argumento.

**Os dois tempos médios (083).** Deslocamento é a coluna que o TOA manda;
execução é fim menos início. Guarda de sanidade nas duas: negativo ou
acima de 24h fica **fora** da média — um contrato com hora invertida
envenena a média inteira, e média envenenada é pior que média nenhuma
porque parece um número. NULO vira travessão, nunca "0 min": não medimos
não é não gastou (D-117). Medido em 15/09: deslocamento 10–11 min,
execução 29–50 min.

São os dois números que dizem COMO o dia foi gasto, e a tela não tinha
nenhum. Deslocamento alto é rota mal montada; execução alta é serviço
difícil ou técnico parado no cliente — perguntas diferentes, e nenhuma
delas o volume responde.

VERIFICADO ATE ONDE DEU: `tsc --noEmit` e `npm run build` limpos;
`testar_policies()` 16/16, `testar_campo()` 14/14, nenhuma tabela sem RLS,
nenhuma SECURITY DEFINER alcancavel pelo anon. Quatro casos da regua
conferidos no navegador nos DOIS temas: (a) o dia real 15/09, com as
janelas larga e de 6h fora do desenho e escritas com "livre"; (b) rota so
de VT com 2 no turno do meio -- SEM alarme; (c) a MESMA carga em rota
mista -- COM alarme; (d) equipe so com janela larga -- regua vazia e o
numero escrito.
NAO verificado: o cartao de tempos medios na tela. O rascunho nao monta
ao importar a pagina inteira, e nao gastei mais tempo nisso; o componente
sao duas `span` e passou no `tsc`. O `text-graf-500` dos rotulos eu
troquei por `graf-400` SEM medir de novo -- e o mesmo token no mesmo
fundo que ja reprovou tres vezes hoje (3,66 claro / 2,75 escuro).

EM ABERTO, e e pergunta para o Emanuel: o corte de 4h para "janela
larga". Ele citou a 08h-22h; eu generalizei para "maior que a maior
janela real". Uma janela de 5h ou 6h futura tambem sairia do desenho --
que e o que acontece hoje com a 12h-18h.

---

### D-151 · A lista de contratos pagina de 50 em 50, e a caixa "marcar todos" muda de sentido

> *"vamos deixar essa página dos contratos paginada, ex: 1/30 […] de 50
> em 50, quando a operação tiver acima de 50 contratos"* — Emanuel, 22/09

**A página é do lado de cá, e é decisão.** Paginar no banco (`range()`)
traria 50 linhas e quebraria tudo o que a tela de Serviços faz sobre o
CONJUNTO: os nove filtros, a soma "X pts CLARO no filtro", o exportar e o
marcar em lote passariam a enxergar só o pedaço carregado — e continuariam
escrevendo o total inteiro. Mentira calada, a pior delas.

A consulta continua trazendo o período inteiro; a página é o **recorte da
tela**. Medido com 143 contratos: o rodapé segue dizendo
`143 de 143 visitas · 110,27 pts CLARO no filtro` com 50 na tela.

**A caixa do cabeçalho passa a marcar A PÁGINA.** Antes marcava o filtro
inteiro. Com 1.400 linhas invisíveis, "marcar todos" seguido de "Apagar do
banco" é exclusão em lote apontada para o escuro. Para marcar o filtro
todo existe um botão explícito na barra, **com o número escrito**:
*"marcar os 143 do filtro, não só esta página"*.

O `1/30` que ele pediu é também o campo de pulo — com 30 páginas, clicar
14 vezes em "próxima" é trabalho. A barra só existe acima de 50; abaixo
disso seria uma página de uma.

> **EM ABERTO:** a tela sempre carregou o período inteiro de uma vez, e a
> paginação não mudou isso. Se ela pesar num período longo, é a consulta
> que tem de mudar — não o recorte.

---

### D-152 · O almoxarifado nasce como módulo, e a importação não inventa posse

> *"imagina você ser o chefe do almoxarifado e precisa controlar
> miscelâneas e equipamentos, todo isso precisa estar registrado em nosso
> sistema […] pense no almoxarifado como um módulo, se preferir mudar até
> o menu lateral para não confundir as coisas […] até por que depois vai
> entrar financeiro, frota, RH entre outros"* — Emanuel, 22/09

**Fase 1 de três, escolhida por ele:** importar a carga e mostrar a
posição. Entrega/devolutiva ao técnico por romaneio e miscelânea por
saldo ficam para depois — as duas respostas dele já estão registradas
abaixo para quem construir.

#### O que o dado real disse

`CARGA AFLINE.xlsx` — **15.603 equipamentos**, todos no local
`ADUARTE ALBUQUERQUE ME`, operação MANAUS, classificação COMODATO.
**Número de série único em 15.603 de 15.603**: é a chave natural, e é por
ela que a importação reconhece o que já existe.

```
PERDA                 7.629   48,9%     EMTA                 5.403  34,6%
INICIALIZADO          5.070   32,5%     SMART CARD           5.077  32,5%
SUSPEITO              1.033    6,6%     DECODER DIGITAL      3.303  21,2%
TRANSITO REVERSA        742    4,8%     TELEFONICO           1.225   7,9%
SUCATA                  676    4,3%     ROTEADOR WI-FI         354   2,3%
ANALISE DE INVENTARIO   415    2,7%     CABLE MODEM            164   1,1%
GARE/COM DEFEITO/INUTILIZADO  38  0,2%  DAC / HARD DISK         77   0,5%
```

**Quase metade da carga está como PERDA.** É o número que nomeia o
módulo.

#### Dois eixos, e é o produto da tela

Mesma gramática das **duas baixas** (D-042):

| | quem afirma | pode editar aqui? |
|---|---|---|
| `estado_atlas` | a CLARO, pela planilha | **não** |
| `posse` | o almoxarife da AFLINE | sim (fase 2) |

O Atlas sabe que a peça é responsabilidade da AFLINE. Ele **não** sabe se
ela está na prateleira ou na van do técnico.

**Então a importação deixa `posse` NULA.** Carimbar "no almoxarifado" em
15.603 peças seria inventar o inventário inteiro num `update`. Zero e
desconhecido não são a mesma coisa (D-117) — e a tela escreve
`33 sem posse declarada`, em âmbar, porque esse número **é o trabalho que
falta**.

A única posse que a planilha AFIRMA é a do assinante: quando o Atlas diz
`Tipo Local = ASSINANTE`, a peça está com o cliente. Isso é dado, não
dedução, e entra.

#### Dois formatos de planilha, de novo (D-091)

`CARGA AFLINE` e `CONSULTA ATLAS` têm cabeçalhos diferentes; o segundo
cola série e endereçável num campo só (`"722255161458 / B4F2673499C1"`).
O formato é descoberto pelo **cabeçalho**, não perguntado: a planilha sabe
o que é.

As colunas vêm com os erros de digitação da fonte — `Responsavél`,
`Classificacação Material`, `Endereçavel Principal`. Lê-se pelo nome
**errado**, que é o que está no arquivo; ler pelo certo perderia a coluna
em silêncio.

**A data ambígua é recusada.** `18/06/2021 14:50:27` entra. `9/12/26
17:19` — 9 de dezembro ou 12 de setembro? — **não entra**: fica nula, o
texto original continua guardado em `dados_origem`, e a tela avisa quantas
ficaram assim antes de você confirmar. "Provavelmente mês/dia" erra em 11
dos 12 meses e ninguém percebe.

#### A fundação já existia, e foi usada

Não criei papel nem perfil: o papel **`ALMOXARIFE`** já estava no enum, o
perfil de acesso **"Almoxarife"** já existia (com **zero** permissões) e a
chave `almoxarifado.ver` já estava lá marcada `disponivel = false`,
descrição *"Modulo ainda nao construido"*. A 077 acende essas três e
acrescenta `almoxarifado.importar` e `almoxarifado.editar`.

**Escrita só por RPC:** `equipamento` não tem policy de INSERT, UPDATE nem
DELETE. Quem grava é `importar_estoque`, `security definer`, que confere
papel e permissão dentro. A policy de SELECT exige
`(select tem_permissao('almoxarifado.ver'))` — com `(select)`, porque
função solta na policy é chamada por linha e aqui são 15.603 (D-118).

#### O menu passa a ser por módulo

"Operação / Entrada de dados / Ajustes" agrupava por **verbo**, e
funcionava com um produto só. Com almoxarifado, financeiro, frota e RH
chegando, "Importar TOA" e "Importar a carga do Atlas" cairiam no mesmo
grupo sendo de mundos diferentes.

Agora cada módulo é um grupo e **leva as telas dele junto, inclusive a
importação**. Ajustes fica fora porque é transversal. E cada grupo só
aparece para quem tem a chave: o almoxarife não vê Serviços.

#### A tela: barra, não donut

O painel do concorrente é uma parede de 12 cartões e um donut de 12
fatias — com 68% numa e sete abaixo de 1%. Um donut de doze fatias não é
gráfico, é legenda redonda: para saber qualquer número você lê a legenda.

Aqui a proporção é **barra horizontal ordenada**, com o rótulo na barra e
o número ao lado. A cor entra só onde significa: verde é o que a CLARO
considera utilizável, vermelho é baixa de patrimônio — classificação
**dela**, não escala minha.

A lista pagina **no banco** (`range()`), ao contrário da tela de Serviços
(D-151). A diferença é o volume: lá são centenas e os filtros precisam do
conjunto; aqui são dezenas de milhares e ninguém soma 15.603 seriais.

E a importação sobe **em lotes de 500**: 15.603 linhas num `jsonb` só é
~8 MB de corpo e um timeout esperando acontecer. Como é idempotente pelo
serial, falha no meio não perde o que já entrou.

#### O que ficou decidido para a fase 2, e está aqui para não se perder

- **Miscelânea:** saldo por item **e por técnico** — entrega baixa de um e
  sobe no outro. Responde "quanto de conector o Jeferson gastou".
- **Entrega:** **romaneio** — o almoxarife monta uma carga com várias
  peças, fecha o documento, o técnico confirma. A devolutiva é outro
  documento. Histórico assinado dos dois lados.

#### Achado na planilha, para alguém olhar

O campo `Código Item JDE` vem com o texto
`$equipamento.getCodigoItemJDE()` em parte das linhas — um *placeholder de
template* que o Atlas não renderizou. Não é dado; é defeito da exportação
da CLARO. Entra cru em `dados_origem` e não vira código de item.
