# Estado do projeto — 08/09/2026 (pendências atualizadas em 25/10/2026)

> Se você está assumindo o projeto agora, comece pelo **`HANDOFF.md`** na
> raiz. Este documento é o inventário; aquele é o mapa.

Consolidação de tudo que existe. Levantado **consultando o banco e o
repositório**, não de memória.

---

## O que é este projeto

Camada operacional própria da **AFLINE**, prestadora da **CLARO**, para
substituir o **Alfa Gestor (ngestor)**. Recebe as ordens de serviço do
**TOA (Oracle Field Service)** da CLARO, despacha para as equipes, recebe
a execução do campo, mede e pontua.

Nasce **multi-empresa**: o Emanuel pretende vendê-lo a outras credenciadas.

---

## Infraestrutura

| | |
|---|---|
| Banco | Supabase `AFLINE manager` · `kqfflkxjijzdtnfshdlv` · sa-east-1 |
| Repositório | `github.com/emanuelsystembox-alt/Gestor-AF` |
| Front-end | Vite + React 18 + TypeScript + Tailwind v4 |
| Edge Function | `admin-usuarios` — criação de login com `service_role` |
| Local | `C:\Users\Emanu\OneDrive\Documentos\PROJETO - NGESTOR AFLINE` |
| **No ar** | **https://gestor-af.pages.dev** — Cloudflare Pages, projeto `gestor-af` |
| Publicar | `cd app && npm run build && npx wrangler pages deploy dist --project-name=gestor-af --branch=main --commit-dirty=true` |

**Fora do escopo:** o Supabase `BANCO PRO - AFLINE 360` é outro projeto
(camada analítica, 350+ migrations). Não tocamos nele desde 04/09.

---

## Banco — números reais

**44 tabelas · 2 views · 99 funções · 86 policies · zero tabela sem RLS ·
zero função `SECURITY DEFINER` alcançável pelo `anon`**

E, desde 07/09, uma **bateria de teste de policy com 16 cenários**:

```sql
select * from testar_policies();   -- esperado: passou = true em tudo
```

### Estrutura

```
empresa ─── base (praça) ─── equipe ─── tecnico
                              │  └── equipe_login_toa (histórico)
                              │  └── equipe_tipo_servico
                              └── visita ─── ordem_servico
                                    ├── evidencia
                                    ├── equipamento_movimento
                                    ├── reincidencia
                                    ├── visita_marcador
                                    └── visita_evento (auditoria)
```

**Acesso:** `perfil` · `usuario_papel` · `usuario_base` · `carteira` ·
`cargo` · `perfil_acesso` · `permissao` · `perfil_acesso_permissao`

**Entrada:** `importacao` · `importacao_linha`

**Domínios:** `tipo_atividade` · `tipo_servico` · `tipo_os` ·
`codigo_baixa` · `sub_falha` · `situacao_visita` · `segmentacao` ·
`categoria_capacidade` · `area_trabalho` · `indicador_qualidade`

**Dinheiro:** `tabela_preco` · `combinacao_os` · `regra_pontuacao` ·
`regra_pontuacao_log`

### Dados carregados

| | |
|---|---|
| Empresas | 1 (AFLINE) · Praças **18** |
| Equipes | **107** · Técnicos **104** · Supervisores 5 |
| Visitas | **955** em 5 dias (04/09 a 08/09) |
| Ordens de serviço | **1.181** |
| Códigos de baixa | **168**, e agora **todos com situação de destino** — 145 derivados da análise, **23 declarados pelo Emanuel na tela** em 08/09 |
| Itens de produto | **5.505** lidos da coluna `Produto` do TOA · 1.933 pendentes |
| Visitas com TEC1 | **494** avaliadas pela regra de aderência |
| Sub-falhas | **1.466** — CASO 1 (528) e NÍVEL HARD (938) |
| Conjunto vigente | **NÍVEL HARD** |
| Indicadores de qualidade | **7** |
| Combinações de O.S. | **546** · Regras de pontuação **1.021** |
| Skills | 3 ativas (ADESÃO · MANUTENÇÃO · DESCONEXÃO) + SINGLE MASTER como legado |
| Cargos / perfis de acesso / permissões | 10 / 6 / 26 |
| Usuários com login | **1** (o admin) |

### Parâmetros da operação

| Chave | Valor | O que muda |
|---|---|---|
| `baixa_automatica` | **ligada** em 08/09 | A importação aplica a situação que o código de baixa manda, quando todas as O.S. da visita têm código com destino |

---

## Migrations aplicadas

| # | O que faz |
|---|---|
| 001 | Domínios: áreas, tipos de atividade (com natureza), tipos de serviço, tipos de O.S. |
| 002 | 166 códigos de baixa da CLARO + classificação própria |
| 003 | Base, perfil, papéis, equipe, técnico, carteira, funções de permissão |
| 004 | Importação, **visita → ordem_servico**, evidência, equipamento, reincidência, auditoria |
| 005 | RLS em todas as tabelas + view do técnico |
| 006-007 | Importador do TOA (helpers + função) |
| 008-009 | Correção da trava D-006 e reconstrução do importador |
| 010-011 | Endurecimento: `SECURITY DEFINER`, revogação nominal do `anon`, `search_path` |
| 012 | Pseudo-códigos `-1` e `-2` do NETSMS |
| 013 | Tempo de atribuição real do TOA |
| 014 | **Grupo de serviço** derivado do cruzamento TOA × ngestor |
| 015 | Cadastro de equipes e importador |
| 016-018 | **Multi-tenant**: empresa, 18 praças, RLS por tenant, carimbo automático |
| 019 | **Isolamento por praça** |
| 020 | Técnicos fora do cadastro + `vw_equipe_resumo` |
| 021 | **Login TOA da equipe, com histórico por período** |
| 022 | Sub-falha, histórico completo e transferência de equipe |
| 023 | Escolha do conjunto de sub-falha vigente + resumo por conjunto |
| 024 | **Painel de equipes por dia** com períodos, situações e OCIOSO |
| 025 | **Cadastro de situação**, indicadores de qualidade e `visita_marcador` |
| 026 | **Reatendimento**, **dupla baixa** TOA×AFLINE com sub-falha, exclusão arquivada |
| 027 | **Pontuação por combinação de O.S. × edificação** |
| 028 | **Administração**: cargo, perfil de acesso, permissões, fecho da escalada |
| 029 | **`testar_policies()`** (16 cenários) + permissão fina nas RPCs |
| 030 | **Histórico com autor** e **cadastro manual** de contrato/O.S.; `reverter_situacao` |
| 031 | SUPERVISOR passa a enxergar as equipes que supervisiona |
| 032 | `registrar_etapa` do técnico; escopo de equipe em `baixar_os`; histórico legível por quem enxerga a visita |
| 033 | **Reincidência derivada do dado**, recalculada a cada importação |
| 034 | O login do TOA manda na equipe; login único por base |
| 035 | Situação terminal exige todas as O.S. baixadas |
| 036 | Equipe abrigo — **revertida pela 039** |
| 037 | Meta, comissão e `produtividade_periodo` |
| 038 | **A receber = pontuação × fator**; faixa por piso |
| 039 | Desfaz o cadastro deduzido e o abrigo |
| 040 | Vínculo supervisor ↔ equipes; origem do login na tela |
| 041 | Login TOA no cadastro de acesso |
| 042 | **Só o cadastro roteia**; equipe "Sem login definido" |
| 043 | **Cadastro sem autor não roteia**; técnico se desliga, não se apaga |
| 044 | O nome do técnico vem do TOA (coluna `Recurso`), não do palpite |
| 045 | Skill do técnico: ADESÃO, MANUTENÇÃO, DESCONEXÃO — e a comissão por skill |
| 046 | **O código de baixa decide a situação** (67.485 linhas analisadas) + `parametro` |
| 046b | Baixa automática no importador |
| 046c | `codigo_baixa` é catálogo global — correção do filtro por empresa |
| 047 | **TEC1 — aderência à janela**, regra lida do painel do Emanuel |
| 048 | Excluir contratos em lote, sem atalho na regra |
| 049 | **Exclusão definitiva** — DELETE com registro de auditoria |
| 050 | **O status do TOA não conclui**; `finalizado_toa`; baixa automática ligada |
| 051 | Atividade **suspensa** não entra na importação |
| 052 | **Produto pendente** lido da coluna `Produto` do TOA |
| 053 | O produto é **da O.S., pelo Ponto** — corrige o 052 |
| 054 | **Rota do Dia** — `rota_do_dia`, `rota_bairros`, `rota_alertas` |
| 055 | **O campo no celular** — bucket `evidencia`, `registrar_evidencia`, `registrar_equipamento`, `agenda_do_campo`, `hoje_local`, e as travas da baixa (GPS, baixa que não se desfaz, terminal que não volta, anexo só no dia) |
| 056 | **`testar_campo()`** — 14 cenários das travas da 055, INVOKER (D-054) |
| 057 | **O cartão do técnico diz quanto vale** — `agenda_do_campo` com pontos, `pontos_achou` e node (D-117) |
| 058 | **O escopo resolve uma vez** — 86 policies reescritas; 121 ms → 7 ms (D-118) |
| 059 | **O aviso chega ao campo** — tabela `aviso`, gatilho em `visita_evento`, Realtime por equipe (D-119) |
| 060 | **O controle vê ao vivo** — `visita_evento` publicado no Realtime |
| 061 | Fecha `aviso_do_evento` para o `anon` — regressão da 059, pega pela conferência |

> **Da 062 em diante** (até a **121**, em 20/10/2026) a lista completa, com o que
> cada uma faz, está em **`supabase/README.md`** — esta tabela parou de ser
> mantida aqui para não haver duas listas divergindo.

---

## Telas prontas

| Rota | O que faz |
|---|---|
| `/entrar` | Login com identidade AFLINE |
| `/controle` | Painel: cartões de situação, **volume × pontos** por tipo de serviço, improdutivas por responsabilidade, encerramentos por hora, tempo por etapa, CSV |
| `/controle/servicos` | Lista com 9 filtros, duas densidades, faixa de cor por situação, menu no botão direito, **contrato em janela** e **+ Nova O.S.** (cadastro manual) |
| `/controle/equipes` | Painel por dia: contratos, períodos, situações, OCIOSO, contratos de cada equipe, **bolinha do técnico**; abre só com quem tem contrato |
| `/controle/rota` | **Rota do dia**: alertas de rota, linha do tempo por técnico com o bairro no bloco, e os bairros no espaço |
| `/controle/produtividade` | **Produtividade e comissão** em três dimensões (técnico · equipe · supervisor): pontos, dias, média/dia, previsão, meta, fator e **a receber**; edita a tabela de comissão com a permissão `comissao.editar` |
| `/controle/relatorios` | Relatório **por contrato** (72 colunas) e **por O.S.** (87), com **pontuação** e **serviço anterior**, filtros, Excel e CSV; marca a primeira O.S. do endereço |
| `/controle/importar` | Importação do TOA com prévia e **histórico com log** |
| `/controle/sub-falhas` | Importa os conjuntos da CLARO (arquivo largo) e escolhe o vigente |
| `/controle/configuracoes` | Status, **baixa e situação** (o de/para dos 168 códigos + o interruptor da baixa automática), indicadores de qualidade e **tabela de pontuação** (1.021 regras) |
| `/controle/administracao` | Usuários (com RG, nascimento e skill), cargos, perfis de acesso, matriz de permissões e **contratos apagados** (o log da exclusão definitiva) |
| `/controle/visita/:id` | Detalhe completo do contrato, com histórico e transferência |
| `/campo` e `/campo/visita/:id` | Agenda e execução do técnico (tema claro, alvo de toque 48px): a caminho → cheguei → baixa com sub-falha → impedimento com observação → finalizar, e o **passo a passo com o login** de quem fez cada etapa |

### E o aplicativo — `campo/`, Expo SDK 57 (Android e iPhone)

Roda hoje no **Expo Go**, sem loja e sem build. Ver `campo/README.md` e
D-112 a D-116.

| Tela | O que faz |
|---|---|
| Entrar | mesmo login do sistema, sessão guardada no aparelho |
| Agenda | o dia em uma chamada só (`agenda_do_campo`): **a fazer · baixadas**, minha produção do mês, estado do GPS e fila de evidência esperando sinal |
| Visita | endereço com rota e telefone, O.S. com as duas baixas, **evidência (foto e vídeo)**, **equipamento**, histórico com login, e a distância até o endereço |
| Captura | câmera e vídeo (teto de 60 s), com o tipo da evidência escolhido antes |

O que só o aplicativo faz: câmera e vídeo nativos, GPS de verdade (com
precisão registrada), e **fila offline** — sem sinal a evidência fica no
aparelho e sobe sozinha depois.

---

## As 161 decisões

Todas em `docs/03-DECISOES.md`, com o porquê de cada uma. Resumo por tema:

**Modelagem** — D-001 visita 1→N O.S. · D-013 cabeçalho repetido lido por
posição · D-019 multi-empresa · D-024/025 login TOA é da equipe e muda de
dono · D-027 sub-falha é o segundo nível da causa · D-032 o arquivo da
CLARO é largo, não longo · **D-041 o mesmo contrato é atendido mais de
uma vez** · **D-042 são dois códigos de baixa, e eles divergem** · D-036 a
situação virou cadastro sem virar chave estrangeira

**Dinheiro** — D-018 recálculo retroativo · **D-045 a pontuação é
combinação de O.S. × edificação** · D-038 relatório por contrato e por
O.S. são leituras diferentes · D-057 volume e pontos também

**Segurança** — D-015 `SECURITY DEFINER` checa papel por dentro · D-016
`revoke from public` não remove concessão nominal · **D-050 autoedição
não pode mudar o que dá poder** · D-051 criar login passa por Edge
Function · **D-054 teste de policy vem antes de mexer em policy** ·
**D-055 papel é a barreira, permissão é a granularidade**

**Produto** — D-011 duas linguagens visuais · D-029 carga sob demanda por
causa do técnico no 4G · D-043 excluir é arquivar · D-056 o contrato abre
em janela

---

---

## O dia 08/09 — 23 commits, 14 migrations

Uma sessão inteira de trabalho, na ordem em que aconteceu. Quase tudo
nasceu de o Emanuel olhar a tela e apontar o que estava errado — e em
metade dos casos o defeito era maior do que ele tinha visto.

### O que ele apontou, e o que estava por baixo

| O que ele viu | O que era de fato |
|---|---|
| "Não cadastrei nenhum usuário, por que tem contrato em equipe?" | 9 cadastros de login **semeados por migration**, sem autor, roteando 121 contratos (D-089) |
| "A sugestão não quero que apareça" | A equipe vinha **pré-selecionada** no campo: um clique confirmava um palpite meu (D-089) |
| "Os dois arquivos do TOA são aceitos?" | Sim — e a coluna a mais era o **nome do técnico**, guardado no banco e nunca lido (D-091) |
| "Precisa ter skill: ADESÃO, MANUTENÇÃO, DESCONEXÃO" | `tecnico.skill` é a **chave da comissão**; gravar uma skill sem faixa zeraria o "a receber" (D-094) |
| "Esse *encerrou* tira, o técnico nem encerrou" | `fim` vinha preenchido em atividade só iniciada: a tela mentia em **329 das 947 visitas** (D-103) |
| "Uma W.O. foi reagendada e o sistema baixou" | O importador concluía pelo **status**, não pelo código: **110 contratos com situação errada**, 77 "concluídos" sem terem sido (D-103) |
| "Acho que ele leu a atividade suspensa" | Exatamente isso — e a suspensa virava COM IMPEDIMENTO num contrato já executado (D-104) |
| "Trouxe mais produto do que devia" | Eu tinha errado no D-106: o produto **amarra na O.S. pelo Ponto**, e eu comparei com o número da O.S. (D-107) |

### O que foi construído

**Cadastro e identidade**
- Cadastro sem autor deixou de rotear contrato; `equipe_do_login` exige
  `criado_por` (D-089)
- Técnico se desliga, não se apaga: DELETE só para ADMIN e barrado por
  histórico (D-090)
- O nome do técnico passou a vir da coluna `Recurso` do TOA (D-091)
- RG, nascimento e skill no cadastro de acesso (D-094)

**A regra do dinheiro e da situação**
- **67.485 linhas** do analítico do concorrente cruzadas: 203 dos 206
  códigos de baixa caem sempre na mesma situação (D-097)
- Painel do de/para em Configurações, com a origem de cada regra —
  `análise` ou `cadastro` (D-097)
- O status do TOA **deixou de concluir contrato**: quem conclui é o
  código ou o técnico (D-103)
- Baixa automática ligada, por decisão do Emanuel com os números na mão

**Medição**
- **TEC1** — a regra de aderência à janela lida do painel dele próprio,
  não inventada: 363 padrão, 14 sem padrão no dia (D-099)
- **Rota do Dia**, a terceira visão: 676 km, 38 de 50 bairros com mais de
  um técnico, 50 retornos a bairro já visitado (D-111)

**Operação**
- Exclusão em lote e depois **definitiva**, com log em
  `exclusao_definitiva` para investigação (D-100, D-101, D-102)
- Atividade suspensa não entra mais na importação (D-104)
- Busca por **grupo de contratos**, com ou sem o período (D-105)
- **Produto pendente** lido do "monte de texto" do TOA (D-106, D-107)

**Tela**
- Uma linha de contrato só, em Serviços e em Equipes (D-095)
- A fila de cadastro foi para o rodapé (D-096)
- Grade translúcida, linha da O.S. em dois andares, baixa do TOA cheia e
  da AFLINE vazada (D-092, D-108, D-109)
- Ícones no menu e lateral que abre no hover (D-110)

**Infraestrutura**
- O sistema **entrou no ar**: `gestor-af.pages.dev` (`docs/09-PUBLICAR.md`)

**E, no fim do dia, o aplicativo do técnico** — `campo/`, Expo SDK 57,
Android e iPhone, rodando no Expo Go. Documentado inteiro em
`docs/10-APP-DO-TECNICO.md`; aqui o resumo:

| O que ele pediu | O que virou |
|---|---|
| *"técnico tem que tirar foto, vídeos e usar a geolocalização"* | câmera e vídeo nativos, GPS com precisão registrada, e **fila offline** para quando o sinal cai (D-112) |
| *"o técnico só pode baixar se estiver ligado"* | **ligado é o GPS** — perguntei antes de escrever. `baixar_os` e o encerramento recusam a chamada do campo sem coordenada (D-113) |
| *"o técnico não tem o poder de tirar do cancelado, reagendado, executado"* | baixa dada não se desfaz e situação terminal não volta. Achei um buraco: a trava de 032 **deixava `REAGENDAMENTO` passar** — justamente o que a baixa automática aplica 1.075 vezes (D-114) |
| *"ele vai poder editar foto depois de baixado, ou anexar equipamento ou foto não lançada"* | anexo sobrevive à baixa, **no dia do contrato** — janela escolhida por ele entre três (D-115) |
| *"vamos ter que melhorar e fazer melhor"* (sobre as telas do concorrente) | o mapa das 12 telas deles está em `docs/10`, com o que copiamos, o que recusamos e por quê |

Três coisas que o concorrente faz e nós recusamos, de propósito:

1. **Ele pergunta "Você está na casa do cliente? SIM/NÃO"** com a
   permissão de localização concedida. Autodeclaração não é prova — nós
   medimos.
2. **Abre com um menu de doze ícones**, e o trabalho do dia é um deles.
   A nossa tela inicial é a agenda.
3. **Mostra `#N/A` e `00:00:00` na cara do técnico.** Campo vazio some;
   não vira texto.

A parte que importa: **as quatro regras moram no banco** (055), não na
tela — e têm bateria própria, `testar_campo()`, 14 cenários, INVOKER,
com fixture própria e limpeza garantida (056).

### Erros meus, registrados

Ficam aqui porque custaram tempo e podem voltar:

1. **Afirmei que o produto não amarrava na O.S.** Comparei o id do item
   com o número da O.S., não bateu, e conclui que não havia vínculo. Era
   o **Ponto** — coluna que eu tinha em mãos e não olhei (D-107).
2. **Tirei o rótulo "Baixa TOA" para reduzir ruído** e as duas baixas
   ficaram idênticas na tela (D-108 → D-109).
3. **Tirei a coluna Data da visão de equipe** por economia; ela fazia
   falta (D-102).
3b. **Quase deixei duas `baixar_os` no banco.** Acrescentar parâmetro com
   default parecia inofensivo — mas as duas assinaturas casam com a mesma
   chamada de argumentos nomeados, e o PostgREST recusa por ambiguidade.
   Derrubar a antiga e atualizar os chamadores era o único caminho.
4. **`unaccent_simples` não existe** neste banco, e variável record
   chamada `v` colide com o alias `v` da tabela (D-099).
5. **Filtrei `codigo_baixa` por empresa**, e ele é catálogo global — a
   função recusava um código que existe (migration 046c).

---

## Defeitos do sistema atual que já corrigimos

1. **Código de baixa duplicado por caixa.** `409 - Servico Concluido` e
   `409 - SERVICO CONCLUIDO` eram contados separado.
2. **Supervisor como texto livre.** Três grafias da mesma pessoa.
3. **Visita achatada em O.S.** Contava deslocamento em dobro.
4. **Jornada dentro da produtividade.** 152 de 504 são `Na Base` e
   `Refeição`.
5. **Improdutiva sem responsável.** O ngestor diz o motivo, não de quem
   é a culpa.
6. **Erro de importação invisível.** 8 O.S. eram recusadas em silêncio;
   o log revelou e o D-041 corrigiu a causa.

---

## O que descobrimos sobre o negócio

- **Uma visita carrega até 10 O.S.** O caso mais comum são 2.
- **O mesmo contrato é atendido mais de uma vez** — 2.656 casos em 17.987
  linhas do relatório mensal. Quebrou de manhã, o cliente reagendou, foi
  de novo à tarde: dois atendimentos, dois deslocamentos, duas baixas, e
  o TOA emite WO nova.
- **A pontuação é combinação de O.S. × edificação.** Tipo de pessoa quase
  não influencia: das 43 combinações presentes em física e jurídica, só 5
  mudam de valor; das 105 presentes em casa e apartamento, 43 mudam.
- **São dois códigos de baixa**, e eles divergem em 13.021 das 17.987
  linhas. A da AFLINE é a que manda no comissionamento.
- **A LPU distingue DESLOCAMENTO de AGREGADA.** A primeira O.S. do
  endereço paga cheio; as demais, reduzido.
- **Retorno de Credenciada é desconto**, e teve a pior taxa de conclusão
  do dia 04/09: 51,6%.

---

## Pendências abertas — consolidado em 19/10/2026 (somar as seções de 25/10, 24/10 e 20/10 logo abaixo)

**Comece por aqui.** As seções datadas abaixo são o histórico de cada leva;
esta é a lista do que AINDA está aberto, juntando todas, por quem tem de agir.
Riscado nas seções de baixo = resolvido.

### A · Decisão do Emanuel

| O quê | Onde está | O que falta |
|---|---|---|
| **Família do código 425** (TROCA DE TECNOLOGIA) | D-184 | Ficou EQUIPAMENTO provisória, marcada "a revisar". Confirmar ou dizer a certa (dá para trocar em Configurações › Baixa e situação). |
| **Botões "Impedimento" / "Registrar impedimento"** | D-179 | O status virou "Ticket de suporte"; os botões que levam a ele, não. O exemplo do campo é "cliente ausente", que é impedimento do cliente, não suporte. Renomear ou deixar? |
| **3 e-mails com cara de erro** | D-177 | `…@gmail.comc` (062), `…@gmal.com` (036), `…@gmail.com.br` (015): entram como login, mas "esqueci a senha" não chegaria. |
| **Entrada do site** | D-175 | Números ilustrativos; autorização de imagem da foto do time; foto de cliente vem do Unsplash. |
| **Regras de dinheiro ainda não levantadas** | `business-rules.md` › Em aberto | `pontos_equipe`, metas/faixas de MANUTENÇÃO e DESCONEXÃO, a LPU, 34 regras `CONFERIR`, retenção de evidência. |

### B · Ação na operação (não precisa de código)

| O quê | Como |
|---|---|
| **Instalar o APK 0.5.0** nos celulares (substitui o 0.3.0; o 0.4.0 pode ser pulado) | Ver a seção de 25/10: só o 0.5.0 recebe as atualizações pelo ar daqui em diante (D-213). Instala por cima (mesmo pacote e assinatura). |
| **Cadastrar os buckets que faltam** | Configurações › Buckets do TOA, na cidade de cada um: MAN-AFLINE_ADM, BSB-AFLINE_14/15_VT, CWL, CXS, ITZ, JIP, MBA, PIT, PMJ (11 já cadastrados). Arquivo de bucket não cadastrado é recusado na importação. |
| **Data de contratação dos 55 técnicos** | Opcional, um a um em Administração › Editar cadastro (D-178). |
| **5 fotos órfãs no Storage** | Da limpeza de 17/10; o SQL não apaga arquivo. Painel do Supabase › Storage › evidencia (D-177). |

### C · Verificação que ninguém fez ainda

O assistente não entra logado (senha de conta real não passa por ele) e não
tem o celular. Tudo abaixo foi publicado e o banco por trás foi testado —
falta o olho de quem usa.

| O quê | Por quê |
|---|---|
| **Primeira atualização pelo ar** no 0.3.0 | Publicar uma (`campo/README.md`) e conferir que chega em até duas aberturas do app (D-186). |
| Card **TEC1 - Atendimento no Prazo**, tela de **códigos de baixa**, coluna/filtro **Tecnologia** no Exportar e em Relatórios | D-185, D-187, D-188 — vistos só sem login. |
| **Seletor de cidade** clicado; cartão "Bucket do TOA" com arquivo arrastado | D-180 — testados no banco, não na tela. |
| **GPON contra um gabarito de Manaus** | A regra (skill PON) não foi conferida contra um analítico rotulado: o de GPON não tem Manaus (D-188). Com um analítico de GPON de Manaus, cruzar pela O.S. |
| No APK: trava de **GPS simulado**, **rastro com o app fechado**, botões **Reagendar/Cancelar visita**, e a causa do **app fechando** | D-171, D-172. Se fechar: `select criado_em, tipo, mensagem, contexto, versao, aparelho from erro_app order by criado_em desc;` |
| Planilha de cadastro aberta no **Excel de verdade**; **lote com acessos** logado; **controlador** barrado na importação de cadastro | D-176. |

### D · Melhorias técnicas conhecidas (nenhuma urgente)

| O quê | Por quê |
|---|---|
| **TEC1 calculado em dobro na importação** | ~0,5 s a ganhar tirando o cálculo por linha do `importar_toa_interno` (a reconciliação já recalcula) — D-181. |
| Cache de **`eh_gestor()` / `minha_empresa()`** na transação | ~4.800 chamadas cada no painel de Equipes; não feito porque a tela já abre em 2,4 s — D-183. |
| **`testar_policies` criar o próprio contrato** | O cenário "CONTROLADOR exclui contrato" depende de existir contrato no banco (ficou 16/17 enquanto não havia) — D-178. |
| **Mesmo login TOA em duas cidades** | `vincular_tecnico_ao_usuario` acha o técnico pelo login sem olhar a cidade (`limit 1`) — D-176. |
| **`tecnico.foto_url` sem uso** | Substituída por `perfil.foto_path` (D-180); pode sair numa migration. |
| **TEC1 "Sem tratamento"** | Fora da conta por decisão (D-187). Se a importação do fim do dia virar garantida, dá para seguir o livro. |
| Página **`/campo`** da web; **"Esqueci minha senha"** por e-mail | D-172: alinhar ou aposentar a página; e-mail exige SMTP. |

---

## Pendente em 25/10/2026 (madrugada) — prova, lugar da baixa e expurgo (D-215 a D-217)

Migrations **134 a 137**; web publicada; **app precisa de atualização pelo ar** (o envio do
GPS e o recado da prova são JS — não exigem APK novo). Baterias **26/26** e **29/29** (dois
cenários novos); nenhuma tabela sem RLS; nenhuma `SECURITY DEFINER` para o `anon`.

### Resolvido nesta leva

- **Sumiu do TOA em andamento** (D-215): a importação não mexe — marca, escreve no histórico,
  avisa o técnico e acende sinal na central. A marca sai quando volta à planilha ou quando
  alguém corrige o status à mão.
- **Onde o técnico estava na baixa** (D-216): o rastro do celular cobre a baixa feita no TOA;
  o selo diz a fonte. A coordenada da justificativa do TOA virou dado próprio — **não** é o
  lugar da baixa (medido: 3,7 km em média, observações de deslocamento).
- **De onde a foto foi enviada** (D-216): coluna nova, preenchida pelo app na câmera e na
  galeria.
- **3 evidências para pontuar** (D-217), com prazo até o fim do dia seguinte, e **dos
  contratos novos em diante** (D-217b) — o passado pontua como sempre pontuou.
- **Expurgo por lote de WOs** em Administração, com escopo por lote e motivo obrigatório.

### Depende do Emanuel

| O quê | Por quê |
|---|---|
| **Avisar a equipe antes do corte** | `evidencia_obriga_desde` nasce em **26/10**. De lá em diante, contrato concluído sem 3 fotos não gera ponto para o técnico (gera para a empresa). Dá para adiar mudando o parâmetro. |
| **Instalar a atualização do app** | A atualização pelo ar leva o envio do GPS e o recado "faltam N evidências". Quem não abrir o app não recebe. |
| **Apagar evidência fora do dia** | O técnico passa a **anexar** até o fim do dia seguinte, mas **apagar** continua só no dia (D-204). Se ele anexar errado no dia seguinte, não consegue corrigir sozinho. |
| **Prazo e mínimos** | 3 / 1 / 1 dia são parâmetros. Se a CLARO exigir foto por tipo de serviço, vira tabela nova. |

### Verificação que ninguém fez ainda

| O quê | Por quê |
|---|---|
| **O recado da prova no celular** | Compila e o `tsc` está limpo; não foi visto num aparelho. |
| **O rastro cobrindo a baixa de verdade** | Hoje são 58 pontos de 1 técnico — 4 de 1.424 baixas. Só com o APK no campo dá para medir. |
| **O aviso de sumiço chegando ao técnico** | O caminho foi provado no banco (aviso criado); ninguém viu no sino do celular. |
| **Cenário de `expurgo_pontuacao` nas baterias** | Testado à mão como `authenticated`, não está em `testar_policies`. |

---

## Pendente em 25/10/2026 (noite) — conversa do controle, tela de responder e abas (D-214)

Migration **133**; só web (o aplicativo não precisa de versão nova: diretor e gerente somem
da lista dele pelo cadastro). Baterias **26/26** e **27/27**; nenhuma tabela sem RLS;
nenhuma `SECURITY DEFINER` para o `anon`.

### Resolvido nesta leva

- **O controle escolhe com quem fala** (D-214): a gaveta ganhou **Pessoas** além de
  Técnicos. A conversa entre duas pessoas é tabela nova (`mensagem_interna`), **privada**:
  só as duas leem, nem o ADMIN. Quem recebe sempre pode responder; abrir é que é restrito a
  COP, supervisor e coordenador da cidade ativa.
- **Diretor e gerente fora do chat**: cargos DIRETOR e GERENTE criados; Marcio e Alisson
  saíram de COORDENADOR. Sem grupo, não aparecem no site nem no aplicativo — e continuam
  podendo escrever.
- **Responder ao técnico** mostra **as duas últimas atualizações** do histórico.
- **Aba Responder**: resposta, conversa com o técnico, fotos e histórico numa tela só.
- **Aba Equipamento**: o que o TOA mostra saiu do Detalhe — na página cheia e na janela.
- **Equipes**: o LOGIN do cartão é a matrícula de quem está cadastrado na equipe, sem a
  etiqueta "cadastrado".

### Depende do Emanuel

| O quê | Por quê |
|---|---|
| **Cadastrar COP, supervisor ou coordenador** | Com o diretor e o gerente fora, **a lista de Pessoas está vazia hoje** — a tela diz isso. Ela se enche sozinha quando alguém for cadastrado com um desses cargos (ou perfil de acesso COP/Controlador/Supervisor) na cidade. |
| **Dizer se o ADMIN sem cargo deve aparecer** | Hoje não aparece (não tem grupo). Quem receber uma mensagem dele consegue responder; ninguém consegue COMEÇAR uma conversa com ele. |

### Verificação que ninguém fez ainda

| O quê | Por quê |
|---|---|
| **A conversa entre pessoas, pela tela** | Provada **no banco** como `authenticated` (enviar, ler, responder, terceiro não lê, técnico barrado). Pela tela não dá para provar enquanto não houver duas pessoas com grupo — a lista está vazia por decisão. |
| **O balão do topo somando as duas caixas** | Compilado e conferido na tela com a caixa do campo; sem mensagem interna real, o número das pessoas não foi visto somando. |
| **Cenários na bateria** para `mensagem_interna` | Como em `mensagem_colega`: testado à mão, não está em `testar_policies`. |

---

## Pendente em 25/10/2026 — logo nova, galeria, visor, chat direcionado e cache (D-212, D-213)

Migration **132**; web publicada e conferida no ar (o pedaço de cada tela baixado do ar
igual ao local); **APK 0.5.0 em compilação na EAS** (build `52fd0309`, commit `b2ca05d`).
Baterias 27/27 e 26/26; nenhuma `SECURITY DEFINER` para o `anon`; uma versão só de
`registrar_evidencia` e `enviar_mensagem`.

### Resolvido nesta leva

- **Logo nova** (D-212): ícone do app (era o "A" azul padrão do Expo), ícone adaptativo do
  Android dentro do círculo seguro, abertura nativa escura, tela de entrada com abertura
  animada e animação no login.
- **Visor** de foto e vídeo enviados; **envio da galeria** marcado `da_galeria`, com hora e
  GPS do arquivo (D-213).
- **No TOA**: equipamento e miscelânea separados.
- **Chat com destinatário**: controle, COP, supervisor, coordenador ou técnico; "para você"
  no site (D-213).
- **Cache com teto**: o que subiu sai na hora; faxina na abertura (3 dias, 250 MB), sem
  tocar na fila sem sinal.
- **Expo Go do SDK 57** instalado no celular do Emanuel (a tela nova foi vista nele).

### Depende do Emanuel

| O quê | Por quê |
|---|---|
| **Instalar o APK 0.5.0 em todos os celulares** (no lugar do 0.4.0) | Só ele tem o player de vídeo, a galeria, o ícone novo e a abertura escura. **A atualização pelo ar daqui em diante vai só para o 0.5.0** (a runtime é a versão do app); o 0.4.0 de 24/10 pode ser pulado. Link: o build `52fd0309` na EAS, quando terminar. |
| **Restringir a chave do Google Maps (Android)** | Continua da seção de 24/10 — pacote `br.com.afline.campo` + SHA-1 `E7:22:F9:AD:8F:09:77:D2:48:8F:EE:B5:A0:26:E5:16:20:4D:8C:19` + só Maps SDK for Android. O 0.5.0 é assinado com o mesmo certificado. |
| **Galeria: aceitar qualquer foto?** | Hoje aceita foto/vídeo de qualquer data e só MARCA a origem (D-213). Se a regra for "só de hoje" ou "só com GPS no arquivo", é uma trava a mais — não foi inventada. |
| **Cadastrar COP e supervisores** | O chat direcionado acha a pessoa pelo **cargo** (CONTROLADOR (COP), SUPERVISOR, COORDENADOR) ou pelo perfil de acesso. Em 25/10 só há 2 coordenadores; as abas COP e Supervisor dizem "ninguém cadastrado ainda". |
| **Conferir a tela de entrada nova** | Vista no Expo Go pelo Emanuel; falta o "ok" (ou o ajuste) da abertura e das cores (D-212). |

### Construção que ficou para depois

| O quê | Por quê |
|---|---|
| **Ícone monocromático** (o "temático" do Android 13+) | A perna fina do A ainda falha no recorte. Poucos usam o tema; o ícone colorido está certo. |
| **Cenários na bateria** para `mensagem_colega` e o destinatário de `enviar_mensagem` | Testados à mão como o técnico (terceiro não lê; destinatário fora da lista barrado); não estão em `testar_policies`/`testar_campo`. |
| **Tela da web para a conversa entre técnicos** | Continua da seção de 24/10. |

### Verificação que ninguém fez ainda

| O quê | Por quê |
|---|---|
| **APK 0.5.0 no celular** | Ícone novo no launcher, abertura escura, **câmera funcionando** (a armadilha do image-picker foi pega no `expo config`, não no aparelho), galeria com EXIF de um Android real, vídeo tocando pelo player, e o fechamento no S24 Ultra. |
| **Faxina do cache** | Escrita e compilada; o efeito (MB liberados) só se mede num celular com uso de dias. |
| **"para você" no site com login de coordenador** | Publicado e conferido no código do ar; ninguém mandou uma mensagem direcionada e abriu o site com o login do destinatário. |
| **Galeria sem sinal** | Cai na mesma fila da câmera; não foi provado com o celular sem rede. |

---

## Pendente em 24/10/2026 — app do técnico, importação, Geo-Rota e menus de cancelado (D-201 a D-210)

Migrations **124 a 130** (e 129b) — a **131** (o painel de Equipes obedece ao filtro,
D-211) veio de outra sessão no mesmo dia, commit `c239342`. Web publicada e conferida no ar; app publicado
pelo ar no 0.3.0 até o commit `b3d17a5`; **APK 0.4.0 pronto** (build `cbe14d6c`,
commit `85d9695`). O conserto do Geo-Rota no Expo Go (`38cee08`) não está no APK —
lá ele não faz falta — e vai na próxima atualização pelo ar, para o 0.4.0. Baterias **27/27** (`testar_campo`, 4 cenários
novos) e **26/26**; nenhuma `SECURITY DEFINER` para o `anon`; nenhuma tabela sem RLS.

### Resolvido nesta leva

- **App:** ouvidoria, segmento, TEC1 e produto no cartão e no contrato (D-201); grupo,
  GPON e tipo do TOA, ficha legível, equipe no topo (D-202); TEC1 % no Painel; material
  e equipamento do TOA no contrato, ao lado do que o técnico lançou (D-202); voltar
  atrás no melhor contato e **corrigir equipamento** com a posse da peça errada
  devolvida (D-203); **apagar foto/vídeo** de verdade, só quem enviou, só no dia — mudou
  a regra da 055 (D-204); **sino** de avisos (D-206); **Geo-Rota** — mapa, colegas por
  perto e conversa entre técnicos (D-207); **placar do dia** (D-210).
- **Importação:** o 227087686 preso em "Em execução" (tocado pelo campo, a baixa
  automática era pulada) e o **vai-e-volta** que mandava 2 avisos por sincronização
  (D-205); aviso de **2 contratos em andamento** vindos do TOA (D-206).
- **Site:** "N evidência(s) / N equipamento(s)" na lista; **card de TEC1** abre quem
  perdeu, com supervisor (D-208); **Desatribuído** e **Cancelado pela central**
  separados de Cancelada no Dashboard, Serviços e Equipes, com a origem na linha (D-209).

### Depende do Emanuel

| O quê | Por quê |
|---|---|
| **Restringir a chave do Google Maps (Android)** | Criada em 24/10 no projeto `amazing-coast-h9v0l` ("App do técnico (Android)"). Restrição: **Apps Android** com o pacote `br.com.afline.campo` e a SHA-1 `E7:22:F9:AD:8F:09:77:D2:48:8F:EE:B5:A0:26:E5:16:20:4D:8C:19` (lida do certificado do APK 0.4.0 e conferida com o `openssl`; é o keystore da EAS, o mesmo do 0.3.0) + **Restrições de API**: só Maps SDK for Android. Até restringir, quem tiver o texto usa a cota. A chave NÃO está no Git (`campo/.env` + variável sensível da EAS, D-210); está no manifesto do APK, onde o Maps a lê. |
| **Instalar o APK 0.4.0 em todos os celulares** | Pronto em 24/10: https://expo.dev/artifacts/eas/wu6j_qoEUcCRyQSXAUYeKLQLXtOrGPxI47YZgAizdU8.apk (build `cbe14d6c`, commit `85d9695`, expira em 07/11 na EAS). Instala por cima do 0.3.0 (mesmo pacote e assinatura). Só ele tem o mapa do Geo-Rota e as correções do SDK 57. **Atualização pelo ar daqui em diante vai só para o 0.4.0**: quem ficar no 0.3.0 para de receber (a runtime é a versão do app). |
| **Expo Go do SDK 57 no celular de teste** | A Play Store atualizou o Expo Go para o SDK 58, que recusa o projeto. Instalar o do SDK 57 (`https://expo.dev/go?sdkVersion=57&platform=android&device=true`) e desligar a atualização automática dele. Alternativa: subir o projeto para o SDK 58 (APK novo para todos). |
| **Meta de TEC1: 94 ou 95?** | O livro da CLARO e o Dashboard usam 94% (D-187); o painel de **Equipes** do site ainda usa 95% (`META_TEC1` em `Equipes.tsx`, da 047). Alinhar. |
| **"Cancelado" no placar do dia** | A produtividade tira TODO cancelado (desatribuído, central e por código, D-210). Se o cancelado por código (302 desistência…) tiver de contar como "não feito", é uma linha. |
| **"0 de 2 O.S. baixadas" em contrato concluído pelo TOA** | O app conta só a baixa da AFLINE; contrato fechado pela baixa automática mostra "0 de 2" em vermelho. Contar a do TOA, ou mostrar as duas? |
| **Correção do lançamento do técnico pelo TOA** | Pedido de 24/10: "só será feito as correções se tiver lançado errado". Hoje a leitura do TOA é SÓ LEITURA (D-192, D-202). Falta dizer: o que é "errado" (serial? quantidade?), quem corrige (o sistema sozinho ou o controlador), e se o que só o TOA tem vira lançamento (sai do saldo do técnico). |
| **Geo-Rota: ciência do texto v2** | Cada técnico dá "Estou ciente" de novo no próximo login; quem não der não aparece para os colegas (D-207). Avisar a equipe. |

### Construção que ficou para depois

| O quê | Por quê |
|---|---|
| **Tela da web para a gestão ler a conversa entre técnicos** | O banco já deixa (escolha do Emanuel: "controlador também lê", D-207); falta a tela. |
| **38 contratos de 24/10 "Em execução" com o TOA dizendo "concluído"** | Visto de passagem: provavelmente O.S. sem código ou com código sem cadastro (a baixa automática só fecha com TODAS as O.S. com código de destino conhecido). Investigar. |
| **Cenário de `testar_policies` para `mensagem_colega`** | Testado à mão como o técnico (o terceiro não lê), mas não está na bateria. |
| **9 arquivos no bucket `evidencia` para 4 linhas** | As 5 órfãs de 17/10 (abaixo) — agora o técnico apaga as próprias, mas essas não têm linha. |

### Verificação que ninguém fez ainda

| O quê | Por quê |
|---|---|
| **APK 0.4.0 no celular** | O mapa com a chave nova (no Expo Go o mapa usa a chave do Expo); e se as correções do SDK 57 resolvem o **fechamento no S24 Ultra** (Android novo). Se fechar: `select * from erro_app order by criado_em desc`. |
| **Apagar foto pelo Storage de verdade** | A regra foi testada pela função como o técnico; o apagar do arquivo pela API do Storage só se prova pelo celular (D-204). |
| **Corrigir equipamento, voltar atrás no contato, sino, placar e Geo-Rota com o dedo** | Testados no banco e no Expo Go do Emanuel em partes; não com um técnico em rota. |
| **Aviso de 2 em andamento numa importação real** | Ensaio desfeito com 2 contratos do Nicacio; ainda não aconteceu de verdade (D-206). |
| **A reimportação seguinte do 227087686 e dos "iniciado"** | A 128 foi ensaiada com a importação das 13:06; a próxima sincronização real deve gerar 0 vai-e-volta. Conferir no histórico de um concluído. |

---

## Pendente em 20/10/2026 — VT de Manaus, filtros e varredura por bucket (D-194 a D-197)

Migrations **119 a 123**; web publicada e conferida no ar (o pedaço de cada tela
baixado do ar tem a mudança); extensão **0.6.0** no repositório. Baterias 26/26 e
23/23; nenhuma `SECURITY DEFINER` para o `anon`.

### Resolvido nesta leva

- **Técnicos da manutenção (VT)** cadastrados pelo Emanuel com a planilha ajustada
  (D-194): 12 técnicos MANUTENÇÃO com acesso, 12 equipes, 12 logins roteados; os
  74 contratos da VT de hoje estão nas equipes deles (conferido no banco).
- **Filtro por tipo de login** em Administração › Usuários (D-194).
- **Filtro de bucket** (mais de um) no Dashboard, Serviços e Equipes; a lista abre
  por portal porque o cartão de baixo a cobria (D-195).
- **Matriz Grupo × situação do Dashboard** passou a obedecer aos filtros — recebia
  a lista sem filtro desde que foi criada.
- **Varredura por bucket** (0.5.0, D-196) e **escolhida** (0.6.0, D-197).
- **Toda visita com endereço tem edificação** (122, D-198): BECO, LOJA, APTO ou
  CASA; QUALQUER só na jornada. Pontos de todas as visitas 909,10 → 909,58.
- **Ouvidoria e segmento** no contrato, nos filtros e no Exportar (123, D-199).

### Depende do Emanuel

| O quê | Por quê |
|---|---|
| **Meta e faixas da skill MANUTENÇÃO** | Os 12 técnicos da VT têm skill MANUTENÇÃO, e a meta/faixa dela continua em aberto (`business-rules.md` › Em aberto). Sem faixa, o "a receber" deles fica zerado — a skill é a chave do dinheiro (D-094). Configurar em Administração › Metas quando houver o número. |
| **Matrícula do ponto dos 12 da VT** | Ficou vazia: na planilha era igual ao login TOA (D-194). Quando houver a matrícula real, editar ou reimportar. |
| **Varrer só os encerrados?** | Hoje a varredura lê o nome de TODO contrato sem nome (qualquer situação) e o equipamento só dos encerrados. A 0.6.0 deixa escolher por vez; se o padrão deve mudar, é decisão. |
| **Edificações de julgamento** | "PORT", "BSD 1", "ME", "SN" e condomínio sem bloco ficaram CASA; TV com LJ ficou LOJA (D-198). Se alguma estiver errada, é uma linha na regra. |
| ~~**Ouvidoria no aplicativo do técnico?**~~ | Resolvido em 21/10 (124, D-201). |
| **Recarregar a extensão 0.6.0** | `chrome://extensions` → recarregar a AFLINE, e F5 na aba do TOA. |

### Verificação que ninguém fez ainda

| O quê | Por quê |
|---|---|
| **Varredura 0.6.0 no TOA de verdade** | Troca de bucket e painel de escolha testados numa página que imita o Console e numa cópia do painel; o navegador do assistente não entra no TOA. Às 13:06 de 20/10 a 0.5.0 já tinha varrido 6 da VT — sinal de que o clique na árvore funciona. |
| **Os 64 erros da varredura das 10:51** | O motivo de cada um só fica no registro local da extensão (painel), não no banco. Se repetir, ler "Últimos acontecimentos" e, se for o caso, gravar o motivo no banco. |
| **Filtros novos logados** (tipo de login, bucket, matriz do Dashboard) | Publicados e conferidos no código do ar; ninguém clicou com login além do Emanuel. |

---

## Pendente em 19/10/2026, noite — Sincronismo com o TOA (D-189)

Migrations **110 a 113**; tela Sincronismo e extensão `extensao-toa/`. Sincroniza com o login de quem opera (113).
Baterias 26/26 e 23/23. Web publicada em 19/10 e conferida no ar (o arquivo da tela igual ao local).

| O quê | Por quê |
|---|---|
| **Ligar em Sincronismo** | Marcar MAN-AFLINE e MAN-AFLINE_01_VT, escolher o intervalo. Nasce desligado. |
| ~~Ninguém viu a extensão rodar~~ | **Rodou em 19/10, 20:44** no Chrome do Emanuel: MAN-AFLINE, 346 atividades → 339 atualizados, 0 erros, 7,7 s. Documentada em `docs/11-EXTENSAO-TOA.md`. |
| **Quanto dura a sessão do TOA parada** | Desconhecido. A tela acusa "a sessão do TOA caiu"; se cair muito, pensar no login automático (Cloudflare). |
| **Medir a importação de 15 em 15 min** | Arquivo igual não reimporta (só depois de 1 h). Conferir no primeiro dia quantas rodadas viraram importação e o tempo de cada uma. |

## Pendente em 19/10/2026, tarde — TEC1, migração e GPON (D-187, D-188)

Migration **109**; web publicada e conferida no ar. Baterias 19/19 e 23/23.

| O quê | Por quê |
|---|---|
| **GPON sem conjunto rotulado do TOA** | A regra (skill PON) não pôde ser conferida contra um gabarito: o analítico de GPON não tem Manaus e nenhuma O.S. dele casou com os arquivos do TOA. Quando houver um analítico de GPON de Manaus, cruzar pela O.S. |
| ~~Migração: tipo 57 (MUDANCA DE PACOTE DIGITAL)~~ | **Decidido em 19/10**: não é migração — não aparece no analítico (D-188). |
| **TEC1 "Sem tratamento"** | Fora da conta por decisão (D-187). Se um dia a importação do fim do dia for garantida, dá para seguir o livro e contar como sem padrão. |
| **Card do TEC1 na tela logada** | Publicado e conferido no ar; a conta testada no banco. Não visto logado pelo assistente. |

## Pendente em 19/10/2026 — códigos editáveis e app 0.3.0 (D-184 a D-186)

Migrations **107** e **108**; web publicada e conferida no ar; APK **0.3.0**
(com `expo-updates`) enviado à fila do EAS. Baterias: `testar_policies()`
19/19, `testar_campo()` 23/23.

| O quê | Por quê |
|---|---|
| **Instalar o APK 0.3.0** nos celulares | **Build pronto em 19/10, 14:35**: https://expo.dev/artifacts/eas/4N1JoDaHtvbGgfupxyOAd2scG7Q3DNM47iR6meEIJi0.apk. O 0.2.1 não tem `expo-updates` e não recebe atualização. Depois do 0.3.0, mudança de JavaScript vai por `eas update` (`campo/README.md`). |
| **Primeira atualização pelo ar** | Não testada: depende do 0.3.0 instalado. Conferir que chega em até duas aberturas do app. |
| **Família do 425** | EQUIPAMENTO provisória, marcada "a revisar" (D-184). Pergunta ao Emanuel. |
| **Tela de códigos logada** | Compilada e publicada; o banco por trás testado (D-185). Não vista logada pelo assistente. |
| **Buckets que faltam** | 11 cadastrados (ARN-AFLINE → Araguaína em 19/10). Faltam MAN-AFLINE_ADM, BSB-AFLINE_14/15_VT, CWL, CXS, ITZ, JIP, MBA, PIT, PMJ. |

## Pendente em 17/10/2026, tarde — cidade ativa, buckets e foto (D-180)

Migrations **103 a 106**; web publicada e conferida no ar; app com a foto
no código, **sem APK novo**. Baterias (depois da 106, com a rota de 17/10
importada): `testar_policies()` **19/19**, `testar_campo()` 23/23.

| O quê | Por quê |
|---|---|
| **Cadastrar os buckets que faltam** | Só 10 foram semeados (os que os arquivos provaram). Faltam, entre outros, MAN-AFLINE_ADM, BSB-AFLINE_14/15_VT, CWL, CXS, ITZ, JIP, MBA, PIT, PMJ — Configurações › Buckets do TOA, na cidade de cada um. |
| ~~ARN-AFLINE: de qual cidade?~~ | **Resolvido em 19/10**: Araguaína (D-185). |
| ~~APK novo~~ | **19/10**: APK 0.3.0 gerado, já com atualização pelo ar (D-186). |
| **Testar a importação com o arquivo de hoje** | O cartão "Bucket do TOA" da tela de importação foi testado pela função por trás dele, não com um arquivo arrastado. |
| **Seletor de cidade clicado** | A troca foi testada no banco como ADMIN; não foi clicada na conta do Emanuel para não mudar a cidade dele. |
| **TEC1 calculado em dobro na importação** | ~0,5 s a ganhar tirando o cálculo por linha do `importar_toa_interno` (a reconciliação já recalcula). Não feito: mexe na função grande (D-181). |
| **`tecnico.foto_url` sem uso** | Substituída por `perfil.foto_path`. Pode sair numa migration futura. |

## Pendente em 17/10/2026 — Manaus importada, contratação e Ticket de suporte (D-178, D-179)

Manaus importada pelo Emanuel: **55 técnicos, 55 acessos, 55 logins roteados**,
todos com skill **ADESÃO** (a planilha veio sem skill; gravado a pedido). Migrations
**101** (data de contratação) e **102** (rótulo "Ticket de suporte"); web publicada e
conferida no ar. Baterias: `testar_policies()` **16/17**, `testar_campo()` 23/23.

| O quê | Por quê |
|---|---|
| ~~`testar_policies` 16/17 sem contrato no banco~~ | **Resolvido em 19/10**: com a rota importada, 19/19. A melhoria (a bateria criar o próprio contrato) está na lista consolidada. |
| **Botões "Impedimento" / "Registrar impedimento"** | O status virou "Ticket de suporte", os botões de ação não. Pergunta ao Emanuel: renomear também? (D-179) |
| ~~APK com o nome novo~~ | **19/10**: está no APK 0.3.0 (D-186). |
| **Data de contratação dos 55** | Opcional, um a um em Editar cadastro. A planilha não serve para quem já tem acesso (D-178). |
| **Salvar a data pela tela** | Conferido o campo e o tempo de casa na janela, sem salvar (dado real); a gravação foi testada no banco como ADMIN e como técnico. |

## Pendente em 14/10/2026 — cadastro de cidade por planilha (D-176)

Migration **100**; Administração › **Importar planilha** (só ADMIN); web
publicada e conferida.

| O quê | Por quê |
|---|---|
| ~~Importar Manaus (55 técnicos)~~ | **Feito em 17/10** pelo Emanuel: 55 acessos, 55 logins roteados (D-178). |
| **5 fotos órfãs no Storage** | Da limpeza de 17/10; o SQL não apaga arquivo. Painel do Supabase › Storage › evidencia. |
| **Testar o lote inteiro logado, com acessos** | A criação de acessos em lote cria contas reais e não se desfaz sem a `service_role`. Sugestão: primeiro com 2 ou 3 pessoas de teste numa cidade de teste. |
| **Abrir a planilha no Excel de verdade** | As listas e as notas foram conferidas lendo o arquivo; ninguém clicou numa lista suspensa no Excel. |
| **Controlador chamando a importação** | Deve ser barrado (só ADMIN); não havia controlador sem ADMIN no banco para provar. |
| **Mesmo login TOA em duas cidades** | `vincular_tecnico_ao_usuario` procura o técnico pelo login sem olhar a cidade (`limit 1`). A prévia avisa quando o login existe em outra cidade. |

## Pendente em 27/09/2026, noite — baixa coerente, app que diz onde fechou, entrada nova (D-172 a D-175)

Migrations **098** e **099**; web publicada e conferida no ar; app em
**0.2.1** no código (sem APK gerado). Baterias: `testar_policies()` 16/16,
`testar_campo()` **23/23**.

### Resolvido nesta leva

| O quê | Como |
|---|---|
| Aviso "contrato novo" mostrava o nome da planilha | `aviso_do_evento` grava o `NOVO` sem detalhe; avisos antigos limpos (098) |
| Baixa com 409 ia para "Na entrada" e tirava contrato do encerramento sem motivo | Código de baixa só com Concluída/Cancelada/Reagendamento, e do **destino** certo (098, `confere_destino_das_baixas`) |
| Técnico "finalizava" com código de reagendamento | "Finalizar" = CONCLUIDA; a mesma conferência vale no campo, e o botão do app segue o código: Finalizar / Cancelar / Reagendar visita (099) |
| Encerrado voltava a aberto sem motivo pela web | Só `reverter_situacao` — controlador ou gestão, com motivo (099) |
| Botão direito e "⋯" mortos em Equipes | `MenuContrato` único, por portal; ganhou **Mudar status…** |
| Jornada (Refeição, Na Base) parecia contrato quebrado | Nome da atividade + etiqueta cinza **Informativo** |
| Seção amarela "login sem equipe definida" | Removida de Equipes (vínculo continua em Administração) |
| Entrada do site | Design "Entrada Gestor AF": Brasil inteiro, foto do time, abertura 1× por navegador |
| `app.json` com acento embaralhado | Consertado; versão 0.2.1 |

### Continua pendente — precisa do celular

| O quê | Por quê |
|---|---|
| ~~Gerar o APK 0.2.1~~ | **Substituído pelo 0.3.0** (19/10), que já traz tudo do 0.2.1. |
| **Achar a causa do app fechando** | Não está provada — está cercada (D-172). Depois de instalar o 0.2.1, se fechar de novo: `select criado_em, tipo, mensagem, contexto, versao, aparelho from erro_app order by criado_em desc;` — o passo em que fechou sobe no início seguinte |
| **Testar com o dedo** o botão "Reagendar visita" / "Cancelar visita" e a lista de códigos travada no desfecho da 1ª O.S. | `tsc` e `expo export` passam; nada foi tocado num aparelho |
| Provar a trava de GPS simulado e o rastro em segundo plano | Herdado da D-171 — só no APK |

### Continua pendente — depende do Emanuel

| O quê | Por quê |
|---|---|
| **Números reais da entrada** | Os da tela são **ilustrativos** (decisão do Emanuel). Quando houver dado de verdade (AFLINE 360, pesquisa da CLARO), trocar em `app/src/lib/entrada.ts` e escrever a fonte |
| **Autorização de imagem** da foto do time | A entrada é pública, antes do login: os rostos aparecem para qualquer um com o endereço |
| Foto de cliente real | "Cliente conectado" é foto do Unsplash, carregada de lá — se o Unsplash sair do ar, o quadro fica vazio |
| "Esqueci minha senha" por e-mail | Hoje diz que a Administração troca. E-mail exige SMTP e página de nova senha |
| Página `/campo` da web | Ainda mostra "Finalizar" sempre; o banco recusa com mensagem se o código não for de conclusão. Alinhar ao app ou aposentar a página |
| Contrato **226470184** | Passou por "Na entrada" com 409 antes da 098; às 20:39 foi baixado de novo como Concluída pela tela — conferir se é o desfecho certo |

---

## Pendente em 27/09/2026 — rastro, local da baixa e monitoramento (D-170)

Migration **096**; tela nova **Monitoramento** (`/controle/monitor`);
botão **Atualizar** em Serviços e Equipes; selo do **local da baixa** nas
listas, na janela do contrato e no analítico; **melhor contato** no app.

### Resolvido no mesmo dia (D-171, migration 097)

| Pendência | Como fechou |
|---|---|
| APK | Gerado (versão **0.2.0**, perfil `preview`) com o rastro em segundo plano, a guarda do GPS e o aviso |
| Retenção do rastro | **90 dias**, expurgo diário no pg_cron (03:17 em Manaus) |
| Aviso ao técnico | "Estou ciente" versionado, gravado em `ciencia_rastro`; o Monitoramento mostra quem não deu |
| Geocerca e garagens | Desenhadas no Monitoramento; quem desenha decide equipes e aviso; alerta no sino |
| Antifraude | GPS desligado/negado/simulado pausa o app; simulado trava baixa e status no banco |

### Continua pendente (D-171)

| O quê | Por quê |
|---|---|
| **Texto do aviso pelo jurídico** | O texto descreve o que o sistema faz; não é parecer. Trocou o texto, suba `VERSAO_AVISO` em `campo/src/ui/AvisoRastro.tsx`. |
| **Provar a trava de simulação no aparelho** | Instalar um app de local fictício, escolher em Opções do desenvolvedor e ver o app pausar e a central receber "Localização simulada". Só no APK. |
| **Medir o monitor com volume real** | Emanuel pediu para medir durante os testes (`monitor_tecnicos` como `authenticated`). |
| **iPhone** | Não tem a marca de simulação; lá o antifraude é só GPS desligado/negado. |

### Depende do Emanuel (levantado na D-170)

| O quê | Por quê |
|---|---|
| ~~**Gerar o APK novo**~~ (feito, D-171) (`npx eas-cli@latest build --platform android --profile preview`) | O rastro **com o app fechado** só existe no APK: o Expo Go não tem o serviço de localização em segundo plano. No Expo Go o rastro grava só com o app aberto. O `app.json` já tem as permissões e o plugin configurados. |
| **Retenção do rastro** | Não há expurgo. O concorrente guarda **90 dias**. ~100 técnicos × ~20 pontos/h × 10 h ≈ 20 mil linhas/dia — o plano Free aguenta meses, não anos. É LGPD (dado de empregado) e custo: decisão da AFLINE. |
| **Aviso formal ao técnico sobre o rastro** | O app avisa na Agenda e antes de pedir a permissão. Termo assinado / política interna é jurídico, não código. O concorrente mostra um "Aviso sobre monitoramento de localização" com "Estou ciente". |
| **Play Store** | Publicar na loja com localização em segundo plano exige declaração e vídeo justificando o uso. Para APK instalado direto (perfil `preview`) não se aplica. |
| **Geocerca e garagens** | O concorrente tem; ninguém definiu qual cerca, qual garagem nem o que acontece ao sair. |
| **Km por mês com custo/km** | O "Km Rodados" do concorrente cruza km do rastro com o abastecimento. Temos os dois dados (rastro + Frota); falta a tela. |

### Ninguém testou com o dedo

- A caixinha do melhor contato ao concluir, no celular.
- O rastro em qualquer celular (com app aberto no Expo Go; em segundo plano no APK).
  Alguns fabricantes (Xiaomi, Samsung com economia de bateria) matam serviço em
  segundo plano — só o teste de um dia inteiro no aparelho real diz.
- `monitor_tecnicos` com volume real de rastro: medido só com 40 pontos (21 ms).

## Pendente em 26/09/2026 — o que ficou desta leva

A leva de 26/09 (D-162 a D-165, migrations 086 a 089c) fechou o
estoque em relação ao concorrente, criou a **Frota** e publicou tudo.
**A web está no ar e em dia com o banco** — conferido baixando o bundle
de `gestor-af.pages.dev`: o `index.js` publicado é o mesmo do build e os
pedaços `Almoxarifado-*.js` e `Frota-*.js` contêm as telas novas.

### Resolvido desde 23/09

| Pendência de 23/09 | Como fechou |
|---|---|
| A web não estava publicada | Publicada em 26/09 (acima) |
| A lista real de miscelânea | **418 itens** copiados do Alfa Gestor da AFLINE (089b): ferramenta, EPI com C.A., material com SAP e valor, acessório |
| Inventário cíclico | Existe: **contar** por item vira AJUSTE com motivo, e o Kardex mostra (089-E) |
| Confirmação do romaneio com prova | Aceite pelo celular com **biometria ou senha**, método gravado (087-D) |
| Frota | Módulo inteiro (088): veículos, condutor = técnico, abastecimento, consumo real, exceções, manutenção |

### Continua pendente — depende do Emanuel

| O quê | Por quê |
|---|---|
| **Trazer os 154 veículos** do Alfa Gestor | Placa, apelido, modelo, ano, chassi, renavam e rastreador vêm limpos; o **condutor não** (lá é a equipe, e cada equipe tem dois técnicos). O banco de produção tem **zero** veículo. |
| **"REDE PRÓPRIA/ALUGADA" e "Vale Transporte"** | Não couberam em propriedade × pernoite. Se forem carro da equipe de rede e técnico sem carro, é outra dimensão. |
| **Corte de 1/3 do "km muito baixo"** | Escolha nossa (088-G), comparando o carro com ele mesmo. A AFLINE pode ter outro. |
| **Texto jurídico do termo de responsabilidade** | O texto em `app/src/lib/termo.ts` (`DECLARACAO`) é neutro e nosso. |
| **Técnico pede abastecimento pelo celular** | O banco aceita "em aberto"; não há tela no app. No concorrente, 7 de 195 vêm do condutor. |
| **Baixa de material pelo próprio técnico, na visita** | Hoje a baixa por contrato é do almoxarifado (como no concorrente). Levar para a tela de baixa do app é o próximo passo natural. |

### Continua pendente — ninguém testou com o dedo

- As telas novas do almoxarifado e da frota **clicando** (as sessões de
  desenvolvimento não têm a senha do admin; o banco foi testado como
  `authenticated`, cenário a cenário — ver D-162 a D-165).
- O app no celular: **biometria** (só se prova no aparelho; no Expo Go o
  iPhone cai no código do aparelho em vez do Face ID), a tela
  **Transferir** e "Meu material".
- Para o app funcionar, o login precisa estar vinculado a um técnico
  (`tecnico.usuario_id`).

---

## Pendente em 23/09/2026 — o que ficou desta leva

> **Atualizado em 26/09:** o item 1 (web não publicada) e parte do 3 e do
> 6 foram resolvidos — ver a seção acima. O resto continua valendo.

Registrado no fim da sessão que entregou: paginação de contratos, a Rota
como mesa de despacho, o mapa do Google, o almoxarifado (fases 1, 2 e 3)
e os ajustes do Dashboard. Ordenado por urgência, não por tamanho.

### 1. A WEB NÃO ESTÁ PUBLICADA — e o banco está à frente

**É a pendência que morde primeiro.** As migrations **072 a 079** estão
aplicadas em produção; o site em `gestor-af.pages.dev` é de **antes** da
Rota nova. Conferido baixando o bundle do ar: o `index.js` publicado não
referencia o pedaço `Almoxarifado-*.js`, e não contém "parada a parada".

Isso viola a regra do `CLAUDE.md` — *migration que muda o que a tela faz
→ republique a tela no mesmo dia* — e é exatamente a forma do incidente
de 09/09 (a 055 passou a recusar o que o site continuava oferecendo).

**Hoje o risco é o contrário e é menor:** o banco tem mais do que o site
usa, então nada quebra — só não aparece. Mas o Almoxarifado inteiro, a
Rota nova e a paginação estão invisíveis para quem abre o endereço.

```powershell
cd app
npm run build
npx wrangler pages deploy dist --project-name=gestor-af --branch=main --commit-dirty=true
```

> O `dist` já está compilado com tudo. A publicação foi tentada e
> **recusada pelo controle de permissão da sessão** — não é erro do
> Wrangler nem da conta.

### 2. Dado de conferência que ficou em produção

Criado por mim para provar o módulo funcionando, com dado real do
Emanuel. Nada é fictício, mas nem tudo é declaração de gente:

| O quê | Situação |
|---|---|
| **33 equipamentos** da `CARGA AFLINE.xlsx` | Reais, amostra que cobre os 9 estados e os 8 tipos. Reimportar o arquivo completo atualiza estas e cria as outras 15.570. |
| Item de miscelânea **`CON-RG6`**, saldo 100 | Cadastro de teste. Desative em Almoxarifado → Miscelânea se não for usar. |
| Romaneios **1 e 2** (confirmados) e **3** (cancelado) | 1 entregou, 2 devolveu tudo, 3 foi cancelado com motivo. Ficam no histórico — documento confirmado não se apaga, por desenho (D-154). |
| Peças `215535341115` e `*163247013549` com posse **"No almoxarifado"** | ⚠ **Esta declaração veio da minha conferência, não de alguém olhando a prateleira.** Antes elas diziam "não sabemos". São 2 de 33; quando o inventário de verdade começar, refaça as duas. |

### 3. Almoxarifado

| O quê | Por que está parado |
|---|---|
| **Importar as 15.603 pela tela** | O caminho está provado pela RPC com dado real e a importação sobe em lotes de 500, mas o arquivo inteiro nunca passou pelo navegador. Não consigo anexar arquivo no navegador daqui — é um clique do Emanuel em Almoxarifado → Importar. |
| **A tela do técnico no celular** | `tsc` e `expo export` passam; ninguém abriu no Expo Go. Falta o dedo na tela. |
| **A lista real de miscelânea** | Não veio em planilha nenhuma. Conector, cabo, fita: alguém tem de cadastrar o que a operação usa de verdade, com a unidade certa. |
| **Contestar a PERDA** | 48,9% da carga (7.629 peças) está como PERDA no Atlas. O módulo agora mostra; **atacar** é outra fase — exige saber quem foi o último responsável e o que a CLARO aceita como contestação. Regra de negócio, não código. |
| **Inventário cíclico** | Não existe. Contar a prateleira e bater com a posse declarada é o que transforma `sem posse` em número confiável. |
| **`Código Item JDE` com lixo** | Parte das linhas vem com `$equipamento.getCodigoItemJDE()` — *placeholder* de template que o Atlas não renderizou. Entra cru em `dados_origem` e não vira código de item. **Vale reclamar com a CLARO.** |

### 4. Rota do dia e mapa

| O quê | Por que está parado |
|---|---|
| **Dia com muitos técnicos** | Hoje são 3 faixas. Com 20 a página fica longa e a leitura pode pedir agrupamento ou filtro. Não medi. |
| **`painel_equipes` a ~7 ms por concluída** | Medido como `authenticated`: 167 ms no dia de 32 visitas, dos quais 133 ms são a pontuação, calculada por linha. Um dia de 364 projeta **~1,7 s**. Não estourou e não foi otimizado — mas é a forma do defeito que matou `produtividade_periodo` (D-081). |
| **Chave do Google em endereço novo** | A restrição por referenciador cobre `gestor-af.pages.dev` e `localhost:5173`. A **URL de versão** que o Wrangler gera a cada envio (`https://<hash>.gestor-af.pages.dev`) **não está na lista** — nela o mapa cai para o SVG. É esperado; só não se assuste. |
| **`AdvancedMarkerElement`** | `google.maps.Marker` é legado. O sucessor exige um `mapId` criado no Cloud Console. Quando existir, muda um bloco só (D-146). |

### 5. Dívida que atravessa telas

| O quê | Por que está parado |
|---|---|
| **`text-graf-500` e `-600` como texto** | Medido com o motor do navegador: **3,66:1** no tema claro e **2,75:1** no escuro — abaixo do 4,5 da WCAG AA. Corrigidos só na **Rota** e no **Almoxarifado**; o resto do app segue usando. Arrumar a rampa mexe em todas as telas e nunca foi o pedido. |
| **A corrida do `carregarSituacoes()`** | O cadastro de cor e rótulo chega **depois** do primeiro render e muta um objeto de módulo, o que não provoca re-render. A tela desenha com o padrão compilado e fica com ele. Foi o que fez "cancelada" ficar cinza (D-142); os valores estão alinhados, mas a corrida continua de pé para qualquer situação. |
| **Serviços carrega o período inteiro** | A paginação (D-151) é recorte de tela, não de consulta — de propósito, para os filtros e a soma de pontos continuarem valendo sobre o conjunto. Se um período longo pesar, é a **consulta** que muda, não o recorte. |
| **Tipos de O.S. 79 e 87 sem grupo** | O `32` foi declarado como `DESCONEXAO` porque o Emanuel disse. `79 DESCONEXAO OPCAO C/ RETIRADA DE EQUIPAMENTO` e `87 RETIRAR EMTA` **parecem** desconexão — e parecer não é dado. São 6 O.S. presas. Configurações → Tipo de serviço, um clique cada. |
| **`24`, `156` e `208` dependem do contexto** | No cruzamento de 04/09 o grupo desses três variava conforme as outras O.S. da mesma visita. A tela marca com etiqueta e deixa escolher; escolher é **simplificar**, e tem de ser decisão de gente. |
| **A importação grava sempre na base MAN** | `.eq('codigo','MAN')` em `Importacao.tsx`. A planilha de 10/09 é de **Araguaína** e foi registrada como Manaus — o mapa da Rota mostra isso desenhado. Com duas praças no ar, produtividade e faturamento somam operações diferentes no mesmo lugar. **Escolher a praça da importação é regra de negócio** (D-141). |

### 6. Decidido, mas não construído

Respostas que o Emanuel já deu e que estão esperando código:

- **Confirmação do romaneio com assinatura** — hoje o técnico confirma
  com um toque; `confirmado_por` guarda quem foi. Assinatura desenhada,
  foto do canhoto ou geolocalização da entrega são fase seguinte.
- **Alerta de "janela estourando"** — retirado a pedido (D-153). Se
  voltar, precisa de um corte que **não** seja "60 minutos para qualquer
  janela": a de 14 horas e a de 3 horas não são o mesmo risco.
- **Financeiro, Frota e RH** — já existem no menu como *Próximas fases*,
  e as permissões `financeiro.ver` e `frota.ver` já estão no catálogo
  marcadas `disponivel = false`, como o almoxarifado estava antes da 077.


---

## O que falta, e por quê (levas anteriores)

| O quê | Por que está parado |
|---|---|
| ~~**`pontos_equipe`**~~ | **RESOLVIDO em 07/09:** `a receber = pontuação × fator`, com o fator saindo da faixa do mês (D-077). Meta e faixas viraram cadastro editável. |
| ~~**O critério 3 conta como cadastro?**~~ | **RESOLVIDO em 07/09: NÃO vale** (D-088, revoga D-082). Só o login cadastrado roteia; o resto vai para a equipe "Sem login definido" e a tela de Equipes lista os 46 logins esperando declaração. |
| **Faixa de comissão: piso ou intervalo fechado?** | Está por piso, porque a tabela em inteiros deixava buraco (199,50 pts → R$ 0,00). Difere da tabela literal do sistema atual — D-077. |
| **Declarar os 46 logins sem dono** | 337 visitas estão em "Sem login definido" até alguém dizer de quem é cada login. A tela de Equipes faz isso num clique por login, com a equipe sugerida já preenchida — D-088. |
| **Criar os logins dos supervisores e dos técnicos** | Criar conta é ação do Emanuel (Administração → Usuários). O campo **Login TOA** no formulário já liga o acesso ao técnico — D-087. A aba *Supervisores* foi retirada a pedido; as RPCs seguem no banco. |
| **Formato do número de O.S. manual** | Geramos `AF-00000001` para não colidir com os 10 dígitos da CLARO. Formato escolhido por nós, não observado no dado — **confirmar com o Emanuel**. |
| **"Data de Abertura"** | A tela do sistema atual tem o campo; a planilha do TOA não traz nada equivalente. Não criamos a coluna: daria 100% de vazio no que é importado. Se a CLARO expuser a data em algum lugar, vira coluna de verdade. |
| **ITEM / CONSOLID / VALOR na O.S.** | O detalhe do sistema atual tem essas três colunas, e elas são a **LPU** — o tipo de O.S. consolidado que é faturado. Continua **não modelado** (ver Vocabulário no `CLAUDE.md`); não inventamos rateio de pontos por O.S. |
| **Vincular técnico a usuário** | `tecnico.usuario_id` em **0 de 104**. É o que destrava o teste do aplicativo do campo: sem o vínculo a agenda vem vazia, e não é bug. Administração → Usuários, campo **Login TOA** (D-087). |
| **Apagar ou ocultar foto errada** | Dedo na lente, contrato trocado. Hoje só pelo `service_role`: não há policy de UPDATE/DELETE no bucket nem RPC de exclusão, porque prova que se apaga não é prova. A saída certa é **ocultar com motivo** — decisão do Emanuel (D-115). |
| **Evidência obrigatória** | O Emanuel decidiu **livre**: nenhuma foto trava a baixa. Se virar exigência por tipo de serviço ou por código de baixa, é tabela nova + cenário em `testar_campo()`. |
| **Abas de equipamento no modal de baixa** | O aplicativo já lança serial, tipo e modelo, com autor (055-F). O que falta é o **almoxarifado**: sem cadastro de serial não há conferência — é o técnico digitando, não estoque batendo. Daí também depende o leitor de código de barras que o concorrente tem. |
| **Ranking · Premiação · Portaria · Abastecer · Terminais · Aceites de Materiais · Mensagens** | Telas do aplicativo do concorrente que não replicamos: dependem de almoxarifado ou de frota (módulos que não existem), ou de regra de gestão que ninguém definiu. Meta e Premiação já são respondidas por "Minha produção no mês". Ver `docs/10-APP-DO-TECNICO.md`. |
| **Miscelânea** | Não sabemos o que é. No export do ngestor é 100% "Não" em 454 registros — parece funcionalidade morta. |
| **Marcador exigido por tipo de serviço** | Não foi combinado quais indicadores são obrigatórios em cada grupo. |
| **`equipe.skill`** | O sistema atual mostra "SINGLE MASTER"; não modelamos porque não sabemos o domínio. |
| **7 migrations sem arquivo local** | Dívida conhecida; `supabase/README.md` explica como sincronizar. |
| **Grupo de serviço de 79 e 87** | A tela existe (Configurações → **Tipo de serviço**, D-143) e o **32** já foi declarado como `DESCONEXAO` — foi o único que o Emanuel disse em voz alta. Faltam `79 DESCONEXAO OPCAO C/ RETIRADA DE EQUIPAMENTO` e `87 RETIRAR EMTA`: parecem desconexão, mas **parecer não é dado**. São 6 O.S. já importadas presas neles. |
| **Grupo fixo para 24, 156 e 208** | No cruzamento de 04/09 o grupo desses três variava conforme as outras O.S. da mesma visita (`depende_de_contexto`). A tela marca com etiqueta e deixa escolher; escolher é simplificar. Nenhum deles tem O.S. hoje. |
| **Capacidade do turno é constante, não cadastro** | 3 / 1 / 2 por turno (D-144) saiu de uma frase, para uma operação. Se variar por praça ou por skill, vira tabela — hoje mora em `TURNOS`, em `app/src/components/telemetria.tsx`. |
| **`painel_equipes`: a pontuação por linha não escala** | **REMEDIDO em 15/09**, como `authenticated`: o painel custa **340 ms** com 29 visitas, e o `lateral` de `pontos_da_visita` responde por 237 ms disso. Derivando de duas amostras: **~5,9 ms por visita** + 65 ms fixos. Projetado para as 1.300 visitas/dia da operação real: **~8 s — estoura o timeout do PostgREST**. Antes da 077 já projetava ~3 s: o gargalo é `pontos_da_visita` ser chamada por linha (ela chama `assinatura_da_visita` uma vez e `edificacao_da_visita` DUAS). A saída é uma versão em conjunto — trabalho próprio, não apêndice. Mesma forma do defeito que matou `produtividade_periodo` (D-081, D-145, D-148). |
| **`recalcular_tec1` não filtra por empresa** | É anterior à 080 e não foi mexido, mas num segundo cliente ela recalcularia o banco inteiro (D-150). |
| **Carência do TEC1 sem tela** | `tipo_servico.tec1_carencia_min` é cadastro, mas só muda por SQL — e quem mudar precisa rodar `recalcular_tec1()` depois, porque `ordem_servico.tec1` é cache (D-150). |
| **Marcador automático por foto** | Pedido em 15/09: quando o técnico anexa a foto de um indicador no aplicativo, o marcador deveria subir sozinho no contrato. Não foi feito — depende de o `campo/` etiquetar a evidência com o indicador, e **da pergunta que a própria tela de Configurações já escreve**: quais indicadores são exigidos por tipo de serviço, e se o marcador é *cumprido/não cumprido* ou só *apontado*. |
| **Corte de "janela larga" em 4h** | A `08h–22h` não ocupa capacidade na régua, e nem a `12h–18h` (6h) que apareceu nos dados. O Emanuel citou só a primeira; generalizei para "maior que a maior janela real" (D-151). |
| **A corrida do `carregarSituacoes()`** | O cadastro de cor/rótulo chega **depois** do primeiro render e muta um objeto de módulo, que não provoca re-render. A tela desenha com o padrão compilado e fica com ele. Foi o que fez "cancelada" ficar cinza (D-142); está alinhado nos dois lados, mas a corrida continua de pé para qualquer situação. |
| Estoque, frota, produtividade, aferição | Fase 2 |
