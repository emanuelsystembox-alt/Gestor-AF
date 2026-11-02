-- 177 · O resumo do dia, às 18h, guardado por cidade
--
-- O QUE RESOLVE
--   "Resumo do dia automático às 18h para a coordenação: TEC1, quebras por
--    agrupamento, revisitas, quem ficou abaixo do ritmo, ocorrências do campo
--    e humor" — pacote aprovado em 02/11 (D-262). Onde chega, escolha do
--    Emanuel: NA TELA, com aviso no sino. Sem WhatsApp, sem e-mail.
--
-- COMO
--   · `gerar_resumo_do_dia()` fotografa o dia da CIDADE ATIVA com as contas
--     que já existem — `tec1_da_os` (D-187), `impacto_quebra` (143),
--     `revisita_dos_contratos` (D-245), `ritmo_do_dia` (D-167). Nenhuma regra
--     escrita de novo aqui.
--   · O pg_cron chama às 18h de Manaus, cidade por cidade, pela mesma porta
--     da 175 (`rodar_por_cidade`), e o resumo vira um sinal RESUMO no sino.
--     A gestão pode gerar antes, pelo botão da tela (sobrescreve o do dia).
--   · É uma FOTO: o que muda depois das 18h não reescreve o resumo — quem quer
--     o número de agora gera de novo.
--
-- QUEM LÊ O QUÊ
--   O humor é só de quem tem `campo.humor`; as ocorrências, de quem tem
--   `campo.ocorrencias` (D-226). O resto, a gestão da cidade. A tabela não tem
--   policy de propósito: só `resumo_do_dia()` lê, e ela corta por permissão.
--
-- E a medida da 176: "avisados em risco" × "fecharam sem padrão" entra no
-- resumo — é a conferência diária de que a previsão acerta.

create table if not exists public.resumo_dia (
  empresa_id  uuid not null references empresa(id),
  base_id     uuid not null references base(id),
  dia         date not null,
  gerado_em   timestamptz not null default now(),
  gerado_por  uuid,           -- nulo = o relógio (pg_cron)
  operacao    jsonb not null,
  humor       jsonb,
  ocorrencias jsonb,
  primary key (base_id, dia)
);
alter table public.resumo_dia enable row level security;
revoke all on table public.resumo_dia from anon, authenticated;

/*
 * A porta única do relógio (175 e 177): chama uma função da lista, cidade
 * por cidade com contrato hoje, como o ADMIN mais antigo da empresa a chamaria
 * com aquela cidade ativa (x-afline-cidade, D-251). A lista é fechada: o nome
 * vai num EXECUTE.
 */
create or replace function public.rodar_por_cidade(p_funcao text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  if p_funcao not in ('sinais_do_dia', 'gerar_resumo_do_dia') then
    raise exception 'rodar_por_cidade: % não está na lista.', p_funcao;
  end if;

  for r in
    select b.id as base_id, a.usuario_id
      from base b
      cross join lateral (
        select up.usuario_id
          from usuario_papel up
          join perfil p on p.id = up.usuario_id
         where up.papel = 'ADMIN' and p.empresa_id = b.empresa_id and p.ativo
         order by p.criado_em
         limit 1) a
     where b.ativo
       and exists (select 1 from visita v
                    where v.base_id = b.id and v.data_agendada = hoje_local()
                      and v.excluido_em is null)
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.usuario_id, 'role', 'authenticated')::text, true);
    perform set_config('request.headers',
      json_build_object('x-afline-cidade', r.base_id)::text, true);
    perform set_config('app.bases_visiveis', '', true);
    perform set_config('app.pelo_relogio', '1', true);
    begin
      execute format('select %I()', p_funcao);
      n := n + 1;
    exception when others then
      -- Uma cidade com defeito não cala as outras.
      raise warning 'rodar_por_cidade(%), cidade %: %', p_funcao, r.base_id, sqlerrm;
    end;
  end loop;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  perform set_config('app.bases_visiveis', '', true);
  perform set_config('app.pelo_relogio', '', true);
  return n;
end;
$$;
revoke all on function public.rodar_por_cidade(text) from public, anon, authenticated;

-- A 175 passa pela mesma porta (o cron continua chamando o mesmo nome).
create or replace function public.sinais_pelo_relogio()
returns integer
language sql
security definer
set search_path = public
as $$ select rodar_por_cidade('sinais_do_dia'); $$;
revoke all on function public.sinais_pelo_relogio() from public, anon, authenticated;

create or replace function public.gerar_resumo_do_dia()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := hoje_local();
  v_emp uuid := minha_empresa();
  v_base uuid;
  v_vis uuid[];
  v_op jsonb; v_humor jsonb; v_oc jsonb;
  v_ritmo jsonb;
  v_relogio boolean := current_setting('app.pelo_relogio', true) = '1';
begin
  if not eh_gestao() then
    raise exception 'O resumo do dia é da gestão.' using errcode = '42501';
  end if;
  -- Uma cidade por resumo: com mais de uma ativa (ADMIN sem escolha), não gera.
  select case when count(*) = 1 then min(b::text)::uuid end into v_base
    from bases_visiveis() b;
  if v_base is null then
    raise exception 'Escolha uma cidade no topo para gerar o resumo.' using errcode = '22023';
  end if;

  select coalesce(array_agg(v.id), '{}') into v_vis
    from visita v
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
   where v.empresa_id = v_emp and v.base_id = v_base and v.excluido_em is null
     and v.data_agendada = v_hoje
     and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA';

  begin
    v_ritmo := ritmo_do_dia();
  exception when others then
    v_ritmo := '[]'::jsonb;
  end;

  select jsonb_build_object(
    'contratos', (select jsonb_build_object(
        'total', count(*),
        'concluidos', count(*) filter (where v.situacao = 'CONCLUIDA'),
        'reagendados', count(*) filter (where v.situacao = 'REAGENDAMENTO'),
        'cancelados', count(*) filter (where v.situacao = 'CANCELADA'),
        'em_aberto', count(*) filter (where v.situacao <> all (situacoes_terminais())),
        -- Quebrado = O.S. com baixa IMPRODUTIVA da operadora (D-167).
        'quebrados', count(*) filter (where exists (
            select 1 from ordem_servico o join codigo_baixa c on c.id = o.codigo_baixa_id
             where o.visita_id = v.id and c.natureza = 'IMPRODUTIVA')))
      from visita v where v.id = any (v_vis)),
    'tec1', (select jsonb_build_object(
        'padrao', count(*) filter (where t = 'PADRAO'),
        'sem_padrao', count(*) filter (where t = 'SEM_PADRAO'),
        'meta', 94)
      from (select tec1_da_os(o.id) t from ordem_servico o where o.visita_id = any (v_vis)) x),
    'quebras', (select coalesce(jsonb_agg(jsonb_build_object(
        'agrupamento', q.agrupamento, 'quebras', q.quebras) order by q.quebras desc), '[]')
      from impacto_quebra(v_hoje, v_hoje) q where q.quebras > 0),
    'revisitas', (select jsonb_build_object(
        'total', count(*) filter (where r.revisita),
        'contratos', coalesce(jsonb_agg(jsonb_build_object(
           'visita_id', r.visita_id, 'contrato', v.contrato, 'grupo', ts.nome,
           'anterior_grupo', r.anterior_grupo, 'anterior_tecnico', r.anterior_tecnico,
           'dias', r.dias) order by r.dias) filter (where r.revisita), '[]'))
      from revisita_dos_contratos(v_vis) r
      join visita v on v.id = r.visita_id
      left join tipo_servico ts on ts.id = v.tipo_servico_id),
    -- O último corte que já passou: quem ficou abaixo.
    'ritmo', coalesce(v_ritmo -> (jsonb_array_length(v_ritmo) - 1), 'null'::jsonb),
    'sinais', (select coalesce(jsonb_object_agg(s.tipo, s.n), '{}') from (
        select tipo, count(*) n from sinal
         where empresa_id = v_emp and base_id = v_base and dia = v_hoje and tipo <> 'RESUMO'
         group by 1) s),
    -- A conferência da 176: dos avisados, quantos fecharam sem padrão.
    'tec1_risco', (select jsonb_build_object(
        'avisados', count(*),
        'sem_padrao', count(*) filter (where tec1_da_visita(x.visita_id) = 'SEM_PADRAO'),
        'padrao', count(*) filter (where tec1_da_visita(x.visita_id) = 'PADRAO'))
      from (select distinct visita_id from sinal
             where empresa_id = v_emp and base_id = v_base and dia = v_hoje
               and tipo = 'TEC1_RISCO' and visita_id is not null) x)
  ) into v_op;

  -- Humor: entre quem estava escalado (tem contrato hoje). Folga não é falta (D-226).
  select jsonb_build_object(
      'escalados', count(*),
      'contagem', coalesce((select jsonb_object_agg(h2.humor, h2.n) from (
          select h.humor, count(*) n from humor_diario h
           where h.dia = v_hoje and h.tecnico_id in (
             select distinct v.tecnico_responsavel_id from visita v where v.id = any (v_vis))
           group by 1) h2), '{}'),
      'sem_resposta', count(*) filter (where h.id is null),
      'atencao', coalesce(jsonb_agg(jsonb_build_object('tecnico', t.nome, 'humor', h.humor)
                   order by t.nome) filter (where h.humor in ('TRISTE', 'ESTRESSADO', 'DESANIMADO')), '[]'))
    into v_humor
    from (select distinct v.tecnico_responsavel_id as id from visita v
           where v.id = any (v_vis) and v.tecnico_responsavel_id is not null) e
    join tecnico t on t.id = e.id
    left join humor_diario h on h.tecnico_id = e.id and h.dia = v_hoje;

  select jsonb_build_object(
      'abertas_hoje', count(*),
      'por_assunto', coalesce(jsonb_object_agg(x.assunto, x.n) filter (where x.assunto is not null), '{}'))
    into v_oc
    from (select s.assunto, count(*) n
            from sinalizacao_material s join tecnico t on t.id = s.tecnico_id
           where s.empresa_id = v_emp and t.base_id = v_base
             and s.criado_em >= (v_hoje::timestamp at time zone 'America/Manaus')
           group by 1) x;
  v_oc := jsonb_build_object('abertas_hoje',
            coalesce((select sum(value::int) from jsonb_each_text(v_oc->'por_assunto')), 0),
            'por_assunto', v_oc->'por_assunto');

  insert into resumo_dia (empresa_id, base_id, dia, gerado_em, gerado_por, operacao, humor, ocorrencias)
  values (v_emp, v_base, v_hoje, now(), case when v_relogio then null else auth.uid() end,
          v_op, v_humor, v_oc)
  on conflict (base_id, dia) do update
     set gerado_em = excluded.gerado_em, gerado_por = excluded.gerado_por,
         operacao = excluded.operacao, humor = excluded.humor, ocorrencias = excluded.ocorrencias;

  -- O aviso no sino só pelo relógio: quem apertou o botão já está vendo.
  if v_relogio then
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, base_id)
    values (v_emp, 'RESUMO:' || v_base || ':' || v_hoje, v_hoje, 'RESUMO', 'Resumo do dia pronto',
            concat_ws(' · ',
              case when ((v_op->'tec1'->>'padrao')::int + (v_op->'tec1'->>'sem_padrao')::int) > 0
                   then 'TEC1 ' || replace(to_char(100.0 * (v_op->'tec1'->>'padrao')::int
                          / ((v_op->'tec1'->>'padrao')::int + (v_op->'tec1'->>'sem_padrao')::int), 'FM990D0'), '.', ',') || '%' end,
              (v_op->'contratos'->>'quebrados') || ' quebrado(s)',
              (v_op->'revisitas'->>'total') || ' revisita(s)'),
            v_base)
    on conflict (empresa_id, chave) do nothing;
  end if;

  return resumo_do_dia(v_hoje);
end;
$$;
revoke all on function public.gerar_resumo_do_dia() from public, anon;
grant execute on function public.gerar_resumo_do_dia() to authenticated;

/* O resumo da cidade ativa num dia; humor e ocorrências só com a permissão. */
create or replace function public.resumo_do_dia(p_dia date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r resumo_dia;
begin
  if not eh_gestao() then
    raise exception 'O resumo do dia é da gestão.' using errcode = '42501';
  end if;
  select * into r from resumo_dia
   where empresa_id = minha_empresa() and dia = p_dia
     and base_id in (select bases_visiveis())
   order by gerado_em desc limit 1;
  if r.base_id is null then return null; end if;
  return jsonb_build_object(
    'dia', r.dia, 'gerado_em', r.gerado_em, 'pelo_relogio', r.gerado_por is null,
    'gerado_por', (select p.nome from perfil p where p.id = r.gerado_por),
    'cidade', (select b.nome from base b where b.id = r.base_id),
    'operacao', r.operacao,
    'humor', case when tem_permissao('campo.humor') then r.humor end,
    'ocorrencias', case when tem_permissao('campo.ocorrencias') then r.ocorrencias end);
end;
$$;
revoke all on function public.resumo_do_dia(date) from public, anon;
grant execute on function public.resumo_do_dia(date) to authenticated;

/* Os dias com resumo guardado, da cidade ativa (para a navegação da tela). */
create or replace function public.resumos_guardados()
returns setof date
language sql
stable
security definer
set search_path = public
as $$
  select r.dia from resumo_dia r
   where r.empresa_id = (select minha_empresa())
     and r.base_id in (select bases_visiveis())
     and (select eh_gestao())
   order by r.dia desc limit 62;
$$;
revoke all on function public.resumos_guardados() from public, anon;
grant execute on function public.resumos_guardados() to authenticated;

alter table sinal drop constraint sinal_tipo_check;
alter table sinal add constraint sinal_tipo_check check (tipo = any (array[
  'AJUDA', 'TEC1', 'RITMO', 'QUEBROU', 'MATERIAL', 'ABASTECIMENTO', 'CERCA', 'GPS',
  'DOIS_ATIVOS', 'SUMIU_TOA', 'LOCAL', 'ATRASO', 'TEC1_RISCO', 'RESUMO']));

-- 18h de Manaus = 22h UTC.
select cron.schedule('resumo-do-dia', '0 22 * * *', $$select public.rodar_por_cidade('gerar_resumo_do_dia')$$);

-- sinais_do_dia: a do banco depois da 176, com o RESUMO vigente e na lista da gestão.
CREATE OR REPLACE FUNCTION public.sinais_do_dia()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_c jsonb := central_do_controle();
  v_hoje date := hoje_local();
  v_ini timestamptz := (hoje_local()::timestamp at time zone 'America/Manaus');
  v_emp uuid := minha_empresa();
  v_gestao boolean := eh_gestao();
  v_vigentes text[] := '{}';
  v_fora uuid[] := '{}';
  v_antec int := coalesce((select (valor #>> '{}')::int from parametro
                            where empresa_id = minha_empresa()
                              and chave = 'atraso_antecedencia_min'), 30);
  v_sinais jsonb;
  v_risco text[];
begin
  if v_gestao then
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'AJUDA:' || (x->>'visita_id') || ':' || (x->>'desde'), v_hoje, 'AJUDA',
           'Suporte técnico: ' || coalesce(x->>'tecnico', 'técnico'),
           concat_ws(' · ', x->>'servico',
                     case when x->>'contrato' is not null then 'contrato ' || (x->>'contrato') end,
                     x->>'observacao'),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from jsonb_array_elements(coalesce(v_c->'ajuda', '[]')) x
      join visita v on v.id = (x->>'visita_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'AJUDA:' || (x->>'visita_id') || ':' || (x->>'desde')
                                        from jsonb_array_elements(coalesce(v_c->'ajuda', '[]')) x);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'TEC1:' || v.id, v_hoje, 'TEC1', 'TEC1 perdido: ' || coalesce(t.nome, 'sem técnico'),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     case when e.codigo is not null then 'equipe ' || e.codigo end),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe e on e.id = v.equipe_id
     where v.empresa_id = v_emp and v.excluido_em is null
       and v.data_agendada = v_hoje and v.tec1 = 'SEM_PADRAO'
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'TEC1:' || v.id from visita v
       where v.empresa_id = v_emp and v.excluido_em is null
         and v.data_agendada = v_hoje and v.tec1 = 'SEM_PADRAO');

    select coalesce(array_agg(l.visita_id), '{}') into v_fora
      from local_da_baixa(array(
             select v.id from visita v
               left join tipo_atividade ta on ta.id = v.tipo_atividade_id
              where v.empresa_id = v_emp and v.excluido_em is null
                and v.data_agendada = v_hoje
                and v.situacao = any (situacoes_terminais())
                and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
                and v.base_id in (select bases_visiveis())
                and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis())))) l
     where l.fora_do_raio;

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'LOCAL:' || v.id, v_hoje, 'LOCAL',
           'Baixa longe do cliente: ' || coalesce(t.nome, 'sem tecnico'),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     case when e.codigo is not null then 'equipe ' || e.codigo end,
                     'fora do raio'),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe e on e.id = v.equipe_id
     where v.id = any (v_fora)
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'LOCAL:' || x from unnest(v_fora) x);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'ATRASO:' || v.id, v_hoje, 'ATRASO',
           'Janela acabando sem chegada: ' || coalesce(t.nome, coalesce(e.codigo, 'sem tecnico')),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     'janela ate ' || to_char(v.janela_fim, 'HH24:MI'),
                     coalesce(sv.label, v.situacao)),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe e on e.id = v.equipe_id
      left join situacao_visita sv on sv.codigo = v.situacao
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.empresa_id = v_emp and v.excluido_em is null
       and v.data_agendada = v_hoje
       and v.janela_fim is not null
       and v.situacao in ('ENTRADA', 'ATRIBUIDA', 'EM_DESLOCAMENTO', 'COM_IMPEDIMENTO')
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       and ((v.data_agendada + v.janela_fim) at time zone 'America/Manaus')
             <= now() + make_interval(mins => v_antec)
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'ATRASO:' || v.id from visita v
        left join tipo_atividade ta on ta.id = v.tipo_atividade_id
       where v.empresa_id = v_emp and v.excluido_em is null
         and v.data_agendada = v_hoje and v.janela_fim is not null
         and v.situacao in ('ENTRADA', 'ATRIBUIDA', 'EM_DESLOCAMENTO', 'COM_IMPEDIMENTO')
         and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
         and ((v.data_agendada + v.janela_fim) at time zone 'America/Manaus')
               <= now() + make_interval(mins => v_antec));

    -- 176: TEC1 em risco pela fila do técnico -- só ANTES do ATRASO começar
    -- (depois, o ATRASO já fala do mesmo contrato). O nível vai na chave: o
    -- risco que vira "vai estourar" avisa de novo.
    with rk as materialized (
      select x from jsonb_array_elements(tec1_em_risco()) x
       where x->>'nivel' in ('EM_RISCO', 'VAI_ESTOURAR')
         and (x->>'prazo_chegada')::timestamptz > now() + make_interval(mins => v_antec)
    ), ins as (
      insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
      select v_emp, 'TEC1R:' || (x->>'visita_id') || ':' || (x->>'nivel'), v_hoje, 'TEC1_RISCO',
             case x->>'nivel' when 'VAI_ESTOURAR' then 'TEC1 vai estourar: ' else 'TEC1 em risco: ' end
               || coalesce(x->>'tecnico', 'equipe ' || (x->>'equipe'), 'sem técnico'),
             concat_ws(' · ',
               case when x->>'contrato' is not null then 'contrato ' || (x->>'contrato') end,
               'janela ' || (x->>'janela'),
               case when (x->>'comecou')::boolean
                    then 'termina ~' || to_char((x->>'previsto_fim')::timestamptz at time zone 'America/Manaus', 'HH24:MI')
                    else 'chega ~' || to_char((x->>'previsto_chegada')::timestamptz at time zone 'America/Manaus', 'HH24:MI') end,
               case when (x->>'na_frente')::int > 0 then (x->>'na_frente') || ' na frente' end,
               case when x->>'distancia_km' is not null then 'a ' || replace(x->>'distancia_km', '.', ',') || ' km' end),
             (x->>'visita_id')::uuid, (x->>'tecnico_id')::uuid, (x->>'equipe_id')::uuid
        from rk
      on conflict (empresa_id, chave) do nothing
      returning 1
    )
    select coalesce(array_agg('TEC1R:' || (x->>'visita_id') || ':' || (x->>'nivel')), '{}')
      into v_risco from rk;
    v_vigentes := v_vigentes || v_risco;

    -- 177: o resumo do dia fica "agora" a noite inteira, na cidade dele.
    v_vigentes := v_vigentes || array(
      select 'RESUMO:' || r.base_id || ':' || r.dia from resumo_dia r
       where r.empresa_id = v_emp and r.dia = v_hoje and r.base_id in (select bases_visiveis()));

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'SUMIU:' || v.id, v_hoje, 'SUMIU_TOA',
           'Sumiu do TOA em andamento: ' || coalesce(t.nome, 'sem técnico'),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     coalesce(sv.label, v.situacao), 'confira no TOA e corrija à mão'),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join situacao_visita sv on sv.codigo = v.situacao
     where v.empresa_id = v_emp and v.excluido_em is null
       and v.sumiu_do_toa_em is not null and v.data_agendada = v_hoje
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'SUMIU:' || v.id from visita v
       where v.empresa_id = v_emp and v.excluido_em is null
         and v.sumiu_do_toa_em is not null and v.data_agendada = v_hoje);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'RITMO:' || (a->>'tecnico_id') || ':' || v_hoje || ':' || (c->>'corte'), v_hoje, 'RITMO',
           'Abaixo do ritmo até ' || (c->>'corte') || 'h: ' || (a->>'nome'),
           coalesce(a->>'detalhe',
                    (a->>'pontos') || ' de ' || (a->>'esperado') || ' pts esperados'),
           (a->>'tecnico_id')::uuid, t.equipe_id
      from jsonb_array_elements(coalesce(v_c->'ritmo', '[]')) c
      cross join jsonb_array_elements(c->'abaixo') a
      left join tecnico t on t.id = (a->>'tecnico_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'RITMO:' || (a->>'tecnico_id') || ':' || v_hoje || ':' || (u.c->>'corte')
        from (select e.c from jsonb_array_elements(coalesce(v_c->'ritmo', '[]'))
                         with ordinality e(c, i)
               order by e.i desc limit 1) u
        cross join jsonb_array_elements(u.c->'abaixo') a);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'QUEBROU:' || (q->>'tecnico_id') || ':' || v_hoje || ':' || (q->>'quebradas'), v_hoje, 'QUEBROU',
           'Contrato quebrado: ' || (q->>'nome'),
           (q->>'quebradas') || ' quebrado(s) hoje · −' || (q->>'pontos_perdidos') || ' pts',
           (q->>'tecnico_id')::uuid, t.equipe_id
      from jsonb_array_elements(coalesce(v_c->'quebrou', '[]')) q
      left join tecnico t on t.id = (q->>'tecnico_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'QUEBROU:' || (q->>'tecnico_id') || ':' || v_hoje || ':' || (q->>'quebradas')
        from jsonb_array_elements(coalesce(v_c->'quebrou', '[]')) q);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'CERCA:' || ev.id, v_hoje, 'CERCA',
           case ev.tipo when 'SAIU' then 'Saiu ' else 'Entrou ' end
             || case ce.tipo when 'GARAGEM' then 'da garagem ' else 'da área ' end
             || '"' || ce.nome || '": ' || coalesce(t.nome, 'técnico'),
           to_char(ev.em at time zone 'America/Manaus', 'HH24:MI'),
           ev.tecnico_id, ev.equipe_id
      from cerca_evento ev
      join cerca ce on ce.id = ev.cerca_id
      left join tecnico t on t.id = ev.tecnico_id
     where ev.empresa_id = v_emp and ev.alerta and ev.em >= v_ini
       and ((select ve_cidade_inteira()) or ev.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'CERCA:' || ev.id from cerca_evento ev
        join cerca_estado st on st.tecnico_id = ev.tecnico_id and st.cerca_id = ev.cerca_id
       where ev.empresa_id = v_emp and ev.alerta and ev.em >= v_ini
         and st.dentro = (ev.tipo = 'ENTROU') and st.desde = ev.em);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'GPS:' || ga.id, v_hoje, 'GPS',
           case ga.tipo
             when 'SIMULADO' then 'Localização simulada: '
             when 'DESLIGADO' then 'GPS desligado: '
             when 'SEM_PERMISSAO' then 'Localização negada: '
             when 'SALTO' then 'Salto de posição: '
             else 'Aparelho modificado: ' end || coalesce(t.nome, 'técnico'),
           concat_ws(' · ', to_char(ga.em at time zone 'America/Manaus', 'HH24:MI'), ga.detalhe),
           ga.tecnico_id, ga.equipe_id
      from gps_alerta ga
      left join tecnico t on t.id = ga.tecnico_id
     where ga.empresa_id = v_emp and ga.em >= v_ini and ga.tipo <> 'NORMALIZADO'
       and ((select ve_cidade_inteira()) or ga.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'GPS:' || ga.id from gps_alerta ga
        left join tecnico_gps g on g.tecnico_id = ga.tecnico_id
       where ga.empresa_id = v_emp and ga.em >= v_ini and ga.tipo <> 'NORMALIZADO'
         and (ga.tipo in ('SALTO', 'APARELHO_MODIFICADO')
              or (g.estado = ga.tipo and g.desde = ga.em)));
  end if;

  if v_c ? 'material' then
    -- 155c: o tecnico vai junto -- e dele que o gatilho tira a cidade.
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id)
    select v_emp, 'MATERIAL:' || (m->>'id'), v_hoje, 'MATERIAL',
           case m->>'tipo' when 'FALTANDO' then 'Faltando: ' else 'Com defeito: ' end || coalesce(m->>'item', '—'),
           m->>'tecnico', sm.tecnico_id
      from jsonb_array_elements(v_c->'material') m
      left join sinalizacao_material sm on sm.id = (m->>'id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'MATERIAL:' || (m->>'id') from jsonb_array_elements(v_c->'material') m);
  end if;

  if v_c ? 'abastecimento' then
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, base_id)
    select v_emp, 'ABAST:' || (a->>'id'), v_hoje, 'ABASTECIMENTO',
           'Abastecimento pedido: ' || (a->>'placa'),
           concat_ws(' · ', a->>'tecnico', 'R$ ' || (a->>'valor')),
           ab.tecnico_id, coalesce(t.base_id, ve.base_id)
      from jsonb_array_elements(v_c->'abastecimento') a
      left join abastecimento ab on ab.id = (a->>'id')::uuid
      left join tecnico t on t.id = ab.tecnico_id
      left join veiculo ve on ve.id = ab.veiculo_id
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'ABAST:' || (a->>'id') from jsonb_array_elements(v_c->'abastecimento') a);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'tipo', s.tipo, 'titulo', s.titulo, 'detalhe', s.detalhe,
           'visita_id', s.visita_id, 'tecnico_id', s.tecnico_id, 'criado_em', s.criado_em,
           'equipe', eq.codigo, 'contrato', vv.contrato, 'contratos', qb.lista,
           'vigente', s.chave = any(v_vigentes)
                       or (s.tipo = 'DOIS_ATIVOS' and outros_ativos(s.visita_id) is not null),
           'dispensado', d.sinal_id is not null) order by s.criado_em desc), '[]'::jsonb)
    into v_sinais
    from sinal s
    left join sinal_dispensa d on d.sinal_id = s.id and d.usuario_id = auth.uid()
    -- 160a: equipe, contrato e (no quebrado) os contratos do tecnico hoje.
    left join equipe eq on eq.id = s.equipe_id
    left join visita vv on vv.id = s.visita_id
    left join lateral (
      select jsonb_agg(jsonb_build_object('visita_id', v2.id, 'contrato', v2.contrato)
                       order by v2.janela_inicio nulls last) as lista
        from visita v2
        left join tipo_atividade ta2 on ta2.id = v2.tipo_atividade_id
       where s.tipo = 'QUEBROU'
         and v2.tecnico_responsavel_id = s.tecnico_id
         and v2.data_agendada = s.dia
         and v2.excluido_em is null
         and coalesce(ta2.natureza, 'PRODUTIVA') <> 'JORNADA'
         and exists (select 1 from ordem_servico o
                       join codigo_baixa c on c.id = o.codigo_baixa_id
                      where o.visita_id = v2.id and c.natureza = 'IMPRODUTIVA')
    ) qb on true
   where s.empresa_id = v_emp and s.dia = v_hoje
     -- 155c: a CIDADE ATIVA manda. Sinal sem cidade nao existe mais (o
     -- gatilho da 155b carimba), mas se um dia aparecer, ele some da
     -- tela de todo mundo em vez de aparecer para todo mundo: sinal que
     -- nao sabe de onde e nao deve tocar em cidade nenhuma.
     and s.base_id in (select bases_visiveis())
     and case
           when s.tipo in ('AJUDA','TEC1','RITMO','QUEBROU','CERCA','GPS','DOIS_ATIVOS','SUMIU_TOA','LOCAL','ATRASO','TEC1_RISCO','RESUMO')
             then v_gestao and ((select ve_cidade_inteira()) or s.equipe_id in (select equipes_visiveis()))
           when s.tipo = 'MATERIAL' then tem_permissao('almoxarifado.ver')
           when s.tipo = 'ABASTECIMENTO' then tem_permissao('frota.ver')
           else false
         end;

  return jsonb_build_object('central', v_c, 'sinais', v_sinais);
end;
$function$;

notify pgrst, 'reload schema';
