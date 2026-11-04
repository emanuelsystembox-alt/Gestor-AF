-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 204 — A chave "em campo" do supervisor (D-300)                        │
-- │                                                                      │
-- │ "quando precisamos dele em campo deve ter um chaveamento pra ele,    │
-- │  pra puxar os contratos na linha dele, até por que vamos da um login │
-- │  pra ele" · "As travas de GPS da baixa não valem para ele (...)      │
-- │  habilita por favor" — Emanuel, 04/11, sobre o Pedro Campos.         │
-- │                                                                      │
-- │ Ligar faz, numa transação, o que hoje são três telas:                │
-- │   1. a equipe própria dele (067: SUP-<NOME>), criada se faltar;      │
-- │   2. o técnico do login dele (`perfil.tecnico_id`) nessa equipe, e o │
-- │      login TOA dele (a matrícula) ROTEANDO para ela, pelo mesmo      │
-- │      `cadastrar_login_da_equipe` da chave de roteamento — o autor é  │
-- │      quem ligou (D-079);                                             │
-- │   3. o papel TECNICO. É ele que liga as travas do campo (055): no    │
-- │      banco, "campo" é `tem_papel('TECNICO') and not eh_gestor()`, e  │
-- │      o supervisor não é gestor (ADMIN/COP). No app, liga também o    │
-- │      GPS obrigatório e a pesquisa do dia.                            │
-- │ Desligar desfaz os três: desliga o roteamento (o que já foi para a   │
-- │ equipe dele fica lá — desligar não desfaz despacho), tira o papel e  │
-- │ tira o técnico da equipe. O supervisor continua supervisor o tempo   │
-- │ todo. A agenda do app já é a da equipe do técnico (203).             │
-- │                                                                      │
-- │ Só o ADMIN: a chave dá PAPEL, e papel só o ADMIN dá (policy          │
-- │ `papel_admin`, 159).                                                 │
-- │                                                                      │
-- │ Efeito colateral, dito: com a chave ligada as travas valem também    │
-- │ quando ele baixa pelo SITE (o banco não sabe de qual tela veio) —    │
-- │ baixa pela web sem GPS é recusada. Para baixar como supervisor,      │
-- │ desliga a chave.                                                     │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.supervisor_em_campo(p_usuario uuid, p_ligar boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tec uuid; v_mat text; v_base uuid; v_eq uuid; v_eq_nome text; v_rota uuid; r jsonb;
begin
  if not (select tem_papel('ADMIN')) then
    raise exception 'So o ADMIN liga o supervisor em campo (a chave da o papel TECNICO).'
      using errcode = '42501';
  end if;
  if not exists (select 1 from usuario_papel
                  where usuario_id = p_usuario and papel in ('SUPERVISOR', 'COORDENADOR')) then
    raise exception 'Esta pessoa nao e supervisor nem coordenador.' using errcode = '23514';
  end if;

  select t.id, upper(btrim(t.matricula)), t.base_id into v_tec, v_mat, v_base
    from perfil p join tecnico t on t.id = p.tecnico_id
   where p.id = p_usuario and p.empresa_id = minha_empresa()
     and t.base_id in (select bases_visiveis());
  if v_tec is null then
    raise exception 'O login dele nao tem tecnico (login TOA) na cidade ativa. Cadastre o login TOA em Editar primeiro.'
      using errcode = 'P0002';
  end if;

  -- o vínculo aberto do login, se houver
  select h.equipe_id into v_rota from equipe_login_toa h
    join equipe e on e.id = h.equipe_id
   where norm_txt(h.login_toa) = norm_txt(v_mat) and h.fim is null and e.base_id = v_base
   limit 1;

  if p_ligar then
    r := criar_equipe_do_supervisor(p_usuario);
    v_eq := (r->>'equipe_id')::uuid;
    v_eq_nome := r->>'nome';

    update tecnico set equipe_id = v_eq, usuario_id = p_usuario where id = v_tec;

    if v_rota is distinct from v_eq then
      if v_rota is not null then perform desligar_login_da_equipe(v_mat); end if;
      perform cadastrar_login_da_equipe(v_eq, v_mat);
    end if;

    insert into usuario_papel (usuario_id, papel, escopo, base_id)
    values (p_usuario, 'TECNICO', escopo_padrao('TECNICO'), v_base)
    on conflict (usuario_id, papel) do nothing;

    return jsonb_build_object('em_campo', true, 'equipe', v_eq_nome, 'login', v_mat);
  else
    if v_rota is not null then perform desligar_login_da_equipe(v_mat); end if;
    delete from usuario_papel where usuario_id = p_usuario and papel = 'TECNICO';
    update tecnico set equipe_id = null where id = v_tec;
    return jsonb_build_object('em_campo', false, 'login', v_mat);
  end if;
end;
$function$;

revoke all on function public.supervisor_em_campo(uuid, boolean) from public, anon;
grant execute on function public.supervisor_em_campo(uuid, boolean) to authenticated;
