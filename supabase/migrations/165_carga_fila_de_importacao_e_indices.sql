-- ┌─ 165 · o sistema aguentando 100 pessoas, e a fila de importação ───┐
-- │ > "precisamos fazer todos os testes de uso e estresse do sistema.  │
-- │ >  Imagina que tem mais de 100 pessoas usando o mesmo sistema (...) │
-- │ >  Terá mais de 1 milhão de linhas (...) no app do técnico, na      │
-- │ >  parte do painel dele, o sistema diz que está somando os dados   │
-- │ >  (...) se várias pessoas importaram ao mesmo tempo no site,      │
-- │ >  precisa ter uma fila de processamento" — Emanuel, 31/10         │
-- │                                                                    │
-- │ Aplicada em partes pelo MCP (165a a 165h), na ordem abaixo. As     │
-- │ partes que mexem em função grande (painel_equipes, as três etapas  │
-- │ da importação, as 66 funções de escopo) trocam um trecho sobre a   │
-- │ definição VIVA do banco — o arquivo de migration pode estar atrás  │
-- │ do banco (D-160) e recriar a partir dele desfaria outra coisa.     │
-- │                                                                    │
-- │ Medido como `authenticated`, logado como pessoas reais (COP,       │
-- │ coordenação, supervisão, técnico), 8 sessões ao mesmo tempo, 10    │
-- │ rodadas cada, tudo desfeito no fim — 640 chamadas, 0 erros:        │
-- │   painel do técnico   5.300 ms → ~280 ms                           │
-- │   ranking             3.900 ms → ~225 ms                           │
-- │   tela de Equipes     1.545 ms → ~190 ms                           │
-- │   sino da web           608 ms →  ~55 ms (sinais_do_dia)           │
-- │   central               491 ms →  ~36 ms                           │
-- │   selos do menu         204 ms →  ~10 ms                           │
-- │ Ver D-248.                                                         │
-- └────────────────────────────────────────────────────────────────────┘

-- ── 165a · producao_por_tecnico: a pontuação EM LOTE ───────────────────
-- Era `left join lateral pontos_da_visita(v.id)` — uma chamada por visita
-- do mês da empresa inteira (6.056 em outubro), a cada abertura de painel
-- e de ranking. Agora pontos_das_visitas(array(...)). Conferido antes:
-- 6.056 de 6.056 visitas com os mesmos pontos e o mesmo "achou".
create or replace function public.producao_por_tecnico(p_de date, p_ate date)
 returns table(tecnico_id uuid, visitas bigint, concluidas bigint, pontos numeric, dias bigint, quebradas bigint, pontos_perdidos numeric, perdidos_sem_regra bigint, tec1_perdidos bigint, pontos_sem_prova numeric, sem_prova bigint, pontos_expurgados numeric, expurgados bigint)
 language sql stable security definer set search_path to 'public'
as $function$
  with par as materialized (
    select coalesce((select (valor #>> '{}')::int from parametro
                      where empresa_id = minha_empresa() and chave = 'evidencia_minima_concluida'), 3) as min_ok,
           coalesce((select (valor #>> '{}')::date from parametro
                      where empresa_id = minha_empresa() and chave = 'evidencia_obriga_desde'), hoje_local()) as desde
  ),
  v as materialized (
    select v.id, v.tecnico_responsavel_id as tec, v.situacao, v.data_agendada, v.tec1
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.empresa_id = minha_empresa()
       and v.excluido_em is null
       and v.data_agendada between p_de and p_ate
       and v.tecnico_responsavel_id is not null
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
  ),
  p as materialized (
    select x.visita_id, x.pontos_claro, coalesce(x.achou, false) as achou
      from pontos_das_visitas(array(select id from v)) x
  ),
  q as materialized (
    select distinct o.visita_id
      from ordem_servico o
      join codigo_baixa c on c.id = o.codigo_baixa_id
     where c.natureza = 'IMPRODUTIVA'
       and o.visita_id in (select id from v)
  ),
  ev as materialized (
    select e.visita_id, count(*)::int as n from evidencia e
     where e.visita_id in (select id from v) group by 1
  ),
  xp as materialized (
    select x.visita_id from expurgo_pontuacao x
     where x.visita_id in (select id from v) and x.desfeito_em is null
  ),
  prov as materialized (
    select v.id,
           (v.data_agendada < (select desde from par)
            or coalesce(ev.n, 0) >= (select min_ok from par)) as provado
      from v left join ev on ev.visita_id = v.id
  )
  select v.tec,
         count(*),
         count(*) filter (where v.situacao = 'CONCLUIDA'),
         round(coalesce(sum(p.pontos_claro) filter (
           where v.situacao = 'CONCLUIDA' and pr.provado and xp.visita_id is null), 0), 4),
         count(distinct v.data_agendada) filter (where v.situacao = 'CONCLUIDA'),
         count(*) filter (where q.visita_id is not null),
         round(coalesce(sum(p.pontos_claro) filter (
           where q.visita_id is not null and v.situacao <> 'CONCLUIDA' and coalesce(p.achou, false)), 0), 4),
         count(*) filter (
           where q.visita_id is not null and v.situacao <> 'CONCLUIDA' and not coalesce(p.achou, false)),
         count(*) filter (where v.tec1 = 'SEM_PADRAO'),
         round(coalesce(sum(p.pontos_claro) filter (
           where v.situacao = 'CONCLUIDA' and not pr.provado and xp.visita_id is null), 0), 4),
         count(*) filter (where v.situacao = 'CONCLUIDA' and not pr.provado and xp.visita_id is null),
         round(coalesce(sum(p.pontos_claro) filter (
           where v.situacao = 'CONCLUIDA' and xp.visita_id is not null), 0), 4),
         count(*) filter (where v.situacao = 'CONCLUIDA' and xp.visita_id is not null)
    from v
    left join p on p.visita_id = v.id
    left join q on q.visita_id = v.id
    left join xp on xp.visita_id = v.id
    join prov pr on pr.id = v.id
   group by v.tec;
$function$;

-- ── 165b · pontos_das_visitas: regras por JUNÇÃO ───────────────────────
-- O lateral varria a lista de regras candidatas para cada visita. Agora uma
-- junção pela assinatura e a melhor por row_number, na mesma ordem de
-- preferência. 734 ms → 269 ms nas 6.056 visitas; 0 divergências.
create or replace function public.pontos_das_visitas(p_ids uuid[])
 returns table(visita_id uuid, pontos_claro numeric, pontos_equipe numeric, edificacao text, achou boolean)
 language sql stable set search_path to 'public'
as $function$
  with tp as materialized (
    select t.id from tabela_preco t where t.ativo order by t.criado_em limit 1
  ),
  v as materialized (
    select vi.id, vi.tipo_pessoa, edificacao_de(vi.tipo_residencia, vi.complemento, vi.logradouro) as edif
      from visita vi where vi.id = any(p_ids)
  ),
  a as materialized (
    select o.visita_id, string_agg(norm_txt(t.descricao), ' + ' order by o.sequencia) as assin
      from ordem_servico o
      join tipo_os t on t.id = o.tipo_os_id
     where o.visita_id = any(p_ids)
     group by o.visita_id
  ),
  r as materialized (
    select r.id, r.pontos_claro, r.pontos_equipe, r.edificacao, r.tipo_pessoa, c.assinatura
      from regra_pontuacao r
      join combinacao_os c on c.id = r.combinacao_id
      join tp on tp.id = r.tabela_preco_id
     where r.ativo
       and c.assinatura in (select assin from a)
  ),
  cand as (
    select v.id as visita_id, r.id, r.pontos_claro, r.pontos_equipe,
           row_number() over (
             partition by v.id
             order by case r.edificacao when v.edif then 2 when 'QUALQUER' then 0 else 1 end desc,
                      (r.tipo_pessoa <> 'QUALQUER')::int desc) as rn
      from v
      join a on a.visita_id = v.id
      join r on r.assinatura = a.assin
            and r.edificacao in (v.edif, case v.edif when 'BECO' then 'CASA' end, 'QUALQUER')
            and r.tipo_pessoa in (coalesce(v.tipo_pessoa, 'QUALQUER'), 'QUALQUER')
  )
  select v.id, x.pontos_claro, x.pontos_equipe, v.edif, x.id is not null
    from v
    left join cand x on x.visita_id = v.id and x.rn = 1;
$function$;

-- ── 165c · painel_equipes: a pontuação em lote ─────────────────────────
-- Por visita, cada pontos_da_visita reavaliava o RLS (a função é INVOKER):
-- milhares de eh_gestor/ve_cidade_inteira numa leitura (D-183).
do $$
declare d text := pg_get_functiondef('public.painel_equipes(date,uuid[])'::regprocedure);
  velho text := '    left join lateral pontos_da_visita(v.id) p on true';
  novo text := '    -- 165: em lote; por visita, cada chamada reavaliava o RLS (D-183)
    left join pontos_das_visitas(array(select id from v)) p on p.visita_id = v.id';
begin
  if d like '%pontos_das_visitas(array(select id from v)) p%' then return; end if;
  if (length(d) - length(replace(d, velho, ''))) / length(velho) <> 1 then
    raise exception 'painel_equipes: a linha esperada nao aparece exatamente uma vez';
  end if;
  execute replace(d, velho, novo);
end $$;

-- ── 165d · índices para o volume ───────────────────────────────────────
-- Só onde há consulta de verdade ou exclusão em cascata. O mais grave:
-- visita.tecnico_responsavel_id não tinha índice — é por ele que o painel,
-- a revisita e a agenda do técnico acham as visitas dele.
create index if not exists visita_tecnico_dia_ix
  on visita (tecnico_responsavel_id, data_agendada) where excluido_em is null;
create index if not exists visita_importacao_ix on visita (importacao_id);
create index if not exists aviso_empresa_criado_ix on aviso (empresa_id, criado_em desc);
create index if not exists aviso_evento_ix on aviso (evento_id);
create index if not exists visita_evento_os_ix on visita_evento (os_id) where os_id is not null;
create index if not exists visita_evento_importacao_ix on visita_evento (importacao_id) where importacao_id is not null;
create index if not exists reincidencia_anterior_ix on reincidencia (visita_anterior_id);
create index if not exists casa_cliente_visita_ix on casa_cliente (visita_id);
create index if not exists equipamento_movimento_os_ix on equipamento_movimento (os_id) where os_id is not null;
create index if not exists evidencia_os_ix on evidencia (os_id) where os_id is not null;
create index if not exists miscelanea_mov_visita_ix on miscelanea_movimento (visita_id) where visita_id is not null;
create index if not exists miscelanea_mov_tecnico_ix on miscelanea_movimento (tecnico_id, criado_em);

-- ── 165e/f · meus_avisos (o sino do técnico) sem ler a tabela inteira ──
-- "gestor OU da equipe" numa condição só impedia o índice: lia os 31 mil
-- avisos para devolver 50. Dois caminhos, cada um no seu índice. E o
-- desempate por id: 82 avisos de uma importação nascem no mesmo instante, e
-- quais entravam nos 50 era sorte (a regra antiga também).
create or replace function public.meus_avisos(p_limite integer default 50)
 returns table(id bigint, visita_id uuid, tipo text, titulo text, detalhe text, situacao_de text, situacao_para text, contrato text, servico text, autor_login text, criado_em timestamp with time zone, lido boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  with escopo as materialized (
    select minha_empresa() as empresa, (select eh_gestor()) as gestor, auth.uid() as eu,
           greatest(1, least(coalesce(p_limite, 50), 200)) as lim
  ),
  lista as (
    (select a.* from aviso a, escopo s
      where s.gestor and a.empresa_id = s.empresa
      order by a.criado_em desc, a.id desc limit (select lim from escopo))
    union all
    (select a.* from aviso a, escopo s
      where not s.gestor and a.empresa_id = s.empresa
        and a.equipe_id in (select e from equipes_visiveis() e)
      order by a.criado_em desc, a.id desc limit (select lim from escopo))
  )
  select a.id, a.visita_id, a.tipo, a.titulo, a.detalhe,
         a.situacao_de, a.situacao_para, a.contrato, a.servico,
         a.autor_login, a.criado_em,
         (l.aviso_id is not null) as lido
    from lista a
    cross join escopo s
    left join aviso_leitura l on l.aviso_id = a.id and l.usuario_id = s.eu
   order by a.criado_em desc, a.id desc;
$function$;

-- ── 165g · a FILA de importação, por cidade ────────────────────────────
-- Nada impedia duas importações da MESMA cidade ao mesmo tempo (gente +
-- gente, gente + robô). A importação são três chamadas (D-181), e uma no
-- meio da outra podia desatribuir o que a outra acabou de trazer.
-- Uma linha por importação esperando ou rodando; só a PRIMEIRA viva de cada
-- cidade roda; cidades diferentes não esperam. Quem espera pergunta de 3 em
-- 3 s (sai depois de 30 s calada); quem roda renova a cada etapa e perde a
-- vez depois de `prazo` calada (3 min; 1 min para a extensão antiga, que
-- não entra na fila). A vez é decidida com advisory lock por TENTATIVA:
-- quem espera nunca fica preso atrás de uma importação de 8 s.
create table if not exists importacao_fila (
  importacao_id uuid primary key references importacao(id) on delete cascade,
  base_id       uuid not null references base(id),
  entrou_em     timestamptz not null default now(),
  visto_em      timestamptz not null default now(),
  rodando_desde timestamptz,
  prazo         interval not null default interval '3 minutes'
);
create index if not exists importacao_fila_base_ix on importacao_fila (base_id, entrou_em);
alter table importacao_fila enable row level security;   -- só pelas funções

create or replace function public._fila_quem_roda(p_base uuid)
returns uuid language sql stable security definer set search_path to 'public' as $function$
  select f.importacao_id from importacao_fila f
   where f.base_id = p_base and f.rodando_desde is not null
     and f.visto_em > now() - f.prazo
   order by f.rodando_desde limit 1;
$function$;
revoke all on function public._fila_quem_roda(uuid) from public, anon, authenticated;

create or replace function public.entrar_fila_importacao(p_importacao_id uuid)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $function$
declare
  v_base uuid; v_roda uuid; v_primeira uuid; v_pos int; r record;
begin
  select i.base_id into v_base from importacao i
   where i.id = p_importacao_id and i.empresa_id = minha_empresa();
  if v_base is null then
    raise exception 'Importacao nao encontrada.' using errcode = '42501';
  end if;
  insert into importacao_fila (importacao_id, base_id) values (p_importacao_id, v_base)
  on conflict (importacao_id) do update set visto_em = now();
  v_roda := _fila_quem_roda(v_base);
  if v_roda = p_importacao_id then
    update importacao_fila set visto_em = now() where importacao_id = p_importacao_id;
    return jsonb_build_object('vez', true);
  end if;
  if pg_try_advisory_xact_lock(hashtext('fila_importacao:' || v_base::text)) then
    delete from importacao_fila f
     where f.base_id = v_base and f.importacao_id <> p_importacao_id
       and ((f.rodando_desde is null and f.visto_em < now() - interval '30 seconds')
            or (f.rodando_desde is not null and f.visto_em < now() - f.prazo));
    v_roda := _fila_quem_roda(v_base);
    select f.importacao_id into v_primeira from importacao_fila f
     where f.base_id = v_base and f.rodando_desde is null
     order by f.entrou_em, f.importacao_id limit 1;
    if v_roda is null and v_primeira = p_importacao_id then
      update importacao_fila set rodando_desde = now(), visto_em = now()
       where importacao_id = p_importacao_id;
      return jsonb_build_object('vez', true);
    end if;
  end if;
  select count(*) + 1 into v_pos from importacao_fila f
   where f.base_id = v_base and f.importacao_id <> p_importacao_id
     and (f.rodando_desde is not null
          or f.entrou_em < (select entrou_em from importacao_fila where importacao_id = p_importacao_id));
  select i.arquivo_nome, p.nome as quem into r
    from importacao_fila f join importacao i on i.id = f.importacao_id
    left join perfil p on p.id = i.usuario_id
   where f.base_id = v_base and f.importacao_id <> p_importacao_id
   order by (f.rodando_desde is null), f.rodando_desde, f.entrou_em limit 1;
  return jsonb_build_object('vez', false, 'posicao', v_pos,
    'na_frente', r.arquivo_nome, 'quem', coalesce(r.quem, 'sincronismo'));
end;
$function$;
revoke all on function public.entrar_fila_importacao(uuid) from public, anon;
grant execute on function public.entrar_fila_importacao(uuid) to authenticated, service_role;

create or replace function public.sair_fila_importacao(p_importacao_id uuid)
returns void language sql volatile security definer set search_path to 'public' as $function$
  delete from importacao_fila f
   using importacao i
   where f.importacao_id = p_importacao_id and i.id = f.importacao_id
     and i.empresa_id = minha_empresa();
$function$;
revoke all on function public.sair_fila_importacao(uuid) from public, anon;
grant execute on function public.sair_fila_importacao(uuid) to authenticated, service_role;

create or replace function public.exigir_vez_importacao(p_importacao_id uuid)
returns void language plpgsql volatile security definer set search_path to 'public' as $function$
declare v_base uuid; v_roda uuid; v_entrou timestamptz;
begin
  select i.base_id into v_base from importacao i where i.id = p_importacao_id;
  if v_base is null then return; end if;
  v_roda := _fila_quem_roda(v_base);
  if v_roda = p_importacao_id then
    update importacao_fila set visto_em = now() where importacao_id = p_importacao_id;
    return;
  end if;
  select entrou_em into v_entrou from importacao_fila where importacao_id = p_importacao_id;
  if v_roda is null
     and pg_try_advisory_xact_lock(hashtext('fila_importacao:' || v_base::text))
     and _fila_quem_roda(v_base) is null
     and not exists (
       select 1 from importacao_fila f
        where f.base_id = v_base and f.importacao_id <> p_importacao_id
          and f.rodando_desde is null and f.visto_em > now() - interval '30 seconds'
          and f.entrou_em < coalesce(v_entrou, now())) then
    insert into importacao_fila (importacao_id, base_id, rodando_desde, prazo)
    values (p_importacao_id, v_base, now(), interval '1 minute')
    on conflict (importacao_id) do update set rodando_desde = now(), visto_em = now();
    return;
  end if;
  raise exception 'IMPORTACAO_NA_FILA: outra importacao desta cidade esta rodando; esta espera a vez.';
end;
$function$;
revoke all on function public.exigir_vez_importacao(uuid) from public, anon, authenticated;

-- As três etapas passam pela guarda logo no começo (a prévia não).
do $$
declare f text; d text; alvo text; novo text;
begin
  foreach f in array array['public.importar_toa(uuid,boolean)',
                           'public.reconciliar_importacao(uuid)',
                           'public.desatribuir_ausentes(uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if d like '%exigir_vez_importacao%' then continue; end if;
    alvo := substring(d from '\$function\$\s*declare.*?\nbegin\n');
    if alvo is null then raise exception '% sem bloco begin reconhecivel', f; end if;
    novo := alvo || case when f like '%importar_toa%'
      then E'  -- 165: a fila da cidade (a prévia, desfeita no fim, não entra).\n  if not coalesce(p_simular, false) then perform exigir_vez_importacao(p_importacao_id); end if;\n'
      else E'  -- 165: a fila da cidade — só a importação da vez mexe nos contratos.\n  perform exigir_vez_importacao(p_importacao_id);\n' end;
    execute replace(d, alvo, novo);
  end loop;
end $$;

-- ── 165h · a regra de escopo uma vez por CONSULTA, não por linha ───────
-- `and (ve_cidade_inteira() or ...)` solto no WHERE é chamado por linha. No
-- sino da web: 1.195 chamadas de ve_cidade_inteira → eh_gestao → tem_papel
-- (2.399) numa leitura só, ~470 dos 628 ms. `(select ve_cidade_inteira())`
-- vira initplan: uma vez. Mesmo resultado (STABLE, não depende da linha).
-- Idem eh_gestor(). 66 funções; testar_policies 33/33, testar_campo 29/29.
do $$
declare r record; d text; n text;
begin
  for r in
    select p.oid from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname not in ('ve_cidade_inteira', 'eh_gestor', 'eh_gestao')
       and p.prosrc ~ '(?<![Ss][Ee][Ll][Ee][Cc][Tt] )(ve_cidade_inteira|eh_gestor)\(\)'
  loop
    d := pg_get_functiondef(r.oid);
    n := regexp_replace(d, '(?<![Ss][Ee][Ll][Ee][Cc][Tt] )\m(ve_cidade_inteira|eh_gestor)\(\)', '(select \1())', 'g');
    if n <> d then execute n; end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
