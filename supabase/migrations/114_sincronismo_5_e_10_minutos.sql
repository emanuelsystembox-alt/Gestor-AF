-- ┌─ 114 · o sincronismo também de 5 em 5 e de 10 em 10 minutos ───────┐
-- │ > "adicione 5 minutos e 10 minutos por favor na extensão, pra ter  │
-- │ >  mais opções" — Emanuel, 19/10 (depois da primeira rodada real). │
-- │                                                                    │
-- │ Na 111 os dois tinham ficado de fora por escolha dele. O que       │
-- │ pesava era importar o mesmo arquivo de novo; isso não acontece:    │
-- │ planilha igual vira "Conferido · sem mudança" em 0,4–0,7 s (medido │
-- │ nas rodadas de 19/10), e só reimporta igual depois de 1 hora. O    │
-- │ pulso é de 60 s, então 5 min cabe com folga. Ver D-189.            │
-- └────────────────────────────────────────────────────────────────────┘

alter table sincronismo drop constraint if exists sincronismo_intervalo_min_check;
alter table sincronismo add constraint sincronismo_intervalo_min_check
  check (intervalo_min in (5, 10, 15, 30, 60));

-- configurar_sincronismo: a mesma lista, editada sobre a versão viva.
do $do$
declare
  v_def text; v_n int;
  v_de   constant text := 'if p_intervalo is null or p_intervalo not in (15, 30, 60) then
    raise exception ''Intervalo invalido: use 15, 30 ou 60 minutos.'';';
  v_para constant text := 'if p_intervalo is null or p_intervalo not in (5, 10, 15, 30, 60) then
    raise exception ''Intervalo invalido: use 5, 10, 15, 30 ou 60 minutos.'';';
begin
  v_def := pg_get_functiondef('public.configurar_sincronismo(uuid,boolean,smallint,uuid[])'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_n <> 1 then raise exception 'configurar_sincronismo: esperava 1 trecho, achei %', v_n; end if;
  execute replace(v_def, v_de, v_para);
end
$do$;

notify pgrst, 'reload schema';
