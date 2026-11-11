-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 255 — a hora da COLETA do sinal vem 3 h atrasada do portal da Claro  │
-- │                                                                      │
-- │ "os horário não estão se atualizando conforme o nosso sistema"       │
-- │ (Emanuel, 11/11). Contrato 10896665: o portal mostra a Validação     │
-- │ "11/11/2026 às 10h02m"; a aba Sinal mostrava "coleta 11/11, 06:02" — │
-- │ antes de o técnico chegar (TOA: 08:22–09:19, Manaus).                │
-- │                                                                      │
-- │ O `collectedDate` da API chega como "2026-11-11T07:02:35.000-03:00": │
-- │ o relógio de BRASÍLIA (10:02) tomado como UTC e convertido para -03  │
-- │ de novo. A hora certa é o relógio UTC desse valor lido como          │
-- │ America/Sao_Paulo (= +3 h; o Brasil não tem horário de verão).       │
-- │                                                                      │
-- │ MEDIDO em 11/11, 1.121 aparelhos da Validação contra a janela do TOA │
-- │ (início..fim + 5 min) de contrato finalizado:                        │
-- │   cru: 0 dentro · +3 h: Manaus 576 de 580 dentro, mediana 12 min     │
-- │   antes do fim; nenhum depois do fim.                                │
-- │ Em São Luís o +3 h cai 1 h antes do início (498 de 541) e o +4 h     │
-- │ encaixa — o portal é o mesmo, então a suspeita é o início/fim de São │
-- │ Luís estar gravado 1 h adiantado (hora local lida como Manaus). NÃO  │
-- │ mexido aqui: está registrado na D-369 para conferir.                 │
-- │                                                                      │
-- │ Só o valor no formato observado (sempre "-03:00") é corrigido; outro │
-- │ formato passa como veio. Se a Claro consertar a API um dia, o valor  │
-- │ muda de forma e esta conta precisa ser revista (D-369).              │
-- │ `updatedAt` (portal_atualizado_em) não é mostrado e não foi mexido.  │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.hora_do_portal_claro(p text)
returns timestamptz
language sql stable
set search_path = public
as $$
  select case
    when p ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?-03:00$'
      then (p::timestamptz at time zone 'UTC') at time zone 'America/Sao_Paulo'
    when p ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
      then p::timestamptz
  end
$$;
revoke all on function public.hora_do_portal_claro(text) from public, anon;
grant execute on function public.hora_do_portal_claro(text) to authenticated, service_role;

-- a função viva (pg_get_functiondef de 11/11), só com a coleta trocada
CREATE OR REPLACE FUNCTION public.registrar_sinal_claro(p_dia date, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  i jsonb;
  v_vis uuid; v_emp uuid; v_base uuid;
  v_wo text; v_eq jsonb;
  n_ok int := 0; n_sem int := 0; n_eq int := 0;
  sem text[] := '{}';
begin
  -- quem pode rodar a extensão (o mesmo de registrar_varredura)
  if not ((eh_gestao() or tem_papel('ROBO')) and tem_permissao('importacao.executar')) then
    raise exception 'Sem permissao para gravar o sinal do portal.' using errcode = '42501';
  end if;
  if p_dia is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'Dia e lista sao obrigatorios.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_itens) > 200 then
    raise exception 'No maximo 200 itens por chamada.' using errcode = '22023';
  end if;

  for i in select * from jsonb_array_elements(p_itens) loop
    v_vis := null;
    v_wo := case when btrim(coalesce(i->>'workOrderCode', '')) ~ '^\d+$'
                  and btrim(coalesce(i->>'operatorCode', '')) ~ '^\d+$'
                 then lpad(btrim(i->>'operatorCode'), 5, '0') || '|' || btrim(i->>'workOrderCode') end;

    -- 1º a WO no dia; 2º a O.S. no dia. Só nas cidades que a pessoa acessa.
    if v_wo is not null then
      select v.id, v.empresa_id, v.base_id into v_vis, v_emp, v_base
        from visita v
       where v.wo_numero = v_wo and v.data_agendada = p_dia and v.excluido_em is null
         and v.empresa_id = (select minha_empresa())
         and v.base_id in (select bases_permitidas())
       order by v.criado_em desc limit 1;
    end if;
    if v_vis is null and btrim(coalesce(i->>'osNumber', '')) <> '' then
      select v.id, v.empresa_id, v.base_id into v_vis, v_emp, v_base
        from ordem_servico o join visita v on v.id = o.visita_id
       where o.numero_os = btrim(i->>'osNumber') and v.data_agendada = p_dia and v.excluido_em is null
         and v.empresa_id = (select minha_empresa())
         and v.base_id in (select bases_permitidas())
       order by v.criado_em desc limit 1;
    end if;

    if v_vis is null then
      n_sem := n_sem + 1;
      sem := sem || coalesce(nullif(btrim(i->>'osNumber'), ''), v_wo, '?');
      continue;
    end if;

    -- só o que a tela usa, com nome nosso; os canais ficam como o portal manda
    v_eq := null;
    if jsonb_typeof(i->'equipamentos') = 'array' then
      select coalesce(jsonb_agg(jsonb_build_object(
               'etapa',       e->'stage'->>'text',
               'etapa_tipo',  e->'stage'->'type',
               'tipo',        e->'type'->>'text',
               'status',      e->>'status',
               'modelo',      left(e->>'model', 60),
               'mac',         left(e->>'mac', 40),
               'tecnologia',  e->>'technologyType',
               'coletado_em', hora_do_portal_claro(e->>'collectedDate'),
               'upstreams',   coalesce(e->'upstreams', '[]'::jsonb),
               'downstreams', coalesce(e->'downstreams', '[]'::jsonb),
               'ofdm',        coalesce(e->'ofdm', '[]'::jsonb),
               'ofdma',       coalesce(e->'ofdma', '[]'::jsonb))), '[]'::jsonb)
        into v_eq
        from jsonb_array_elements(i->'equipamentos') e;
      n_eq := n_eq + 1;
    end if;

    insert into sinal_claro as s (
      visita_id, empresa_id, base_id, portal_id, os_numero, wo_codigo, dia,
      inicial_tipo, inicial_texto, inicial_cor, validacao_tipo, validacao_texto, validacao_cor,
      pnm_texto, status_os_texto, atendimento_tipo, tecnologia, tecnico_login, status_portal,
      equipamentos, equipamentos_lidos_em, portal_atualizado_em, lido_em, lido_por,
      inicial_resumo, validacao_resumo)
    values (
      v_vis, v_emp, v_base, (i->>'id')::bigint, left(i->>'osNumber', 20), left(i->>'workOrderCode', 20), p_dia,
      case when i->'initialDiagnosis'->>'type' ~ '^\d+$' then (i->'initialDiagnosis'->>'type')::smallint end,
      left(i->'initialDiagnosis'->>'text', 60), left(i->'initialDiagnosis'->>'color', 20),
      case when i->'validationDiagnosis'->>'type' ~ '^\d+$' then (i->'validationDiagnosis'->>'type')::smallint end,
      left(i->'validationDiagnosis'->>'text', 60), left(i->'validationDiagnosis'->>'color', 20),
      left(i->'pnmDiagnosis'->>'text', 60), left(i->'osStatus'->>'text', 40),
      left(i->>'attendingType', 40), left(i->>'technologyType', 20), left(i->>'technicianLogin', 20),
      case when jsonb_typeof(i->'workOrderStatus') = 'array' then i->'workOrderStatus' end,
      v_eq, case when v_eq is not null then now() end,
      case when btrim(coalesce(i->>'updatedAt', '')) <> '' then (i->>'updatedAt')::timestamptz end,
      now(), auth.uid(),
      resumir_sinal(v_eq, 1), resumir_sinal(v_eq, 2))
    on conflict (visita_id) do update set
      portal_id = excluded.portal_id, os_numero = excluded.os_numero, wo_codigo = excluded.wo_codigo,
      dia = excluded.dia,
      inicial_tipo = excluded.inicial_tipo, inicial_texto = excluded.inicial_texto, inicial_cor = excluded.inicial_cor,
      validacao_tipo = excluded.validacao_tipo, validacao_texto = excluded.validacao_texto,
      validacao_cor = excluded.validacao_cor,
      pnm_texto = excluded.pnm_texto, status_os_texto = excluded.status_os_texto,
      atendimento_tipo = excluded.atendimento_tipo, tecnologia = excluded.tecnologia,
      tecnico_login = excluded.tecnico_login, status_portal = excluded.status_portal,
      equipamentos = coalesce(excluded.equipamentos, s.equipamentos),
      equipamentos_lidos_em = coalesce(excluded.equipamentos_lidos_em, s.equipamentos_lidos_em),
      inicial_resumo = coalesce(excluded.inicial_resumo, s.inicial_resumo),
      validacao_resumo = coalesce(excluded.validacao_resumo, s.validacao_resumo),
      portal_atualizado_em = excluded.portal_atualizado_em,
      lido_em = now(), lido_por = auth.uid();
    n_ok := n_ok + 1;
  end loop;

  return jsonb_build_object('gravados', n_ok, 'sem_contrato', n_sem, 'equipamentos', n_eq,
                            'sem_contrato_os', to_jsonb(sem));
end;
$function$

;

-- os já gravados: só o que ainda está no formato cru ("-03:00")
update sinal_claro s
   set equipamentos = (
     select jsonb_agg(case when x.e->>'coletado_em' like '%-03:00'
                           then jsonb_set(x.e, '{coletado_em}', to_jsonb(hora_do_portal_claro(x.e->>'coletado_em')))
                           else x.e end order by x.ord)
       from jsonb_array_elements(s.equipamentos) with ordinality x(e, ord))
 where jsonb_typeof(s.equipamentos) = 'array'
   and exists (select 1 from jsonb_array_elements(s.equipamentos) e where e->>'coletado_em' like '%-03:00');

notify pgrst, 'reload schema';
