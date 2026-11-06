-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 210 — Agendamento não cumprido (cód. 100) depois das 21:20 (D-312)    │
-- │                                                                      │
-- │ "após 21:20 de Manaus toda noite, se o contrato quando houver uma    │
-- │  importação depois desse horário ainda tiver contrato em entrada ou  │
-- │  deslocamento no site e que não tenha cod de baixa em nosso site     │
-- │  para esse contrato TOA, e o Toa quando importado Informar status    │
-- │  pendente no contrato, o contrato deve ser puxado imediatamente para │
-- │  Reagendado - Cód 100 - Agendamento não cumprido" — Emanuel, 05/11.  │
-- │                                                                      │
-- │ Mora em `desatribuir_ausentes`, a última chamada de TODA importação  │
-- │ (site e extensão, `importarToaNucleo.ts`): roda depois que a linha   │
-- │ do TOA já foi gravada, então nada da importação desfaz o que ela faz,│
-- │ e o site e a extensão não precisam de versão nova.                   │
-- │                                                                      │
-- │ Condições, todas juntas:                                             │
-- │  · a importação acontece às 21:20 de Manaus ou depois (parâmetro     │
-- │    `nao_cumprido_hora`) e é do dia de HOJE — importar um dia passado │
-- │    à noite não reescreve o passado;                                  │
-- │  · o contrato veio NESTA planilha com "Status da Atividade" pendente;│
-- │  · está Na entrada, Atribuída ou Em deslocamento no site;            │
-- │  · nenhuma O.S. tem código de baixa (nem nosso, nem do TOA);         │
-- │  · não é jornada e tem ao menos uma O.S. (terminal exige todas).     │
-- │                                                                      │
-- │ O 100 vai na baixa da AFLINE, nunca na da operadora (D-042). O       │
-- │ técnico é avisado pelo evento SITUACAO (aviso_do_evento). Fica       │
-- │ Reagendamento: encerrado não reabre pela importação (184, D-272).    │
-- │                                                                      │
-- │ O TOA NÃO é baixado: o sistema não grava no TOA (D-250). Perguntado, │
-- │ o Emanuel escolheu "só no site e no app"; a baixa lá continua com o  │
-- │ COP.                                                                 │
-- └──────────────────────────────────────────────────────────────────────┘

insert into public.parametro (empresa_id, chave, valor, descricao)
select e.id, 'nao_cumprido_hora', '"21:20"'::jsonb,
       'Depois desta hora (Manaus), importação de hoje com o contrato pendente no TOA e ainda na entrada/deslocamento reagenda com o 100 (D-312)'
  from public.empresa e
on conflict (empresa_id, chave) do nothing;

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

revoke all on function public.desatribuir_ausentes(uuid) from public, anon;
grant execute on function public.desatribuir_ausentes(uuid) to authenticated;
