-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 155c · O SINO le so a cidade ativa                               ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- Continuacao da 155b, do outro lado: la a central passou a MONTAR so
-- a cidade ativa; aqui a leitura dos sinais ja gravados passa a
-- RESPEITAR a cidade. Medido em 29/10 depois do backfill da 155b:
-- 510 sinais de Manaus e 16 de Sao Luis no mesmo dia.
--
-- Duas mudancas alem do filtro:
--   · MATERIAL e ABASTECIMENTO passam a carimbar o tecnico (e, no
--     abastecimento, a base do carro quando nao ha condutor) -- senao o
--     gatilho da 155b nao tem de onde tirar a cidade e o sinal fica
--     global, que e o defeito que estamos consertando;
--   · o detalhe do RITMO passa a vir pronto da `ritmo_do_dia` (155d),
--     porque la ele deixou de ser "pontos" e virou "contratos ate as
--     Nh". O `coalesce` mantem o texto antigo se vier sinal velho.
--
-- Sinal SEM cidade some da tela de todo mundo em vez de aparecer para
-- todo mundo: sinal que nao sabe de onde e nao deve tocar em cidade
-- nenhuma. Hoje nao existe nenhum (o gatilho carimba e o backfill
-- fechou), mas a regra precisa falhar para o lado seguro.

create or replace function sinais_do_dia()
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_c jsonb := central_do_controle();
  v_hoje date := hoje_local();
  v_ini timestamptz := (hoje_local()::timestamp at time zone 'America/Manaus');
  v_emp uuid := minha_empresa();
  v_gestao boolean := eh_gestao();
  v_vigentes text[] := '{}';
  v_fora uuid[] := '{}';
  v_antec int := coalesce((select (valor #>> '{}')::int from parametro
                            where empresa_id = minha_empresa()
                              and chave = 'atraso_antecedencia_min'), 30);
  v_sinais jsonb;
begin
  if v_gestao then
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'AJUDA:' || (x->>'visita_id') || ':' || (x->>'desde'), v_hoje, 'AJUDA',
           'Suporte técnico: ' || coalesce(x->>'tecnico', 'técnico'),
           concat_ws(' · ', x->>'servico',
                     case when x->>'contrato' is not null then 'contrato ' || (x->>'contrato') end,
                     x->>'observacao'),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from jsonb_array_elements(coalesce(v_c->'ajuda', '[]')) x
      join visita v on v.id = (x->>'visita_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'AJUDA:' || (x->>'visita_id') || ':' || (x->>'desde')
                                        from jsonb_array_elements(coalesce(v_c->'ajuda', '[]')) x);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'TEC1:' || v.id, v_hoje, 'TEC1', 'TEC1 perdido: ' || coalesce(t.nome, 'sem técnico'),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     case when e.codigo is not null then 'equipe ' || e.codigo end),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe e on e.id = v.equipe_id
     where v.empresa_id = v_emp and v.excluido_em is null
       and v.data_agendada = v_hoje and v.tec1 = 'SEM_PADRAO'
       and v.base_id in (select bases_visiveis())
       and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'TEC1:' || v.id from visita v
       where v.empresa_id = v_emp and v.excluido_em is null
         and v.data_agendada = v_hoje and v.tec1 = 'SEM_PADRAO');

    -- 139: a baixa saiu LONGE do cliente. O dado ja existia em
    -- `local_da_baixa` (096); o que faltava era virar aviso.
    select coalesce(array_agg(l.visita_id), '{}') into v_fora
      from local_da_baixa(array(
             select v.id from visita v
               left join tipo_atividade ta on ta.id = v.tipo_atividade_id
              where v.empresa_id = v_emp and v.excluido_em is null
                and v.data_agendada = v_hoje
                and v.situacao = any (situacoes_terminais())
                and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
                and v.base_id in (select bases_visiveis())
                and (eh_gestor() or v.equipe_id in (select equipes_visiveis())))) l
     where l.fora_do_raio;

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'LOCAL:' || v.id, v_hoje, 'LOCAL',
           'Baixa longe do cliente: ' || coalesce(t.nome, 'sem tecnico'),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     case when e.codigo is not null then 'equipe ' || e.codigo end,
                     'fora do raio'),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe e on e.id = v.equipe_id
     where v.id = any (v_fora)
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'LOCAL:' || x from unnest(v_fora) x);

    -- 139: a janela esta acabando e ninguem chegou.
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'ATRASO:' || v.id, v_hoje, 'ATRASO',
           'Janela acabando sem chegada: ' || coalesce(t.nome, coalesce(e.codigo, 'sem tecnico')),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     'janela ate ' || to_char(v.janela_fim, 'HH24:MI'),
                     coalesce(sv.label, v.situacao)),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe e on e.id = v.equipe_id
      left join situacao_visita sv on sv.codigo = v.situacao
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.empresa_id = v_emp and v.excluido_em is null
       and v.data_agendada = v_hoje
       and v.janela_fim is not null
       and v.situacao in ('ENTRADA', 'ATRIBUIDA', 'EM_DESLOCAMENTO', 'COM_IMPEDIMENTO')
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       and ((v.data_agendada + v.janela_fim) at time zone 'America/Manaus')
             <= now() + make_interval(mins => v_antec)
       and v.base_id in (select bases_visiveis())
       and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'ATRASO:' || v.id from visita v
        left join tipo_atividade ta on ta.id = v.tipo_atividade_id
       where v.empresa_id = v_emp and v.excluido_em is null
         and v.data_agendada = v_hoje and v.janela_fim is not null
         and v.situacao in ('ENTRADA', 'ATRIBUIDA', 'EM_DESLOCAMENTO', 'COM_IMPEDIMENTO')
         and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
         and ((v.data_agendada + v.janela_fim) at time zone 'America/Manaus')
               <= now() + make_interval(mins => v_antec));

    -- 134: sumiu da planilha do TOA estando EM ANDAMENTO.
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'SUMIU:' || v.id, v_hoje, 'SUMIU_TOA',
           'Sumiu do TOA em andamento: ' || coalesce(t.nome, 'sem técnico'),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     coalesce(sv.label, v.situacao), 'confira no TOA e corrija à mão'),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join situacao_visita sv on sv.codigo = v.situacao
     where v.empresa_id = v_emp and v.excluido_em is null
       and v.sumiu_do_toa_em is not null and v.data_agendada = v_hoje
       and v.base_id in (select bases_visiveis())
       and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'SUMIU:' || v.id from visita v
       where v.empresa_id = v_emp and v.excluido_em is null
         and v.sumiu_do_toa_em is not null and v.data_agendada = v_hoje);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'RITMO:' || (a->>'tecnico_id') || ':' || v_hoje || ':' || (c->>'corte'), v_hoje, 'RITMO',
           'Abaixo do ritmo até ' || (c->>'corte') || 'h: ' || (a->>'nome'),
           -- 155d: o detalhe vem pronto ("1 de 1.50 contrato(s) ate 11h").
           -- O coalesce segura o texto antigo, de pontos, se vier.
           coalesce(a->>'detalhe',
                    (a->>'pontos') || ' de ' || (a->>'esperado') || ' pts esperados'),
           (a->>'tecnico_id')::uuid, t.equipe_id
      from jsonb_array_elements(coalesce(v_c->'ritmo', '[]')) c
      cross join jsonb_array_elements(c->'abaixo') a
      left join tecnico t on t.id = (a->>'tecnico_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'RITMO:' || (a->>'tecnico_id') || ':' || v_hoje || ':' || (u.c->>'corte')
        from (select e.c from jsonb_array_elements(coalesce(v_c->'ritmo', '[]'))
                         with ordinality e(c, i)
               order by e.i desc limit 1) u
        cross join jsonb_array_elements(u.c->'abaixo') a);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'QUEBROU:' || (q->>'tecnico_id') || ':' || v_hoje || ':' || (q->>'quebradas'), v_hoje, 'QUEBROU',
           'Contrato quebrado: ' || (q->>'nome'),
           (q->>'quebradas') || ' quebrado(s) hoje · −' || (q->>'pontos_perdidos') || ' pts',
           (q->>'tecnico_id')::uuid, t.equipe_id
      from jsonb_array_elements(coalesce(v_c->'quebrou', '[]')) q
      left join tecnico t on t.id = (q->>'tecnico_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'QUEBROU:' || (q->>'tecnico_id') || ':' || v_hoje || ':' || (q->>'quebradas')
        from jsonb_array_elements(coalesce(v_c->'quebrou', '[]')) q);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'CERCA:' || ev.id, v_hoje, 'CERCA',
           case ev.tipo when 'SAIU' then 'Saiu ' else 'Entrou ' end
             || case ce.tipo when 'GARAGEM' then 'da garagem ' else 'da área ' end
             || '"' || ce.nome || '": ' || coalesce(t.nome, 'técnico'),
           to_char(ev.em at time zone 'America/Manaus', 'HH24:MI'),
           ev.tecnico_id, ev.equipe_id
      from cerca_evento ev
      join cerca ce on ce.id = ev.cerca_id
      left join tecnico t on t.id = ev.tecnico_id
     where ev.empresa_id = v_emp and ev.alerta and ev.em >= v_ini
       and (eh_gestor() or ev.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'CERCA:' || ev.id from cerca_evento ev
        join cerca_estado st on st.tecnico_id = ev.tecnico_id and st.cerca_id = ev.cerca_id
       where ev.empresa_id = v_emp and ev.alerta and ev.em >= v_ini
         and st.dentro = (ev.tipo = 'ENTROU') and st.desde = ev.em);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'GPS:' || ga.id, v_hoje, 'GPS',
           case ga.tipo
             when 'SIMULADO' then 'Localização simulada: '
             when 'DESLIGADO' then 'GPS desligado: '
             when 'SEM_PERMISSAO' then 'Localização negada: '
             when 'SALTO' then 'Salto de posição: '
             else 'Aparelho modificado: ' end || coalesce(t.nome, 'técnico'),
           concat_ws(' · ', to_char(ga.em at time zone 'America/Manaus', 'HH24:MI'), ga.detalhe),
           ga.tecnico_id, ga.equipe_id
      from gps_alerta ga
      left join tecnico t on t.id = ga.tecnico_id
     where ga.empresa_id = v_emp and ga.em >= v_ini and ga.tipo <> 'NORMALIZADO'
       and (eh_gestor() or ga.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'GPS:' || ga.id from gps_alerta ga
        left join tecnico_gps g on g.tecnico_id = ga.tecnico_id
       where ga.empresa_id = v_emp and ga.em >= v_ini and ga.tipo <> 'NORMALIZADO'
         and (ga.tipo in ('SALTO', 'APARELHO_MODIFICADO')
              or (g.estado = ga.tipo and g.desde = ga.em)));
  end if;

  if v_c ? 'material' then
    -- 155c: o tecnico vai junto -- e dele que o gatilho tira a cidade.
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id)
    select v_emp, 'MATERIAL:' || (m->>'id'), v_hoje, 'MATERIAL',
           case m->>'tipo' when 'FALTANDO' then 'Faltando: ' else 'Com defeito: ' end || coalesce(m->>'item', '—'),
           m->>'tecnico', sm.tecnico_id
      from jsonb_array_elements(v_c->'material') m
      left join sinalizacao_material sm on sm.id = (m->>'id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'MATERIAL:' || (m->>'id') from jsonb_array_elements(v_c->'material') m);
  end if;

  if v_c ? 'abastecimento' then
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, base_id)
    select v_emp, 'ABAST:' || (a->>'id'), v_hoje, 'ABASTECIMENTO',
           'Abastecimento pedido: ' || (a->>'placa'),
           concat_ws(' · ', a->>'tecnico', 'R$ ' || (a->>'valor')),
           ab.tecnico_id, coalesce(t.base_id, ve.base_id)
      from jsonb_array_elements(v_c->'abastecimento') a
      left join abastecimento ab on ab.id = (a->>'id')::uuid
      left join tecnico t on t.id = ab.tecnico_id
      left join veiculo ve on ve.id = ab.veiculo_id
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'ABAST:' || (a->>'id') from jsonb_array_elements(v_c->'abastecimento') a);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'tipo', s.tipo, 'titulo', s.titulo, 'detalhe', s.detalhe,
           'visita_id', s.visita_id, 'tecnico_id', s.tecnico_id, 'criado_em', s.criado_em,
           'vigente', s.chave = any(v_vigentes)
                       or (s.tipo = 'DOIS_ATIVOS' and outros_ativos(s.visita_id) is not null),
           'dispensado', d.sinal_id is not null) order by s.criado_em desc), '[]'::jsonb)
    into v_sinais
    from sinal s
    left join sinal_dispensa d on d.sinal_id = s.id and d.usuario_id = auth.uid()
   where s.empresa_id = v_emp and s.dia = v_hoje
     -- 155c: a CIDADE ATIVA manda. Sinal sem cidade nao existe mais (o
     -- gatilho da 155b carimba), mas se um dia aparecer, ele some da
     -- tela de todo mundo em vez de aparecer para todo mundo: sinal que
     -- nao sabe de onde e nao deve tocar em cidade nenhuma.
     and s.base_id in (select bases_visiveis())
     and case
           when s.tipo in ('AJUDA','TEC1','RITMO','QUEBROU','CERCA','GPS','DOIS_ATIVOS','SUMIU_TOA','LOCAL','ATRASO')
             then v_gestao and (eh_gestor() or s.equipe_id in (select equipes_visiveis()))
           when s.tipo = 'MATERIAL' then tem_permissao('almoxarifado.ver')
           when s.tipo = 'ABASTECIMENTO' then tem_permissao('frota.ver')
           else false
         end;

  return jsonb_build_object('central', v_c, 'sinais', v_sinais);
end;
$function$;

revoke all on function sinais_do_dia() from public, anon;
grant execute on function sinais_do_dia() to authenticated;

notify pgrst, 'reload schema';
