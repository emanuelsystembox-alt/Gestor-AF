-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 236 — Transferir o contrato para OUTRO DIA (D-345)                   │
-- │                                                                      │
-- │ "quando eu quiser transferir um contrato de um dia para outro o      │
-- │  sistema deve permitir, tem opção de escolher data, isso para o      │
-- │  site, falta habilitar." — Emanuel, 09/11.                           │
-- │                                                                      │
-- │ `transferir_visita` ganha `p_data`: troca a equipe, o dia, ou os     │
-- │ dois. Sem `p_data` é a transferência de sempre — o site publicado    │
-- │ chama com 3 argumentos e continua funcionando.                       │
-- │                                                                      │
-- │ • O dia governa a hora (D-166): `inicio` e `fim` andam o mesmo       │
-- │   número de dias. Um contrato com o dia num lugar e a hora de outro  │
-- │   estraga o TEC1 em 24 h.                                            │
-- │ • A atividade do TOA é única por dia (D-169, `visita_toa_dia_uk`):   │
-- │   se o mesmo contrato do TOA já está no dia de destino, recusa com   │
-- │   o recado — em vez do erro de índice.                               │
-- │ • Só o dia muda: a equipe e o técnico ficam. Equipe nova sem técnico,│
-- │   como sempre foi.                                                   │
-- │ • Fica no histórico (TRANSFERENCIA, com o dia no de/para) e o        │
-- │   técnico é avisado pelo gatilho de sempre (059).                    │
-- │                                                                      │
-- │ Assinatura nova não convive com a antiga (traps.md): a de 3          │
-- │ parâmetros cai na mesma transação, e a nova nasce com a ACL fechada. │
-- └──────────────────────────────────────────────────────────────────────┘

drop function if exists transferir_visita(uuid, uuid, text);

create or replace function transferir_visita(
  p_visita uuid, p_equipe uuid, p_motivo text default null, p_data date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ant uuid; v_cod_ant text; v_cod_novo text; v_fixada boolean;
  v_dia date; v_base uuid; v_toa text; v_equipe uuid; v_dias int;
begin
  if not (eh_gestao() and tem_permissao('servicos.transferir')) then
    raise exception 'Sem permissao para transferir.' using errcode = '42501';
  end if;

  select equipe_id, rota_fixada_em is not null, data_agendada, base_id, toa_atividade_id
    into v_ant, v_fixada, v_dia, v_base, v_toa
    from visita
   where id = p_visita and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis());
  if not found then raise exception 'Visita nao encontrada.'; end if;

  v_equipe := coalesce(p_equipe, v_ant);
  if v_ant is not distinct from v_equipe and (p_data is null or p_data = v_dia) then
    return jsonb_build_object('mudou', false);
  end if;

  if p_data is not null and p_data <> v_dia and v_toa is not null and exists (
       select 1 from visita x
        where x.base_id = v_base and x.toa_atividade_id = v_toa
          and x.data_agendada = p_data and x.id <> p_visita) then
    raise exception 'Este contrato do TOA ja existe em %. Abra o de la.',
      to_char(p_data, 'DD/MM/YYYY');
  end if;

  select codigo into v_cod_ant  from equipe where id = v_ant;
  select codigo into v_cod_novo from equipe where id = v_equipe;
  v_dias := coalesce(p_data, v_dia) - v_dia;

  insert into visita_evento (visita_id, usuario_id, equipe_id, tipo,
                             de, para, observacao, origem)
  values (p_visita, auth.uid(), v_ant, 'TRANSFERENCIA',
          jsonb_strip_nulls(jsonb_build_object(
            'equipe', v_cod_ant,
            'dia', case when v_dias <> 0 then v_dia end)),
          jsonb_strip_nulls(jsonb_build_object(
            'equipe', v_cod_novo,
            'dia', case when v_dias <> 0 then v_dia + v_dias end)),
          p_motivo, 'WEB');

  -- 170: a rota fixada fica como estava (D-257)
  update visita set
      equipe_id = v_equipe,
      tecnico_responsavel_id = case when v_equipe is distinct from v_ant
                                    then null else tecnico_responsavel_id end,
      data_agendada = v_dia + v_dias,
      inicio = inicio + make_interval(days => v_dias),
      fim    = fim    + make_interval(days => v_dias)
   where id = p_visita;

  return jsonb_build_object('mudou', true, 'de', v_cod_ant, 'para', v_cod_novo,
                            'dia', v_dia + v_dias, 'rota_fixada', v_fixada);
end;
$$;

revoke all on function transferir_visita(uuid, uuid, text, date) from public, anon;
grant execute on function transferir_visita(uuid, uuid, text, date) to authenticated;

notify pgrst, 'reload schema';
