-- ┌─ 123 · segmentação do cliente e caso crítico (ouvidoria) ───────────┐
-- │ > "adicione ao nosso banco a coluna Segmentação (...) e coluna Caso │
-- │ >  crítico (ouvidoria) preciso dizer se é ouvidoria ou não, se for  │
-- │ >  ouvidoria, deve subir um marcador preto, se não for a vida segue │
-- │ >  normal" — Emanuel, 20/10                                         │
-- │                                                                    │
-- │ As duas JÁ vinham na planilha do TOA e moravam só em              │
-- │ `dados_origem`. Medido em 20/10 (1.118 visitas):                   │
-- │   "Caso crítico (ouvidoria)": em TODAS — "não" 1.116, "sim" 2;     │
-- │   "Segmentação": PURPLE 399, SEM SEGMENTO 195, PME 61, BLACK 12,   │
-- │   PURPLE PME PF 10, WHITE 8; vazia nas 353 de jornada e em 80      │
-- │   produtivas.                                                      │
-- │                                                                    │
-- │ Colunas GERADAS da linha do TOA, como a `janela_imediata` (115): a │
-- │ importação não muda e a reimportação acompanha sozinha.            │
-- │ `ouvidoria` é NULA quando a linha não traz a coluna — "não sei" não│
-- │ é "não" (regra 6).                                                 │
-- │                                                                    │
-- │ ERRO MEU, desfeito na mesma hora (123b): a SEGMENTAÇÃO JÁ EXISTIA — │
-- │ tabela `segmentacao` (8 segmentos) e `visita.segmentacao_id`,         │
-- │ preenchida por `importar_toa_interno` (685 contratos, os mesmos que │
-- │ trazem o valor). A coluna gerada abaixo era uma cópia: foi         │
-- │ derrubada, e as telas leem `segmentacao:segmentacao_id ( nome )`.     │
-- │ Antes de criar coluna, procure o dado no schema (`information_schema`│
-- │ por nome parecido), não só no `dados_origem`.                       │
-- └────────────────────────────────────────────────────────────────────┘

alter table visita add column if not exists segmentacao text
  generated always as (nullif(upper(btrim(coalesce(dados_origem ->> 'Segmentação', ''))), '')) stored;

alter table visita add column if not exists ouvidoria boolean
  generated always as (
    case when nullif(btrim(coalesce(dados_origem ->> 'Caso crítico (ouvidoria)', '')), '') is null then null
         else lower(btrim(dados_origem ->> 'Caso crítico (ouvidoria)')) in ('sim', 's', 'yes', 'true', '1')
    end) stored;

comment on column visita.segmentacao is
  'Segmentação do cliente, como o TOA mandou (PURPLE, PME, BLACK...). Nula = a linha não trouxe (123).';
comment on column visita.ouvidoria is
  'Caso crítico (ouvidoria) do TOA. Nula = a linha não trouxe a coluna; não é "não" (123).';

-- o filtro "só ouvidoria" procura poucos entre muitos
create index if not exists visita_ouvidoria_idx on visita (data_agendada) where ouvidoria;

-- 123b: a segmentação já existia (segmentacao_id) — a cópia sai.
alter table visita drop column if exists segmentacao;

notify pgrst, 'reload schema';
