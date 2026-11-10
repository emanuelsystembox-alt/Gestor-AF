-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 254 — A gestão lê o técnico SEM equipe da cidade (D-368)             │
-- │                                                                      │
-- │ "não está gravando essa configuração dessa pessoa (...) ele é        │
-- │  técnico e não criou o chaveamento de contratos na linha dele"       │
-- │ — Emanuel, 10/11 (LUIZ HENRIQUE, login Z705384).                     │
-- │                                                                      │
-- │ O defeito: `tecnico_leitura` exigia `equipe_id in equipes_legiveis()`│
-- │ — técnico sem equipe só era visível para ele mesmo, nem o ADMIN o    │
-- │ lia. O Editar cadastro abria com o Login TOA vazio (embed nulo, o    │
-- │ ponteiro `perfil.tecnico_id` estava lá — a armadilha da D-232), a    │
-- │ pessoa digitava o login, a tela chamava "trocar login", o banco      │
-- │ respondia "igual" e a equipe NUNCA era gravada — logo o técnico      │
-- │ seguia sem equipe, invisível, num ciclo. Sem equipe, a chave de      │
-- │ roteamento não aparece e os contratos caem em SEM-LOGIN (6 de        │
-- │ 05/11 a 10/11 só dele). Eram 4 técnicos ativos assim.                │
-- │                                                                      │
-- │ O conserto: quem vê a cidade inteira (`ve_cidade_inteira()`, a mesma │
-- │ régua de `equipes_legiveis()`) lê também o técnico sem equipe da     │
-- │ cidade. Só a policy de SELECT; nada de escrita muda.                 │
-- │ `testar_policies` ganha 2 cenários (35): o controlador vê o técnico  │
-- │ sem equipe da cidade; o técnico não vê o de outro.                   │
-- └──────────────────────────────────────────────────────────────────────┘

drop policy if exists tecnico_leitura on tecnico;
create policy tecnico_leitura on tecnico for select to authenticated
  using (empresa_id = (select minha_empresa())
         and base_id in (select bases_visiveis())
         and (usuario_id = (select auth.uid())
              or equipe_id in (select equipes_legiveis())
              -- 254: o técnico sem equipe, para quem vê a cidade
              or (equipe_id is null and (select ve_cidade_inteira()))));

CREATE OR REPLACE FUNCTION public.testar_policies()
 RETURNS TABLE(cenario text, esperado text, obtido text, passou boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_tec uuid; v_sup uuid; v_ctrl uuid; v_visita uuid; n int; v_robo uuid; v_base uuid;
  v_sem_eq uuid;  -- 254: um técnico SEM equipe na cidade do controlador
begin
  select p.tec, p.sup, p.ctrl, p.visita into v_tec, v_sup, v_ctrl, v_visita
    from _prepara_teste_policy() p;
  select base_id into v_base from perfil where id = v_sup;
  v_robo := _prepara_teste_robo(v_base);
  -- 254 (D-368): o técnico sem equipe, criado como dono antes de trocar de papel
  insert into tecnico (empresa_id, base_id, matricula, nome)
  select p.empresa_id, p.base_id, '_TESTE_SEM_EQUIPE', '_TESTE SEM EQUIPE'
    from perfil p where p.id = v_ctrl
  returning id into v_sem_eq;

  -- ============ TECNICO ============
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tec::text, 'role','authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from perfil;
  return query select 'TECNICO enxerga perfis'::text,'1 (so o proprio)'::text,n::text,n=1;

  select count(*) into n from tecnico where id = v_sem_eq;
  return query select 'TECNICO enxerga outro tecnico sem equipe'::text,'0'::text,n::text,n=0;
  return query select 'TECNICO tem_papel(ADMIN)'::text,'false'::text,
    tem_papel('ADMIN')::text, tem_papel('ADMIN')=false;
  return query select 'TECNICO tem_permissao(admin.usuarios)'::text,'false'::text,
    tem_permissao('admin.usuarios')::text, tem_permissao('admin.usuarios')=false;

  begin
    insert into usuario_papel (usuario_id,papel,escopo) values (v_tec,'ADMIN','GLOBAL');
    return query select 'TECNICO se promove a ADMIN'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO se promove a ADMIN'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    update perfil set perfil_acesso_id=(select id from perfil_acesso where nome='Administrador')
     where id=v_tec;
    return query select 'TECNICO troca proprio perfil de acesso'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO troca proprio perfil de acesso'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    update perfil set whatsapp='92000000000' where id=v_tec;
    get diagnostics n = row_count;
    return query select 'TECNICO muda proprio telefone'::text,'1 linha'::text,n::text||' linha',n=1;
  exception when others then
    return query select 'TECNICO muda proprio telefone'::text,'1 linha'::text,'BARRADO'::text,false;
  end;

  -- 101: a data de contratacao e registro da empresa. A policy de
  -- autoedicao libera a linha inteira; quem barra e o gatilho.
  begin
    update perfil set data_contratacao = date '2000-01-01' where id=v_tec;
    return query select 'TECNICO muda propria data de contratacao'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO muda propria data de contratacao'::text,'barrado'::text,'barrado'::text,true;
  end;

  -- 103: cidade que nao e dele, e a propria foto.
  begin
    perform trocar_cidade((select b.id from base b where b.id not in (select bases_permitidas()) limit 1));
    return query select 'TECNICO troca para cidade que nao e dele'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO troca para cidade que nao e dele'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    update perfil set foto_path = v_tec::text || '/teste.jpg' where id=v_tec;
    return query select 'TECNICO troca a propria foto'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO troca a propria foto'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    perform definir_papeis(v_tec, array['ADMIN']);
    return query select 'TECNICO chama definir_papeis'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO chama definir_papeis'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    perform excluir_visita(v_visita,'teste');
    return query select 'TECNICO exclui contrato'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO exclui contrato'::text,'barrado'::text,'barrado'::text,true;
  end;

  select count(*) into n from regra_pontuacao;
  return query select 'TECNICO le tabela de pontuacao'::text,'maior que zero'::text,n::text,n>0;

  update regra_pontuacao set observacao = observacao
   where id = (select id from regra_pontuacao order by criado_em limit 1);
  get diagnostics n = row_count;
  return query select 'TECNICO edita pontuacao'::text,'0 linhas'::text,n::text||' linhas',n=0;

  select count(*) into n from visita;
  return query select 'TECNICO enxerga visitas'::text,'0 (nao tem tecnico vinculado)'::text,n::text,n=0;


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

  -- ============ SUPERVISOR ============
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sup::text,'role','authenticated')::text, true);
  begin
    insert into cargo (nome) values ('_TESTE CARGO');
    return query select 'SUPERVISOR cria cargo'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'SUPERVISOR cria cargo'::text,'barrado'::text,'barrado'::text,true;
  end;

  select count(*) into n from perfil;
  return query select 'SUPERVISOR enxerga perfis'::text,'1 (nao e gestor)'::text,n::text,n=1;

  -- 111: quem configura o robo e quem importa a mao, nao o supervisor.
  begin
    perform configurar_sincronismo(v_base, false, 30::smallint, '{}'::uuid[]);
    return query select 'SUPERVISOR configura o sincronismo'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'SUPERVISOR configura o sincronismo'::text,'barrado'::text,'barrado'::text,true;
  end;

  -- 113: sincronizar e a porta de quem importa; o supervisor nao importa.
  begin
    perform sincronismo_pulso(v_base, 'teste', null);
    return query select 'SUPERVISOR sincroniza pelo computador dele'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'SUPERVISOR sincroniza pelo computador dele'::text,'barrado'::text,'barrado'::text,true;
  end;


  -- 156a: o supervisor ve a cidade inteira, so olhando (Emanuel, 30/10).
  select count(*) into n from visita;
  return query select 'SUPERVISOR enxerga contratos da cidade'::text,'mais de 0'::text,n::text,n>0;

  begin
    begin
      update visita set equipe_id = (select e.id from equipe e
                                      where e.base_id = visita.base_id and e.id <> visita.equipe_id limit 1)
       where id = v_visita;
      get diagnostics n = row_count;
      raise exception 'desfaz:%', n;
    exception when others then
      if sqlerrm like 'desfaz:%' then n := substr(sqlerrm, 8)::int; else n := -1; end if;
    end;
    return query select 'SUPERVISOR muda a equipe do contrato direto'::text,'0 linha'::text,
      (case when n < 0 then 'barrado' else n::text||' linha' end), n <= 0;
  end;

  begin
    perform transferir_visita(v_visita, (select e.id from equipe e
                                           where e.base_id = v_base limit 1), 'teste');
    return query select 'SUPERVISOR transfere contrato (sem permissao)'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'SUPERVISOR transfere contrato (sem permissao)'::text,'barrado'::text,'barrado'::text,true;
  end;


  -- 158b: toda a gestao ve a cidade; o controlador nao depende de carteira.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ctrl::text,'role','authenticated')::text, true);
  select count(*) into n from visita;
  return query select 'CONTROLADOR sem carteira enxerga a cidade'::text,'mais de 0'::text,n::text,n>0;

  -- ============ ROBO (111) ============
  -- O robo importa -- e so importa. A senha dele mora num PC ligado o dia
  -- todo: se vazar, o estrago tem de ser "importou uma planilha".
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_robo::text,'role','authenticated')::text, true);

  select count(*) into n from visita;
  return query select 'ROBO enxerga contratos'::text,'0 (so importa)'::text,n::text,n=0;

  begin
    perform excluir_visita(v_visita,'teste');
    return query select 'ROBO exclui contrato'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'ROBO exclui contrato'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    insert into importacao (base_id, usuario_id, arquivo_nome, arquivo_path, fonte)
    values (v_base, v_robo, '_teste_robo.xlsx', 'teste/_teste_robo.xlsx', 'TOA');
    return query select 'ROBO registra importacao em nome proprio'::text,'permitido'::text,'permitido'::text,true;
  exception when others then
    return query select 'ROBO registra importacao em nome proprio'::text,'permitido'::text,('BARRADO: '||SQLERRM)::text,false;
  end;

  begin
    insert into importacao (base_id, usuario_id, arquivo_nome, arquivo_path, fonte)
    values (v_base, v_ctrl, '_teste_robo_outro.xlsx', 'teste/_teste_robo_outro.xlsx', 'TOA');
    return query select 'ROBO registra importacao em nome de outro'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'ROBO registra importacao em nome de outro'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    perform configurar_sincronismo(v_base, true, 15::smallint, '{}'::uuid[]);
    return query select 'ROBO configura o proprio sincronismo'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'ROBO configura o proprio sincronismo'::text,'barrado'::text,'barrado'::text,true;
  end;

  -- ============ CONTROLADOR ============
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ctrl::text,'role','authenticated')::text, true);

  select count(*) into n from perfil;
  return query select 'CONTROLADOR enxerga perfis da empresa'::text,'mais de 1'::text,n::text,n>1;

  -- 254 (D-368): sem isto o Editar cadastro abria com o login vazio e não gravava a equipe
  select count(*) into n from tecnico where id = v_sem_eq;
  return query select 'CONTROLADOR enxerga tecnico sem equipe da cidade'::text,'1'::text,n::text,n=1;

  begin
    perform excluir_visita(v_visita,'teste de policy');
    return query select 'CONTROLADOR exclui contrato'::text,'permitido'::text,'permitido'::text,true;
  exception when others then
    return query select 'CONTROLADOR exclui contrato'::text,'permitido'::text,('BARRADO: '||SQLERRM)::text,false;
  end;

  begin
    insert into permissao (chave,modulo,rotulo) values ('_teste.x','X','X');
    return query select 'CONTROLADOR escreve no catalogo de permissao'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'CONTROLADOR escreve no catalogo de permissao'::text,'barrado'::text,'barrado'::text,true;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims','',true);
  delete from tecnico where id = v_sem_eq;
  perform _limpa_teste_robo(v_robo);
  perform _limpa_teste_policy(v_tec, v_sup, v_ctrl, v_visita);
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims','',true);
  delete from tecnico where id = v_sem_eq;
  perform _limpa_teste_robo(v_robo);
  perform _limpa_teste_policy(v_tec, v_sup, v_ctrl, v_visita);
  raise;
end;
$function$;

-- create or replace preserva a ACL: testar_policies continua só do dono (como antes)

notify pgrst, 'reload schema';
