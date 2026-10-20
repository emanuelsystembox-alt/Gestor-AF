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
