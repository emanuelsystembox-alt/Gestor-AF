# Pontuação, faturamento e comissão — o que foi levantado

Levantado em 06/09/2026 no sistema atual, tela
*Configurações → Serviços → Pontuação por Grupo*.

> **Status: LEVANTAMENTO. Nada foi construído ainda.** Há perguntas em
> aberto no fim deste documento. Não implemente sem respondê-las.

## Por que isso é diferente do resto

Pontuação é **dinheiro**, em duas direções:

1. **O que a CLARO paga** à AFLINE por atendimento (faturamento)
2. **O que a equipe/técnico recebe** (comissão)

Confirmado pelo Emanuel: **são dois números diferentes**. Portanto o
modelo precisa de dois campos, e a diferença entre eles é a **margem por
atendimento** — informação que hoje ele não enxerga em lugar nenhum.

## A tela de configuração

Formulário **Nova Pontuação**:

**Cabeçalho** (define o contexto da regra)
- **Vigência** — apesar do nome, **não é período**: é o nome de uma
  tabela de preços / contrato
- **Tipo de pessoa** — `FISICA` · `JURIDICA`
- **Tipo de edificação** — `CASA` · `APTO`

**Linhas** (repetíveis, botão *Adicionar*)
- **Tipo de OS** — o serviço como o TOA/CLARO nomeia
- **Tipo de OS Consolidado** — o item da **LPU** que é faturado
- **Item Net** — numérico *(significado não confirmado)*
- **Pontuação** — o valor

Listagem: **6.319 registros**, colunas `ID · Grupo De Serviços · Tipo de
Pessoa · Tipo de Residência · Pontuação · Criação`.
Valores no formato `3.1314 | LOGIC`.

> O volume bate com regra, não com histórico:
> ~398 tipos de OS × 2 tipos de pessoa × 2 edificações ≈ 1.592 por
> tabela; com ~4 tabelas ativas dá ~6.368, muito perto de 6.319.
> **Isto contradiz a leitura inicial de "um registro por atendimento".
> Precisa ser confirmado com o Emanuel.**

## As 13 tabelas de preço ("Vigência")

```
PADRAO 1.0                      PADRAO 1.2
DESCONEXAO-GR1                  DESCONEXAO-VIAECIA
DESCONEXAO-SMK                  PROVEDOR-AMAZONET
ENGETEC - DESCONEXAO            ENGETEC-MACAPA - DESCONEXAO
AFLINE-MAO - DESCONEXAO         AFLINE-PALMAS - DESCONEXAO
AFLINE-IMPERATRIZ - DESCONEXAO  TILOG-NET - DESCONEXAO
TILOG-PARAUAPEBAS
```

São tabelas por **contrato/parceiro/praça**. Várias são de terceiros
(ENGETEC, TILOG, AMAZONET, GR1, VIAECIA, SMK) — o ngestor atende várias
credenciadas; a AFLINE usa as suas.

## O achado que muda a modelagem: DESLOCAMENTO × AGREGADA

A LPU ("Tipo de OS Consolidado") distingue:

```
MUDANÇA DE PACOTE - DESLOCAMENTO      MUDANÇA DE PACOTE - AGREGADA
INSTALAR PONTO - DESLOCAMENTO         INSTALAR PONTO - AGREGADA
MUDANÇA DE LOCAL DE PONTO - DESLOCAMENTO   ... - AGREGADA
SWAP PAYTV (POR PONTO) - DESLOCAMENTO      ... - AGREGADA
```

Leitura: **a primeira O.S. no endereço paga o valor cheio (deslocamento);
as demais da mesma visita pagam agregada (reduzido)** — porque o técnico
já está lá.

> Isto é a prova, em dinheiro, de por que `visita` e `ordem_servico` são
> tabelas separadas (D-001). Um modelo "1 linha = 1 O.S." não consegue
> nem calcular o faturamento correto: ele não sabe qual O.S. foi a
> primeira do endereço.

## Itens negativos: a LPU também desconta

```
DESCONTO - RETORNO DE CREDENCIADA INSTALAÇÃO E SERVIÇOS
DESCONTO - RETORNO DE CREDENCIADA PARA MANUTENÇÃO
DESCONTO SLA ENTREGA DE CHIP
NÃO DESCONTAR
-- tipo os sem pagamento terceiro --
-- agrupado --
```

**Retorno de Credenciada é penalidade**, não receita. E no dia 04/09 ele
teve a **pior taxa de conclusão de todos os grupos: 51,6%** (31 visitas,
16 concluídas). Ou seja: o grupo que mais desconta é o que menos fecha.

Os rótulos `-- agrupado --`, `NÃO DESCONTAR` e
`-- tipo os sem pagamento terceiro --` são valores-sentinela, não itens
reais. O modelo precisa tratá-los como tal.

## Praças da operação

O seletor de operação lista, além de Manaus:
São Luís · Imperatriz · Belém · Marabá · Teresina · Araguaína · Palmas ·
Vilhena · Ji-Paraná · Cacoal · Gurupi · Timon · Paraíso · Brasília ·
Caxias · Rede Externa Manaus · Rede Externa São Luís · Treinamento.

Nosso banco tem só a base `MAN`. **Confirmar o escopo com o Emanuel**
antes de assumir multi-praça.

## Decisão já tomada

**D-018 — recálculo retroativo.** O Emanuel escolheu que corrigir uma
regra **recalcula** os atendimentos passados, em vez de congelar o valor
da época. Eu apontei o risco (um mês fechado muda sozinho depois); ele
decidiu assim e seguimos.

Mitigação combinada, que não altera o comportamento pedido: guardar
`regra_pontuacao_log` com toda alteração (quem, quando, de/para), para
que qualquer valor do passado seja **reconstruível** se a CLARO
questionar.

## Perguntas em aberto — responder antes de construir

1. **As 6.319 linhas são regra ou histórico?** A aritmética diz regra.
   A leitura inicial foi "um registro por atendimento". Qual é?
2. **Confirmar deslocamento × agregada:** primeira O.S. do endereço paga
   cheio e as demais reduzido? Quem decide qual é a "primeira"?
3. **Qual tabela de preço a AFLINE-Manaus usa hoje?** `PADRAO 1.2`?
   `AFLINE-MAO - DESCONEXAO`? As duas, para serviços diferentes?
4. **O que é "Item Net"?**
5. **Quais tipos de cálculo existem além de `LOGIC`?**
6. **A comissão da equipe** é valor próprio na mesma tabela, percentual
   sobre o faturado, ou vem de *Regras de Comissionamento* (menu à parte)?
7. **Escopo:** só Manaus, ou o sistema precisa nascer multi-praça?
8. **Desconto de Retorno de Credenciada:** é abatido do faturamento do
   mês, da equipe que causou, ou dos dois?

---

## Evidência adicional (06/09/2026, tela Serviços)

Na lista de serviços, a pontuação aparece como **etiqueta por contrato**,
junto ao nome do cliente:

- contrato `227015022` (ADESÃO) → `1.2925`
- contrato `227014085` (ADESÃO) → `1.4648`
- contrato `226559991` (**RETORNO DE CREDENCIADA**) → **sem etiqueta**

Coerente com a LPU: Retorno de Credenciada é item de **desconto**, então
não gera pontuação positiva. Reforça a pergunta 8 — o desconto é abatido
de onde?

Também aparece a etiqueta **`TEC1 - COM PADRAO`** em várias linhas, e as
etiquetas de evidência: `GEO LOCALIZAÇÃO`, `VALIDAÇÃO COP`,
`OS DIGITAL ANEXO`, `TESTE DE VELOCIDADE`, `NR-35`, `CERTIDÃO OK`.
Essas são exigências de comprovação por tipo de serviço — provavelmente
o que a aba *Evidências \ Tipos de Anexo* configura. Ainda não levantado.

## Ainda não levantado

**Regras de Comissionamento** — o Emanuel confirmou que a comissão da
equipe sai daí, aplicada por **fatores**. Não consegui abrir a tela nesta
sessão. É o próximo passo antes de modelar comissão.

---

## ⚠ Bloqueio descoberto em 06/09: a fonte não tem as dimensões da regra

A regra de pontuação é
**tabela de preço × tipo de pessoa × edificação × tipo de O.S.**

Conferido nas 470 visitas importadas:

| Campo | Preenchido | Existe no arquivo do TOA? |
|---|--:|---|
| Endereço | 325 | sim |
| Contrato | 325 | sim |
| **Cliente (nome)** | **0** | **não** |
| **Tipo de pessoa** | **0** | **não** |
| **Edificação (casa/apto)** | **0** | **não** |
| **Telefones** | **0** | **não** |

**O export do TOA não traz nenhum desses campos.** Ele traz o *trabalho*
(atividade, O.S., endereço, janela, área, node). Quem traz o *cliente* é o
export do ngestor: `Cliente`, `Telefones`, `TipoDePessoa`,
`Tipo De Residência`.

### Consequência

Não dá para calcular pontuação só com o arquivo do TOA. Faltam duas das
quatro dimensões da regra.

### Caminhos possíveis — decisão do Emanuel

1. **Importar também o export do ngestor**, cruzando pela WO. Funciona
   hoje, mas cria dependência do sistema que queremos abandonar.
2. **Buscar a origem real** desses campos. O ngestor os obtém de algum
   lugar — provavelmente NETSMS ou outra extração da CLARO. Se
   conseguirmos a mesma fonte, ficamos independentes.
3. **O técnico informa em campo.** Ele vê se é casa ou apartamento. Serve
   como complemento, não como fonte principal — pessoa física/jurídica
   ele não tem como saber.

> Enquanto isso não se resolve, a tela de detalhe mostra esses campos
> vazios de propósito, em vez de escondê-los. Campo vazio que deveria ter
> valor é informação; campo escondido é problema invisível.

---

## Resolvido em 06/09 (tarde) — o caminho escolhido

O Emanuel decidiu o **caminho 1**: importar também o export do ngestor,
cruzando pela WO. A dependência é aceita e considerada permanente — o
objetivo do projeto é a camada operacional própria, não cortar a fonte.
O caminho 2 (achar a origem real, NETSMS) está descartado *por enquanto*.
O caminho 3 (técnico informa) continua como complemento. Ver **D-030**.

> Isso **desbloqueia parcialmente** a pontuação: com o export do ngestor
> entrando, as quatro dimensões da regra existem. O que ainda falta são
> as 8 perguntas acima — elas são sobre a *regra*, não sobre a *fonte*.

## O que o export do TOA realmente carrega — conferido no banco

O Emanuel afirmou que o ngestor tira tipo de pessoa e edificação do
relatório do TOA. Fui olhar as 470 visitas importadas
(`visita.dados_origem`, a linha crua). O que existe:

**88 colunas com valor.** Não há coluna `Cliente`, `Tipo de Pessoa`,
`Edificação` nem `Telefones` — confirmado. Mas há **dois sinais** que
sustentam a afirmação, e que ninguém tinha olhado:

**1. `Segmentação` carrega o segmento comercial** (298 de 470):

| valor | visitas |
|---|--:|
| PURPLE | 160 |
| SEM SEGMENTO | 90 |
| **PME** | **29** |
| WHITE | 11 |
| **PURPLE PME PF** | **4** |
| BLACK | 2 |
| PURPLE INTERNET | 1 |
| BSOD | 1 |

`PME` é segmento empresarial e `PF` aparece **escrito** em
`PURPLE PME PF`. É sinal de pessoa física/jurídica — não é o campo.

**2. `Complemento Endereço` carrega a edificação** (216 de 325 com
endereço). Classificando pelo primeiro termo:

| leitura | visitas | destas, com PME |
|---|--:|--:|
| indica CASA (`CASA`, `FD`, `ALT`, `QD`, `LT`) | 104 | 5 |
| indica APTO/COND (`APT`, `BL`, `TOR`, `COND`) | 79 | 6 |
| indica COMERCIAL (`LJ`, `SALA`, `BOX`, `CJ`) | 11 | **6** |
| sem complemento | 109 | 16 |
| não classificado | 22 | 0 |

Dá para ler **194 de 325** (60%). E a correlação bate: 6 de 11
"comercial" são PME (55%), contra 5 de 104 nas casas (5%).

### O que isso significa, sem inventar regra

São **derivações plausíveis, não o dado**. Antes de valerem como fonte de
faturamento, é preciso confirmar com o Emanuel:

1. O ngestor deriva de `Segmentação` e `Complemento Endereço`, como aqui,
   ou existe **outro relatório do TOA** — com colunas explícitas — que
   nunca chegou até nós? (São coisas diferentes: a segunda resolve; a
   primeira é heurística que erra em 40% dos casos.)
2. Se for derivação: `SEM SEGMENTO` e endereço sem complemento caem em
   qual lado? Errar aqui é errar dinheiro nos dois sentidos.
3. `PURPLE PME PF` — segmento que é PME **e** pessoa física ao mesmo
   tempo. Como a tabela de preço trata isso?

> Comparar os dois exports do mesmo dia pela WO resolve isso em uma
> consulta: com o `TipoDePessoa` do ngestor ao lado da `Segmentação` do
> TOA, dá para medir se a derivação acerta — e quanto. É o mesmo método
> que produziu o de/para de grupo de serviço (D-014). **Basta o arquivo
> do ngestor.**


---

## 07/09 (madrugada) — DESTRAVADO: a regra é combinação de O.S. × edificação

O relatório mensal (`ANALISE GESTOR - MENSAL/_14-07-2026_23-22.xlsx`,
17.987 linhas, 14.512 com pontuação) respondeu o que faltava:

- **combinação × edificação × pessoa** → 674 chaves, 94,2% com um valor só
- **combinação × edificação** (sem pessoa) → 579 chaves, **94,1%**
- **combinação × pessoa** (sem edificação) → 527 chaves, 85,4%

Tirar tipo de pessoa não muda nada. Tirar edificação piora.

Das 105 combinações presentes em CASA e APTO, **43 mudam de valor**.
Das 43 presentes em FISICA e JURIDICA, **5 mudam**.

> **O bloqueio "a fonte não tem duas das quatro dimensões" caiu pela
> metade.** A dimensão que faltava — tipo de pessoa — é a que menos
> importa. Edificação a gente deriva do complemento do endereço.

Construído: `tabela_preco`, `combinacao_os`, `regra_pontuacao` e
`regra_pontuacao_log` (migration 027), com 546 combinações e 1.021 regras
semeadas do relatório. Tela em Configurações → Pontuação, editável por
ADMIN. Cobertura de 95,1% nas visitas produtivas.

### O que continua em aberto

1. **`pontos_equipe` está vazio** — é o que a equipe recebe, e nunca foi
   levantado. Sem ele não há margem por atendimento nem comissão.
2. **34 regras marcadas `CONFERIR`** — o relatório traz mais de um valor
   para a mesma chave. Provavelmente tabelas de preço diferentes.
3. **448 regras coringa** copiam a de CASA quando o endereço não diz a
   edificação. É o palpite menos ruim, não o dado.
4. **DESLOCAMENTO × AGREGADA** ainda não entrou no cálculo. O relatório
   por O.S. já marca qual foi a primeira do endereço.
5. As perguntas 1, 4, 5, 6, 7 e 8 da lista acima continuam de pé.
