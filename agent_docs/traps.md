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

**Data-modifying CTE não enxerga o próprio efeito.** `with x as (delete
… returning) select count(*) from tabela` devolve a contagem **antes**
do delete. Conferir num segundo comando.

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

**O Node resolve pacote pela pasta do script, não pelo `cwd`.** Script
avulso que importa `@supabase/supabase-js` tem de estar dentro de `app/`
ou `campo/`.
