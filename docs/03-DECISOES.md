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

---

### D-153 · O alerta de "janela estourando" saiu

> *"tire o aviso […] não acho viável ou interessante por enquanto nesse
> cenário"* — Emanuel, 23/09

Ele acendia quando faltavam menos de 60 min para o fim da janela do
cliente. O problema é o cenário: num dia em que boa parte dos contratos
tem janela **08:00–22:00**, o aviso acende no fim da tarde para a
operação inteira, todo dia. **Alarme que toca sempre é alarme que
ninguém olha** — e ele ficava no topo do Dashboard, ocupando o lugar de
quem tem algo a dizer.

Saiu o aviso **e a conta**: `emRisco` e `vencidas` não eram lidos em mais
lugar nenhum, e cálculo morto rodando a cada render é dívida silenciosa.
O parâmetro `agora` de `calcular()` foi junto — existia só por causa
dele, e nenhum chamador passava.

O git guarda as duas se um dia voltar. Se voltar, a regra precisa de um
corte que não seja "60 minutos para qualquer janela" — a de 14 horas e a
de 3 horas não são o mesmo risco.

---

### D-154 · O romaneio move a posse, e o saldo nunca é guardado

> *"o almoxarife monta uma carga para o técnico (vários equipamentos +
> miscelânea), fecha o documento e o técnico confirma. A devolutiva
> também é um documento"* · *"cada item tem um saldo no almoxarifado e um
> saldo COM CADA TÉCNICO"* — escolhas do Emanuel

Fase 2 do almoxarifado. A fase 1 (D-152) mostrou 15.603 peças e disse que
**não se sabe onde nenhuma está**. Esta fase dá o instrumento de
declarar — e de declarar com documento, não com um clique solto.

#### As duas metades, e o que as une

| | chave | o que muda |
|---|---|---|
| **Serializado** | número de série | a **posse** (077) |
| **Miscelânea** | código do item | a **quantidade**, por lugar |

Um decoder não tem "saldo 3". Um conector não tem número de série. São
mecânicas diferentes, e por isso tabelas diferentes. O que as une é o
**romaneio**: um documento carrega os dois.

#### O saldo é soma, nunca coluna

`miscelanea_movimento` é um **razão**: cada linha é um lançamento com
sinal, e o saldo é a soma. Não existe campo `saldo` mantido por gatilho.

O motivo está em `traps.md`: cache de número que a operação mexe diverge
**calado**. Num almoxarifado ele diverge no dia em que alguém mexer num
lançamento antigo — e aí a prateleira e a tela discordam sem ninguém
saber qual está certa. Hoje são dezenas de linhas; se um dia a soma
pesar, mede-se primeiro.

Toda entrega lança **duas pernas**: sai de um lugar, entra no outro. O
razão fecha em zero, e é isso que torna o total auditável.

#### Nada se move até a confirmação

Enquanto **ABERTO**, o romaneio é uma lista. A posse e o saldo só mexem
em `confirmar_romaneio` — e lá a miscelânea é processada **primeiro**,
porque ela pode recusar por saldo: recusar depois de já ter mexido na
posse deixaria meia verdade gravada.

**Documento confirmado não se cancela.** A correção é um romaneio no
sentido contrário, que deixa rastro dos dois lados — mesma lógica da
baixa que não se apaga (D-030). `cancelar_romaneio` só aceita ABERTO, e
exige motivo.

#### O que o banco recusa e o que ele deixa passar

Recusa, porque é **conta errada**: entregar 10 de um saldo de 3;
devolver o que o técnico não tem; entregar peça que não está no
almoxarifado; a mesma peça em dois romaneios abertos; confirmar
documento vazio ou já confirmado.

**Deixa passar, com aviso na tela:** peça em `PERDA`, `SUCATA`,
`INUTILIZADO` ou `COM DEFEITO` no Atlas. Bloquear seria inventar política
de patrimônio que ninguém combinou — e com **48,9% da carga em PERDA**,
travaria metade do estoque. O banco aceita; a tela grita em vermelho.

#### Quem confirma, nesta fase

Ele disse "o técnico confirma". O técnico confirma pelo **celular**, e o
`campo/` ainda não tem essa tela. Então nesta fase quem confirma é o
**almoxarife, no balcão**, que é como a carga acontece de manhã. O
documento já nasce com `confirmado_por` para receber a mão do técnico sem
migration nova.

Isto é **escopo, não regra inventada**: o fato "fulano confirmou" é
gravado com quem de fato clicou.

#### O defeito que só o dedo achou

O campo de série tinha `disabled={ocupado}`. O navegador **tira o foco de
um campo que desabilita**, e `.focus()` num elemento desabilitado não faz
nada — então depois de cada Enter o foco ia para o `BODY`, e bipar trinta
peças viraria trinta cliques. Exatamente o contrário do que a tela existe
para fazer.

Medido na tela, digitando de verdade: `focoDepoisDoEnter: "BODY"`. A
trava de reentrada virou um `ref`, o campo ficou sempre vivo — leitor de
código de barras digita rápido, e desabilitar no meio de uma leitura come
caractere — e o foco volta num `requestAnimationFrame`, depois do render.

> **FICA PARA A FASE 3:** a confirmação pelo celular do técnico, e a
> amarração com `equipamento_movimento` — quando o técnico lança o serial
> na baixa (055-F), a peça deveria sair da posse dele para
> `COM_ASSINANTE` sozinha. É regra nova e é do Emanuel.

---

### D-155 · O gráfico de encerramentos passa a ser por SITUAÇÃO

> *"quero colocar as cores por hora: cancelado vermelho, verde
> executado, e amarelo reagendado, preciso saber esse volume por hora, e
> a hora precisa aparecer no gráfico"* — Emanuel, 23/09

As três séries eram **"concluído / com improdutiva / com impedimento"**.
A primeira é situação; as outras duas são **outro eixo** — que tipo de
baixa a O.S. teve. Misturadas no mesmo empilhado, o gráfico respondia
meia pergunta. E **CANCELADA, que era 8 de 24 no dia**, não aparecia em
lugar nenhum.

Agora é um eixo só: as três situações **terminais**, nas cores de
`SITUACAO_INFO` — as mesmas da tabela, da Rota e do aplicativo. Gráfico
com paleta própria obriga a ler a legenda duas vezes.

**Conferido antes de trocar:** as três situações terminais têm `fim` em
100% das linhas do dia (14 / 8 / 1). Nenhuma barra nasce vazia por falta
de dado.

**O volume e a hora saíram do `hover`.** O total por hora só aparecia com
o mouse em cima (`opacity-0 group-hover`) e a hora só nas pares. Num
gráfico de dez colunas isso é esconder o dado por economia de espaço que
não faltava — e **no celular, onde não existe hover, o número não
existia**. Agora os dois estão escritos.

---

### D-156 · "Atraso sobre a janela" estava enganando, e o texto ajudava

> *"o atraso sobre a janela é quanto tempo médio a operação demorou a
> iniciar o outro contrato após baixado? não entendi direito"* — Emanuel

Não é. É `visita.inicio − janela_inicio`: **quanto tempo depois da
abertura do intervalo combinado com o cliente o técnico começou**.

Ele leu a nota que já existia e ainda assim entendeu outra coisa — o que
é sinal sobre a nota, não sobre ele. Dois defeitos no texto:

1. Não dizia o que o indicador **não** é.
2. Afirmava que *"acima de 60 min já compromete o horário prometido ao
   cliente"*. **Isso é falso** para a janela de 08h–22h, que domina esta
   operação: ela tem 840 minutos de folga. Era a frase que criava a
   contradição aparente com o cartão "chegou dentro da janela: 100%".

A nota passa a explicar a convivência dos dois números, e a dizer que
**as três barras não se somam**: as duas de baixo são etapas do
atendimento, esta é a distância até o combinado.

---

### D-157 · O campo fecha o ciclo do estoque — fase 3

Duas pendências de D-154, liberadas em 23/09.

#### 1 · O técnico confirma, pelo celular dele

Na fase 2 quem confirmava era o almoxarife no balcão, porque o aplicativo
não tinha a tela. **Confirmar no lugar de alguém é assinar por ele** —
funciona enquanto os dois estão frente a frente e deixa de funcionar no
dia da divergência, que é justamente o dia em que o documento importa.

`confirmar_romaneio` passa a aceitar duas mãos: o almoxarife/gestor, ou o
**técnico dono daquele documento** — e só o dele. Medido: romaneio de
outro técnico devolve **42501**, e `meus_romaneios()` não o lista.

A tela do aplicativo é de **leitura e um botão**. O técnico não monta
carga, não tira item, não corrige quantidade — se algo está errado ele
fala com o almoxarife, que tem o documento aberto do outro lado. Dar
edição ali transformaria o recibo em negociação.

A porta fica no **cabeçalho**, não na agenda: não é trabalho do dia, é
conferência de material, e a agenda continua sendo a primeira coisa que
ele vê (D-112).

#### 2 · O que o campo declara move a posse

`registrar_equipamento` (055-F) já registrava o serial instalado ou
retirado. Faltava a outra ponta: essa peça é a **mesma** que saiu do
almoxarifado.

```
INSTALADO  → COM_ASSINANTE     (ficou na casa do cliente)
RETIRADO   → COM_TECNICO       (voltou para a mão dele)
```

O gatilho mora em `equipamento_movimento`, que é o **funil** — mesma
razão do gatilho de avisos em `visita_evento` (059): pendurar em cada RPC
é escrever a regra cinco vezes e esquecer na sexta.

> ⚠ **Ele nunca levanta exceção.** O técnico está na casa do cliente com
> o celular na mão; travar a baixa porque o estoque discorda seria parar
> o serviço por causa de uma planilha. Serial fora da nossa carga
> (equipamento do assinante, de outra empreiteira, digitado errado) não
> move nada — medido: o movimento é gravado e nada quebra.

**A divergência é registrada, não corrigida em silêncio.** Se a peça
instalada estava, para nós, "no almoxarifado" — ninguém entregou ao
técnico —, a posse muda do mesmo jeito (o fato é que ela está na casa do
cliente) e `posse_motivo` guarda de onde ela veio:
`campo: instalado no contrato 1149124 (antes: COM_TECNICO)`. Quem
conferir o inventário vê que houve peça saindo sem romaneio, em vez de
ver um estoque redondo e falso.

---

### D-158 · A situação mostra também a palavra do TOA, e o atraso vira horas

> *"na situação quero também incluir o status da atividade e Motivo de
> Fechamento Externo dentro do campo situação, isso também tem que
> refletir tanto no campo dos serviços como no campo das equipes"* e
> *"eu quero em horas o atraso sobre a janela, é melhor"* — Emanuel, 23/09

#### 1 · Status da Atividade e Motivo de Fechamento Externo

A etiqueta da coluna Situação é a situação **desta casa**. O TOA tem a
dele, e as duas divergem — no dia 23/09 o contrato 1150092 estava
**EM EXECUÇÃO** aqui e **"não concluído · Liberado no Sistema NETSMS"**
no TOA. Mesma lógica das duas baixas (D-042): as duas lado a lado, para
a diferença aparecer. Os textos saem **como vieram**, sem traduzir.

Aparece embaixo da etiqueta, em `TabelaContratos` — o componente único
de Serviços e Equipes (D-095), então as duas telas mudam juntas.

**Sem migration.** Os dois campos já moravam em `visita.dados_origem`.
O `SELECT_CONTRATO` extrai só as duas chaves no PostgREST
(`dados_origem->>"Status da Atividade"`).

**Recusado: trazer `dados_origem` inteiro.** O JSON cru carrega nome,
telefone e endereço do assinante; a lista não usa isso e não tem por que
mandá-lo pela rede a cada linha.

> ⚠ Chave com espaço funciona porque vai **entre aspas**: o supabase-js
> apaga todo espaço do `select`, **menos** o que está dentro de aspas.
> Conferido no código da `postgrest-js` e com `curl` no PostgREST
> (coluna inexistente dá 400; a extração, 200).

#### 2 · Atraso sobre a janela em horas

106 min vira **1h46** (`horasMin` em `lib/formato.ts`). Negativo sai com
sinal — é quem chegou adiantado.

**Só o texto muda; o comprimento da barra continua em minutos.** As
outras duas etapas (deslocamento, execução) são curtas e ficam em
minutos; desenhar uma barra em horas ao lado de outra em minutos faria o
tamanho mentir. O "Ver tabela" traz as duas leituras.

---

### D-159 · Equipes ganha o filtro de contrato, e a desconexão sai das contas

> *"vamos colocar os filtros no menu equipes, inclusive de janela,
> status entre outros"* · *"não vamos considerar desconexão nesses
> dados da equipe, nem no gráfico do período […] o resto deixa"* ·
> *"onde está escrito nome: vamos mudar para nome técnico"* — Emanuel, 23/09

#### 1 · O filtro de contrato é UM só (`lib/filtroContratos.ts`)

A regra de situação, grupo, origem, resultado e responsável morava
dentro de `Servicos.tsx`. Copiá-la para Equipes seria o caminho de
"Com improdutiva" querer dizer uma coisa numa tela e outra na vizinha —
o mesmo motivo da linha de contrato única (D-095). Saiu para
`passaNoFiltro()`, e as duas telas chamam. Ganhou dois campos novos:
**janela** e **status do TOA** (D-158).

Em Equipes, a barra tem duas linhas: a de cima escolhe **equipe** (área,
supervisor, busca), a de baixo escolhe **contrato**. A equipe fica na
lista se tiver ao menos um contrato que passe; a coluna Contratos mostra
"N no filtro" embaixo do número do dia; a gaveta mostra só os que passam.
Jornada não entra no filtro — não é contrato (079).

**Os números do cartão e dos Períodos continuam sendo do dia inteiro.**
Recalculá-los na tela seria uma segunda cópia da conta de pontos e TEC1
para divergir da do servidor. A tela diz isso quando há filtro ligado.

Para filtrar sem abrir equipe por equipe, a tela carrega os contratos do
dia inteiro numa consulta só, em paralelo ao painel — a mesma carga que
Serviços já faz. As opções de janela, status e grupo saem desse dado.

#### 2 · A desconexão sai das ESTATÍSTICAS da equipe (084)

Sai de: **pontos** concluídos (e o "+N sem regra"), **TEC1**, **tempos**
e a régua de **Períodos**.

Fica em: **Contratos**, **O.S.**, **Situação** ("o resto deixa") e em
**BAIXOU / Último status**. Estes dois são decisão nossa, não dele: são
fato do dia, não estatística, e tirar a desconexão só do cartão faria o
BAIXOU dizer uma hora e o Último status outra na mesma linha.
**Confirmar com o Emanuel.**

O cartão ganha a linha **EXPURGO** ("N desconexão(ões) fora das contas e
dos períodos") — número que encolhe calado parece defeito.

Detecção pelo nome do grupo (`norm_txt = 'DESCONEXAO'`). Contrato sem
grupo **não** é desconexão.

#### 3 · Alinhamento e rótulo

Contratos, O.S. e Último status centrados, cabeçalho e valor juntos.
`NOME` vira `NOME TÉCNICO`.

#### 4 · O OCIOSO media "hoje" em UTC — corrigido na mesma 084

`painel_equipes` decidia OCIOSO e "minutos parada" com
`p_data = current_date`. `current_date` é **UTC**: em Manaus o dia vira às
20h, e dali até a meia-noite local a comparação dava falso para o dia de
hoje — a tela parava de marcar equipe ociosa justamente no fim do turno.
Agora `hoje_local()`, como manda `traps.md`. Achado nesta sessão, pedido
pelo Emanuel em 23/09.

Antes de escrever a 084 foi conferido que a `painel_equipes` viva é
**idêntica** à da 083 (hash do corpo sem comentários e espaços): a 084
parte do que está no banco, não do que está no arquivo.

#### 5 · Medido depois de aplicar (23/09)

Dia 23/09, antes → depois: TEC1 das equipes 001/002/003 passou de 9/9,
11/11, 12/12 O.S. para **7/7, 8/8, 8/8**; execução média 33/22/28 →
**36/24/37 min**; o "+1 sem regra" da 003 era uma desconexão e saiu; a
régua da 003 deixou de acusar "08h–11h acima da capacidade (4 para 3)" —
três das quatro eram desconexão. Pontos não mudaram: as desconexões do
dia não pontuavam. As **9** desconexões fora batem com as 9 do grupo
DESCONEXAO em Serviços.

**Tempo, como `authenticated`, as duas versões lado a lado no mesmo
instante** (a 083 recriada com outro nome numa transação desfeita): 083
≈ **660 ms**, 084 ≈ **540 ms** — a 084 é mais rápida porque calcula o
TEC1 de menos O.S.

> ⚠ **Em aberto:** o painel já estava em ~660 ms, contra os 340 ms
> registrados na D-150. Não é da 084. Vale medir onde vai o tempo
> (`pontos_da_visita` e `tec1_da_os` por linha são os suspeitos) antes
> que o dia com 1.300 visitas volte.

Baterias: `testar_policies()` 16/16, `testar_campo()` 14/14. Nenhuma
tabela sem RLS; nenhuma `SECURITY DEFINER` alcançável pelo `anon`.

---

### D-160 · O estado AFLINE, ao lado do estado do Atlas

> *"olhando estoque, não sei como passar o técnico? por exemplo o perda eu
> achei, como mudar o status para inicializado e transferir para o
> técnico? para ele inserir no contrato quando ele for usar?"* — Emanuel, 23/09

**Revê parte de D-152**, que dizia "estado: não se edita aqui". Continua
não se editando o **do Atlas**. O que nasce é um terceiro eixo:

| | quem afirma | quem grava |
|---|---|---|
| `estado_atlas` | a CLARO | só a importação da carga |
| `estado_afline` | a AFLINE | só `declarar_estado_equipamento`, com motivo |
| `posse` | a AFLINE | romaneio e baixa do campo |

Três opções foram postas; ele escolheu esta. **Recusadas:**
- *só a posse, Atlas intocado* — a peça achada continuaria gritando PERDA
  em todo romaneio, sem ter como dizer "achei";
- *editar `estado_atlas` direto* — a próxima carga desfaz calada, e o
  sistema passa a afirmar o que a CLARO não disse.

**O vocabulário é o do Atlas.** O estado declarado tem de ser um que a
carga já trouxe. "RECUPERADA" seria categoria de patrimônio que ninguém
combinou com a CLARO.

**A importação não apaga a declaração**: `importar_estoque` grava colunas
nomeadas (077). Quando a CLARO corrigir o Atlas, os dois passam a
concordar, e a posição conta quantos **divergem** — é a lista que o
almoxarife leva para a CLARO. O histórico
(`equipamento_estado_evento`) guarda o que o Atlas dizia no instante de
cada declaração.

**O romaneio avisa pelo estado que vale**: `coalesce(estado_afline,
estado_atlas)`. Declarada INICIALIZADO, a peça não grita PERDA. Continua
sem bloquear (D-154).

**O caminho da peça achada, na tela:** abrir a peça na lista → declarar →
escolher o técnico → **entregar**. A entrega cai no romaneio de ENTREGA
já aberto daquele técnico, ou abre um — dez peças achadas na mesma manhã
são um documento, não dez. Nada muda até o técnico confirmar no
aplicativo (D-157); ao lançar o serial na baixa, a posse vai para o
assinante sozinha.

> ⚠ A 085 foi escrita a partir das funções **vivas**, não dos arquivos:
> `estoque_posicao` no banco tem `base as materialized`, que o arquivo 077
> não tem, e `romaneio_por_serial` foi reaplicada sem os comentários. O
> arquivo é histórico; o banco é o estado.

**Testado como `authenticated`, numa transação desfeita:** sem motivo →
recusa (23514); estado "RECUPERADA" → recusa (23514); declarada
INICIALIZADO, o `estado_atlas` continua PERDA e a posição conta 1
divergente; no romaneio de entrega a peça entra **sem** alerta; desfazer
volta ao Atlas; técnico tentando declarar → 42501, e não lê o histórico.
A primeira declaração real foi do próprio Emanuel, pela tela, às 22:57 de
23/09 ("Equipamento encontrado, técnico ciente.").

---

### D-161 · Sub-falhas moram em Configurações, e o cadastro é aberto

> *"vamos levar essa opção lá para as configurações, vamos usar somente o
> hard, e vamos deixá-lo aberto […] se eu quiser ir no cód 500 e
> cadastrar, excluir ou adicionar outra subfalha eu posso, e se eu quiser
> adicionar essa subfalha em mais de um cód, também posso"* — Emanuel, 23/09

**Configurações → Sub-falhas.** Escolhe-se o código à esquerda; à direita,
as sub-falhas dele, com *excluir deste código*, *ligar a outros códigos*
e *nova sub-falha* (com "também nos códigos" opcional). O item saiu do
menu lateral; a tela antiga de importação continua, por link, para
reimportar a planilha da CLARO.

**Só o HARD:** o vigente já era `NÍVEL HARD` (938 sub-falhas, 155
códigos). A aba edita só o vigente; `CASO 1` fica no banco, fora de uso.

**Sem tabela de ligação.** "A mesma sub-falha em vários códigos" é o que o
arquivo da CLARO já faz — **17 nomes** do HARD estão em mais de um
código — com uma linha por par. As três telas de baixa (web, modal do
contrato e aplicativo) já leem por código; uma tabela N:N obrigaria a
reescrever as três para chegar ao mesmo lugar.

**Excluir é `ativo = false`, nunca DELETE.** `ordem_servico` e
`visita_evento` têm FK para `sub_falha`; baixa antiga que perde o nome da
sub-falha é histórico apagado. As três telas de baixa passaram a filtrar
`ativo` — antes não filtravam, e a coluna já existia. Excluída pode ser
reativada.

**Só ADMIN**, escolha do Emanuel. Não precisou de função nova: a policy
`sf_escrita` já dava escrita em `sub_falha` só a ADMIN. A tela esconde
os botões dos outros; quem barra é o banco.

Nome novo entra em **maiúsculas** (o HARD inteiro está assim, e a chave
única `(conjunto, código, nome)` distingue caixa); a categoria é a que o
código já usa.

---

### D-162 · Dez seriais de uma vez, e a carga na mão do técnico

> *"se eu quiser enviar 10 seriais pra ele de uma única vez e retirar?
> como fazer? tenta pegar as ideias da concorrente"* — Emanuel, 26/09

#### O que o concorrente faz (Alfa Gestor → Estoque, explorado em 26/09)

Lido na tela e no código da própria página, sem gravar nada lá:

| Tela deles | Como funciona | Aqui |
|---|---|---|
| **Saída Unificada** | assistente de 5 passos: equipe → bipar serial → tipo de miscelânea → miscelânea → termo | romaneio (D-154) |
| **Colar do Excel** | cola a coluna; o servidor confere tudo e devolve a tabela do que foi **recusado** (serial, situação, equipe) | **entra agora** |
| **Estoque Equipe** | embaixo do campo de bipar: o que a equipe já tem, com a coluna **Dias** | **entra agora** |
| **Devolução** | equipe → endereçável (prateleira/caixa) → situação de destino (inicializado, retirado, com defeito) → bipar a partir do "Em conta" | parcial (marcar na carga) |
| **Alocações** | carga por equipe, caixas de seleção, Resumo por situação, imprimir A4/cupom, termo de responsabilidade, **termo de desconto** | parcial |
| **Aceite digital** | a remessa fica pendente no app do técnico; aceite por **biometria do aparelho**, credencial ou senha; termo assinado em PDF por e-mail | confirmação pelo app já existe (D-157), sem biometria |
| **Bloqueio por carga vencida** | recusa entrega nova se a equipe tem peça "não utilizada nem devolvida há mais de N dias" | **não entra — pergunta** |
| **Autonomia e previsão** | por modelo: instalado no período, em estoque, com técnico, média/dia, **autonomia em dias** | futuro |
| **Pesquisar serial** | histórico do serial com situação, contrato, equipe, login; pesquisa em lote | `PecaDetalhe` parcial |

Uma diferença de fundo: lá a carga é da **equipe**; aqui é do **técnico**
(D-154, escolha do Emanuel). Não mudei.

#### O que entrou

**1. Vários seriais numa chamada — `romaneio_por_seriais` (086-A).** A
tela ganhou "colar vários seriais de uma vez": cola a coluna do Excel ou
a lista do WhatsApp, e o banco lança **cada serial no seu sub-bloco**.
Um serial ruim não derruba os outros nove; volta para a caixa com o
motivo, para corrigir e mandar de novo.

O lote **chama** `romaneio_por_serial` por serial — não reescreve as
recusas. Duas cópias da mesma regra divergem no dia em que alguém mexe
numa delas. O documento é conferido uma vez antes do laço (romaneio
fechado daria dez recusas iguais para um problema só), e o repetido na
lista é recusado como "Repetido na lista.", normalizado igual
(`abc 123` = `ABC123`). Teto de 500 por chamada — tamanho de corpo de
requisição, não regra; a tela fatia.

**2. Retirar sem bipar peça por peça.** O romaneio aberto mostra **"Com
fulano agora"** — a carga dele, com os dias desde que chegou à mão e a
origem (`romaneio 4`, `campo: retirado no contrato…`). Na **devolutiva**
cada peça tem caixa, há "marcar todas" e **"Devolver as marcadas"**, que
usa o mesmo lote. Na **entrega** a lista é leitura: o almoxarife vê o
que ele já leva antes de mandar mais.

**3. O técnico vê a própria carga — `minha_carga()` (086-B).** Antes ele
só via os romaneios dos últimos sete dias, que é recibo, não saldo. A
policy de `equipamento` exige `almoxarifado.ver`, que o técnico não tem
nem deve ter (veria as 15.603 peças). A função devolve só as linhas
`COM_TECNICO` dele. No app, "Material" virou **"Meu material"**, com
"Com você agora" antes dos romaneios.

**4. Na baixa, o serial vem da carga com um toque.** Em "Lançar
equipamento → Instalou", o app lista as peças da carga dele. Digitado na
calçada, um serial de 15 caracteres erra um dígito — e aí a peça não sai
da posse dele para o assinante (D-157). Digitar continua valendo.

#### Web → aplicativo

Com isto, o que a web ganhou desde o D-157 e o campo não tinha: a
**palavra do TOA** (status da atividade e motivo de fechamento externo,
D-158) aparece na visita, como veio. A sub-falha excluída já não aparecia
(D-161). D-159 e D-160 são telas do controle, sem contraparte no campo.

#### Testado como `authenticated`, numa transação desfeita

Lote de 5 (3 bons, 1 repetido com espaço e minúscula, 1 inexistente) →
3 lançados, 2 recusados com o motivo · confirmado, a posse vai para o
técnico · lote em romaneio confirmado → 23514 · `minha_carga` do dono → 3
linhas, `dias = 0`; de outro técnico → 0 · técnico lendo `equipamento`
direto → 0 linhas (RLS) · técnico chamando o lote → 42501 · devolutiva
com as 3 dele + 1 que não é → 3 e 1 ("não está com este técnico") · 501
seriais → 22023. Baterias 16/16 e 14/14; nenhuma função aberta ao `anon`.

**Não verificado:** a tela web clicando (o servidor local pede login, e
a senha do admin não passa pelo assistente) e o app num celular.

#### Perguntas abertas — respondidas no mesmo dia: "siga a regra da concorrente" (D-163)

1. **Bloqueio por carga parada.** Recusar entrega a quem tem peça há mais
   de N dias? Qual N? Vale para peça retirada de cliente também? Hoje os
   dias são só **mostrados**, sem cor de alerta.
2. **Situação de destino na devolutiva** (boa / retirada / com defeito),
   como o concorrente pede. Hoje a peça volta ao almoxarifado sem dizer
   em que estado.
3. **Transferência direta técnico → técnico**, sem passar pelo balcão.
4. **Aceite com biometria** do aparelho e termo em PDF.
5. **Termo de responsabilidade / de desconto** impresso.
6. **Endereçamento** — prateleira e número da caixa no almoxarifado.

---

### D-163 · As regras do estoque do concorrente, do jeito que a AFLINE usa lá

> *"pode seguir com a regra da concorrente"* — Emanuel, 26/09, respondendo
> às seis perguntas do D-162

#### Como "a regra deles" foi lida — e não imaginada

Delegar não é carta branca para inventar (HANDOFF, "Decidi no lugar
dele"). Então cada regra saiu do **próprio Alfa Gestor da AFLINE**, com
o parâmetro que está configurado lá hoje, consultado só para leitura:

| O que foi olhado | O que o dado disse |
|---|---|
| prazo da carga (`diasLimite`) | **0 em 10 de 10 equipes** — inclusive uma com peça de **233 dias**. A regra existe e está **desligada** |
| endereçamentos cadastrados | **0** — a AFLINE nunca usou prateleira/caixa lá |
| documentos de movimentação, 30 dias | **8.865** |
| · Com Técnico - Inicializado | 1.643 (entregas) |
| · Com Técnico - Retirado | 2.112 (retirado do cliente) |
| · Em Estoque - Retirada | 739 (devolveu o retirado) |
| · Em Estoque - Inicializado | 407 (devolveu peça boa) |
| · Em Estoque - Com Defeito RNC | 0 |
| · ACEITE DIGITAL - AGUARDANDO | 0 |
| · Com Técnico - Processo de Cobrança | 0 (termo de desconto) |
| valor por peça | `valor_inventario` 400 / 550 / 700 por modelo — tabela deles, que não temos |

O servidor deles começou a responder **429** (limite de requisições) no
meio da contagem de transferências. Parei ali: não vale pesar na conta da
AFLINE por um número que não muda a decisão.

#### O que entrou (migration 087)

**1 · Prazo da carga — `carga_dias_limite`, nasce em 0.** Mesma frase e
mesmo momento do concorrente: quem recebe (entrega ou transferência) com
peça parada há mais de N dias **não recebe**, e o bloqueio é no **bipar**
(`romaneio_por_serial`), não na confirmação — a peça do documento já
montado pode estar na mão dele, e travar o aceite seria negar um fato. 0
desliga, e **0 é o valor da AFLINE lá**. Editável em Configurações →
Almoxarifado, só ADMIN (`definir_parametro` já exigia). Só **seriais**
contam: o texto deles diz "equipamento(s)".

A conta mora em `carga_vencida_de` (interna, fechada até para o
`authenticated`), porque o almoxarife que lança pode ter
`almoxarifado.editar` sem `ver`. A tela pergunta por `carga_vencida`, que
confere permissão (almoxarifado ou o próprio técnico).

**2 · A condição da peça — `equipamento.condicao`.** O concorrente junta
lugar e condição numa palavra ("Em Estoque - Retirada"). Aqui o lugar já
era `posse`; a condição é coluna nova, com os três valores da devolução
deles: **inicializado · retirado · com defeito**. **Não** é o estado do
Atlas nem o `estado_afline` (D-160, vocabulário da CLARO): é a leitura
operacional do almoxarifado.

- a **devolutiva declara** a condição ao abrir, antes de bipar — o passo
  "Devolução - Situação" deles. Sem padrão: lá são três botões e nenhum
  vem marcado;
- o **campo carimba** `RETIRADO` ao lançar peça retirada (o gatilho de
  079), e o INSTALADO limpa a condição;
- entrega e transferência **levam** a condição que a peça tinha;
- a carga mostra o "Resumo" deles: *19 inicializado · 5 retirado*.

**3 · Transferência técnico → técnico.** Romaneio `TRANSFERENCIA` com
`tecnico_origem_id`. `tecnico_id` continua sendo **quem recebe e quem
confirma** — o técnico de origem **não** confirma pelo outro (medido:
42501). O técnico de origem **lê** o documento (policy nova) e o app diz
"aguardando fulano confirmar". Miscelânea também transfere, com o saldo
conferido na origem. Na web, a carga do técnico de origem aparece com
caixas: marca e "Transferir as marcadas".

**4 · O aceite diz como foi dado — `confirmado_metodo`.**

| método | quem | como |
|---|---|---|
| `APARELHO` | técnico | biometria **ou** bloqueio do celular (`expo-local-authentication`) |
| `SENHA` | técnico | celular sem bloqueio nenhum: a senha do Gestor AF, conferida entrando de novo |
| `BALCAO` | almoxarife | confirmação pela web |

O aparelho **não conta** se foi o dedo ou o PIN, então não afirmamos
"biometria" — é `APARELHO`. O banco não tem como conferir a biometria
(lá também não); o que ele garante é que o técnico **tem** de declarar
o método, e que ninguém pelo cliente se passa por `BALCAO` (medido:
23514). O termo em PDF por e-mail do concorrente **não** entrou — não há
infraestrutura de e-mail; o termo sai impresso (abaixo).

**5 · Termo de responsabilidade A4.** Do documento (entrega e
transferência) e da carga inteira do técnico, pela impressão do
navegador ("Salvar como PDF" de graça). Traz o método do aceite no
rodapé. **O texto da declaração é nosso e neutro** — o PDF deles é
gerado no servidor e não foi baixado. Se a AFLINE tiver um texto
jurídico, ele entra em `app/src/lib/termo.ts`, na constante `DECLARACAO`.

**6 · Uma recusa de conta errada que faltava.** Entre o bipar e a
confirmação o campo pode ter instalado a peça (079). `confirmar_romaneio`
agora confere se cada peça ainda está onde o documento diz que ela sai, e
recusa em vez de puxar da casa do cliente de volta para a van.

#### O que não entrou, e por quê

- **Termo de desconto** ("Processo de Cobrança"): **0 uso em 30 dias** e
  exige valor por modelo, que é tabela deles.
- **Endereçamento** (prateleira e caixa): **0 cadastrado** lá.
- **Imprimir cupom** (impressora térmica): sem sinal de uso; o A4 cobre.

#### Duas armadilhas que o próprio desenho armou

- **Duas FKs de `romaneio` para `tecnico`** deixam o embed pelo nome da
  tabela **ambíguo** — `select=id,tecnico(nome)` passou a devolver
  PGRST201. O componente embute pela coluna (`tecnico:tecnico_id`,
  `origem:tecnico_origem_id`); conferido no PostgREST. Nenhum outro
  lugar embute `tecnico` a partir de `romaneio`.
- `abrir_romaneio` e `confirmar_romaneio` ganharam parâmetros com
  default: a versão antiga foi **derrubada** antes (traps.md), e as novas
  nasceram com `revoke … from public, anon`.

#### Testado como `authenticated`, numa transação desfeita — 14 cenários

devolutiva sem condição → 23514 · transferência para si mesmo → 23514 ·
entrega no balcão → `BALCAO` · aceite do técnico sem método → 23514 ·
técnico dizendo `BALCAO` → 23514 · técnico com `APARELHO` → aceito ·
técnico A consultando a carga de B → 42501 · prazo 1 dia com peça de 5 →
`vencidos 1`, e a entrega recusa com o texto · transferência em lote com
uma peça que não é da origem → 2 entram, 1 recusada · a origem vê o
documento (`eu_recebo = false`) e **não** confirma → 42501 · o destino
confirma com `SENHA` → carga dele 2 · devolutiva como RETIRADO →
`NO_ALMOXARIFADO/RETIRADO` · peça instalada entre bipar e confirmar →
23514 · campo lança RETIRADO → `COM_TECNICO/RETIRADO`.

Baterias **16/16** e **14/14**; nenhuma `SECURITY DEFINER` alcançável
pelo `anon`; `carga_vencida_de` fechada ao `authenticated`. O parâmetro
ficou em **0** em produção.

**Não verificado:** a tela web clicando (login) e o app num celular —
biometria só se prova no aparelho. No Expo Go o iPhone cai no código do
aparelho em vez do Face ID (a permissão só vale num build); Android usa
a digital normalmente.

---

### D-164 · A frota nasce — copiando o que a AFLINE usa, e medindo o que o concorrente não mede

> *"agora copie o modulo frota deles, ou faça até melhor"* · *"no nosso
> caso vamos usar o nome do técnico como condutor tudo bem? nada de
> equipe pra não ter duplicada"* — Emanuel, 26/09

#### O que o dado da AFLINE no Alfa Gestor disse (26/09, só leitura)

| Tela deles | Uso real | O que isso decidiu |
|---|---|---|
| Veículos | **154** ativos | entra |
| Abastecimento | **195 na semana** (id > 26.800); 185 "aprovado", **4** "abastecido"; valor fixo R$ 150/200; odômetro em **191 de 195** | é o coração do módulo; nasce APROVADO por padrão |
| Manutenção | **11 em um ano**, 8 sem valor | entra, simples, e sem valor ≠ R$ 0,00 |
| Portaria | 74 registros num mutirão em **out/2023**, depois 2 | **não entra** |
| Uso e Consumo | mede km pela portaria → **0 de 154** veículos, consumo "—" ao lado de **R$ 108.972** no mês | **refeito** a partir do abastecimento |
| Checklist | 2 formulários de 2024, 1 e 3 perguntas | **não entra** |
| `km_por_litro` | **10,00 em 154 de 154** — padrão nunca mexido | **não existe aqui**: o km/l é medido |
| tipo do veículo | vazio em **153 de 154** | opcional |
| "origem" | 19 opções que misturam **de quem é** com **onde está** (oficina, lanterneiro, férias, "VENDIDO SILAS - 92 9…", DETRAN) | **dois campos**, e vendido = **arquivar** |
| condutor | o **login da equipe** ("109 - EQUIPE") | **o técnico**, com período (pedido do Emanuel) |

O odômetro sobe direitinho carro a carro — três amostras de um mês deram
**9,8 · 7,7 · 9,1 km/l**, contra o 10,00 fixo. E o PHY3690 tem **dois
abastecimentos de 27 L com 2 km de diferença** em 04/09, que ninguém vê
lá. Esse par virou o caso de teste.

#### O modelo (migration 088)

- `veiculo` — placa normalizada (`phy-3690` = `PHY3690`, única por
  empresa), apelido, modelo, tipo, ano, chassi, renavam, rastreador;
  **`propriedade`** (própria / locadora / do técnico) e **`situacao`**
  (os quatro status do concorrente: ativo, na garagem, fora da garagem,
  em manutenção). Arquivar exige motivo e encerra o condutor.
- `veiculo_condutor` — técnico **com período** (`desde`/`ate`), um atual
  por carro. O mesmo técnico em dois carros **não** é recusado (ninguém
  combinou que não pode); a tela avisa.
- `veiculo_evento` — situação, condutor, cadastro, arquivamento: prova.
- `abastecimento` — o fluxo do concorrente (em aberto → aprovado →
  abastecido; cancelado com motivo, sem volta). Litros = valor ÷ preço
  quando não informados. O condutor vem do carro e pode ser trocado.
- `manutencao` + `manutencao_item` — corretiva/preventiva, serviços com
  valor; o total é soma, e serviço sem valor fica "sem valor".
- Odômetro atual = o maior conhecido (cadastro, abastecimento,
  manutenção), **calculado**, nunca guardado.

Permissões: a fundação existia (papel `FROTA` no enum, `frota.ver`
"Modulo ainda nao construido"). Acesa `frota.ver`, criada `frota.editar`,
criado o perfil **"Frota"** para o papel que não tinha perfil; ADMIN
recebe as duas. Leitura por RLS com `(select tem_permissao(...))`;
escrita só por função `SECURITY DEFINER` que confere papel e chave.

#### O que é melhor que o concorrente

**1 · Consumo real.** `frota_intervalos` / `frota_consumo`: entre duas
leituras **válidas** de odômetro o carro andou a diferença com todo o
combustível que entrou no meio. Km/l e custo por km por veículo **e por
técnico**, e da frota inteira ponderado (soma do km ÷ soma dos litros,
nunca média de médias). Sem trecho medido: "sem km medido", não zero.

**2 · Exceções sozinhas** (`frota_excecoes`), para conferir, nunca
bloqueio:
- **odômetro voltou** — menor que o maior já lido no carro;
- **sem odômetro** — o combustível conta, o km não;
- **km muito baixo** — o trecho rendeu menos de **1/3 do km/l mediano
  do próprio carro** nos últimos 90 dias (com ≥ 3 trechos). **O corte de
  1/3 é nosso**, não da AFLINE: compara o carro com ele mesmo, não com
  número de fábrica. Está em um lugar só (088-G) para ajustar.

**3 · Avisa antes de errar.** No lançamento, odômetro menor que o último
conhecido fica âmbar e diz que vai virar exceção; o preço do litro repete
o último (é o mesmo posto — 182 de 195 a R$ 7,29 na semana).

#### O defeito que o teste pegou antes da tela

A primeira versão comparava cada abastecimento com o **anterior** (`lag`).
Com a sequência real do PHY3690 mais um odômetro digitado errado
(131.000 depois de 131.697), os 697 km "voltavam" no trecho seguinte, e o
abastecimento sem odômetro sumia do combustível: **13,61 km/l**. O certo
é ir de leitura válida a leitura válida somando todo o combustível do
meio — **1.264 km** (exatamente 131.933 − 130.669), **7,09 km/l**,
R$ 1,19/km. Corrigido na mesma migration (088b), e o arquivo 088 tem a
versão certa com a caixa explicando.

#### Testado como `authenticated`, numa transação desfeita

placa normalizada e repetida recusada (23505) · placa curta (23514) ·
condutor trocado guarda os dois períodos · abastecimento herda o condutor
· abastecido não volta a aprovado; cancelar sem motivo recusado · consumo
e as três exceções da sequência real (acima) · painel com odômetro atual
131.933 e o condutor · manutenção com um serviço de R$ 350 e um sem valor
→ total 350, "1 sem valor" · carro arquivado não abastece · eventos
CADASTRO, SITUACAO, ARQUIVADO · técnico lê **0** veículos, abastecimentos
e painel, e não cadastra (42501). Baterias 16/16 e 14/14; nenhuma tabela
sem RLS; nada alcançável pelo `anon`. Embeds conferidos no PostgREST.

**Não verificado:** a tela clicando (login) e com volume real — o banco
de produção tem **zero** veículo. Os 154 do concorrente não foram
trazidos (ver pendências).

#### Pendências — perguntas ao Emanuel

1. **Trazer os 154 veículos** do sistema anterior? Placa, apelido,
   modelo, ano, chassi, renavam e rastreador vêm limpos. O condutor
   **não**: lá é a equipe, e cada equipe tem dois técnicos — alguém
   precisa dizer qual.
2. **O que são "REDE PRÓPRIA/ALUGADA", "CASA/FROTA PRÓPRIA" e "Vale
   Transporte"** no campo origem deles? Não foram mapeados.
3. **O técnico pede abastecimento pelo celular?** Lá 7 de 195 foram
   lançados pelo próprio condutor. O banco já tem "em aberto"; falta a
   tela no aplicativo.
4. **O corte de 1/3** do "km muito baixo" serve, ou a AFLINE tem outro?

---

### D-165 · O estoque ganha os menus que faltavam, e o catálogo vem do concorrente

> *"estou achando bem simples o nosso, tipo poucas opções"* · *"o técnico
> envia, o outro aceita, e o time central do almox precisa aprovar"* ·
> *"no modulo ferramenta, é bom ja pegar o que tem cadastrado deles pra
> gente copiar os nomes"* · *"quantos carros alugados temos, e carros
> próprios, quantos levam carro pra casa"* — Emanuel, 26/09

#### A comparação, menu a menu (Alfa Gestor da AFLINE, só leitura)

| Menu deles | Antes | Agora |
|---|---|---|
| Dashboard, Saída, Devolução, Transferência | ✅ (melhor: lote, condição, aceite, prazo) | ✅ |
| **Equipes / Alocações** | ❌ só dentro do romaneio | ✅ aba **Cargas por técnico**, com termo e planilha |
| **Movimentações** · **Pesquisar Serial** · **Pesquisa em Lote** | ⚠️ só o histórico de estado | ✅ aba **Movimentações e pesquisa** |
| **Baixar Miscelâneas** (por contrato) | ❌ | ✅ aba **Baixa por contrato** |
| **Kardex - Miscelânea** | ❌ | ✅ por item, no almoxarifado ou na mão de cada técnico |
| **Auditar Miscelâneas** ("novo saldo") | ⚠️ ajuste solto | ✅ **contar** por item: vira AJUSTE com a diferença |
| **Configurações → Miscelâneas** (catálogo com tipo) | ❌ código e nome | ✅ tipo, valor, C.A., "gasta no contrato" + **418 itens** |
| Transferência **pedida pelo técnico**, com aprovação | ❌ | ✅ celular pede → colega aceita → almoxarifado aprova |
| Reversas, Notas Fiscais, NetHome/BTP/VTal/Gestech, Em trânsito | — | **fora**: integrações de operadora que não se aplicam |
| Reposições / kits | — | **fora**: os 11 kits deles não têm composição (lista de reposição vazia) |
| Endereçáveis | — | **fora**: 0 cadastrados (D-163) |

#### O catálogo (089b)

687 itens lá, **420 ativos**: 96 ferramentas, 235 EMIS (material de
instalação), 78 EPI/EPC, 11 acessórios. Os 267 inativos incluem a REDE
EXTERNA inteira (145) e não vieram. O "código" deles é três coisas num
campo só — SAP no EMIS, **C.A.** no EPI, "0000"/"-"/marca na ferramenta
— e a carga separa: 233 materiais com código SAP, 68 EPIs com C.A. Valor
0,00 lá virou NULO aqui (D-117). Fonte versionada em
`supabase/dados/catalogo_miscelanea_alfa_2026-09-26.txt` (é catálogo de
peça, não dado de assinante).

**Levou três tentativas, e as duas falhas eram do nosso banco
funcionando:** `codigo` nascera NOT NULL (089a tira) e depois o índice
único de código SAP pegou **duas duplicatas deles** — 479 = 451
(22025348) e 475 = 463 (22059179, este com "SE" no lugar de "5E"). Ficou
o cadastro mais antigo de cada par: **418 itens**.

#### Transferência pedida pelo técnico (089-C)

`solicitar_transferencia` (origem, pelo celular) → `confirmar_romaneio`
pelo destino grava o **aceite** (APARELHO/SENHA) sem mover nada →
`confirmar_romaneio` pelo almoxarifado **aprova** e só aí posse e saldo
mudam. O método que fica no documento é o do aceite de quem recebeu. A
origem desiste e o destino recusa por `cancelar_romaneio`, enquanto não
aprovado. O prazo da carga (087-A) vale para o destino também aqui.

O técnico só lê a própria equipe em `tecnico` (RLS); para escolher o
colega há `tecnicos_para_transferir()` — nome e matrícula dos ativos, e
nada mais. `minha_miscelanea()` dá o saldo dele para escolher material.

#### O que o teste de ponta a ponta mostrou (como `authenticated`, desfeito)

Entrada de 100 conectores e 10 luvas → **entrega** a A (3 seriais, 40
conectores, 2 luvas), aceita no celular (`APARELHO`) → A tenta mandar
peça que não é dele (23514) e mais conector do que tem (23514) → A **pede**
1 serial + 15 conectores para B → A tenta aceitar o próprio pedido
(42501) → almoxarifado tenta aprovar **antes** do aceite (23514) → B
aceita com `SENHA` e **a carga dele não muda** → almoxarifado aprova:
peça e conectores mudam, método `SENHA` → **cargas**: A com 3 seriais e 2
materiais, B com 2 e 1 → **devolução** de A como RETIRADO: posse
`NO_ALMOXARIFADO/RETIRADO` → **baixa por contrato**: B baixar 50 é
recusado, 3 entram como CONSUMO no contrato → **auditoria**: contou 58,
sistema dizia 65, ajuste de −7 → **Kardex** e **histórico do serial**
contando a história certa → técnico não lê cargas, Kardex nem histórico,
e não baixa (42501). Baterias 16/16 e 14/14; nenhuma tabela sem RLS;
nada alcançável pelo `anon`.

**O defeito que o teste pegou:** o Kardex ordenava lançamentos do mesmo
instante pelo `id` (uuid aleatório) — o saldo final batia, mas o "saldo
anterior" de cada linha saía embaralhado. 089c acrescenta `seq` (ordem
de gravação); conferido: 0 → 100 → 60 → 65 → 58.

#### Frota: onde o carro dorme (089-A)

`veiculo.pernoite` (leva para casa / dorme na base) separado de
`propriedade`. Na aba Veículos, um quadro **propriedade × onde dorme** da
frota ativa responde as duas perguntas do Emanuel.

**"REDE PRÓPRIA/ALUGADA" e "Vale Transporte" continuam sem destino**:
o Emanuel explicou que "isso é a frota" (alugado, próprio, leva para
casa) — o que virou propriedade e pernoite. Se "REDE" for a frota da
equipe de rede e "Vale Transporte" o técnico sem carro, são outra
dimensão, e a pergunta fica em aberto.

#### Não verificado

A tela web clicando (login) e o app num celular. A importação dos 154
veículos da frota não foi feita (pendente de decisão, D-164).

---

### D-166 · A importação vai para o dia de atuação, e o menu ganha a marca

> *"quando eu fizer a importação de algum arquivo, mesmo que a data esteja
> diferente, a importação da rota, ele precisa ir para o dia atual, so
> sera importado para o dia anterior quando nos escolhermos a data que
> vamos atuar"* · *"vamos integrar essa logo da empresa no nosso sistema
> […] explore o menu deles […] ajuste também o menu da importação, quando
> fazemos uma importação o menu lateral some"* — Emanuel, 26/09

#### Quem decide o dia é quem importa (090)

**O defeito, medido:** a visita caía no dia da coluna "Data" da planilha.
Em 26/09 a única importação do dia (`Atividades-ARN-AFLINE_25_09_26.xlsx`)
trazia **Data = 25/09 nas 29 linhas**: a rota de hoje entrou ontem, e o
painel de hoje abriu vazio. Nas 20 importações de 10 a 23/09 as duas
datas batiam — por isso só apareceu agora.

`importacao.data_atuacao` guarda a escolha. A tela nasce em **hoje** e só
manda outro dia quando a pessoa escolhe (atalhos Hoje / Ontem, ou o
calendário). Chamada sem data vale `hoje_local()` — o default da coluna e
o `coalesce` da função — nunca `current_date`.

O dia de atuação governa **tudo** que antes lia "Data": `data_agendada`
(criação **e** atualização), a equipe do login na data, `inicio`/`fim`
(que eram "Data + hora" — deixá-los no dia da planilha poria o contrato
de hoje com início ontem, e o TEC1 daria 24 h de atraso) e o
`toa_recurso` aprendido na reconciliação.

**Nada se perde:** a "Data" original continua em `dados_origem`; o
evento `IMPORTADA` grava `dia` e, quando diverge, `data_planilha`;
contrato que **já existia** e muda de dia ganha evento `DIA_DE_ATUACAO`
(sem aviso ao técnico — o gatilho de avisos ignora tipos que não
conhece). Importação antiga fica com `data_atuacao` **nula**, e o
histórico escreve "da planilha": ninguém escolheu dia nela, e preencher
seria inventar a escolha.

**A diferença aparece antes do clique.** A prévia mostra "a coluna Data
diz 25/09 · vale o dia de atuação: 29 visitas entram em 26/09", com um
atalho "atuar em 25/09". O botão diz o dia (`Importar 29 visitas em
26/09`). Dia diferente de hoje deixa o cartão âmbar. Depois de importar,
"Importar outra" volta para hoje: o dia anterior é escolha de uma
importação, não um modo que fica ligado.

**Recusado:** adivinhar o dia pelo mais frequente da planilha e só
perguntar quando divergisse — seria o sistema decidindo no lugar de quem
opera (D-088).

**Testado** como `authenticated` (o usuário que fez a importação de
26/09), numa transação desfeita: reimportar as 29 linhas com dia 26/09 →
29 atualizadas, **29 em 26/09**, 29 eventos `DIA_DE_ATUACAO`, 0 início
fora do dia, `data_atuacao` gravada. Baterias 16/16 e 14/14; nenhuma
SECURITY DEFINER alcançável pelo `anon`; `j_ts_no_dia` fechada ao `anon`.

#### A importação dentro do Shell

A tela de Importação tinha cabeçalho próprio (logo + "Controle ›
Importar planilha") e **não usava o `Shell`** — por isso o menu lateral
sumia. Agora é uma tela como as outras.

#### A marca, em vetor

A arte veio como PNG quadrado com o fundo "de esfera" pintado. Reduzida a
28 px vira borrão, e no tema claro o fundo escuro vira carimbo. Foi
**redesenhada em SVG** sobre a arte original (sobreposta para conferir a
geometria): `LogoCompleto` (AF + LINE, com o "LINE" em `currentColor`,
branco no escuro e grafite no claro) na lateral e no login; `Logo` (só o
AF num selo com fundo em tokens) no menu recolhido, no celular e no
`favicon.svg`.

#### O menu, olhando o do concorrente

O ngestor (`docs/05`) separa módulos e, dentro, grupos com **contador ao
lado do item** ("Serviços 13"). Veio: Serviços mostra os contratos **em
aberto hoje**, na mesma conta da tela (situação em `EM_ABERTO`, jornada
fora). Enquanto não sabe, **não mostra número** — um "0" no carregamento
afirmaria que não há nada aberto (D-117). Recontagem a cada 2 min e a cada
troca de tela; sem Realtime, porque cada canal é uma conexão do teto do
plano Free.

O que ele não tem e entrou:
- o grupo **abre e fecha e lembra** (quem só mexe em estoque fecha
  Operação uma vez); o grupo da tela atual nunca fica fechado;
- **Ctrl+K** vai para qualquer tela digitando, sem conhecer o mapa;
- o topo diz **onde você está** (Módulo › Tela);
- a tela ativa tem a **barra vermelha** na borda, legível também recolhido;
- quem está logado fica no **pé da lateral**;
- no celular, **gaveta** com o mesmo menu. A faixa de botões antiga
  escondia a Frota e ignorava a permissão de cada módulo.

**Não explorado ao vivo:** o Chrome com a sessão do ngestor não estava
conectado nesta sessão, e o navegador embutido não tem login lá. O
desenho partiu do mapa já levantado em `docs/05`.

---

### D-167 · O campo conversa com o controle: painel, ranking, chat, material, combustível e a central

> *"visão de produtividade do técnico […] quantos pontos ele já fez, e
> quantos ainda falta para a meta, visão de rank […] módulo combustível
> […] módulo estoque […] sinalizar que está faltando algum ferramental ou
> está com defeito […] módulo chat […] popup ou selo no canto superior
> direito, informando técnicos que perderam tec1, técnicos menos
> produtivos até 12 horas, até 15 horas, até 18 horas, técnico que mais
> quebrou […] quando o técnico jogar o contrato no pendente, que é ajuda
> ao controlador, o sistema vai enviar uma notificação"* — Emanuel, 27/09

#### As definições, perguntadas antes de escrever (27/09)

| pergunta | resposta do Emanuel |
|---|---|
| "jogar no pendente" é o quê? | **é o Impedimento** do app |
| o que é contrato "quebrado"? | **O.S. com baixa IMPRODUTIVA**; pontos perdidos = o que ela valeria |
| o que o técnico vê do ranking? | **a lista inteira**, com nome e pontos |
| "menos produtivo até 12/15/18h"? | **abaixo do ritmo da meta** |
| os números do ritmo (proposta minha) | **aprovados**: meta do dia = mês ÷ 26; jornada 08:00–18:00, em linha reta |
| meta da ADESÃO | **120 pts/mês**, configurável na Administração |

#### Uma conta, três telas (091)

`producao_por_tecnico` é a conta única — pontos (só concluída, jornada
fora), quebradas, pontos perdidos, TEC1 perdido — e alimenta o painel do
técnico, o ranking e a central. Se cada tela somasse do seu jeito, o
técnico e o COP leriam números diferentes para o mesmo dia. Conferido:
os **32,10 pts** do técnico de teste batem com o que o app já mostrava.

- **Quebrada** usa o código da **operadora** (`codigo_baixa_id`), o
  mesmo que Dashboard e Serviços contam.
- **Pontos perdidos** só contam quebrada **não concluída** (uma visita com
  uma O.S. improdutiva e outra de sucesso, concluída, recebeu os pontos).
  Quebrada **sem regra** de pontuação vai à parte (`perdidos_sem_regra`),
  nunca como zero perdido (D-117).
- **Ritmo**: em cada corte já passado, técnico com visita produtiva hoje
  e pontos concluídos até o corte < meta do dia × fração. "Concluída até
  o corte" = `fim` do TOA **se** `finalizado_toa` (D-103), senão
  `situacao_em`. Técnico **sem meta** para a skill não é "abaixo" nem
  "acima": entra em `sem_meta`, e a central diz quantos são.
- **Pedido de ajuda** = contrato de hoje em `COM_IMPEDIMENTO` cujo último
  evento para essa situação veio do **campo** (`origem = MOBILE`).

#### O chat: uma conversa por técnico

Individual do lado do campo (nenhum outro técnico lê); **compartilhada**
entre os controladores que enxergam a equipe dele — a troca de turno não
deixa a pergunta numa caixa que ninguém abre. Autor e conversa
carimbados pelo servidor (D-061). `mensagem` entra no Realtime (é magra,
sem dado de assinante); o app assina filtrando por `tecnico_id`, a web
por RLS. **Recusado:** conversa por par controlador×técnico.

#### Material e combustível pelo campo

- **Sinalização** (faltando / com defeito) é um PEDIDO: não mexe em
  saldo nem posse (D-154). O almoxarifado responde (recusar exige motivo)
  e a resposta volta como **aviso** na agenda (`aviso.tipo = MATERIAL`).
- **Abastecimento**: responde a pendência 3 da D-164 — sim, o técnico
  pede pelo celular. Nasce `EM_ABERTO`, a frota aprova no fluxo que já
  existia. O carro é o do **condutor atual**; o cliente não escolhe
  veículo. Odômetro opcional, com aviso se voltou — nunca bloqueia.

#### A central (o sino) e o chat na web

Um `CentralProvider` **acima das rotas**: um canal de Realtime a sessão
inteira (se morasse no Shell, cada troca de página fecharia e reabriria a
assinatura). A central é relida a cada minuto; o Realtime só antecipa
dois gatilhos com aviso na hora — pedido de ajuda e mensagem do campo. O
sino conta o que pede **ação**; mensagem tem selo próprio no balão.
Estoque e Frota ganham selo no menu com o que o campo pediu e espera.

#### O aplicativo: barra de baixo

A agenda continua a tela inicial (D-112). As outras portas — Painel,
Conversa, Material, Abastecer — numa **barra de baixo**, ao alcance do
polegar, sem ícone (sem biblioteca, e "Abastecer" escrito não precisa de
legenda). Trocar de aba substitui a tela: a pilha fica rasa. A marca é a
arte oficial (sem SVG no app sem instalar biblioteca).

#### A meta na Administração (092)

A meta **já** era configurável, escondida em Meta técnica › Editar
tabela. Ganhou aba própria em **Administração › Metas**, com as skills
lado a lado — o buraco que interessa é a skill **sem** meta. A de
ADESÃO (120) foi gravada pela função, **autenticada como o Emanuel**:
autor dele, declaração dele (a mensagem de 27/09).

Dois defeitos achados em `definir_meta_comissao` (037) ao abrir a porta:
1. a meta antiga era fechada com `ativo = false`, e toda leitura filtra
   `ativo` — **mudar a meta em outubro deixaria setembro sem meta**, o
   contrário do que o comentário prometia. Agora fecha só pela vigência;
2. `current_date` (UTC) → `hoje_local()`.

Limite conhecido: meta trocada **no meio** do mês deixa duas vigências no
mês; `meta_da_skill` fica com a mais nova, `produtividade_periodo` pega
uma sem ordem.

#### Defeitos que o teste pegou

- **091b:** `aviso.tipo` é uma lista fechada (CHECK) e a resposta do
  almoxarifado estourou 23514. A conferência de restrições olhava NOT
  NULL e esqueceu CHECK.
- **091c:** o painel levava **528 ms** com 240 visitas — calculava a
  produção do mês quatro vezes. Uma vez: **178 ms**, números idênticos.
- O leitor de valor do app lia "6.49" como 649 (tirava o ponto como
  milhar). Com vírgula, ponto é milhar; sem vírgula, ponto é decimal.

#### Testado como `authenticated` (transação desfeita)

técnico: painel, ranking (2º de 3), manda mensagem (lê 1), **não** escreve
na conversa de outro (42501), sinaliza, **não** responde sinalização
(42501), sinalização vazia recusada (23514), abastecer sem carro (P0002),
**não** abre a central (42501), lê o catálogo (419) · gestão: lê a
conversa, responde, marca lida, central completa, recusa com motivo →
aviso MATERIAL, responder duas vezes recusado (23514). Baterias 16/16 e
14/14; nenhuma tabela sem RLS; nada alcançável pelo `anon`;
`producao_por_tecnico` fechada até para `authenticated`.

#### Não verificado

O app num celular (compila e empacota; não foi aberto). A web clicando
com dados reais de hoje (27/09 ainda sem visita): sino, chat e abas
abriram, mas nenhuma mensagem nem sinalização foi gravada em produção
pela tela. O Realtime ponta a ponta (celular → web) não foi exercitado.

#### Depois, no mesmo dia (093)

**A escala foi resolvida.** > *"pode rodar"* — Emanuel.
`pontos_das_visitas(uuid[])` faz a mesma conta de `pontos_da_visita`
para o conjunto: assinatura numa agregação, regra por junção. A regra da
edificação (e a da origem dela) saiu de dentro da função por visita para
`edificacao_de()` / `edificacao_origem()`, puras, que as duas versões
chamam — copiar a regex seria ter duas para divergir.

Provado antes de trocar: **0 diferenças** nas 240 visitas (pontos,
edificação, origem, achou). Tudo como `authenticated`:

| função | antes | depois |
|---|---|---|
| `pontos_por_periodo` (Serviços, Equipes, Relatórios, Painel do dia) | 388 ms | **35 ms** |
| `painel_do_tecnico` | 178 ms | **54 ms** |
| `ranking_tecnicos` | 111 ms | **17 ms** |
| `produtividade_periodo` | — | 23 ms |

Diferença deliberada: sem tabela de preço ativa, a versão antiga SUMIA
com a visita (`cross join`); a nova a devolve com `achou = false` —
"sem regra", não fora da conta (D-117). `pontos_da_visita` continua: a
tela do contrato mostra a regra que casou, e isso é por visita.

**Faixas da ADESÃO** — > *"coloque 110 na faixa de comissão, depois posso
trocar"*; perguntado, o Emanuel escolheu: começa em 110 e segue a escada
da SINGLE MASTER deslocada 10 pts para baixo (110→119 fator 2,00 …
290→390 fator 12,00). Gravadas por `definir_faixas_comissao`
autenticada como ele. **Consequência que ele precisa saber:** a faixa
começa ANTES da meta (120) — a ADESÃO recebe fator a partir de 110. O
texto de Meta técnica que dizia "abaixo da meta não há fator" foi
corrigido.

#### Pendências

- Metas e faixas de MANUTENÇÃO e DESCONEXÃO.
- `agenda_do_campo` e `painel_equipes` ainda chamam `pontos_da_visita`
  por linha — são de UM dia (dezenas de visitas por equipe), não do mês;
  trocar se medirem lentas.

---

### D-168 · O primeiro teste no celular: teclado, status livre, resposta do controlador e miscelânea

> *"quando ele vai digitar, o campo de digitação não sobe […] quem tiver a
> visão controlador […] quando o técnico responder o pendente que é o
> impedimento, o operador deve aparecer a função responder e escolher o
> status […] o técnico deve ter opção de escolher o status […] a opção
> lançar equipamento […] não parece botão […] não aparece o botão de
> lançar miscelânea"* — Emanuel, 27/09, testando no Expo Go.

O chat funcionou de ponta a ponta no primeiro teste (técnico escreve →
controle responde na web → chega no celular). O que o teste mostrou:

**1. O teclado cobria o campo.** O Android do Expo SDK 57 é edge-to-edge:
a janela não encolhe quando o teclado abre, e `KeyboardAvoidingView` com
`behavior={undefined}` no Android não fazia nada. Agora `'height'` no
Android (`'padding'` no iOS) na Conversa, no Abastecer e na tela do
contrato — onde o rodapé é `position: absolute` e só sobe se a área
encolher.

**2. O controlador responde e muda o status.** Card "Responder ao
técnico" na página do contrato: mostra o pedido de ajuda (o Impedimento
vindo do campo, com a observação dele), deixa escolher o status e
escrever a resposta — que chega no celular como AVISO, porque a
observação de uma mudança de status já vira aviso (059). Não é canal
novo. Contrato aberto muda por `registrar_etapa`; encerrado só volta por
`reverter_situacao`, com motivo obrigatório (D-030). "Encerrado" é o que
não está em `EM_ABERTO` — a lista que a web já tinha, sem cópia nova.
E um botão abre a conversa com o técnico.

**3. O técnico escolhe o status.** "Mudar status ›" no rodapé abre as
sete situações que já existem. Perguntado sobre "não concluído", o
Emanuel corrigiu: *"não concluído, cancelado e reagendado, me enganei —
pode corrigir para como está"*. As travas continuam no banco (055):
encerrar exige GPS e todas as O.S. baixadas; encerrado não volta pelo
campo. A tela só antecipa ("falta baixar 1 O.S.").

**4. Equipamento e miscelânea.** "Lançar equipamento" era `tom="discreto"`
— cinza sobre o fundo cinza, parecia texto. Virou botão de contorno. E a
miscelânea entrou no contrato (094): `baixar_miscelanea` era só do
almoxarifado; `baixar_miscelanea_do_campo` faz a mesma conta (sai do
saldo DELE, recusa o que ele não tem) com o técnico sempre sendo o do
login, e passa pela MESMA trava da foto (`pode_anexar_na_visita`: equipe
dele, só no dia). Ferramenta e EPI não aparecem — não se gastam.

**Testado como `authenticated` (desfeito):** saldo 10 → lançou 3 → saldo
7, aparece em `miscelanea_do_contrato`; 50 recusado (23514); contrato de
10/09 recusado com o recado da trava (42501); a porta do almoxarifado
continua fechada ao técnico (42501). Baterias 16/16 e 14/14.

**Ferramenta:** `@expo/ngrok` como devDependency do `campo/` (a instalação
global que o Expo oferece não é achada no Windows) e `app.cmd` na raiz
(`.\app`) — todo terminal novo nasce na raiz, onde `npx expo start` falha.
O túnel do ngrok caiu ("remote gone away"); o teste foi pelo Wi-Fi.

**Não verificado:** o teclado corrigido e as telas novas no celular (tsc e
`expo export` limpos; o Expo Go recarrega sozinho se o servidor estiver
de pé). A resposta do controlador não foi gravada pela tela em produção.

---

### D-169 · Um contrato por dia, um status ativo por vez, sinais que se limpam e o botão de suporte

Segunda rodada de teste no celular e na web (Emanuel, 27/09). Sete pedidos.

#### 1. O menu do botão direito abria longe do clique

Era `fixed`, mas morava dentro da linha da tabela: um ancestral com
transform/backdrop-filter faz o navegador medir o `fixed` a partir dele. Foi
para a raiz do Shell por **portal**, e a posição passou a usar
`translate(-100%)` quando não cabe (abre para a esquerda/para cima) — com o
tamanho REAL do menu. Medido: o canto do menu cai a **0 px** do clique.

#### 2. Miscelânea logo abaixo do equipamento

Estava depois do histórico, no fim da tela, e sumia.

#### 3. Agenda com três abas

**A fazer** (na entrada, atribuída, com impedimento) · **Em rota / Iniciado**
(em deslocamento, em execução) · **Baixadas**. Impedimento ficou em "A fazer":
o contrato não está andando, está esperando.

#### 4. Mudar só o status, sem código de baixa

> *"quando o controlador ou quem seja quiser mudar apenas o contrato de
> status ele pode, não é obrigatório ter código de baixa"*

No modal do contrato, sem nenhuma O.S. preenchida, aparece "Só mudar o
status" (`registrar_etapa`). **Encerrar continua exigindo todas as O.S. com
código** — é regra do banco (`exige_todas_baixadas`, business-rules "A
baixa") e não foi mexida; a tela avisa antes. Encerrado volta pelo
"Voltar", com motivo (D-030).

#### 5. Sinais: limpa, volta se acontecer de novo, histórico do dia (095)

> *"o usuário pode limpar, e caso aconteça de novo a situação, ele retorna
> […] não pode é ficar subindo a mesma sempre […] histórico de
> notificações"*

Cada coisa acusada vira um **sinal** com uma chave que define "a mesma
coisa": TEC1 por **visita**; suporte por visita + hora do pedido; ritmo por
técnico + dia + corte; quebrou por técnico + dia + **quantas**; material e
abastecimento pelo pedido. Limpar é **por usuário** (`sinal_dispensa`). Uma
perda nova tem chave nova e sobe; a mesma não volta. O sino tem "Agora" e
"Histórico do dia" (ativo / limpo / resolvido). Aviso na tela só para sinal
NOVO desde que a página abriu — a primeira leitura só aprende o que existe.
Do ritmo, vigente é só o **último corte** (095c): o sino listava o mesmo
técnico às 12h e às 15h.

#### 6. "Solicitar suporte técnico"

> *"o botão ajuda é o botão com impedimento […] quero colocar o botão
> 'Solicita Suporte técnico' no canto superior direito do app"*

"Suporte" no topo da Agenda (escolhe o contrato — o em andamento vem
marcado — e escreve o que está acontecendo) e no topo do contrato (abre o
campo do Impedimento). Grava `COM_IMPEDIMENTO` com a observação
"Suporte técnico: …" — o mesmo status, a mesma central. Na web o sinal se
chama "Suporte técnico".

#### 7. Um status ativo por técnico (095)

> *"não permita que a linha do técnico tenha dois status de contratos
> diferentes […] só deixe isso acontecer se estiver na planilha de
> importação […] nem pelo controlador, nem por ninguém"*

Gatilho em `visita` (a porta de todas as outras): Em deslocamento / Em
execução, mesmo dia, mesmo técnico (sem técnico, a equipe). Fora da conta:
a importação; jornada; e o que o TOA **fechou e ninguém tocou**
(`finalizado_toa` e `bloqueado_em` nulo) — a atividade fica "em execução"
só esperando a baixa (D-097). **O teste pegou** a primeira versão, que
ignorava todo `finalizado_toa`: o 1086530 (TOA concluiu, o campo reabriu)
deixava passar um segundo ativo (095b). Testado (desfeito): gestão, reversão
e campo recusados (23514); impedimento permitido; saindo do primeiro, o
segundo entra. **Um conflito já existia em 27/09** (GABRIEL: 1150297 em
deslocamento + 1039558 em execução) — a trava não corrige o passado.

#### 8. O mesmo arquivo em outro dia gera contratos novos (095)

> *"se eu importar um arquivo do dia 21, na data do dia 21, e por acidente
> importar ele na data de hoje dia 27 sem querer, o sistema não deve puxar
> o histórico de movimentações anterior, ele deve gerar contratos novos
> para aquele dia, porém a mesma rota se repete"*

A chave única era (base, atividade do TOA) — e a 090 MUDAVA o contrato de
dia, levando baixa, foto e histórico. Agora é (base, atividade, **dia**).
**Isto substitui a parte da D-166** em que o contrato já existente "mudava
de dia com evento DIA_DE_ATUACAO": esse evento deixa de acontecer. Testado
(desfeito): o arquivo de 27/09 importado no dia 28 criou **29 contratos
novos**, os 29 originais ficaram no dia deles, e nenhum evento antigo foi
junto.

**Não verificado:** as telas do app no celular (tsc e `expo export` limpos);
sinal limpo por um usuário e visto por outro, na tela.

---

### D-170 · Atualizar forçado, o melhor contato, o rastro do técnico, o local da baixa e a central de monitoramento

Cinco pedidos do Emanuel (27/09), numa leva só. Migration **096**.

#### 1. "Atualizar" em Equipes e em Serviços

> *"é bom colocarmos um botão atualizar, para atualizar forçado os status
> do contrato quando necessário. na aba serviços também ok?"*

`BotaoAtualizar` (componente único) no topo das duas telas e do
Monitoramento. Busca de novo e diz **há quanto tempo** a tela foi
buscada ("· há 3 min"). O tempo real continua; o botão é para quando ele
cai ou quando se desconfia do que se vê. Em Serviços é o mesmo que aceitar
as "mudanças em espera" (zera o contador).

#### 2. O melhor contato do cliente, ao concluir

> *"na hora em que o técnico finalizar no app como concluído, o sistema
> automaticamente deve subir uma caixinha informando, você deseja subir o
> melhor contato do cliente? SIM ou NÃO? […] essa informação deve subir
> no analítico também quando for exportar, quem está colocando número e
> quem não está. So é pra aparecer nesse status ok?"*

- Tabela `contato_cliente` (uma linha por contrato) e **não** um item a
  mais em `visita.telefones`: aquele array é do TOA e a reimportação o
  reescreve.
- **O NÃO também é gravado** (telefone nulo) — é justamente o que mostra
  quem não está colocando. Sem linha = **não perguntado** (concluído fora
  do app). Três estados, nenhum vazio calado (regra 6). No analítico:
  `Melhor contato informado` = SIM / NÃO / NÃO PERGUNTADO, mais o número
  e quem informou.
- Só em `CONCLUIDA`, e a trava é do banco (`informar_contato_cliente`
  recusa outro status, 23514). Mesma porta do anexo: equipe dele, e o
  campo só no dia (`pode_anexar_na_visita`).
- Telefone com DDD, 10 ou 11 dígitos (`(92) 99999-9999`), validado no
  banco. A caixinha **não fecha** tocando fora nem no "voltar": pede SIM
  ou NÃO. Se o app fechar no meio, o contrato concluído mostra
  "Informar o melhor contato" para responder depois (no dia).
- O histórico ganha o evento `CONTATO` dizendo SÓ se foi informado — o
  número não entra em `visita_evento`, que vai pelo Realtime e é magra de
  propósito (D-119/D-120).

#### 3. O rastro do técnico

> *"deve mostrar a trilha do técnico desde o momento que o técnico loga até
> o final, o final da rota, ou enquanto ele estiver usando o app, o sistema
> deve captar a cada 2 a 5 minutos o sinal do gps do técnico"*

Pergunta feita e respondida: **também em segundo plano** (Emanuel, 27/09).

- **"2 a 5 minutos"** virou: ponto a cada 2 min se ele andou 30 m ou mais;
  parado, um a cada 5 min mesmo assim. Andando, resolução de rua; parado,
  não enche o banco (plano Free).
- **Segundo plano** = `expo-location` + `expo-task-manager`, com a
  notificação fixa que o Android exige ("Gestor AF · rota do dia"). Exige
  **APK (EAS Build)** e a permissão **"Permitir o tempo todo"**; o app
  explica antes de pedir. **No Expo Go não funciona** — lá o rastro grava
  com o app aberto, e ao ir para trás grava um ponto `SAIU`: a trilha mostra
  o buraco como **app fechado**, não como "parado".
- **"Até o final da rota"**: `registrar_rastro` devolve `rota_aberta` (ainda
  há contrato produtivo de hoje em aberto para ele). Sem nenhum, o segundo
  plano desliga sozinho. Com o app aberto continua gravando ("ou enquanto
  ele estiver usando o app"). **Rastrear o técnico em casa depois do último
  contrato não foi pedido** — e localização de empregado é dado pessoal.
- Fila no aparelho (sem sinal, o ponto espera); ponto repetido (técnico +
  instante) é recusado pelo servidor, então reenviar é seguro. **Sair do
  login apaga a fila**: quem é o técnico o servidor decide pelo login
  (D-061), e ponto de um login não pode subir na sessão de outro.
- A Agenda do app diz ao técnico que a rota está sendo registrada, e de
  que jeito. Transparência com quem é rastreado.
- RLS: o rastro é lido **só pela gestão**, e só de técnico de equipe
  visível. O técnico não lê rastro de ninguém — nem o dele.

#### 4. O local da baixa

> *"quando ele baixar também no nosso sistema, a baixa deve pegar a
> distancia que ele baixou da casa do cliente ou seja. técnicos precisam
> baixar no local, temos que ver o raio na tela de contratos ou equipe
> quando ele baixar"*

- A coordenada da baixa já era gravada (é a trava D-113). Faltava a
  **precisão**: `baixar_os` e `registrar_etapa` ganharam `p_precisao`, e
  `visita_evento.precisao_m`. As versões antigas foram **derrubadas**, não
  deixadas convivendo (traps.md: assinatura com default ambígua). Todas as
  chamadas existentes (web por nome, bateria posicional de 7) continuam
  valendo — conferido pela bateria.
- **Raio: 200 m** (escolha do Emanuel entre 100/200/300/500, 27/09), em
  `parametro.raio_baixa_m`, editável em Configurações › Baixa e situação.
  **Só acusa, não bloqueia**: bloquear seria outra regra (o técnico na
  porta com o endereço do TOA errado?), e ninguém decidiu.
- `local_da_baixa(visitas)` devolve, por contrato, o registro do campo
  **mais longe** do endereço (baixa de O.S. ou encerramento): basta uma
  afirmação de longe para "baixou no local?" ser não. Calculado **na
  leitura**, não guardado — se o TOA corrigir a coordenada, a conta
  acompanha (D-150).
- Selo na linha do contrato (Serviços e Equipes, o mesmo componente —
  D-095), resumo no cartão da equipe ("3 de 4 no raio · 1 fora · até
  2,2 km"), na janela do contrato e no analítico. Endereço sem coordenada
  do TOA aparece como **"sem coord. do endereço"**, nunca como "dentro".

#### 5. A central de monitoramento (`/controle/monitor`)

> *"precisamos saber onde esta cada técnico, técnicos proximos, trilha,
> informações de monitoramento ok? explore se necessário da concorrente"*

Olhado no Alfa Gestor em 27/09 (Monitoramento App): **Km Rodados**,
Caminho percorrido, **Status Técnicos** (legenda: Deslogado, Pendente,
Ocioso, Em deslocamento, Em execução), Código de Baixa (mapa de calor),
Geo Cerca e Garagens. Lá as posições **ficam 90 dias**.

O nosso tem: estado do sinal de cada técnico (com sinal / sem sinal /
**app fechado** / rota encerrada / sem sinal no dia), bateria, km estimado,
placa (condutor atual da Frota), contrato em andamento, baixas fora do
raio; o mapa pinta por **sinal** ou por **trabalho** — e o "ocioso" é o da
D-026, lido de `painel_equipes` (uma regra, um lugar). Selecionando um
técnico: a trilha do dia (trechos cheios, **buracos tracejados**), as
**paradas** (≥ 15 min num raio de 50 m) com o contrato mais perto, os
contratos dele com o **raio desenhado** e a linha até onde baixou, e o
**replay** (arrastar a hora e ver onde ele estava). **Técnicos próximos**
de um técnico ou de um contrato, para despacho. Atualiza sozinho a cada
minuto no dia de hoje.

- "Sem sinal" = mais de 10 min sem ponto: o dobro do maior intervalo de
  captura — não é regra de negócio, sai da regra do app.
- Parada e buraco são **leitura da trilha, não infração**: a tela mostra,
  quem opera julga.
- O km é **estimado** (linha reta entre pontos com precisão ≤ 100 m e
  deslocamento ≥ 25 m) e a tela diz isso.

**Recusado / não feito:**

- **Geocerca e garagens**: exigem regra (qual cerca, qual garagem, o que
  acontece ao sair) que ninguém definiu.
- **Km por mês com custo/km** (o "Km Rodados" deles cruza com o
  abastecimento): a Frota tem o dado, mas é outra tela — próximo passo.
- **Bloquear a baixa fora do raio**: não pedido (ver item 4).
- **Retenção do rastro**: não há expurgo. O concorrente guarda 90 dias;
  quanto a AFLINE guarda é decisão dela (LGPD + plano Free).

**Testado como `authenticated` (desfeito ou apagado):** técnico grava 3
pontos (o 4º, com data de 2030, é descartado), reenvio grava 0; técnico
lê 0 pontos e o monitor o recusa (42501); contato em contrato em execução
recusado (23514), telefone "123" recusado (23514), contrato de outra
equipe recusado (42501), SIM e depois NÃO gravam (a última resposta vale);
baixa com precisão grava `precisao_m`; baixa a ~30 m + encerramento a
2,2 km → `local_da_baixa` devolve 2.224 m, fora, 2 registros / 1 fora, e
o monitor conta 2 / 1. Baterias **16/16 e 14/14**. Nenhuma tabela sem RLS,
nenhuma DEFINER aberta ao `anon`. Medido como `authenticated`:
`monitor_tecnicos` 21 ms e `local_da_baixa` (240 visitas do mês) 5 ms —
**com quase nenhum rastro gravado**; em volume real não foi medido.
Na tela (web local): trilha de teste de 40 pontos desenhada, parada de
24 min detectada a 594 m do contrato, buraco "app fechado" de 27 min,
selo "FORA DO RAIO · 389 m ±12 m" na lista e na janela do contrato. Os
dados de teste foram apagados.

**Não verificado:** nada disso rodou num celular. O segundo plano só
existe no APK (não no Expo Go) e depende da permissão "o tempo todo" e do
fabricante do Android (economia de bateria agressiva mata serviço em
segundo plano em alguns aparelhos). A caixinha do contato e o rastro com o
app aberto: `tsc` e `expo export` limpos, sem teste com o dedo.

---

### D-171 · Cercas e garagens, antifraude do GPS, ciência do rastro, 90 dias e o APK

Respostas do Emanuel (27/09) às pendências da D-170. Migration **097**
(aplicada em três partes: 097, 097b, 097c).

#### 1. Retenção: 90 dias

> *"vamos fazer 90 também"* (o concorrente guarda 90)

`parametro.rastro_retencao_dias = 90` e `expurgar_rastro()` agendado no
**pg_cron** (instalado nesta migration) às 07:17 UTC = 03:17 em Manaus.
Apaga `rastro_ponto`, `gps_alerta` e `cerca_evento` mais velhos que isso.
Não toca em `visita_evento` (a coordenada da baixa é prova do atendimento,
não rastro) nem em `sinal`.

#### 2. Cercas e garagens

> *"podemos configurar isso no mapa, tipo cerca, area 1 - desenhar ela no
> mapa, se ele sair daquilo, deve chegar notificação para o cop e gestores
> que estão conectados ao nosso sistema, então garagem, cerca no mapa deve
> ter de fato"*

- Desenhada no **Monitoramento**: clicar no mapa marca os cantos, arrastar
  ajusta, botão direito apaga um canto. Polígono de 3 a 300 cantos.
- **Quem desenha decide** (o sistema não decide nada): a quais equipes vale
  (todas as da base, ou as escolhidas) e se avisa ao **sair** e/ou ao
  **entrar**. Área nasce avisando ao sair; garagem nasce sem aviso — só
  registra a saída e a volta na linha do dia.
- Conferida **no banco**, a cada ponto que chega (`registrar_rastro`). A
  troca dentro/fora só vale com **2 pontos seguidos** do outro lado e
  precisão até 100 m: GPS tremendo na borda não pode disparar alerta. O
  evento leva a hora do PRIMEIRO ponto do outro lado.
- O aviso vai para o **sino** como sinal `CERCA` (095): vigente enquanto ele
  continua do lado que disparou. A central escuta `cerca_evento` pelo
  Realtime e relê o sino na hora — não espera o minuto.
- Redesenhar ou trocar as equipes **recomeça o dentro/fora** de todo mundo
  sem alerta. Arquivar, não apagar: os eventos antigos continuam dizendo de
  que cerca eram.
- Sem o mapa do Google (chave recusada), não se desenha — a tela diz.

#### 3. Antifraude do GPS

> *"se ele desligar o gps e quiser usar o sistema, o sistema vai travar as
> ações dele e deve subir uma mensagem informando para que ele ligue o gps
> novamente, se ele habilitar no celular dele o modo desenvolvedor para
> instalar o gps simulator, o app também deve bloquear isso, informar que
> há ações anormais no gps e que ele precisa corrigir isso para usar o app.
> temos que ser intuitivos sem ser agressivo"*

| situação | o app | o banco | a central |
|---|---|---|---|
| GPS desligado | pausa, com "Ligar localização" (diálogo do Android) | baixa/encerramento já exigiam coordenada (D-113) | sinal "GPS desligado" |
| Permissão negada | pausa, com "Permitir" / ajustes | idem | sinal "Localização negada" |
| **Localização simulada** | pausa, com o passo a passo (Opções do desenvolvedor › local fictício › Nenhum) | **recusa baixa e mudança de status** (`gps_bloqueado`) até chegar um ponto REAL | sinal "Localização simulada" |
| Salto > 1 km a > 180 km/h | nada | registra | sinal "Salto de posição" |
| Aparelho com root | nada | registra | sinal "Aparelho modificado" |
| Sem satélite ainda | **não trava** | — | — |

- A simulação é detectada pela marca que o **Android** põe em cada leitura
  vinda de provedor falso (`mocked`). Cada ponto do rastro leva a marca; o
  ponto simulado não entra em cerca nem em km.
- **O modo desenvolvedor sozinho não trava**: muita gente tem ligado sem
  fraudar nada. O que frauda é o app de local fictício — e esse é pego.
- **Só um ponto real destrava a simulação**: o app dizer "está normal" não
  basta (`registrar_estado_gps('NORMAL')` não tira `SIMULADO`).
- Root: dá para esconder a marca com root, então vira alerta ao controle —
  sem travar (a detecção do Expo é "experimental").
- **iPhone não tem a marca**: lá o antifraude é só GPS desligado/negado.
  Simular GPS no iPhone exige computador ligado ao aparelho.
- Sem satélite (GPS ligado, ainda sem fixar) **não trava** — é a razão da
  D-113. Travar é para o que o técnico DESLIGOU ou FALSIFICOU.
- Tom: a tela diz o que aconteceu, por que pausou e como resolver, com o
  botão que leva direto ao lugar certo. Nada de acusação.

#### 4. Aviso formal ("Estou ciente")

> *"Aviso formal ao técnico sobre o rastro […] pode fazer também"*

Uma janela antes de o rastro começar, com um botão só, **"Estou ciente"**
(como o concorrente). O texto diz o que o sistema faz: de quanto em quanto,
quando para, quem vê, 90 dias, o que acontece com GPS desligado ou
simulado. A ciência fica em `ciencia_rastro` com a **versão** do texto
(`rastro-v1-2026-09-27`): mudou o texto, sobe a versão, todo mundo vê de
novo. O Monitoramento mostra quem ainda não deu ciência. **O texto não é
parecer jurídico** — a AFLINE deve passá-lo pelo jurídico.

#### 5. O APK

Autorizado pelo Emanuel. Versão **0.2.0** (perfil `preview`, APK instalado
direto, sem loja). É nele que o rastro com o app fechado funciona — no Expo
Go não.

#### Testado

Bateria `testar_campo()` **18/18** (4 cenários novos: baixa com GPS
simulado barrada; ponto real destrava; técnico não lê rastro; 2 pontos fora
da cerca = 1 evento SAIU, visto pelo controlador; funções da 096/097
fechadas ao `anon`). `testar_policies()` sem falha, nenhuma tabela sem RLS,
nada DEFINER aberto ao `anon`, `expurgo` agendado no cron. Como
`authenticated` (desfeito): cerca desenhada pelo admin; técnico dentro →
fora → fora → ponto simulado; o sino do admin traz "Saiu da área…" e
"Localização simulada…" **vigentes**, o monitor mostra `SIMULADO` e "fora
de: Área teste". Na tela (web local): cerca desenhada com 4 cliques no
mapa, salva com 4 cantos no banco, e apagada.

**Defeitos pegos no teste da tela**, e corrigidos: o polígono novo (vazio)
não tinha caminho — `getPath()` voltava indefinido e a tela quebrava; e o
`MVCArray` passado no construtor era **copiado** pelo Maps, então os
cliques contavam mas o desenho não aparecia. Ícone de loja do Google
engolia clique: desligado durante o desenho. Ver `traps.md`.

**Não verificado:** nada no celular ainda — a guarda do GPS, o aviso, o
rastro em segundo plano e a detecção de simulação precisam do APK na mão
(e de um app de local fictício para provar a trava). Volume real do monitor
com muitos pontos e cercas: a medir nos testes, como o Emanuel pediu.

---

### D-172 · A baixa manual coerente, o aviso sem o nome do arquivo e o app que diz onde fechou

Migration **098**. Pedidos do Emanuel em 27/09, à noite, com prints.

#### 1. O aviso de "contrato novo" não mostra o arquivo

> *"não precisa mostrar de onde vem a atividade, técnico não sabe, por
> exemplo: MAN-AFLINE_27"*

O aviso `NOVO` copiava a observação do evento `IMPORTADA` — que é o **nome
da planilha**. `aviso_do_evento` passa a gravar o `NOVO` sem detalhe, e os
avisos antigos foram limpos (`update … where tipo = 'NOVO'`). O evento da
importação **continua** guardando o arquivo: é o rastro de quem importou.
Consertado no banco, e não na tela, porque a linha do aviso é a verdade
(D-119) — e porque o APK já instalado lê a mesma linha.

#### 2. Código de baixa só com Concluída, Cancelada ou Reagendamento — e do destino certo

> *"o sistema não deve aceitar baixar a o.s do contrato e ir para entrada
> […] so pode ter opção de inserir o codigo de baixa se for para concluido,
> cancelado, reagendado […] eu não posso baixar com 409 - cancelado […] se
> eu for querer baixar manual […] talvez se estiver assim no toa ok?"*

**O defeito que o print mostrou:** o contrato 226470184 estava CONCLUÍDO;
o controlador lançou 409 nas duas O.S. com "Na entrada" e `baixar_visita`
aceitou. Só `exige_todas_baixadas` olhava a situação, e ela só se importa
com situação terminal. Um contrato encerrado voltou para a entrada **sem
motivo** (o "Voltar" pede motivo, D-030), com código de instalação
efetuada.

A regra, no banco:

| Onde | O que passa a valer |
|---|---|
| `baixar_visita` (baixa manual da web) | com código de baixa, a situação final é **obrigatória** e tem de ser terminal; e **todo** código da AFLINE no contrato tem de ter `situacao_destino` igual a ela (`confere_destino_das_baixas`) |
| `registrar_etapa` pela web, para situação terminal | a mesma conferência |
| TOA | **nada muda**: a baixa da operadora é leitura (D-042), e a automática aplica o destino do próprio código — "se estiver assim no toa ok" |
| campo (`baixar_os` + encerrar) | **nada muda nesta leva** — ver "Pergunta aberta" |

O destino de cada código já existia (D-097, 168 códigos: 116 concluem, 24
cancelam, 28 reagendam). A tela agora pede **primeiro** a situação final
(três botões) e só então mostra os códigos daquele destino; trocar a
situação limpa o código que não serve mais.

**Testado como `authenticated` (transação desfeita)**, no próprio
226470184: 409 + Na entrada → recusado; 409 sem situação → recusado; 409 +
Cancelada → recusado, com a lista das O.S. e o destino de cada código;
mudar para Cancelada pela web com 409 gravado → recusado; um código de
cancelamento numa O.S. e 409 na outra → recusado; 409 + Concluída →
aceito.

**Recusado:** travar também o TOA (a operadora baixa como baixa; a
divergência tem de aparecer, não sumir — D-042).

**Pergunta aberta ao Emanuel:** o encerramento pelo **campo** deve passar
pela mesma conferência? Hoje o técnico baixa O.S. por O.S. e depois toca
"Finalizar"/"Cancelar"/"Reagendar" livremente — com um 106 (reagendamento)
nas O.S. ele consegue finalizar como Concluída. Aplicar é uma linha em
`registrar_etapa`, mas muda o dia do técnico: pergunte antes.

**Observado e não mexido:** `registrar_etapa` pela web ainda leva um
contrato **encerrado** de volta a um status aberto sem motivo (só o campo é
barrado). A tela manda esse caso para `reverter_situacao`, que pede motivo
— mas a barreira hoje é da tela, não do banco.

#### 3. O app diz onde fechou

> *"tem que fazer um debug no app […] eu acho que tem a ver com GPS […]
> fecha só na tela quando o contrato esta aberto"*

Sem o celular ligado ao computador não há log do Android. O que se mapeou
no código:

- **O GPS era lido por quatro caminhos independentes** — a guarda do GPS a
  cada 20 s, o rastro a cada 1 min, a Agenda e o contrato ao abrir —, cada
  um pedindo leitura NOVA ao Android, às vezes duas ao mesmo tempo, e a do
  contrato sem prazo. É o "procurando o GPS direto". Agora há **uma
  leitura por vez para o app inteiro** (`lerPosicao`): reaproveita a
  recente, junta pedidos simultâneos, e toda leitura tem prazo.
- **O serviço de localização em segundo plano liga exatamente quando há
  contrato aberto** (`rota_aberta`). Se o Android recusa subir o serviço
  (app fora da frente, depois dos ajustes da permissão "o tempo todo"), o
  processo morre com erro **nativo** — nenhum `try/catch` pega. É o
  suspeito mais forte para "fecha quando o contrato está aberto". Agora:
  só liga com o app na frente; anota o passo antes; e se o app fechou
  nesse passo, **neste aparelho e nesta versão** não tenta de novo (grava
  só com o app aberto e avisa).
- **Texto vazio fora de `<Text>` derruba o APK.** `{v.complemento && …}`
  com `''` é erro fatal no React Native — no Expo Go é tela vermelha, no
  APK é "o app tem um bug". Hoje o banco não tem esses campos vazios
  (conferido), mas 16 trechos foram blindados com `!!`.

E, para a próxima vez não ser palpite: tabela **`erro_app`** (só a gestão
lê; grava-se pela função `registrar_erro_app`, autor carimbado pelo
servidor, teto de 30 por hora por usuário, expurgo de 90 dias junto com o
rastro). O app manda três coisas: erro ao desenhar uma tela, erro de
JavaScript fora dela, e — no início seguinte — **o passo em que estava
quando fechou** (`FECHOU`). No APK, um erro de JavaScript deixa de fechar
o app: vira a tela "Esta tela tropeçou", com a mensagem real e o botão de
voltar para a agenda. No Expo Go continua a tela vermelha do RN (traz a
pilha).

Consulta para ver o que aconteceu:

```sql
select criado_em, tipo, mensagem, contexto, versao, aparelho
  from erro_app order by criado_em desc limit 20;
```

`app.json` também foi consertado: as mensagens de permissão estavam
embaralhadas (`cÃ¢mera`) — resto da gravação pelo PowerShell (D-171). A
versão sobe para **0.2.1**.

**Não verificado:** nada disto rodou num celular. O `tsc` e o `expo
export` passam. A causa do fechamento **não está provada** — está
cercada, e a próxima ocorrência sobe para `erro_app` com o nome do passo.
O teste do segundo plano só vale no **APK** (o Expo Go não tem o serviço):
testar primeiro no Expo Go cobre GPS, telas e a rede de erros; o
fechamento ao ligar a rota só se prova com APK novo.

---

### D-173 · Mudar status pelo botão direito, o menu que faltava em Equipes, jornada como informativo e a entrada no modelo da empresa

Só web. Pedidos do Emanuel em 27/09.

#### 1. "Mudar status…" no botão direito

> *"quando clicar no lado direito na tela de serviço e técnico deve
> aparecer a opção mudar status, para o controlador devolver para o status
> que ele achar melhor"*

O botão "Voltar" do contrato virou **Mudar status**, e o menu do botão
direito ganhou **Mudar status…**. Uma porta na tela, três no banco:

| Para onde | Por onde | Exige |
|---|---|---|
| Concluída, Cancelada, Reagendamento | vai para a **baixa** (D-172) | código de todas as O.S., do destino certo |
| contrato encerrado → status aberto | `reverter_situacao` | **motivo** (D-030) |
| aberto → aberto | `registrar_etapa` | nada; a observação vira aviso no celular |

#### 2. O botão direito e o "⋯" em Equipes

> *"botão lado direito não esta funcionando […] as 3 bolinhas também não
> funciona"*

Eram **duas cópias** do menu. A de Serviços ia para a raiz da tela por
portal (D-169); a de Equipes não — e ela mora dentro da gaveta da equipe,
que é animada (`transform`) e rola por dentro (`overflow`). Um ancestral
com transform vira o referencial do `fixed`, e o overflow corta: o menu
abria longe e sumia recortado. Agora é **um componente só**
(`MenuContrato`), por portal, que fecha com clique fora, Esc e rolagem.
Conferido no navegador: abre no ponto do clique, nas duas telas, pelo
botão direito e pelo "⋯". A nota "Editar não existe" do menu saiu — o
contrato tem o botão "Editar" na janela.

#### 3. A fila "login sem equipe definida" saiu de Equipes

> *"essa tela de sugestão de equipe, precisa tirar, nao precisa aparecer"*

Saiu a seção amarela. O contrato desses logins continua **visível** na
equipe "Sem login definido" (D-088), e o vínculo login → equipe se declara
em Administração. A função `logins_sem_cadastro` continua no banco.

#### 4. Jornada é informativo

> *"essas atividades cinza, não sei por que não tem nome? […] só não pode
> contar em nada, ex: volume de contrato, ou produtividade, tem que ser só
> um informativo"*

Já não contavam (`natureza = 'JORNADA'` fica fora do volume, da
produtividade, dos pontos, do "um status por técnico" e da agenda do
campo). O defeito era de **leitura**: a linha mostrava "—" no contrato e a
etiqueta EM EXECUÇÃO pulsando, e parecia contrato quebrado. Agora mostra o
nome da atividade do TOA (Refeicao, Na Base, Almoxarifado…), "jornada · não
conta" e uma etiqueta cinza **Informativo**, sem pulso. O nome vem como o
TOA escreve (sem acento): não traduzimos cadastro da operadora.

#### 5. A entrada no modelo do painel da empresa

> *"a entrada do nosso sistema eu quero que seja muito parecido a essa, pra
> ser um modelo so"*

Mesmo desenho do painel de indicadores do Grupo AFLINE: fundo claro com a
rede de pontos animada (canvas à mão; parada para quem pede menos
movimento), marca e "16 anos conectando vidas." à esquerda, cartão à
direita. Fontes Exo 2 e Manrope, só nesta tela. Clara sempre, mesmo com o
controle no escuro.

**Recusado do modelo:** "Cadastre-se" — aqui conta é criada pela
Administração com o perfil escolhido (security.md). "Esqueci minha senha"
**não** manda e-mail: diz que a senha é trocada pela Administração, em vez
de prometer um e-mail que o sistema não envia. Se o Emanuel quiser a troca
por e-mail, é outra conversa (SMTP, página de nova senha).

**Conferido no navegador:** a entrada no computador e no celular (sem
rolagem lateral, sem erro no console); o menu em Equipes e em Serviços; o
Mudar status até o "Ir para a baixa"; a baixa só com os códigos do destino.
Nada foi confirmado em contrato real. Publicado e conferido no ar.

---

### D-174 · O campo encerra pelo código, e só o controlador reabre

Migration **099**. Respostas do Emanuel às duas perguntas da D-172:

> *"acho que o finalizar é o mesmo que concluir? correto? se não for temos
> que corrigir"*

É: "Finalizar visita" grava CONCLUIDA. Então a conferência da 098
(`confere_destino_das_baixas`) passa a valer **também para o campo**, e o
app deixa de oferecer o que o banco recusaria:

- o botão principal segue o código: **Finalizar visita** (código de
  conclusão), **Cancelar visita** (de cancelamento), **Reagendar visita**
  (de reagendamento);
- depois da primeira O.S. baixada, as outras só listam códigos do mesmo
  desfecho — o técnico não fica preso com códigos misturados, que só o
  controlador desfaz;
- o selo do código na lista diz CONCLUI / CANCELA / REAGENDA, no lugar de
  OK / IMPROD.

> *"so pode voltar o controlador, equipe nao pode"*

Contrato encerrado voltando para status aberto é **só** `reverter_situacao`
(controlador ou gestão, com motivo — D-030). `registrar_etapa` recusa essa
volta para qualquer um (antes, pela web, um supervisor reabria sem motivo),
e `baixar_visita` recusa trocar o desfecho de um encerrado para quem não é
controlador nem gestão.

**A bateria testava a incoerência:** `testar_campo()` baixava com o menor
código ativo (-2, que **cancela**) e depois "finalizava" como concluída.
Passa a usar um código de conclusão e ganha 5 cenários: finalizar com
código de reagendamento (barrado), reagendar com ele (permitido), técnico
voltando encerrado mesmo com motivo (barrado), controlador voltando sem
motivo por `registrar_etapa` (barrado) e com motivo por
`reverter_situacao` (permitido). **23/23**; `testar_policies()` 16/16.

**Não mexido:** a página `/campo` da web (a execução pelo navegador) ainda
mostra "Finalizar" sempre; se o código não for de conclusão, o banco recusa
com a mensagem. O app de verdade é o `campo/`.

**Não verificado no celular:** `tsc` e `expo export` passam; o fluxo de
reagendar pelo botão principal não foi tocado num aparelho.

---

### D-175 · A entrada no design "Entrada Gestor AF", com o Brasil inteiro e o time de verdade

Só web. O Emanuel mandou o design (Claude Design, `Entrada Gestor AF
Inovadora.zip`) com três correções:

> *"agora vamos mudar o norte, vamos colocar todo o brasil"*
> *"area técnico vamos colocar [a foto do time] e tirar a parte do
> coordenador da entrada"*
> *"pode inventar os dados" — "coloque dados bons"*

Feito como no desenho: abertura escura (o AF se montando, quatro frases,
"16 anos conectando vidas."), a rede de pontos com o pulso vermelho,
chamadas que se revezam, fotos flutuando, o cartão de entrar com
"Mostrar/Ocultar" senha, e os cartões de vidro em volta.

- **Norte → Brasil:** "Fibra chegando a todo o Brasil", "Do Oiapoque ao
  Chuí, quem conecta o Brasil é o campo", e o cartão "Fibra no Brasil" com
  os **27 estados** acendendo do Norte ao Sul.
- **Fotos:** a foto do time da AFLINE (`app/public/entrada/time-de-campo.webp`)
  no lugar do técnico de banco de imagem; a de Coordenação saiu. "Cliente
  conectado" continua a do desenho (Unsplash, carregada de lá).
- **Números:** ilustrativos, por decisão do Emanuel, em `app/src/lib/entrada.ts`
  (48.270 clientes, +1,9 mil/mês, satisfação 96,8%, qualidade 95,2%, NPS 87).
  Duas coisas mantidas: a curva de 2026 **para em setembro** (mês que não
  aconteceu é `null`) e a seção diz "Fonte: indicadores ilustrativos" — a
  página é pública, antes do login. Número real: troque no arquivo e
  escreva a fonte.

**Mudado do desenho, de propósito:** a abertura (10 s) roda **uma vez por
navegador** — o COP entra todo dia; "Ver abertura" repete, "Pular" e Esc
encerram, e quem pede menos movimento no sistema não a vê. O login do
desenho era falso ("Acesso liberado" sempre); aqui é o Supabase. O cartão
"Fibra no Brasil" desceu para a borda do formulário: com 27 estados ele
ficou mais alto que o de 7 e tampava o "Esqueci minha senha" (medido: 577 ×
610 px; agora começa em 736, o texto termina em 716).

**Conferido no navegador:** a abertura inteira, a tela em 1440×900 e em
celular (sem rolagem lateral), a seção de indicadores. Publicado e
conferido no ar (a foto responde 200).

---

### D-176 · A cidade nasce de uma planilha padrão

> *"preciso que em nosso sistema tenha uma planilha de importação onde
> podemos importar de uma única vez os dados que precisamos para povoar o
> sistema, preciso que a planilha excel seja padrão ou seja, já defina o que
> o usuário pode cadastrar, quero fazer isso em uma cidade […] atualize nosso
> sistema para ter o download da planilha padrão, e para importar dados
> depois que o usuário preencher"* — Emanuel, 14/10

Migration **100**. Administração › **Importar planilha** (só ADMIN).

**Perguntado e respondido (14/10):** quatro abas — **Áreas, Equipes,
Pessoas, Veículos**; a cidade **já existe** como Operação; a senha de cada
acesso é **gerada pelo servidor e devolvida uma vez**, numa planilha de
resultado.

**A planilha padrão** é gerada na hora, para a cidade escolhida, com as
listas do cadastro **de hoje**: perfil de acesso, cargo, skill, tipo,
propriedade e pernoite do veículo, SIM/NÃO — a célula **recusa** o que não
está na lista. Área, equipe e condutor **sugerem** o que a outra aba
cadastrou, mas aceitam com aviso (pode já existir no sistema). Coluna
obrigatória em vermelho com `*`; a explicação de cada coluna fica no
cabeçalho (nota) e no Leia-me, que também diz o que a cidade já tem e o
aviso de LGPD. Texto nas colunas de código, para o Excel não comer o zero de
"045" nem virar CPF em notação científica. A planilha guarda a cidade para
a qual nasceu: importá-la em outra cidade pede confirmação.

**Gerada com `exceljs`, só nesta tela.** O SheetJS livre não grava validação
de célula. O `exceljs` entra por `import()` dinâmico (271 KB compactado),
sem pesar o resto do sistema.

**A importação** é uma função só no banco (`importar_cadastro_cidade`), na
ordem em que uma coisa depende da outra: Áreas → Equipes → Técnicos (quem
tem login TOA na aba Pessoas) → rotear o login para a equipe → skill →
Veículos → condutor. Reaproveita as funções que a tela já usa
(`cadastrar_tecnico_avulso`, `cadastrar_login_da_equipe`, `salvar_veiculo`,
`definir_condutor`) em vez de copiar regra.

- **A prévia é a importação de verdade, desfeita**: `p_simular` roda tudo —
  restrições do banco e funções reaproveitadas inclusive — e levanta uma
  exceção no fim que desfaz a transação. O relatório sobrevive porque
  variável de plpgsql não é transacional. A prévia diz o que a importação
  vai dizer, porque é o mesmo código.
- **Reimportar atualiza, não duplica** (área por código, equipe por cidade +
  código, técnico por cidade + login, veículo por placa), e **célula vazia
  não apaga** o que está gravado (vazio é "não sei", regra 6). No veículo
  isso exigiu mesclar com o registro existente: `salvar_veiculo` grava
  todos os campos, e uma célula vazia apagaria o chassi.
- **Linha com problema fica de fora, o resto entra.** A tela recusa antes o
  que é formato (CPF com dígito verificador, e-mail, telefone, data que
  existe, valor fora da lista) — com a mesma `conferirCadastro` da tela de
  usuário; o banco recusa o que é relação (equipe que não existe, área de
  outra cidade, e-mail repetido, técnico já ligado a outro acesso, condutor
  que não é técnico da cidade).
- Grava na **cidade escolhida** — a importação de equipes antiga grava
  sempre em Manaus (D-141).

**Os acessos** não são criados pela função do banco: criar login exige a
`service_role`, que só a função `admin-usuarios` tem (a mesma do cadastro um
a um). Depois da importação, a tela chama `admin-usuarios` pessoa a pessoa
(com a cidade da planilha), liga o acesso ao técnico
(`vincular_tecnico_ao_usuario`) e o supervisor às equipes que levam o nome
dele (`definir_supervisor_das_equipes`). E-mail que **já tem acesso não é
alterado**. No fim, **"Baixar resultado com as senhas"** — as senhas só
existem nessa tela; sair antes de baixar pede confirmação.

**O código de área é único no sistema INTEIRO**, não por cidade (a
restrição já existia). A planilha orienta o prefixo da cidade
(`BEL-AREA01`), e a prévia acusa conflito com outra cidade.

**Testado como `authenticated` (desfeito):** prévia com 21 equipes antes e
21 depois; erros acusados — área de outra cidade, área que não existe,
e-mail repetido, equipe que não existe, placa inválida, condutor de fora;
avisos — supervisor que não está em lugar nenhum, e-mail que já tem acesso;
importação real: área → equipe com área → técnico com skill e equipe →
login roteado com autor → veículo com condutor. Técnico chamando a função:
barrado (42501). Na web (sem login, na própria página): planilha gerada com
as 6 abas (94 KB), listas certas, preenchida e relida — CPF e WhatsApp só
dígitos, data no padrão do banco, rótulo do veículo virando código.
**Defeito pego no teste:** "31/02/1990" passava como data válida (o
JavaScript vira 03/03 sem reclamar) — agora é recusado; 29/02/1992 passa.
Baterias 16/16 e 23/23; nada DEFINER aberto ao `anon`; web publicada e
conferida.

**Não verificado:** o fluxo inteiro logado na tela (a sessão do navegador
de teste tinha caído, e a senha do admin não passa pelo assistente) — em
especial a **criação de acessos em lote**, que cria contas reais e não tem
como ser desfeita sem a `service_role`. Ela usa a mesma função do cadastro
um a um, que já funciona; o lote em si (dezenas de chamadas seguidas) não
foi exercitado. Controlador chamando a função: não havia controlador sem
ADMIN no banco para testar. A planilha aberta no Excel de verdade (as
listas foram conferidas lendo o arquivo, não clicando no Excel).

---

### D-177 · Manaus zerada para a operação real, e a senha inicial do lote

> *"Vamos apagar os dados que já criamos, deixar somente o Emanuel que é o
> ADMIN […] vamos cadastrar todas essas equipes que te mandei na planilha,
> o apelido pegue o primeiro nome de cada técnico […] e a senha coloque um
> padrão só"* — Emanuel, 17/10

**A limpeza** (escolha do Emanuel entre três: "tudo de teste"). Numa
transação só — três tentativas desfeitas inteiras antes da que passou
(romaneio preso a movimento de miscelânea; perfil de teste com CPF/data que
a CHECK recusa a qualquer `update`; técnico apontando o supervisor de
teste):

- 4 usuários de teste (fica só `admin@afline.com.br`); 3 técnicos; equipes
  001/002/003 de Manaus (a abrigo SEM-LOGIN fica);
- os 269 contratos de Manaus (10/09 a 14/10) e tudo deles: O.S., eventos,
  avisos, contato, reincidências; 20 sinais; 11 mensagens; 36 pontos de
  rastro; 23 importações; 733 registros de contrato apagado;
- 2 romaneios e os 4 movimentos de miscelânea deles (entrega e devolução
  de 30 unidades, em partida dobrada: o saldo do almoxarifado foi conferido
  igual antes e depois, e a transação recusaria se mudasse);
- 2 equipamentos reais (Atlas) que testes de romaneio tinham posto na mão
  de técnico de teste voltaram a **sem posse declarada** (D-152).

Conferido antes: nenhuma configuração real (meta, faixa, parâmetro,
catálogo, login roteado de outra equipe) tinha autoria de usuário de teste.
**Não apagado:** 5 arquivos de foto no bucket `evidencia` — o Supabase
recusa apagar arquivo por SQL ("use the Storage API"), e a API exige a
`service_role`. Órfãos, sem contrato; saem pelo painel (Storage).

> A regra "usuário não se apaga, se desativa" continua valendo para dado
> REAL. Isto foi apagar dado de TESTE, a pedido, antes da operação começar.

**A senha inicial do lote.** A importação ganhou o campo opcional "senha
inicial para todos" (mínimo 8, com letra e número). Vazio = o servidor gera
uma por pessoa, como na D-176. Preenchido = vai para `admin-usuarios` como
`senha`. **Quem digita é quem importa**: a senha de conta real não passa
pelo assistente, e não é gravada na planilha de resultado (a coluna diz "a
senha padrão do lote"). A tela avisa: senha igual para todos é senha
conhecida por todos — cada um deve trocar no primeiro acesso.

**A planilha de Manaus** veio sem as abas Áreas/Equipes/Veículos e com duas
colunas fora do padrão (`LOGIN`, `EQUIPE`) no lugar de "Login TOA" e
"Equipe". Foi convertida para o formato padrão (fora do repositório, em
Downloads): 55 equipes (uma por técnico), apelido = primeiro nome com só a
inicial maiúscula, e os 5 sem e-mail ganharam `NNN_equipe@afline.com.br`
pelo número da equipe (escolha do Emanuel). Passou pelo leitor da tela
(zero problema) e pela prévia como ADMIN (55 equipes e 55 técnicos novos,
55 acessos a criar, zero erro, zero aviso, nada gravado).

**Três e-mails da planilha parecem ter erro de digitação**
(`…@gmail.comc`, `…@gmal.com`, `…@gmail.com.br`): entram como login, mas
"esqueci a senha" por e-mail não chegaria. Não foram corrigidos — não
sabemos o certo.

---

### D-178 · A data de contratação, e o tempo de casa calculado na leitura

> *"nessa tela não é obrigatorio é bom cadastrar data de contratação, para
> saber quanto tempo o técnico tem de casa"* — Emanuel, 17/10

**`perfil.data_contratacao`** (migration 101), opcional, ao lado do
nascimento e da matrícula do ponto: é dado da **pessoa** (o empregado), não
do técnico do TOA — o login e a equipe mudam, a data em que entrou na
AFLINE não. CHECK `perfil_contratacao_plausivel` (depois de 1950, antes de
2100), a mesma faixa que a tela confere.

**O tempo de casa não é guardado.** `tempoDeCasa()` (`lib/formato.ts`)
calcula na leitura contra o dia local (`isoLocal`, D-084), com as partes da
data em inteiros. Guardado, seria um número que envelhece calado — a mesma
lição do cache do TEC1 (D-150). Vazio é **"não informada"**, nunca "0 dias"
(D-117). Data futura passa e aparece como "começa em DD/MM/AAAA": é quem já
foi contratado e ainda não começou.

**Só o ADMIN altera.** A policy `perfil_autoedicao` libera a pessoa a editar
o próprio perfil, e RLS não restringe coluna (D-050): a data entrou na lista
de `perfil_protege_campos`. Cenário novo em `testar_policies()` — **17
cenários** — "TECNICO muda propria data de contratacao", barrado. Testado
também à mão como `authenticated` (desfeito): técnico recusado com 42501,
o técnico ainda muda o próprio apelido, ADMIN grava, 1900 recusado pelo
CHECK.

**No "Novo usuário"** a data vai num `update` depois de criar o acesso, e
não no corpo da `admin-usuarios`: a função de borda monta o perfil campo a
campo e ignoraria o que não conhece. Mexer nela seria redeploy de função
que roda com a `service_role` por um campo opcional.

**Recusado por enquanto:** a coluna na planilha padrão (D-176). A
importação não altera acesso que já existe, então ela não serviria para os
55 de Manaus que já entraram — quando for pedido, é coluna nova + regra de
"preencher se estiver vazio".

**A bateria `testar_policies` está 16/17, e não por esta mudança.** Desde
a limpeza da D-177 não há contrato no banco, e "CONTROLADOR exclui
contrato" falha com *Contrato nao encontrado*. Pior: "TECNICO exclui
contrato" passa pelo motivo errado (barrado porque não há o que excluir).
Fica verde com a primeira importação do TOA; o certo é a bateria criar o
próprio contrato de teste.

---

### D-179 · COM_IMPEDIMENTO passa a se chamar "Ticket de suporte"

> *"opção COM_IMPEDIMENTO vamos trocar o nome para Ticket de suporte"* —
> Emanuel, 17/10

**Muda o rótulo, não o código** (migration 102). `COM_IMPEDIMENTO` está no
CHECK de `visita.situacao`, nas travas do campo, no gatilho do status ativo
(095), nos eventos e no histórico; trocar o código reescreveria o passado.
Desde a D-169 o pedido de ajuda do campo **é** este status — o nome novo diz
o que ele virou.

O rótulo é cadastro (`situacao_visita.label`, 025) e a web lê do banco. Os
padrões de partida no código mudaram junto — `SITUACAO_INFO`
(`app/src/lib/supabase.ts`) e `campo/src/lib/dominio.ts`, que o aplicativo
usa sem consultar o cadastro —, para o nome antigo não voltar quando o banco
não responder. O texto da folha de suporte na Agenda também.

**Não mudou (pergunta aberta ao Emanuel):** os botões de AÇÃO que levam a
este status — "Impedimento" / "Registrar impedimento" na tela da visita (app
e web), o evento "Registrou impedimento", a coluna "Impedimento" do CSV por
tipo. O exemplo do campo é *"no local, sem contato com o cliente"*, que é
impedimento do cliente, não pedido de suporte; renomear o botão muda o que o
técnico entende que deve fazer.

**O aplicativo só mostra o nome novo depois de um APK novo** (ou no Expo Go):
o rótulo do app está no código.

---

### D-180 · A cidade ativa, os buckets do TOA por cidade e a foto do técnico

> *"é bom ter um filtro de bucket da cidade ok quando importar tem que ter um
> filtro para esses nomes […] caso o gestor que tiver o acesso de mais de uma
> cidade trocar de operação ok? o sistema precisa saber dividir os bucket de
> quais cidades são para não misturar, nem todo mundo vai conseguir navegador
> em outras cidades isso precisa entrar na configurações de permissões"* ·
> *"é bom ter um campo quem for cadastrar manual campo para colocar a foto de
> perfil do técnico"* — Emanuel, 17/10

Migration **103** (+ 103b bateria, 103c autor do bucket). As quatro escolhas
foram do Emanuel, entre opções oferecidas:

| pergunta | escolha |
|---|---|
| como o sistema sabe de qual cidade é o bucket | **cadastro na tela**, por cidade, já semeado com o que os arquivos provaram |
| arquivo de outra cidade | **a importação recusa e explica**, e oferece trocar a cidade |
| quem troca de cidade | **ADMIN vê todas; o resto, só as marcadas** no cadastro |
| foto | **no cadastro (ADMIN) e no app**, ranking e monitoramento |

#### 1. O bucket está no nome do arquivo, e só lá

Conferido em **31 arquivos / 11 buckets** do TOA (Downloads do Emanuel,
17/10): nenhuma das 120 colunas traz o bucket. Ele vem em
`Atividades-<BUCKET>_DD_MM_AA.xlsx`. As colunas `Cidade` e `Área de
Trabalho` dizem a cidade, mas vêm **vazias na jornada** (109 de 340 linhas
em Manaus, 17/10: Na Base, Refeição, Apoio). E os códigos do TOA não são os
nossos: **BLM** é Belém (BEL), **GUR** é Gurupi (GRP). Por isso é cadastro
(`toa_bucket`, um bucket = uma cidade, `unique`), e não regra de prefixo.

**Semeado só o que os arquivos provaram** (bucket do nome × coluna Cidade ×
prefixo da área): MAN-AFLINE, MAN-AFLINE_01_VT → Manaus; BLM-AFLINE, _02_VT,
_03_VT → Belém; BSB-AFLINE, _13_VT → Brasília; GUR-AFLINE → Gurupi;
SLS-AFLINE_02, _02_VT → São Luís. `origem = ARQUIVOS_DO_TOA`, sem autor.

**ARN-AFLINE ficou de fora de propósito**: as linhas dele dizem ARAGUAINA
**e ARACAJU** (prefixos de área ARN e AJU) — Aracaju não é cidade
cadastrada, e escolher seria palpite. Também de fora: os buckets que só
aparecem no print da árvore do TOA (MAN-AFLINE_ADM, BSB-AFLINE_14/15_VT,
CWL, CXS, ITZ, JIP, MBA, PIT, PMJ) — o ADMIN cadastra em Configurações ›
**Buckets do TOA**.

**A recusa mora no banco** (`importar_toa`): sem bucket reconhecível no
nome, bucket não cadastrado, desligado, ou de outra cidade — e diz qual. A
tela pergunta antes de subir as linhas (`cidade_do_arquivo`) e, se a pessoa
tem acesso à outra cidade, oferece a troca. Testado com 5 nomes reais
(dois de Manaus com e sem "(1)", um de Brasília, o ARN e "rota de
hoje.xlsx"). `importacao.bucket` guarda o que foi lido.

**O defeito que isto fecha:** a tela gravava toda importação em `MAN`
(`.eq('codigo','MAN')` escrito à mão). Em 26/09 o único arquivo do dia foi
`Atividades-ARN-AFLINE`, e entrou em Manaus.

#### 2. A cidade ativa mora no banco, não em cada tela

`perfil.base_ativa` + `trocar_cidade()`. **`bases_visiveis()` passou a
responder só a cidade ativa** (sem escolha válida, a do perfil; sem
nenhuma, todas as permitidas), e `bases_permitidas()` é o que a pessoa
**pode** ver. Como 13 policies e 31 funções já perguntavam
`bases_visiveis()`, o RLS separa tudo de uma vez — nenhuma tela ganhou
filtro de cidade, e a que esquecesse não teria como misturar.

- **O COP perdeu o "todas as cidades".** Antes, escopo `GLOBAL` (ADMIN e
  COP) via tudo; agora só o **ADMIN** (`tem_papel('ADMIN')`). Escolha do
  Emanuel. `eh_global()` continua existindo, mas não é mais lido por
  `bases_visiveis`. Não havia COP no banco.
- **As cidades a mais** são `usuario_base` (já existia desde a D-021), e a
  janela de **Editar cadastro** ganhou "Cidades que acessa". A cidade do
  cadastro vale sempre.
- O seletor do topo some quando há uma cidade só; trocar **recarrega a
  página** (nenhuma tela fica com dado da cidade anterior na memória).
- **Custo aceito:** a escolha é por pessoa, não por aba — duas abas em
  cidades diferentes passam a mostrar a última escolhida.
- **Consequência:** o ADMIN cadastra técnico, importa planilha de cadastro
  e cadastra bucket **na cidade ativa**. A importação de cadastro (D-176)
  perdeu o seletor de cidade e usa a do topo.
- O gatilho `perfil_protege_campos` recusa gravar `base_ativa` de cidade
  não permitida.

#### 3. A foto é da pessoa

`perfil.foto_path`, bucket **privado** `foto_perfil` (5 MB; jpg/png/webp),
caminho `<usuario_id>/<arquivo>`. **Só o ADMIN envia, troca e remove**
(policies de INSERT/UPDATE/DELETE + gatilho). **Vê** quem já vê a pessoa:
ela mesma, o ADMIN e quem enxerga a cidade dela — o que inclui o técnico no
ranking da própria cidade, que já mostra nome e pontos (D-167). Diferente
da evidência (D-115), foto de perfil **se troca**: não é prova.

- A imagem é **reduzida no navegador** (lado maior 512 px, JPEG): medido,
  900×600 PNG → 512×341, **2 KB**.
- `usuario_do_path()` usa `CASE` pela mesma razão do `visita_do_path`
  (D-116): nome que não começa com uuid não pode derrubar a policy.
- `fotos_dos_tecnicos(uuid[])`: o técnico só lê o próprio perfil e não
  acharia a foto dos colegas no ranking. Aparece em Administração (lista e
  janela), Equipes (a bolinha), Monitoramento e no **Painel do app**
  (ranking e a posição dele).
- **`tecnico.foto_url` (034) foi substituída**: nunca foi preenchida (0 de
  55) e a tela de Equipes a lia como URL pública, o que com bucket privado
  não abriria. A coluna fica, sem uso.

**Bateria:** `testar_policies()` com **19 cenários** (técnico troca para
cidade que não é dele; técnico troca a própria foto — os dois barrados).
Testado à mão como `authenticated`: ADMIN em Manaus vê 2 buckets e 55
técnicos; trocando para Belém, 3 buckets e 0 técnicos; o técnico vê 1
cidade e é barrado em trocar cidade, gravar `base_ativa`, mexer na foto e
cadastrar bucket. Foto testada pela tela de verdade no próprio ADMIN:
subiu, a URL assinada abriu (200), saiu do perfil e do Storage.

**Não verificado:** um técnico real vendo a foto dos colegas no app (exige
APK novo ou Expo Go, e foto cadastrada); o cartão de bucket da importação
com o arquivo de verdade (só a função por trás dele); a troca de cidade
pelo seletor na conta do Emanuel (testada no banco, não clicada, para não
mudar a cidade dele).

---

### D-181 · A importação do dia inteiro estourou os 8 s — e a reconciliação vira a segunda chamada

> *"fui importar de forma comum e deu erro"* (print: "canceling statement due
> to statement timeout") — Emanuel, 17/10

**O limite:** o papel `authenticated` tem `statement_timeout = 8s`
(`pg_roles.rolconfig`). A rota de Manaus de 17/10 — 340 linhas, 337
contratos novos, 452 O.S., a primeira importação do dia depois da limpeza —
mediu **4,2 a 6,0 s** como `authenticated`, numa chamada só. No clique, com
rede e cache frio, passou dos 8 s e o banco desfez tudo: nenhum contrato
entrou.

**Não foi a 103.** `bases_visiveis()` não é chamada nenhuma vez dentro da
importação (`pg_stat_xact_user_functions`). A diferença 5,6 s × 4,5 s entre
a versão nova e a antiga dela, medida duas vezes alternando, era oscilação
— a contagem de chamadas é o que decide.

**Onde estava o tempo (medido):** `norm_txt` chamada **258.260 vezes**
(1,7 s). `reconciliar_importacao`, para achar o técnico da jornada, chamava
`login_do_recurso()` de novo **para cada técnico** do subselect (3.056
chamadas para 102 visitas), e o tipo de atividade era casado par a par
(visita × tipo, normalizando os dois lados toda vez).

**O conserto (104):**
- o login sai **uma vez** por visita (`lateral` com `offset 0`, que impede
  o planejador de copiar a chamada de volta);
- cada tipo e cada visita normalizados uma vez (CTE `materialized`);
- índices de expressão `norm_txt(...)` em `tecnico`, `toa_recurso` e
  `equipe_login_toa`.

`norm_txt` caiu para 26.644 chamadas. **Resultado idêntico**: md5 de
equipe, técnico, tipo e situação das 337 visitas igual com a função antiga
(reaplicada só dentro de uma transação desfeita) e com a nova.

**E a divisão (104b):** `importar_toa` não chama mais
`reconciliar_importacao`; **a tela chama logo depois**, numa requisição
própria, com os seus 8 s. Medido: **3,7 s + 1,0 s**. Se a segunda falhar, os
contratos já entraram e a tela oferece "Rodar a segunda parte de novo" (ela
é idempotente). O erro de tempo agora diz "nenhum contrato entrou".

**Defeito achado no caminho:** `reconciliar_importacao` era executável por
qualquer `authenticated` **sem conferir papel nenhum** — um técnico podia
chamá-la. Agora confere o mesmo que `importar_toa` (gestão ou controlador)
e a cidade ativa. Testado: técnico barrado (42501).

**Recusado por enquanto:** tirar o TEC1 calculado em dobro (o
`importar_toa_interno` calcula por linha e a reconciliação recalcula no
fim — 3.164 chamadas de `tec1_da_os` para 452 O.S.). Economizaria ~0,5 s,
mas mexe na função grande da importação; com a divisão, a margem já é de
mais de 2×. Fica anotado.

A tentativa que estourou ficou como importação `PROCESSANDO` sem fim;
foi marcada `ERRO` (as 340 linhas continuam lá, nada foi aplicado).

---

### D-182 · A importação que falhou diz que falhou, e a que está rodando mostra que está viva

> *"se não importou ou deu erro o sistema deve apontar, nesse caso ele ta
> dando esperança, é bom botar uma animação quando estiver importando, para
> o time que importou ver que o sistema está reagindo"* — Emanuel, 17/10

**O defeito:** a tentativa que estourou os 8 s (D-181) aparecia no histórico
como **"Processando"** para sempre. A tela deduzia o estado de `aplicado_em`
e nunca lia `status`; o erro só existia na tela de quem clicou.

**Agora (migration 105 + tela):**
- qualquer falha depois de a importação nascer grava **`status = ERRO`** e
  **`erro_mensagem`** com a ETAPA em que parou ("Criando e atualizando os
  contratos: …") — o time inteiro vê no histórico;
- o histórico lê o status: **Sucesso / Com erro / Não entrou / Não
  terminou / Processando**. PROCESSANDO há mais de 10 min sem terminar vira
  **"Não terminou"** (a aba fechou ou caiu no meio — nada foi aplicado);
- enquanto importa: painel com roda girando (`motion-safe`), as 4 etapas
  com ✓, barra das linhas enviadas e cronômetro em segundos; o painel rola
  sozinho para a vista (ele nasce abaixo da dobra).

Testado com a rede FALSIFICADA (`window.fetch` interceptado, toda outra
escrita travada no navegador): caminho de sucesso e de "statement timeout";
o que a tela grava na importação conferido pelo corpo do PATCH.

#### O incidente desta verificação (registrado de propósito)

A primeira tentativa de ver o painel trocou `supabase.rpc`/`supabase.from`
num `import('/src/lib/supabase.ts')` feito pelo console. **Não era a mesma
instância** que a página usa (o Vite serve o módulo com `?t=` depois de
HMR), e a importação rodou DE VERDADE: **250 contratos fictícios
"TESTE0–249"** em Manaus, 17/10, mais 250 eventos e 250 avisos (para a
equipe "Sem login definido", que não tem técnico — ninguém foi notificado).
Apagados em seguida numa transação com trava (só os 250, só daquela
importação, nenhum com evidência/material/contato); o banco voltou ao
estado anterior, conferido. Daí a armadilha nova em `traps.md`.

---

### D-183 · A tela de Equipes estourou os 8 s — e desta vez a culpa era da 103

> *"por que ta demorando muito a carregar essa página? por mim ela nem precisa
> ser viva […] pode ter um botão de atualizar em cima para atualizar somente
> quando o usuário quiser"* — Emanuel, 17/10 (print: "canceling statement due
> to statement timeout")

**A tela já não era "viva".** Equipes carrega ao abrir, ao trocar o dia e no
botão **Atualizar** — sem Realtime e sem cronômetro (conferido no código).
O "Atualizando…" do print era o primeiro carregamento, que levava 11 s.
Nada a mudar na tela.

**A causa, medida** (`pg_stat_xact_user_functions`, como `authenticated`,
337 visitas / 452 O.S. de 17/10): `painel_equipes` levou **11,5 s**; 9,2 s
eram `bases_visiveis()`, chamada **4.537 vezes**, com `minha_empresa()` 177
mil vezes por dentro. Quem chama tanto é o RLS: `tec1_da_os` (1.808
chamadas), `pontos_da_visita` e cia. são funções INVOKER; cada consulta
delas avalia as policies, e cada policy pergunta `bases_visiveis()`. A
**103 deixou cada chamada mais cara** (permitidas + cidade ativa: 1,7 ms) e
o volume multiplicou. Ao contrário da D-181, aqui o defeito ERA meu.

**O conserto (106):**
1. `bases_visiveis()` calcula a resposta **uma vez por transação** e guarda
   numa variável local (`set_config('app.bases_visiveis', …, true)`), com o
   usuário na chave. Outra sessão não vê; a próxima requisição recalcula;
   trocar de usuário no meio da transação (as baterias fazem) não herda.
   `trocar_cidade` e a troca de base no perfil apagam o valor. **1,7 ms →
   0,02 ms** por chamada, mesmo conjunto de cidades.
2. `bases_permitidas()` resolve empresa, usuário e papel uma vez (antes,
   `minha_empresa()` por linha de base).
3. **106b** — `tec1_da_os` virou `SECURITY DEFINER`: devolve só a
   classificação do TEC1 de uma O.S. cujo uuid já se conhece, e quem a chama
   já filtrou pela cidade. 1,7 s → 0,66 s no painel, md5 igual.

**Resultado:** `painel_equipes` 11,5 s → **0,66 s** no banco; a tela abre em
**2,4 s** pelo navegador (rede incluída). Dashboard, Serviços, Rota e
Monitoramento abrem entre 1,8 e 3,0 s, sem erro.

**Baterias:** `testar_policies()` **19/19** — pela primeira vez desde a
limpeza, porque agora há contrato para o "CONTROLADOR exclui contrato" — e
`testar_campo()` 23/23.

**Limite conhecido:** mudar o PRÓPRIO papel ou `usuario_base` no meio de
uma transação e ler dados na mesma transação usa o valor antigo. Nenhuma
tela faz isso: cada ação é uma requisição.

**Não feito:** o mesmo cache em `eh_gestor()` / `minha_empresa()` (~4.800
chamadas cada, ~1 s antes do 106b). Ficou para quando medir que precisa.

---

### D-184 · O código 425 (TROCA DE TECNOLOGIA) fecha como Concluída

> *"Precisamos adicionar o código 425 em nosso sistema, não tem cadastrado
> penso eu, temos que fechar ele como concluído, atualmente ele esta em
> execução no nosso sistema"* — Emanuel, 19/10

**Conferido:** o cadastro tinha 168 códigos e o 425 não estava. Era o
**único** código das importações desde 17/10 sem cadastro. Sem cadastro, a
importação grava a O.S. com `codigo_baixa_id` nulo, a baixa automática não
tem o que aplicar, e o contrato fica em EM_EXECUCAO mesmo com o TOA dizendo
"concluído" — **calado**. Na planilha de 19/10: "Troca Decoder Digital",
O.S. 148 (troca de decoder para atualização digital), O.S. "Executada",
código `425 - TROCA DE TECNOLOGIA`.

**Cadastro (migration 107):**
- `situacao_destino = CONCLUIDA` — decisão do Emanuel;
- `natureza = SUCESSO` — do dado: a O.S. veio Executada, como 409/428/430;
  não é IMPRODUTIVA, então não conta como "quebrado";
- `familia = EQUIPAMENTO` **com `revisar = true`** — a coluna é NOT NULL
  (de novo a armadilha da NOT NULL que `pg_constraint` não mostra: a
  primeira tentativa morreu nisso) e não existe família "indefinida".
  EQUIPAMENTO é a do 513 (Incompatibilidade da Tecnologia). **Provisória**:
  a família só agrupa relatório, e o Emanuel não disse qual é;
- `situacao_origem = CADASTRO`, autor = o ADMIN (declaração de quem opera,
  não derivação do analítico).

**Os contratos:** três estavam presos — 202999589 (19/10), 202432098 e
202845796 (17/10). Cada dia foi **reprocessado pela última importação dele**
(o mesmo que reimportar o arquivo), primeiro numa transação desfeita para
ver o efeito: em 19/10, de 323 contratos só o 202999589 mudou; em 17/10, de
337, só os dois. Os três ficaram CONCLUIDA com o 425, e o histórico registra
a mudança como importação. Depois disso, **zero** O.S. com código do TOA
sem cadastro no banco.

**Em aberto (pergunta ao Emanuel):** o código desconhecido não avisa
ninguém — o contrato só fica parado. Seria "zero e desconhecido não são a
mesma coisa" (D-117): a importação poderia apontar "código 425 sem
cadastro" na prévia e no resultado.

---

### D-185 · O código de baixa se cadastra e se corrige pela tela; ARN-AFLINE é de Araguaína

> *"preciso que me deixe editar ou adicionar algum codigo no menu dos codigos
> ok?"* · *"De qual cidade é o ARN-AFLINE? — Araguaína"* — Emanuel, 19/10

**Até aqui** a tela de códigos só trocava o DESTINO
(`definir_situacao_do_codigo`). Código novo do TOA dependia de migration —
e o 425 mostrou o custo: contrato preso em execução, calado (D-184).

**Agora (migration 108), em Configurações › Baixa e situação:**
- **Novo código** e **Editar** em cada linha: descrição, família (lista das
  existentes ou nova), natureza e destino. `salvar_codigo_baixa` usa a
  MESMA porta da edição de destino (gestão + permissão
  "configuracoes.editar"). Quem salva fica carimbado; o código deixa de
  estar "a revisar" (salvar é ter olhado). Natureza SUCESSO limpa a
  responsabilidade (CHECK da tabela).
- **"Códigos do TOA sem cadastro"** (`codigos_sem_cadastro`): o que o TOA
  mandou nos últimos 30 dias e o cadastro não conhece, com quantos
  contratos e quantos estão presos; o botão "Cadastrar" já vem com o número
  e o texto do TOA. É o aviso que faltava, na tela onde se corrige.
- **O resultado da importação** também avisa, na hora, qual código veio sem
  cadastro e quantos contratos ficaram parados.
- Filtros novos: "Só os a revisar"; a busca acha por família.
- Vale **daqui para frente**, como o grupo de serviço (D-143): contrato já
  importado muda quando a planilha do dia for importada de novo. A tela diz
  isso.

Testado como `authenticated` (desfeito): ADMIN cadastra e edita, duplicado
e natureza inválida recusados, técnico barrado (42501); com o 425 "sumido"
de propósito, a lista mostrou "425 - TROCA DE TECNOLOGIA, 3 contratos" em
0,4 s.

**ARN-AFLINE → Araguaína - TO** (`toa_bucket`, origem CADASTRO, autor o
ADMIN). Ficara fora da semente da 103 porque as linhas dele diziam ARAGUAINA
e ARACAJU.

**Não verificado:** a tela logada — o navegador do assistente abriu na
entrada e senha de conta real não passa pelo assistente. Compilada,
publicada e conferida no ar; o banco por trás testado.

---

### D-186 · O aplicativo passa a se atualizar pelo ar (0.3.0, EAS Update)

> *"não é um apk novo, é modificar o que já temos adicionando essas funções
> entende?"* — Emanuel, 19/10. Entre duas opções, escolheu **atualização
> pelo ar** (a outra era usar só o Expo Go).

**O fato que obriga UM APK novo:** o 0.2.1 instalado foi gerado **sem
`expo-updates`**, a peça nativa que deixa o app baixar código novo. Não há
como mudá-lo por fora. O 0.3.0 é o último APK "obrigatório" para mudança de
JavaScript.

**Feito:**
- `expo-updates ~57.0.26` (`npx expo install`, versão do SDK 57);
- `eas update:configure`: `updates.url`, `runtimeVersion` com política
  **`appVersion`** (a versão do app É a fronteira de compatibilidade) e um
  canal por perfil no `eas.json` (development / preview / production);
- `version` 0.2.1 → **0.3.0** (peça nativa nova = versão nova);
- variáveis `EXPO_PUBLIC_SUPABASE_URL` e `_ANON_KEY` (a publishable) no
  **ambiente `preview` da EAS** — o SDK 55+ publica atualização com
  `--environment`, e as variáveis vêm de lá, não do `eas.json`; o ambiente
  estava vazio, e a primeira atualização teria saído sem o endereço do
  banco;
- build do APK 0.3.0, perfil `preview`, canal `preview`, enviado à fila.

**Desfeito do configurador:** ele reescreveu a lista de permissões do
Android no `app.json` com duplicatas (USE_BIOMETRIC, FOREGROUND_SERVICE_
LOCATION…). Inofensivo, mas ninguém pediu: a lista voltou à original.

**Como publicar daqui para frente:** `campo/README.md`, seção "Atualizar o
app instalado sem APK novo". Mudança nativa (biblioteca, permissão, SDK)
continua pedindo APK, com versão nova.

**Não verificado:** o APK 0.3.0 instalado recebendo uma atualização de
verdade — depende do build terminar e de uma primeira publicação.

---

### D-187 · TEC1 pelo livro oficial da CLARO, e o card "TEC1 - Atendimento no Prazo"

> *"corrija essa tela no card […] 'chegou dentro da janela', tire essa frase
> e coloque - TEC1 - Atendimento no Prazo, e coloque todos os status exceto o
> que esta pendente ainda, o cálculo é pra fazer em tudo que foi encerrado"* ·
> *"Estou te mandando um pdf também para você aprimorar mais ainda a regra do
> TEC1"* — Emanuel, 19/10. O PDF: "Indicadores COP - TEC1", Inteligência COP
> da CLARO, v1.0 de 05/07/2021.

**O card estava medindo outra coisa.** "Chegou dentro da janela" era a
CHEGADA do técnico dentro da janela, por VISITA. O TEC1 é por **O.S.**, conta
início **e** baixa com a tolerância do grupo, e é a conta oficial:
**TEC1 = COM PADRÃO / (COM PADRÃO + SEM PADRÃO)**, meta **94%** (item 4).
Expurgada não entra; em aberto também não. O Dashboard lê a classe de cada
O.S. AO VIVO (`tec1_ao_vivo`, coluna calculada), não o cache (D-150).

**A regra (`tec1_da_os`, migration 109), do livro:**
- só o que foi **encerrado no TOA** (concluído / não concluído);
- expurgos: cancelado no NETSMS (já existia), O.S. **imediata** e **janela
  vazia** (item 9), **janela 08:00–22:00** e os tipos MANUTENCAO CORRETIVA -
  MDU, MANUTENCAO PREVENTIVA - MDU / INDOOR, VARREDURA DE REDE EXTERNA,
  DESCONEXAO POR OPCAO EBT (item 6);
- cancelada/reagendada **antes da janela**: reagendada expurga sempre
  (11.7); cancelada só se não houve início (11.1); dentro da janela = com
  padrão, depois = sem padrão;
- executada sem início e antes da janela = expurgada (script, 11.1);
  executada antes da janela = com padrão (11.4); senão, início até o fim da
  janela **e** baixa **menor que** fim + tolerância (11.5/11.6);
- **tolerância 2 h / 1 h** (Instalação e Serviços / Manutenção, item 10.3):
  era 119/59 com "até" — alinhada ao livro (escolha do Emanuel).

**"Sem tratamento" (11.10) fica de fora**, como pendente — escolha do
Emanuel: se a última importação do dia foi ao meio-dia, a tarde contaria
contra sem ser. O card mostra à parte quantas estão em aberto.

**Medido:** a regra nova contra a anterior, O.S. a O.S., nos 909 O.S. de 17
e 19/10: **as 909 deram a mesma classe** (os casos novos do livro não
aconteceram nesses dois dias). TEC1 de 19/10: **95,3%** (326 com padrão, 16
sem, 19 expurgadas, 98 em aberto). 0,3 s para os dois dias, como
`authenticated`.

---

### D-188 · Migração pelo produto novo, GPON pela skill do TOA

> *"fazer a analise da migração, e melhorar nossa detecção de serviço
> migração […] acredito eu que é no produto"* · *"analise como identificar
> […] se é uma adesão, ou uma adesão gpon […] subir o marcador no contrato"* —
> Emanuel, 19/10, com dois analíticos da CLARO (fora do Git: LGPD).

**Os analíticos** (CLARO/NETSMS, não TOA): 1.132 O.S. de **migração** e 708
de **adesão GPON**, de 01 a 10/10/2026. Cruzados com os arquivos do TOA dos
Downloads pela O.S.: só 3 casaram (os arquivos são de outros dias) — então a
regra saiu dos analíticos **e** da linha do TOA já no banco (17 e 19/10).

**Migração** (escolha do Emanuel: vai para o grupo MIGRACAO GPON):
- no analítico, `TIPO_OS` = MUDANCA DE PACOTE em 100%, o produto NOVO traz
  **MIG, PON ou FIBRA em 100%** (MIG ou PON sozinhos: 66%), e o produto
  ANTERIOR **nunca** traz PON nem FIBRA (0 de 1.132);
- no TOA, o produto novo é o item **"pendente"** da coluna Produto; o
  "instalado" é o que o cliente já tem. O "MIG" aparece muito no
  INSTALADO (produto antigo "ADQ MIG") — olhar qualquer produto daria
  falso positivo;
- regra (`eh_migracao`): O.S. "MUDANCA DE PACOTE" (só o tipo 24) + pendente com MIG/PON/FIBRA + nenhum
  instalado com PON/FIBRA (quem já é fibra e troca de plano não migra);
- `grupo_da_visita` passa a considerar MIGRACAO GPON quando é migração; a
  prioridade de sempre vale (adesão continua na frente);
- conferido: dos 39 contratos que já eram MIGRACAO GPON pelo tipo de O.S., a
  regra reconhece 34; **8 que estavam em SERVICO foram para MIGRACAO GPON**
  (39 → 47). O grupo não mexe em pontos (vêm do tipo de O.S.) e a tolerância
  do TEC1 é a mesma (2 h).

**GPON** (escolha do Emanuel: etiqueta no contrato, o grupo não muda):
- no analítico, o tipo de O.S. é o mesmo da adesão comum e o produto falha
  (211 de 708 só "ACESSO VIRTUA"); o que separa é `TECNOLOGIA` = GPON — que
  o TOA **não** traz;
- no TOA, o sinal é a skill exigida **"PON(1/100)"** em Habilidade de
  Trabalho; nos dados de 17 e 19/10 ela contém todos os outros sinais
  (produto pendente PON, workzone GPON, tipo "INST GPON");
- `visita.tecnologia` = 'GPON' quando há sinal; **nulo = não identificada,
  não HFC** (D-117). Etiqueta "GPON" na linha do contrato (Serviços e
  Equipes). Resultado: 60 de 250 adesões, 44 de 47 migrações, 9 mudanças de
  endereço, 11 retornos, 4 serviços.

**Nos relatórios também** (*"se vai aparecer esse marcador também quando
formos extrair algum relatório, se vamos conseguir separar as adesões gpon?"*,
Emanuel, 19/10): coluna **Tecnologia** no "Exportar" de Serviços e nos dois
relatórios (por contrato e por O.S.), escrita GPON ou NÃO IDENTIFICADA —
nunca em branco, que pareceria HFC. E o filtro Toda tecnologia / Só GPON /
Sem GPON identificado em Serviços e em Relatórios; com Tipo de serviço =
ADESAO + Só GPON, sai a lista das adesões GPON.

**O tipo 57 (MUDANCA DE PACOTE DIGITAL) NÃO é migração** — *"se não tem no
analítico teste que te mandei não vamos considerar como migração"* (Emanuel,
19/10). Só o que o dado mostrou entra na regra.

**Quando roda:** na reconciliação (2ª chamada da importação, D-181), antes
do TEC1 — o grupo dá a tolerância. Os contratos desde 17/10 foram
reclassificados na 109 (sem tocar situação: nada de aviso, nada de
"mexido depois da importação").

**Não verificado:** a regra de GPON contra um conjunto rotulado do TOA (não
há: o analítico de GPON não tem Manaus e nenhuma O.S. dele casou com os
arquivos do TOA). A skill PON é o requisito que o próprio TOA grava para
mandar técnico de fibra — é o melhor sinal disponível na linha.

### D-189 · Sincronismo com o TOA: um robô que é a nossa própria tela

> *"Em baixo do nosso site seria bom ter um botão chamado sincronismo, eu
> quero fazer uma mascara que entrar em um site, e loga nele dentro do nosso
> sistema, depois disso, conseguimos escolher quanto e quanto tempo queremos
> que o sistema importe o excel"* — Emanuel, 19/10.

**O que o TOA faz por baixo** (aba de rede do Console de Alocação, 19/10,
logado com o usuário do Emanuel): o botão Ações › Exportar é **um GET só** —
`?m=gridexport&a=download&itype=manage&providerId=<n>&date=<dia>&…` —, que
devolve o .xlsx pronto (206 KB em 2,2 s para MAN-AFLINE) com o nome
`Atividades-<BUCKET>_DD_MM_AA.xlsx`, o mesmo de que a importação precisa
(D-180). Depende só do cookie da sessão. O `providerId` de cada bucket é o
`data-id` da árvore; 43 foram lidos (MAN-AFLINE = 32041, MAN-AFLINE_01_VT =
32040). O login é tela montada por JavaScript, com opção de SSO; não vimos
captcha nem MFA.

**Decisões do Emanuel (19/10):**
- a CLARO **permite** acesso automatizado com login de prestador; credencial
  de API ela **não** dá → o caminho é o robô;
- o login do robô no TOA é um **usuário exclusivo de importação** — testado:
  entrar com o mesmo usuário em outro navegador **derruba** a sessão anterior;
- quem opera escolhe os **buckets** e o **intervalo: 15, 30 ou 60 min** (5 e
  10 foram descartados por ele);
- a importação entra em nome de um usuário **"Robô de sincronismo"**,
  registrando quem configurou;
- o robô roda num **PC da AFLINE** (grátis), não no Cloudflare (US$ 5/mês) —
  se o PC der trabalho, migra depois; banco e tela servem aos dois.

**O desenho:**
- **A "máscara" com o TOA dentro do nosso site não existe**: a Oracle
  proíbe a página dela dentro de outro site, e o navegador proíbe um site de
  usar o login de outro. Por isso uma **extensão do Chrome**
  (`extensao-toa/`) faz a chamada do Exportar — e **só** ela: monta a URL a
  partir de número e dia conferidos; a página não pede outra coisa ao TOA.
- **O robô é a nossa tela Sincronismo**, aberta no PC com o usuário ROBO. Ela
  bate o pulso (`sincronismo_pulso`) a cada 60 s, recebe do servidor o DIA
  (`hoje_local`) e os buckets VENCIDOS, pede a planilha à extensão e importa
  pelo **mesmo** caminho da importação manual — que saiu de dentro da página
  para `lib/importarToa.ts`, para não haver duas cópias.
- **Papel `ROBO`** (110): insere importação em nome PRÓPRIO, na cidade dele,
  e chama `importar_toa`/`reconciliar_importacao`. Não lê contrato, não
  baixa, não exclui, não configura o sincronismo. A senha dele mora num PC
  ligado o dia todo: se vazar, o estrago tem de ser "importou uma planilha".
  Perfil de acesso "Robo de sincronismo" (112) para criar em um passo.
- **Arquivo igual não reimporta**: a impressão digital é SHA-256 das LINHAS
  lidas (não dos bytes — o .xlsx carrega a hora em que foi gerado). Igual à
  última importação de hoje → rodada `SEM_MUDANCA`. Mas **depois de 1 hora
  reimporta mesmo igual**, para código cadastrado depois (D-185) e a
  reconciliação valerem. Isso é regra técnica nossa, não da operação.
- **Zero e desconhecido** (regra 6): pulso parado há mais de 3 min =
  "robô sem sinal há X min", em vermelho, para todo mundo; o TOA devolvendo
  HTML em vez de planilha = "a sessão do TOA caiu"; cada tentativa vira uma
  linha em `sincronismo_rodada`, inclusive as que não importaram.
- **"Rodar agora" respeita o desligado**: quem decide é quem configura, não
  quem está na frente do PC do robô.
- O nome que o TOA dá ao arquivo **confere o número**: se `numero_toa`
  estiver errado, a planilha de outro bucket é recusada antes de importar.

**Recusado:** guardar a senha do TOA no nosso banco (o login fica na mão de
gente, no PC); robô no Cloudflare agora (custo, e ninguém pediu); copiar o
código de importação na tela do robô; pedir ao TOA por chamada de login
(frágil: a tela é montada por JS).

**Não verificado:** a extensão não pôde ser carregada no navegador da sessão
de desenvolvimento — a chamada foi testada da própria aba do TOA, não do
fundo da extensão (que manda o cookie por regra de extensão com permissão de
host). Também não se sabe por quanto tempo a sessão do TOA dura sem gente
mexendo; a tela acusa quando cair. O ciclo do robô ponta a ponta (extensão →
importação) só roda com o usuário ROBO criado e a extensão instalada.

**Revisão no mesmo dia (113) — sem usuário especial.**

> *"não vejo nessecidade disso, pra mim qual quer um que configurar sua
> maquina, vai conseguir importar com seu login entende? precisa corrigir
> isso."* — Emanuel, 19/10, sobre o "Robô de sincronismo".

- Quem pode importar à mão (gestão, controlador) pode **sincronizar pelo
  próprio computador, com o próprio login** — no Gestor AF e no TOA. A
  importação entra em nome de quem sincronizou. Não há segundo login no TOA
  para derrubar ninguém: a extensão usa a sessão já aberta naquele Chrome.
- O risco novo — dois computadores importando em dobro — virou regra do
  servidor: **um computador por vez por cidade** (`sincronismo.executor_id`).
  Quem pulsa enquanto outro está vivo (pulso há menos de 3 min) recebe
  "Fulano está sincronizando" e não roda nada; se o dono da vez some por
  3 min, o próximo que pulsar assume (o segundo PC é reserva automática).
  `ASSUMIR` toma a vez na mão; `SOLTAR` devolve. Testado com dois
  controladores reais, transação desfeita.
- "Sincronizar por este computador" é escolha de quem está no computador
  (guardada no navegador, como o tema); sem a extensão o computador nem
  pulsa — não tira a vez de quem consegue.
- O papel **ROBO** e o perfil "Robo de sincronismo" ficam como **opção**
  (PC dedicado sem login de pessoa). O cenário da bateria "CONTROLADOR se
  passa pelo robo" virou "SUPERVISOR sincroniza pelo computador dele"
  (barrado): o controlador agora pode.

**Primeira rodada real (19/10, 20:44):** extensão 0.1.0 no Chrome 155 do
Emanuel, MAN-AFLINE: 346 atividades → 339 contratos atualizados, 0 erros,
**7,7 s** do pedido ao TOA até o fim da importação. A dúvida de que o fundo
da extensão levaria o cookie do TOA ficou respondida: leva. A extensão está
documentada para crescer em `docs/11-EXTENSAO-TOA.md` (*"documente ela, que
vamos editar depois algumas coisas que ela pode nos ajudar ainda"* — Emanuel).

**"Sem mudança" parecia que não tinha rodado** (*"mais é bom informar que a
importação esta feita com sucesso entende? parece que nem atualizou"* —
Emanuel, 19/10). O banco estava certo (20:46 e 20:47: as mesmas 346 linhas,
mesma impressão). A tela passou a dizer: rótulo **"Conferido · sem mudança"**,
com "346 atividades conferidas no TOA — iguais à importação das 20:44;
contratos em dia"; o quadro de estado mostra a última importação; e cada
rodada deste computador aparece num quadro de resultado. O botão virou
**"Importar agora" e importa mesmo com a planilha igual** — quem clica quer
importar; pular o igual ficou só para as rodadas sozinhas.

**5 e 10 minutos (114).** *"adicione 5 minutos e 10 minutos por favor na extensão,
pra ter mais opções"* — Emanuel, 19/10, depois da primeira rodada real. O que
pesava era reimportar o igual, e isso não acontece: a conferência sem mudança
mediu 0,4–0,7 s. Intervalos agora: 5, 10, 15, 30 e 60 min.

### D-190 · "Imediata" não é "sem janela", e a jornada é roxa

**"Imediata"** (migration 115).

> *"ultimo contrato escritio, sem janela - ele esta com horário - imediata -
> então nesse caso por favor colocar o nome imediata, e não seme janela."* —
> Emanuel, 19/10 (contrato 227080444).

- O TOA manda a coluna **"Intervalo de Tempo" = "Imediata"** no lugar da
  faixa (`08:00 - 12:00`): atendimento para já, não agendado. A janela vem
  vazia, e a lista dizia "sem janela" — como se o TOA não tivesse dito nada.
- Medido: **25 de 701** visitas são Imediata, **todas** sem janela; os
  outros 121 "sem janela" são jornada, sem Intervalo de Tempo.
- `visita.janela_imediata` é coluna **gerada** da linha do TOA
  (`dados_origem`): a importação não mudou, e a reimportação acompanha.
  A lista de contratos (Serviços, Equipes) escreve **"Imediata"** em âmbar;
  "sem janela" ficou só para quando o TOA não disse nada (D-117).
- **Não mexe no TEC1.** Imediata continua sem regra de janela; se o livro
  da CLARO der um prazo para ela, é outra decisão.
- **Fora desta leva:** a Rota do dia (`rota_do_dia`) e a barra de períodos
  de Equipes ainda escrevem "sem janela" para Imediata — vêm de RPC que não
  traz a coluna.

**A jornada é roxa.**

> *"para os contratos informativos vamos da outra cor para ficar diferente,
> vamos aplicar um roxo claro suave"* · *"ele esta na cor cinza é bom mudar
> para não confundir com o cinza do entrada"* — Emanuel, 19/10.

- A linha de jornada (Refeição, Na Base…) usa `#a78bfa` na faixa e na tinta
  da linha, e a etiqueta "Informativo" é roxa (`violet`), com tom escuro no
  tema claro (`#6d28d9`, tokens em `styles.css`). Nenhuma situação usa roxo:
  bateu o olho, é jornada.

### D-191 · O que sumiu da planilha do TOA é desatribuído (cód. 800), e volta se reaparecer

> *"se a primeira vez que o contrato foi importado, e depois quando
> importarem de novo e o contrato não apareceu no relatorio, o sistema deve
> baixar automaticamente o contrato para desatribuido cod baixa 800, agora na
> prixima importação se ele aparecer de novo no relatorio, vamos devolver em
> entrada para o técnico que esta o contrato"* · *"so pode desatribuir
> contratos que tiverem em entrada, em outro status não pode ok"* — Emanuel,
> 19/10.

**Respostas do Emanuel (19/10, no popup):** só o que o campo não mexeu, e só
**Na entrada**; ao voltar, vai para **quem o TOA mostra agora**; **avisa** o
técnico; **sem trava** de quantidade ("desatribuir mesmo assim").

**A regra** (`desatribuir_ausentes`, migration 116) — a **terceira chamada**
da importação, depois de `importar_toa` e `reconciliar_importacao`, cada uma
com os seus 8 s (D-181). Vale para a importação manual e para o Sincronismo
(`lib/importarToa.ts`, o caminho único).

- **Sumiu** = mesmo dia de atuação e mesma cidade da importação, veio do TOA
  (`toa_atividade_id`), a **última importação que o viu é do mesmo bucket**,
  e o ID da Atividade não está em nenhuma linha desta importação — nem nas
  que deram erro (linha com erro não é contrato que sumiu). Jornada não conta.
- **Só desatribui** `ENTRADA` sem `bloqueado_em`. Qualquer outra situação,
  ou contrato que o campo tocou, fica como está.
- **Desatribuir** = cód. **800 na baixa da AFLINE** de toda O.S. sem baixa
  AFLINE (a da operadora vem do TOA e não se edita, D-042), situação
  **Cancelada** (o destino do 800 no cadastro), evento no histórico e aviso
  ao técnico (o aviso de cancelamento pela importação que já existia).
  Marca `visita.desatribuido_em`.
- **Voltou** = marcado e presente de novo numa linha da importação: sai o 800
  que **nós** pusemos (baixa AFLINE dada por gente fica) e, se continua
  Cancelada, volta **Na entrada** — com a equipe que a importação já roteou
  pelo login da linha nova. Se o próprio TOA mandou outra situação pelo
  código, vale a do TOA.
- Tudo com `app.origem = IMPORTACAO`: mudança feita pelo importador não
  marca o contrato como "mexido pelo campo" (`marca_bloqueio`) — senão a
  próxima importação não o reconheceria.
- Por que "a última importação que o viu é do mesmo bucket": um contrato
  que o TOA passou do MAN-AFLINE para o MAN-AFLINE_01_VT não pode ser
  desatribuído pela importação do MAN-AFLINE, onde de fato não está mais.
- Índice novo `importacao_linha (visita_id)` para essa pergunta.

**Testado** (como controlador, transação desfeita): importação sem um
contrato Na entrada → Cancelada, 800 nas 2 O.S., 1 aviso, `bloqueado_em`
nulo; importação com ele de volta → Na entrada, sem 800. 136 ms.

**Medido no dado real (19/10, 21h):** rodada sobre a última importação do
MAN-AFLINE (21:02), a regra desatribuiria **6** contratos Na entrada que o
TOA mostrou pela última vez entre 12:10 e 17:33 — os mesmos 6 da tela "Na
entrada" que o Emanuel mandou. É o caso que a regra existe para tratar: a
próxima importação do bucket os desatribui.

**Não verificado:** uma importação real passando pela regra (só em
transação desfeita); o texto do aviso que o técnico recebe é o do
cancelamento pela importação ("A operadora cancelou — não vá"), com a
observação "Saiu da sua rota no TOA: desatribuído automaticamente (cód. 800)".

### D-192 · A varredura do TOA: nome do cliente, equipamento e miscelânea, pelas telas

> *"agora eu quero o sistem de sincronismo de equipamentos, e miscelanias que
> tem no TOA e nome do cliente (...) importar para os contratos conforme o
> codigo do contrato"* · *"não quero burla o sistema, so quero trazer os dados
> que a minha senha ja acessa"* · *"recursos não precisa"* — Emanuel, 19/10.

**Por que varredura:** a planilha de Atividades não traz nome (701 de 701
vazios), equipamento nem miscelânea; não há relatório no TOA que traga
(Emanuel); a API oficial recusa sem credencial da CLARO (401).

**Por que pelas telas, e não pelo canal interno:** o canal interno do TOA
(`m=sync`, `m=Hint`) só aceita pedidos com a ficha anti-falsificação que a
aplicação gera (`X-OFS-CSRF-SECURE`). Copiá-la e reenviar por fora é contornar
uma proteção do sistema da CLARO — recusado (o assistente foi barrado pelas
regras de segurança ao tentar, e o caminho ficou registrado como FECHADO em
`docs/11-EXTENSAO-TOA.md`). A extensão faz o que a pessoa faria com o mouse,
e quem pede ao servidor é a própria aplicação do TOA.

**O caminho (`extensao-toa/toa.js`, extensão 0.2.0):** numa aba do TOA no
Console de Alocação — bloco `div.toaGantt-tb[aid]` → cartão → "Detalhes"
(confere o **ID da Atividade** na tela antes de ler; lê o **Nome**) →
"Equipamento" → lê a tabela: **Cliente**, **Instalado**, **Desinstalado**
(retirado). **Recurso** (carga do técnico) fica de fora. Miscelânea = item sem
serial e com quantidade. Uns **9 s por contrato** (medido).

**Defeito achado no teste e corrigido antes de publicar:** o cartão do TOA é
reaproveitado — o link "Detalhes" existe antes do clique e, clicado cedo
demais, abriu a atividade anterior (leu o equipamento de 202944209 pedindo
203084123). O script agora espera o cartão trocar, confere o ID e tenta de
novo uma vez. Testado em sequência: 202944209 (3 itens), 203084123 (4 itens,
outro equipamento), e um ID inexistente → "fora do Console", sem erro.

**O banco (migration 117):**
- `visita_equipamento_toa` — por contrato, a última leitura (retrato, não
  razão: cada leitura substitui a anterior). Lê quem lê o contrato (o RLS de
  `visita` por baixo). **Não mexe em saldo nem posse** (decisão do Emanuel).
- `visita.cliente_nome` passa a ser preenchido; `visita.toa_varrido_em`.
- `varredura_pendentes`: hoje, sem jornada, **sem nome** ou **encerrado no
  TOA e ainda não varrido** (antes de encerrar a lista está incompleta).
  Medido: 246 pendentes no primeiro dia em Manaus, 18 ms.
- `registrar_varredura` grava contrato a contrato (parar no meio não perde o
  que veio); ignora seção Recurso mesmo se vier.
- `sincronismo.varredura_intervalo_min`: nulo = só no botão; 30 ou 60 min.

**A tela:** Sincronismo › "Este computador sincroniza" ganhou o quadro da
varredura (botão "Varrer o TOA agora", "Parar", barra com a %); a % também
aparece no ícone da extensão. A configuração escolhe só no botão / 30 min /
1 hora. O contrato (janela e página de detalhe) mostra "Equipamento e
miscelânea no TOA" — ou "ainda não lido do TOA", nunca uma lista vazia que não
foi lida (regra 6).

**Limites conhecidos:** o Console mostra um bucket e um dia por vez — a
varredura cobre o que está aberto e conta o resto como "fora do Console";
trocar de bucket sozinho não foi feito. A aba do TOA fica ocupada durante a
varredura. Se a Oracle mudar a tela, a varredura para (a baixa continua).

### D-193 · A extensão faz tudo sozinha (0.3.0): login próprio, alarme, grava direto no banco

> *"esta apresentando falhas, ele não diz o que importou (...) eu acredito que
> o ideial era ter um botão na extesão que intalamos e ela ler direto os dados
> do toa atravez do script e enviar os dados direnteo para o contrato certo e
> banco o que acha? por que se eu sair da tela do afline manager, ela meio que
> para de atualziar"* — Emanuel, 19/10.

**O que estava errado (medido no banco):** até a 0.2.0 quem trabalhava era a
TELA Sincronismo — a extensão só buscava. A primeira varredura gravou **5
contratos** (nome + 16 itens) e parou: o Emanuel saiu da tela, a extensão
seguiu percorrendo o TOA e ninguém gravava o que ela lia; como a varredura
"antiga" nunca terminou, a extensão passou a responder "já está varrendo".
Junto, "TOA deslogou" desde 21:38 — o login do mesmo usuário do TOA no
navegador do assistente (estudo da tela) derrubou a sessão do Chrome dele.

**Decisão do Emanuel (19/10):** a extensão faz tudo sozinha; entra no Gestor
AF com **e-mail e senha** de quem opera.

**Como ficou (extensão 0.3.0):**
- **Fundo** (`app/extensao/fundo.ts` → `extensao-toa/fundo.js`, montado pelo
  `npm run extensao`): login no Gestor AF guardando **só a sessão** (em
  `chrome.storage.local`, como o navegador faz no site; a senha nunca);
  **alarme do Chrome** a cada minuto; pulso e vez no servidor (113); baixa e
  importação pelo **mesmo núcleo** da importação manual
  (`src/lib/importarToaNucleo.ts`, que agora recebe o cliente do banco por
  parâmetro — a web passa o dela, a extensão o seu); e a varredura comandando
  a aba do TOA e **gravando direto** (`registrar_varredura`). Funciona com a
  tela do Gestor AF fechada; basta o Chrome aberto e o TOA logado.
- **Janelinha** (clique no ícone; `app/extensao/popup.ts`): entrar/sair,
  "Sincronizar por este computador", situação em uma frase (sincronizando,
  de reserva de Fulano, TOA caiu, desligado no servidor — nunca "tudo certo"
  sem saber), "Sincronizar agora", "Assumir a vez", "Varrer o TOA agora",
  "Parar", barra com a %, últimos acontecimentos.
- O **estado** fica em `chrome.storage.local`, não na memória: o Chrome
  adormece o fundo da extensão entre um alarme e outro.
- A **tela Sincronismo** deixou de executar: configura e acompanha, e diz se
  o Chrome dela tem a extensão (e se é a 0.3.0). A página só faz "ping".
- **A varredura entra no histórico** (migration 118): cada uma terminada vira
  uma linha em `sincronismo_rodada` (resultado VARREDURA), com o resumo
  (nomes, listas, fora do Console, erros) e quantos contratos passaram.
- A tela pegava "sessão caiu" só por HTML; o TOA também responde JSON
  (`errorNo: SESSION_DESTROYED`) — o fundo trata os dois.

**Recusado:** compartilhar a sessão da página com a extensão (as duas
renovando o mesmo token derrubariam a sessão — rotação do Supabase);
publicar na Chrome Web Store (o Emanuel prefere o modo desenvolvedor).

**Verificado:** `tsc` da web e da extensão (`tsconfig.extensao.json`, com os
tipos do Chrome), build; o `fundo.js` montado carrega num Chrome simulado
(alarme de 1 min, ouvintes, nenhum pedido de rede ao carregar); a chave no
pacote é a publishable. **Não verificado:** a 0.3.0 instalada rodando
(login, alarme, baixa e varredura de ponta a ponta) — o navegador da sessão
não carrega extensão.

**0.3.1 — aba do TOA escondida pausa, não erra (19/10, noite).** No primeiro uso da
0.3.0 a varredura leu 11 de 16 e anotou 5 erros ("Não consegui voltar ao Console",
"A lista de equipamento não carregou") quando o Emanuel saiu da aba do TOA: o Chrome
quase para uma aba que não está à vista — não desenha a tela e atrasa os relógios —, e
a varredura pilota as telas de verdade do TOA. Agora: escondida, a varredura **pausa**
(janelinha e ícone "II" avisam) e volta sozinha quando a aba aparece; o prazo só corre
com a aba à vista; 15 s para os detalhes e 25 s para a lista (a seção Recurso tem 80–140
linhas); uma segunda tentativa antes de anotar erro. Contrato com erro continua pendente
e entra na próxima varredura. **Para usar:** o TOA numa janela só dele, à vista (outro
monitor, ou lado a lado), não minimizada.

**0.4.0 — painel lateral e janela da varredura (19/10, noite).** *"eu so queria que
quando a extesão fosse habilitada, e saisse da tela do toa para navegar em outras
paginas, o processo não parasse"* · *"a extensão deles fica meio que fixa ao lado da
tela, a nossa precisa chegar nesse nivel"* — Emanuel. O ícone abre o **painel lateral**
do Chrome (`side_panel`, o mesmo popup.html), fixo ao lado da página enquanto se navega.
E **"Abrir a janela da varredura"**: o TOA numa janela só dela, que a varredura prefere
(`janela_varredura` no armazenamento) — a pessoa navega na outra. O limite é do Chrome:
aba/janela escondida não é desenhada; minimizada pausa, coberta pausa no Windows a menos
que o atalho tenha `--disable-backgrounding-occluded-windows` (opção do próprio Chrome,
documentada no README). Forçar o desenho por baixo ou abrir o TOA dentro da extensão
(o TOA proíbe ser embutido) foi recusado: seria contornar proteção.

### D-194 · Os técnicos da manutenção de Manaus (VT) e o filtro por tipo de login

**A planilha da VT (20/10).** *"cadastre esses técnicos… eles são da manutenção de
Manaus, cadastre todos igual como fez da instalação"* — Emanuel. 12 técnicos e 12
equipes do bucket MAN-AFLINE_01_VT, pela planilha padrão (D-176/D-177), com as
escolhas dele: skill **MANUTENÇÃO**, cargo **TECNICO** (não se criou "TECNICO VT"),
área MA1 → **MAN-AREA01** e MA5 → **MAN-AREA05**, equipe "**NNN - EQUIPE**". O resto
igual à instalação: criar acesso SIM, perfil Tecnico de Campo, apelido = primeiro
nome, rotear SIM; quem veio sem e-mail ganhou `NNN_equipe@afline.com.br`.

A "matrícula do ponto" veio **igual ao login TOA nas 12 linhas** (Z447807…), e a tela
só aceita número — os 55 técnicos de Manaus já cadastrados têm matrícula numérica.
Foi **deixada vazia**: o login já está na coluna dele, e célula vazia não apaga nada
(D-176) — quando a matrícula real aparecer, reimportar ou editar preenche. A prévia
no banco (como ADMIN, desfeita): 12 equipes novas, 12 pessoas novas com acesso, zero
erro. Os dois supervisores da planilha ainda não têm cadastro em Manaus: o nome fica
na equipe. Quem cria os acessos é a tela, com a sessão do ADMIN e a senha que ele
digita — não o assistente.

**O filtro (Administração › Usuários).** *"é bom ter um filtro em nosso painel para
filtrar tipo de login, cop, gerente, técnico e etc."* — Emanuel. O **tipo de login é
o papel** (ADMIN, COP, Controlador, Supervisor, Técnico, Almoxarife, Frota, Robô),
porque é ele que o banco lê; chips com a contagem, mais "Sem papel" (quem não entra
em tela nenhuma). **"Gerente" não é papel**: é cargo (COORDENADOR, SUPERVISOR), por
isso o cargo é um seletor à parte. Os dois se somam à busca. Filtro de tela, só
leitura — não muda o que ninguém enxerga.

### D-195 · Filtro de bucket do TOA, com mais de um marcado (119)

*"é bom ter um filtro de bucket ou seja dessa pasta (...) é bom o usuario também ter
possibildiade de selecionar mais de um bucket"* — Emanuel, 20/10, com o print da
árvore de buckets do TOA.

**O contrato não sabia de qual bucket veio.** O bucket morava só na importação
(`importacao.bucket`, 103). A 119 cria `visita.toa_bucket` = o bucket da **última**
importação que trouxe o contrato. Os 1.112 que já existiam foram preenchidos pelo
`importacao_linha` (1.021 MAN-AFLINE, 91 MAN-AFLINE_01_VT — hoje 339 e 72), sem
carimbar `atualizado_em` (o gatilho ficou desligado só nesse UPDATE: preencher a
coluna não é mudança no contrato). Daqui para frente quem carimba é
`reconciliar_importacao` (a 2ª chamada, D-181), **no mesmo UPDATE que já recalcula
o TEC1** — nenhuma linha a mais, e nada a mais na 1ª chamada, que anda perto dos
8 s. Medido como `authenticated` sobre a importação da VT (desfeita): 216 ms, 72
contratos carimbados.

Recusado: ler o bucket por `visita.importacao_id` — só marca quem CRIOU o contrato
(traps.md). E guardar só o bucket do primeiro arquivo: um contrato que muda de
bucket no TOA tem de aparecer no bucket de agora.

**A tela.** Um botão "Todos os buckets" que abre caixinhas (um `<select multiple>`
pede Ctrl+clique, que ninguém descobre). Nada marcado = todos. As opções saem do
que o dia/lista TEM, com a contagem, como o status do TOA; contrato manual aparece
como "Sem bucket (manual)". Mora no filtro de contrato compartilhado
(`lib/filtroContratos`), então vale igual em **Serviços** e **Equipes**; e no **Dashboard** (*"filtro do bucket na tela principal também"*), onde os números, a régua e as tabelas passam a ser só dos buckets marcados — em
Equipes, a equipe aparece se tiver ao menos um contrato do bucket marcado.

De passagem: em Serviços, trocar o filtro de tecnologia (GPON) não refiltrava a
lista até mexer em outro filtro — faltava `tecnologia` nas dependências do
`useMemo`. Corrigido.

### D-196 · A varredura troca de bucket sozinha (120, extensão 0.5.0)

*"nosso sistema de varrer não pegou dados de nenhum vt entenda o que houve"* —
Emanuel, 20/10, com o print dos contratos da VT sem nome nem equipamento.

**O que houve (do banco, `sincronismo_rodada`).** Hoje, MAN-AFLINE: 230
contratos, 153 com nome, 40 com equipamento lido; MAN-AFLINE_01_VT: 56, **zero**
com nome, zero varridos. A varredura das 10:51 deu "153 nomes, 40 listas; 8 fora
do Console aberto; 64 com erro"; a das 12:42, "0 nomes; **192 fora do Console
aberto**". A varredura acha cada contrato pelo **bloco dele no Console de
Alocação** — e o Console mostra **um bucket só**, o marcado na árvore do TOA.
Com MAN-AFLINE aberto, os da VT nunca estão na tela; às 12:42 o Console estava
em outro bucket (no print da árvore, de hoje, o marcado era BSB-AFLINE) e nem os
de MAN-AFLINE foram achados. A baixa da planilha não tem esse problema: ela pede
cada bucket pelo número (D-189).

**A correção.** `varredura_pendentes` (120) devolve o bucket de cada contrato
(`visita.toa_bucket`, 119) e ordena por ele. O `toa.js` (0.5.0), antes do
primeiro contrato de cada bucket, **clica no nome do bucket na árvore** — o
mesmo clique de quem opera, só navegação — e confere pelo subtítulo do Console
que abriu o certo. No fim, volta ao bucket que estava aberto. Bucket que não
abre (árvore escondida, nome diferente) vira **um** aviso no painel e os
contratos dele ficam pendentes para a próxima varredura — não 56 tentativas de
16 s.

Testado numa página que imita o Console (cabeçalho, árvore com clique na linha
e atraso de 0,7 s): abre MAN-AFLINE_01_VT, o bloco do contrato aparece, volta a
MAN-AFLINE; bucket inexistente recusado na hora. **Não testado no TOA de
verdade** — o navegador do assistente não entra no TOA (derrubaria a sessão do
Emanuel). Se a árvore do TOA não reagir ao clique no texto, o recado no painel
diz qual bucket não abriu.

Os 64 erros das 10:51 são outra coisa e o detalhe deles está só no registro
local da extensão (painel), não no banco.

### D-197 · Quem opera escolhe o que a varredura lê (121, extensão 0.6.0)

*"seria interessante eu escolher também o que eu vou varrer, coloquei para começar
primeiro na VT e não vai, ele segue o padrão dos dois"* — Emanuel, 20/10.

**Duas coisas.** (1) A 0.5.0 seguia a ordem do banco (bucket em ordem alfabética):
MAN-AFLINE antes de MAN-AFLINE_01_VT, mesmo com a VT aberta no Console. Agora a
varredura **começa pelo bucket que já está aberto** — abrir a VT é o jeito de
começar por ela. (2) No painel da extensão, **uma caixinha por bucket**, com quanto
falta (sem nome · equipamento), e **"Ler"**: nome e equipamento (o de sempre) / só
o nome / só equipamento e material dos encerrados.

- A escolha é **deste computador** (`af_estado.escolha`), e vale para o "Varrer
  agora" **e** para a rodada automática — quem varre é a extensão, uma máquina por
  vez (D-190). Guarda os buckets **desmarcados**: bucket que aparece depois entra
  marcado, como sempre foi, em vez de ficar de fora calado.
- "Só o nome" não abre a lista de equipamento, e `registrar_varredura` só carimba
  `toa_varrido_em` quando a lista foi lida: o encerrado continua pendente para a
  próxima. Nada se perde por escolher.
- `varredura_pendentes(p_base, p_buckets, p_o_que)` (121): os dois filtros com
  default; a de 1 argumento foi derrubada (assinatura com default não convive com
  a antiga — traps.md), e a 0.5.0 continua chamando sem os novos. Testado como
  `authenticated`: tudo 67, só VT 47, VT só equipamento 10 (sem pedir nome), só
  nome 67 (sem pedir equipamento).

Conferido o painel numa cópia com o `chrome` de mentira (caixinhas, contagem,
"Ler", pedidos ao clicar). **Não conferido no Chrome com o TOA**: a primeira
varredura de verdade é do Emanuel.

### D-198 · Toda visita com endereço tem edificação: BECO, LOJA, APTO ou CASA (122)

*"o que começa com TV é Beco ok, o que tiver LJ no complemento é Loja, e o que tiver
somente nome normal é casa (...) tem que corrigir o nosso banco pra isso, para
preencher todas as edificações agora. use a sua inteligencia para identificar se for o
caso"* — Emanuel, 20/10, com a lista dos contratos da última importação sem edificação.

**O que havia.** A edificação não é gravada: `edificacao_de()` calcula na leitura, do
cadastro (`tipo_residencia`) e do complemento (D-045). Sem complemento, ou com um que a
regra não entendia, caía em **QUALQUER** — 668 visitas, 315 delas com endereço (o resto
é jornada, sem endereço). A pontuação delas vinha da regra coringa.

**A regra nova** (a primeira que casa vale; corrigir a função corrigiu todos os
contratos de uma vez, antigos e novos):

1. **cadastro** (`tipo_residencia`) — quem digitou manda;
2. **sem logradouro e sem complemento → QUALQUER**, origem "SEM ENDERECO" (a jornada:
   não há o que saber — zero e desconhecido não são a mesma coisa);
3. complemento de **LOJA**: LJ, LOJA, SALA, SL, BOX, GALP, ACAD, CJ — vem antes do
   apartamento porque "ED ALEGRO MALL, LJ 7" é loja;
4. complemento de **APTO**: APT, AP, BL, **BLC**, BLOCO, TOR, COND, ED, EDF, EDIF,
   **COB/COBERTURA** (os dois em negrito a regra antiga não lia);
5. **BECO**: logradouro que começa com **TV** (a regra do Emanuel) ou **BC** (a sigla do
   próprio beco: "BC CRAVARI", "BC POSEIDON"), ou com a palavra BECO no logradouro ("R
   BECO SAO MARÇAL") ou no complemento ("BECOZURIQUE");
6. o resto é **CASA** — com sinal de casa no complemento (CASA, FD, FT, F1, QD, LT…,
   origem "DERIVADA DO COMPLEMENTO") ou sem sinal nenhum, que é o "nome normal" (origem
   "SEM INDICACAO (CASA)"). A origem fica visível na dica do contrato e no Exportar, para
   quem quiser conferir.

Leituras de julgamento, ditas para poderem ser revistas: "PORT", "BSD 1", "ME", "SN" e
"COND JD ENCONTRO DAS AGUAS" (condomínio sem bloco nem apto) ficaram CASA; "TV DO
COMERCIO, LJ 5" ficou LOJA (o complemento é mais específico que a rua); "GAL" no
logradouro não é galeria comercial em Manaus ("GAL CALAMERDE (N ESP II)") e ficou CASA.

**COMERCIAL virou LOJA** — nenhum cadastro nem regra de pontuação usava COMERCIAL. As
listas da tela (cadastro do contrato, contrato novo, regras de pontuação) trocam
"Comercial" por **Beco** e **Loja**.

**Na pontuação, BECO é CASA.** A CLARO só separa casa de apartamento no preço (D-045) e
beco é casa. Medido antes de aplicar: sem isso, 13 visitas que já eram CASA (rua TV/BC
com "casa" no complemento) cairiam na coringa e 3 perderiam ponto. Uma regra própria de
BECO, se um dia existir, ganha da de CASA. LOJA segue na coringa, como o COMERCIAL
seguia.

**Medido.** Pontos CLARO de todas as visitas: 909,10 → **909,58** (+0,48: os que saem
da coringa para a regra de CASA); 734 com regra antes e depois. Hoje: APTO 175, CASA 534
(252 pelo complemento, 282 sem indicação), BECO 35, LOJA 21, QUALQUER 353 — todos
jornada. Como `authenticated`: `pontos_por_periodo` de 30 dias em 163 ms. A versão de 2
argumentos das duas funções foi derrubada (ninguém mais a chama — conferido em
`pg_proc`).

### D-199 · Caso crítico (ouvidoria) e segmentação do cliente no contrato (123)

*"adicione ao nosso banco a coluna Segmentação (...) e coluna Caso crítico (ouvidoria)
preciso dizer se é ouvidoria ou não, se for ouvidoria, deve subir um marcador preto, se
não for a vida segue normal, a segmentação do cliente é importante verifica a melhor
área para essas sinalizações"* — Emanuel, 20/10.

**Do dado.** As duas colunas já vinham na planilha do TOA. "Caso crítico (ouvidoria)"
está em TODAS as 1.118 linhas: "não" 1.116, **"sim" 2** (hoje: 208150555, PURPLE, e
208965109, PME). "Segmentação": PURPLE 399, SEM SEGMENTO 195, PME 61, BLACK 12, PURPLE
PME PF 10, WHITE 8.

- **Ouvidoria (nova):** `visita.ouvidoria`, coluna **gerada** da linha do TOA, como a
  `janela_imediata` (115) — a importação não muda, a reimportação acompanha. Nula quando
  a linha não traz a coluna: "não sei" não é "não".
- **Segmentação: já existia.** Tabela `segmentacao` + `visita.segmentacao_id`,
  preenchida pela importação (`importar_toa_interno`) — só aparecia na página do
  contrato. **Erro meu, desfeito na hora (123b):** criei uma coluna gerada
  `segmentacao` antes de procurar no schema; era cópia, foi derrubada, e as telas leem
  `segmentacao:segmentacao_id ( nome )`.

**Onde aparece** (o "verifica a melhor área" do pedido):

- **Linha do contrato** (Serviços e a gaveta de Equipes — o mesmo componente): a
  etiqueta **preta sólida "● OUVIDORIA"** ao lado do número do contrato, a coisa mais
  escura da linha, e só quando é. Não-ouvidoria não desenha nada. O segmento vai
  discreto, ao lado dos pontos, com uma bolinha de cor (PURPLE roxo, PME azul, BLACK
  preto em contorno, WHITE branco); não usa o roxo de fundo das linhas, que já quer
  dizer jornada (D-190), e o BLACK não se confunde com a etiqueta da ouvidoria.
- **Contrato aberto** (janela e página): as duas etiquetas no cabeçalho, maiores.
- **Filtros** de Serviços e Equipes: "Todo segmento" (e "Segmento não informado") e
  **"Só ouvidoria (N)"** com a contagem do que está carregado.
- **Exportar** de Serviços: colunas Segmento e Ouvidoria (SIM / NÃO / vazio = o TOA não
  trouxe).

Fica para depois, se o Emanuel quiser: a etiqueta no **aplicativo do técnico** (pede a
`agenda_do_campo` devolver a ouvidoria e uma atualização pelo ar) e um número de
ouvidoria no Dashboard.

### D-200 · A versão no ar, no pé da lateral, e a assinatura "Desenvolvido por E.C"

*"crie um controle de versão na lateral também (...) e adiciona a sigla desenvolvido
por E.C"* · *"de forma bem sutil"* — Emanuel, 20/10.

**Carimbada no build, nunca digitada.** O `vite.config.ts` grava `__VERSAO__`:
`v<major.minor do package.json>.<nº de commits>` (hoje 0.1.12x), o commit curto, a hora
do build e se havia mudança não commitada em `app/`. Número escrito à mão apodrece no
primeiro deploy esquecido; o número de commits só sobe. Sem git (pasta copiada), diz
"sem git" em vez de inventar.

**Sutil:** uma linha de 10 px no pé da lateral, abaixo de quem está logado —
`v0.1.N` à esquerda, "Desenvolvido por E.C" à direita, na cor de rótulo (`graf-400`; mais
apagado que isso reprova contraste, traps.md). A dica (passar o mouse) mostra commit,
data/hora da publicação e o aviso de alterações não commitadas. Lateral recolhida: some.

Consequência: **commitar antes do build** (`docs/09-PUBLICAR.md`), senão a versão no ar
aponta para o commit anterior.

### D-201 · O técnico vê no app o que o controlador vê: produto, segmento, ouvidoria e TEC1

*"esta faltando a visão para o técnico do produto, o segmento do cliente se é PME ou
não, a sinalização de ouvidoria técnico tem que visualizar também, e na tela principal
de cada contrato podemos colocar se perdeu tec1 ou não"* — Emanuel, 21/10.

**Nada novo é calculado.** A 124 faz a `agenda_do_campo` devolver as MESMAS colunas
que a linha do contrato da web lê: `segmentacao.nome`, `visita.ouvidoria`,
`visita.tec1` e `visita.produtos_pendentes`. O cartão do celular e a central não podem
dizer coisas diferentes do mesmo contrato. A tela do contrato lê o mesmo pelo select.

- **Ouvidoria**: etiqueta preta sólida, só quando é (1 em 468 em 21/10). Nula não desenha.
- **Segmento**: o nome como o TOA mandou (PME, PURPLE PME PF...); "PME ou não" é o
  próprio nome, sem regra nossa por cima.
- **TEC1**: "TEC1 no padrão" / "Perdeu TEC1" / "TEC1 fora do cálculo". Nulo (o TOA
  ainda não encerrou) não desenha nada: não é "no padrão".
- **Produto**: o pendente de cada O.S. no cartão (sem repetir) e na O.S. aberta.

`campo/src/ui/MarcasCliente.tsx` é cópia declarada da web (D-112). Chega ao APK
instalado por `eas update` (só JavaScript, mesma runtime 0.3.0).

### D-202 · App: o tipo do contrato, o % de TEC1 entregue e o material que o TOA leu (125)

*"é bom colocar o tipo de os, se é adesão, serviço, mudança de endereço e organizar
melhor na tela do app para ficar fácil de ler"* · *"é bom colocar a % do TEC1 que está
sendo entregue, % padrão"* · *"queria que mostrasse esses lançamentos para o técnico
também (...) não seria obrigatório o técnico lançar"* — Emanuel, 24/10.

**Cartão da agenda.** Grupo grande (ADESAO, SERVICO...), etiqueta GPON, e embaixo o tipo
do TOA (Instalacao, Mudanca de Pacote) só quando difere do grupo — "VISITA TECNICA /
Visita Tecnica" é eco. Contrato, node, produto, cliente e endereço viraram uma ficha
"rótulo · valor" com os rótulos na mesma coluna. `agenda_do_campo` devolve
`tipo_atividade` e `tecnologia`, as mesmas da coluna GRUPO da central.

**TEC1 entregue no painel.** `painel_do_tecnico` devolve `tec1` com a conta do painel de
Equipes: por O.S. (`tec1_da_os`), sem jornada nem desconexão, pct = padrão / (padrão +
sem padrão). Nenhuma O.S. avaliada = pct nulo e a tela diz isso. Medido como o técnico
(Nicacio, outubro): 92,9% (79 de 85), 205 ms o painel inteiro, 11 ms a conta nova.
Meta 94% (D-187, livro da CLARO). **Divergência achada, não corrigida:** o painel de
Equipes da web ainda usa 95% (`META_TEC1` em `Equipes.tsx`, da 047); o Painel do Dia usa 94.

**Material do TOA no contrato.** `material_do_toa(p_visita)` devolve a leitura da
varredura (117) com o que o técnico lançou ao lado: equipamento por serial, miscelânea
pelo código SAP do começo do nome do TOA (casa com `item_miscelanea.codigo` em 860 de
907 linhas). Na tela: "você lançou", "do TOA" ou "você lançou N" (quantidade diferente);
sem como comparar, sem selo. **Só leitura**: D-192 continua — nada mexe em saldo, posse
ou no lançamento do técnico.

**Em aberto (pergunta ao Emanuel):** a correção do lançamento do técnico pelo TOA
("só será feito as correções se tiver lançado errado"). Corrigir mexe no saldo do técnico
(a miscelânea sai do saldo dele, D-163) e muda a D-192; falta dizer o que é "errado",
quem corrige e se o que só o TOA tem vira lançamento.

### D-203 · O técnico volta atrás no melhor contato e corrige o equipamento que lançou (126)

*"uma vez que ele selecionou que não quer adicionar o melhor contato do assinante, ele
pode voltar atrás depois (...) a mesma coisa para equipamento - ele pode editar também,
porém miscelânea uma vez importada do sistema não pode mais editar"* — Emanuel, 24/10.

**Melhor contato.** O banco já aceitava responder de novo (`informar_contato_cliente`
grava por cima; o histórico guarda cada resposta). Faltava o botão: "Informar o número
agora" depois de um NÃO, "Trocar o número" depois de um SIM. Só no dia (trava 3).

**Equipamento.** Lançar move a posse da peça (079). Corrigir o serial sem desfazer isso
deixaria a peça errada "com o assinante" para sempre, e o banco não sabia como ela estava
antes. Agora `equipamento_movimento` guarda a posse anterior (gatilho BEFORE INSERT), e
`editar_equipamento` devolve a peça errada ao estado anterior **só se ela ainda está como
aquele lançamento deixou** (ninguém mexeu depois, nem romaneio). Se não dá, não inventa:
escreve no histórico e a posse fica para o almoxarifado conferir. Tipo/modelo sem trocar
serial é só texto. O técnico corrige **só o que ele lançou**, e só no contrato de hoje;
o controlador corrige qualquer um da equipe que enxerga.

Testado como o técnico (transação desfeita): peça do almoxarifado lançada → com o
assinante → corrigida para outra → voltou ao almoxarifado, e a nova foi para o assinante.
`testar_campo` ganhou 2 cenários (25/25); `testar_policies` 26/26.

**Miscelânea:** nada muda — o campo já não edita lançamento de miscelânea, e a leitura do
TOA é só leitura (D-192, D-202).

**Recusado por enquanto: apagar foto/vídeo** ("se ele enviou um vídeo errado (...) dar a
chance para ele apagar", Emanuel, 24/10). Esbarra na regra "evidência é prova: não se
apaga" (055). A saída prevista na própria regra é **ocultar com motivo** — pergunta em
aberto com o Emanuel.

### D-204 · Quem enviou a foto ou o vídeo errado apaga de verdade (127)

*"se ele enviou um vídeo errado também precisa dar a chance para ele apagar o vídeo ou a
foto do contrato"* · *"Quero que o técnico apague de verdade a foto ou vídeo errado, sem
guardar o arquivo"* — Emanuel, 24/10.

**Muda a regra da 055** ("evidência é prova: não se apaga"; a saída prevista era ocultar
com motivo). Ocultar foi oferecido e **recusado** pelo Emanuel: o arquivo sai do bucket e
a linha sai da tabela.

**O que continua de pé:** só QUEM ENVIOU apaga (`evidencia.usuario_id = auth.uid()`); o
campo só no contrato de hoje (a trava do anexo); o histórico do contrato registra
`EVIDENCIA_APAGADA` (foto/vídeo, quando foi enviada, quem apagou) sem caminho nem arquivo —
sumir sem rastro deixaria a auditoria sem saber que existiu.

**Dois passos, nesta ordem.** O Supabase proíbe apagar `storage.objects` pelo SQL
(gatilho `protect_delete`); o arquivo só sai pela API do Storage, que obedece à policy
nova `evidencia_arquivo_apagar` (função `pode_apagar_evidencia_arquivo`, que nunca lança —
D-116). Depois `apagar_evidencia` apaga a linha, e **recusa enquanto o arquivo existir**:
nunca sobra arquivo guardado sem linha. Rede caiu entre os dois → a linha fica e o botão
continua; tocar de novo termina.

`testar_campo` 27/27 (2 cenários novos: apagar a de OUTRO → barrado; apagar a SUA → some e
deixa 1 evento); `testar_policies` 26/26. A policy do Storage foi conferida pela função
como o técnico (as 4 evidências de 24/10, todas dele, liberadas); o apagar pelo Storage
de verdade NÃO foi exercitado (só pelo celular).

Achado de passagem: o bucket tem 9 arquivos e a tabela 4 linhas — 5 fotos órfãs da limpeza
de 17/10 (já listadas no estado do projeto).

### D-205 · A baixa automática vale para o contrato que o campo não baixou; e sem o vai-e-volta (128)

*"227087686 — esse contrato já foi encerrado e ainda está em execução no app do técnico e
site (...) acho que é devido à regra de tocada pelo campo"* — Emanuel, 24/10.

**Defeito 1 (o 227087686).** Tocado pelo campo (suporte às 12:45), o contrato tinha o
STATUS espelhado do TOA ("concluído" → Em execução) mas a BAIXA AUTOMÁTICA pulada
(`not v_bloqueada`). O TOA fechou com 409 nas duas O.S., ninguém deu baixa da AFLINE, e ele
ficaria em execução para sempre — deixando o técnico com 2 ativos. Esse ramo também não
atualizava início/fim nem a linha do TOA (o banco dizia "pendente"/15:00; o arquivo das
13:08, concluído 12:34–12:48). **Decisão do Emanuel:** a baixa automática vale para o
contrato que o campo **não baixou**; se alguma O.S. tem baixa da AFLINE, continua protegido
(D-006). Era o único preso desde 01/09; fechado na hora com o evento de sempre.

**Defeito 2 (223471716 e todo concluído sem toque).** Cada importação gravava "concluído" →
Em execução e, no mesmo instante, a baixa automática voltava para Concluída: **2 eventos e 2
avisos ao técnico por sincronização** (11:56, 12:56, 13:03, 13:06). Também com status
"iniciado" de quem reabriu no TOA. Como a baixa automática no fim SEMPRE leva à situação do
código quando todas as O.S. têm código, a situação do código é gravada desde a primeira
escrita. Ensaio (reimportação inteira das 13:06, desfeita): **1 evento** — o conserto do
227087686 — contra 11 antes, e nenhum outro contrato mudou.

### D-206 · "Você tem 2 contratos em andamento" — no sino, sem mexer em nada (129)

*"tem que deixar apenas 1 contrato com status (...) ou então sinalizar o técnico no app
(...) no app do técnico também deve ser um sininho de notificações"* — Emanuel, 24/10.
Escolha: **avisar**, nada muda sozinho.

A trava 095 barra todo mundo menos a importação. Quando a IMPORTAÇÃO deixa o técnico (ou a
equipe sem técnico) com mais de um contrato em deslocamento/execução, um gatilho AFTER
grava um **aviso** (DOIS_ATIVOS, urgente) para a equipe e um **sinal** na central, vigente
enquanto continuar. Uma vez por conjunto de contratos (chave), não a cada sincronização.
Mesma conta da trava (fora jornada e o fechado-e-não-tocado). Erro aqui vira warning, não
derruba a importação. Ensaio desfeito: 2 sinais/2 avisos com o texto contando 2 e 3
contratos; reimportar não repetiu.

**O sino do app.** Os avisos saíram da agenda (8 cartões grandes no print) para um sino no
cabeçalho com o número de não lidos. Na agenda ficam só os urgentes (a operadora cancelou —
não vá; 2 em andamento).

### D-207 · Geo-Rota: os contratos no mapa, os colegas por perto e a conversa entre técnicos (130)

*"um novo menu chamado Geo - Rota (...) onde cada contrato caiu pra ele no mapa (...) por
cores (...) mostrar os outros colegas (...) pedir ajuda de alguém próximo ou pedir algum
equipamento (...) mandar mensagem direto pra esse amigo"* — Emanuel, 24/10.

**Muda a regra 096 ("só a gestão lê o rastro")**, dentro do que o Emanuel escolheu:
- o técnico vê só a **última posição** (nunca a trilha) dos colegas da **mesma cidade**, em
  **rota hoje** (contrato produtivo aberto), vista há **até 30 min**, ponto real;
- e só de quem deu "Estou ciente" do **texto v2** do rastro, que diz isso. Texto novo =
  versão nova (096): todos dão ciência de novo no próximo login.
A trilha continua só da gestão; a leitura passa por `colegas_por_perto` (DEFINER, 5 ms).

**Conversa entre técnicos** (`mensagem_colega`): lida pelos dois e pela gestão que vê a
equipe de um deles (escolha do Emanuel). Escreve-se só por `enviar_ao_colega` (autor pelo
servidor, mesma cidade). Realtime filtrado por destinatário. Testado como o Nicacio
(desfeito): sem ciência v2 o colega não aparece; com, aparece; o técnico não lê
`rastro_ponto`; um terceiro técnico não lê a conversa.

**O mapa é peça nativa** (`react-native-maps` 1.27.2). O APK 0.3.0 não tem: a tela só
carrega o mapa no Expo Go e no APK 0.4.0+ (`temMapaNativo`, pela runtime); no 0.3.0 mostra
a lista de colegas e o recado de atualizar. Assim a atualização pelo ar não derruba o APK
antigo. **Falta para o APK 0.4.0:** a chave do Google Maps para Android no `app.json`.

**Ainda não feito:** a tela da web para a gestão ler a conversa entre técnicos (o banco já
deixa).

### D-208 · Clicar no card de TEC1 mostra quem perdeu, e por quê

*"ao clicar no card do TEC1 em nosso site, o sistema deve aparecer o técnico que perdeu,
janela, hora início e fim, cód de baixa, supervisor ofensor"* — Emanuel, 24/10.

O card do Dashboard abre a lista das O.S. fora do padrão: técnico (matrícula, equipe),
supervisor (o do técnico; sem ele, o da equipe; sem os dois, "não definido"), contrato e
O.S., janela, início e fim, **quanto o fim passou da janela** (a diferença, não o veredito —
a tolerância e o expurgo já estão na classe que vem do banco, D-187), e o código de baixa da
operadora (e o da AFLINE quando difere). No topo, a contagem **por supervisor**.

A lista sai do **mesmo conjunto** que o card conta (as O.S. das visitas produtivas
filtradas, `tec1_ao_vivo`): conferido no navegador, card "2" e lista com 2. Abre por portal
em `.sup-controle` — a primeira versão abriu recortada dentro do card (o `transform` da
animação, a armadilha da D-169/D-173).

### D-209 · Desatribuído e Cancelado pela central: menus pela ORIGEM do cancelamento

*"temos que adicionar outro menu chamado desatribuído (...) se ele for importado no novo
relatório e o contrato não existe mais deve ir pra aí como desatribuído 800, contrato com
status cancelados pela central no TOA devem ir para o menu cancelados pela central, e o
restante dos outros status permanecem, eu preciso saber a origem"* · *"adiciona também no
dashboard"* — Emanuel, 24/10. Desatribuído é **só o 800** (escolha do Emanuel).

**Não é situação nova no banco**: os três continuam `CANCELADA` (pontos, TEC1, relatórios e a
trava terminal não mudam). A tela separa pela origem, que o dado já diz
(`origemCancelada` em `lib/filtroContratos.ts`, uma regra para Serviços, Equipes e
Dashboard): baixa da AFLINE com 800 → **Desatribuído**; "Status da Atividade" = cancelado
→ **Cancelado pela central**; o resto (302, 301…) segue **Cancelada**. A linha do contrato
escreve a origem embaixo da situação. Nos 7 dias até 24/10: 86 / 126 / 75. Em 24/10 o
"Cancelada 21" virou 2 + 16 + 3 (mesmos 21), conferido no Dashboard e em Serviços.

### D-210 · Placar do dia na agenda e o APK 0.4.0 (mapa do Geo-Rota)

*"nessa tela principal é bom mostrar a pontuação do dia de hoje também e a produtividade
do dia, com relação aos contratos que não foram feitos, expurgando desatribuído e
cancelado"* — Emanuel, 24/10.

**Placar do dia** (cartão acima da produção do mês, do dia escolhido na agenda): pontos dos
contratos **concluídos** (sem regra conta à parte, D-117) e produtividade = concluídos ÷
(contratos do dia − **cancelados**: desatribuído, pela central e por código). Reagendado e
em aberto contam como "não feito". "Cancelado" foi lido como TODO cancelado — se o
cancelado por código tiver de contar como não feito, é uma linha.

**APK 0.4.0.** O mapa (`react-native-maps`) é peça nativa: só chega com APK novo. A chave do
Google Maps para Android **não vai para o Git** — mesmo caminho da chave da web: `app.config.js`
lê `GOOGLE_MAPS_ANDROID_KEY` do `campo/.env` (local) ou da variável **sensível** do ambiente
`preview` da EAS (o perfil `preview` passou a declarar `environment: preview`). Build sem a
chave falha no `app.config.js`, em vez de sair APK com o mapa em branco. Chave criada no
projeto `amazing-coast-h9v0l`, separada da "Browser key" (que é de navegador e libera 26
APIs); a restrição a Maps SDK for Android + pacote + SHA-1 é no Google Cloud.
No mesmo APK, as correções pendentes do SDK 57 (`expo` 57.0.21 → 57.0.31, camera,
location, task-manager…) — a aposta para o fechamento no Android novo do S24 Ultra.
**Consequência:** a política de runtime é a versão do app; atualização pelo ar publicada
daqui em diante vai para o 0.4.0, e quem ficar no 0.3.0 para de receber.

### D-211 · Os números obedecem ao filtro: etiquetas de Serviços e painel de Equipes (131)

*"quando eu filtrar os resultados de TODOS, EM ABERTO, NA ENTRADA devem mudar,
atualmente esse numero não muda, tem que alterar no menu serv, equipes e no dashboard
quando mudar o filtro os valores na tela tem que alterar onde tiver informações"* —
Emanuel, 24/10, com o print de Serviços: "2 buckets" marcados e a etiqueta "Todas 223".

**Serviços.** As etiquetas de situação (Todas, Em aberto, Na entrada…) e a barra de
composição contavam sobre a lista sem filtro; só a tabela era filtrada. Agora contam
com **todos os filtros menos o da própria situação** — com ele, clicar em "Concluída"
zeraria as outras etiquetas e não daria para ver para onde ir. De passagem: a página
da tabela voltava à 1 em quase todo filtro, mas não em tecnologia, bucket, segmento e
ouvidoria; agora volta em todos.

**Equipes.** O filtro de contrato só escolhia QUAIS equipes apareciam; contratos, O.S.,
períodos, situação, pontos, TEC1, tempos e última baixa de cada equipe seguiam do dia
inteiro (e uma nota dizia isso). Agora a tela manda ao banco os contratos que passaram
e **`painel_equipes(p_data, p_visitas)`** (131) recalcula **com eles** — a mesma
função, a mesma regra. Recalcular na tela seria uma segunda conta de TEC1 e pontos
para divergir da primeira. A jornada não é filtrada (o filtro é de contrato, e ela
explica por que a equipe parou). "N de M equipes com serviço" e "Ociosas" contam o
filtrado; técnicos, sem técnico e fora do cadastro são do cadastro e não mudam.

- Sem filtro, a função nova devolve **exatamente** o que a antiga devolvia (md5 do
  painel de hoje igual: 85 equipes, 223 contratos).
- Como `authenticated`: dia inteiro 771 ms; só a VT (71 contratos) 196 ms.
- Assinatura com default não convive com a antiga: a de 1 argumento saiu; a recriada
  teve `revoke` do `anon` (conferido). Monitor e Equipes sem filtro chamam igual.
- A tela espera 250 ms antes de recalcular (quem marca três filtros seguidos não
  dispara três cálculos) e escreve "Recalculando…" até chegar.

**Dashboard: já obedecia.** Desde a correção da matriz (20/10), régua, matriz e
gráficos saem da lista filtrada — conferido no código; nada mudou nele agora.

### D-212 · A logo nova: ícone do app, abertura nativa e a tela de entrada animada

*"altere o ícone de entrada (...) a tela principal do app precisa ser remodelada, de acordo
com a logo, deve ter efeitos antes de entrar, e animações quando estiver fazendo o login (...)
altere também a foto do ícone do celular"* — Emanuel, 25/10, com a logo reformulada
(selo grafite, "AF" vermelho, "LINE" branco, WebP 1024×1024).

**Os ícones eram os padrão do Expo** (o "A" azul) desde o começo — nunca tinham sido
trocados. Agora saem da logo (`campo/assets/logo-afline.png`, a fonte), gerados com PIL:
`icon.png` (a logo inteira), `marca-afline.png` (a marca dentro do app) e o **ícone
adaptativo do Android** em duas camadas — fundo = o degradê grafite medido na logo, frente
= só as letras com transparência e sombra curta, dentro do círculo seguro (66 dp de 108):
a 1ª tentativa, com 64% da camada, era cortada pelo círculo do launcher; a 2ª, recortando o
miolo do selo, deixava um quadrado mais claro atrás. Monocromático (ícone temático do
Android 13+) em branco chapado; a perna fina do A ainda falha nele.

**Abertura nativa escura** (`expo-splash-screen`, só configuração — nenhum JavaScript chama
o módulo, então a atualização pelo ar continua segura no APK 0.4.0 de hoje): sem ela, a
abertura do Android era branca e passava um clarão antes da tela escura.

**Tela de entrada** com o grafite da logo e um clarão vermelho difuso; a logo nasce com
salto, dois anéis vermelhos se espalham, um brilho atravessa a logo, e ela sobe para o
formulário aparecer. Ao entrar, um arco vermelho gira em volta da logo e ela pulsa; erro
balança o cartão. **O formulário fica num cartão branco** com os campos claros do app
(D-011: no sol, tela escura vira espelho) — o escuro é a marca, vista uma vez por dia.
Só `Animated` do React Native, no thread nativo (sem biblioteca nova); "reduzir movimento"
do celular encurta a abertura e tira os pulsos.

**O ícone e a abertura são nativos: só chegam com APK novo.** A tela de entrada chega pelo ar.

### D-213 · Ver o que subiu, mandar da galeria, chat direcionado e cache com teto (132, app 0.5.0)

*"a foto ou o vídeo (...) o técnico poderá assistir ele no app (...) as fotos e vídeos
precisam da opção pra ele enviar da galeria (...) o nosso app tem que ser contra a fraude
(...) separado, miscelânea e EMTA (...) o técnico poderá escolher para qual usuário mandar
mensagem (...) técnico, ou COP, supervisor e coordenador (...) limite o cache"* — Emanuel, 25/10.

- **Visor:** tocar na miniatura abre a foto ou toca o vídeo (`expo-video`, player nativo),
  direto da URL assinada — sem cópia no celular. A ficha diz hora, GPS e se veio da galeria.
- **Galeria** (`expo-image-picker`): sobe marcada `evidencia.da_galeria`, com a hora e o GPS
  **do arquivo** (EXIF) quando ele traz e **nulos** quando não traz — o GPS do celular agora
  diria que a foto foi tirada aqui, e isso é mentira. O site mostra "da galeria" na
  evidência. Nenhuma regra de bloqueio foi inventada (ex.: "só foto de hoje") — pergunta
  aberta ao Emanuel. GPS simulado continua pausando o app inteiro (D-171), galeria inclusa.
- **No TOA:** Equipamento e Miscelânea em blocos separados dentro de Instalado/Retirado.
- **Chat com destinatário:** a conversa segue UMA por técnico (a caixa que o site já usa);
  cada mensagem do campo leva `mensagem.para_usuario_id` — nulo = o controle todo; ou uma
  pessoa de COP, supervisão ou coordenação (`destinatarios_do_campo`: grupo pelo cargo ou
  perfil de acesso, só quem acessa a cidade do técnico). No site, "para você" em destaque.
  Técnico com técnico: a conversa entre colegas (130), agora com a lista da cidade inteira
  (`tecnicos_da_cidade`), não só os de perto. Em 25/10: 2 coordenadores, nenhum COP nem
  supervisor cadastrado (o grupo vazio diz isso).
- **Cache com teto:** o arquivo que subiu sai do cache na hora; a faxina da abertura tira o
  que passou de 3 dias e põe teto de 250 MB (para 150 MB, os mais velhos primeiro) —
  **nunca** o que está na fila sem sinal. A galeria do técnico nunca é tocada.
- `registrar_evidencia` (+`p_galeria`) e `enviar_mensagem` (+`p_para`) recriadas sem a versão
  antiga (traps.md: as duas juntas ficam ambíguas), ACL fechada. Baterias 27/27 e 26/26.

**APK 0.5.0** (player e galeria são nativos): a atualização pelo ar passa a ir só para o 0.5.0.
O 0.4.0 de ontem não precisa ser instalado — vai direto o 0.5.0.

**Armadilha pega antes do build:** `cameraPermission: false` no plugin do `expo-image-picker`
**bloqueia a CAMERA (e `microphonePermission: false`, o RECORD_AUDIO) do app inteiro** — o
APK sairia sem câmera. Conferido nas permissões resolvidas pelo `expo config`.

### D-214 · O controle também escolhe com quem fala, e a tela de responder (133)

*"Vamos adicionar além do técnico pessoas de outros setores (...) cada usuário vai poder
escolher isso (...) da parte do técnico já vi que está ok, falta agora do controlador"* —
Emanuel, 25/10. A 132 deu a escolha ao campo; esta dá a mesma escolha a quem está no site.

- **Quem aparece:** o MESMO grupo que o técnico escolhe — COP, supervisor e coordenador —
  da **cidade ativa**. Escolhido pelo Emanuel entre "todo mundo da cidade (todos os
  setores)" e "qualquer cidade", que foram oferecidas e recusadas.
- **Quem lê:** **só as duas pessoas**. A outra opção ("as duas e o ADMIN") foi oferecida e
  recusada. É por isso que a conversa entre pessoas é **tabela nova** (`mensagem_interna`) e
  não `mensagem` com `tecnico_id` nulo: lá a policy abre a conversa para todo controlador
  que enxerga a equipe (091) — certo para o turno, errado para duas pessoas. Aqui nem o
  ADMIN lê; o RLS não tem exceção para ele. Sem policy de INSERT: quem escreve é a RPC, que
  carimba o autor (D-061).
- **Responder sempre pode**, mesmo que o remetente não esteja na lista de quem responde —
  senão o ADMIN sem cargo abriria conversa sem volta. **Abrir** é que é restrito.
- A classificação de grupo saiu de dentro de `destinatarios_do_campo` e virou
  `grupo_interno(usuario)`: uma regra, dois lugares que perguntam (campo e controle). Antes
  de mudar o de/para de cargo, lembre que ele vale para as duas telas.
- O balão do topo passa a contar as duas caixas; o Realtime de `mensagem_interna` respeita
  o RLS, então só chega a quem já podia ler. Baterias 26/26 e 27/27.

**Diretor e gerente ficam FORA do chat** — *"Márcio é GERENTE e ALISSON é o Diretor, eles
não podem aparecer no chat, não faz sentido, agora eles podem visualizar as outras pessoas e
enviar mensagem se quiserem (...) no aplicativo também o técnico não pode visualizar os
dois"* (Emanuel, 25/10). Os dois cargos não existiam no cadastro e as duas pessoas estavam
como COORDENADOR — era por isso que apareciam. `grupo_interno` não classifica DIRETOR nem
GERENTE: sem grupo, o nome não entra em lista nenhuma, no site nem no aplicativo. **Escrever
continua podendo** (são ADMIN, e quem recebe sempre responde). Consequência honesta de hoje:
**a lista de Pessoas está vazia** até alguém ser cadastrado como COP, supervisor ou
coordenador — e a tela diz isso, em vez de mostrar lista vazia sem explicação.

**A tela de responder** — *"é importante ver as duas últimas atualizações do histórico do
contrato para poder o controlador responder (...) essa resposta não tá muito clara"* e
*"podemos fazer algo parecido (...) onde ver as fotos e histórico das conversas em uma única
tela"* (Emanuel, 25/10).

- O bloco **Responder ao técnico** passa a trazer **as duas últimas atualizações do
  histórico** em cima do formulário — antes só destacava o ticket de suporte, e só quando o
  contrato estava nele. Responder sem o que acabou de acontecer é responder no escuro.
- Aba **Responder**: resposta + conversa com o técnico embutida de um lado; fotos e
  histórico do outro. Eram quatro telas para uma decisão (impedimento no Detalhe, foto em
  Anexos, resposta no Detalhe, conversa na gaveta por cima). A conversa embutida é a MESMA
  da gaveta (091) — não é um canal do contrato; mensagem não tem dono de contrato, e
  inventar um criaria duas caixas que divergem.
- Aba **Equipamento**: *"podemos tirar também essa parte do equipamento e miscelânea e criar
  um menu pra ele, pra ganharmos mais informações do contrato"*. Vale na página cheia **e**
  na janela do contrato — contrato que muda de forma conforme a tela em que se olha confunde.

**O LOGIN da equipe é o do técnico, e só** — *"deixa somente o login cadastrado que está no
usuário dele, não sei por que você foi colocando outros cadastrados"* (Emanuel, 25/10). O
cartão listava TODO login que roteou contrato para a equipe no dia, com etiqueta de origem:
numa dupla que cobriu colega viravam quatro logins embaixo de um nome só, e "cadastrado"
repetia o que o cadastro já afirma. Agora é a matrícula de quem está cadastrado na equipe. O
login sem dono continua visível onde importa: na equipe **Sem login definido**.

### D-215 · O que sumiu do TOA em andamento não se mexe (134)

*"quando um contrato estiver em deslocamento (...) e depois há uma nova importação e esse
contrato some da planilha, nós não devemos mexer nesse status. Alguém precisa ir lá ver o
que aconteceu (...) significa que aconteceu alguma manipulação no TOA (...) precisa ser
corrigido manualmente pelo técnico ou pelo controlador"* — Emanuel, 25/10.

**Metade disso já era verdade:** a 116 (D-191) só desatribui contrato **Na entrada** e que o
campo não tocou — *"so pode desatribuir contratos que tiverem em entrada, em outro status
não pode"* (Emanuel, 19/10). O que faltava era o sistema **dizer** que o contrato sumiu: ele
ficava parado na tela, com a hora velha, e ninguém sabia que a planilha deixou de trazê-lo.

- `visita.sumiu_do_toa_em` + evento `CONFLITO_TOA` + **aviso ao técnico** no sino + **sinal**
  na central (`SUMIU_TOA`, nos dois CHECK — lista fechada pega tipo novo, `traps.md`).
- **Nenhuma situação muda, nenhuma baixa é dada.** O sistema não sabe o que aconteceu no
  TOA, e fingir que sabe é pior que pedir que alguém olhe (regra 6).
- Em andamento = `ATRIBUIDA`, `EM_DESLOCAMENTO`, `EM_EXECUCAO`, `COM_IMPEDIMENTO`. Terminal
  some da planilha o tempo todo e isso é normal — não acusa.
- A marca sai sozinha: quando o contrato **volta** à planilha, ou quando alguém **corrige o
  status à mão** (gatilho `limpar_sumiu_do_toa`, que ignora o que a própria importação faz).

Provado em transação desfeita: situação intacta (`EM_EXECUCAO`), marca, evento e aviso
criados, e a correção manual limpando a marca.

### D-216 · Onde o técnico estava na baixa — e o dado do TOA que NÃO servia (135)

*"é interessante o nosso sistema puxar pela localização do celular dele onde ele estava (...)
toda baixa do técnico tem que ser num raio de 200 metros da casa do cliente"* — Emanuel, 25/10.

O raio de 200 m existe desde a 096 (D-170), mas só enxergava a baixa feita **pelo celular**.
A baixa feita no TOA — a maioria hoje — ficava "sem registro do campo".

**O que o dado desmentiu.** A planilha traz `Foto - Justificativa Geolocalizacao` com a
coordenada que o **próprio TOA** capturou: `capture_image.jpg, 105KB, -3.10951x-60.06642`.
Parecia a resposta pronta — a CLARO medindo por nós. Medido em **615 visitas de 7 dias**:
**607 a mais de 200 m** do cliente, média de **3,7 km**, e as observações do técnico dizem
*"a caminho"* (95), *"em deslocamento"* (58), *"trânsito"* (19). É a justificativa **do
deslocamento**, não da baixa. Usá-la como local da baixa acusaria a operação inteira de
baixar longe, com um dado que não fala disso. Ela virou **dado próprio** na tela, com o texto
do técnico e a frase que explica o que é.

**O local da baixa passou a ter duas fontes, nesta ordem:**
1. **APP** — registro do campo com GPS (como já era: vale o mais longe do endereço);
2. **RASTRO** — o ponto do rastro mais próximo da hora do `fim` do TOA, dentro de
   `rastro_baixa_tolerancia_min` (10 min, parâmetro), **e só quando `finalizado_toa`**
   (D-103: `fim` vem preenchido até em atividade só INICIADA).

Sem nenhuma das duas não há linha — e "sem leitura" nunca é "dentro do raio". O selo diz a
fonte. **Cobertura hoje: 4 de 1.424 baixas** (o rastro tem 58 pontos, de 1 técnico); cresce
quando o APK estiver no campo e os técnicos derem ciência.

**De onde a foto foi enviada.** `evidencia.envio_lat/lng/precisao`: o app manda a posição do
celular no instante do envio, para câmera **e** galeria. É outra pergunta que `lat/lng` (onde
a foto foi **tirada**) — da galeria, a do arquivo pode ser de outro dia ou não existir. Juntar
as duas faria a foto da galeria mentir o lugar. *"ainda assim o sistema deve pegar a
localização de onde ele está enviando aquelas fotos"* (Emanuel, 25/10).

### D-217 · A prova do contrato, a pontuação e o expurgo (136, 137)

*"ele precisa enviar 3 evidências em cada contrato concluído para gerar pontuação para ele
(...) vai gerar pontuação apenas para a empresa, para o controlador COP, mas para o técnico
individual no aplicativo não deve ser gerado"* — Emanuel, 25/10.

**Decisões dele nesta sessão** (as outras opções foram oferecidas e recusadas):

| O quê | Escolha | O que foi recusado |
|---|---|---|
| O que conta | **3 arquivos** (foto ou vídeo) por **contrato** | 3 por O.S.; só fotos; 3 de tipos diferentes |
| Prazo para anexar | **até o fim do dia seguinte** (parâmetro) | manter a trava do dia; liberação caso a caso |
| Galeria longe do cliente | **conta, e fica marcada** | não contar; travar o envio |
| Expurgo do ADMIN | **o admin escolhe o escopo a cada lote** | sempre só do técnico; sempre de todos |
| Cancelado / reagendado | **1 evidência** para parar de cobrar | 3, igual ao concluído; não cobrar |
| Quando começa | **dos contratos novos em diante** (D-217b) | valer já, inclusive para trás |

- A conta da **empresa não muda**: o serviço foi feito e é faturado. O que muda é a conta do
  **técnico** — `producao_por_tecnico`, que é **uma só** e alimenta painel, ranking e central
  (D-167). Só o expurgo com escopo **TODOS** mexe na conta da empresa.
- **O prazo mudou uma das quatro travas do campo** (D-114): anexar **evidência** vai até o fim
  do dia seguinte; baixar, mudar status, equipamento e contato continuam no dia.
  `pode_anexar_na_visita` ganhou `p_evidencia` e a bateria do campo foi de 27 para **29
  cenários** — o cenário antigo *"anexa em contrato de ONTEM → barrado"* passou a estar
  errado, e virou três (no prazo → permitido; equipamento de ontem → barrado; anteontem →
  barrado). Teste que falha quando a regra muda é teste funcionando.
- **Expurgo por lote de WOs** (`expurgo_pontuacao`): aceita a WO inteira, só o número depois
  do `|`, o contrato ou o ID da atividade, e **diz o que não encontrou**. Motivo obrigatório
  (D-030). Devolver **carimba o desfazimento**; nada se apaga. Medido: 52,9076 pts no dia →
  51,4428 com escopo TODOS → 52,9076 na devolução.
- Os pontos que esperam foto **não viram zero**: viram `pontos_sem_prova`, com o prazo escrito
  (regra 6). O painel do técnico mostra os dois, e o gráfico por dia soma o mesmo que o total
  — a mesma tela não pode se contradizer (D-150).

**Apagar continua só no dia** — *"isso só vale para o dia ok"* (Emanuel, 25/10), decidido
depois de a pergunta ser levantada. Anexar ganhou prazo; **apagar não**. É assimétrico de
propósito: anexar acrescenta prova, apagar tira — e prova que se apaga no dia seguinte é
prova fraca. `apagar_evidencia` chama `pode_anexar_na_visita` **sem** `p_evidencia`, então o
campo só apaga no mesmo dia; e a trava do autor (D-204) continua valendo para todo mundo,
inclusive para o controlador.

Consequência, escrita aqui para ninguém ser pego de surpresa: **foto errada anexada no dia
seguinte não se apaga por ninguém pela tela** — nem pelo técnico (fora do dia), nem pela
gestão (não é a autora). A saída é a que o próprio Emanuel pediu na mesma conversa: o
**expurgo da pontuação pelo ADMIN**, por WO, com motivo — *"o técnico anexou foto de uma
coisa, mas era de outra"*. O arquivo fica, o ponto sai, e o porquê fica escrito.

**D-217b · a regra vale dos contratos novos em diante.** *"deixa como estava, a regra
funcionará a partir de novos contratos baixados"* (Emanuel, 25/10), **mudando a decisão da
136**, que valia já. Sem corte, a regra apagava o passado: medido, **1.296 concluídos em 7
dias, nenhum com 3 evidências** — o ranking inteiro iria a zero por trabalho feito sob outra
regra. O corte é o **dia de atuação** (`evidencia_obriga_desde`, nasce em amanhã); antes dele
a tela também **não cobra** prova, porque cobrar o que não muda nada é ruído.

### D-218 · Relógio do serviço, AUDITAR, Entregas e a cor do selo (138)

Cinco pedidos do Emanuel em 25/10, de uma vez:

**1. O relógio do serviço.** *"a gente pode colocar um relógio de tempo, onde começa a marcar
o tempo de deslocamento do técnico (...) o tempo de em execução, quando ele começa a iniciar
um trabalho o relógio deve aparecer"*. Fica na coluna do contrato, ao lado do segmento —
*"é onde estou vendo espaço"*.

- **A meta é da EXECUÇÃO** (chegou → encerrou), escolha dele entre três opções. ADESÃO 90,
  VISITA TÉCNICA 50, MUDANÇA DE ENDEREÇO 100, MIGRAÇÃO GPON 90. **PACOTE (30) ficou de fora:
  não existe grupo com esse nome** — os 8 de hoje são ADESAO, VISITA TECNICA, SERVICO,
  MIGRACAO GPON, RETORNO DE CREDENCIADA, MUDANCA DE ENDERECO, REINSTALACAO e DESCONEXAO.
- **O deslocamento tem relógio, mas não tem meta.** Distância na cidade varia demais para um
  número só, e ninguém definiu um. O relógio conta e cala — não acusa.
- **Em andamento conta sozinho** (atualiza a cada 30 s, desde `inicio` do TOA ou, sem ele, da
  hora em que a situação mudou). **Encerrado congela** no tempo medido pelo TOA (`fim −
  início`), que é o mesmo número do painel de Equipes: duas telas com o mesmo nome têm de dar
  o mesmo número.
- Verde até 80% da meta, âmbar até estourar, vermelho depois. **Sem meta o relógio aparece
  igual, em cinza** — "sem meta" é diferente de "dentro da meta" (regra 6).
- A meta é **cadastro** (`tipo_servico.meta_execucao_min`), em Configurações › Tipo de
  serviço. Precisou de RPC (`definir_meta_execucao`): os 8 grupos são globais
  (`empresa_id is null`) e a policy do ADMIN só alcança o que é da empresa — um UPDATE direto
  salvaria **zero linhas em silêncio**.

**2. "Desatribuído" virou AUDITAR.** *"esse status serve para verificar o que houve de fato
com ele"*. Só o rótulo muda, por decisão dele: o **código de baixa 800 continua
"Desatribuído"** no cadastro, porque é ele que explica o que aconteceu (sumiu da planilha).
A cor saiu do cinza para o âmbar — o status agora pede **ação** de alguém, e cinza apagado
não pede nada. Vale em todas as telas que leem `infoSituacaoDeTela`, e no resultado da
importação.

**3. "Romaneios" virou "Entregas"**, na web e no aplicativo — palavra que se entende de
primeira. O documento continua `romaneio` no banco: é o termo do almoxarifado, e trocar o
domínio por causa de um rótulo seria caro e inútil.

**4. O selo do menu em azul.** *"se é azul a cor com status em aberto deve ser azul o
número"*. O contador de Serviços conta contratos **em aberto**, e em aberto é azul
(`--st-execucao`) na tela inteira; pintá-lo com o vermelho da marca fazia parecer alerta.

**5. A importação passou a dizer o que sumiu EM ANDAMENTO** (134) no mesmo lugar onde já
dizia o que foi desatribuído — antes o número existia só no banco.

### D-219 · Um ícone por problema, e o sino com o resto (139)

*"temos o símbolo da mensagem para receber mensagem do técnico que estiver precisando de
ajuda. Temos um sino que ele é geral (...) é bom a gente criar mais uns 3 a 4 ícones para
sinalizar os problemas diferentes. Por exemplo, baixou o contrato longe do cliente, perdeu
TEC1, atendimento dentro da janela, técnicos atrasados, técnicos de baixa produtividade no
dia"* — Emanuel, 25/10.

**Dos cinco que ele citou, três já eram sinal.** TEC1 **é** a aderência à janela — ele
confirmou que "atendimento dentro da janela" e "perdeu TEC1" são a mesma coisa, então é um
ícone só. RITMO já existia. Faltavam dois, e os dois já eram **dado sem virar aviso**:

- **LOCAL** — a baixa saiu fora do raio de 200 m. O número estava em `local_da_baixa` desde
  setembro (096, D-170), e alguém tinha de abrir contrato por contrato para achar.
- **ATRASO** — a janela está acabando e o técnico não chegou. Entre três definições, ele
  escolheu avisar **enquanto ainda dá tempo de ligar para ele**: 30 min antes do fim da
  janela (`atraso_antecedencia_min`). Chegou = está Em execução ou já encerrou — e aí o sinal
  apaga sozinho.

**O sino passa a contar só o resto** (suporte, GPS, cerca, material, abastecimento, dois
ativos, sumiu do TOA), por decisão dele: cada coisa conta num lugar só, e a soma da barra
bate. Os quatro ícones abrem **o mesmo painel**, filtrado no assunto — não é tela nova, é a
mesma lista com um título.

**Defeito achado no caminho:** o tipo `Sinal['tipo']` do front estava quatro tipos atrás do
banco (`DOIS_ATIVOS` desde a 129, `SUMIU_TOA` desde a 134). Sinal sem rótulo e sem cor
aparecia em branco no painel — e ninguém tinha percebido porque os dois são raros. Agora os
doze tipos estão na lista. **Tipo novo no banco entra no front no mesmo dia.**

### D-220 · Indicadores, e o primeiro deles: Primeira WO (140)

*"criei abaixo do Meta técnica um menu chamado Indicadores. Vamos começar com o primeiro
indicador, que se chama Primeira WO (...) o primeiro contrato que o técnico chegou na casa do
cliente (...) a meta para esse indicador é 8 e vinte (...) mostrar uma tabela de todos os
técnicos, quem é que mais chega atrasado, fazer gráficos dos 10 piores, para que o
coordenador possa atuar (...) já deve mapear para trás"* — Emanuel, 25/10.

**O que marca a chegada: `visita.inicio`, a hora do TOA.** É a única fonte que existe **para
trás** — o aplicativo começou agora e o evento de chegada dele não tem histórico. Lida em
horário de Manaus; em UTC as 20h daqui já são o dia seguinte (traps.md).

**O que é "contrato real": natureza PRODUTIVA e com número de contrato.** Derivado do dado,
não de uma lista escrita à mão — e por isso pega sozinho os dois casos sujos do cadastro:
`Refeicao.` (com ponto, cadastrada como PRODUTIVA por engano) e `Corte no Drop`, que vem sem
contrato. Jornada, refeição, apoio a outro técnico e almoxarifado já ficavam de fora pela
natureza.

**Dia sem atendimento não entra.** Folga não é atraso. A tela mostra **quantos dias** cada um
tem ao lado do número, porque dois dias ruins não são o mesmo problema que dez.

**O atraso médio conta só os dias fora da meta.** Quem chegou 07:58 num dia não "compensa" o
dia em que chegou 09:14: média de sinal trocado esconde exatamente quem o coordenador
precisa ver.

**Medido antes de escrever a tela**, em 14 dias: **377 dias-técnico, 65 técnicos, chegada
média 08:39, 40,1% dentro da meta**, o mais cedo 07:58, o mais tarde 15:09. A meta das 08:20
é parâmetro (`primeira_wo_meta`), não constante.

A tela nasce com **uma aba só** e o lugar das próximas: o segundo indicador não deve virar
outra tela no menu. Clicar no técnico abre o **dia a dia** — a que horas ele chegou em cada
dia e qual contrato abriu, com link para o contrato.

### D-221 · O responsável da quebra é o da CLARO, e o painel lia mil linhas (141)

*"corrija essas duas imagens (...) improdutivas por responsabilidade e improdutivas por nossa
conta. Ela está classificando as informações incorretas. O certo é dizer exatamente de quem é
a culpa (...) essas informações estão na coluna AG e a H, responsável de quebra e agrupamento
de quebra"* — Emanuel, 25/10.

**O vocabulário passou a ser o da CLARO**, aprendido da planilha *Quebra Qualificada*:
`SEM_QUEBRA`, `SERVICOS DE CAMPO`, `COMERCIAL`, `DAC`, `REAG_CLIENTE`, `CLIENTE`,
`USO_INTERNO`, `CHUVA`. **Serviços de campo é a AFLINE** — a única que é nossa conta. O de
antes (TECNICO/CLIENTE/REDE/OPERADORA/TERCEIRO) era invenção nossa, de antes de existir a
planilha, e era o que classificava errado: o painel dizia **"100% Operadora (CLARO)" e "0 por
nossa conta"** onde a verdade, de 17 a 25/10, é **122 O.S. de Serviços de Campo**, 108 DAC, 73
Comercial.

**O que o dado mostrou, e que muda a leitura da tela: a classificação não é função do
código.** Dos 84 códigos da planilha, 68 são unânimes, mas **16 aparecem com mais de um
responsável** — o **301 com quatro** (Comercial, Serviços de Campo, DAC, Reag. Cliente) e o
106 com dois. Quem classifica é a CLARO, caso a caso, por WO. Por isso código com maioria
abaixo de 50% fica **sem classificação**, e a tela escreve "a CLARO classifica caso a caso" em
vez de escolher um. Escolher seria inventar.

> A planilha **não entra no Git**: tem contrato e login de técnico (regra 3). Ela foi usada
> como **referência** — *"é só pra você aprender os responsáveis da quebra"* —, não importada.

**Dois eixos, duas perguntas.** Responsável diz **quem paga**; o agrupamento (coluna AH) diz
**em que parte do processo quebrou**, que é o que se ataca. Virou painel próprio: em 7 dias,
70% das improdutivas são de *agendamento*.

**Motivos de improdutividade agora abrem.** *"quando o usuário clicar em cima, aparecer o
contrato, o tipo de serviço e o técnico que deu a quebra"* — clicar na barra abre a lista, com
link para cada contrato e o responsável de cada O.S.

**A primeira WO do time entrou no Tempo médio por etapa.** *"era bom saber quanto o time
inteiro se atrasou para chegar na primeira WO"* — a mesma regra do indicador (140), no filtro
que está na tela, com a meta ao lado e link para o detalhe por técnico. Deslocamento e
execução médios já estavam ali e passam a conviver com ela.

**DEFEITO ACHADO NA CONFERÊNCIA — e era grande.** Comparando a tela com o banco:
o Dashboard mostrava **742 contratos** onde o SQL do mesmo intervalo tem **2.283**. A consulta
não paginava e o PostgREST devolve no máximo **1.000 linhas** — então *todos* os números do
painel (conclusão, improdutivas, TEC1, tempos, pontos) saíam sobre um pedaço, **sem nada na
tela dizendo que faltava**. Em "Hoje" nunca apareceu porque o dia cabe. Agora pagina até
acabar; depois da correção: 1.738 contratos, 2.305 O.S. com baixa, 328 improdutivas.

**Uma lição que vale para o repositório inteiro:** consulta de tela sem `range` mente em
silêncio a partir de 1.000 linhas. Vale conferir as outras telas que leem período longo.

### D-222 · O painel da quebra no formato da CLARO (142)

*"tire o gráfico Onde a quebra aconteceu, ele não vai nos ajudar (...) preciso melhorar as
improdutivas por responsabilidade. Precisa usar a responsabilidade igual ao anexo 2 (...)
quando eu botar o mouse em cima dessas barras, a ideia é aparecer também um resumo"* —
Emanuel, 26/10.

**Os dois painéis da 141 viraram um só**, no formato que ele já usa no sistema da CLARO:
o eixo é o **agrupamento** — em que parte do processo o serviço caiu —, não o responsável.
Cada barra traz o **impacto sobre o total de UN**, o volume, a fatia das quebras e a
**variação em pontos percentuais** contra o período anterior. No mouse abre o resumo com
volume, impacto, % das quebras, o percentual anterior e os **cinco motivos** que mais pesam
dentro do agrupamento — os códigos de baixa com a contagem.

Medido em 7 dias: **AGENDAMENTO 10,20% (235 O.S.)**, sem agrupamento 3,30% (76), infra claro
0,39% (9), sem_quebra 0,30% (7), técnico 0,04% (1).

- **UN = O.S. com baixa**, o mesmo denominador do cabeçalho do painel ("328 de 2305"). Dois
  denominadores na mesma tela seria a contradição da D-150 outra vez.
- **A seta some quando há filtro na tela.** O período atual é calculado no navegador, com os
  filtros; o anterior vem agregado do banco, sem eles. Comparar os dois com filtro ligado
  seria comparar coisas diferentes e chamar de melhora.
- O resumo vai por **portal** para a raiz: dentro do cartão, um ancestral com `transform` ou
  `overflow` recortaria a caixa — foi o que aconteceu com o menu do contrato (D-169).

**Em aberto com o Emanuel: 8 códigos improdutivos sem agrupamento** — 76 O.S. em 7 dias, 23%
das quebras. Não estão na planilha de 01/10, ou a maioria dela ficou abaixo de 50%:
`301 Tipo de OS Incorreta` (23), `402 Divergência de Dados Cadastrais` (22), `110 Problema Na
Tubulação` (13), `305 Rua não cabeada` (9), `205 Falta Tap Ou Passivo` (5), `316 Rua não
cabeada GPON` (2), `206 Prédio Sem Backbone` (1), `211 Falta NAP/NAP Lotada` (1). Enquanto
ele não disser para onde vão, aparecem como **"sem agrupamento"** — a tela diz que não sabe,
em vez de empurrar para um grupo qualquer (regra 6).

### D-223 · O agrupamento de cada código, e o que NÃO é quebra (143)

*"te mandei uma lista de códigos pra você colocar nos grupos caso tenha dúvidas (...) isso é
válido somente para contratos improdutivos; concluídos, auditoria e cancelado central não
entram"* — Emanuel, 26/10, com os painéis da CLARO abertos agrupamento por agrupamento.

**O de/para passou a vir dele, não da planilha.** Os painéis são do mês inteiro e são a fonte
direta; onde os dois discordam, vale o painel. Mudaram de lugar o **302** (a planilha dava
AGENDAMENTO; o painel diz PROCESSO VENDA) e o **308** (AGENDAMENTO → INFRA CLARO).

| Agrupamento | Códigos |
|---|---|
| AGENDAMENTO | 106, 101, 125, 107, 306 |
| PROCESSO VENDA | 302, 402 |
| INFRA CLARO | 305, 316, 206, 211, 308 |
| TUBULACAO | 110 |
| INFRA CLIENTE | 303, 112 |
| CHUVA | 103 |
| TÉCNICO | 134, 850, 126 |

**Três coisas saíram da conta de quebra**, cada uma por um motivo:
- **concluído** — há código improdutivo cuja baixa termina em CONCLUIDA (570 refazer coaxial,
  582 roteador, 583 refazer óptico): o serviço saiu, e a própria CLARO marca SEM_QUEBRA;
- **auditar** — o 800 é desatribuição nossa (116), não quebra da operação. Ele tinha ganho
  INFRA CLARO da planilha e foi limpo;
- **cancelado pela central** — quem cancelou foi a central no TOA, antes de o técnico ir.

A regra vale nos dois lados: na tela (período atual, com filtros) e em `impacto_quebra`
(período anterior, agregado) — senão a variação em p.p. compararia dois universos.

Depois da troca, 7 dias: **AGENDAMENTO 7,59% (175)**, PROCESSO VENDA 3,38% (78), sem
agrupamento 1,21% (28), INFRA CLARO 1,00% (23), TUBULACAO 0,56% (13), TÉCNICO 0,04% (1) — a
mesma ordem do painel dele. As quebras caíram de 328 para **318** com as exclusões.

**Ainda sem grupo, e só ele pode dizer:** `301 Tipo de OS Incorreta` (23 O.S. em 7 dias) e
`205 Falta Tap Ou Passivo / Tap Ou Passivo Lotado` (5). Não apareceram em nenhum painel.

### D-224 · O LOG do TOA, e o relógio de deslocamento que contava a importação (144)

> *"Ao lado da área vamos colocar uma tag que tem no analítico de importação chamado - LOG
> (...) acima de 2 os log já precisam mudar de cor, de 3 pra cima já precisa ficar preto
> (...) o log pra você que não sabe é quantas vezes ele já voltou na agenda, porém a
> própria planilha já informa, é só você implantar"* — Emanuel, 26/10

**O dado já estava no banco e nunca tinha sido lido.** A coluna chama **"Contador de log"**
na planilha do TOA, e a importação sempre a guardou em `dados_origem`. Não foi preciso
migration nenhuma: o PostgREST lê a chave direto (`contador_log:dados_origem->>"Contador de
log"`), como já se fazia com `Status da Atividade`.

**Não é a nossa `reincidencia` (033), e os dois vão divergir.** A reincidência é derivação
nossa — visita anterior no mesmo contrato, *dentro do que já importamos*. O LOG é o número
da CLARO e conta o histórico inteiro dela, inclusive o que nunca passou por aqui. Os dois
ficam, cada um com o seu nome.

Distribuição medida em 26/10, nos dias carregados: **1.964 em LOG 0**, 201 em 1, 48 em 2,
6 em 3, 4 em 4, um em 5 e um em 8. A coluna vem em **2.453 das 2.460 visitas produtivas** e
em **nenhuma das 1.003 de jornada** — jornada não é contrato e não tem LOG, então ali o selo
não aparece (seria um "?" em toda linha, sem informar nada).

**Zero e desconhecido não são a mesma coisa** (regra 6): linha sem a coluna vira `log ?`,
nunca `LOG 0`. `LOG 0` é a afirmação *"nunca voltou"*. No cartão do painel isso é o
`logSemInfo`, contado à parte e fora do denominador.

**A cor é a que ele pediu:** 0, 1 e 2 em cinza discreto; **3 ou mais em preto**. O preto é
fixo, não variável de tema — o recado é o mesmo no claro e no escuro. Medido com o motor do
navegador: branco sobre preto dá 21:1, mas **o chip preto contra o cartão escuro dá 1,11:1**,
isto é, a forma some. Por isso o anel âmbar é estrutural, não enfeite. E o `graf-400` que eu
tinha posto no `log ?` reprovou: **4,35:1 sobre o chip** (graf-800) contra o 4,5 da AA — os
5,88 do `traps.md` são sobre o *cartão*, que é mais escuro. Virou `graf-300` (6,25 escuro /
8,26 claro). Armadilha nova: **medir contraste sobre o fundo real do elemento, não sobre o
fundo da tela.**

**O card fica ao lado de Improdutivas e conta CONTRATO, não O.S.** — o LOG conta idas à
agenda, e uma ida é uma visita. Clicar abre a lista, como no TEC1; o recorte é **por grupo de
serviço**, que foi o que ele pediu ("log de visita técnica - log de adesão, de mudança de
pacote"). Em 26/10: 39 contratos de 339, 52 retornos somados, 1 com LOG ≥ 3 — VISITA TECNICA
28, SERVICO 5, RETORNO DE CREDENCIADA 4, ADESAO 2.

---

**E o tempo de deslocamento estava errado para todos** — *"o tempo de deslocamento também não
tá certo, tá repetindo para todos os contratos"* (Emanuel, 26/10). Estava mesmo, e a causa é
antiga.

O relógio (138) contava `agora − situacao_em`. Mas a importação faz
`update visita set situacao_em = now()`: **todos os contratos do mesmo arquivo ficam com o
mesmo instante**, e o relógio passava a medir *"minutos desde a importação"*. Medido em 26/10:
**11 contratos EM DESLOCAMENTO, nenhum tocado pelo campo, DOIS instantes distintos** de
`situacao_em` — a tela escrevia "15 min" nos onze, enquanto o TOA mandava 00:06, 00:09, 00:13,
00:16 e 00:29.

É a **mesma armadilha que a 024 já conhecia** e estava escrita lá desde setembro:
`situacao_em` só é a hora do evento quando `bloqueado_em` existe, isto é, quando foi gente que
mudou a situação e não a importação. O relógio nasceu sem essa guarda.

A regra agora:

| de onde veio | o que o relógio mostra |
|---|---|
| campo/controlador tocou (`bloqueado_em`) | cronômetro nosso, correndo, desde `situacao_em` |
| importação | **o tempo que o TOA MEDIU** (`tempo_deslocamento`), parado — rótulo "deslocou" |
| nenhum dos dois | **nada** — "não sei" não se escreve como número |

O número da importação é o mesmo do painel de Equipes, que já lia `tempo_deslocamento`: duas
telas com o mesmo nome passam a dar o mesmo número. A execução não tinha o defeito porque já
contava de `visita.inicio`, que é do TOA — mas o fallback dela para `situacao_em` ganhou a
mesma guarda, senão seria o relógio da importação de novo no dia em que `inicio` vier vazio.

**Armadilha para o `traps.md`:** `situacao_em` é `now()` da importação. Qualquer relógio,
ociosidade ou "há quanto tempo" medido nele, sem conferir `bloqueado_em`, mostra o mesmo
número para a planilha inteira — e o defeito é invisível em contrato único.

**VERIFICADO ATÉ ONDE DEU:** `tsc --noEmit` e `npm run build` limpos; o `select` novo
testado contra o PostgREST (parseia, sem PGRST100, e o RLS devolve vazio ao anônimo); 21 de
21 casos de `lerLog` e `minutosDeIntervalo` com os valores reais do banco; os dois
componentes renderizados de verdade no navegador, com os cinco contratos de hoje, cada um
com o seu tempo. **Não verificado:** as telas inteiras logadas (Dashboard, Serviços, Equipes)
— não tenho login, e os números do card saíram de SQL equivalente, não da tela.

### D-225 · Os seis acertos de 26/10: LOG filtrável, a Rota com nome e filtros, e o que ninguém foi fazer (144, 145)

Seis pedidos do Emanuel na mesma mensagem, depois de ver a D-224 no ar.

---

**1. O selo do LOG estava torto, e a janela não filtrava.** *"o símbolo do log
ficou feio (...) não consigo filtrar nessa própria janela o que é 1, log 2,
log 3, deve dar essa opção"*. O selo quebrava em duas linhas ("LOG" em cima,
o número embaixo) porque não tinha `whitespace-nowrap` nem `inline-flex`. E a
janela agora tem **dois filtros que se combinam** — valor do LOG e grupo de
serviço. A contagem de cada chip é feita **sobre o outro filtro já aplicado**,
para a soma dos chips sempre bater com a lista; e um grupo que ficaria vazio
na combinação simplesmente não é oferecido. Conferido na tela: LOG 2 → 9
linhas (todas 2), + VISITA TECNICA → 8, LOG 5 → 1.

**2. A tabela de Serviços espremia a coluna que mais tem conteúdo.** *"está
com quebra de texto, talvez reduza a coluna grupo pra ficar mais ajustado"*.
A causa: **Grupo tinha `whitespace-nowrap` e por isso não encolhia** — ficava
do tamanho de "RETORNO DE CREDENCIADA" em toda linha, e a coluna de O.S.
quebrava a descrição do tipo **uma palavra por linha**. Agora Grupo tem teto
(`w-36`) e quebra, Endereço caiu de 320 para 224 px, e a O.S. tem piso de
26 rem — medido depois: 429 px, com "48 · VISITA TECNICA - VIRTUA" numa linha
só.

**3. O LOG estava EMBAIXO da área, não ao lado.** Medido no navegador: "MA1"
(25 px) + "LOG 0" (41 px) + espaçamentos = **96 px**, e a coluna tinha 66. Foi
para `w-28` (112 px) com `flex-nowrap`. Não é chute: é a medida.

**4. A Rota não sabia o nome de ninguém.** *"suba o nome do técnico também,
não tem o nome, só login, e número"*. `rota_do_dia` lia o nome em
`dados_origem->>'Recurso'` — a coluna que **só um dos dois formatos de export
do TOA traz** (D-091). Medido: **0 de 482** visitas do dia têm essa coluna, e
por isso as 61 faixas diziam todas "sem nome no TOA". O nome estava do lado:
**482 de 482** têm `tecnico_responsavel_id`. O cadastro passa a vir primeiro e
o "Recurso" fica de reserva. O nome virou a primeira linha da faixa e o login
desceu — sem sumir, que é por ele que a faixa casa com o TOA.

> Armadilha: **a matrícula do técnico É o login do TOA** (medido: Z597207 nos
> dois). Escrever as duas deu "Z597207Z597207" na tela. Em Serviços o mesmo
> efeito roubava metade do nome por truncagem — lá a matrícula foi para a dica.

**5. O cartão da Rota dizia a situação só por cor.** *"é bom mostrar se o
contrato está se deslocando, solicitação de ticket, cancelado, reagendado"*.
Agora a **palavra** está no cartão, abreviada com palavra inteira (nunca com
reticências: "Em desloca…" não informa). E `rota_do_dia` passou a trazer
`status_toa` e `desatribuido`, então o cartão distingue "CANCELADA" de
"CANC. CENTRAL" e "DESATRIBUÍDO" — para quem despacha são coisas diferentes:
numa o técnico foi, na outra não.

**6. A Rota não tinha filtros.** *"deve ter os filtros de equipes, tipo de
serviço, igual ao no menu serviços"*. Três filtros (equipe, grupo, situação)
que se combinam, com as opções saindo do **dia inteiro** e não do que sobrou —
lista de filtro que encolhe conforme se filtra deixa a pessoa sem caminho de
volta. O corte acontece **uma vez, na porta**, e faixas, mapa e resumo saem
dele: a lição da 131, de que filtro que muda a lista mas não os números faz a
mesma tela afirmar duas coisas. Conferido: 342 → 114 (VT) → 73 (VT +
Concluída), faixas 54 → 19 → 17.

---

#### O que apareceu sem ninguém procurar: o resumo da Rota contava jornada

Medindo as duas contas lado a lado, sem filtro, para garantir que o recálculo
não divergisse do servidor:

| | `rota_resumo` | pelas paradas |
|---|---|---|
| km no dia | 937 | **937** |
| bairros | 50 | **50** |
| retornos | 79 | **79** |
| pulverizados | 19 | **19** |
| **visitas** | 482 | **342** |
| **técnicos** | 61 | **54** |

As quatro parcelas calculadas batem exatamente. A diferença é a **JORNADA**:
`rota_resumo` conta Refeição e Na Base como visita, e os 7 logins que só
fizeram jornada como técnico em rota. *"Jornada não entra em produtividade"*
é regra de ouro do projeto, e esta tela já separa a jornada "na porta" de
propósito — o cartão é que nunca tinha recebido o recado.

O cartão passa a dizer **342 visitas · 126 de jornada fora da conta**, e
"Técnicos · com parada produtiva". Não é segunda implementação de regra:
`km_desde_anterior` e `voltou_ao_bairro` continuam vindo calculados do
servidor, parada por parada; a tela só soma.

---

#### Cancelado pela central não conta para a equipe (144b)

> *"cancelado pela central que o técnico nem chegou a ir no contrato, não é
> bom nem contabilizar o número do contrato pra equipe, deve mostrar quando
> expandir, porém não entra na contagem"* — Emanuel, 26/10

Perguntado e **decidido por ele entre três opções**: sai de **tudo que julga a
equipe** — contratos, O.S., situações, pontos, TEC1, tempos e régua de
períodos. E o **Desatribuído (800)** recebe o mesmo tratamento, também por
decisão dele: o técnico igualmente não foi, e a D-223 já tinha tirado os dois
da conta de quebra pela mesma razão.

A mudança é de **uma linha no lugar certo**: `v` é o funil por onde tudo
passa em `painel_equipes`. Tirar ali tira de tudo, e não há segunda cópia da
regra para divergir depois.

`fora_da_conta` volta como número e a tela escreve **"NINGUÉM FOI · N
cancelado(s) pela central ou desatribuído(s), fora de todas as contas"** no
cartão expandido. Número que encolhe calado parece defeito — e a lista de
contratos continua mostrando todos eles, porque sumir com eles seria trocar um
erro por outro.

Medido em 26/10: **291 contratos contra 343**, com **52 fora** em 35 das 68
equipes. A função e o SQL de conferência dão o mesmo número.

---

**VERIFICADO:** `tsc --noEmit` e `npm run build` limpos; `testar_policies()`
26/26 e `testar_campo()` 29/29; zero tabela sem RLS e zero `SECURITY DEFINER`
alcançável pelo `anon` (as duas funções foram **recriadas**, e função recriada
nasce com a ACL aberta); as seis telas abertas e dirigidas no navegador, com
os filtros acionados e os números conferidos contra SQL equivalente.

**NÃO VERIFICADO:** o comportamento em tela estreita (celular) das colunas
novas, e o painel de Equipes com filtro de contrato ligado ao mesmo tempo que
o `fora_da_conta` — a conta deve fechar, mas não foi medida nessa combinação.

### D-227 · Relógio só para quem foi, e a Primeira WO só para quem chegou (145)

> Numerada 227 e não 226: outra sessão aplicou a migration 146 (humor do dia)
> com D-226 já escrito dentro dela. Dois trabalhos em paralelo no mesmo dia.

Três correções do Emanuel em 26/10, e as três são a mesma doença: **o TOA
preenche hora de coisa que ainda não aconteceu**, e o sistema estava lendo
essas horas como fato.

---

#### 1. Cancelado sem ida não tem tempo de execução

> *"Não sei por qual motivo os contratos recebem um relógio em execução para
> contratos cancelados, sendo que ninguém foi lá e o sistema já marcou o tempo
> que ele passou executando (...) Os cancelados que eu falo é aqueles
> desatribuídos ou cancelados pela central."*

Tem razão. Em **cancelado pela central** e em **desatribuído (800)**, `inicio`
e `fim` são a janela que o TOA tinha reservado — contar `fim − início` como
execução afirma um trabalho que não houve. Agora não há relógio nenhum, que é
como a tela diz "não houve".

**A cancelada normal mantém o relógio**, e isso é deliberado: ali o técnico
foi, e o tempo que ele gastou antes de cancelar é informação. Conferido na
tela: CANCELADO_CENTRAL 10 linhas / 0 relógios, DESATRIBUÍDO 23 / 0, CANCELADA
15 / 15.

#### 2. A Primeira WO contava contrato que ninguém abriu

> *"Ela já está contando contratos futuros que têm horário de início e fim,
> porém eles nem tiveram status ainda."*

A 140 usava `v.inicio is not null` como prova de chegada. Medido em 14 dias,
por "Status da Atividade":

| status do TOA | linhas | o que `inicio` é |
|---|---|---|
| CONCLUIDO | 1807 | real |
| NAO CONCLUIDO | 44 | real |
| INICIADO | 129 | real |
| **PENDENTE** | **292** | **planejado** — e vai até **20:27** |
| **EM ROTA** | **28** | **planejado** — está indo, não chegou |
| CANCELADO | 160 | 116 com início; pela central, ninguém foi |

Chegada passa a ser o que o TOA **abriu**. Efeito: 431 → 430 dias-técnico,
**8 dias mudaram de hora**, o mais tarde caiu de 15:09 para 15:07. Pequeno no
histórico fechado, **grande no dia em andamento** — que é onde ele viu o
defeito, com a rota ainda cheia de PENDENTE. Conferido depois de aplicar: das
430 linhas, 415 concluído, 13 não concluído, 2 iniciado, **zero PENDENTE e
zero EM ROTA**.

A mesma regra entrou no Dashboard (`metricas.ts`): as duas telas dizem a mesma
hora para o mesmo nome, que era o motivo de o filtro já ser compartilhado.

#### 3. Turno da tarde, com meta de 11:20

> *"As equipes que entram à tarde, o horário padrão de estar no cliente é
> 11h20 no máximo (...) precisa ver se ele trabalhou à tarde durante 7 dias,
> com a primeira janela de 11 às 14. Se for mais de 7 dias, ele é da tarde."*

Duas coisas o pedido não fechava, e ele escolheu com os números na mão:

- **Janela de apuração: 30 dias.** Recusados: "últimos 7 corridos" (com 7 dias
  no total, "mais de 7" nunca acontece) e "histórico inteiro" (marcaria para
  sempre quem foi da tarde uma vez).
- **Tarde = qualquer primeira janela a partir das 11:00**, não só a 11-14. O
  dado tem 12:00-15:00 (4 dias), 14:00-17:00 (1) e 15:00-18:00 (3) — cobrar
  08:20 de quem começa às 15h estaria errado.

A classificação é **por técnico**, derivada do dado, nunca cadastrada. Olha a
janela de **todo** contrato produtivo, inclusive os que ele não chegou a abrir:
a escala é o que a CLARO mandou fazer, não o que ele conseguiu fazer. E é uma
classificação por período, não por dia — por dia seriam 30 dias × N técnicos de
releitura, e turno não muda de um dia para o outro.

> ⚠ **Medido e dito na tela: hoje a regra não classifica ninguém.** O banco tem
> **9 dias de histórico**; 12 técnicos têm algum dia de tarde e o máximo é 5.
> Com corte em 7, zero. A regra está certa e passa a valer sozinha conforme o
> histórico cresce — conferido baixando o corte para 2, que classifica 2
> técnicos. A tela escreve isso em vez de deixar a coluna "manhã" sem
> explicação.

---

**VERIFICADO:** `tsc` e `npm run build` limpos; `testar_policies()` 26/26 e
`testar_campo()` 29/29; zero tabela sem RLS e zero `SECURITY DEFINER`
alcançável pelo `anon` (as duas funções foram recriadas); Indicadores,
Serviços e os três filtros de cancelamento abertos no navegador, com os
números conferidos contra SQL.

**NÃO VERIFICADO:** o comportamento da Primeira WO num dia **em andamento**
com PENDENTE na rota — o dia de hoje já estava fechado quando a correção
entrou. É justamente o caso que ele relatou; vale olhar amanhã de manhã.
Também não foi medido o custo da CTE `janela_pri` num período longo com 30
dias de lookback (no período de 14 dias não houve diferença perceptível).
