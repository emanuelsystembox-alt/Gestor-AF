-- 178 · Avisos operacionais: importação que não chegou, bucket sem computador,
--       sessão do TOA que caiu e execução longa
--
-- O QUE RESOLVE
--   Quatro coisas que hoje só se descobrem quando alguém abre a tela certa:
--     1. a planilha do TOA parou de chegar (o painel mostra a rota de horas atrás
--        e ninguém sabe);
--     2. nenhum computador está com a vez de um bucket (fechou o Chrome, caiu a
--        luz, desmarcou);
--     3. a sessão do TOA caiu no computador que sincroniza (só a extensão sabia);
--     4. o técnico está há muito mais tempo que o normal num contrato.
--   "Técnico parado: medir no histórico antes e trazer o número para
--    aprovação" — pacote de 02/11 (D-262).
--
-- DE ONDE VEM CADA NÚMERO (medido em 02/11, só leitura)
--   1. Intervalo entre importações com sucesso, 07h–20h, por bucket:
--        MAN-AFLINE        p50 44 · p75 60 · p90 68 · p95 102 min (152 intervalos)
--        MAN-AFLINE_01_VT  p50 48 · p75 60 · p90 61 · p95  75 min (129)
--        SLS-AFLINE_02_VT  p50 30 · p75 60 · p90 67 · p95 109 min (35)
--      O ritmo em uso é 60 min. Limiar 120 (2 × o ritmo): simulado de 5 em 5
--      min, 08h–18h, desde 22/10 — 24 episódios em 28 bucket-dias (90 min daria
--      43). Cada um foi uma falha de verdade (ERRO, Chrome fechado, 5 h sem
--      planilha em 29/10 e 31/10).
--      "Bucket em uso" = ativo, com importação aplicada nos últimos 7 dias (do
--      dado: hoje são MAN-AFLINE, MAN-AFLINE_01_VT e SLS-AFLINE_02_VT; o ADM
--      só tem rodada vazia e não conta).
--   2. Sem histórico do pulso (a vez guarda só o último). 10 min = a regra da
--      167 (3 min) + duas voltas do relógio dos sinais. Só para bucket que um
--      computador importou nos últimos 7 dias — quem importa à mão não toca.
--   3. A extensão grava `toa_sessao = 'CAIU'` quando o TOA não devolve a
--      planilha (rodada SEM_SESSAO) e só volta a OK na próxima baixa que dá
--      certo. Só avisa com o computador vivo; parado, quem fala é o 2.
--   4. Execução longa — PRECISA DA APROVAÇÃO DO EMANUEL, nasce DESLIGADA.
--      O rastro não serve: 688 pontos, 8 técnicos, 18 técnico-dias em 13 dias.
--      A régua é a "Duração" do próprio TOA (concluídos, 30 dias, por grupo),
--      como na 176. Percentil 90: adesão 116 · VT 86 · serviço 99 · migração
--      GPON 139 · mudança de endereço 111 · retorno 87 · reinstalação 91 min.
--      O que é "em execução há X" só vale CONFIRMADO: a última planilha que
--      ainda trazia o contrato INICIADO tem de ser posterior a início + limite.
--      Sem isso, a planilha de hora em hora fazia 53 avisos falsos por dia em
--      Manaus (o contrato já tinha acabado no TOA e a planilha ainda não tinha
--      chegado). Confirmado, desde 22/10: Manaus p90 = 10,3 por dia, p95 = 5,1
--      (de 210 contratos/dia); São Luís < 1. No aviso a p90, metade dos
--      contratos ainda durou mais 20 min (p75 36, p90 76).
--      O início é o do TOA quando o TOA diz INICIADO (D-227); senão, o do campo,
--      e só quando foi gente que mudou a situação (`bloqueado_em`, D-224).
--
-- ONDE MORA
--   Nos sinais do sino (`sinais_do_dia`, D-263): pelo relógio a cada 5 min e
--   para quem tem a tela aberta. `alertas_do_sincronismo()` e
--   `execucao_longa()` devolvem a lista; a gestão pode chamá-las direto para
--   conferir antes de ligar.
--   `rodar_por_cidade('sinais_do_dia')` passa a rodar também a cidade com
--   bucket em uso e NENHUM contrato hoje: é justamente o dia em que a planilha
--   não chegou.

-- ─── parâmetros ──────────────────────────────────────────────────────────
insert into parametro (empresa_id, chave, valor, descricao)
select e.id, p.chave, p.valor, p.descricao
  from empresa e
  cross join (values
    ('sincronismo_alerta',
     '{"sem_importacao_min": 120, "sem_computador_min": 10, "de": "08:00", "ate": "18:00"}'::jsonb,
     'Avisos do sincronismo no sino (178): bucket em uso sem importacao com sucesso ha mais de sem_importacao_min; sem computador com a vez ha mais de sem_computador_min; so entre de e ate (Manaus). 120 = 2 x o ritmo em uso, medido em 02/11.'),
    ('execucao_longa',
     '{"ligado": false, "percentil": 90}'::jsonb,
     'Execucao longa (178): contrato em execucao, confirmado pela planilha, alem do percentil da Duracao do TOA do grupo (30 dias). DESLIGADO ate a aprovacao do Emanuel. Medido em 02/11: p90 = ~10 avisos/dia em Manaus, p95 = ~5.')
  ) as p(chave, valor, descricao)
on conflict (empresa_id, chave) do nothing;

-- ─── tipos de sinal ──────────────────────────────────────────────────────
alter table sinal drop constraint sinal_tipo_check;
alter table sinal add constraint sinal_tipo_check check (tipo = any (array[
  'AJUDA', 'TEC1', 'RITMO', 'QUEBROU', 'MATERIAL', 'ABASTECIMENTO', 'CERCA', 'GPS',
  'DOIS_ATIVOS', 'SUMIU_TOA', 'LOCAL', 'ATRASO', 'TEC1_RISCO', 'RESUMO',
  'SEM_IMPORTACAO', 'SEM_COMPUTADOR', 'TOA_SESSAO', 'EXECUCAO_LONGA']));

/* "8 min", "2h15": o tempo como o sino escreve. */
create or replace function public.texto_duracao(p interval)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p is null then null
              when p < interval '1 hour' then floor(extract(epoch from p) / 60)::int || ' min'
              else to_char(p, 'FMHH24"h"MI') end;
$$;
revoke all on function public.texto_duracao(interval) from public, anon;
grant execute on function public.texto_duracao(interval) to authenticated;

/*
 * Os três avisos do sincronismo, da cidade ativa, agora. Fora da janela do
 * parâmetro, nada. Cada chave leva o dia e o instante do último sucesso: se
 * volta a acontecer depois de normalizar, é aviso novo (D-169).
 */
create or replace function public.alertas_do_sincronismo()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp   uuid := (select minha_empresa());
  v_hoje  date := hoje_local();
  v_ini   timestamptz := (hoje_local()::timestamp at time zone 'America/Manaus');
  v_cfg   jsonb := coalesce(parametro_valor('sincronismo_alerta'), '{}'::jsonb);
  v_lim   int  := coalesce((v_cfg->>'sem_importacao_min')::int, 120);
  v_pc    int  := coalesce((v_cfg->>'sem_computador_min')::int, 10);
  v_de    time := coalesce((v_cfg->>'de')::time, time '08:00');
  v_ate   time := coalesce((v_cfg->>'ate')::time, time '18:00');
  v_agora time := (now() at time zone 'America/Manaus')::time;
  v_out   jsonb;
begin
  if not eh_gestao() then
    raise exception 'Os avisos do sincronismo são da gestão.' using errcode = '42501';
  end if;
  if v_agora < v_de or v_agora >= v_ate then
    return '[]'::jsonb;
  end if;

  with uso as materialized (
    select t.id, t.nome, t.base_id
      from toa_bucket t
     where t.empresa_id = v_emp and t.ativo
       and t.base_id in (select bases_visiveis())
       and exists (select 1 from importacao i
                    where i.empresa_id = v_emp and i.base_id = t.base_id and i.bucket = t.nome
                      and i.status = 'APLICADA' and i.criado_em >= v_ini - interval '7 days')
  ),
  -- 1. importação que não chegou
  a as (
    select u.id, u.nome, u.base_id, ok.em as ultima,
           coalesce(ok.em, (v_hoje + v_de) at time zone 'America/Manaus') as ref,
           fa.terminada_em as falha_em, fa.resultado as falha, fa.mensagem
      from uso u
      left join lateral (
        select max(z.em) as em from (
          select coalesce(i.aplicado_em, i.criado_em) as em from importacao i
           where i.empresa_id = v_emp and i.base_id = u.base_id and i.bucket = u.nome
             and i.status = 'APLICADA' and i.criado_em >= v_ini
          union all
          select r.terminada_em from sincronismo_rodada r
           where r.bucket_id = u.id and r.dia = v_hoje
             and r.resultado in ('IMPORTADA', 'SEM_MUDANCA')) z) ok on true
      left join lateral (
        select r.terminada_em, r.resultado, r.mensagem from sincronismo_rodada r
         where r.bucket_id = u.id and r.dia = v_hoje and r.resultado in ('ERRO', 'SEM_SESSAO')
         order by r.terminada_em desc limit 1) fa on true
  ),
  -- 2. bucket que um computador sincroniza, sem computador com a vez
  b as (
    select u.id, u.nome, u.base_id, vz.bucket_id is not null as tinha, vz.visto_em, pe.nome as quem
      from uso u
      left join sincronismo_bucket_vez vz on vz.bucket_id = u.id
      left join perfil pe on pe.id = vz.executor_id
     where exists (select 1 from sincronismo_rodada r
                    where r.bucket_id = u.id and r.resultado = 'IMPORTADA'
                      and r.terminada_em >= v_ini - interval '7 days')
       and (vz.bucket_id is null or vz.visto_em < now() - make_interval(mins => v_pc))
  ),
  -- 3. computador vivo com a sessão do TOA caída
  c as (
    select vz.executor_id, vz.maquina, vz.base_id, pe.nome as quem,
           string_agg(t.nome, ', ' order by t.nome) as buckets
      from sincronismo_bucket_vez vz
      join toa_bucket t on t.id = vz.bucket_id
      left join perfil pe on pe.id = vz.executor_id
     where vz.empresa_id = v_emp and vz.toa_sessao = 'CAIU'
       and vz.visto_em >= now() - make_interval(mins => v_pc)
       and vz.base_id in (select bases_visiveis())
     group by 1, 2, 3, 4
  ),
  c2 as (
    select c.*, ok.em as ok_em,
           (select min(r.terminada_em) from sincronismo_rodada r
             where r.executor_id = c.executor_id and r.dia = v_hoje and r.resultado = 'SEM_SESSAO'
               and r.terminada_em > coalesce(ok.em, '-infinity')) as desde
      from c
      left join lateral (
        select max(r.terminada_em) as em from sincronismo_rodada r
         where r.executor_id = c.executor_id and r.dia = v_hoje
           and r.resultado in ('IMPORTADA', 'SEM_MUDANCA')) ok on true
  )
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_out
    from (
      select jsonb_build_object(
               'tipo', 'SEM_IMPORTACAO', 'base_id', a.base_id, 'bucket', a.nome,
               'chave', 'SEMIMP:' || a.id || ':' || v_hoje || ':' || extract(epoch from a.ref)::bigint,
               'titulo', 'Importação atrasada: ' || a.nome,
               'detalhe', concat_ws(' · ',
                 case when a.ultima is null
                      then 'nenhuma hoje desde ' || to_char(v_de, 'HH24:MI')
                      else 'última ' || to_char(a.ultima at time zone 'America/Manaus', 'HH24:MI')
                           || ' (há ' || texto_duracao(now() - a.ultima) || ')' end,
                 case when a.falha_em > a.ref
                      then 'tentativa ' || to_char(a.falha_em at time zone 'America/Manaus', 'HH24:MI') || ': '
                           || case a.falha when 'SEM_SESSAO' then 'TOA deslogou'
                                   else coalesce(left(a.mensagem, 80), 'erro') end end)) as x
        from a
       where now() - a.ref > make_interval(mins => v_lim)
      union all
      select jsonb_build_object(
               'tipo', 'SEM_COMPUTADOR', 'base_id', b.base_id, 'bucket', b.nome,
               'chave', 'SEMPC:' || b.id || ':' || v_hoje || ':'
                        || coalesce(case when b.visto_em >= v_ini then extract(epoch from b.visto_em)::bigint::text end, 'dia'),
               'titulo', 'Sem computador sincronizando: ' || b.nome,
               'detalhe', case when not b.tinha then 'nenhum computador marcou este bucket'
                               else concat_ws(' · ',
                                      'último sinal ' || case when b.visto_em < v_ini then 'antes de hoje'
                                                              else to_char(b.visto_em at time zone 'America/Manaus', 'HH24:MI') end,
                                      b.quem) end)
        from b
      union all
      select jsonb_build_object(
               'tipo', 'TOA_SESSAO', 'base_id', c2.base_id, 'bucket', c2.buckets,
               'chave', 'TOASESSAO:' || c2.executor_id || ':' || c2.maquina || ':' || c2.base_id || ':' || v_hoje
                        || ':' || coalesce(extract(epoch from c2.ok_em)::bigint::text, '0'),
               'titulo', 'Sessão do TOA caiu: ' || coalesce(c2.quem, 'computador'),
               'detalhe', concat_ws(' · ', c2.buckets,
                            case when c2.desde is not null
                                 then 'desde ' || to_char(c2.desde at time zone 'America/Manaus', 'HH24:MI') end,
                            'entrar no TOA de novo nesse computador'))
        from c2
    ) s;

  return v_out;
end;
$$;
revoke all on function public.alertas_do_sincronismo() from public, anon;
grant execute on function public.alertas_do_sincronismo() to authenticated;

/*
 * Execução longa: contrato de hoje em execução há mais que o percentil da
 * "Duração" do TOA para o grupo (30 dias, concluídos), CONFIRMADO — a última
 * planilha que ainda trazia o contrato INICIADO chegou depois de início +
 * limite. Funciona com o parâmetro desligado (é como se confere antes de
 * ligar); o sino só chama com `execucao_longa.ligado`.
 */
create or replace function public.execucao_longa()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoje date := hoje_local();
  v_pct  numeric := coalesce((parametro_valor('execucao_longa')->>'percentil')::numeric, 90) / 100.0;
  v_out  jsonb;
begin
  if not eh_gestao() then
    raise exception 'Execução longa é para a gestão.' using errcode = '42501';
  end if;
  if v_pct <= 0 or v_pct >= 1 then
    raise exception 'execucao_longa.percentil tem de estar entre 1 e 99.' using errcode = '22023';
  end if;

  with ref as materialized (
    select v.tipo_servico_id, grouping(v.tipo_servico_id) = 1 as geral,
           percentile_cont(v_pct) within group (order by minutos_de_hhmm(v.dados_origem->>'Duração')) as lim
      from visita v
     where v.empresa_id = (select minha_empresa()) and v.excluido_em is null
       and v.data_agendada between v_hoje - 30 and v_hoje - 1
       and norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) = 'CONCLUIDO'
       and minutos_de_hhmm(v.dados_origem->>'Duração') > 0
     group by rollup (v.tipo_servico_id)
  ),
  abertos as materialized (
    select v.id, v.contrato, v.tecnico_responsavel_id, v.equipe_id, v.tipo_servico_id,
           ts.nome as grupo,
           norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) = 'INICIADO' and v.inicio is not null as pelo_toa,
           v.inicio, v.situacao_em, v.bloqueado_em
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join tipo_servico ts on ts.id = v.tipo_servico_id
     where v.empresa_id = (select minha_empresa()) and v.excluido_em is null
       and v.data_agendada = v_hoje
       and v.situacao = 'EM_EXECUCAO'
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
  ),
  medidos as (
    select a.*,
           -- D-227: com INICIADO, o início do TOA é real. Sem ele, só vale a
           -- hora do campo quando foi gente que mudou a situação (D-224).
           case when a.pelo_toa then a.inicio
                when a.bloqueado_em is not null then a.situacao_em end as ini,
           case when a.pelo_toa then
                  (select max(coalesce(i.aplicado_em, i.criado_em))
                     from importacao_linha il join importacao i on i.id = il.importacao_id
                    where il.visita_id = a.id and i.status = 'APLICADA')
                when a.bloqueado_em is not null then now() end as visto,
           coalesce(r.lim, g.lim) as lim
      from abertos a
      left join ref r on not r.geral and r.tipo_servico_id = a.tipo_servico_id
      left join ref g on g.geral
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'visita_id', m.id, 'contrato', m.contrato,
           'tecnico_id', m.tecnico_responsavel_id, 'tecnico', t.nome,
           'equipe_id', m.equipe_id, 'equipe', e.codigo, 'grupo', m.grupo,
           'inicio', m.ini, 'visto_em', m.visto,
           'fonte', case when m.pelo_toa then 'TOA' else 'CAMPO' end,
           'minutos', round(extract(epoch from now() - m.ini) / 60),
           'limite_min', round(m.lim))
         order by m.ini), '[]'::jsonb)
    into v_out
    from medidos m
    left join tecnico t on t.id = m.tecnico_responsavel_id
    left join equipe e on e.id = m.equipe_id
   where m.ini is not null and m.visto is not null and m.lim is not null
     and m.visto > m.ini + make_interval(mins => round(m.lim)::int);

  return v_out;
end;
$$;
revoke all on function public.execucao_longa() from public, anon;
grant execute on function public.execucao_longa() to authenticated;

/*
 * A porta do relógio (177) roda os sinais também na cidade com bucket em uso
 * e nenhum contrato hoje: é o dia em que a planilha não chegou. O resumo das
 * 18h continua só onde há contrato.
 */
CREATE OR REPLACE FUNCTION public.rodar_por_cidade(p_funcao text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
revoke all on function public.rodar_por_cidade(text) from public, anon, authenticated;

-- sinais_do_dia: a do banco depois da 177, com os quatro avisos novos.
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
  v_sinc text[];
  v_longa text[];
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

    -- 178: o sincronismo — importação que não chegou, bucket sem computador,
    -- sessão do TOA caída. Sem equipe: a cidade vem do bucket.
    with al as materialized (
      select x from jsonb_array_elements(alertas_do_sincronismo()) x
    ), ins as (
      insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, base_id)
      select v_emp, x->>'chave', v_hoje, x->>'tipo', x->>'titulo', x->>'detalhe', (x->>'base_id')::uuid
        from al
      on conflict (empresa_id, chave) do nothing
      returning 1
    )
    select coalesce(array_agg(x->>'chave'), '{}') into v_sinc from al;
    v_vigentes := v_vigentes || v_sinc;

    -- 178: execução longa — só com o parâmetro ligado (aprovação do Emanuel).
    if coalesce((parametro_valor('execucao_longa')->>'ligado')::boolean, false) then
      with el as materialized (
        select x from jsonb_array_elements(execucao_longa()) x
      ), ins as (
        insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
        select v_emp, 'LONGA:' || (x->>'visita_id'), v_hoje, 'EXECUCAO_LONGA',
               'Execução longa: ' || coalesce(x->>'tecnico', 'equipe ' || (x->>'equipe'), 'sem técnico'),
               concat_ws(' · ',
                 case when x->>'contrato' is not null then 'contrato ' || (x->>'contrato') end,
                 x->>'grupo',
                 'há ' || texto_duracao(make_interval(mins => (x->>'minutos')::int)),
                 'normal até ' || texto_duracao(make_interval(mins => (x->>'limite_min')::int))),
               (x->>'visita_id')::uuid, (x->>'tecnico_id')::uuid, (x->>'equipe_id')::uuid
          from el
        on conflict (empresa_id, chave) do nothing
        returning 1
      )
      select coalesce(array_agg('LONGA:' || (x->>'visita_id')), '{}') into v_longa from el;
      v_vigentes := v_vigentes || v_longa;
    end if;
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
           when s.tipo in ('AJUDA','TEC1','RITMO','QUEBROU','CERCA','GPS','DOIS_ATIVOS','SUMIU_TOA','LOCAL','ATRASO','TEC1_RISCO','RESUMO',
                         'SEM_IMPORTACAO','SEM_COMPUTADOR','TOA_SESSAO','EXECUCAO_LONGA')
             then v_gestao and ((select ve_cidade_inteira()) or s.equipe_id in (select equipes_visiveis()))
           when s.tipo = 'MATERIAL' then tem_permissao('almoxarifado.ver')
           when s.tipo = 'ABASTECIMENTO' then tem_permissao('frota.ver')
           else false
         end;

  return jsonb_build_object('central', v_c, 'sinais', v_sinais);
end;
$function$;

revoke all on function public.sinais_do_dia() from public, anon;
grant execute on function public.sinais_do_dia() to authenticated;

notify pgrst, 'reload schema';
