# Estado do projeto — 06/09/2026

Consolidação de tudo que existe. Levantado **consultando o banco e o
repositório**, não de memória.

---

## O que é este projeto

Camada operacional própria da **AFLINE**, prestadora da **CLARO**, para
substituir o **Alfa Gestor (ngestor)**. Recebe as ordens de serviço do
**TOA (Oracle Field Service)** da CLARO, despacha para as equipes, recebe
a execução do campo e mede.

Nasce **multi-empresa**: o Emanuel pretende vendê-lo a outras credenciadas.

---

## Infraestrutura

| | |
|---|---|
| Banco | Supabase `AFLINE manager` · `kqfflkxjijzdtnfshdlv` · sa-east-1 |
| Repositório | `github.com/emanuelsystembox-alt/Gestor-AF` |
| Front-end | Vite + React 18 + TypeScript + Tailwind v4 |
| Local | `C:\Users\Emanu\OneDrive\Documentos\PROJETO - NGESTOR AFLINE` |

**Fora do escopo:** o Supabase `BANCO PRO - AFLINE 360` é outro projeto
(camada analítica, 350+ migrations). Não tocamos nele desde 04/09.

---

## Banco — números reais

**25 tabelas · 2 views · 32 funções · 13 triggers · 48 policies · zero tabela sem RLS**

### Estrutura

```
empresa ─── base (praça) ─── equipe ─── tecnico
                              │  └── equipe_login_toa (histórico)
                              │  └── equipe_tipo_servico
                              └── visita ─── ordem_servico
                                    ├── evidencia
                                    ├── equipamento_movimento
                                    ├── reincidencia
                                    └── visita_evento (auditoria)
```

Acesso: `perfil` · `usuario_papel` · `usuario_base` · `carteira`
Entrada: `importacao` · `importacao_linha`
Domínios: `tipo_atividade` · `tipo_servico` · `tipo_os` · `codigo_baixa` ·
`segmentacao` · `categoria_capacidade` · `area_trabalho`

### Dados carregados

| | |
|---|---|
| Empresas | 1 (AFLINE) |
| Praças | **18** |
| Equipes | **89** · Técnicos **104** · Supervisores 5 |
| Visitas | **470** (325 produtivas · 144 jornada · 2 dias) |
| Ordens de serviço | **564** (468 com baixa) |
| Códigos de baixa | **168** classificados |
| Tipos de O.S. | 37 · Tipos de atividade 20 · Grupos de serviço 8 |
| Login TOA mapeado | 9 equipes |
| Eventos de auditoria | 472 |

**339 das 470 visitas têm equipe.** As 131 restantes: 124 são jornada sem
login no TOA (corretas) e 7 são de um login ainda sem dono (`Z690579`).

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

---

## Telas prontas

| Rota | O que faz |
|---|---|
| `/entrar` | Login com identidade AFLINE |
| `/controle` | Painel: indicadores, distribuição, **improdutivas por responsabilidade**, encerramentos por hora, motivos, tempo por etapa, equipes, tabela por grupo com CSV |
| `/controle/servicos` | Lista com **9 filtros combináveis**, intervalo de datas, expansão das O.S., exportação |
| `/controle/equipes` | Equipes e técnicos, produtividade do dia, agrupamento por supervisor/área, aviso de recurso fora do cadastro |
| `/controle/importar` | Upload da planilha do TOA com prévia |
| `/campo` | Agenda do técnico (clara, alto contraste) |
| `/campo/visita/:id` | Execução: rota, baixa por O.S., mudança de situação com GPS |

---

## As 26 decisões, resumidas

**Modelagem**
D-001 visita 1→N O.S. · D-005 atribuição à equipe com responsável ·
D-009 consumo de material por O.S. (novo) · D-013 cabeçalho repetido lido
por posição · D-019 multi-empresa · D-021 isolamento em dois cercos ·
D-024/D-025 login TOA é da equipe e muda de dono

**Operação**
D-002 login individual · D-003 Monitor = Controlador · D-004 importação
várias vezes ao dia · D-006 o campo vence o TOA · D-007 o que o técnico
não vê · D-008 sem modo offline · D-026 ocioso = 10 min

**Produto**
D-011 duas linguagens visuais · D-012 MVP = núcleo de O.S. ·
D-014 a trava só arma em ação de campo

**Segurança**
D-015 `SECURITY DEFINER` checa papel por dentro · D-016 `revoke from
public` não remove concessão nominal · D-017 `search_path` fixo

**Dinheiro**
D-010 abastecimento com foto · D-018 recálculo retroativo (escolha do
Emanuel) · D-020 comissão vem de Regras de Comissionamento por fatores

---

## Defeitos do sistema atual que já corrigimos

1. **Código de baixa duplicado por caixa.** `409 - Servico Concluido` e
   `409 - SERVICO CONCLUIDO` eram contados separados. Agora `codigo` é
   inteiro.
2. **Supervisor como texto livre.** Três grafias da mesma pessoa
   (`SUPERVISOR - X`, `SUP. X`, `SUPERVISOR X`) unificadas.
3. **Visita achatada em O.S.** Contava deslocamento em dobro — e impede
   calcular faturamento, porque não sabe qual O.S. foi a primeira do
   endereço (deslocamento × agregada).
4. **Jornada dentro da produtividade.** 144 de 470 são `Na Base` e
   `Refeição`; dentro da conta derrubam a taxa de conclusão.
5. **Improdutiva sem responsável.** O ngestor lista o motivo e não diz de
   quem é a culpa.

---

## O que descobrimos sobre o negócio

- **Uma visita carrega até 10 O.S.** O caso mais comum são 2.
- **A LPU distingue DESLOCAMENTO de AGREGADA.** A primeira O.S. do
  endereço paga cheio; as demais, reduzido.
- **A LPU tem itens negativos.** Retorno de Credenciada é **desconto** —
  e teve a pior conclusão do dia 04/09: 51,6%.
- **Pontuação = dinheiro em duas direções**: o que a CLARO paga e o que a
  equipe recebe, valores diferentes.
- **A regra é** tabela de preço × tipo de pessoa × edificação × tipo de O.S.
- **`ITEM`/`CONSOLID`/`VALOR`/`PONTOS` são por O.S.**, não por visita.

### Números do dia 04/09/2026
241 visitas produtivas · 428 O.S. · conclusão 75,9% · **84,8% dentro da
janela** · 65 improdutivas, das quais **zero por nossa conta** (41
cliente · 14 operadora · 10 rede).

---

## Pendências

### Bloqueadas por resposta do Emanuel
- **Pontuação e faturamento** — 8 perguntas em `06-PONTUACAO.md`
- **Regras de Comissionamento** — tela não aberta ainda; é de lá que saem
  os fatores da comissão

### Lacunas de modelo (de `07-TELAS-DETALHADAS.md`)
skill e despacho por competência · equipe ociosa · marcadores ·
sub-falha · observação no evento · transferência de equipe ·
item/consolid/valor/pontos · indicadores de qualidade · anexos com
autoria · geo cerca e garagem

### Fases não iniciadas
frota · almoxarifado · produtividade · aferição · relatórios

### Segurança fora deste projeto
O `BANCO PRO - AFLINE 360` tem 3 tabelas sem RLS, uma com **183 nomes de
técnico expostos**. Levantado em 04/09, decisão do Emanuel, ainda pendente.

---

## Ordem proposta para as próximas telas

1. **Detalhe do contrato** — onde tudo converge: O.S., histórico com
   sub-falha, anexos, marcadores
2. **Equipes expandida** — ocioso, login On/Off, skill, pontos, períodos
3. **Marcadores** — evidências exigidas por tipo de serviço
4. **Monitoramento** — trajeto, derivável de `visita_evento`
5. **Relatórios** — depois que a pontuação existir
