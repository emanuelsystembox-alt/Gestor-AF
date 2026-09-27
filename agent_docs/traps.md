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

**Bundle dividido engana a conferência de deploy.** As telas moram em
`Servicos-*.js`, `VisitaDetalhe-*.js` — olhar só o `index.js` dá falso
negativo. Baixe do ar e compare com o local.

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

**O Node resolve pacote pela pasta do script, não pelo `cwd`.** Script
avulso que importa `@supabase/supabase-js` tem de estar dentro de `app/`
ou `campo/`.
