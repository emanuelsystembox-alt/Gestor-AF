-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 223 — Sinal Claro: o que ficou fora, por tipo (Internet, TV) (D-331)  │
-- │                                                                      │
-- │ "é bom mostrar o que ficou fora, se é Virtua, ou TV (...) ir nos     │
-- │  equipamentos e colocar o sinal dele antes e depois" — Emanuel, 06/11│
-- │                                                                      │
-- │ Por etapa (1 = diagnóstico inicial, 2 = validação) e por tipo do     │
-- │ portal, o pior estado dos aparelhos daquele tipo:                    │
-- │   FORA    — algum canal que a CLARO pintou de vermelho               │
-- │   OFFLINE — aparelho offline (sem canal vermelho)                     │
-- │   ERRO    — o portal não conseguiu coletar                           │
-- │   OK      — nenhum dos três                                          │
-- │ A cor é da Claro; a regra nossa é só "o pior entre os aparelhos".    │
-- │ Medido em 06/11 (119 aparelhos): "Nível Regular" NUNCA tem canal     │
-- │ vermelho; TV offline aparece em "Nível Regular" (3 vezes) — por isso │
-- │ OFFLINE não é "fora".                                                │
-- │                                                                      │
-- │ Calculado na gravação e guardado: a lista de Serviços mostra sem     │
-- │ carregar os canais. Muda junto quando o portal for lido de novo.     │
-- └──────────────────────────────────────────────────────────────────────┘

alter table sinal_claro add column if not exists inicial_resumo jsonb;
alter table sinal_claro add column if not exists validacao_resumo jsonb;

create or replace function resumir_sinal(p_eq jsonb, p_etapa int)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case when p_eq is null then null else coalesce((
    select jsonb_agg(jsonb_build_object('tipo', tipo, 'estado', estado) order by tipo)
      from (
        select a.tipo,
               case when bool_or(a.vermelho) then 'FORA'
                    when bool_or(a.st = 'offline') then 'OFFLINE'
                    when bool_or(a.st = 'error') then 'ERRO'
                    else 'OK' end as estado
          from (
            select coalesce(nullif(e->>'tipo', ''), '?') as tipo,
                   lower(coalesce(e->>'status', '')) as st,
                   exists (
                     select 1 from jsonb_array_elements(
                         coalesce(e->'upstreams', '[]'::jsonb) || coalesce(e->'downstreams', '[]'::jsonb)
                      || coalesce(e->'ofdm', '[]'::jsonb) || coalesce(e->'ofdma', '[]'::jsonb)) c
                      where upper(c->'signalColor'->>'color') = 'RED') as vermelho
              from jsonb_array_elements(p_eq) e
             where (e->>'etapa_tipo') = p_etapa::text
          ) a
         group by a.tipo
      ) t), '[]'::jsonb) end;
$$;

revoke all on function resumir_sinal(jsonb, int) from public, anon;
grant execute on function resumir_sinal(jsonb, int) to authenticated;

create or replace function registrar_sinal_claro(p_dia date, p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
               'coletado_em', e->>'collectedDate',
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
$$;

-- o que já estava gravado
update sinal_claro set inicial_resumo = resumir_sinal(equipamentos, 1),
                       validacao_resumo = resumir_sinal(equipamentos, 2)
 where equipamentos is not null;

notify pgrst, 'reload schema';
