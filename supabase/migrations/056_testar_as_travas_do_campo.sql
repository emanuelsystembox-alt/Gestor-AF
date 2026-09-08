-- 056 · A bateria das travas do campo
--
-- `testar_policies()` (029) prova o RLS. As regras que a 055 criou não
-- são policy: são guarda dentro de função `SECURITY DEFINER`, que
-- ignora RLS por definição. Sem teste próprio, "o técnico não desfaz a
-- baixa" é uma frase no comentário, não um fato do banco.
--
-- D-054 vale igual aqui: teste escrito como DEFINER não testa nada,
-- porque roda como o dono, que tem BYPASSRLS e passa em tudo. Esta
-- função é INVOKER e troca de papel com `set local role authenticated`.
--
-- Rode junto com a outra, antes de commitar qualquer mudança em baixa,
-- etapa ou evidência:
--
--   select * from testar_policies();
--   select * from testar_campo();

create or replace function testar_campo()
returns table (cenario text, esperado text, obtido text, passou boolean)
language plpgsql as $fn$
declare
  v_tec uuid; v_ctrl uuid;
  v_emp uuid; v_base uuid; v_equipe uuid; v_tecnico uuid;
  v_hoje uuid; v_ontem uuid; v_os uuid;
  v_cod int; v_cod2 int;
  v_pa_tec uuid; v_pa_ctrl uuid;
  v_lat numeric := -3.1019; v_lng numeric := -60.0250;  -- Manaus, centro
  n int;
begin
  -- ============================================================
  -- Fixture. Descartada no fim, aconteça o que acontecer.
  -- ============================================================
  v_tec := gen_random_uuid(); v_ctrl := gen_random_uuid();
  select id into v_emp from empresa limit 1;
  select id into v_base from base where empresa_id = v_emp limit 1;
  select id into v_pa_tec  from perfil_acesso where nome = 'Tecnico de Campo';
  select id into v_pa_ctrl from perfil_acesso where nome = 'Controlador';
  select codigo into v_cod  from codigo_baixa where ativo order by codigo limit 1;
  select codigo into v_cod2 from codigo_baixa where ativo and codigo <> v_cod
   order by codigo limit 1;

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

  insert into ordem_servico (visita_id, sequencia, numero_os)
  values (v_hoje, 1, '_TESTE0001') returning id into v_os;

  -- ============================================================
  -- Como TÉCNICO
  -- ============================================================
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

  begin
    perform baixar_os(v_os, v_cod, null, 'teste', null, v_lat, v_lng);
    return query select 'TECNICO baixa COM GPS'::text, 'permitido'::text,
                        'permitido'::text, true;
  exception when others then
    return query select 'TECNICO baixa COM GPS'::text, 'permitido'::text,
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

  -- A regra que o Emanuel pediu: baixado, ele AINDA anexa — no dia.
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

  -- Caminho fora do padrão gera linha apontando para arquivo que a
  -- policy do Storage nunca vai deixar abrir.
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

  -- ============================================================
  -- Como CONTROLADOR
  -- ============================================================
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

  begin
    perform registrar_evidencia(v_ontem, v_ontem::text || '/ctrl.jpg');
    return query select 'CONTROLADOR anexa em contrato de ONTEM'::text,
                        'permitido'::text, 'permitido'::text, true;
  exception when others then
    return query select 'CONTROLADOR anexa em contrato de ONTEM'::text,
                        'permitido'::text, ('BARRADO: ' || sqlerrm)::text, false;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  -- ============================================================
  -- O anon não alcança nada disto
  -- ============================================================
  -- Conferido no privilégio, não no lint: o Supabase concede EXECUTE
  -- nominal a `anon` em toda função nova do schema public, e o lint
  -- demora a perceber (CLAUDE.md).
  select count(*)::int into n from unnest(array[
      'registrar_evidencia','registrar_equipamento','pode_anexar_na_visita',
      'agenda_do_campo','hoje_local','visita_do_path']) f
   where exists (
     select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = f
        and has_function_privilege('anon', p.oid, 'EXECUTE'));
  return query select 'anon executa as funcoes da 055'::text, '0'::text,
                      n::text, n = 0;

  -- ============================================================
  -- Limpeza. A ordem importa: a visita leva evidência, equipamento e
  -- evento junto, e só depois disso o técnico pode ser apagado — o
  -- trigger de D-090 recusa quem tem histórico, inclusive de teste.
  -- ============================================================
  delete from visita where id in (v_hoje, v_ontem);
  update perfil set tecnico_id = null where id in (v_tec, v_ctrl);
  delete from tecnico where id = v_tecnico;
  delete from equipe  where id = v_equipe;
  delete from usuario_papel where usuario_id in (v_tec, v_ctrl);
  delete from perfil where id in (v_tec, v_ctrl);
  delete from auth.users where id in (v_tec, v_ctrl);

exception when others then
  -- Falha no meio não pode deixar entulho no banco de produção.
  begin execute 'reset role'; exception when others then null; end;
  delete from visita where id in (v_hoje, v_ontem);
  update perfil set tecnico_id = null where id in (v_tec, v_ctrl);
  delete from tecnico where id = v_tecnico;
  delete from equipe  where id = v_equipe;
  delete from usuario_papel where usuario_id in (v_tec, v_ctrl);
  delete from perfil where id in (v_tec, v_ctrl);
  delete from auth.users where id in (v_tec, v_ctrl);
  raise;
end;
$fn$;

revoke all on function testar_campo() from public, anon, authenticated;

comment on function testar_campo() is
  'Bateria das travas do campo (055): GPS na baixa, baixa que nao se desfaz, encerrado que nao volta, anexo so no dia. INVOKER de proposito — teste como dono nao testa nada (D-054). Rode como postgres, junto com testar_policies().';
