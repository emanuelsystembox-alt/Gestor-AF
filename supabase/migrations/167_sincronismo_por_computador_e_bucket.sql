-- 167 · O sincronismo passa a ser de cada computador, com a vez por BUCKET (D-251)
--
-- ┌─ o que resolve ─────────────────────────────────────────────────────┐
-- │ > "quem tiver a extensão ele poderá editar o tempo de importação    │
-- │ > (...) 5 - 15 - 30 - 60 minutos (...) é importante selecionar      │
-- │ > quais buckets tem disponível no login para importar, porém        │
-- │ > somente o admin consegue importar para todas as cidades (...) os  │
-- │ > demais só vão conseguir importar para os buckets disponíveis em   │
-- │ > seu login" — Emanuel, 01/11                                       │
-- │                                                                     │
-- │ Perguntado, decidiu: (1) o bucket aparece se o login do TOA o vê na │
-- │ árvore E ele é de uma cidade que a pessoa pode ver no PulsoLine     │
-- │ (`bases_permitidas()`: ADMIN todas; os demais, a do cadastro + as   │
-- │ marcadas); (2) a configuração é de CADA COMPUTADOR, com trava por   │
-- │ bucket — um bucket é sincronizado por um computador por vez;        │
-- │ (3) a varredura: 5/15/30/60 min ou só no botão.                     │
-- │                                                                     │
-- │ Até a 166 era uma configuração por CIDADE (tela Sincronismo) e uma  │
-- │ vez por cidade (`sincronismo.executor_id`), sempre na cidade ATIVA. │
-- └─────────────────────────────────────────────────────────────────────┘
--
-- A. `bases_visiveis()` honra o cabeçalho `x-afline-cidade`
--    A importação inteira (importacao, fila, importar_toa, reconciliar,
--    desatribuir, as policies) confere a cidade por `bases_visiveis()` — a
--    cidade ATIVA do topo. Para um computador trabalhar em várias cidades,
--    a extensão diz em cada pedido "estou na cidade X". Só vale X que esteja
--    em `bases_permitidas()` — o mesmo poder de `trocar_cidade`, sem mudar a
--    cidade da tela de ninguém. X fora do acesso = nenhuma cidade (nunca
--    "cai" na ativa). Sem o cabeçalho, nada muda.
-- B. `sincronismo_bucket_vez`: de quem é a vez de cada bucket (computador =
--    pessoa + máquina, porque a mesma pessoa pode estar em dois PCs).
-- C. `sincronismo_meus_buckets(p_arvore)`: o que a extensão oferece.
-- D. `sincronismo_pulso_buckets(...)`: pulso, vez e o que está vencido.
-- E. `sincronismo_pulso` (por cidade) sai de uso: um computador na versão
--    velha e outro na nova importariam o mesmo bucket em dobro.

-- ─── A ─────────────────────────────────────────────────────────────────
create or replace function public.bases_visiveis()
 returns setof uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid   text := coalesce(auth.uid()::text, '');
  -- 167: a cidade pedida pela extensão (PostgREST põe os cabeçalhos aqui)
  v_hdr   text := nullif(btrim(coalesce(
              nullif(current_setting('request.headers', true), '')::json ->> 'x-afline-cidade', '')), '');
  v_chave text;
  v_cache text := current_setting('app.bases_visiveis', true);
  v_ids   uuid[];
begin
  v_chave := v_uid || coalesce('#' || v_hdr, '');
  -- 106: já calculado nesta transação, para este usuário (e este cabeçalho).
  if coalesce(v_cache, '') <> '' and split_part(v_cache, '|', 1) = v_chave then
    return query select unnest(coalesce(
      string_to_array(nullif(split_part(v_cache, '|', 2), ''), ','), '{}')::uuid[]);
    return;
  end if;

  if v_hdr is not null then
    -- 167: só uma cidade que a pessoa PODE ver; qualquer outra coisa, nenhuma.
    select coalesce(array_agg(p.id), '{}') into v_ids
      from bases_permitidas() p(id)
     where v_hdr ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and p.id = v_hdr::uuid;
  else
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
  end if;

  perform set_config('app.bases_visiveis', v_chave || '|' || array_to_string(v_ids, ','), true);
  return query select unnest(v_ids);
end;
$function$;

-- ─── B ─────────────────────────────────────────────────────────────────
create table if not exists public.sincronismo_bucket_vez (
  bucket_id     uuid primary key references toa_bucket(id) on delete cascade,
  empresa_id    uuid not null references empresa(id),
  base_id       uuid not null references base(id),
  executor_id   uuid not null references perfil(id),
  -- o computador: um uuid que a extensão sorteia uma vez e guarda
  maquina       text not null check (maquina ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  visto_em      timestamptz not null default now(),
  desde         timestamptz not null default now(),
  info          text,
  -- o que ESTE computador declarou, para a tela mostrar o ritmo de cada bucket
  rota_min      smallint check (rota_min in (5, 15, 30, 60)),
  varredura_min smallint check (varredura_min in (5, 15, 30, 60)),
  toa_sessao    text check (toa_sessao in ('OK', 'CAIU'))
);
alter table public.sincronismo_bucket_vez enable row level security;
drop policy if exists sincronismo_bucket_vez_leitura on public.sincronismo_bucket_vez;
create policy sincronismo_bucket_vez_leitura on public.sincronismo_bucket_vez
  for select to authenticated
  using (empresa_id = (select minha_empresa())
         and base_id in (select bases_visiveis())
         and ((select eh_gestor()) or (select tem_papel('CONTROLADOR')) or (select tem_papel('ROBO'))));
revoke all on public.sincronismo_bucket_vez from anon, public;
grant select on public.sincronismo_bucket_vez to authenticated;

-- ─── C ─────────────────────────────────────────────────────────────────
-- p_arvore: [{ "numero": 32041, "nome": "MAN-AFLINE" }, …] — os buckets que
-- a árvore do Console de Alocação mostra para o login do TOA deste Chrome.
create or replace function public.sincronismo_meus_buckets(p_arvore jsonb, p_maquina text default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_emp uuid := (select minha_empresa());
begin
  if not ((eh_gestao() or tem_papel('ROBO')) and tem_permissao('importacao.executar')) then
    raise exception 'Sem permissao para sincronizar.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_arvore, '[]'::jsonb)) <> 'array' then
    raise exception 'Arvore invalida.';
  end if;
  return jsonb_build_object(
    'agora', now(), 'hoje', hoje_local(),
    -- o que a pessoa pode sincronizar: na árvore do TOA (pelo número) E de
    -- uma cidade que ela pode ver no PulsoLine
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'nome', t.nome, 'numero_toa', t.numero_toa,
               'base_id', t.base_id, 'cidade', b.nome,
               'vez', case when v.bucket_id is null or v.visto_em < now() - interval '3 minutes' then null
                           else jsonb_build_object('minha', v.maquina = p_maquina and v.executor_id = auth.uid(),
                                                   'nome', pe.nome, 'visto_em', v.visto_em,
                                                   'rota_min', v.rota_min) end
             ) order by b.nome, t.nome)
        from toa_bucket t
        join base b on b.id = t.base_id
        left join sincronismo_bucket_vez v on v.bucket_id = t.id
        left join perfil pe on pe.id = v.executor_id
       where t.empresa_id = v_emp and t.ativo and t.numero_toa is not null
         and t.base_id in (select bases_permitidas())
         and t.numero_toa in (select (a ->> 'numero')::int from jsonb_array_elements(p_arvore) a
                               where (a ->> 'numero') ~ '^\d{1,9}$')
    ), '[]'::jsonb),
    -- o que a árvore mostra e não dá para sincronizar, com o porquê (regra 6:
    -- a pessoa vê o que ficou de fora, não um "nada" calado)
    'fora', coalesce((
      select jsonb_agg(jsonb_build_object('numero', x.numero, 'nome', x.nome, 'motivo', x.motivo) order by x.nome)
        from (
          select (a ->> 'numero')::int as numero, upper(btrim(a ->> 'nome')) as nome,
                 case
                   when t2.id is null then 'NAO_CADASTRADO'
                   when t2.base_id not in (select bases_permitidas()) then 'OUTRA_CIDADE'
                   when not t2.ativo then 'DESLIGADO'
                   when t2.numero_toa is null or t2.numero_toa <> (a ->> 'numero')::int then 'NUMERO_DIFERENTE'
                 end as motivo
            from jsonb_array_elements(p_arvore) a
            left join toa_bucket t2 on t2.empresa_id = v_emp and t2.nome = upper(btrim(a ->> 'nome'))
           where (a ->> 'numero') ~ '^\d{1,9}$'
             and not exists (select 1 from toa_bucket t3
                              where t3.empresa_id = v_emp and t3.ativo
                                and t3.numero_toa = (a ->> 'numero')::int
                                and t3.base_id in (select bases_permitidas()))
        ) x
       where x.motivo is not null and x.nome like '%AFLINE%'
    ), '[]'::jsonb));
end;
$function$;

-- ─── D ─────────────────────────────────────────────────────────────────
create or replace function public.sincronismo_pulso_buckets(
  p_maquina text, p_info text, p_buckets uuid[], p_assumir uuid[] default '{}',
  p_rota_min smallint default null, p_varredura_min smallint default null,
  p_toa_sessao text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_eu   uuid := auth.uid();
  v_emp  uuid := (select minha_empresa());
  v_hoje date := hoje_local();
  v_quer uuid[];
begin
  -- A mesma porta de quem importa à mão (113).
  if not ((eh_gestao() or tem_papel('ROBO')) and tem_permissao('importacao.executar')) then
    raise exception 'Sem permissao para sincronizar.' using errcode = '42501';
  end if;
  if p_maquina is null or p_maquina !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Computador invalido.';
  end if;
  if p_rota_min is not null and p_rota_min not in (5, 15, 30, 60) then
    raise exception 'Intervalo da rota invalido: 5, 15, 30 ou 60 minutos.';
  end if;
  if p_varredura_min is not null and p_varredura_min not in (5, 15, 30, 60) then
    raise exception 'Intervalo da varredura invalido: 5, 15, 30 ou 60 minutos, ou so no botao.';
  end if;
  if p_toa_sessao is not null and p_toa_sessao not in ('OK', 'CAIU') then
    raise exception 'Estado de sessao invalido.';
  end if;

  -- Só os buckets que a pessoa pode sincronizar; o resto é ignorado.
  select coalesce(array_agg(t.id), '{}') into v_quer
    from toa_bucket t
   where t.id = any(coalesce(p_buckets, '{}')) and t.empresa_id = v_emp and t.ativo
     and t.numero_toa is not null and t.base_id in (select bases_permitidas());

  -- Solta o que este computador tinha e desmarcou.
  delete from sincronismo_bucket_vez
   where executor_id = v_eu and maquina = p_maquina and not (bucket_id = any(v_quer));

  -- Pega a vez do que está livre, parado há 3 min, já é dele, ou foi
  -- ASSUMIDO no botão. Num INSERT … ON CONFLICT só: dois PCs no mesmo
  -- instante não ficam os dois com a vez.
  insert into sincronismo_bucket_vez as v (bucket_id, empresa_id, base_id, executor_id, maquina,
         visto_em, desde, info, rota_min, varredura_min, toa_sessao)
  select t.id, t.empresa_id, t.base_id, v_eu, p_maquina, now(), now(), left(p_info, 300),
         p_rota_min, p_varredura_min, p_toa_sessao
    from toa_bucket t where t.id = any(v_quer)
  on conflict (bucket_id) do update
     set executor_id = excluded.executor_id, maquina = excluded.maquina, visto_em = now(),
         desde = case when v.maquina = excluded.maquina and v.executor_id = excluded.executor_id
                      then v.desde else now() end,
         info = excluded.info, rota_min = excluded.rota_min, varredura_min = excluded.varredura_min,
         toa_sessao = coalesce(excluded.toa_sessao, v.toa_sessao)
   where (v.maquina = excluded.maquina and v.executor_id = excluded.executor_id)
      or v.visto_em < now() - interval '3 minutes'
      or v.bucket_id = any(coalesce(p_assumir, '{}'));

  return jsonb_build_object(
    'agora', now(), 'hoje', v_hoje,
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'nome', t.nome, 'numero_toa', t.numero_toa,
               'base_id', t.base_id, 'cidade', b.nome,
               'vez', v.maquina = p_maquina and v.executor_id = v_eu,
               'outro', case when v.maquina = p_maquina and v.executor_id = v_eu then null
                             else jsonb_build_object('nome', pe.nome, 'visto_em', v.visto_em) end,
               -- a última tentativa de hoje (qualquer resultado): é dela que
               -- a extensão conta o intervalo
               'ultima', u.em,
               'impressao', case when imp.em > now() - interval '60 minutes' then imp.impressao end
             ) order by b.nome, t.nome)
        from toa_bucket t
        join base b on b.id = t.base_id
        left join sincronismo_bucket_vez v on v.bucket_id = t.id
        left join perfil pe on pe.id = v.executor_id
        left join lateral (
          select max(r.terminada_em) as em from sincronismo_rodada r
           where r.bucket_id = t.id and r.dia = v_hoje) u on true
        left join lateral (
          select r.impressao, r.terminada_em as em from sincronismo_rodada r
           where r.bucket_id = t.id and r.dia = v_hoje and r.resultado = 'IMPORTADA'
           order by r.terminada_em desc limit 1) imp on true
       where t.id = any(v_quer)
    ), '[]'::jsonb));
end;
$function$;

-- Soltar tudo deste computador (desligou ou saiu).
create or replace function public.sincronismo_soltar_buckets(p_maquina text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  delete from sincronismo_bucket_vez where executor_id = auth.uid() and maquina = p_maquina;
$function$;

-- ─── E ─────────────────────────────────────────────────────────────────
create or replace function public.sincronismo_pulso(p_base uuid, p_info text default null::text,
  p_toa_sessao text default null::text, p_modo text default 'PULSO'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- 167: a vez agora é por bucket (sincronismo_pulso_buckets). Uma extensão
  -- velha pulsando por cidade importaria em dobro com uma nova.
  raise exception 'Esta versao da extensao saiu de uso: em chrome://extensions, recarregue a extensao AFLINE (0.8.0 ou mais nova).'
    using errcode = '42501';
end;
$function$;

revoke all on function public.sincronismo_meus_buckets(jsonb, text) from public, anon;
revoke all on function public.sincronismo_pulso_buckets(text, text, uuid[], uuid[], smallint, smallint, text) from public, anon;
revoke all on function public.sincronismo_soltar_buckets(text) from public, anon;
grant execute on function public.sincronismo_meus_buckets(jsonb, text) to authenticated;
grant execute on function public.sincronismo_pulso_buckets(text, text, uuid[], uuid[], smallint, smallint, text) to authenticated;
grant execute on function public.sincronismo_soltar_buckets(text) to authenticated;

notify pgrst, 'reload schema';
