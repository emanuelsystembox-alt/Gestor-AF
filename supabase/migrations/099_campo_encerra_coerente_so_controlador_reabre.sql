-- ============================================================================
-- 099 · O campo encerra coerente e só o controlador reabre
-- ============================================================================
-- Respostas do Emanuel (27/09) às duas perguntas da D-172:
--
-- > "acho que o finalizar é o mesmo que concluir? correto? se não for temos
-- >  que corrigir"
--
--   É: o "Finalizar visita" do app grava CONCLUIDA. Então o técnico que
--   baixou com 106 (reagendamento) e tocou "Finalizar" dizia "concluí" com
--   um código que diz "reagendei". A conferência da 098
--   (`confere_destino_das_baixas`) passa a valer TAMBÉM para o campo, e o
--   app troca o botão: com código de reagendamento ele vira "Reagendar
--   visita".
--
-- > "so pode voltar o controlador, equipe nao pode"
--
--   Contrato encerrado voltando a um status aberto passa a ser SÓ pelo
--   `reverter_situacao` — controlador ou gestão, com motivo (D-030).
--   `registrar_etapa` recusa essa volta para QUALQUER um (antes, pela web,
--   um supervisor reabria sem motivo; a barreira era só da tela), e
--   `baixar_visita` recusa mudar o desfecho de um contrato encerrado para
--   quem não é controlador nem gestão.
--
-- A bateria `testar_campo()` usava o MENOR código ativo (-2, que CANCELA)
-- para depois "finalizar" como concluída — o cenário testava justamente a
-- incoerência. Passa a usar um código de conclusão, e ganha 5 cenários.
-- ============================================================================

create or replace function public.registrar_etapa(p_visita uuid, p_situacao text, p_observacao text default null::text, p_lat numeric default null::numeric, p_lng numeric default null::numeric, p_precisao numeric default null::numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_atual text; v_equipe uuid; v_tecnico uuid; v_campo boolean;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para registrar etapa.' using errcode = '42501';
  end if;

  v_campo := tem_papel('TECNICO') and not eh_gestor()
             and not (tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'));

  select situacao, equipe_id into v_atual, v_equipe
    from visita
   where id = p_visita and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis());
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  if not eh_gestor() and (v_equipe is null
      or v_equipe not in (select equipes_visiveis())) then
    raise exception 'Este contrato nao e da sua equipe.' using errcode = '42501';
  end if;

  if v_campo then
    if gps_bloqueado(meu_tecnico_id()) then
      raise exception 'O GPS do celular esta informando uma localizacao simulada. Desative o app de localizacao simulada para continuar.'
        using errcode = '42501';
    end if;
    if v_atual = any (situacoes_terminais()) then
      raise exception 'Contrato ja encerrado. Peca ao controlador para voltar.'
        using errcode = '42501';
    end if;
    if p_situacao = any (situacoes_terminais())
       and (p_lat is null or p_lng is null) then
      raise exception 'Ligue a localizacao do celular para encerrar a visita.'
        using errcode = '42501';
    end if;
  end if;

  -- 099: encerrado voltando a aberto é `reverter_situacao` — controlador,
  -- com motivo (D-030). Por aqui, para ninguém.
  if v_atual = any (situacoes_terminais())
     and not (p_situacao = any (situacoes_terminais())) then
    raise exception 'Contrato encerrado so volta pelo controlador, com motivo (Mudar status).'
      using errcode = '42501';
  end if;

  perform exige_todas_baixadas(p_visita, p_situacao);
  -- 099: vale para o campo também — "Finalizar" é CONCLUIDA.
  perform confere_destino_das_baixas(p_visita, p_situacao);

  v_tecnico := meu_tecnico_id();

  update visita set
    situacao    = p_situacao,
    situacao_em = now(),
    inicio      = case when p_situacao = 'EM_EXECUCAO' and inicio is null
                       then now() else inicio end,
    fim         = case when p_situacao = 'CONCLUIDA' then now() else fim end,
    tecnico_responsavel_id = coalesce(tecnico_responsavel_id, v_tecnico)
  where id = p_visita;

  insert into visita_evento (visita_id, tipo, de, para, origem,
                             usuario_id, login, tecnico_id, equipe_id,
                             observacao, lat, lng, precisao_m)
  values (p_visita, 'SITUACAO',
          jsonb_build_object('situacao', v_atual),
          jsonb_build_object('situacao', p_situacao),
          case when v_campo then 'MOBILE' else 'WEB' end,
          auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico, v_equipe,
          nullif(btrim(coalesce(p_observacao, '')), ''),
          p_lat, p_lng, p_precisao);

  return jsonb_build_object('de', v_atual, 'para', p_situacao);
end;
$function$;

create or replace function public.baixar_visita(p_visita uuid, p_itens jsonb, p_situacao text default null::text, p_lat numeric default null::numeric, p_lng numeric default null::numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare it jsonb; n int := 0; v_atual text;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para baixar.' using errcode = '42501';
  end if;

  select v.situacao into v_atual from visita v
   where v.id = p_visita and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  -- 098: código de baixa só com situação final terminal — e ela é
  -- obrigatória. "Baixar e ir para a entrada" era aceito e tirava um
  -- contrato encerrado do encerramento sem motivo.
  if jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) > 0
     and (p_situacao is null or not (p_situacao = any (situacoes_terminais()))) then
    raise exception 'Codigo de baixa so entra com Concluida, Cancelada ou Reagendamento.'
      using errcode = '23514';
  end if;

  -- 099: trocar o desfecho de um contrato encerrado (concluída → cancelada,
  -- por exemplo) é voltar o contrato — só controlador ou gestão.
  if v_atual = any (situacoes_terminais())
     and p_situacao is distinct from v_atual
     and not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Contrato encerrado so muda pelo controlador.' using errcode = '42501';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb))
  loop
    perform baixar_os(
      (it->>'os_id')::uuid,
      (it->>'codigo')::integer,
      nullif(it->>'sub_falha_id','')::uuid,
      nullif(btrim(coalesce(it->>'observacao','')),''),
      null, p_lat, p_lng);
    n := n + 1;
  end loop;

  if p_situacao is not null then
    perform exige_todas_baixadas(p_visita, p_situacao);
    -- 098: e todo código tem de ser DESTA situação (409 não cancela).
    perform confere_destino_das_baixas(p_visita, p_situacao);

    update visita set situacao = p_situacao, situacao_em = now()
     where id = p_visita;

    insert into visita_evento (visita_id, tipo, para, origem, usuario_id, login,
                               tecnico_id, observacao, lat, lng)
    values (p_visita, 'SITUACAO',
            jsonb_build_object('situacao', p_situacao),
            case when tem_papel('TECNICO') and not eh_gestor()
                 then 'MOBILE' else 'TELA' end,
            auth.uid(),
            coalesce((select matricula from tecnico where id = meu_tecnico_id()),
                     (select email from perfil where id = auth.uid())),
            meu_tecnico_id(),
            format('Baixa de %s O.S.', n), p_lat, p_lng);
  end if;

  return jsonb_build_object('ok', true, 'baixadas', n, 'situacao', p_situacao);
end;
$function$;

-- ---------------------------------------------------------------------------
-- a bateria do campo: código de conclusão + 5 cenários novos
-- ---------------------------------------------------------------------------
create or replace function public.testar_campo()
 returns table(cenario text, esperado text, obtido text, passou boolean)
 language plpgsql
as $function$
declare
  v_tec uuid; v_ctrl uuid;
  v_emp uuid; v_base uuid; v_equipe uuid; v_tecnico uuid;
  v_hoje uuid; v_ontem uuid; v_os uuid; v_cerca uuid;
  v_reag uuid; v_os_reag uuid;
  v_cod int; v_cod2 int; v_cod_reag int;
  v_pa_tec uuid; v_pa_ctrl uuid;
  v_lat numeric := -3.1019; v_lng numeric := -60.0250;
  n int; s text;
begin
  v_tec := gen_random_uuid(); v_ctrl := gen_random_uuid();
  select id into v_emp from empresa limit 1;
  select id into v_base from base where empresa_id = v_emp limit 1;
  select id into v_pa_tec  from perfil_acesso where nome = 'Tecnico de Campo';
  select id into v_pa_ctrl from perfil_acesso where nome = 'Controlador';
  -- 099: o código do cenário tem de CONCLUIR — ele é finalizado depois.
  select codigo into v_cod  from codigo_baixa
   where ativo and situacao_destino = 'CONCLUIDA' order by codigo limit 1;
  select codigo into v_cod2 from codigo_baixa where ativo and codigo <> v_cod
   order by codigo limit 1;
  select codigo into v_cod_reag from codigo_baixa
   where ativo and situacao_destino = 'REAGENDAMENTO' order by codigo limit 1;

  insert into auth.users (id, instance_id, aud, role, email,
                          encrypted_password, created_at, updated_at)
  values (v_tec, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', '_campo_tec@teste.local', 'x', now(), now()),
         (v_ctrl,'00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', '_campo_ctrl@teste.local', 'x', now(), now());

  insert into perfil (id, nome, email, empresa_id, base_id, ativo, perfil_acesso_id)
  values (v_tec, '_TESTE CAMPO TECNICO', '_campo_tec@teste.local',
          v_emp, v_base, true, v_pa_tec),
         (v_ctrl,'_TESTE CAMPO CONTROLADOR','_campo_ctrl@teste.local',
          v_emp, v_base, true, v_pa_ctrl);

  insert into usuario_papel (usuario_id, papel, escopo, base_id)
  values (v_tec, 'TECNICO', 'PROPRIO', null),
         (v_ctrl,'CONTROLADOR', 'BASE', v_base);

  insert into equipe (empresa_id, base_id, codigo, nome, controlador_id)
  values (v_emp, v_base, '_TESTE-CAMPO', '_TESTE Equipe do campo', v_ctrl)
  returning id into v_equipe;

  insert into tecnico (empresa_id, base_id, matricula, nome, equipe_id, usuario_id)
  values (v_emp, v_base, '_TESTECAMPO', '_TESTE Tecnico do campo', v_equipe, v_tec)
  returning id into v_tecnico;

  insert into visita (empresa_id, base_id, equipe_id, data_agendada, situacao,
                      contrato, origem)
  values (v_emp, v_base, v_equipe, hoje_local(), 'EM_EXECUCAO', '_TESTE-HOJE', 'MANUAL')
  returning id into v_hoje;

  insert into visita (empresa_id, base_id, equipe_id, data_agendada, situacao,
                      contrato, origem)
  values (v_emp, v_base, v_equipe, hoje_local() - 1, 'CONCLUIDA', '_TESTE-ONTEM', 'MANUAL')
  returning id into v_ontem;

  -- 099: um segundo contrato de hoje, na entrada, para o reagendamento.
  insert into visita (empresa_id, base_id, equipe_id, data_agendada, situacao,
                      contrato, origem)
  values (v_emp, v_base, v_equipe, hoje_local(), 'ENTRADA', '_TESTE-REAG', 'MANUAL')
  returning id into v_reag;

  insert into ordem_servico (visita_id, sequencia, numero_os)
  values (v_hoje, 1, '_TESTE0001') returning id into v_os;
  insert into ordem_servico (visita_id, sequencia, numero_os)
  values (v_reag, 1, '_TESTE0002') returning id into v_os_reag;

  -- 097: uma cerca pequena em volta do ponto de teste, só para a equipe de teste.
  insert into cerca (empresa_id, base_id, nome, tipo, poligono, alerta_sair, todas_equipes)
  values (v_emp, v_base, '_TESTE-CERCA', 'AREA',
          jsonb_build_array(jsonb_build_array(v_lat - 0.001, v_lng - 0.001),
                            jsonb_build_array(v_lat - 0.001, v_lng + 0.001),
                            jsonb_build_array(v_lat + 0.001, v_lng + 0.001),
                            jsonb_build_array(v_lat + 0.001, v_lng - 0.001)),
          true, false)
  returning id into v_cerca;
  insert into cerca_equipe (cerca_id, equipe_id) values (v_cerca, v_equipe);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tec::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from agenda_do_campo(hoje_local())
   where visita_id = v_hoje;
  return query select 'TECNICO ve a agenda do dia'::text, '1'::text, n::text, n = 1;

  begin
    perform baixar_os(v_os, v_cod, null, null, null, null, null);
    return query select 'TECNICO baixa SEM GPS'::text, 'barrado'::text,
                        '*** PASSOU ***'::text, false;
  exception when others then
    return query select 'TECNICO baixa SEM GPS'::text, 'barrado'::text,
                        'barrado'::text, true;
  end;

  -- 097: localização simulada trava a baixa; um ponto real destrava.
  perform registrar_rastro(jsonb_build_array(jsonb_build_object(
    'em', now() - interval '5 minutes', 'lat', v_lat, 'lng', v_lng,
    'precisao', 10, 'simulado', true, 'motivo', 'PERIODICO')));
  begin
    perform baixar_os(v_os, v_cod, null, 'teste', null, v_lat, v_lng);
    return query select 'TECNICO baixa com GPS SIMULADO'::text, 'barrado'::text,
                        '*** PASSOU ***'::text, false;
  exception when others then
    return query select 'TECNICO baixa com GPS SIMULADO'::text, 'barrado'::text,
                        'barrado'::text, true;
  end;
  perform registrar_rastro(jsonb_build_array(jsonb_build_object(
    'em', now() - interval '4 minutes', 'lat', v_lat, 'lng', v_lng,
    'precisao', 10, 'simulado', false, 'motivo', 'PERIODICO')));

  begin
    perform baixar_os(v_os, v_cod, null, 'teste', null, v_lat, v_lng);
    return query select 'TECNICO baixa COM GPS (real de novo)'::text, 'permitido'::text,
                        'permitido'::text, true;
  exception when others then
    return query select 'TECNICO baixa COM GPS (real de novo)'::text, 'permitido'::text,
                        ('BARRADO: ' || sqlerrm)::text, false;
  end;

  begin
    perform baixar_os(v_os, v_cod2, null, null, null, v_lat, v_lng);
    return query select 'TECNICO troca o codigo ja baixado'::text, 'barrado'::text,
                        '*** PASSOU ***'::text, false;
  exception when others then
    return query select 'TECNICO troca o codigo ja baixado'::text, 'barrado'::text,
                        'barrado'::text, true;
  end;

  begin
    perform registrar_etapa(v_hoje, 'CONCLUIDA', null, null, null);
    return query select 'TECNICO finaliza SEM GPS'::text, 'barrado'::text,
                        '*** PASSOU ***'::text, false;
  exception when others then
    return query select 'TECNICO finaliza SEM GPS'::text, 'barrado'::text,
                        'barrado'::text, true;
  end;

  begin
    perform registrar_etapa(v_hoje, 'CONCLUIDA', null, v_lat, v_lng);
    return query select 'TECNICO finaliza COM GPS'::text, 'permitido'::text,
                        'permitido'::text, true;
  exception when others then
    return query select 'TECNICO finaliza COM GPS'::text, 'permitido'::text,
                        ('BARRADO: ' || sqlerrm)::text, false;
  end;

  begin
    perform registrar_etapa(v_hoje, 'EM_EXECUCAO', null, v_lat, v_lng);
    return query select 'TECNICO reabre o que ja fechou'::text, 'barrado'::text,
                        '*** PASSOU ***'::text, false;
  exception when others then
    return query select 'TECNICO reabre o que ja fechou'::text, 'barrado'::text,
                        'barrado'::text, true;
  end;

  -- 099: "Finalizar" é CONCLUIDA — com código de reagendamento, não fecha.
  perform baixar_os(v_os_reag, v_cod_reag, null, 'teste', null, v_lat, v_lng);
  begin
    perform registrar_etapa(v_reag, 'CONCLUIDA', null, v_lat, v_lng);
    return query select 'TECNICO finaliza com codigo de REAGENDAMENTO'::text, 'barrado'::text,
                        '*** PASSOU ***'::text, false;
  exception when others then
    return query select 'TECNICO finaliza com codigo de REAGENDAMENTO'::text, 'barrado'::text,
                        'barrado'::text, true;
  end;
  begin
    perform registrar_etapa(v_reag, 'REAGENDAMENTO', null, v_lat, v_lng);
    return query select 'TECNICO reagenda com codigo de REAGENDAMENTO'::text, 'permitido'::text,
                        'permitido'::text, true;
  exception when others then
    return query select 'TECNICO reagenda com codigo de REAGENDAMENTO'::text, 'permitido'::text,
                        ('BARRADO: ' || sqlerrm)::text, false;
  end;
  -- 099: só o controlador volta o encerrado.
  begin
    perform reverter_situacao(v_reag, 'EM_EXECUCAO', 'teste');
    return query select 'TECNICO volta contrato encerrado (com motivo)'::text, 'barrado'::text,
                        '*** PASSOU ***'::text, false;
  exception when others then
    return query select 'TECNICO volta contrato encerrado (com motivo)'::text, 'barrado'::text,
                        'barrado'::text, true;
  end;

  begin
    perform registrar_evidencia(v_hoje, v_hoje::text || '/teste.jpg', 'LIVRE',
                                'FOTO', null, 'image/jpeg', 1024,
                                v_lat, v_lng, 12, now(), null, null);
    return query select 'TECNICO anexa foto DEPOIS de concluir (hoje)'::text,
                        'permitido'::text, 'permitido'::text, true;
  exception when others then
    return query select 'TECNICO anexa foto DEPOIS de concluir (hoje)'::text,
                        'permitido'::text, ('BARRADO: ' || sqlerrm)::text, false;
  end;

  begin
    perform registrar_evidencia(v_ontem, v_ontem::text || '/teste.jpg');
    return query select 'TECNICO anexa em contrato de ONTEM'::text, 'barrado'::text,
                        '*** PASSOU ***'::text, false;
  exception when others then
    return query select 'TECNICO anexa em contrato de ONTEM'::text, 'barrado'::text,
                        'barrado'::text, true;
  end;

  begin
    perform registrar_evidencia(v_hoje, 'solto.jpg');
    return query select 'Evidencia com caminho fora do padrao'::text, 'barrado'::text,
                        '*** PASSOU ***'::text, false;
  exception when others then
    return query select 'Evidencia com caminho fora do padrao'::text, 'barrado'::text,
                        'barrado'::text, true;
  end;

  begin
    perform registrar_equipamento(v_hoje, 'INSTALADO', ' abc 123 ', null, 'EMTA', 'X1');
    select count(*) into n from equipamento_movimento
     where visita_id = v_hoje and serial = 'ABC123';
    return query select 'Serial normaliza (espaco e caixa)'::text, '1'::text,
                        n::text, n = 1;
  exception when others then
    return query select 'Serial normaliza (espaco e caixa)'::text, '1'::text,
                        ('BARRADO: ' || sqlerrm)::text, false;
  end;

  -- 097: dois pontos seguidos fora da cerca = um evento SAIU (um só fora não basta).
  perform registrar_rastro(jsonb_build_array(
    jsonb_build_object('em', now() - interval '3 minutes', 'lat', v_lat + 0.003, 'lng', v_lng,
                       'precisao', 10, 'motivo', 'PERIODICO'),
    jsonb_build_object('em', now() - interval '2 minutes', 'lat', v_lat + 0.003, 'lng', v_lng,
                       'precisao', 10, 'motivo', 'PERIODICO')));

  -- 096: o técnico não lê rastro de ninguém — nem o dele.
  select count(*) into n from rastro_ponto;
  return query select 'TECNICO le o rastro'::text, '0'::text, n::text, n = 0;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ctrl::text, 'role', 'authenticated')::text, true);

  begin
    perform baixar_os(v_os, v_cod2, null, 'correcao', null, null, null);
    return query select 'CONTROLADOR corrige a baixa, sem GPS'::text,
                        'permitido'::text, 'permitido'::text, true;
  exception when others then
    return query select 'CONTROLADOR corrige a baixa, sem GPS'::text,
                        'permitido'::text, ('BARRADO: ' || sqlerrm)::text, false;
  end;

  -- 099: encerrado não volta por registrar_etapa — nem para o controlador.
  begin
    perform registrar_etapa(v_reag, 'EM_EXECUCAO', null, null, null);
    return query select 'CONTROLADOR volta encerrado SEM motivo'::text, 'barrado'::text,
                        '*** PASSOU ***'::text, false;
  exception when others then
    return query select 'CONTROLADOR volta encerrado SEM motivo'::text, 'barrado'::text,
                        'barrado'::text, true;
  end;
  begin
    perform reverter_situacao(v_reag, 'EM_EXECUCAO', 'teste da bateria');
    select situacao into s from visita where id = v_reag;
    return query select 'CONTROLADOR volta encerrado COM motivo'::text, 'EM_EXECUCAO'::text,
                        s, s = 'EM_EXECUCAO';
  exception when others then
    return query select 'CONTROLADOR volta encerrado COM motivo'::text, 'EM_EXECUCAO'::text,
                        ('BARRADO: ' || sqlerrm)::text, false;
  end;

  begin
    perform registrar_evidencia(v_ontem, v_ontem::text || '/ctrl.jpg');
    return query select 'CONTROLADOR anexa em contrato de ONTEM'::text,
                        'permitido'::text, 'permitido'::text, true;
  exception when others then
    return query select 'CONTROLADOR anexa em contrato de ONTEM'::text,
                        'permitido'::text, ('BARRADO: ' || sqlerrm)::text, false;
  end;

  -- O controlador enxerga o SAIU da cerca da equipe dele (pelo RLS).
  select count(*) into n from cerca_evento where tecnico_id = v_tecnico and tipo = 'SAIU';
  return query select 'Cerca: 2 pontos fora = 1 evento SAIU (visto pelo controle)'::text,
                      '1'::text, n::text, n = 1;

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  select count(*)::int into n from unnest(array[
      'registrar_evidencia','registrar_equipamento','pode_anexar_na_visita',
      'agenda_do_campo','hoje_local','visita_do_path']) f
   where exists (
     select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = f
        and has_function_privilege('anon', p.oid, 'EXECUTE'));
  return query select 'anon executa as funcoes da 055'::text, '0'::text,
                      n::text, n = 0;

  select count(*)::int into n from unnest(array[
      'registrar_rastro','registrar_estado_gps','registrar_ciencia_rastro',
      'informar_contato_cliente','monitor_tecnicos','local_da_baixa',
      'salvar_cerca','arquivar_cerca','mudar_estado_gps','expurgar_rastro','gps_bloqueado',
      'confere_destino_das_baixas','registrar_erro_app']) f
   where exists (
     select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = f
        and has_function_privilege('anon', p.oid, 'EXECUTE'));
  return query select 'anon executa as funcoes da 096 a 098'::text, '0'::text,
                      n::text, n = 0;

  delete from rastro_ponto where tecnico_id = v_tecnico;
  delete from gps_alerta where tecnico_id = v_tecnico;
  delete from tecnico_gps where tecnico_id = v_tecnico;
  delete from cerca where id = v_cerca;
  delete from visita where id in (v_hoje, v_ontem, v_reag);
  update perfil set tecnico_id = null where id in (v_tec, v_ctrl);
  delete from tecnico where id = v_tecnico;
  delete from equipe  where id = v_equipe;
  delete from usuario_papel where usuario_id in (v_tec, v_ctrl);
  delete from perfil where id in (v_tec, v_ctrl);
  delete from auth.users where id in (v_tec, v_ctrl);

exception when others then
  begin execute 'reset role'; exception when others then null; end;
  delete from rastro_ponto where tecnico_id = v_tecnico;
  delete from gps_alerta where tecnico_id = v_tecnico;
  delete from tecnico_gps where tecnico_id = v_tecnico;
  delete from cerca where id = v_cerca;
  delete from visita where id in (v_hoje, v_ontem, v_reag);
  update perfil set tecnico_id = null where id in (v_tec, v_ctrl);
  delete from tecnico where id = v_tecnico;
  delete from equipe  where id = v_equipe;
  delete from usuario_papel where usuario_id in (v_tec, v_ctrl);
  delete from perfil where id in (v_tec, v_ctrl);
  delete from auth.users where id in (v_tec, v_ctrl);
  raise;
end;
$function$;

notify pgrst, 'reload schema';
