-- ┌─ 141 · de quem é a culpa, no vocabulário da CLARO ─────────────────┐
-- │ > "o certo é dizer exatamente de quem é a culpa de acordo com o    │
-- │ >  código de baixa. Essas informações estão na coluna AG e a H,    │
-- │ >  que se chama responsável de quebra e agrupamento de quebra"     │
-- │ >  (...) "a planilha é só pra você aprender os responsáveis da     │
-- │ >  quebra, só isso. Para não classificar errado" — Emanuel, 25/10  │
-- │                                                                     │
-- │ APRENDIDO da planilha "Quebra Qualificada" (01/10, 2.074 linhas,   │
-- │ 884 de Manaus). O vocabulário da CLARO:                            │
-- │   SEM_QUEBRA · SERVICOS DE CAMPO · COMERCIAL · DAC · REAG_CLIENTE  │
-- │   · CLIENTE · USO_INTERNO · CHUVA                                  │
-- │ e os agrupamentos: AGENDAMENTO, MOVIMENTAÇÕES DE AGENDA, INFRA     │
-- │ CLARO, PROCESSO VENDA, TUBULACAO, INFRA CLIENTE, TÉCNICO.          │
-- │ SERVICOS DE CAMPO é a AFLINE — a única que é NOSSA conta.          │
-- │                                                                     │
-- │ ┌─ o que o dado mostrou, e que ninguém esperava ────────────────┐  │
-- │ │ A classificação NÃO é função do código. Dos 84 códigos, 68    │  │
-- │ │ são unânimes na planilha, mas 16 aparecem com mais de um      │  │
-- │ │ responsável — o 301 com QUATRO (Comercial, Serviços de Campo, │  │
-- │ │ DAC e Reag. Cliente) e o 106 com dois. Quem classifica é a    │  │
-- │ │ CLARO, caso a caso, por WO.                                    │  │
-- │ └────────────────────────────────────────────────────────────────┘  │
-- │                                                                     │
-- │ Por isso: maioria >= 50% recebe o responsável; abaixo disso fica   │
-- │ SEM classificação (escolher seria inventar — o 301 e o 41 caem    │
-- │ aqui); código fora da planilha também fica sem. `quebra_pct` e     │
-- │ `quebra_amostra` guardam a força e o tamanho da maioria, para a    │
-- │ tela dizer o grau de certeza em vez de fingir precisão.            │
-- │                                                                     │
-- │ A coluna antiga `responsabilidade` (CLIENTE/REDE/OPERADORA/        │
-- │ TERCEIRO/TECNICO) era vocabulário NOSSO, inventado antes de        │
-- │ existir a planilha — e era o que classificava errado: o painel     │
-- │ dizia "100% Operadora (CLARO)" e "0 por nossa conta" onde a CLARO  │
-- │ diz Serviços de Campo. Fica onde está por enquanto; derrubar       │
-- │ coluna que telas leem é trabalho de outra leva.                    │
-- │                                                                     │
-- │ Depois da troca, 17 a 25/10: 122 O.S. de Serviços de Campo (nossa),│
-- │ 108 DAC, 73 Comercial, 8 sem quebra e 106 "caso a caso".           │
-- └─────────────────────────────────────────────────────────────────────┘

alter table codigo_baixa
  add column if not exists responsavel_quebra text,
  add column if not exists agrupamento_quebra text,
  add column if not exists quebra_amostra integer,
  add column if not exists quebra_pct integer;

comment on column codigo_baixa.responsavel_quebra is
  'RESPONSAVEL_QUEBRA da CLARO (141), aprendido da planilha Quebra Qualificada. Nulo = a CLARO classifica caso a caso, nao da para dizer pelo codigo.';
comment on column codigo_baixa.quebra_pct is
  'Forca da maioria na planilha (141). Abaixo de 50 nao se classifica: seria inventar.';

-- O UPDATE com os 84 códigos foi aplicado a partir da planilha; ver o
-- corpo em `codigo_baixa` (responsavel_quebra, agrupamento_quebra,
-- quebra_amostra, quebra_pct). A planilha NÃO entra no Git: é dado da
-- operadora, com contrato e login de técnico (LGPD, regra 3).

notify pgrst, 'reload schema';
