# Gestor AF — guia para quem (ou o que) for trabalhar neste repositório

**Assumindo o projeto agora? Leia `HANDOFF.md` primeiro.**

Leia isto antes de mexer em qualquer coisa. Este arquivo existe para que
outra pessoa — ou outra IA — entre no projeto sem repetir descobertas que
já custaram caro.

## O negócio em cinco linhas

A **AFLINE** é prestadora da **CLARO**. Recebe ordens de serviço pelo
**TOA (Oracle Field Service)** da CLARO, manda técnico a campo, executa e
dá baixa. Hoje isso roda num sistema de terceiro (**Alfa Gestor /
ngestor**) que fica caro e cujo roadmap não controlamos. Este projeto é a
camada operacional própria: importar, despachar, executar, medir e cobrar.

## Regras de ouro

1. **Não invente regra de negócio.** Se não souber, **pergunte ao
   Emanuel**. Ele pediu isso explicitamente. Preferir uma pergunta a um
   palpite bem-intencionado.
2. **Derive do dado real.** O de/para de grupo de serviço não foi
   inventado: saiu do cruzamento de dois exports pela WO. Faça o mesmo.
3. **Planilha de cliente não entra no Git.** `*.xlsx` e `*.csv` estão no
   `.gitignore`. Nome, telefone e endereço de assinante são LGPD.
4. **Permissão vive no banco.** RLS no Postgres, não na tela.
5. **Documente a decisão E o porquê** em `docs/03-DECISOES.md`.

## Vocabulário — não confunda estes três

| Termo | O que é | Onde vive |
|---|---|---|
| **Visita** (Atividade no TOA) | uma ida a um endereço | `visita` |
| **O.S.** | uma ordem de serviço; **1 visita tem de 1 a 10** | `ordem_servico` |
| **Tipo de atividade** | como o **TOA** chama (`Instalacao`, `Visita Tecnica`) | `tipo_atividade` |
| **Grupo/Tipo de serviço** | como a **operação e a CLARO** agrupam (`ADESAO`, `VISITA TECNICA`, `MIGRACAO GPON`) | `tipo_servico` |
| **Tipo de O.S.** | o código numérico da CLARO (`1`, `43`, `191`) | `tipo_os` |
| **Tipo de O.S. Consolidado** | o item da **LPU** que é faturado | *ainda não modelado* |

> O caso mais comum é **2 O.S. por visita**. Achatar em "1 linha = 1 O.S."
> conta o deslocamento em dobro **e erra o faturamento** — ver Pontuação.

## Armadilhas que já morderam

**A planilha do TOA tem cabeçalhos repetidos.** `Tipo de Atividade`
aparece nas posições 19 e 20 (categoria e tipo real). Ler "pela chave"
perde a primeira em silêncio. `src/lib/toa.ts` lê **por posição** e
sufixa com `__2`. Nunca troque por `sheet_to_json` com header padrão.

**`revoke ... from public` não remove concessão nominal.** O Supabase
concede `EXECUTE` explicitamente a `anon` em toda função criada no
schema `public`. Tem que ser `revoke ... from anon`. E `CREATE OR
REPLACE` preserva a ACL, mas função criada do zero (após um `RENAME`)
nasce aberta de novo. **Confira sempre com
`has_function_privilege('anon', oid, 'EXECUTE')`, não com o lint.**

**`SECURITY DEFINER` ignora o RLS.** Se a função faz algo privilegiado,
cheque o papel **dentro** dela. Ver `importar_toa`.

**Não meça tempo a partir de `visita.criado_em`.** É a hora da
importação, não do evento. Medir "fila" assim deu 0 min. Medir da
atribuição do TOA deu 878 min (a atribuição é 00:23 e o técnico começa
08:00 — mede a noite). A métrica útil é **aderência à janela**.

**Jornada não entra em produtividade.** `Na Base` e `Refeição` foram 103
de 344 apontamentos num dia. `tipo_atividade.natureza` separa
`PRODUTIVA` de `JORNADA`. Sempre filtre.

**Códigos de baixa vêm com caixa inconsistente.** `409 - Servico
Concluido` e `409 - SERVICO CONCLUIDO` são o mesmo. Guardamos `codigo`
como inteiro; `extrai_codigo()` lê só o número do início.

## Estrutura

```
app/                     front-end (Vite + React + TS + Tailwind v4)
  src/lib/toa.ts         leitor da planilha do TOA (cabeçalho por posição)
  src/lib/planilha.ts    leitor genérico
  src/lib/metricas.ts    todo o cálculo do painel
  src/lib/supabase.ts    cliente + domínios de situação
  src/lib/auth.tsx       sessão, perfil e papéis
  src/components/        Shell (navegação), graficos (SVG puro), ui
  src/pages/             Login · Controle · Servicos · Equipes ·
                         Importacao · Campo · Visita
docs/                    mapeamento, domínio, decisões, mapa do concorrente
supabase/migrations/     schema, em ordem
```

**Gráficos são SVG escrito à mão**, sem biblioteca. Foi decisão: controle
de tema, bundle pequeno, nada para manter. Todo gráfico tem "Ver tabela".

## Duas linguagens visuais (D-011)

- **Controle** (COP/Controlador): escuro, denso. Passa horas na tela.
- **Campo** (Técnico): **claro**, espaçado, alvo de toque 48px. É usado
  no sol — tela clara é muito mais legível sob luz direta.

Classes `.sup-controle` / `.sup-campo` em `src/styles.css`.

## Como rodar

```bash
cd app && npm install && cp .env.example .env && npm run dev
```

Migrations: rodar em ordem no SQL Editor do Supabase, ou via MCP.
Sempre `npx tsc --noEmit` antes de commitar.

## Estado atual — 06/09/2026

> **Leia `docs/08-ESTADO-DO-PROJETO.md`.** Ele consolida tudo: números
> reais do banco, as 21 migrations, as 26 decisões, o que já corrigimos do
> sistema atual e o que está pendente. Este arquivo aqui é o *como
> trabalhar*; aquele é o *onde estamos*.

Resumo: 25 tabelas, 48 policies, **zero tabela sem RLS**. 470 visitas,
564 O.S., 89 equipes, 104 técnicos, 18 praças, 168 códigos de baixa
classificados. Sete telas no ar.

**Pendência principal:** pontuação e faturamento — bloqueada por 8
perguntas em `docs/06-PONTUACAO.md`. Não implemente sem respondê-las.

## Índice da documentação

| Arquivo | Para quê |
|---|---|
| `HANDOFF.md` | **comece por aqui** — passagem de bastão |
| `docs/08-ESTADO-DO-PROJETO.md` | inventário: números, migrations, pendências |
| `docs/03-DECISOES.md` | as 26 decisões, com o porquê de cada uma |
| `docs/01-MAPEAMENTO-DADOS.md` | o que vem do TOA e do ngestor |
| `docs/02-MODELO-DOMINIO.md` | entidades e máquina de estados |
| `docs/05-MAPA-TELAS-NGESTOR.md` | mapa do sistema concorrente |
| `docs/07-TELAS-DETALHADAS.md` | telas destrinchadas + 12 lacunas |
| `docs/06-PONTUACAO.md` | faturamento — **8 perguntas em aberto** |
| `docs/04-DESCOBERTA-AFLINE-360.md` | o outro Supabase, fora de escopo |
| `supabase/README.md` | ordem das migrations e conferências |
