# Telas do sistema atual — detalhamento (06/09/2026)

Levantado a partir de capturas enviadas pelo Emanuel. Documenta
**estrutura e conteúdo**, para reconstruir a lógica — não o visual.

---

## 1. Serviços — lista

Cabeçalho: busca · intervalo de datas · **Filtros** · "Experimentar nova versão"
Barra: `Excluir` `Transferir` `Nova OS` `Exportar Excel` `Marcadores`
Paginação: `1 - 50 / 157`

Colunas: ☐ · **Equipe** · **Contrato** · **Ordem De Serviços** · **Endereço** ·
**Período** · **Status** · # · **Ações**

**A linha inteira é colorida pela situação** (amarelo = reagendamento,
verde = concluído). Leitura periférica: o controlador varre a tela sem ler.

- **Contrato**: pin + número + nome do cliente truncado +
  **etiqueta de pontuação** (`1.2925`) + etiqueta **`TEC1 - COM PADRAO`**
- **Ordem De Serviços**: várias O.S. empilhadas na MESMA linha, cada uma com
  número, descrição, origem (`TOA`), **código de baixa** (`107`) e situação
  (`EXECUTADA` / `NÃO EXECUTADA`)
- Abaixo das O.S., os **marcadores** da visita
- **Período**: data + faixa horária, ou `IMEDIATA`
- **Status**: situação + código de baixa + data/hora da baixa

### Marcadores observados
`VALIDAÇÃO COP` · `GEO LOCALIZAÇÃO` · `OS DIGITAL ANEXO` ·
`TESTE DE VELOCIDADE` · `NR-35` · `CERTIDÃO OK` · `SEM PADRÃO` ·
`CLIENTE ATIVADO` · `LOG REAGENDADO`

> São **evidências exigidas** e **resultados de verificação**. Precisam de
> cadastro próprio: quais marcadores cada tipo de serviço exige, e quais
> foram cumpridos.

---

## 2. Detalhe do contrato (modal ao clicar)

Título: `Ordem de Trabalho : 1299703`
Ações: `Transferir Serviço` `Baixar Serviço` `Marcadores` `Mais`
Abas: **Detalhe** · **LPUs (0)** · **Agendamento** · **Equipamentos (0)** ·
**Miscelâneas (0)** · **Serviços anteriores** · **Checklist**

### Bloco Cliente
Nome · Endereço · Telefones · Cidade/Estado · **Tipo De Pessoa** (FISICA) ·
**Edificação** (APTO) · Contrato · WO · Data de Abertura · Data de
Agendamento · Período · **Toa Início e Fim** · Área · Node ·
**Sincronizar com TOA** (NÃO) · **Geo. TOA** `[-60.01127, -2.97392]` ·
**Geo. baixa anterior** · **Pontuação** `1.2925`

> `Tipo De Pessoa` + `Edificação` são exatamente as duas dimensões da regra
> de pontuação (ver `06-PONTUACAO.md`). Fecha o raciocínio.

### Tabela Serviço(s)
`Número OS` · `Ordem de Serviço` · `Origem` · `Código de Baixa` · `Situação` ·
**`ITEM`** · **`CONSOLID`** · **`VALOR`** · **`PONTOS`** · `Aferição` · `Login`

> **Achado que fecha o modelo de faturamento:** `ITEM`, `CONSOLID`, `VALOR` e
> `PONTOS` são **por O.S.**, não por visita. `CONSOLID` é o "Tipo de OS
> Consolidado" da LPU; `VALOR` é dinheiro; `PONTOS` é a pontuação.
> A etiqueta de pontuação da lista é a **soma** das O.S. da visita.

### Indicadores de Qualidade
Botões `Não avaliado` / `Avaliar`. "Nenhum indicador avaliado nesta O.S."

### Histórico (imutável, uma linha por mudança)
`ID` · pin de geo · `Situação` · `Código de Baixa` · **`Sub-Falha`** ·
`Equipe` · `Observação` · `Login` · `Data e Hora`

Exemplo real: `Reagendamento / 107 Entrada Nao Autorizada /
RESTRIÇÃO HORÁRIO CONDOMÍNIO / 001-EQUIPE / "não autorizado entrada."`

> **Sub-Falha** detalha o código de baixa. É o segundo nível da causa —
> `107` diz "entrada não autorizada", a sub-falha diz **por quê**.
> Nosso `visita_evento` já guarda quem/quando/de/para, mas **não tem
> sub-falha nem observação de texto**. Falta.

Repare que o histórico mostra a visita passando por **014 → 001**: houve
transferência de equipe. Nosso modelo não registra isso hoje.

### Anexo(s)
Miniaturas com nome do arquivo, data/hora, **quem anexou**, e menu Ações.
No exemplo: foto da fachada + 2 capturas de mapa.

---

## 3. Equipes — lista

Filtros (11): `DATA DA SITUAÇÃO` · `SITUAÇÃO` · `TIPO DE SERVIÇOS` ·
`PERÍODO` · `SUPERVISOR` · `COP` · `EQUIPES SKILL` · `EQUIPES` ·
`MARCADORES` · `LOGS` · `EQUIPES STATUS`

Cabeçalho com totais: **Equipes (22)** · **Contratos (157)** ·
**Períodos** · **Pontos (136.37)** · **Situação** · **Usuário**

Cada equipe:
- avatar `1 - E` (nº de técnicos + inicial)
- código · **`Login TOA: Z688266 \ On`** · **`Monitor: SUPERVISOR -. J. S.`** ·
  **`Skill: SINGLE MASTER`**
- contagem de contratos
- **períodos com contagem**: `08:00-12:00 (2)` `15:00-18:00 (1)` `IMEDIATA (1)`
- **pontos da equipe no dia** (5.51)
- situação em etiquetas: `Concluído (2)` `Reagendamento (5)` `Cancelado (1)`
- usuário: e-mail da equipe · `Último log as 16:24:19` · **`OCIOSO`**

Clicar expande e mostra os serviços daquela equipe, com o mesmo layout da
tela de Serviços.

> **`OCIOSO`** é o alerta mais útil da tela: equipe sem movimento. E
> **`Login TOA` com `On/Off`** mostra quem está conectado agora.
>
> Skills observadas: `SINGLE MASTER` (114) · `VT MA1` (56) · `MOTO OURO` (33)
> · `SUPERVISAO` (31) · `VT MA5` (20) · `DESCONEXAO` (15) ·
> `DUPLADO MASTER` (9) · `VT MA2` (6). A skill limita o que a equipe pode
> receber — é despacho por competência.

---

## 4. Monitoramento App

Abas: **Status Técnicos** · **Caminho percorrido** · **Código De Baixa** ·
**Geo Cerca Técnico** · **Garagens**

*Caminho percorrido* — "Verifica a distância percorrida por equipe":
`Usuários` · **`Placa`** · **`Geo Cerca`** · `Últ. Localização` ·
**`Distância Percorrida`** · `Trajeto / Mapa`

> Aqui a **frota encosta na operação**: a placa aparece junto do técnico.
> `Geo Cerca` e `Garagens` são cercas virtuais — provavelmente para saber
> se a equipe saiu da base e se está na área dela.
>
> Como decidimos não ter app Android (D-002/D-008), o rastreamento vira
> **geolocalização do navegador nos eventos**, que já gravamos em
> `visita_evento.lat/lng`. Dá para reconstruir trajeto a partir disso.

---

## 5. Relatórios (16)

`Insights` · `Por Serviços` · `Por LPU` · `Por Equipamentos` ·
`Batidas de Ponto x Serviço` · `Dias Trabalhados` ·
`Indicadores de Qualidade` · **`Pontuação Geral`** · **`Pontuação Técnico`** ·
**`Tabela Pontuação`** · **`Pontuação Monitor`** · `Período` ·
`Ranking Geral` · `Log's Retorno` · `COP 360` · `Produtividade Geral`

> Quatro dos dezesseis são de pontuação. Confirma que é o centro do
> sistema, e que ela é apurada por **técnico**, por **monitor** e **geral**.

---

## O que falta no nosso modelo (lacunas identificadas hoje)

| Lacuna | Onde entra |
|---|---|
| `equipe.login_toa` com histórico | **feito** (migration 021) |
| `equipe.skill` e despacho por competência | falta |
| `equipe` ociosa / último acesso | falta |
| Marcadores (evidências exigidas × cumpridas) | falta |
| `Sub-Falha` no evento | falta |
| Observação de texto no evento | falta |
| Transferência de equipe registrada | falta |
| `ITEM` / `CONSOLID` / `VALOR` / `PONTOS` por O.S. | falta — depende de `06-PONTUACAO.md` |
| Indicadores de qualidade / aferição | falta |
| Anexos com autoria e miniatura | parcial (`evidencia` existe, falta tela) |
| Geo cerca e garagem | falta |
| Trajeto percorrido | derivável de `visita_evento` |
