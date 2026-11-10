-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 237 — Contrato levado de dia à mão: a importação não mexe (D-346)    │
-- │                                                                      │
-- │ "por se tratar de ser manual, quando importar no outro dia, não deve │
-- │  acontecer nada com o contrato" — Emanuel, 09/11.                    │
-- │                                                                      │
-- │ O contrato levado para outro dia (236) continua "visto" pelo arquivo │
-- │ do bucket do dia ANTIGO. Na importação do dia novo, sem a atividade  │
-- │ na planilha, `desatribuir_ausentes` o tomava por "sumiu do TOA":     │
-- │ Na entrada → Desatribuído (800, D-191); em andamento → acusado.      │
-- │                                                                      │
-- │ `visita.dia_movido_em` marca o contrato cujo dia uma PESSOA mudou    │
-- │ (Transferir ou Editar cadastro), e as duas regras do "sumiu" pulam   │
-- │ quem tem a marca. Se o TOA trouxer a mesma atividade naquele dia, a  │
-- │ importação atualiza como sempre — é o TOA afirmando, e o índice      │
-- │ único por dia (D-169) não deixa nascer um segundo contrato.          │
-- │ Nenhum contrato tinha sido movido de dia até aqui: nada a preencher. │
-- └──────────────────────────────────────────────────────────────────────┘

alter table visita add column if not exists dia_movido_em timestamptz;
comment on column visita.dia_movido_em is
  'Quando uma pessoa mudou o dia do contrato (237, D-346). A importação não o trata como "sumiu do TOA".';

CREATE OR REPLACE FUNCTION public.transferir_visita(p_visita uuid, p_equipe uuid, p_motivo text DEFAULT NULL::text, p_data date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- 237: dia mudado à mão — a importação do dia novo não mexe nele
      dia_movido_em = case when v_dias <> 0 then now() else dia_movido_em end,
      inicio = inicio + make_interval(days => v_dias),
      fim    = fim    + make_interval(days => v_dias)
   where id = p_visita;

  return jsonb_build_object('mudou', true, 'de', v_cod_ant, 'para', v_cod_novo,
                            'dia', v_dia + v_dias, 'rota_fixada', v_fixada);
end;
$function$;

CREATE OR REPLACE FUNCTION public.atualizar_visita_manual(p_visita uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_antes jsonb; v_depois jsonb; v_mudou int;
begin
  if not ((select eh_gestor()) or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')) then
    raise exception 'Sem permissao para editar contrato.' using errcode = '42501';
  end if;
  if not tem_permissao('servicos.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar contrato".'
      using errcode = '42501';
  end if;

  select to_jsonb(v) - 'dados_origem' into v_antes from visita v
   where v.id = p_visita and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  if v_antes is null then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  update visita set
    contrato        = coalesce(nullif(btrim(p_dados->>'contrato'), ''), contrato),
    wo_numero       = coalesce(nullif(btrim(p_dados->>'wo_numero'), ''), wo_numero),
    cliente_nome    = coalesce(nullif(btrim(p_dados->>'cliente_nome'), ''), cliente_nome),
    tipo_pessoa     = coalesce(nullif(p_dados->>'tipo_pessoa', ''), tipo_pessoa),
    tipo_residencia = coalesce(nullif(p_dados->>'tipo_residencia', ''), tipo_residencia),
    telefones       = case when p_dados ? 'telefones'
                      then array(select jsonb_array_elements_text(p_dados->'telefones'))
                      else telefones end,
    logradouro      = coalesce(nullif(btrim(p_dados->>'logradouro'), ''), logradouro),
    complemento     = coalesce(nullif(btrim(p_dados->>'complemento'), ''), complemento),
    bairro          = coalesce(nullif(btrim(p_dados->>'bairro'), ''), bairro),
    cidade          = coalesce(nullif(btrim(p_dados->>'cidade'), ''), cidade),
    uf              = coalesce(left(nullif(btrim(p_dados->>'uf'), ''),2), uf),
    cep             = coalesce(nullif(btrim(p_dados->>'cep'), ''), cep),
    node            = coalesce(nullif(btrim(p_dados->>'node'), ''), node),
    lat             = coalesce(nullif(p_dados->>'lat','')::numeric, lat),
    lng             = coalesce(nullif(p_dados->>'lng','')::numeric, lng),
    area_id         = coalesce(nullif(p_dados->>'area_id','')::uuid, area_id),
    tipo_servico_id = coalesce(nullif(p_dados->>'tipo_servico_id','')::uuid, tipo_servico_id),
    data_agendada   = coalesce(nullif(p_dados->>'data_agendada','')::date, data_agendada),
    -- 237: dia mudado à mão pelo Editar também conta
    dia_movido_em   = case when nullif(p_dados->>'data_agendada','')::date is distinct from null
                            and nullif(p_dados->>'data_agendada','')::date <> data_agendada
                           then now() else dia_movido_em end,
    janela_inicio   = coalesce(nullif(p_dados->>'janela_inicio','')::time, janela_inicio),
    janela_fim      = coalesce(nullif(p_dados->>'janela_fim','')::time, janela_fim),
    observacao      = coalesce(nullif(btrim(p_dados->>'observacao'), ''), observacao)
  where id = p_visita;

  select to_jsonb(v) - 'dados_origem' into v_depois from visita v where v.id = p_visita;

  with dif as (
    select k from jsonb_object_keys(v_depois) k
     where v_antes->k is distinct from v_depois->k
       and k not in ('atualizado_em','situacao_em')
  )
  insert into visita_evento (visita_id, tipo, de, para, origem, usuario_id, login)
  select p_visita, 'EDICAO_CADASTRO',
         (select jsonb_object_agg(k, v_antes->k)  from dif),
         (select jsonb_object_agg(k, v_depois->k) from dif),
         'WEB', auth.uid(), (select email from perfil where id = auth.uid())
   where exists (select 1 from dif);

  get diagnostics v_mudou = row_count;
  return jsonb_build_object('atualizado', true, 'registrou_evento', v_mudou > 0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.desatribuir_ausentes(p_importacao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_imp  importacao;
  v_dia  date;
  v_800  uuid;
  v_eu   uuid := auth.uid();
  n_des  int := 0;
  n_dev  int := 0;
  n_sum  int := 0;
  n_vol  int := 0;
  r      record;
  c_obs_des constant text := 'Saiu da sua rota no TOA: desatribuído automaticamente (cód. 800).';
  c_obs_dev constant text := 'Voltou para a rota no TOA: de volta Na entrada.';
  c_obs_sum constant text :=
    'Sumiu da planilha do TOA enquanto estava em andamento. Nada foi alterado: confira no TOA e corrija à mão.';
  c_obs_vol constant text := 'Voltou a aparecer na planilha do TOA.';
  -- 189: o que estava em deslocamento e sumiu vai até Em execução e espera a baixa
  c_obs_sum_exec constant text :=
    'Sumiu da planilha do TOA depois de sair para o endereço: fica em execução até você dar a baixa.';
  v_obs text;
  -- 210 (D-312)
  v_hora time;
  v_100  uuid;
  n_nc   int := 0;
  c_obs_nc constant text :=
    'Agendamento não cumprido: pendente no TOA depois das 21:20 — reagendado automaticamente (cód. 100).';
begin
  -- 165: a fila da cidade — só a importação da vez mexe nos contratos.
  perform exigir_vez_importacao(p_importacao_id);
  if not ((eh_gestao() or tem_papel('ROBO')) and tem_permissao('importacao.executar')) then
    raise exception 'Sem permissao para importar.' using errcode = '42501';
  end if;

  select * into v_imp from importacao where id = p_importacao_id;
  if not found or v_imp.base_id not in (select bases_visiveis()) then
    raise exception 'Importacao fora da cidade ativa.' using errcode = '42501';
  end if;
  if v_imp.status <> 'APLICADA' or v_imp.bucket is null then
    return jsonb_build_object('desatribuidos', 0, 'devolvidos', 0,
                              'sumiram', 0, 'voltaram', 0,
                              'motivo', 'importacao nao aplicada ou sem bucket');
  end if;
  v_dia := coalesce(v_imp.data_atuacao, hoje_local());

  select id into v_800 from codigo_baixa
   where codigo = 800 and (empresa_id is null or empresa_id = v_imp.empresa_id)
   order by empresa_id nulls last limit 1;
  if v_800 is null then
    raise exception 'O codigo de baixa 800 (Desatribuido) nao esta cadastrado.';
  end if;

  perform set_config('app.origem', 'IMPORTACAO', true);

  -- 1. VOLTOU: estava desatribuido e apareceu de novo nesta planilha
  for r in
    select v.id, v.situacao from visita v
     where v.desatribuido_em is not null and v.excluido_em is null
       and v.id in (select l.visita_id from importacao_linha l
                     where l.importacao_id = p_importacao_id and l.visita_id is not null)
  loop
    update ordem_servico
       set codigo_baixa_afline_id = null, baixa_em = null, baixa_por = null, baixa_observacao = null
     where visita_id = r.id and codigo_baixa_afline_id = v_800
       and baixa_observacao = c_obs_des;

    if r.situacao = 'CANCELADA' then
      insert into visita_evento (visita_id, tipo, de, para, origem, observacao, importacao_id)
      values (r.id, 'SITUACAO', jsonb_build_object('situacao', 'CANCELADA'),
              jsonb_build_object('situacao', 'ENTRADA'), 'IMPORTACAO', c_obs_dev, p_importacao_id);
      update visita set situacao = 'ENTRADA', situacao_em = now(),
                        desatribuido_em = null, desatribuido_por_importacao = null
       where id = r.id;
    else
      update visita set desatribuido_em = null, desatribuido_por_importacao = null where id = r.id;
    end if;
    n_dev := n_dev + 1;
  end loop;

  -- 1b. 134: estava acusado de ter sumido e voltou a planilha
  for r in
    select v.id from visita v
     where v.sumiu_do_toa_em is not null and v.excluido_em is null
       and v.id in (select l.visita_id from importacao_linha l
                     where l.importacao_id = p_importacao_id and l.visita_id is not null)
  loop
    update visita set sumiu_do_toa_em = null, sumiu_do_toa_importacao = null where id = r.id;
    insert into visita_evento (visita_id, tipo, origem, observacao, importacao_id)
    values (r.id, 'CONFLITO_TOA', 'IMPORTACAO', c_obs_vol, p_importacao_id);
    n_vol := n_vol + 1;
  end loop;

  -- 2. SUMIU: Na entrada, do mesmo bucket, e nao esta nesta planilha
  for r in
    with presentes as materialized (
      select l.visita_id, nullif(btrim(l.dados ->> 'ID da Atividade'), '') as atividade
        from importacao_linha l where l.importacao_id = p_importacao_id
    )
    select v.id from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      cross join lateral (
        select i.bucket from importacao_linha l join importacao i on i.id = l.importacao_id
         where l.visita_id = v.id and i.status = 'APLICADA'
         order by i.criado_em desc limit 1) ult
     where v.base_id = v_imp.base_id
       and v.data_agendada = v_dia
       and v.excluido_em is null
       and v.situacao = 'ENTRADA'
       and v.bloqueado_em is null
       and v.desatribuido_em is null
       and v.toa_atividade_id is not null
       and coalesce(ta.natureza, '') <> 'JORNADA'
       and ult.bucket = v_imp.bucket
       and v.dia_movido_em is null   -- 237 (D-346): dia mudado à mão não é "sumiu"
       and not exists (select 1 from presentes p where p.visita_id = v.id)
       and not exists (select 1 from presentes p where p.atividade = v.toa_atividade_id)
  loop
    update ordem_servico
       set codigo_baixa_afline_id = v_800, baixa_em = now(), baixa_por = v_eu,
           baixa_observacao = c_obs_des
     where visita_id = r.id and codigo_baixa_afline_id is null;

    insert into visita_evento (visita_id, tipo, de, para, origem, observacao, importacao_id)
    values (r.id, 'SITUACAO', jsonb_build_object('situacao', 'ENTRADA'),
            jsonb_build_object('situacao', 'CANCELADA'), 'IMPORTACAO', c_obs_des, p_importacao_id);
    update visita set situacao = 'CANCELADA', situacao_em = now(),
                      desatribuido_em = now(), desatribuido_por_importacao = p_importacao_id
     where id = r.id;
    n_des := n_des + 1;
  end loop;

  -- 3. 134: EM ANDAMENTO e sumiu -- nao se mexe, acusa
  for r in
    with presentes as materialized (
      select l.visita_id, nullif(btrim(l.dados ->> 'ID da Atividade'), '') as atividade
        from importacao_linha l where l.importacao_id = p_importacao_id
    )
    select v.id, v.equipe_id, v.contrato, v.tecnico_responsavel_id, v.situacao,
           coalesce(ts.nome, ta.nome, 'Contrato') as servico
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join tipo_servico ts on ts.id = v.tipo_servico_id
      cross join lateral (
        select i.bucket from importacao_linha l join importacao i on i.id = l.importacao_id
         where l.visita_id = v.id and i.status = 'APLICADA'
         order by i.criado_em desc limit 1) ult
     where v.base_id = v_imp.base_id
       and v.data_agendada = v_dia
       and v.excluido_em is null
       and v.situacao in ('ATRIBUIDA', 'EM_DESLOCAMENTO', 'EM_EXECUCAO', 'COM_IMPEDIMENTO')
       and v.sumiu_do_toa_em is null
       and v.toa_atividade_id is not null
       and coalesce(ta.natureza, '') <> 'JORNADA'
       and ult.bucket = v_imp.bucket
       and v.dia_movido_em is null   -- 237 (D-346): dia mudado à mão não é "sumiu"
       and not exists (select 1 from presentes p where p.visita_id = v.id)
       and not exists (select 1 from presentes p where p.atividade = v.toa_atividade_id)
  loop
    -- 189: "se teve status o sistema leva o contrato até em execução" (Emanuel,
    -- 03/11). Em deslocamento é movimento; o resto continua só acusado.
    -- A situação muda ANTES de marcar o sumiço (limpar_sumiu_do_toa).
    v_obs := c_obs_sum;
    if r.situacao = 'EM_DESLOCAMENTO' then
      update visita set situacao = 'EM_EXECUCAO', situacao_em = now() where id = r.id;
      v_obs := c_obs_sum_exec;
    end if;

    update visita set sumiu_do_toa_em = now(), sumiu_do_toa_importacao = p_importacao_id
     where id = r.id;

    insert into visita_evento (visita_id, tipo, de, para, origem, observacao, importacao_id)
    values (r.id, 'CONFLITO_TOA',
            case when v_obs = c_obs_sum_exec then jsonb_build_object('situacao', r.situacao) end,
            case when v_obs = c_obs_sum_exec then jsonb_build_object('situacao', 'EM_EXECUCAO') end,
            'IMPORTACAO', v_obs, p_importacao_id);

    if r.equipe_id is not null then
      insert into aviso (empresa_id, equipe_id, visita_id, tipo, titulo, detalhe,
                         contrato, servico, situacao_para)
      values (v_imp.empresa_id, r.equipe_id, r.id, 'SUMIU_TOA',
              'Contrato sumiu da planilha do TOA',
              v_obs, r.contrato, r.servico, r.situacao);
    end if;
    n_sum := n_sum + 1;
  end loop;

  -- 4. 210 (D-312): depois das 21:20 de Manaus, o que o TOA ainda diz
  -- "pendente" e não saiu da entrada/deslocamento no site vira Reagendamento
  -- com o 100 (Agendamento não cumprido). Só a importação de HOJE.
  select (valor #>> '{}')::time into v_hora from parametro
   where empresa_id = v_imp.empresa_id and chave = 'nao_cumprido_hora';
  v_hora := coalesce(v_hora, time '21:20');
  if v_dia = hoje_local()
     and (now() at time zone 'America/Manaus')::time >= v_hora then
    select id into v_100 from codigo_baixa
     where codigo = 100 and (empresa_id is null or empresa_id = v_imp.empresa_id)
     order by empresa_id nulls last limit 1;
    if v_100 is not null then
      for r in
        select v.id, v.situacao from visita v
          left join tipo_atividade ta on ta.id = v.tipo_atividade_id
         where v.id in (select l.visita_id from importacao_linha l
                         where l.importacao_id = p_importacao_id and l.visita_id is not null)
           and v.base_id = v_imp.base_id
           and v.data_agendada = v_dia
           and v.excluido_em is null
           and v.situacao in ('ENTRADA', 'ATRIBUIDA', 'EM_DESLOCAMENTO')
           and norm_txt(coalesce(v.dados_origem ->> 'Status da Atividade', '')) = 'PENDENTE'
           and coalesce(ta.natureza, '') <> 'JORNADA'
           and exists (select 1 from ordem_servico o where o.visita_id = v.id)
           and not exists (select 1 from ordem_servico o
                            where o.visita_id = v.id
                              and (o.codigo_baixa_afline_id is not null or o.codigo_baixa_id is not null))
      loop
        update ordem_servico
           set codigo_baixa_afline_id = v_100, baixa_em = now(), baixa_por = v_eu,
               baixa_observacao = c_obs_nc
         where visita_id = r.id and codigo_baixa_afline_id is null;

        insert into visita_evento (visita_id, tipo, de, para, origem, observacao, importacao_id)
        values (r.id, 'SITUACAO', jsonb_build_object('situacao', r.situacao),
                jsonb_build_object('situacao', 'REAGENDAMENTO'), 'IMPORTACAO', c_obs_nc, p_importacao_id);
        update visita set situacao = 'REAGENDAMENTO', situacao_em = now() where id = r.id;
        n_nc := n_nc + 1;
      end loop;
    end if;
  end if;

  perform set_config('app.origem', '', true);
  return jsonb_build_object('desatribuidos', n_des, 'devolvidos', n_dev,
                            'sumiram', n_sum, 'voltaram', n_vol,
                            'nao_cumpridos', n_nc);
end;
$function$;

notify pgrst, 'reload schema';
