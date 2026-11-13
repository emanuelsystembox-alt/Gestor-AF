-- 260 · Previsão do fechamento do dia e a caixa-preta (D-377 — era D-374, renumerada) — fase 1 do pacote preditivo
--
-- > "quero deixar esse sistema ultra inteligente (...) mais preditivo" — Emanuel, 12/11.
-- > Das ideias propostas, ele aprovou as 4 fases na ordem; a 1ª é a caixa-preta + o
-- > fechamento do dia às 10h. A caixa-preta a cada 30 min, das 06h às 21h (escolha dele).
--
-- PREVISÃO (`previsao_do_dia`): o painel diz como o dia ESTÁ; isto diz como ele vai TERMINAR.
-- Nenhuma regra nova — é a soma de duas coisas que já existem:
--   · o TEC1 REAL do que o TOA já encerrou hoje (`tec1_da_os`, o livro da CLARO, D-187);
--   · o TEC1 PREVISTO do que falta, pela fila de cada técnico (`fila_do_dia`, 176, D-264):
--     a O.S. que conta no TEC1 e cujo contrato a fila prevê "vai estourar", "perdido" ou
--     começado depois da janela vira SEM PADRÃO; o resto, COM PADRÃO.
-- E o que não cabe: contrato aberto cuja previsão de fim passa do fim da jornada
-- (`ritmo_jornada`, 18:00, aprovado em 27/09 — D-167).
-- "Salvar" = quantas O.S. previstas SEM PADRÃO precisam virar COM PADRÃO para o fechamento
-- chegar à meta de 94% (a do livro). O que a previsão não sabe ela não inventa: cancelamento e
-- reagendamento que ainda vão acontecer não entram (o TEC1 deles se decide no fechamento).
--
-- CAIXA-PRETA (`foto_do_dia`): sem guardar o que se previu a cada hora, não há como saber se a
-- previsão presta — foi o que travou a conferência do TEC1 em risco em 02/11 (D-264). A foto é
-- tirada pelo relógio (pg_cron, a cada 30 min, 06h–21h de Manaus) pela porta única
-- `rodar_por_cidade` (D-263), como o ADMIN mais antigo com a cidade no cabeçalho. Guarda os
-- números e só os IDs das visitas apontadas — nenhum dado de assinante.
--
-- ACERTO (`acerto_da_previsao`): para cada dia já fechado, a primeira foto a partir das 10h
-- contra o TEC1 real do fechamento, e contrato a contrato: dos apontados como "vai estourar",
-- quantos estouraram; dos que estouraram depois da foto, quantos tinham sido apontados.

-- ─────────────────────────────────────────────────────────────── a caixa-preta ──
create table if not exists public.foto_do_dia (
  id         bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresa(id),
  base_id    uuid not null references public.base(id),
  dia        date not null,
  tirada_em  timestamptz not null default now(),
  dados      jsonb not null
);
create index if not exists foto_do_dia_base_dia on public.foto_do_dia (base_id, dia, tirada_em);
alter table public.foto_do_dia enable row level security;

drop policy if exists foto_do_dia_leitura on public.foto_do_dia;
create policy foto_do_dia_leitura on public.foto_do_dia for select to authenticated
  using (empresa_id = (select minha_empresa())
         and base_id in (select bases_visiveis())
         and (select eh_gestao()));
-- Ninguém grava pela API: só `tirar_foto_do_dia`, pelo relógio.
revoke all on public.foto_do_dia from anon;
revoke insert, update, delete on public.foto_do_dia from authenticated;
grant select on public.foto_do_dia to authenticated;

-- ─────────────────────────────────────────────────────────────── a previsão ──
create or replace function public.previsao_do_dia()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_hoje date := hoje_local();
  v_meta numeric := 94;
  v_fim_jornada time := coalesce((parametro_valor('ritmo_jornada') ->> 'fim')::time, time '18:00');
  v_limite timestamptz;
  v_out jsonb;
begin
  if not eh_gestao() then
    raise exception 'A previsão do dia é para a gestão.' using errcode = '42501';
  end if;
  v_limite := (v_hoje + v_fim_jornada) at time zone 'America/Manaus';

  with fila as materialized (
    select f.*,
           -- A previsão do TEC1 do contrato: a régua da fila (D-264) traduzida no livro.
           case when f.nivel in ('PERDIDO', 'VAI_ESTOURAR')
                  or (f.comecou and f.prazo_chegada is not null and f.previsto_inicio > f.prazo_chegada)
                then 'SEM_PADRAO' else 'PADRAO' end as prev
      from fila_do_dia() f
  ),
  -- as O.S. de hoje no alcance de quem pergunta (o mesmo de `fila_do_dia`)
  os_hoje as materialized (
    select v.id as visita_id, o.id as os_id, tec1_da_os(o.id) as real,
           v.dados_origem ->> 'Intervalo de Tempo' as intervalo, v.janela_inicio, v.janela_fim,
           t.descricao as tipo_os
      from visita v
      join ordem_servico o on o.visita_id = v.id
      left join tipo_os t on t.id = o.tipo_os_id
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.empresa_id = (select minha_empresa()) and v.excluido_em is null
       and v.data_agendada = v_hoje
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
  ),
  -- o que falta: as O.S. que contam no TEC1, de contrato que está na fila
  prev_os as materialized (
    select f.visita_id, f.prev
      from fila f join os_hoje o on o.visita_id = f.visita_id
     where o.real is null and f.prazo_chegada is not null
       and tec1_janela_conta(o.intervalo, o.janela_inicio, o.janela_fim, o.tipo_os)
  ),
  n as (
    select (select count(*) from os_hoje where real = 'PADRAO')::int as real_p,
           (select count(*) from os_hoje where real = 'SEM_PADRAO')::int as real_s,
           (select count(*) from prev_os where prev = 'PADRAO')::int as prev_p,
           (select count(*) from prev_os where prev = 'SEM_PADRAO')::int as prev_s
  ),
  -- contrato que conta no TEC1 e que a previsão aponta, ou que está com a folga curta
  decidem as (
    select f.*, (select count(*) from prev_os p where p.visita_id = f.visita_id)::int as n_os
      from fila f
     where f.prazo_chegada is not null
       and exists (select 1 from prev_os p where p.visita_id = f.visita_id)
       and (f.prev = 'SEM_PADRAO' or f.nivel = 'EM_RISCO')
  ),
  -- por técnico (sem técnico, a equipe): quando a fila acaba
  por_fila as (
    select f.fila, max(f.tecnico) as tecnico, max(f.equipe) as equipe,
           count(*)::int as abertos,
           count(*) filter (where f.previsto_fim > v_limite)::int as depois,
           max(f.previsto_fim) as fim_previsto,
           jsonb_agg(jsonb_build_object('visita_id', f.visita_id, 'contrato', f.contrato,
                       'grupo', f.grupo, 'previsto_fim', f.previsto_fim,
                       'janela', to_char(f.janela_inicio, 'HH24:MI') || '–' || to_char(f.janela_fim, 'HH24:MI'))
                     order by f.ordem) filter (where f.previsto_fim > v_limite) as itens
      from fila f group by f.fila
  )
  select jsonb_build_object(
    'dia', v_hoje,
    'agora', now(),
    'cidade', (select b.nome from base b where b.id in (select bases_visiveis()) order by b.nome limit 1),
    'meta', v_meta,
    'fim_jornada', to_char(v_fim_jornada, 'HH24:MI'),
    'tec1', (select jsonb_build_object(
               'real_padrao', real_p, 'real_sem', real_s,
               'prev_padrao', prev_p, 'prev_sem', prev_s,
               'real_pct', case when real_p + real_s > 0 then round(real_p * 100.0 / (real_p + real_s), 1) end,
               'previsto_pct', case when real_p + real_s + prev_p + prev_s > 0
                                    then round((real_p + prev_p) * 100.0 / (real_p + real_s + prev_p + prev_s), 1) end,
               'salvar', greatest(0, ceil(v_meta / 100 * (real_p + real_s + prev_p + prev_s)) - (real_p + prev_p))::int)
             from n),
    'abertos', (select count(*) from fila),
    'sem_fila', (select count(distinct o.visita_id) from os_hoje o
                  where o.real is null and not exists (select 1 from fila f where f.visita_id = o.visita_id)
                    and exists (select 1 from visita v where v.id = o.visita_id
                                  and v.situacao <> all (situacoes_terminais())
                                  and norm_txt(coalesce(v.dados_origem->>'Status da Atividade',''))
                                        not in ('CONCLUIDO', 'NAO CONCLUIDO', 'CANCELADO'))),
    'fim_operacao', (select max(previsto_fim) from fila),
    'nao_cabem', (select count(*) from fila where previsto_fim > v_limite),
    'decidem', coalesce((select jsonb_agg(jsonb_build_object(
          'visita_id', d.visita_id, 'contrato', d.contrato, 'grupo', d.grupo,
          'equipe', d.equipe, 'tecnico', d.tecnico, 'situacao', d.situacao, 'comecou', d.comecou,
          'prev', d.prev, 'nivel', d.nivel, 'n_os', d.n_os, 'na_frente', d.na_frente,
          'janela', to_char(d.janela_inicio, 'HH24:MI') || '–' || to_char(d.janela_fim, 'HH24:MI'),
          'prazo_chegada', d.prazo_chegada, 'prazo_fim', d.prazo_fim,
          'previsto_chegada', d.previsto_chegada, 'previsto_fim', d.previsto_fim,
          'folga_min', d.folga_min,
          -- dá para salvar: ainda não passou do fim da janela sem começar, nem começou tarde
          'salvavel', d.nivel is distinct from 'PERDIDO' and not (d.comecou and d.previsto_inicio > d.prazo_chegada))
          -- primeiro os que dá para salvar com menos esforço (folga negativa pequena), depois o risco
          order by (d.prev = 'SEM_PADRAO') desc,
                   (d.nivel is distinct from 'PERDIDO' and not (d.comecou and d.previsto_inicio > d.prazo_chegada)) desc,
                   d.folga_min desc nulls last, d.prazo_chegada)
        from decidem d), '[]'::jsonb),
    'filas', coalesce((select jsonb_agg(jsonb_build_object(
          'fila', p.fila, 'tecnico', p.tecnico, 'equipe', p.equipe, 'abertos', p.abertos,
          'depois', p.depois, 'fim_previsto', p.fim_previsto, 'itens', coalesce(p.itens, '[]'::jsonb))
          order by p.fim_previsto desc nulls last)
        from por_fila p), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $$;

revoke all on function public.previsao_do_dia() from public, anon;
grant execute on function public.previsao_do_dia() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────── tirar a foto ──
create or replace function public.tirar_foto_do_dia()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_base uuid;
  p jsonb;
begin
  -- Só pelo relógio: `rodar_por_cidade` põe a cidade no cabeçalho, e ela é a única visível.
  if current_setting('app.pelo_relogio', true) is distinct from '1' then
    raise exception 'A foto do dia é tirada pelo relógio.' using errcode = '42501';
  end if;
  select b into v_base from bases_visiveis() b limit 1;
  if v_base is null then return; end if;

  p := previsao_do_dia();
  insert into foto_do_dia (empresa_id, base_id, dia, dados)
  values (minha_empresa(), v_base, (p ->> 'dia')::date, jsonb_build_object(
    'tec1', p -> 'tec1',
    'abertos', p -> 'abertos',
    'sem_fila', p -> 'sem_fila',
    'nao_cabem', p -> 'nao_cabem',
    'fim_operacao', p -> 'fim_operacao',
    -- só os IDs: o contrato apontado, para conferir depois um a um
    'sem', coalesce((select jsonb_agg(d -> 'visita_id') from jsonb_array_elements(p -> 'decidem') d
                      where d ->> 'prev' = 'SEM_PADRAO'), '[]'::jsonb),
    'risco', coalesce((select jsonb_agg(d -> 'visita_id') from jsonb_array_elements(p -> 'decidem') d
                        where d ->> 'prev' = 'PADRAO'), '[]'::jsonb)));
end $$;

revoke all on function public.tirar_foto_do_dia() from public, anon, authenticated;

-- a porta única do relógio passa a conhecer a foto (o resto da função, como estava)
create or replace function public.rodar_por_cidade(p_funcao text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
  n integer := 0;
begin
  if p_funcao not in ('sinais_do_dia', 'gerar_resumo_do_dia', 'recalcular_risco_quebra',
                      'tirar_foto_do_dia') then
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
       and (exists (select 1 from visita v
                     where v.base_id = b.id and v.data_agendada = hoje_local()
                       and v.excluido_em is null)
            -- 178: bucket em uso (importação nos últimos 7 dias) também conta.
            or (p_funcao = 'sinais_do_dia'
                and exists (select 1 from importacao i
                             where i.base_id = b.id and i.status = 'APLICADA'
                               and i.criado_em >= now() - interval '7 days')))
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
$function$;

-- 06h–21h30 de Manaus = 10h–01h30 UTC, a cada 30 min
select cron.unschedule('foto-do-dia') where exists (select 1 from cron.job where jobname = 'foto-do-dia');
select cron.schedule('foto-do-dia', '*/30 10-23,0,1 * * *',
                     $$select public.rodar_por_cidade('tirar_foto_do_dia')$$);

-- ───────────────────────────────────────────────────────── a previsão acerta? ──
create or replace function public.acerto_da_previsao(p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_hoje date := hoje_local();
  v_de date := coalesce(p_de, hoje_local() - 14);
  v_ate date := least(coalesce(p_ate, hoje_local() - 1), hoje_local() - 1);
  v_base uuid;
begin
  if not eh_gestao() then
    raise exception 'O acerto da previsão é para a gestão.' using errcode = '42501';
  end if;
  if v_ate - v_de > 92 then v_de := v_ate - 92; end if;
  select b into v_base from bases_visiveis() b limit 1;

  return jsonb_build_object(
    'desde', (select min(dia) from foto_do_dia where base_id = v_base),
    -- hoje: a previsão foto a foto, contra o real até aquela hora
    'hoje', coalesce((select jsonb_agg(jsonb_build_object(
               'hora', to_char(f.tirada_em at time zone 'America/Manaus', 'HH24:MI'),
               'previsto_pct', f.dados -> 'tec1' -> 'previsto_pct',
               'real_pct', f.dados -> 'tec1' -> 'real_pct',
               'nao_cabem', f.dados -> 'nao_cabem') order by f.tirada_em)
             from foto_do_dia f where f.base_id = v_base and f.dia = v_hoje), '[]'::jsonb),
    'dias', coalesce((
      with fotos as (
        select distinct on (f.dia) f.dia, f.tirada_em, f.dados
          from foto_do_dia f
         where f.base_id = v_base and f.dia between v_de and v_ate
           and f.tirada_em >= (f.dia + time '10:00') at time zone 'America/Manaus'
         order by f.dia, f.tirada_em
      ),
      os_dia as materialized (
        select v.data_agendada as dia, v.id as visita_id, v.fim, tec1_da_os(o.id) as real
          from visita v
          join ordem_servico o on o.visita_id = v.id
          left join tipo_atividade ta on ta.id = v.tipo_atividade_id
         where v.empresa_id = (select minha_empresa()) and v.excluido_em is null
           and v.base_id = v_base
           and v.data_agendada in (select dia from fotos)
           and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
           and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
      ),
      real_dia as (
        select dia, count(*) filter (where real = 'PADRAO') as p, count(*) filter (where real = 'SEM_PADRAO') as s
          from os_dia group by dia
      ),
      estourou as (
        select distinct dia, visita_id, fim from os_dia where real = 'SEM_PADRAO'
      )
      select jsonb_agg(jsonb_build_object(
               'dia', f.dia,
               'foto', to_char(f.tirada_em at time zone 'America/Manaus', 'HH24:MI'),
               'previsto_pct', f.dados -> 'tec1' -> 'previsto_pct',
               'real_pct', case when r.p + r.s > 0 then round(r.p * 100.0 / (r.p + r.s), 1) end,
               'apontados', jsonb_array_length(coalesce(f.dados -> 'sem', '[]'::jsonb)),
               'apontados_que_estouraram', (select count(*) from jsonb_array_elements_text(coalesce(f.dados -> 'sem', '[]'::jsonb)) x
                                              where exists (select 1 from estourou e where e.dia = f.dia and e.visita_id = x::uuid)),
               -- estourou e ainda estava aberto na hora da foto (o TOA fechou depois)
               'estouraram_depois', (select count(*) from estourou e
                                      where e.dia = f.dia and (e.fim is null or e.fim > f.tirada_em)),
               'estouraram_depois_apontados', (select count(*) from estourou e
                                      where e.dia = f.dia and (e.fim is null or e.fim > f.tirada_em)
                                        and (f.dados -> 'sem') ? e.visita_id::text))
               order by f.dia desc)
        from fotos f left join real_dia r on r.dia = f.dia), '[]'::jsonb)
  );
end $$;

revoke all on function public.acerto_da_previsao(date, date) from public, anon;
grant execute on function public.acerto_da_previsao(date, date) to authenticated, service_role;

notify pgrst, 'reload schema';
