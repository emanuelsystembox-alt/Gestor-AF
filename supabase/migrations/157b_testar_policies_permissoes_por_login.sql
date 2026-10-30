-- 157b: a bateria ganha as travas das excecoes de permissao (157a).
-- Tres cenarios: CONTROLADOR (sem admin.usuarios) nao da permissao a
-- outro login; TECNICO nao se da admin.usuarios; ninguem grava excecao
-- direto na tabela (so a RPC, que carimba quem mudou).
do $$
declare d text; novo text;
begin
  d := pg_get_functiondef('testar_policies()'::regprocedure);
  novo := $novo$
  -- 157a: permissoes por login. Quem nao administra usuarios nao mexe,
  -- e ninguem se da permissao.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ctrl::text,'role','authenticated')::text, true);
  begin
    perform definir_permissoes_usuario(v_tec, '{"servicos.excluir": true}'::jsonb);
    return query select 'CONTROLADOR da permissao a outro login'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'CONTROLADOR da permissao a outro login'::text,'barrado'::text,'barrado'::text,true;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tec::text,'role','authenticated')::text, true);
  begin
    perform definir_permissoes_usuario(v_tec, '{"admin.usuarios": true}'::jsonb);
    return query select 'TECNICO se da admin.usuarios'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO se da admin.usuarios'::text,'barrado'::text,'barrado'::text,true;
  end;
  begin
    insert into usuario_permissao (usuario_id, permissao_chave, concedida) values (v_tec, 'servicos.excluir', true);
    return query select 'TECNICO grava excecao direto na tabela'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO grava excecao direto na tabela'::text,'barrado'::text,'barrado'::text,true;
  end;

  -- ============ SUPERVISOR ============$novo$;
  if strpos(d, '  -- ============ SUPERVISOR ============') = 0 then raise exception 'ancora'; end if;
  d := replace(d, '  -- ============ SUPERVISOR ============', novo);
  execute d;
end $$;
revoke all on function testar_policies() from public, anon;
