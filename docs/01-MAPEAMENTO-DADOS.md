# Mapeamento de Dados — Fonte CLARO (TOA/OFSC) → ngestor

Baseado em `Atividades-MAN-AFLINE_04_09_26.xlsx` (349 atividades) e
`_04-09-2026_16-54.xlsx` (454 OS) — mesmo dia, 04/09/2026.

## 1. A fonte: Oracle Field Service (OFSC/TOA) da CLARO

120 colunas. Campos-chave: `Workzone key`, `Área de Trabalho`, `Categorias da
Capacidade`, `Habilidade de Trabalho`, `ID do Recurso`, `Cidade Fora TOA`.

### Descoberta estrutural mais importante
**Uma Atividade (WO) contém de 1 a 10 O.S.** Colunas repetidas 1..10:
`Número da O.S`, `Tipo O.S`, `Status da O.S`, `Ponto`, `Cód de Baixa`.

Distribuição real no dia (349 atividades):
```
0 O.S. → 104   ← jornada (Na Base, Refeição, Apoio, Manut. Veículo)
1 O.S. →  94
2 O.S. → 127   ← o caso mais comum!
3 O.S. →  17
4-7 O.S →  7
```
> Modelar como "1 linha = 1 OS" perde a noção de **visita**. O técnico vai a um
> endereço uma vez e executa N O.S. Produtividade, deslocamento e SLA são por
> visita; baixa e faturamento são por O.S.

### Domínios extraídos

**Status da Atividade (7):** concluído · iniciado · cancelado · pendente ·
em rota · não concluído · suspenso

**Tipo de Atividade (20)** — duas naturezas distintas:
- *Produtivas:* Instalacao (102), Visita Tecnica (38), Mudanca de Endereco (23),
  INST GPON - INST CABO (22), Mudanca de Pacote (20), Troca Decoder Digital (10),
  Mudanca de Local (8), Reinstalacao (4), Manut Drop (4), Manut Ruido (2), …
- *Jornada / não-produtivas:* **Na Base (47), Refeicao (47), Apoio a outro
  tecnico (8), Manutencao do Veiculo (1)**

**Área de Trabalho (5):** MAN-AREA01 · 02 · 03 · 04 · 05
**Categorias da Capacidade (9):** Classe 1, 3, 4, 5, 14, 15 (+ variantes PME)
**Segmentação (8):** PURPLE (124), SEM SEGMENTO (65), PME (23), WHITE (9), BLACK, BSOD…
**Tipo O.S (38):** codificado `NN - DESCRIÇÃO` (ex.: `1 - ADESAO - INSTALACAO DE
ASSINATURA`, `43 - ADESAO - INSTALAR PONTO VIRTUA`, `191 - INSTALACAO DE CABO GPON`)
**Cód de Baixa (37):** codificado `NNN - DESCRIÇÃO`

**Evidências fotográficas (colunas dedicadas):** Justificativa Geolocalização ·
Cliente Ausente · Ligação na URA · NR35 · Problema na Tubulação · Medição de Sinal

## 2. O destino: ngestor (64 colunas)

`Origem`: **TOA 413 (91%) · MANUAL 41 (9%)** — o sistema aceita OS criada à mão.

**Tipo de Serviço (8):** VISITA TECNICA (129) · ADESAO (109) · DESCONEXAO (93) ·
SERVICO (63) · MIGRACAO GPON (24) · MUDANCA DE ENDERECO (23) ·
RETORNO DE CREDENCIADA (9) · REINSTALACAO (4)

**Situação (7):** Concluido (249) · Cancelado (79) · Reagendamento (52) ·
Entrada - In Box (30) · Em deslocamento (18) · Em execução (17) · Com Impedimento (9)

→ Máquina de estados real:
```
Entrada - In Box ──► Em deslocamento ──► Em execução ──► Concluido
                                              │
                          ┌───────────────────┼──────────────────┐
                          ▼                   ▼                  ▼
                     Cancelado         Reagendamento     Com Impedimento
```

**Funcionalidades próprias do ngestor (não vêm do TOA):**
| Campo | O que faz |
|---|---|
| `Monitor` | supervisor/controlador responsável (7 pessoas) |
| `Equipe` + `Login` | atribuição (74 equipes) |
| `Lat/Lng_Equipe` + `Distância_Equipe_X_Cliente` | **validação de geolocalização** |
| `SERVICO-ANTERIOR-*` (data, dias, equipe, cód baixa, tipo) | **reincidência** |
| `Equi. Instalado` / `Equi. Retirado` | `SERIAL - TIPO - MODELO` |
| `Miscelâneas?` | flag Sim/Não |
| `Aferição`, `Sub-Falha`, `Avaliado Por`, `Data Avaliação` | auditoria de qualidade |
| `O.S DIGITAL`, `BOTÃO ESCADA`, `AUTO INSPEÇÃO`, `URA DE INTERAÇÃO`, `GEOLOCALIZAÇÃO`, `CERTIDÃO`, `BAIXA URA` | checklists/evidências |

## 3. Defeitos identificados no sistema atual  ← nossas oportunidades

**D1 — Código de baixa duplicado por caixa alta/baixa.**
`409 - Servico Concluido` (130) e `409 - SERVICO CONCLUIDO` (128) são o mesmo
código contado separado. Idem 110, 305, 425, 402, 328.
→ *Correção:* separar `codigo INT` de `descricao`, com tabela de domínio.
Qualquer relatório de baixa hoje está fragmentado ao meio.

**D2 — `Monitor` é texto livre, não cadastro.**
Três formatos para a mesma coisa: `SUPERVISOR - FABRICIO BELEM`,
`SUP. PEDRO CAMPOS DE OLIVEIRA`, `SUPERVISOR ADARLAN LOPES DOS SANTOS`.
→ *Correção:* FK para `usuario`.

**D3 — `Equipe` mistura conceitos.**
Convivem `206 - EQUIPE`, `COP DANIEL` e nomes de pessoa (`RAYANNE THAYRINE`).
Logins misturam conta de equipe (`203@afline.com.br`) e e-mail pessoal de
domínio externo (`rayannesz1372@gmail.com`).
→ *Correção:* separar `equipe` de `tecnico`; login individual.

**D4 — `Aferição` e `Miscelâneas?` 100% "NÃO" em 454 registros.**
Funcionalidade existe mas não é usada — ou está quebrada, ou não faz sentido
como foi desenhada. Investigar antes de replicar.
