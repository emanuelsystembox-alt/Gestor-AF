-- ┌─ 115 · "Imediata" não é "sem janela" ──────────────────────────────┐
-- │ > "ultimo contrato escritio, sem janela - ele esta com horário -   │
-- │ >  imediata - então nesse caso por favor colocar o nome imediata,  │
-- │ >  e não seme janela." — Emanuel, 19/10 (contrato 227080444).      │
-- │                                                                    │
-- │ O TOA manda a coluna "Intervalo de Tempo" = "Imediata" no lugar da │
-- │ faixa (08:00 - 12:00): é atendimento para já, não agendado. A      │
-- │ janela fica vazia e a tela dizia "sem janela" — como se o TOA não  │
-- │ tivesse informado. Medido: 25 de 701 visitas, TODAS sem janela;    │
-- │ os outros "sem janela" (121) são jornada, sem Intervalo de Tempo.  │
-- │                                                                    │
-- │ Coluna GERADA da linha do TOA (`dados_origem`): a importação não   │
-- │ muda, e a reimportação acompanha sozinha. Não mexe no TEC1 — se    │
-- │ "Imediata" tem prazo no livro da CLARO, é outra decisão.           │
-- └────────────────────────────────────────────────────────────────────┘

alter table visita add column if not exists janela_imediata boolean
  generated always as (upper(btrim(coalesce(dados_origem ->> 'Intervalo de Tempo', ''))) = 'IMEDIATA') stored;

comment on column visita.janela_imediata is
  'O TOA mandou "Intervalo de Tempo" = Imediata: atendimento para já, sem faixa de janela (115).';

notify pgrst, 'reload schema';
