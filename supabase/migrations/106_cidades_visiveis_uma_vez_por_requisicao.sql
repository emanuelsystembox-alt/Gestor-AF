-- ┌─ 106 · as cidades visíveis calculadas UMA vez por requisição ──────┐
-- │ > "por que ta demorando muito a carregar essa página?" — Emanuel,  │
-- │ >  17/10, na tela de Equipes ("canceling statement due to         │
-- │ >  statement timeout")                                             │
-- │                                                                    │
-- │ ESTE DEFEITO FOI DA 103. Medido como authenticated (17/10, 118     │
-- │ contratos): painel_equipes levou 11,5 s, e 9,2 s eram              │
-- │ bases_visiveis() — chamada 4.537 vezes, com minha_empresa() 177    │
-- │ mil vezes por dentro. Quem chama tanto é o RLS: tec1_da_os (1.808  │
-- │ chamadas), pontos_da_visita e cia. são funções INVOKER que leem    │
-- │ ordem_servico/visita/tipo_servico, e cada consulta delas avalia    │
-- │ as policies, que perguntam bases_visiveis(). A 103 deixou cada     │
-- │ chamada mais cara (permitidas + cidade ativa) e multiplicou o      │
-- │ custo por milhares.                                                │
-- │                                                                    │
-- │ A resposta não muda dentro de uma requisição. Então ela é          │
-- │ calculada uma vez e guardada numa variável LOCAL DA TRANSAÇÃO      │
-- │ (set_config(..., true)), com o usuário na chave: outra sessão não  │
-- │ vê, a próxima requisição recalcula, e trocar de usuário no meio    │
-- │ da transação (as baterias fazem isso) não herda o valor.           │
-- │ trocar_cidade e a troca de base no perfil apagam o valor.          │
-- │                                                                    │
-- │ Medido: 1,7 ms → 0,02 ms por chamada; painel_equipes 11,5 s →      │
-- │ 1,9 s; mesmo conjunto de cidades. Ver D-183.                       │
-- │                                                                    │
-- │ Limite conhecido: mudar o PRÓPRIO papel ou usuario_base no meio de │
-- │ uma transação e depois ler dados na mesma transação usa o valor    │
-- │ antigo. Nenhuma tela faz isso (cada ação é uma requisição).        │
-- └────────────────────────────────────────────────────────────────────┘

create or replace function public.bases_permitidas()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- 106: empresa, usuário e papel resolvidos UMA vez, não por linha de base.
  with eu as materialized (
    select (select auth.uid()) as uid, (select minha_empresa()) as emp,
           (select tem_papel('ADMIN')) as adm
  )
  select b.id from base b, eu where eu.adm and b.empresa_id = eu.emp
  union
  select p.base_id from perfil p, eu where p.id = eu.uid and p.base_id is not null
  union
  select ub.base_id from usuario_base ub join base b on b.id = ub.base_id, eu
   where ub.usuario_id = eu.uid and b.empresa_id = eu.emp;
$function$;

create or replace function public.bases_visiveis()
 returns setof uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid   text := coalesce(auth.uid()::text, '');
  v_cache text := current_setting('app.bases_visiveis', true);
  v_ids   uuid[];
begin
  -- 106: já calculado nesta transação, para este usuário.
  if coalesce(v_cache, '') <> '' and split_part(v_cache, '|', 1) = v_uid then
    return query select unnest(coalesce(
      string_to_array(nullif(split_part(v_cache, '|', 2), ''), ','), '{}')::uuid[]);
    return;
  end if;

  -- A regra da 103: a cidade ativa; sem escolha válida, a do perfil; sem
  -- nenhuma, todas as permitidas.
  with permitidas as materialized (select bases_permitidas() as id),
  eu as materialized (select p.base_ativa, p.base_id from perfil p where p.id = auth.uid()),
  escolha as materialized (
    select coalesce(
      (select e.base_ativa from eu e where e.base_ativa in (select id from permitidas)),
      (select e.base_id   from eu e where e.base_id   in (select id from permitidas))) as id
  )
  select coalesce(array_agg(pr.id), '{}') into v_ids
    from permitidas pr, escolha e
   where e.id is null or pr.id = e.id;

  perform set_config('app.bases_visiveis', v_uid || '|' || array_to_string(v_ids, ','), true);
  return query select unnest(v_ids);
end;
$function$;

create or replace function public.trocar_cidade(p_base uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Sem sessao.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_permitidas()) then
    raise exception 'Voce nao tem acesso a esta cidade. Quem libera e o ADMIN, no cadastro.'
      using errcode = '42501';
  end if;
  update perfil set base_ativa = p_base where id = auth.uid();
  -- 106: a cidade mudou; o valor guardado nesta transação não vale mais.
  perform set_config('app.bases_visiveis', '', true);
end;
$function$;

-- O gatilho do perfil (versão viva da 103) apaga o valor guardado quando
-- a base ou a cidade ativa mudam na mesma transação.
create or replace function public.perfil_protege_campos()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  new.atualizado_em := now();

  -- 106: base ou cidade ativa mudou -> recalcular bases_visiveis().
  if new.base_id is distinct from old.base_id
  or new.base_ativa is distinct from old.base_ativa then
    perform set_config('app.bases_visiveis', '', true);
  end if;

  -- Sem auth.uid() = conexao de servico (migration, service_role, o
  -- proprio postgres). Essa ja pode tudo pela porta da frente; travar
  -- aqui so quebraria manutencao, sem fechar buraco nenhum.
  if auth.uid() is null or tem_papel('ADMIN') then
    return new;
  end if;

  if new.empresa_id       is distinct from old.empresa_id
  or new.base_id          is distinct from old.base_id
  or new.ativo            is distinct from old.ativo
  or new.perfil_acesso_id is distinct from old.perfil_acesso_id
  or new.cargo_id         is distinct from old.cargo_id
  or new.tecnico_id       is distinct from old.tecnico_id
  or new.email            is distinct from old.email
  -- 101: a data de contratação é registro da empresa, não da pessoa.
  or new.data_contratacao is distinct from old.data_contratacao
  -- 103: a foto é posta pelo ADMIN, no cadastro (D-180).
  or new.foto_path        is distinct from old.foto_path then
    raise exception
      'Empresa, base, situacao, cargo, perfil de acesso, e-mail, data de contratacao e foto so o ADMIN altera.'
      using errcode = '42501';
  end if;

  -- 103: a cidade ativa a pessoa escolhe, mas só entre as que pode ver.
  if new.base_ativa is distinct from old.base_ativa
     and new.base_ativa is not null
     and new.base_ativa not in (select bases_permitidas()) then
    raise exception 'Voce nao tem acesso a esta cidade.' using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function public.bases_permitidas()      from public, anon;
revoke all on function public.bases_visiveis()        from public, anon;
revoke all on function public.trocar_cidade(uuid)     from public, anon;
revoke all on function public.perfil_protege_campos() from public, anon;
grant execute on function public.bases_permitidas()   to authenticated;
grant execute on function public.bases_visiveis()     to authenticated;
grant execute on function public.trocar_cidade(uuid)  to authenticated;

-- ┌─ 106b · tec1_da_os sem passar pelo RLS a cada O.S. ────────────────┐
-- │ Com o cache acima, painel_equipes ficou em 1,7–1,9 s — e o maior   │
-- │ pedaço era tec1_da_os (1.808 chamadas), que é INVOKER: cada        │
-- │ chamada lê ordem_servico + visita + tipo_servico, e cada leitura   │
-- │ avalia as policies (minha_empresa, eh_gestor, bases_visiveis).     │
-- │ Como DEFINER: 1,7 s → 0,66 s, mesmo painel (md5 igual).            │
-- │                                                                    │
-- │ Por que pode: ela devolve só a CLASSIFICAÇÃO do TEC1 (PADRAO /     │
-- │ SEM_PADRAO / EXPURGADA / nulo) de uma O.S. cujo uuid já se         │
-- │ conhece — quem chama (painel, reconciliação) já filtrou pela       │
-- │ cidade. Não devolve nome, endereço nem data. Aberta ao anon: não.  │
-- └────────────────────────────────────────────────────────────────────┘
alter function public.tec1_da_os(uuid) security definer;
revoke all on function public.tec1_da_os(uuid) from public, anon;
grant execute on function public.tec1_da_os(uuid) to authenticated;
