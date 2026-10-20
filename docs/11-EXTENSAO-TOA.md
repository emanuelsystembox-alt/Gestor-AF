# A extensão "AFLINE — ponte com o TOA"

A ponte entre o Gestor AF e o TOA (Oracle Field Service da CLARO). Nasceu
para o **Sincronismo** (D-189, migrations 110 a 113), e foi desenhada para
crescer: cada coisa nova que quisermos tirar do TOA entra aqui como uma
**ação** nova.

- Instalar e usar: [`extensao-toa/README.md`](../extensao-toa/README.md)
- Este arquivo: **como funciona e como mexer**.

---

## Por que uma extensão

O que se queria no começo (*"uma mascara que entra em um site, e loga nele
dentro do nosso sistema"* — Emanuel, 19/10) não é possível do jeito
literal, por duas barreiras do próprio navegador:

1. **A Oracle proíbe que a página do TOA apareça dentro de outro site**
   (iframe). Não há "TOA dentro do Gestor AF".
2. **Um site não usa o login de outro.** Um `fetch` do Gestor AF para o TOA
   sai sem o cookie da sessão, e o CORS nem deixa ler a resposta.

Uma extensão com **permissão de host** para o endereço do TOA passa pelas
duas: ela faz a chamada com a sessão que a pessoa já abriu naquele Chrome,
e entrega o resultado à nossa tela. Sem senha guardada, sem segundo login.

> A CLARO **permite** acesso automatizado com login de prestador, e **não**
> fornece credencial de API (Emanuel, 19/10). Por isso a extensão, e não a
> API REST oficial do OFS.

---

## O que já foi provado (19/10/2026)

| | |
|---|---|
| Primeira rodada real | MAN-AFLINE, **346 atividades → 339 contratos atualizados, 0 erros**, em **7,7 s** do pedido ao TOA até o fim da importação |
| Ambiente | extensão 0.1.0 · Chrome 155 · Windows, login do Emanuel no Gestor AF e no TOA |
| Nome do arquivo | `Atividades-MAN-AFLINE_19_10_26.xlsx`, vindo do `Content-Disposition` do TOA — é por ele que o banco sabe o bucket (D-180) |
| Cookie | a chamada do fundo da extensão levou a sessão do TOA (era a dúvida antes do teste) |

---

## As três peças

```
┌──────────────── Chrome do computador que sincroniza ────────────────┐
│                                                                      │
│  aba gestor-af.pages.dev                    fundo da extensão        │
│  ┌──────────────────────────┐               ┌─────────────────────┐ │
│  │ tela Sincronismo         │               │ fundo.js            │ │
│  │  lib/ponteToa.ts         │               │ (service worker)    │ │
│  │      │ postMessage       │               │  monta a URL,       │ │
│  │      ▼                   │   runtime.    │  confere, chama o   │──┼──► TOA
│  │ ponte.js (content script)│──sendMessage─►│  TOA com o cookie   │ │   (cookie da
│  │  só repassa o que é da   │◄──resposta────│  da sessão          │◄─┼─── sessão)
│  │  página E tem a marca    │               └─────────────────────┘ │
│  └──────────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────────┘
```

| Arquivo | Onde roda | O que faz |
|---|---|---|
| `extensao-toa/manifest.json` | — | Nome, versão, **permissões**: só o host do TOA; o script de conteúdo só entra no Gestor AF (`gestor-af.pages.dev`, prévias `*.gestor-af.pages.dev` e `localhost:5173`) |
| `extensao-toa/ponte.js` | dentro da aba do Gestor AF, em mundo isolado | Ouve `window.postMessage` **da própria página** com a marca `afline-gestor`, repassa ao fundo e devolve a resposta com a marca `afline-ponte-toa` e o mesmo `id` |
| `extensao-toa/fundo.js` | service worker da extensão | O único que fala com o TOA. Para cada **ação**, monta ele mesmo a URL a partir de parâmetros conferidos |
| `app/src/lib/ponteToa.ts` | na tela do Gestor AF | O outro lado: `extensaoPresente()` (ping, 1,5 s) e `exportarDoToa()` (até 120 s) |

---

## O protocolo

Página → extensão (`window.postMessage`, para `window.location.origin`):

```js
{ origem: 'afline-gestor', id: '<uuid por pedido>', tipo: '<ação>', ...parâmetros }
```

Extensão → página:

```js
{ origem: 'afline-ponte-toa', id: '<o mesmo>', ok: true,  ...resultado }
{ origem: 'afline-ponte-toa', id: '<o mesmo>', ok: false, motivo: 'SEM_SESSAO' | 'ERRO', mensagem: '…' }
```

Sem resposta no prazo, a página conclui `SEM_EXTENSAO` (não instalada,
desligada, ou fora da lista de endereços do manifest).

### Ações de hoje

| `tipo` | Parâmetros | Devolve | Chamada no TOA |
|---|---|---|---|
| `ping` | — | `{ versao }` (do manifest) | nenhuma — responde o próprio `ponte.js` |
| `exportar` | `numero` (inteiro, o providerId do bucket), `dia` (`AAAA-MM-DD`) | `{ ok, nome, base64 }` | `GET /?m=gridexport&a=download&itype=manage&providerId=<numero>&date=<dia>&panel=top&view=time&downloadId=<aleatório>&dates=<dia>&<timestamp>` |
| `varrer` (0.2.0) | `itens: [{ aid, precisa_equipamento }]` | `{ aceito, bucket }` e depois eventos `canal: 'varredura'` (`item` com `resultado` `{ ok, nome, leuEquipamento, itens }`, e `fim`) | **nenhuma direta**: `toa.js`, na aba do TOA, navega pelas telas (Console → Detalhes → Equipamento) e lê o texto |
| `cancelar-varredura` | — | `{ ok }` | — |

**O caminho da varredura:** a página manda `varrer` → `ponte.js` → `fundo.js`
acha a aba do TOA (`chrome.tabs.query` pelo host, preferindo a que está no
Console) → `toa.js` aceita e percorre a lista → cada contrato vira um
`varredura-evento` que `fundo.js` repassa à aba do Gestor AF (e põe a % no
ícone) → `ponte.js` → a página grava (`registrar_varredura`) antes do próximo.
`fundo.js` só aceita `varredura-evento` vindo de aba do TOA, e `varrer` vindo
de aba que não é do TOA.

**Como o `exportar` sabe que deu certo:** o `.xlsx` é um zip e começa com
os bytes `PK\x03\x04`. Qualquer outra coisa não é a planilha. Se veio
**HTML** (ou 401/403), é o TOA pedindo login → `SEM_SESSAO`, e a tela de
todo mundo mostra "a sessão do TOA caiu". O resto vira `ERRO` com o status.

**O número do bucket** (`providerId`) é o atributo `data-id` dos itens da
árvore do Console de Alocação (`.edt-item[data-id]`). Está gravado em
`toa_bucket.numero_toa`; os de buckets ainda não cadastrados estão listados
no comentário da migration 111. O ADMIN corrige na tela Sincronismo. Se o
número estiver errado, o nome do arquivo que o TOA devolve acusa o bucket
real, e a rodada é recusada antes de importar.

---

## As regras da extensão — não quebre

1. **Nunca vire proxy genérico.** A página manda *o que* quer (ação +
   parâmetros), nunca *a URL*. O `fundo.js` monta a URL e confere cada
   parâmetro (tipo, faixa, formato). Uma ação que aceitasse URL da página
   daria a qualquer script no Gestor AF acesso a tudo que o login da pessoa
   alcança no TOA.
2. **Só leitura, a menos que o Emanuel decida outra coisa.** Hoje a
   extensão não grava nada no TOA. Ação que ESCREVE no TOA (baixar O.S.,
   mudar status, mover atividade) é decisão de negócio e de risco com a
   CLARO — pergunte antes, e registre em `docs/03-DECISOES.md`.
3. **Permissões mínimas.** `host_permissions` só com o endereço do TOA;
   `content_scripts.matches` só com os endereços do Gestor AF. Nada de
   `<all_urls>`, `cookies`, `tabs` ou `storage` sem necessidade escrita.
4. **Não guarde senha nem dado de assinante.** A planilha passa pela
   memória, em base64, até a página — que a importa e descarta. Nada em
   `chrome.storage`, nada em arquivo. (LGPD — `security.md`.)
5. **Só o nosso script fala com o fundo.** `fundo.js` confere
   `sender.id === chrome.runtime.id`; `ponte.js` confere
   `ev.source === window` e a marca `afline-gestor`.
6. **Quem decide é o servidor.** A extensão não sabe de dia, de cidade, de
   vez nem de intervalo — ela executa o pedido. Regra de negócio fica no
   banco (`sincronismo_pulso`), como todo o resto (D-189).

---

## Como acrescentar uma ação nova

Exemplo: trazer outra exportação do TOA.

1. **Descubra a chamada no TOA, lendo — não adivinhando.** Abra o TOA no
   Chrome, F12 › **Rede**, faça a ação pela tela e anote o pedido (método,
   URL, parâmetros, o que volta). Faça com dado de um dia/bucket pequeno.
   Não copie corpo de resposta com dado de assinante para lugar nenhum.
2. **`fundo.js`:** um `if (msg.tipo === '<nova>')` no `onMessage`, e uma
   função que **confere** cada parâmetro e **monta** a URL. Devolva sempre
   `{ ok: true, … }` ou `{ ok: false, motivo, mensagem }`, com `SEM_SESSAO`
   quando vier HTML no lugar do esperado.
3. **`ponte.js`:** acrescente o `tipo` novo ao repasse (hoje só `exportar`
   vai ao fundo).
4. **`app/src/lib/ponteToa.ts`:** uma função tipada que chama
   `pedir('<nova>', {…}, prazoMs)` e traduz a resposta.
5. **`manifest.json`:** suba a `version` (0.1.0 → 0.2.0). A tela mostra a
   versão (`executor_info` do sincronismo), e é assim que se sabe qual
   computador está atrasado. Se a tela depender da ação nova, faça ela
   conferir a versão do `ping` e dizer "atualize a extensão" em vez de
   falhar calada.
6. **Atualize este arquivo** (a tabela "Ações de hoje") e, se a ação
   servir a uma regra de negócio, a decisão em `docs/03-DECISOES.md`.
7. **Recarregue** em `chrome://extensions` (botão ↻ no cartão) e recarregue
   a aba do Gestor AF. Em todos os computadores que usam a extensão.

---

## Outras chamadas vistas no TOA (não estudadas)

Apareceram na aba de rede do Console de Alocação em 19/10. **Ninguém
estudou o que trazem** — antes de usar qualquer uma, siga o passo 1 acima.

| Chamada | Quando apareceu |
|---|---|
| `POST index.php?m=manage&a=get` | ao abrir o Console de Alocação |
| `POST index.php?m=supervisor&a=get` | ao abrir a tela |
| `POST ?m=Time&a=get&itype=manage&output=ajax` | ao carregar/trocar o bucket |
| `POST ?m=sync&a=write&ajax=1&window_id=…` | periodicamente (é do próprio TOA — **escreve**; não tocar) |
| `POST index.php?m=partsCatalog&a=getCache` | ao abrir a tela |
| `POST ?m=gridexport&a=getfilepreparationstatus&itype=manage&output=ajax` | junto do Exportar; devolve `{"state":"done","percent":100}`. O `download` já espera o arquivo ficar pronto, por isso a extensão não usa |

---

## Estudo da atividade por dentro (19/10/2026, noite)

Para a "varredura" pedida pelo Emanuel (nome do cliente, equipamentos e
miscelânea por contrato). Lido da aba de rede do TOA, logado, numa
atividade concluída de MAN-AFLINE — **só nomes de campo e estrutura**, sem
copiar dado de assinante.

| O quê | O que se viu |
|---|---|
| **Identificador** | o `aid` interno do TOA **é** o "ID da Atividade" da planilha (`visita.toa_atividade_id`). Dá para pedir a atividade direto |
| **Busca** | `POST index.php?m=search&a=search` acha por **contrato** (campo `customer_number`), não pelo ID; devolve `aid`, `pid` (recurso), status |
| **Cartão (hint)** | `POST ?m=Hint&a=activity&itype=manage&output=ajax` com `id=<aid>` — traz "Nome" do cliente, endereço, janela, status |
| **Página da atividade** | aplicação de página única; rota `#m=activity/a=details/aid=<aid>/__pid=<pid>/__date=<dia>`. Botão "Equipamento" = `list_inventories` |
| **Os dados** | não vêm por URL própria: vêm pelo canal interno **`POST ?m=sync&a=write&ajax=1`** (FormData com `aids=["<aid>"]`, `pid`, `u` = login, `date`, `dv` = versões, e **`trust`** = assinatura da sessão). Sem ação na pilha, é leitura |
| **Inventário** | `delta.Inventory`: por item, `invpool` (`install` = instalado; os outros valores — retirado, cliente — ainda não vistos), `invtype` (código do tipo: 6 = EMTA, 106 = HFC/cabo), `invsn` (serial), `quantity`, `inv_aid`, e campos numerados (`199`, `307`, `335`, `419`, `539`). **Miscelânea = item sem serial e com quantidade** (cabo coaxial, 10), na mesma lista |
| **Atividade** | `delta.Activity.<aid>`: os campos vêm **por número** (`144`, `149`…); o nome do cliente é um deles (número ainda não identificado) |
| **Formulários** | `delta.FormData`: `mobile_activity_inventory`, `DADOSOSDIGITAL`, `Foto OS Digital`, `mobile_activity_request` |
| **API REST oficial** | `/rest/ofscCore/v1/activities/<aid>/installedInventories` etc. → **401**: exige credencial de aplicação, que a CLARO não fornece |

**O que isso significa para a extensão:** `m=Hint` e `m=sync`, pedidos
de fora da aplicação do TOA, respondem `errorNo: SESSION_DESTROYED` — **mesmo
com a sessão viva**. O TOA só os aceita vindos da própria aplicação (com as
fichas que ela gera). O `gridexport` é exceção (só cookie), e por isso o
sincronismo de baixa funciona sem aba do TOA aberta. A varredura vai
precisar de **uma aba do TOA aberta** e de um script da extensão **dentro
dela**, pedindo pela aplicação do TOA. Os nomes de tipo/modelo
(`invtype` 6 → "3 - EMTA") estão num dicionário que a aplicação carrega.

**Caminho FECHADO (19/10, noite):** reenviar o `m=sync` (ou o `m=Hint`)
por fora da aplicação exige copiar a ficha anti-falsificação do TOA
(`X-OFS-CSRF-SECURE`, mandada em todo pedido interno) e reusá-la. Isso é
contornar uma proteção de segurança do sistema da CLARO — **não se faz**,
nem pelo assistente nem pela extensão. A varredura de equipamento, retirado,
miscelânea e nome do cliente fica **parada** até haver um caminho que não
dependa disso. Os caminhos possíveis:

- **Um relatório/exportação do próprio TOA** que traga o inventário por
  atividade (como o Exportar de Atividades traz a rota): a extensão baixaria
  igual ao `gridexport`, só com o cookie. Precisa de alguém da operação dizer
  se existe e onde fica.
- **A CLARO incluir colunas na exportação de Atividades** (nome do cliente,
  inventário) ou **fornecer credencial da API REST** — os dois resolvem sem
  gambiarra.

### O caminho pelas telas (o que já se sabe, 19/10 noite)

Varredura **pelas telas do próprio TOA** — a aplicação dele faz os pedidos;
o script só navega e lê o texto da página. Testado numa adesão e numa troca
de decoder concluídas de MAN-AFLINE:

| Passo | Como | Funciona por script? |
|---|---|---|
| Achar o contrato | caixa `input[placeholder^="Pesquisa em atividades"]` → resultado `.global-search-found-item .activity-title` | **Não**: texto posto por script (`value` + eventos, `insertText`, Enter sintético) não dispara a busca. Com digitação de verdade, sim. **Em aberto** |
| Abrir a atividade | `.activity-title.click()` | **Sim** |
| Nome do cliente | blocos `.form-text-field`: rótulo em `.form-label-group label` ("Nome"), valor em `.form-item` | **Sim** (conferido com "Contrato") |
| Abrir o equipamento | `button[data-ofsc-id="list_inventories"].click()` (o `<button>`, não a moldura `div.toolbar-item`) | **Sim** |
| Ler o equipamento | uma `table.table`; `tr.section-header` = seção ("Cliente", "Instalado", "Desinstalado", "Recurso" + quantidade); `tr.table-row--subheader` = colunas; `tr.table-row--desktop` = itens | **Sim** |
| Voltar | `history.back()` não volta (a aplicação não usa o histórico) | — |

Colunas (as mesmas em todas as seções): **ID do Equipamento · Tipo de
Equipamento · Modelo Equipamento · Serial Equipamento Instalado · Ação ·
Serial Equipamento Substituído · Ponto · Local do Ponto · Quantidade**.

- **Instalado** = o que o técnico pôs. Numa troca, `Ação` = 2 e o "Serial
  Equipamento Substituído" é o aparelho que saiu.
- **Desinstalado** = o **retirado** (devolutiva), com serial.
- **Cliente** = o que já estava na casa antes.
- **Recurso** = a carga do técnico — **fora** (Emanuel, 19/10: "recursos não
  precisa").
- **Miscelânea** = linha sem serial e com quantidade (tipo "HFC", modelo
  `22026219_CABO COAXIAL RG6…`, `22056543_FONTE ACDC 12V…`, quantidade 10/1).

**Como o script chega a cada contrato (resolvido, 0.2.0):** pelo **Console
de Alocação**, não pela busca. Cada atividade é um `div.toaGantt-tb` com o
atributo **`aid`** (e `data-activity-status`). Clicar no bloco abre o cartão;
o link "Detalhes" é `span.hint_link`. **O cartão é reaproveitado**: o link já
existe antes do clique e, clicado cedo, abre a atividade anterior — o script
espera o texto do cartão mudar, confere o "ID da Atividade" na tela de
detalhes e tenta de novo uma vez. "Voltar" é o botão do cabeçalho
(`aria-label` "Console de Alocação" / "Detalhes da atividade").

Implementado em `extensao-toa/toa.js` (D-192). Testado com as funções reais
em sequência: 202944209 → 3 itens, 203084123 → 4 itens (outro equipamento),
ID inexistente → "fora do Console". ~9 s por contrato.

**Sessão:** sem uso, o TOA desloga sozinho (`m=user&a=logout`) — visto
após ~3h50 parado. O login é SSO da CLARO **com Duo** (aprovação no
celular). E entrar com o mesmo usuário em outro navegador derruba o
primeiro — inclusive o computador que sincroniza.

---

## O que se sabe que NÃO se sabe

- **Quanto dura a sessão do TOA parada.** A tela acusa quando cai; se cair
  muito, o próximo passo seria logar sozinho (Cloudflare, D-189 recusou por
  ora).
- **Login com o mesmo usuário em outro navegador derruba a sessão anterior**
  (testado em 19/10). A extensão não muda isso: ela usa a sessão aberta.
- **Se a Oracle mudar a tela**, é o `fundo.js` que quebra — o sintoma é
  rodada `ERRO` com "respondeu … e não uma planilha". O conserto começa
  pelo passo 1 de "Como acrescentar uma ação nova".
- **Instalação "sem compactação"** depende do Modo do desenvolvedor ligado.
  Publicar na Chrome Web Store (privada, só para a AFLINE) tiraria isso —
  não foi feito.
