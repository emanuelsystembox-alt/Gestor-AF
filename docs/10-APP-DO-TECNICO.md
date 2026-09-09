# O aplicativo do técnico

> Sessão de **08/09/2026**. Commit `ec3775e`. Decisões **D-112 a D-116**.
> Migrations **055** e **056**. Código em `campo/`.

---

## Por que existe

A tela `/campo` da web já fazia o passo a passo e a baixa desde a
migration 032. O que ela não faz — e não vai fazer — é **câmera de
verdade e GPS de verdade**.

No navegador do celular:

| | no navegador | no aplicativo |
|---|---|---|
| foto | passa por seletor de arquivos; o técnico escolhe da galeria | câmera abre na tela, com o tipo da evidência escolhido antes |
| vídeo | depende de codec do aparelho, sem controle de duração | teto de 60 s e 50 MB, medidos na gravação |
| GPS | só enquanto a aba está aberta e o usuário disse "permitir" naquela sessão | permissão do sistema, precisão reportada, última posição conhecida como reserva |
| sem sinal | a ação se perde | a evidência entra numa fila no aparelho e sobe sozinha |

A pergunta do Emanuel foi direta: *"tenho que desenvolver para Android e
iPhone, técnico tem que tirar foto, vídeos e usar a geolocalização"*.

---

## O concorrente, tela a tela

O que segue foi lido das capturas que o Emanuel mandou do **Alfa Gestor ·
Field Service** em 08/09. Serve de mapa: o que copiar, o que recusar e o
que fazer melhor.

### 1. A tela inicial é um menu de doze ícones

```
OCIOSO                    ← o estado do técnico, em cima de tudo

O.S. Abertas    O.S. Concluídas   Ranking
Meta            Premiação         Jornada do Dia
Miscelâneas     Terminais         Aceites de Materiais
Portaria        Abastecer         Mensagens
```

O trabalho do dia — "O.S. Abertas" — é **um dos doze**, e fica atrás de
dois toques. Um técnico abre o aplicativo para fazer visita, não para
consultar ranking.

### 2. Atividades — o cartão

Cabeçalho colorido com a situação (`Entrada - In Box` azul,
`Reagendamento` âmbar), e dentro:

- **Contrato**: `212140890 - #N/A` — o `#N/A` é o nome do cliente
  faltando, exibido cru
- **Período**: `14:00 - 17:00 - 2026-09-08 00:00:00` — janela e data
  concatenadas, com hora zerada visível
- **Endereço** completo, numa linha só
- **Distância**: `1,5 Km, 04 minuto(s)`
- Nome do serviço e, às vezes, uma etiqueta (`WIFI-MESH`)

### 3. Ordem de Serviço — o detalhe

Abas **Home** e **Anexos(0)**. Ícones de compartilhar, anexar e menu.

Traz Cliente, Contrato + **WO**, Período, **Telefones clicáveis**,
Endereço com link de Localização, Bairro, Cidade, **CEP**, **Node** e
**Área**, Distância, Observações, e uma tabela `Num. | Ordem de Serviços`.

Embaixo, **Status\Timeline** — e é a melhor parte do aplicativo deles:

```
14:16:12   [Entrada - In Box]  EMANUEL SILVA
08:22:26   [Cancelado]         Operadora
06:24:11   [Entrada - In Box]  SUPERVISOR - LEANDRO DE…
```

Hora, situação com cor, **e quem fez**. Inclusive quando quem fez foi a
operadora.

### 4. O menu de situação

`Pendente · Em Deslocamento · Em Execução · Concluir` — quatro itens
soltos num menu de três pontinhos, sem ordem e sem impedir salto.

### 5. A pergunta que o aplicativo faz

> **Residência Localização**
> Você está na casa do cliente?     `NÃO`  `SIM`

**Ele pergunta. Não mede.** Tem a permissão de localização (o ícone está
na barra de status), e mesmo assim a prova de presença é o técnico
apertando "SIM". É exatamente o buraco que o Emanuel mandou fechar.

### 6. Concluir Serviço — quatro abas

`INSTALAR EQUIPAMENTO · RETIRAR EQUIPAMENTO · MISCELÂNEAS · CÓDIGO DE BAIXA`

- **Instalar**: *"Foi utilizado algum equipamento ou serial?"* com chave
  Sim/Não, campo "Selecione um Serial" e botão **Escanear** (QR), e um
  divisor "Instalado".
- **Código de Baixa**: um `select` "Selecione Um Código"; escolhido o
  `101 - Endereco Nao Localizado`, aparece **Sub-falha (Motivo)** com
  `NÚMERO INEXISTENTE`. Observação livre. Botão CONCLUIR e diálogo
  *"Confirmar Baixa — Finalizar?"*.

Depois de confirmada, o cartão volta para a lista com o cabeçalho
**Reagendamento** — o código decidiu a situação, que é o D-097 do lado
deles.

---

## O que copiamos, o que recusamos

| Do concorrente | Nós | Por quê |
|---|---|---|
| Timeline com hora, situação e **autor** | **copiado** | é o melhor que eles têm, e nosso histórico já carrega o login (D-061) |
| Telefone clicável, link de mapa | **copiado** | evita a improdutiva mais comum: cliente ausente |
| Sub-falha só depois do código | **copiado** | a lista de motivos depende do código; mostrar antes é ruído |
| Serial com leitor | **em parte** | lançamos serial, tipo e modelo; o leitor de código de barras fica para quando houver almoxarifado |
| Distância até o endereço | **melhorado** | mostramos também a **precisão do GPS**: "±12 m · 340 m do endereço" |
| *"Você está na casa do cliente?"* | **recusado** | não perguntamos, **medimos** (D-113). Autodeclaração não é prova |
| Menu de 12 ícones na abertura | **recusado** | a agenda é a tela inicial (D-112) |
| Trocar a situação por menu solto | **recusado** | um botão por vez, o próximo passo do fluxo, no rodapé, ao alcance do polegar |
| `#N/A` e `00:00:00` na tela | **recusado** | campo vazio some; não vira texto |
| Ranking, Premiação, Portaria, Abastecer, Terminais, Aceites de Materiais, Miscelâneas, Mensagens | **fora** | dependem de módulos que não existem (almoxarifado, frota) ou de regra que ninguém definiu. Ver "O que falta" |
| Meta e Premiação | **substituídos** | "Minha produção no mês" na própria agenda: pontos, meta, fator e a receber, numa tela só |

---

## Arquitetura

**Expo SDK 57 · React Native 0.86 · React 19.** Roda hoje no **Expo Go**,
sem loja e sem build — o que importa para testar amanhã de manhã. Nada do
que usamos exige build nativo.

Projeto **separado** de `app/`, não monorepo (D-112): `app/` é Vite +
Tailwind, `campo/` é Metro + StyleSheet; as duas árvores não compartilham
build, e compartilhar `node_modules` custaria mais do que as ~150 linhas
de domínio que de fato se repetem. `src/lib/dominio.ts` e `formato.ts`
são gêmeos da web **de propósito** — a duplicação é escrita e declarada.

```
campo/
  App.tsx                sessão + as três telas da pilha
  src/navegacao.ts       Agenda · Visita · Captura
  src/lib/supabase.ts    cliente: AsyncStorage, detectSessionInUrl off, url-polyfill
  src/lib/auth.tsx       sessão, perfil, papéis — guarda o ID, não o objeto (D-085)
  src/lib/gps.ts         a trava do D-113, e a cara dela
  src/lib/midia.ts       foto/vídeo → Storage → registrar_evidencia, com fila offline
  src/lib/dominio.ts     situações, cores, tipos de evidência
  src/lib/formato.ts     datas em fuso local (D-084)
  src/ui/tema.ts         a linguagem CAMPO: clara, 52 px de toque (D-011)
  src/ui/componentes.tsx Cartao · Etiqueta · Botao · Aviso · Vazio · Carregando
  src/telas/             Entrar · Agenda · Visita · Captura
```

**Sem biblioteca de UI.** `StyleSheet` e nada mais — a mesma decisão dos
gráficos SVG à mão da web: controle do tema, bundle pequeno, nada para
manter.

Três diferenças obrigatórias no cliente Supabase, e o porquê de cada uma:

| | por quê |
|---|---|
| `storage: AsyncStorage` | não há `localStorage`; sem isto o técnico faz login toda vez que o Android mata o processo |
| `detectSessionInUrl: false` | não há URL de retorno num aplicativo; ligado, o cliente procura `window.location` e quebra |
| `react-native-url-polyfill` | o `supabase-js` monta as chamadas com `URL`/`URLSearchParams`, que o Hermes não traz completos |

---

## As quatro telas

### Entrar

Mesmo login do sistema. A sessão fica guardada no aparelho. As mensagens
de erro do Supabase são traduzidas — *"Invalid login credentials"* não
ajuda ninguém às 7h da manhã na porta de um cliente.

### Agenda — a tela inicial

Uma chamada só ao banco: **`agenda_do_campo(data)`**. O celular do
técnico abre em 4G de rua, e a agenda precisa de contagem de O.S., de
evidência e de equipamento — três *embeds* que o PostgREST resolveria em
três viagens.

- navegação por dia (‹ hoje ›), tocar no meio volta para hoje
- duas abas: **A fazer** e **Baixadas**
- **Minha produção no mês**: pontos, meta, barra, fator e a receber
- **estado do GPS em aviso permanente** — descobrir que a localização
  estava desligada quando o cliente já está esperando é tarde
- **fila de evidência** esperando sinal, com botão de tentar agora
- puxar para atualizar sincroniza a fila, a agenda e o GPS

No cartão: janela, situação, serviço, contrato, cliente, endereço, e os
selos **`1 de 3 O.S. baixadas`** · `2 evidência(s)` · `1 equipamento(s)`.
"3 O.S." não diz o que falta fazer; "1 de 3 baixadas" diz.

Jornada (`Na Base`, `Refeição`) **não entra**: `agenda_do_campo` filtra
`natureza = 'PRODUTIVA'`.

### Visita

Endereço em destaque, rota no mapa, telefone clicável. Um chip fixo com
**"Localização ligada · ±12 m · 340 m do endereço"**.

As O.S. mostram as **duas baixas lado a lado** — a da operadora (leitura,
veio do TOA, D-042) e a da AFLINE. Baixa da AFLINE abre um modal de tela
cheia: busca de código → sub-falha (só as do conjunto vigente) →
observação → confirmar.

Evidência em galeria de miniaturas, com URL assinada (o bucket é
privado), tipo, carimbo, tamanho, e a marca **"sem GPS"** quando a foto
não trouxe coordenada.

Equipamento: `Instalou`/`Retirou`, serial, tipo, modelo. Serial repetido
no mesmo contrato e mesma operação não duplica — é o técnico batendo duas
vezes no botão, não dois aparelhos.

Rodapé com **um botão por vez**: `Estou a caminho` → `Cheguei — iniciar`
→ `Impedimento` / `Finalizar visita`. Finalizar pede confirmação e diz o
que vai acontecer: *"depois disso o contrato fica encerrado e você não
consegue reabrir — só o controlador"*.

### Captura

Câmera em tela cheia, tipo da evidência no topo, relógio na gravação,
disparo de 78 px. Depois da captura: **Refazer** ou **Usar esta**.

"Usar esta" lê o GPS, sobe o arquivo e registra. Se falhar **por rede**,
enfileira e avisa. Se falhar **por regra** (fora do dia, outra equipe,
sem permissão), não enfileira — vai falhar de novo amanhã, e o técnico
precisa saber agora.

---

## As regras — e onde elas moram

Nenhuma delas está na tela. Todas estão no banco, migration **055**. A
tela só **antecipa o recado**, para o botão não falhar sem explicar.

### 1 · Sem GPS não há baixa (D-113)

> *"o técnico só pode baixar se estiver ligado"* — Emanuel, 08/09.
> **Ligado é o GPS.** Perguntado e confirmado antes de escrever qualquer
> linha.

`baixar_os` recusa a chamada do campo sem `lat/lng`. O mesmo vale para
**encerrar a visita** (`registrar_etapa` para situação terminal):
encerrar é a mesma afirmação, feita pela outra porta.

Três limites deliberados:

- **andar pela tela não exige coordenada** — "a caminho" e "cheguei"
  passam sem GPS; travar o passo a passo por causa de satélite é pior
  que registrar sem ele;
- **foto sem GPS ainda sobe** — guarda `lat`, `lng` e `precisao_m`
  quando dá, e a tela marca "sem GPS" quando não deu;
- **não é cerca eletrônica** — não conferimos se a coordenada bate com o
  endereço. A tela mostra a distância e deixa a leitura para quem
  audita. Definir raio aceitável é regra que ninguém pediu.

### 2 · Baixa dada não se desfaz pelo campo (D-114)

O.S. com baixa da AFLINE não aceita segunda baixa do campo, e situação
terminal não volta.

A trava de 032 pegava `CONCLUIDA` e `CANCELADA` e **deixava
`REAGENDAMENTO` passar** — justamente a situação que a baixa automática
do TOA aplica sozinha 1.075 vezes (D-097). Agora a lista é
`situacoes_terminais()` (035), a mesma que as outras portas usam.

"Campo" é quem **só** tem o papel do campo: um controlador que também
está cadastrado como técnico não perde os poderes de controlador por
abrir o aplicativo. A mesma conta é feita no banco e na tela.

### 3 · Depois de baixado ele ainda anexa — no dia (D-115)

Foto que não subiu e equipamento esquecido são o caso comum, não a
exceção. Fechar a visita para anexo empurraria isso para o WhatsApp — que
é onde está hoje.

A janela é **o dia do contrato**, escolha do Emanuel entre "sem prazo",
"48 horas" e "só hoje". `pode_anexar_na_visita` é o único lugar onde essa
conta é feita, e usa **`hoje_local()`**, não `current_date`: o Postgres da
Supabase está em UTC, e em Manaus o dia vira às 20h. É o D-084 do lado do
banco.

Anexo é **inserção, nunca edição**: não há policy de UPDATE nem de DELETE
no bucket, e não há RPC para apagar evidência.

### 4 · Quem carimba o autor é o servidor (D-061)

Nenhuma tela manda `usuario_id`. `registrar_evidencia` e
`registrar_equipamento` resolvem `meu_tecnico_id()`, o login (matrícula
do TOA, ou o e-mail) e a origem (`MOBILE`/`WEB`) por dentro.

---

## O que o banco ganhou — migration 055

| | o quê |
|---|---|
| **A** | `hoje_local()` — a data no fuso da operação, para qualquer regra que o usuário enxergue |
| **B** | `evidencia` ganha `midia`, `mime`, `duracao_seg`, `precisao_m`, `usuario_id`, `login`, `origem`, `observacao`; `equipamento_movimento` ganha autor e origem |
| **C** | bucket privado **`evidencia`** (50 MB, imagem e vídeo) + `visita_do_path()` + as duas policies do Storage |
| **D** | `pode_anexar_na_visita()` — a permissão do campo num lugar só |
| **E** | `registrar_evidencia()` |
| **F** | `registrar_equipamento()` |
| **G** | `baixar_os` e `baixar_visita` com coordenada, e as travas da baixa |
| **H** | `registrar_etapa` com a lista canônica de situações terminais |
| **I** | `agenda_do_campo()` — o dia inteiro numa viagem só |

### O caminho do arquivo é a chave da permissão (D-116)

Evidência mora sempre em `<visita_id>/<arquivo>`. O prefixo não é
organização: é o que a policy do Storage usa para descobrir de qual
contrato o arquivo é. A regra inteira é uma linha:

```sql
visita_do_path(name) in (select id from visita)
```

O subselect passa pelo RLS da `visita` — o arquivo é visível para
**exatamente** quem já podia ver o contrato, sem uma segunda cópia da
regra de escopo para divergir da primeira.

`visita_do_path` existe porque `substring(name,1,36)::uuid` estoura em
qualquer objeto cujo nome não seja UUID, e **policy que estoura vira
negação silenciosa em cima de tudo**. O `CASE` garante a ordem de
avaliação.

### A assinatura que teve de mudar

`baixar_os` foi de 5 para 7 parâmetros; `baixar_visita`, de 3 para 5. A
versão antiga foi **derrubada**, não mantida ao lado: duas funções com o
mesmo nome e defaults deixariam a chamada de 5 argumentos nomeados
**ambígua** para o PostgREST — as duas casam. Os chamadores (a tela web e
o `ContratoModal`) continuam funcionando porque argumento nomeado que
falta cai no default.

---

## O teste — migration 056

`testar_policies()` prova o RLS. As regras da 055 **não são policy**: são
guarda dentro de função `SECURITY DEFINER`, que ignora RLS por definição.
Sem teste próprio, "o técnico não desfaz a baixa" é uma frase no
comentário, não um fato do banco.

`testar_campo()` é **INVOKER** (D-054: teste escrito como definer roda
como o dono, que tem `BYPASSRLS`, e passa em tudo), cria a própria
fixture — empresa, base, equipe, técnico, dois contratos, uma O.S. — e
limpa tudo no fim, inclusive quando falha no meio.

```
TECNICO ve a agenda do dia                      1          1          ✅
TECNICO baixa SEM GPS                           barrado    barrado    ✅
TECNICO baixa COM GPS                           permitido  permitido  ✅
TECNICO troca o codigo ja baixado               barrado    barrado    ✅
TECNICO finaliza SEM GPS                        barrado    barrado    ✅
TECNICO finaliza COM GPS                        permitido  permitido  ✅
TECNICO reabre o que ja fechou                  barrado    barrado    ✅
TECNICO anexa foto DEPOIS de concluir (hoje)    permitido  permitido  ✅
TECNICO anexa em contrato de ONTEM              barrado    barrado    ✅
Evidencia com caminho fora do padrao            barrado    barrado    ✅
Serial normaliza (espaco e caixa)               1          1          ✅
CONTROLADOR corrige a baixa, sem GPS            permitido  permitido  ✅
CONTROLADOR anexa em contrato de ONTEM          permitido  permitido  ✅
anon executa as funcoes da 055                  0          0          ✅
```

A limpeza tem ordem obrigatória: a visita leva evidência, equipamento e
evento junto, e **só depois disso** o técnico pode ser apagado — o
trigger de D-090 recusa quem tem histórico, inclusive de teste.

---

## Foto e vídeo, na prática

**A foto é reduzida antes de subir**: 1600 px de largura, qualidade 0,7.
A câmera de um celular atual entrega 4 a 8 MB por foto — no 4G de rua,
meio minuto por evidência, e o técnico desiste. Reduzida dá ~250 KB e
ainda se lê o número de série na imagem.

**O vídeo tem teto de 60 s**, checado na gravação e não só no bucket: um
minuto já são ~15 MB e meio minuto de upload. Descobrir o limite **depois**
de gravar é o pior dos mundos, porque o técnico acha que mandou.

**O upload é base64 → ArrayBuffer**, não `fetch(uri).blob()`. O Blob do
React Native não carrega os bytes, carrega uma referência — e o
`supabase-js` sobe o arquivo **vazio**, sem erro.

**A fila offline** guarda o pedido no `AsyncStorage` e o arquivo continua
no cache do aparelho. Item que falha cinco vezes sai da fila: o
temporário já foi limpo pelo sistema e insistir só trava a tela.

---

## O que a web ganhou junto

`app/src/pages/Visita.tsx`:

- manda `p_lat`/`p_lng` na baixa, e avisa antes quando não tem;
- exige GPS do campo para encerrar;
- **"Trocar código" some** para quem só tem o papel do campo — oferecer
  uma ação que o banco vai recusar é pior que não oferecer.

A tela `/campo` da web **continua existindo**: serve o controlador
conferindo do computador e o técnico sem o aplicativo instalado.

---

## Como rodar

```bash
cd campo
npm install
cp .env.example .env
npx expo start
```

Instale o **Expo Go**, aponte a câmera para o QR Code. Celular e
computador na mesma rede — senão, `npx expo start --tunnel`.

### O que precisa existir antes

O aplicativo usa o mesmo login do sistema, mas a agenda só aparece para
quem o banco reconhece como técnico de uma equipe:

1. usuário com papel **TECNICO** e perfil de acesso **Técnico de Campo**;
2. esse usuário **vinculado a um técnico** (`tecnico.usuario_id`);
3. esse técnico **numa equipe** com contrato do dia.

> **Hoje `tecnico.usuario_id` está em 0 de 104.** Sem o passo 2 a pessoa
> entra e vê a agenda vazia — `equipes_visiveis()` não acha equipe
> nenhuma para ela. **Não é bug do aplicativo.**

### Publicar

O projeto EAS já existe (`afline-manager`). Falta ligar a pasta:

```bash
cd campo
npx eas-cli@latest login
npx eas-cli@latest init --id <id-do-projeto>
npx eas-cli@latest build --platform android --profile preview
```

iPhone exige conta paga de desenvolvedor Apple; Android não.

---

## O que foi verificado, e o que não foi

**Verificado:**

- bundle Android compila — 928 módulos, `exit 0`
- `npx tsc --noEmit` limpo nos dois projetos
- `npm run build` da web continua passando
- `testar_campo()` 14/14 e `testar_policies()` 16/16, com papel
  `authenticated` de verdade
- nenhuma tabela sem RLS; nenhuma função `SECURITY DEFINER` alcançável
  pelo `anon`
- a fixture do teste não deixou entulho no banco

**Não verificado:** nada rodou em aparelho real. Câmera, upload e GPS
foram escritos contra os `.d.ts` do SDK 57 instalado, não contra um
celular. O primeiro teste com o Expo Go é o que fecha isso.

---

## O que falta

| O quê | Por quê |
|---|---|
| **Vincular técnico a usuário** | 0 de 104. É o que destrava o teste do aplicativo. Administração → Usuários, campo **Login TOA** (D-087) |
| **Ligar a pasta ao projeto EAS** | falta o id completo do projeto `afline-manager` |
| **Apagar/ocultar foto errada** | dedo na lente, contrato trocado. Hoje só pelo `service_role`. A saída certa é **ocultar com motivo**, não DELETE — prova que se apaga não é prova. **Decisão do Emanuel** |
| **Leitor de código de barras no serial** | o concorrente tem. Depende do almoxarifado para valer alguma coisa: sem cadastro de serial, é digitação com câmera |
| **Terminais · Aceites de Materiais · Miscelâneas** | dependem do almoxarifado, que não existe |
| **Portaria · Abastecer** | dependem do módulo de frota, que não existe |
| **Ranking · Premiação** | "Minha produção no mês" já responde meta e a receber. Ranking entre técnicos é decisão de gestão, não de software — **perguntar ao Emanuel se quer** |
| **Mensagens** | comunicação COP ↔ técnico dentro do aplicativo. Não foi pedido |
| **Jornada do Dia no aplicativo** | a jornada existe no banco (`natureza = 'JORNADA'`) e é filtrada de propósito da agenda. Se o técnico precisar apontar Refeição/Na Base pelo celular, é tela nova |
| **Evidência obrigatória** | o Emanuel decidiu **livre** — nenhuma foto trava a baixa. Se um dia virar exigência por tipo de serviço ou por código, é tabela nova + cenário em `testar_campo()` |
| **Atualização sem loja (EAS Update)** | dá para publicar correção sem passar pela revisão da Apple. Vale configurar quando o aplicativo estiver em uso |
