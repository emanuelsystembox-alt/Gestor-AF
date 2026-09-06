# Decisões do Projeto (log)

Cada decisão vale até ser revogada explicitamente.

## 2026-09-04 — Rodada 1

### D-001 · Unidade de trabalho = VISITA, com O.S. dentro
Estrutura `atividade (visita)` **1→N** `ordem_servico`.
Deslocamento, tempo e produtividade contam por visita.
Baixa, tipo e faturamento contam por O.S.
> Corrige o achatamento do ngestor, que conta deslocamento em dobro
> quando há 2 O.S. no mesmo endereço (o caso mais comum: 127 de 349).

### D-002 · Login INDIVIDUAL por técnico
Fim do `203@afline.com.br` compartilhado.
Toda foto, check-in, baixa e material fica atribuído a uma pessoa.
Habilita produtividade individual e auditoria real.
> Implica definir como técnico se relaciona com equipe → ver D-005.

### D-003 · Monitor = Controlador (mesmo papel)
O campo `Monitor` do ngestor é o Controlador. O prefixo "SUPERVISOR -"
no texto é bagunça de cadastro, não hierarquia.
Hierarquia: **COP** (visão global) → **Controlador** (carteira).

### D-004 · Importação TOA acontece VÁRIAS VEZES AO DIA
Consequência técnica pesada: a importação **não pode ser append**.
Precisa de `UPSERT` com chave estável e resolução de conflito.
- Chave da visita: `ID da Atividade` (TOA)
- Chave da O.S.: `Número da O.S`
- Guardar sempre o arquivo original + linha crua (JSONB)
> Ver D-006 para a regra de quem vence no conflito.

## 2026-09-04 — Rodada 2

### D-005 · Atribuição para a EQUIPE, com técnico responsável
Visita → `equipe_id` (todos da equipe enxergam) + `tecnico_responsavel_id`.
Cada ação individual (check-in, foto, baixa) grava o `tecnico_id` de quem fez.

### D-006 · Em conflito, o operacional VENCE o TOA
Reimportação atualiza apenas **dado cadastral**: endereço, telefone,
agendamento, segmentação, contrato, coordenadas.
**Nunca sobrescreve:** status, código de baixa, fotos, check-in, materiais,
observações — nada que tenha origem no campo.
Campos protegidos ficam travados a partir do primeiro registro de execução.

### D-007 · Técnico NÃO vê
- visitas de outras equipes
- qualquer valor financeiro (pontuação, custo, faturamento)
- avaliação de qualidade sobre ele (Aferição / Sub-Falha / Avaliado Por)

**Técnico VÊ** o histórico de reincidência do cliente (SERVIÇO-ANTERIOR) —
chega sabendo que já houve visita ali e com que baixa fechou.

### D-008 · SEM modo offline
Sistema online. Reduz muito o escopo e o prazo.
> Mitigação barata: a agenda do dia fica em cache no navegador e o envio de
> foto tem retry automático. Isso cobre a queda momentânea sem custo de
> sincronização bidirecional.

## 2026-09-04 — Rodada 3

### D-009 · Consumo de material por O.S. — funcionalidade NOVA
Hoje não existe: o almoxarifado só faz inventário geral, sem amarrar consumo
à ordem de serviço. Não estamos replicando nada aqui, estamos criando.
Entra na Fase 2. Modelar desde já como movimento (saldo = soma), nunca campo editável.

### D-010 · Abastecimento por cartão/vale, com foto do cupom
Campos: hodômetro, litros, valor, posto, foto, técnico.
Habilita detecção de anomalia: hodômetro retrocedendo, consumo fora da curva
do próprio veículo, dois abastecimentos no mesmo dia. Fase 2.

### D-011 · Duas linguagens visuais na mesma marca
- **Controle (COP/Controlador):** densa, tipo torre de controle. Muita
  informação por tela, tabelas, atalhos de teclado.
- **Campo (Técnico):** espaçada, botões grandes, alto contraste (uso no sol),
  poucos toques, uma mão.

### D-012 · MVP = núcleo de O.S.
Importação TOA → Controlador despacha e acompanha → Técnico executa e dá baixa.
É o que substitui o ngestor no dia a dia. Frota e almoxarifado na Fase 2.

## 2026-09-04 — Execução (banco AFLINE manager)

### D-013 · A planilha do TOA tem cabeçalhos repetidos
`Tipo de Atividade` aparece nos índices 19 e 20; `Janela de Serviço` nos 10 e 11.
- índice 19 = categoria (`Normal`)
- índice 20 = tipo real (`Instalacao`, `Refeicao`...)

Parser que converte para JSON **pela chave** perde a primeira coluna sem erro
nenhum. O front-end desduplica **por posição**, gerando `Tipo de Atividade` e
`Tipo de Atividade__2`. O importador lê `__2`.
> Esse é o tipo de bug que roda meses sem ninguém notar.

### D-014 · A trava do D-006 só arma em ação de CAMPO
Primeira versão armava também no INSERT. Resultado: visita que chegava do TOA
já concluída nascia travada, e o TOA nunca mais conseguia corrigi-la — a
proteção virava ruído.

Corrigido: o trigger só arma em `UPDATE`, só quando a situação realmente muda,
e nunca quando o autor é o importador (que se identifica com
`set_config('app.origem','IMPORTACAO')`).

**Trava = "o campo tocou nisto".** Nada além disso.

### Estado do banco `AFLINE manager` (kqfflkxjijzdtnfshdlv, sa-east-1)
9 migrations aplicadas. 21 tabelas, todas com RLS. 166 códigos de baixa.

Testado com dados reais de 04/09/2026 (15 visitas / 23 O.S.):

| Teste | Resultado |
|---|---|
| Importação inicial | 15 criadas, 23 O.S., **0 erros** |
| Reimportação (D-004) | 0 criadas, 15 atualizadas — **não duplicou** |
| Campo vence TOA (D-006) | nosso `REAGENDAMENTO` preservado; TOA dizia `concluído`; **1 alerta registrado** |
| Códigos 409 maiúsc./minúsc. (D1) | as 13 O.S. apontam para **o mesmo** registro |
| Jornada separada de produção | 12 PRODUTIVA / 3 JORNADA |
| Coordenadas X↔Y | lat −3.06 / lng −60.08 — **corretas para Manaus** |
| Fuso horário | `08:03` grava e lê como 08:03 em Manaus |

> Há 15 visitas de teste no banco. Para limpar:
> `delete from importacao where id = '11111111-1111-1111-1111-111111111111';`
> (as visitas caem junto por cascade)
