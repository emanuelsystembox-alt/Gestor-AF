-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 161a · As permissões "sem efeito ainda" passam a valer           ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "Decidir o que fazer com as permissoes marcadas como 'sem efeito
-- >  ainda' -- pode ligar." / Renan: "deixa ele editar, se esta marcado
-- >  pode editar"  -- Emanuel, 31/10
--
-- O que cada chave passa a barrar (o ADMIN continua podendo tudo):
--   importacao.executar        -> a cadeia de importacao inteira: importar_toa,
--                                 previa_toa, reconciliar_importacao,
--                                 desatribuir_ausentes, e o sincronismo da
--                                 extensao (pulso, rodada, varredura). Uma so
--                                 dela sem as outras importaria pela metade.
--   configuracoes.cadastrar /  -> INSERT / UPDATE / DELETE nas tabelas de
--   editar / excluir              configuracao, e as RPCs de configuracao
--                                 (buckets, sub-falhas, parametros, meta de
--                                 execucao, numero do TOA) pedem "editar".
--   pontuacao.editar           -> regra_pontuacao, combinacao_os, tabela_preco.
--   admin.cargos               -> cargo, perfil_acesso, perfil_acesso_permissao
--                                 -- SEM tocar no que da poder de Administracao
--                                 (perfil com papel ADMIN, perfil que ja tem
--                                 permissao do modulo, ou a propria permissao do
--                                 modulo). Sem essa trava, quem edita perfis
--                                 poria "Gerenciar usuarios" no perfil de todo
--                                 mundo. E nunca o PROPRIO perfil: seria subir
--                                 de poder por tabela (a regra da 157a).
--   servicos.desatribuir_pontuacao -> expurgar_pontuacao, devolver_pontuacao.
--   servicos.ver, equipes.ver, importacao.ver, relatorios.ver,
--   configuracoes.ver          -> o MENU e a entrada na tela (na web). Ler os
--                                 dados continua decidido pelo escopo do RLS --
--                                 o rotulo da chave e "Visualizar menu".
--
-- De fora, de proposito:
--   situacao_visita -- e estrutura do sistema (situacoes_terminais, o funil
--     da baixa), nao configuracao da operacao. Continua so do ADMIN.
--   base (cidades) -- criar cidade muda o escopo de todo mundo. So ADMIN.
--   admin.empresa -- nao existe tela nem tabela de escrita de "dados da
--     empresa" (a `empresa` so tem policy de leitura). A chave segue sem
--     efeito, e a tela continua dizendo isso.

-- ---- quem configura ----
create or replace function pode_configurar(p_op text) returns boolean
language sql stable security definer set search_path = public as $$
  select tem_papel('ADMIN') or tem_permissao('configuracoes.' || p_op);
$$;
revoke all on function pode_configurar(text) from public, anon;
grant execute on function pode_configurar(text) to authenticated;

-- ---- tabelas de configuracao: uma policy por operacao ----
do $$
declare r record; v_emp text;
begin
  for r in select * from (values
      ('area_trabalho',            'area_trabalho_admin',        true),
      ('categoria_capacidade',     'categoria_capacidade_admin', true),
      ('codigo_baixa',             'codigo_baixa_admin',         true),
      ('indicador_qualidade',      'iq_escrita',                 false),
      ('indicador_qualidade_base', 'iqb_escrita',                false),
      ('parametro',                'parametro_escrita',          true),
      ('segmentacao',              'segmentacao_admin',          true),
      ('sub_falha',                'sf_escrita',                 false),
      ('tipo_atividade',           'tipo_atividade_admin',       true),
      ('tipo_os',                  'tipo_os_admin',              true),
      ('tipo_servico',             'tipo_servico_admin',         true),
      ('toa_recurso',              'toa_recurso_admin',          true)
    ) t(tabela, politica, tem_empresa)
  loop
    v_emp := case when r.tem_empresa
                  then '(empresa_id = (select minha_empresa())) and ' else '' end;
    execute format('drop policy if exists %I on %I', r.politica, r.tabela);
    execute format('drop policy if exists %I on %I', r.tabela || '_cadastra', r.tabela);
    execute format('drop policy if exists %I on %I', r.tabela || '_edita', r.tabela);
    execute format('drop policy if exists %I on %I', r.tabela || '_exclui', r.tabela);
    execute format('create policy %I on %I for insert to authenticated with check (%s(select pode_configurar(%L)))',
                   r.tabela || '_cadastra', r.tabela, v_emp, 'cadastrar');
    execute format('create policy %I on %I for update to authenticated using (%s(select pode_configurar(%L))) with check (%s(select pode_configurar(%L)))',
                   r.tabela || '_edita', r.tabela, v_emp, 'editar', v_emp, 'editar');
    execute format('create policy %I on %I for delete to authenticated using (%s(select pode_configurar(%L)))',
                   r.tabela || '_exclui', r.tabela, v_emp, 'excluir');
  end loop;
end $$;

-- ---- pontuacao ----
alter policy rp_escrita on regra_pontuacao
  using ((select tem_papel('ADMIN')) or (select tem_permissao('pontuacao.editar')))
  with check ((select tem_papel('ADMIN')) or (select tem_permissao('pontuacao.editar')));
alter policy co_escrita on combinacao_os
  using ((select tem_papel('ADMIN')) or (select tem_permissao('pontuacao.editar')))
  with check ((select tem_papel('ADMIN')) or (select tem_permissao('pontuacao.editar')));
alter policy tp_escrita on tabela_preco
  using ((select tem_papel('ADMIN')) or (select tem_permissao('pontuacao.editar')))
  with check ((select tem_papel('ADMIN')) or (select tem_permissao('pontuacao.editar')));

-- ---- cargos e perfis de acesso, sem tocar em Administracao ----
alter policy cg_escrita on cargo
  using ((select tem_papel('ADMIN')) or (select tem_permissao('admin.cargos')))
  with check ((select tem_papel('ADMIN')) or (select tem_permissao('admin.cargos')));

alter policy pa_escrita on perfil_acesso
  using ((select tem_papel('ADMIN'))
         or ((select tem_permissao('admin.cargos'))
             and papel is distinct from 'ADMIN' and not perfil_acesso_administra(id)
             and id is distinct from (select p.perfil_acesso_id from perfil p where p.id = (select auth.uid()))))
  with check ((select tem_papel('ADMIN'))
         or ((select tem_permissao('admin.cargos'))
             and papel is distinct from 'ADMIN' and not perfil_acesso_administra(id)
             and id is distinct from (select p.perfil_acesso_id from perfil p where p.id = (select auth.uid()))));

alter policy pap_escrita on perfil_acesso_permissao
  using ((select tem_papel('ADMIN'))
         or ((select tem_permissao('admin.cargos'))
             and not exists (select 1 from permissao pm
                              where pm.chave = permissao_chave and pm.modulo = 'ADMINISTRACAO')
             and not exists (select 1 from perfil_acesso pa
                              where pa.id = perfil_acesso_id
                                and (pa.papel = 'ADMIN' or perfil_acesso_administra(pa.id)))
             and perfil_acesso_id is distinct from (select p.perfil_acesso_id from perfil p where p.id = (select auth.uid()))))
  with check ((select tem_papel('ADMIN'))
         or ((select tem_permissao('admin.cargos'))
             and not exists (select 1 from permissao pm
                              where pm.chave = permissao_chave and pm.modulo = 'ADMINISTRACAO')
             and not exists (select 1 from perfil_acesso pa
                              where pa.id = perfil_acesso_id
                                and (pa.papel = 'ADMIN' or perfil_acesso_administra(pa.id)))
             and perfil_acesso_id is distinct from (select p.perfil_acesso_id from perfil p where p.id = (select auth.uid()))));

-- ---- as RPCs ----
do $$
declare f text; d text; antes text;
begin
  -- configuracao
  foreach f in array array['ativar_bucket','salvar_bucket','definir_conjunto_sub_falha',
                           'importar_sub_falhas','definir_meta_execucao','definir_numero_toa',
                           'definir_parametro'] loop
    d := pg_get_functiondef(f::regproc); antes := d;
    d := replace(d, 'if not tem_papel(''ADMIN'') then', 'if not pode_configurar(''editar'') then');
    if d = antes then raise exception '161a: trava nao achada em %', f; end if;
    execute d;
  end loop;

  -- pontuacao desatribuida
  foreach f in array array['expurgar_pontuacao','devolver_pontuacao'] loop
    d := pg_get_functiondef(f::regproc); antes := d;
    d := replace(d, 'if not tem_papel(''ADMIN'') then',
                    'if not (tem_papel(''ADMIN'') or tem_permissao(''servicos.desatribuir_pontuacao'')) then');
    if d = antes then raise exception '161a: trava nao achada em %', f; end if;
    execute d;
  end loop;

  -- importacao: a cadeia inteira
  foreach f in array array['importar_toa','reconciliar_importacao','desatribuir_ausentes',
                           'sincronismo_pulso','sincronismo_registrar_rodada','registrar_varredura'] loop
    d := pg_get_functiondef(f::regproc); antes := d;
    d := replace(d, '(eh_gestor() or tem_papel(''CONTROLADOR'') or tem_papel(''ROBO''))',
                    '((eh_gestao() or tem_papel(''ROBO'')) and tem_permissao(''importacao.executar''))');
    if d = antes then raise exception '161a: trava nao achada em %', f; end if;
    execute d;
  end loop;
  d := pg_get_functiondef('previa_toa'::regproc); antes := d;
  d := replace(d, 'if not (eh_gestor() or tem_papel(''CONTROLADOR'')) then',
                  'if not (eh_gestao() and tem_permissao(''importacao.executar'')) then');
  if d = antes then raise exception '161a: trava nao achada em previa_toa'; end if;
  execute d;
end $$;

notify pgrst, 'reload schema';
