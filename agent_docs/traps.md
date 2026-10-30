# Armadilhas que já morderam

Cada item aqui custou tempo de alguém. Não são hipóteses — são defeitos
que aconteceram neste banco, com estes dados.

As de **segurança** estão em `security.md`; as de **negócio**, em
`business-rules.md`. Aqui ficam as técnicas.

---

## Postgres e Supabase

**`current_date` é UTC.** Em Manaus o dia vira às 20h. Qualquer regra
que o usuário enxergue ("só anexa no contrato de hoje") medida em
`current_date` tira o técnico do ar quatro horas antes da meia-noite
dele. Use **`hoje_local()`**.

**Função de escopo solta na policy é chamada POR LINHA.**
`empresa_id = minha_empresa()` custa uma chamada por linha avaliada;
`(select minha_empresa())` custa uma por consulta. Nas 1.320 visitas de
hoje: **121 ms contra 7 ms**, e o custo é linear. Vale para
`minha_empresa`, `eh_gestor`, `eh_global`, `auth.uid`, `tem_papel`,
`tem_permissao`. Ver D-118.

**`pg_policies` devolve o texto na forma canônica do Postgres.**
`(select minha_empresa())` volta como
`( SELECT minha_empresa() AS minha_empresa)`, com `SELECT` **maiúsculo**.
Conferência ou reescrita em cima desse texto precisa ignorar caixa
(`~*`, flag `gi`) — senão acusa falso positivo e reescreve o que já
estava certo. Aconteceu: 53 policies "com defeito" que estavam corretas.

**`authenticated` tem `statement_timeout = 8s`, e importação grande passa disso.**
Estourou a primeira vez numa rota inteira de Manaus (340 linhas, 337
contratos novos): 4–6 s medidos, mais de 8 s no clique. O banco desfaz
TUDO. Antes de juntar mais trabalho numa RPC que já processa a planilha,
meça como `authenticated` com o arquivo do dia inteiro — e prefira
dividir em chamadas (D-181: a reconciliação virou a segunda chamada). Para
achar onde está o tempo, `set local track_functions = 'all'` e
`pg_stat_xact_user_functions` na mesma transação: conta as chamadas de
cada função, o que oscilação de cronômetro não mostra.

**Função INVOKER chamada por linha = RLS avaliado por linha.**
`tec1_da_os(o.id)` num SELECT de 1.808 O.S. roda 1.808 consultas, e cada
uma avalia as policies de `ordem_servico`, `visita` e `tipo_servico` — que
perguntam `bases_visiveis()`, `minha_empresa()`, `eh_gestor()`. O
`(select f())` da D-118 vale por CONSULTA, não por chamada da função
auxiliar. Deixar `bases_visiveis()` 1 ms mais cara (103) levou o painel de
Equipes a 11,5 s. Por isso ela guarda a resposta na transação (106). Antes
de engordar uma função de escopo, conte quantas vezes ela é chamada numa
tela cheia (D-183).

**`norm_txt(coluna) = norm_txt(x)` num subselect é normalização POR LINHA.**
`norm_txt` tem `SET search_path`, então não é inlinada: 258 mil chamadas
numa importação. Calcule o lado do parâmetro uma vez (lateral com
`offset 0`) e dê índice de expressão à coluna (D-181).

**Medir desempenho como owner mente igual a testar policy como owner.**
`produtividade_periodo` fazia 402 ms como dono e **estourava o timeout**
como `authenticated`, porque o RLS reavaliava as funções de escopo por
linha. Ver D-081.

**CTE com função de conjunto referenciada uma vez é *inline*** — e a
função passa a ser reexecutada por linha do join. Use
`with x as materialized (...)`.

**Assinatura com default não convive com a versão antiga.** `baixar_os`
de 5 e de 7 parâmetros ao mesmo tempo deixa a chamada de 5 argumentos
nomeados **ambígua** para o PostgREST — as duas casam. Ou derruba a
antiga (`drop function`) e atualiza os chamadores, ou não acrescenta
parâmetro.

**`create or replace` não aceita coluna nova no `returns table`**
("cannot change return type"). Tem de derrubar — e função recriada do
zero **nasce com a ACL aberta** (ver `security.md`).

**Variável record chamada `v` colide com alias `v` da tabela.** O
plpgsql resolve `v.id` como a variável ainda não atribuída e estoura
*"record v is not assigned yet"*.

**`norm_txt(NULL)` devolve STRING VAZIA, não NULL** — e coluna nula
normaliza para a mesma string vazia, então as duas casam.
`equipe_do_login(base, NULL, data)` devolvia a primeira equipe sem login
e roteava jornada para uma equipe qualquer, em silêncio. Ver D-070.
E **`unaccent_simples` não existe aqui**: quem normaliza é `norm_txt`.

**`visita.importacao_id` só é carimbado no INSERT.** Visita que já
existia e foi ATUALIZADA por uma importação nova **mantém o id da
importação que a criou**. Quem filtrar "o que esta importação tocou" por
esse campo pega quase nada: medido, a importação de 30 linhas carimbou
**uma** visita, e um refresh de TEC1 rodou em 1 de 30 — em silêncio, com
o resto da tela mostrando número velho. O conjunto certo é
`importacao_linha.visita_id`, que vem preenchido para todas. Ver D-150.

**Cache de regra que virou cadastro fica errado calado.** A 080 tirou a
carência do TEC1 de dentro de um regex e pôs em `tipo_servico`
justamente para a operação poder mudar — e então materializou o
resultado em `ordem_servico.tec1`. No dia em que alguém trocar 119 por
90, todo valor guardado passa a mentir sem aviso. Pior: o painel lia o
cache e a linha do contrato lia outra coluna, então a **mesma tela se
contradizia**. Antes de cachear, meça: `tec1_da_os` ao vivo sobre o dia
inteiro custou **4,8 ms** contra 340 ms do painel. O cache não comprava
nada. Ver D-150.

**Lista fechada em CHECK pega tipo novo.** `aviso.tipo` aceita só os
tipos que existiam na 059; a 091 inseriu `MATERIAL` e estourou 23514 no
primeiro teste. Antes de gravar valor novo numa coluna de "tipo", olhe o
CHECK dela (`pg_get_constraintdef`) — e amplie na mesma migration. Ver
D-167.

**`ativo = false` não é "vigência encerrada".** `definir_meta_comissao`
fechava a meta antiga com `ativo = false`, e toda leitura filtra
`ativo`: trocar a meta em outubro deixaria setembro sem meta. Período
se fecha com a data (`vigencia_fim`); `ativo` é para desligar o que
estava errado. Ver D-167.

**Crase dentro de aspas duplas no bash é comando.** `node -e "…\`x\`…"`
executa `x` como command substitution antes do node ver o texto. Script
com crase (Markdown, template string) vai num arquivo, não em `-e`.

**NOT NULL de coluna não aparece em `pg_constraint`.** Conferir
restrição com `select … from pg_constraint` mostra CHECK, FK e UNIQUE —
e esconde o NOT NULL, que mora em `information_schema.columns.is_nullable`.
Na 089b a carga do catálogo morreu no primeiro item sem código SAP porque
`item_miscelanea.codigo` era NOT NULL e a conferência "não achou" nada.
Olhe as duas coisas, e os índices únicos (`pg_indexes`) também. Ver D-165.

**Ordenar por `id` uuid não é ordem de gravação.** Dois lançamentos com o
mesmo `criado_em` (mesma transação, mesmo segundo) desempatados por uuid
saem em ordem aleatória. Num razão isso não muda o saldo final, mas
embaralha o "saldo anterior" de cada linha do Kardex. Quem precisa de
ordem tem de ter uma coluna de ordem (`seq … generated always as
identity`, 089c).

**Carga grande pelo MCP custa o texto inteiro a cada tentativa.** O
`apply_migration` recebe o SQL na chamada; se a carga falhar, a transação
volta e o texto todo vai de novo. Antes de mandar dado em volume, confira
TODAS as restrições da tabela-alvo e as duplicatas do arquivo — na 089b
foram três envios de 25 KB.

**Data-modifying CTE não enxerga o próprio efeito.** `with x as (delete
… returning) select count(*) from tabela` devolve a contagem **antes**
do delete. Conferir num segundo comando.

**O arquivo da migration pode estar atrasado em relação à função viva.**
Antes de um `create or replace`, leia a versão que está NO BANCO
(`pg_get_functiondef`), não a do arquivo. Aconteceu na 085:
`estoque_posicao` no banco tinha `base as materialized`, que o arquivo
077 não tem — recriar a partir do arquivo teria desfeito uma otimização
calado. E `romaneio_por_serial` tinha sido reaplicada sem os comentários.
Para conferir se são iguais, compare o `md5` do `prosrc` sem comentários
e sem espaços com o mesmo cálculo sobre o arquivo. Ver D-160.

---

**Trabalho de fundo dentro de uma TELA para quando a pessoa sai dela.** O
sincronismo rodava na página Sincronismo (um componente React com
`setInterval`): trocar de tela desmontava o componente e o laço morria —
a primeira varredura gravou 5 contratos e se perdeu, e a extensão ficou
"já varrendo" para sempre. Trabalho que tem de continuar sozinho mora no
**fundo da extensão** (alarme do Chrome, estado em `chrome.storage`), não
numa tela. Ver D-193.

**Aba escondida não desenha.** O Chrome quase para uma aba que não está à vista
(e uma janela totalmente coberta, no Windows): não desenha a tela e atrasa os
relógios. Script que pilota a tela de outro sistema (a varredura do TOA, D-193) erra
por tempo esgotado em tudo. Detecte `document.visibilityState` e pause.

**O Console de Alocação do TOA mostra UM bucket.** A varredura acha o contrato
pelo bloco na tela; com MAN-AFLINE aberto, os 56 contratos da VT
(MAN-AFLINE_01_VT) foram todos "fora do Console" — e às 12:42 de 20/10, com o
Console em outro bucket, 192 de 192. Script que pilota o TOA tem de saber o
bucket de cada contrato e abri-lo antes (0.5.0, D-196).

**Antes de criar coluna, procure o dado no SCHEMA, não só no `dados_origem`.**
A segmentação "não tinha coluna" porque eu só olhei a linha crua do TOA — e ela
existia desde o começo: tabela `segmentacao` + `visita.segmentacao_id`, que a
importação preenche. Criei uma cópia gerada e tive de derrubar (123b, D-199).
`information_schema.columns` com `ilike '%nome%'` antes de qualquer `add column`.

## PostgREST

**Tem cache de schema.** Depois de `ALTER TABLE`, o front recebe
`PGRST100 — failed to parse select parameter` apontando uma coluna que
**está** no banco. Não é sintaxe: é cache.
`notify pgrst, 'reload schema';`

**FK com UNIQUE vira um-para-um, e o embed devolve OBJETO, não array.**
`reincidencia` tem `unique (visita_id)`; `reincidencia[0]` derrubou a
tela de Relatórios inteira. Duas FKs para a mesma tabela deixam o embed
ambíguo e exigem o nome da constraint:
`reincidencia!reincidencia_visita_id_fkey`.

**O `supabase-js` remove TODO espaço em branco do `select`.** Se for
testar na unha com `curl`, replique isso — senão você caça um erro de
sintaxe que só existe no seu teste.

---

## Front (web e aplicativo)

**`new Date('1990-02-31')` não falha: vira 03/03, calado.** Conferir data
digitada só com "deu `Date` válido?" aceita 31 de fevereiro. O certo é montar
a data e conferir que dia, mês e ano voltaram iguais. Pegou na importação da
planilha de cadastro (D-176, `dataIso` em `lib/cadastroCidade.ts`). E data
lida do Excel chega como meia-noite **UTC**: leia com `getUTC*`, senão em
Manaus vira o dia anterior.

**`toISOString()` devolve a data em UTC.** Em Manaus o dia vira às 20h e
a tela abre no dia seguinte, vazia. Use `isoLocal()` de `lib/formato.ts`
(existe nos dois projetos). Ver D-084.

**Objeto novo com conteúdo igual é re-render garantido.** O
`supabase-js` reemite a sessão a cada foco na aba — e, no celular, a
cada volta de segundo plano. Guardar o objeto no estado remontava a
aplicação inteira. **Guarde o ID.** Ver D-085.

**Canal de Realtime não cancelado é conexão pendurada.** O plano tem
teto de conexões **simultâneas**, não de mensagens. Sempre
`removeChannel` no cleanup do efeito.

**No React Native o Blob não carrega os bytes.** `fetch(uri).blob()`
sobe o arquivo **vazio**, sem erro. O caminho que funciona é base64 →
`decode()` → ArrayBuffer.

**`text-graf-500` reprova contraste em texto que informa.** Medido com o
motor do navegador, sobre o cartão: **3,66:1** no tema claro e **2,75:1**
no escuro — abaixo do 4,5 da AA. Reprovou três vezes numa sessão só
("sem regra", "sem encerramento", "fora de contrato", "x/y O.S."). Ele
serve para MOLDURA (rótulo de eixo, travessão decorativo); texto que
carrega informação usa `graf-400` (5,88 / 4,76). E meça sempre com
conversão de espaço de cor — regex de dígitos mente com `oklch`.

**`position: fixed` dentro de tabela não mede da janela.** Um ancestral com
`transform`, `filter` ou `backdrop-filter` vira o referencial do `fixed` —
o menu do botão direito abria ~150 px longe do clique. Menu flutuante vai
por **portal** para a raiz (`.sup-controle`, que também dá o tema), e o
"não cabe" se resolve com `translate(-100%)`, que usa o tamanho real, e não
com altura estimada. Ver D-169.

**"Finalizado no TOA" não quer dizer "parado".** O técnico pode reabrir uma
atividade que o TOA fechou. Para saber se alguém mexeu depois da
importação, olhe `bloqueado_em` (carimbado por `marca_bloqueio` em toda
mudança de situação fora da importação). Ver D-169 (095b).

**Texto vazio fora de `<Text>` derruba o APK.** `{v.complemento && <Text>…}`
com `complemento = ''` renderiza a string vazia direto numa `View` — erro
fatal no React Native. No Expo Go é tela vermelha; no APK é "o app fechou
porque tem um bug", sem pista nenhuma. Em JSX do `campo/`, campo de texto
que pode vir vazio vai com `!!` (`{!!v.complemento && …}`), e número com
`!= null` (`lat` 0 é falso). Ver D-172.

**No APK, qualquer erro de JavaScript não tratado FECHA o app.** Sem tela
vermelha e sem log à mão. É por isso que existem `Tropeco` e `erro_app`
(D-172): antes de caçar a causa de um fechamento, olhe
`select * from erro_app order by criado_em desc`.

**Serviço de localização em segundo plano derruba o processo com erro
NATIVO.** Subir o serviço com o app fora da frente (por exemplo, voltando
dos ajustes da permissão "o tempo todo") é recusado pelo Android e mata o
app — nenhum `try/catch` pega. Só ligue com `AppState` ativo, e anote o
passo antes (`iniciarPasso`). Ver D-172.

**Menu com `position: fixed` copiado para outra tela sem o portal.** A
correção da D-169 (portal para `.sup-controle`) só valia em Serviços: a
cópia de Equipes, dentro de uma gaveta com `transform` e `overflow`, abria
longe e sumia recortada. Hoje é um componente só (`MenuContrato`). Ver
D-173.

**No Android do Expo SDK 57 o teclado NÃO encolhe a janela** (edge-to-edge).
`KeyboardAvoidingView` com `behavior={undefined}` no Android — o padrão de
muitos exemplos — deixa o teclado em cima do campo. Use `'height'` no
Android, principalmente se o rodapé for `position: absolute`. Ver D-168.

**`disabled` num campo TIRA O FOCO, e `.focus()` num campo desabilitado
nao faz nada.** O padrao "desabilita enquanto salva" mata o fluxo de
teclado: depois do Enter o foco vai para o `BODY` e a proxima leitura nao
entra. No balcao do almoxarifado isso vira trinta cliques para bipar
trinta pecas. E leitor de codigo de barras digita rapido: desabilitar no
meio de uma leitura **come caractere**. Trave a reentrada num `ref` e
devolva o foco num `requestAnimationFrame`, depois do render. Ver D-154.

**`import('/src/lib/x.ts')` no console do Vite pode ser OUTRA instância do módulo.**
Depois de HMR a página usa `x.ts?t=…`; o import do console carrega uma
cópia nova. Trocar `supabase.rpc` nela não troca nada na página — e o
"teste com dado falso" escreveu 250 contratos de verdade em produção
(D-182). Para falsificar o banco numa verificação, intercepte
**`window.fetch`** (é por onde todo módulo passa) e **trave toda escrita**
que não for a falsificada. Dado fictício nunca com cara de real: prefixo
óbvio e conferência no banco depois.

**Consulta de tela sem `range` para em 1.000 linhas, calada.** O PostgREST
devolve no máximo mil por requisição. O Dashboard lia "7 dias" com um
`select` sem paginação e mostrava **742 contratos onde o banco tem
2.283** — e todos os números do painel (conclusão, improdutivas, TEC1,
tempos) saíam sobre esse pedaço, sem aviso na tela. Em "Hoje" nunca
apareceu, porque o dia cabe. Quem lê período longo pagina com `.range()`
em laço até o lote vir menor que a página. Conferir é fácil e vale a
pena: comparar a contagem da tela com um `select count(*)` do mesmo
intervalo. Ver D-221.

**`situacao_em` é o `now()` da IMPORTAÇÃO, não a hora do evento.** A importação faz
`update visita set situacao_em = now()`, então todos os contratos do mesmo arquivo
ficam com o mesmo instante. O relógio do serviço (138) contava `agora − situacao_em`
e mostrava **"15 min" nos onze contratos em deslocamento** de 26/10 — nenhum tocado
pelo campo, DOIS instantes distintos para os onze — enquanto o TOA mandava 00:06,
00:09, 00:13, 00:16, 00:29 em `tempo_deslocamento`. A 024 já sabia disso desde
setembro e está escrito lá: `situacao_em` só é a hora do evento quando
**`bloqueado_em`** existe, isto é, quando foi gente que mudou a situação. Qualquer
relógio, ociosidade ou "há quanto tempo" medido nele sem essa guarda mostra o mesmo
número para a planilha inteira — e o defeito é **invisível em contrato único**, que é
como ele passou. Ver D-224.

**Meça contraste sobre o fundo REAL do elemento, não sobre o fundo da tela.** O
`traps.md` dizia que `graf-400` dá 5,88 — e dá, **sobre o cartão** (`graf-900`). Sobre
um chip `graf-800`, que é mais claro, o mesmo texto cai para **4,35:1** e reprova no
4,5 da AA. Pegou no selo "log ?" da D-224. E a recíproca: um chip **preto** tem 21:1
de texto e mesmo assim **some**, porque contra o cartão escuro a FORMA dele dá 1,11:1
— ali a borda é estrutural, não enfeite. Meça o texto contra o fundo dele e o fundo
contra o que está atrás.

**Comentário JSX `{/* … */}` logo depois de `return (` não compila** — vira um segundo
filho na raiz do `return`, e o Babel estoura *"Unexpected token, expected ','"*. Pior:
`tsc --noEmit` rodado ANTES da edição passa limpo e dá falsa segurança. Comentário
antes do `return`, em `//`. Foi carregar a página que pegou (D-224) — "compila" não é
"funciona", e "compilou antes" não é "compila".

**`whitespace-nowrap` numa coluna de tabela não é "não quebra": é "não ENCOLHE".**
A coluna Grupo de Serviços ficava do tamanho de "RETORNO DE CREDENCIADA" em toda
linha, e quem pagava era a coluna de O.S., a mais larga de conteúdo — a descrição
do tipo quebrava **uma palavra por linha**. O sintoma aparece longe da causa: o
texto picado está numa coluna, o `nowrap` está em outra. Em tabela larga, dê TETO
às colunas curtas (`w-36`) e PISO à que carrega o conteúdo. Ver D-225.

**A matrícula do técnico É o login do TOA.** Medido: `tecnico.matricula` =
`Z597207` e o login do TOA da faixa = `Z597207`. Escrever os dois lado a lado deu
"Z597207Z597207" na Rota, e em Serviços roubou metade do nome por truncagem. Antes
de mostrar matrícula e login juntos, compare — e, se forem iguais, escolha um.
Ver D-225.

**`rota_resumo` conta JORNADA como visita.** O cartão "VISITAS" da Rota dizia 482
onde há 342 paradas produtivas, e "TÉCNICOS" 61 onde 54 têm parada produtiva: os 7
logins que só fizeram Refeição e Na Base entravam como técnico em rota. A própria
tela já separa a jornada "na porta", de propósito — o cartão é que não tinha
recebido o recado. Só apareceu porque as duas contas foram medidas lado a lado
antes de trocar a fonte do resumo; km, bairros, retornos e pulverizados batiam
exatamente, e foi o par que NÃO batia que mostrou o defeito. **Antes de substituir
uma conta do servidor por uma da tela, meça as duas sem filtro: ou elas batem, ou
uma das duas está errada e vale saber qual.** Ver D-225.

**`visita.inicio` preenchido NÃO prova que o técnico chegou.** O TOA manda o
horário **planejado** da atividade muito antes de alguém sair: medido em 14 dias,
**292 contratos PENDENTE e 28 EM ROTA** tinham `inicio` — um deles às **20:27** — e
todos entravam na média de chegada do indicador Primeira WO. Quem abriu a atividade
de verdade está no **"Status da Atividade"**: `CONCLUIDO`, `NAO CONCLUIDO` ou
`INICIADO`. É o mesmo engano da D-103 (`fim` vem preenchido em atividade só
INICIADA) do outro lado da visita. O defeito é quase invisível no histórico fechado
(8 dias-técnico de 431 mudaram) e **grande no dia em andamento**, com a rota ainda
cheia de PENDENTE. Ver D-227.

**Cancelado pela central e Desatribuído têm `inicio` e `fim`, e não é execução.** É
a janela que o TOA reservou. `fim − início` ali vira "o técnico passou 42 min
executando" num contrato onde ninguém foi. Antes de medir duração de qualquer
coisa, pergunte se ALGUÉM FOI — `origemCancelada()` responde. Ver D-227.

**Embed de tabela que filtra por CIDADE ATIVA, dentro de tabela que não filtra,
vem NULO e parece dado faltando.** `perfil` não tem `bases_visiveis()` na policy;
`tecnico` tem (D-180). Com São Luís ativa, a tela de Administração listava os 71
acessos de Manaus e o embed `tecnico:tecnico_id(...)` vinha nulo nos 67 — a coluna
Segmento escrevia **"—"** como se nenhum deles fosse técnico, e a linha "LOGIN TOA ·
roteando para" sumia junto. No banco estava tudo certo (`tecnico_id` preenchido,
skill `ADESÃO`). O que salva é o **PONTEIRO**, que sobrevive ao RLS: `perfil.tecnico_id`
vem na linha mesmo quando o embed não vem. **Antes de escrever "—" para um embed nulo,
pergunte se o ponteiro existe — se existir, o que falta é ESCOPO, não cadastro, e a
tela tem de dizer qual dos dois.** Ver D-232.

**Cabeçalho de planilha casado por NOME sem normalizar a CAIXA ignora a coluna em
silêncio.** `lerPreenchida()` casa `norm(titulo) === norm(celula)`, e `norm` só tira
acento e `*` — não faz upper/lower. Na planilha de 29/10 havia `"EQUIPE"` (coluna
acrescentada à mão) e `"Equipe"` (a do modelo, vazia): a primeira NÃO casou, a segunda
casou vazia, e as 14 pessoas entraram **sem equipe**. Só coluna OBRIGATÓRIA ausente
gera aviso; as outras somem caladas. Ver D-233.

**Importação em duas etapas deixa cadastro pela METADE quando a segunda não termina.**
`importar_cadastro_cidade` grava áreas, equipes, técnicos e login do TOA numa
transação; os ACESSOS são criados depois, num laço na tela, pessoa a pessoa
(`admin-usuarios` precisa da `service_role`). Em 29/10 a etapa 1 gravou 14 técnicos de
São Luís e a etapa 2 **não rodou nenhuma vez** — zero chamadas a `/functions/` em 24 h
de log, e a conta mais nova do sistema era de dois dias antes. O técnico fica ativo,
sem login, fora da aba Usuários e fora do aplicativo do campo. É a mesma família da
armadilha "trabalho de fundo dentro de uma tela para quando a pessoa sai dela". Ver
D-233.

**Faixa verde de sucesso confirma o que a tela TENTOU, não o que o banco GRAVOU.**
O Editar cadastro mandava `update perfil` sem a coluna `base_id` (a cidade só ia para
`cadastrar_tecnico_avulso`, dentro de `if (login)`). O update voltava sem erro —
porque os outros campos iam — e a tela escrevia "FULANO atualizado" com a cidade
intacta. Medido duas vezes: `atualizado_em` mudava e `base_id` ficava parado. Depois
de salvar algo que importa, **releia a linha**, não a faixa. Ver D-234.

**Campo desabilitado por uma condição que não é a dele.** O select de cidade vinha
`disabled={!f.login_toa}` junto com equipe e skill. Equipe e skill são do TÉCNICO; a
cidade é `perfil.base_id`, o ESCOPO DE VISÃO, que vale para coordenador, COP e
controlador também. Resultado: quem não é técnico não tinha como ter a cidade
corrigida, e o campo ficava decorativo. Antes de agrupar campos atrás de uma trava,
confira se todos pertencem mesmo à mesma entidade. Ver D-234.

**`(eh_gestor() or x in (select equipes_visiveis()))` derruba o filtro de CIDADE.**
`equipes_visiveis()` já filtra por `bases_visiveis()` — mas para ADMIN e COP o lado
esquerdo do `or` é verdadeiro, o direito nunca é avaliado, e a cidade some junto.
Estava em `central_do_controle`, `sinais_do_dia` e `ritmo_do_dia`: medido em 29/10,
510 sinais de Manaus e 16 de São Luís, e quem estava com São Luís ativa via os 526.
O conserto não é tirar o `eh_gestor()` (ele serve para o gestor ver equipe fora da
carteira): é pôr `x.base_id in (select bases_visiveis())` ANTES dele, como condição
própria. Procure esse padrão em toda função `SECURITY DEFINER` nova. Ver D-235.

**Regra que nunca dispara parece "zero", e zero parece verdade.** O turno da tarde
(145) exigia "mais de 7 dias com a primeira janela >= 11:00" — e em 74 técnicos,
NENHUM chegou lá. A tela dizia "Ninguém no turno da tarde", o que soa como fato, e
a meta das 11h20 nunca foi aplicada a ninguém. Antes de entregar uma classificação,
conte quantos caem em cada lado com o dado real: se um lado dá zero, ou o dado é
assim mesmo, ou a regra não alcança o dado — e vale saber qual. Ver D-235.

**Apagar a tela que "duplica" pode apagar comando que só ela tinha.** "Tire a janela
do contrato, deixe só a página cheia" — mas `+ O.S.`, `Mudar status` e `Excluir` só
existiam na janela. Antes de remover uma tela "repetida", liste os COMANDOS das duas,
não só os dados. Aqui a janela virou o painel de ações da página (`modo="pagina"`),
em vez de sumir. Ver D-235.

**Filtro que esvazia a tela por regra de negócio precisa dizer que é de propósito.**
Em Equipes, filtrar por "Cancelado pela central" dava "0 de 67 equipes" e tabela
vazia — porque esses contratos não contam para a equipe (D-225). Tudo correto, e
parecia defeito. Quando um filtro legítimo pode zerar a lista, a tela escreve o
porquê ao lado. Ver D-235.

**Policy `ALL` é de ler E de escrever: abrir a visão por ela abre a escrita.**
`visita_gestao` é `for all` e usa `equipes_visiveis()`. Para o supervisor "ver a
cidade", pôr o papel dentro de `equipes_visiveis()` teria dado a ele `UPDATE visita
set equipe_id = …` direto pela API — mover a rota, que ele não pode. Antes de
alargar uma função de escopo, liste as policies que a usam e o `cmd` de cada uma
(`pg_policies`): se alguma for `ALL`, `UPDATE` ou `DELETE`, o escopo de leitura
precisa de função própria (`equipes_legiveis()`, 156a). Ver D-236.

**Teste que cria persona em "qualquer cidade" mede o vazio.** `_prepara_teste_policy`
pegava `base limit 1` e `visita limit 1` — duas escolhas independentes, que podiam
cair em cidades diferentes. O cenário "supervisor lê a cidade" deu 0 na primeira
rodada: era o teste, não a regra. Persona de teste nasce onde está o dado que ela
vai tocar (156c). Ver D-236.

**Bundle dividido engana a conferência de deploy.** As telas moram em
`Servicos-*.js`, `VisitaDetalhe-*.js` — olhar só o `index.js` dá falso
negativo. Baixe do ar e compare com o local.

**E o build NÃO é reprodutível: rebuildar e comparar md5 com o ar acusa diferença
que não existe.** `vite.config.ts` carimba `em: new Date().toISOString()` em
`__VERSAO__` (é de propósito: o rodapé mostra versão e data sem ninguém lembrar de
mudar número). Com isso o chunk que carrega a versão muda de hash a cada build, o
`index.html` muda junto porque referencia o nome dele, e a comparação byte a byte
falha. Medido em 29/10, dois builds seguidos SEM tocar no código: **439 bytes
diferentes em 431.431**, e todos eram nome de arquivo de chunk — `formato-*.js`
manteve o hash idêntico. Conferir deploy assim leva a republicar à toa, ou pior, a
achar que uma entrega não subiu.

Conferência que vale: ou compare o `dist` **que foi publicado** (sem rebuildar), ou
— melhor, porque é imune ao carimbo — **procure no ar a frase que a entrega
acrescentou**: baixe o `index.js` do ar, leia os chunks que ele referencia e
`grep` por um texto novo ("sem acesso", "outra cidade"). Isso responde "o que eu
escrevi está lá?", que é a pergunta de verdade. Ver D-234.

---

## Google Maps (Rota do dia)

**Chave recusada NÃO cai no `onerror` do `<script>`.** Referenciador
fora da lista, cota estourada, faturamento desligado: o script carrega
normalmente, a promessa resolve, o mapa é criado — e só então a API pinta
**ela mesma** um "Ops! Algo deu errado" dentro do nosso `<div>`. Nenhum
`catch` dispara, e a tela fica com um retângulo morto sem caminho de
volta. O único gancho é a global **`window.gm_authFailure`**. Aconteceu
na primeira abertura da tela: `RefererNotAllowedMapError`, porque a
chave estava (bem) restrita e `http://localhost:5173/*` não estava
autorizado.

**`colorScheme` do mapa é opção de CONSTRUÇÃO.** Não existe
`map.setOptions({colorScheme})`: o mapa nasce com o tema que recebeu e
fica com ele. Num app com chave de tema, isso deixa um mapa branco de
holofote numa tela grafite — e o defeito só aparece **depois** de
alternar, então passa na primeira conferência. Para trocar, é destruir e
recriar o mapa (ver `MapaDoDia` em `pages/Rota.tsx`).

**Medidor de contraste escrito com `match(/\d+/g)` mente no Tailwind 4.**
O Tailwind 4 emite cor em `oklch`/`oklab`, e uma regex de dígitos lê
`oklch(0.879 0.169 91.605)` como se fosse RGB. Acusou **1,04:1** numa
etiqueta que tem 9,6:1. Medição de contraste tem de converter o espaço de
cor, ou pelo menos recusar o que não souber ler.

**`fillColor` não aceita `var(--minha-cor)`.** O Maps pinta em canvas,
não em CSS: variável CSS não resolve e o marcador sai **preto, calado**.
Cor para o mapa vai escrita.

**Polígono do Maps criado vazio não tem caminho, e caminho passado no
construtor é COPIADO.** `new google.maps.Polygon({ paths: [] })` →
`getPath()` volta `undefined` e o `addListener` derruba a tela. E passar um
`MVCArray` pronto em `paths` faz o Maps copiar: os cliques iam para a lista
original (a contagem subia), e o desenho não aparecia. O certo é
`poly.setPath(lista)` e depois `poly.getPath()` — o caminho do próprio
polígono. Ver D-171 (`MapaMonitor`, desenho de cerca).

**Ícone de loja do Google engole o clique no mapa.** Clicar em cima de um
ponto de interesse abre a ficha do lugar e o `click` do mapa não chega
como esperado: metade dos cantos da cerca sumia. Durante o desenho,
`clickableIcons: false`.

**`"types"` no `tsconfig.json` é uma lista FECHADA.** Com
`"types": ["vite/client"]`, instalar `@types/google.maps` não faz o
menor efeito — o `tsc` só carrega os pacotes de tipo listados ali. Tem
de entrar na lista.

---

## Dados do TOA

**A planilha tem cabeçalhos repetidos.** `Tipo de Atividade` aparece nas
posições 19 e 20 (categoria e tipo real). Ler "pela chave" perde a
primeira em silêncio. `src/lib/toa.ts` lê **por posição** e sufixa com
`__2`. Nunca troque por `sheet_to_json` com header padrão.

**O TOA exporta em dois formatos, e os dois entram.** Diferem em uma
coluna: `Recurso`, o **nome** de quem estava logado — não o login, que
os dois trazem. Coluna a mais no começo não desloca nada porque `toa.ts`
desduplica por posição e depois indexa por chave. Ver D-091.

**A coluna `Produto` vem com os itens COLADOS**, sem separador:
`id|NOME|pendente` seguido direto do próximo id. Lê-se com
`(\d+)\|([^|]+?)\|([a-z]+)`. O id do item é o **Ponto**, que casa com
`ordem_servico.ponto` (1.127 de 1.128) — **não** com o número da O.S.
Ver D-107.

**O bucket do TOA não está em coluna nenhuma: está no NOME do arquivo.**
`Atividades-MAN-AFLINE_01_VT_02_10_26.xlsx` → bucket `MAN-AFLINE_01_VT`.
Conferido em 31 arquivos. `Cidade` e `Área de Trabalho` dizem a cidade, mas
vêm vazias na jornada (109 de 340 linhas). E o código do TOA não é o nosso
(BLM = Belém/BEL, GUR = Gurupi/GRP). `bucket_do_arquivo()` lê o nome e
aceita a cópia "(1)" do navegador. Ver D-180.

**Códigos de baixa vêm com caixa inconsistente.** `409 - Servico
Concluido` e `409 - SERVICO CONCLUIDO` são o mesmo. Guardamos `codigo`
como inteiro; `extrai_codigo()` lê só o número do início.

---

## Ambiente

**O terminal do Emanuel é Windows PowerShell 5.1, e ele não tem `&&`.**
`cd campo && npm install` estoura com *"O token '&&' não é um separador
de instruções válido nesta versão"*. Comando deixado na documentação vai
ser colado ali: **uma linha por comando**, ou `;`. `cp`, `ls` e `cat`
funcionam — são apelidos de cmdlet; o que não existe é o encadeamento do
bash.

**Heredoc com JSX/aspas quebra no shell.** Para escrever arquivo com
apóstrofo e crase, use a ferramenta de edição, não `cat <<'EOF'`.

**`Set-Content -Encoding utf8` no PowerShell 5.1 grava COM BOM.** O
`app.json` do `campo/` saiu com `EF BB BF` na frente depois de uma troca de
versão pelo PowerShell. JSON com BOM pode quebrar o build do Expo. Edite JSON
com a ferramenta de edição ou com Node; se passou pelo PowerShell, confira os
3 primeiros bytes (`head -c 3 arquivo | od -An -tx1`). Ver D-171.

**APK gerado sem `expo-updates` não se atualiza nunca.** Até o 0.2.1 era
assim: qualquer mudança, mesmo de texto, pedia APK novo. Desde o 0.3.0 tem
(D-186). E a atualização (`eas update`) lê as variáveis do **ambiente da
EAS** (`--environment preview`), não do `env` do `eas.json`, que só vale
no build: ambiente vazio = atualização sem o endereço do Supabase.

**`eas update:configure` mexe além do que diz.** Reescreveu as permissões
do Android no `app.json` com duplicatas. Guarde uma cópia do `app.json` e
do `eas.json` antes, e confira o `diff` depois (D-186).

**E o `eas update` faz o mesmo.** Não é só o `:configure`: em 25/10 um
`eas update --branch preview` deixou **16 permissões onde havia 7** (sete
duplicadas) e acrescentou um segundo `runtimeVersion`, no topo, além do
que já existia em `android`. O arquivo entrou no commit sem ninguém pedir.
Depois de QUALQUER comando da EAS, `git diff campo/app.json` — e, se ele
mexeu, compare as permissões RESOLVIDAS antes de aceitar:
`npx expo config --json` → `android.permissions`. No caso, as 9 resolvidas
eram as mesmas com e sem a lista inchada: o que a EAS escreveu era
redundante, e o certo foi restaurar o arquivo.

**O Node resolve pacote pela pasta do script, não pelo `cwd`.** Script
avulso que importa `@supabase/supabase-js` tem de estar dentro de `app/`
ou `campo/`.

**`cameraPermission: false` no plugin do `expo-image-picker` tira a câmera do APP INTEIRO.**
A opção não é "esta tela não usa câmera": ela põe `android.permission.CAMERA` (e, com
`microphonePermission: false`, o `RECORD_AUDIO`) em `blockedPermissions` do manifesto —
a câmera de evidência morreria no APK, e no Expo Go nada acusa. Depois de mexer em plugin,
confira as permissões resolvidas: `npx expo config --json` → `android.permissions` e
`android.blockedPermissions` (D-213).

**No Expo Go, `expo-updates` não diz a versão do app.** `Updates.isEnabled` vem ligado e
`runtimeVersion` não é a do `app.json` — guarda de "peça nativa só no APK X+" pela runtime
mostrou "precisa do app novo" no Expo Go. Pergunte `isRunningInExpoGo()` (do pacote `expo`)
antes (D-210).
