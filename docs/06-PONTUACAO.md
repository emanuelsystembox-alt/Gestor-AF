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
