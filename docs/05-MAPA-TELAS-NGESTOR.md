# Mapa de telas do sistema atual (Alfa Gestor / ngestor)

Levantado em 05/09/2026, navegando como usuário.
**O que documentamos aqui é arquitetura de informação** — quais telas
existem, o que cada uma mostra, quais filtros e ações. Não copiamos
código nem identidade visual.

## Módulos (topo)

| Módulo | Rota |
|---|---|
| Ordens de Serviços | `/app/service` |
| Estoque | `/app/estoque` |
| Frota | `/app/frota` |
| Vendas | `/app/sales` |
| Financeiro | `/app/financeiro` |
| Admin | `/app/administracao/usuarios` |

## Dentro de Ordens de Serviço

**Operação:** Dashboard · Dashboard V2 *(beta)* · Serviços · Serviços V2
*(beta)* · Equipes · Monitor de O.S. · Produtividade · Projetos/Obras ·
Agendamento · Clientes

**Análise:** Power BI · Extensões

**Checklist:** Pós Serviço · Gráficos · Relatórios · SMS Enviados · Configurações

**Importadores (7):** TOA-Claro · Bringg-Claro · VTAL Lightning Force ·
TOA Zeus GVT · Planilha Manual · QualiNet · HubSoft · Aferição Claro/Net

> Sete importadores porque o ngestor atende várias credenciadas e várias
> operadoras. A AFLINE usa **um**: TOA-Claro. Isso é vantagem nossa —
> podemos fazer um importador profundo em vez de sete rasos.

---

## Dashboard V2 — a tela mais importante

Contadores da barra lateral no dia: Serviços `13 · 33 · 25 · 86`, Equipes `22`.

### Barra de filtros
- Período em botões: **Hoje · 7 dias · Este mês · Mês anterior · Personalizado**
- Selects: *Todas as origens* · *Todos os tipos* · *Todas as equipes*
- Caixa **Desatribuído**
- Indicador **"Atualizado agora · automático"** (recarrega sozinho)
- Linha-resumo: `Exibindo: 143 OS · todas as origens · todos os tipos ·
  todas as equipes · 05/09/2026` + **limpar filtros**

> A linha-resumo é um acerto de usabilidade: o controlador sempre sabe o
> que está vendo. Vamos manter.

### Faixa de alerta
> ⚠ 13 OS com a janela do **TEC1** crítica (menos de 60 min para o fim do
> intervalo) — 13 em risco de 13 atendimentos de hoje

TEC1 = indicador de SLA da CLARO sobre a janela combinada com o cliente.

### 4 cartões de indicador (2×2), cada um com minigráfico
| Indicador | Valor | Variação | Meta |
|---|---|---|---|
| Ordens de serviço no período | 143 | — | — |
| Taxa de conclusão | 66,2 % | −0,7 pp | 85 % |
| Resolução na 1ª visita (FTF) | 70,9 % | −6,7 pp | 82 % |
| TEC1 em risco | 13 | — | 13 críticas |

### Distribuição por status
Barra empilhada + legenda com contagem e percentual:
Entrada–In Box 13 (9,1 %) · Em deslocamento 0 · Em execução 0 ·
Concluído 86 (60,1 %) · Improdutivos 44 (30,8 %) · Com impedimento 0

### Encerramentos por hora
Barra empilhada 00:00–23:00 (Concluído / Improdutivos / Com impedimento).
Pico às 09:00 e às 16:00. Link **Ver tabela**.

### Motivos de improdutividade
Barras horizontais, código + descrição:
`106 Cliente Ausente` 11 · `203 Rede Externa Com Problema - REAGENDADO` 5 ·
`107 Entrada Nao Autorizada` 5 · `-1 Cancelado no Sistema NETSMS` 4 ·
`101 Endereco Nao Localizado` 3 · `125 Cliente Desiste da Agenda` 2 ·
`305 Rua Nao Cabeada` 2 · `-2 Liberado no Sistema NETSMS` 1

> **Achado:** existem pseudo-códigos negativos (`-1`, `-2`) que não estão
> no guia oficial da CLARO. São do próprio ngestor, para baixa feita no
> NETSMS. Precisamos deles no catálogo.
>
> **Falta aqui a pergunta que importa:** dessas 44 improdutivas, quantas
> são culpa nossa? O ngestor lista o motivo mas não classifica
> responsabilidade. É onde ganhamos.

### Tempo médio por etapa
Fila (In Box) **214 min** · Deslocamento **32 min** · Execução **70 min**

> 214 minutos parados na fila contra 70 de execução. O gargalo da operação
> não é o técnico, é o despacho. Nosso painel precisa gritar isso.

### Equipes por volume concluído (top 5)
`004` 7 · `106` 6 · `033` 6 · `014` 6 · `113` 5

### Ordens por tipo de serviço
Tabela ordenável com linha de total e **Exportar CSV**:

| Tipo | Total | Em and. | Concl. | Improd. | Imped. | % concl. |
|---|--:|--:|--:|--:|--:|--:|
| VISITA TECNICA | 54 | 13 | 27 | 14 | 0 | 65,9 % |
| ADESAO | 39 | 0 | 26 | 13 | 0 | 66,7 % |
| RETORNO DE CREDENCIADA | 21 | 0 | 12 | 9 | 0 | 57,1 % |
| SERVICO | 21 | 0 | 16 | 5 | 0 | 76,2 % |
| MUDANCA DE ENDERECO | 7 | 0 | 4 | 3 | 0 | 57,1 % |
| MIGRACAO GPON | 1 | 0 | 1 | 0 | 0 | 100 % |
| **Total** | **143** | **13** | **86** | **44** | **0** | **66,2 %** |

---

## O que copiamos, o que melhoramos

**Mantemos** (é bom e a equipe já tem o dedo viciado):
- Filtros de período em botões, com a linha-resumo do que está sendo exibido
- Faixa de alerta no topo para SLA em risco
- Distribuição por status como barra empilhada com contagem e %
- Encerramentos por hora
- Tabela por tipo de serviço com total e exportação

**Melhoramos:**
1. **Improdutivas por responsabilidade** — cliente / rede / operadora /
   nossa / terceiro. O ngestor não responde isso.
2. **Visita ≠ O.S.** — ele conta 143 "OS"; na verdade são visitas com 1 a
   10 O.S. cada. Separamos as duas contagens.
3. **Destaque para o gargalo** — 214 min de fila contra 70 de execução
   precisa de tratamento visual, não de uma barra discreta no meio da página.
4. **Jornada fora da produtividade** — "Na Base" e "Refeição" não podem
   entrar no denominador da taxa de conclusão.
