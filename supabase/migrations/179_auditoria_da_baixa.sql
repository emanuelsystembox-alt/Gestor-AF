-- 179 · Auditoria automática da baixa
--
-- O QUE RESOLVE
--   "Conferir sozinho" — pacote de inteligência aprovado em 02/11 (D-262).
--   Uma FILA só do que é suspeito, com uma NOTA por contrato e os motivos
--   escritos, para a gestão conferir. Nada muda sozinho: a fila acusa, quem
--   opera julga (como o local da baixa, D-170).
--
-- OS CINCO CRITÉRIOS (aprovados) — e de onde vem cada régua
--   LOCAL        baixa longe do endereço. É a `local_da_baixa()` da D-170, com
--                o raio `raio_baixa_m` (200 m): nenhuma conta nova aqui.
--   DURACAO      execução curta demais para o grupo de serviço: "Duração" do
--                TOA abaixo do PERCENTIL 10 do próprio TOA, por grupo, nos 30
--                dias anteriores, só serviço CONCLUÍDO (situação CONCLUIDA e
--                atividade CONCLUIDO). Medido em 02/11 (empresa inteira):
--                ADESAO p10 20 min (1.128), VT 19 (696), SERVICO 15 (385),
--                MIGRACAO GPON 19 (240), MUDANCA DE ENDERECO 14 (156),
--                RETORNO DE CREDENCIADA 13,4 (68); REINSTALACAO tem 16 na
--                amostra — abaixo do mínimo de 20, fica "não avaliado".
--   SERIAL       o mesmo serial INSTALADO neste contrato e instalado (ou já no
--                cliente) em OUTRO contrato — pela varredura do TOA
--                (`visita_equipamento_toa`, D-250) e pelo lançamento do
--                técnico (`equipamento_movimento`). Contrato igual não conta:
--                o "já estava no cliente" da revisita é o normal.
--   EQUIPAMENTO  o que o técnico lançou (`registrar_equipamento`) diferente do
--                que o TOA mostra, só na operação em que ele lançou alguma
--                coisa (instalado × INSTALADO; retirado × DESINSTALADO e o
--                serial substituído).
--   GALERIA      foto vinda da galeria em vez da câmera (`da_galeria`, D-213).
--
-- ZERO E DESCONHECIDO (D-117)
--   Cada critério volta em um de quatro estados: SUSPEITO, OK, NAO_AVALIADO
--   (com o porquê: sem GPS, endereço sem coordenada, sem leitura do TOA, sem
--   régua, sem foto, técnico não lançou) e NAO_SE_APLICA (duração de contrato
--   que não foi concluído). "Não avaliado" nunca vira "ok".
--
-- A NOTA
--   Soma dos pesos dos critérios SUSPEITOS. Os pesos são PROPOSTA (aguardam o
--   Emanuel): SERIAL 40 (impossível físico), LOCAL 30, EQUIPAMENTO 25,
--   DURACAO 20 (o p10 marca 1 em cada 10 por definição: sozinho é fraco),
--   GALERIA 15. Ficam na função, à vista; mudar é migration.
--
-- A RÉGUA GUARDADA (`regua_servico`)
--   A 176 (`tec1_em_risco`) tira a mediana ao vivo, 77 ms de 216 a cada
--   minuto. Aqui ela vira tabela, recalculada por dia às 05h10 de Manaus
--   (pg_cron), por empresa e grupo: p10, p50 e p75 da duração e p50 do
--   deslocamento. A 176 pode passar a ler dela (ver integracao.md da fase).
--
-- QUEM LÊ
--   Gestão, cidade ativa (`bases_visiveis()`), a carteira de quem não vê a
--   cidade inteira. A tabela da régua não tem policy: só as funções leem.

-- ── A régua ────────────────────────────────────────────────────────────────

create table if not exists public.regua_servico (
  empresa_id      uuid not null references empresa(id),
  tipo_servico_id uuid references tipo_servico(id),   -- nulo = todos os grupos
  de              date not null,                      -- janela medida
  ate             date not null,
  calculada_em    timestamptz not null default now(),
  amostra         integer not null,                   -- concluídos com Duração
  dur_p10         numeric,
  dur_p50         numeric,
  dur_p75         numeric,
  desl_p50        numeric,
  desl_amostra    integer not null default 0          -- com deslocamento > 0
);
create unique index if not exists regua_servico_chave on public.regua_servico
  (empresa_id, coalesce(tipo_servico_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.regua_servico enable row level security;
revoke all on table public.regua_servico from anon, authenticated;

/*
 * Refaz a régua de todas as empresas: 30 dias anteriores a hoje (Manaus),
 * só serviço concluído de verdade (situação CONCLUIDA + atividade CONCLUIDO
 * no TOA), sem jornada. Reagendado e cancelado com "CONCLUIDO" no TOA ficam
 * de fora: fechar como improdutivo é rápido por natureza e puxaria a régua
 * para baixo (ADESAO: p50 56 com eles, 60 sem).
 * Só o pg_cron chama (e a própria migration, uma vez).
 */
create or replace function public.recalcular_regua_servico()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := hoje_local();
  n integer;
begin
  delete from regua_servico where empresa_id is not null;

  with base as materialized (
    select v.empresa_id, v.tipo_servico_id,
           minutos_de_hhmm(v.dados_origem->>'Duração') as dur,
           minutos_de_hhmm(v.dados_origem->>'Tempo de Deslocamento') as desl
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.excluido_em is null
       and v.data_agendada between v_hoje - 30 and v_hoje - 1
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       and v.situacao = 'CONCLUIDA'
       and norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) = 'CONCLUIDO'
  )
  insert into regua_servico (empresa_id, tipo_servico_id, de, ate, amostra,
                             dur_p10, dur_p50, dur_p75, desl_p50, desl_amostra)
  select b.empresa_id,
         case when grouping(b.tipo_servico_id) = 0 then b.tipo_servico_id end,
         v_hoje - 30, v_hoje - 1,
         count(b.dur)::int,
         percentile_cont(0.10) within group (order by b.dur),
         percentile_cont(0.50) within group (order by b.dur),
         percentile_cont(0.75) within group (order by b.dur),
         percentile_cont(0.50) within group (order by b.desl) filter (where b.desl > 0),
         (count(*) filter (where b.desl > 0))::int
    from base b
   group by grouping sets ((b.empresa_id, b.tipo_servico_id), (b.empresa_id))
  -- Contrato sem grupo não faz régua de grupo (e colidiria com a linha geral).
  having grouping(b.tipo_servico_id) = 1 or b.tipo_servico_id is not null;

  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.recalcular_regua_servico() from public, anon, authenticated;

-- ── A auditoria ────────────────────────────────────────────────────────────

/*
 * A fila do período (até 31 dias), mais a contagem de cada critério e a régua
 * usada. Volta:
 *   { de, ate, pesos, avaliados,
 *     criterios: { LOCAL: {SUSPEITO, OK, NAO_AVALIADO, NAO_SE_APLICA}, … },
 *     regua: [ {grupo, amostra, p10, p50, p75, de, ate, calculada_em} ],
 *     fila:  [ {visita_id, contrato, dia, tecnico_id, tecnico, equipe, grupo,
 *               situacao, nota, criterios: {LOCAL: {s, t, outro?}, …}} ] }
 * Só entra na fila contrato com nota > 0; os "não avaliados" de cada um vêm
 * junto, para a tela dizer o que não se pôde conferir.
 */
create or replace function public.auditoria_da_baixa(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- PROPOSTA, aguardando o Emanuel (D-262). Mudar é migration.
  c_peso constant jsonb := '{"SERIAL": 40, "LOCAL": 30, "EQUIPAMENTO": 25, "DURACAO": 20, "GALERIA": 15}';
  -- Grupo com menos concluídos que isto em 30 dias não tem régua confiável.
  c_amostra_min constant integer := 20;
  v_out jsonb;
begin
  if not eh_gestao() then
    raise exception 'A auditoria da baixa é para a gestão.' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;
  if p_ate - p_de > 30 then
    raise exception 'A auditoria vai até 31 dias por consulta.' using errcode = '22023';
  end if;

  with u as materialized (
    -- O universo: contrato produtivo do período cuja atividade foi FECHADA
    -- no TOA, ou que o campo levou a situação terminal. Cancelado pela central
    -- e desatribuído (ninguém foi) não são baixa de ninguém.
    select v.id, v.contrato, v.data_agendada, v.situacao, v.tecnico_responsavel_id,
           v.equipe_id, v.tipo_servico_id, v.toa_varrido_em, v.fim,
           norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) as st,
           minutos_de_hhmm(v.dados_origem->>'Duração') as dur
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.empresa_id = (select minha_empresa())
       and v.excluido_em is null
       and v.data_agendada between p_de and p_ate
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
       and (norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) in ('CONCLUIDO', 'NAO CONCLUIDO')
            or (v.situacao = any ((select situacoes_terminais())::text[])
                and exists (select 1 from visita_evento e
                             where e.visita_id = v.id and e.origem = 'MOBILE')))
  ),
  -- 1 . LOCAL — a função da D-170, uma chamada para o lote.
  loc as materialized (
    select l.visita_id, l.distancia_m, l.raio_m, l.fora_do_raio, l.fonte
      from local_da_baixa((select array_agg(u.id) from u)) l
  ),
  -- 2 . DURACAO — a régua guardada.
  rg as materialized (
    select r.tipo_servico_id, r.amostra, r.dur_p10, ts.nome
      from regua_servico r
      join tipo_servico ts on ts.id = r.tipo_servico_id
     where r.empresa_id = (select minha_empresa())
  ),
  -- 3 e 4 . Os seriais deste lote: o que o TOA mostra e o que o técnico lançou.
  toa as materialized (
    select e.visita_id, e.secao, upper(regexp_replace(e.serial, '\s', '', 'g')) as serial
      from visita_equipamento_toa e
     where e.visita_id in (select u.id from u)
       and e.serial is not null and not coalesce(e.miscelanea, false)
    union
    -- Na troca (ação 2) o TOA traz o serial que saiu ao lado do que entrou.
    select e.visita_id, 'DESINSTALADO', upper(regexp_replace(e.serial_substituido, '\s', '', 'g'))
      from visita_equipamento_toa e
     where e.visita_id in (select u.id from u)
       and e.serial_substituido is not null
  ),
  tec as materialized (
    select m.visita_id, m.operacao, m.serial
      from equipamento_movimento m
     where m.visita_id in (select u.id from u)
  ),
  inst as materialized (
    select t.visita_id, t.serial from toa t where t.secao = 'INSTALADO'
    union
    select t.visita_id, t.serial from tec t where t.operacao = 'INSTALADO'
  ),
  -- Todo serial instalado ou no cliente, de qualquer dia, na empresa.
  todos as materialized (
    select e.visita_id, upper(regexp_replace(e.serial, '\s', '', 'g')) as serial
      from visita_equipamento_toa e
     where e.empresa_id = (select minha_empresa())
       and e.serial is not null and not coalesce(e.miscelanea, false)
       and e.secao in ('INSTALADO', 'CLIENTE')
    union
    select m.visita_id, m.serial
      from equipamento_movimento m
      join visita mv on mv.id = m.visita_id and mv.empresa_id = (select minha_empresa())
     where m.operacao = 'INSTALADO'
  ),
  dup as materialized (
    select d.visita_id,
           jsonb_agg(jsonb_build_object(
             'serial', d.serial, 'contrato', d.outro_contrato, 'dia', d.outro_dia,
             -- O link só para contrato que a pessoa pode abrir.
             'visita_id', case when d.outro_base in (select bases_permitidas()) then d.outro_id end)
             order by d.outro_dia) as outros,
           min(d.serial) as serial, min(d.outro_contrato) as contrato, count(*) as n
      from (select distinct i.visita_id, i.serial, ov.id as outro_id, ov.contrato as outro_contrato,
                   ov.data_agendada as outro_dia, ov.base_id as outro_base
              from inst i
              join todos t on t.serial = i.serial and t.visita_id <> i.visita_id
              join visita ov on ov.id = t.visita_id and ov.excluido_em is null
              join u on u.id = i.visita_id
             where ov.contrato is distinct from u.contrato) d
     group by d.visita_id
  ),
  -- Diferença só na operação em que o técnico lançou alguma coisa.
  dif as materialized (
    select x.visita_id, count(*) as n,
           string_agg(x.texto, ' · ' order by x.texto) as texto
      from (
        select t.visita_id,
               'lançou ' || lower(t.operacao) || ' ' || t.serial || ', o TOA não mostra' as texto
          from tec t
         where not exists (select 1 from toa a
                            where a.visita_id = t.visita_id and a.serial = t.serial
                              and a.secao = case t.operacao when 'INSTALADO' then 'INSTALADO' else 'DESINSTALADO' end)
        union all
        select a.visita_id,
               'TOA mostra ' || case a.secao when 'INSTALADO' then 'instalado ' else 'retirado ' end
                 || a.serial || ', o técnico não lançou'
          from toa a
         where a.secao in ('INSTALADO', 'DESINSTALADO')
           and exists (select 1 from tec t
                        where t.visita_id = a.visita_id
                          and t.operacao = case a.secao when 'INSTALADO' then 'INSTALADO' else 'RETIRADO' end)
           and not exists (select 1 from tec t
                            where t.visita_id = a.visita_id and t.serial = a.serial
                              and t.operacao = case a.secao when 'INSTALADO' then 'INSTALADO' else 'RETIRADO' end)
      ) x
     group by x.visita_id
  ),
  -- 5 . GALERIA
  gal as materialized (
    select e.visita_id,
           count(*) filter (where e.midia = 'FOTO') as fotos,
           count(*) filter (where e.midia = 'FOTO' and e.da_galeria) as galeria
      from evidencia e
     where e.visita_id in (select u.id from u)
     group by e.visita_id
  ),
  av as materialized (
    select u.id, u.contrato, u.data_agendada, u.situacao, u.tecnico_responsavel_id, u.equipe_id,
           u.tipo_servico_id,
           jsonb_build_object(
             'LOCAL', case
               when l.visita_id is null then jsonb_build_object('s', 'NAO_AVALIADO', 't', 'sem GPS da baixa')
               when l.fora_do_raio is null then jsonb_build_object('s', 'NAO_AVALIADO', 't', 'endereço sem coordenada')
               when l.fora_do_raio then jsonb_build_object('s', 'SUSPEITO', 't',
                 'baixa a ' || case when l.distancia_m >= 1000
                                    then replace(round(l.distancia_m / 1000.0, 1)::text, '.', ',') || ' km'
                                    else l.distancia_m || ' m' end
                 || ' do endereço (raio ' || l.raio_m || ' m'
                 || case when l.fonte = 'RASTRO' then ', pelo rastro' else '' end || ')')
               else jsonb_build_object('s', 'OK', 't', l.distancia_m || ' m do endereço') end,
             'DURACAO', case
               when u.situacao <> 'CONCLUIDA' or u.st <> 'CONCLUIDO'
                 then jsonb_build_object('s', 'NAO_SE_APLICA', 't', 'não concluído')
               when u.dur is null then jsonb_build_object('s', 'NAO_AVALIADO', 't', 'sem Duração no TOA')
               when r.tipo_servico_id is null or r.amostra < c_amostra_min or r.dur_p10 is null
                 then jsonb_build_object('s', 'NAO_AVALIADO', 't', 'grupo sem régua (menos de '
                                         || c_amostra_min || ' concluídos em 30 dias)')
               when u.dur < r.dur_p10 then jsonb_build_object('s', 'SUSPEITO', 't',
                 'executado em ' || u.dur || ' min (10% mais curtos de ' || r.nome || ': até '
                 || replace(trim_scale(round(r.dur_p10, 1))::text, '.', ',') || ' min)')
               else jsonb_build_object('s', 'OK', 't', u.dur || ' min') end,
             'SERIAL', case
               when d.visita_id is not null then jsonb_build_object('s', 'SUSPEITO', 't',
                 'serial ' || d.serial || ' também no contrato ' || coalesce(d.contrato, 'sem número')
                 || case when d.n > 1 then ' (+' || (d.n - 1) || ')' else '' end,
                 'outros', d.outros)
               when u.toa_varrido_em is null and not exists (select 1 from tec t where t.visita_id = u.id)
                 then jsonb_build_object('s', 'NAO_AVALIADO', 't', 'sem leitura do TOA')
               else jsonb_build_object('s', 'OK', 't', 'nenhum serial repetido') end,
             'EQUIPAMENTO', case
               when not exists (select 1 from tec t where t.visita_id = u.id)
                 then jsonb_build_object('s', 'NAO_AVALIADO', 't', 'técnico não lançou equipamento')
               when u.toa_varrido_em is null
                 then jsonb_build_object('s', 'NAO_AVALIADO', 't', 'sem leitura do TOA')
               when u.fim is not null and u.toa_varrido_em < u.fim
                 then jsonb_build_object('s', 'NAO_AVALIADO', 't', 'TOA lido antes do fechamento')
               when f.visita_id is not null then jsonb_build_object('s', 'SUSPEITO', 't', f.texto)
               else jsonb_build_object('s', 'OK', 't', 'igual ao TOA') end,
             'GALERIA', case
               when coalesce(g.fotos, 0) = 0 then jsonb_build_object('s', 'NAO_AVALIADO', 't', 'sem foto')
               when g.galeria > 0 then jsonb_build_object('s', 'SUSPEITO', 't',
                 g.galeria || ' de ' || g.fotos || ' foto(s) da galeria')
               else jsonb_build_object('s', 'OK', 't', g.fotos || ' foto(s) da câmera') end
           ) as c
      from u
      left join loc l on l.visita_id = u.id
      left join rg r on r.tipo_servico_id = u.tipo_servico_id
      left join dup d on d.visita_id = u.id
      left join dif f on f.visita_id = u.id
      left join gal g on g.visita_id = u.id
  ),
  nota as materialized (
    select a.*,
           (select coalesce(sum((c_peso->>k.key)::int), 0)
              from jsonb_each(a.c) k where k.value->>'s' = 'SUSPEITO')::int as nota
      from av a
  )
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate, 'pesos', c_peso,
    'avaliados', (select count(*) from nota),
    'criterios', (select coalesce(jsonb_object_agg(x.key, x.cont), '{}')
                    from (select k.key, jsonb_object_agg(k.s, k.n) as cont
                            from (select k.key, k.value->>'s' as s, count(*) as n
                                    from nota a, jsonb_each(a.c) k
                                   group by 1, 2) k
                           group by k.key) x),
    'regua', (select coalesce(jsonb_agg(jsonb_build_object(
                       'grupo', coalesce(ts.nome, 'TODOS'), 'amostra', r.amostra,
                       'p10', r.dur_p10, 'p50', r.dur_p50, 'p75', r.dur_p75,
                       'suficiente', r.amostra >= c_amostra_min,
                       'de', r.de, 'ate', r.ate, 'calculada_em', r.calculada_em)
                     order by r.tipo_servico_id is null, r.amostra desc), '[]')
                from regua_servico r
                left join tipo_servico ts on ts.id = r.tipo_servico_id
               where r.empresa_id = (select minha_empresa())),
    'fila', (select coalesce(jsonb_agg(jsonb_build_object(
                      'visita_id', a.id, 'contrato', a.contrato, 'dia', a.data_agendada,
                      'tecnico_id', a.tecnico_responsavel_id, 'tecnico', t.nome,
                      'equipe', e.codigo, 'grupo', ts.nome, 'situacao', a.situacao,
                      'nota', a.nota, 'criterios', a.c)
                    order by a.nota desc, a.data_agendada desc, a.contrato), '[]')
               from nota a
               left join tecnico t on t.id = a.tecnico_responsavel_id
               left join equipe e on e.id = a.equipe_id
               left join tipo_servico ts on ts.id = a.tipo_servico_id
              where a.nota > 0))
    into v_out;

  return v_out;
end;
$$;
revoke all on function public.auditoria_da_baixa(date, date) from public, anon;
grant execute on function public.auditoria_da_baixa(date, date) to authenticated;

-- A régua nasce agora e se refaz todo dia às 05h10 de Manaus (09h10 UTC).
select public.recalcular_regua_servico();
select cron.schedule('regua-servico', '10 9 * * *', $$select public.recalcular_regua_servico()$$);

notify pgrst, 'reload schema';

-- 176 passa a ler a régua guardada (economiza ~77 ms e tira a jornada da mediana geral).
-- A mesma função do banco (lida em 02/11) com o bloco v_ref trocado.
CREATE OR REPLACE FUNCTION public.tec1_em_risco()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_hoje  date := hoje_local();
  v_agora timestamptz := now();
  v_antec int := coalesce((parametro_valor('atraso_antecedencia_min') #>> '{}')::int, 30);
  r record;
  v_fila uuid;
  v_livre timestamptz;
  v_frente int;
  v_cheg timestamptz; v_ini timestamptz; v_fim timestamptz;
  v_prazo timestamptz; v_prazo_fim timestamptz;
  v_folga numeric; v_nivel text;
  v_ger_dur numeric; v_ger_desl numeric;
  v_dur numeric; v_desl numeric;
  v_ref jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  if not eh_gestao() then
    raise exception 'TEC1 em risco é para a gestão.' using errcode = '42501';
  end if;

  -- 179: a régua guardada (`regua_servico`, recalculada às 05h10): só concluídos
  -- de fato e sem jornada. A linha sem grupo (geral) cobre o grupo sem régua.
  -- `rg`, não `r`: `r` é a variável record do laço (armadilha de traps.md).
  select coalesce(jsonb_agg(jsonb_build_object('tipo_servico_id', rg.tipo_servico_id,
                    'dur', rg.dur_p50, 'desl', rg.desl_p50, 'geral', rg.tipo_servico_id is null)), '[]')
    into v_ref
    from regua_servico rg
   where rg.empresa_id = (select minha_empresa());
  select (e->>'dur')::numeric, (e->>'desl')::numeric into v_ger_dur, v_ger_desl
    from jsonb_array_elements(v_ref) e where (e->>'geral')::boolean;

  for r in
    with abertos as materialized (
      select v.id, v.contrato, v.data_agendada, v.tecnico_responsavel_id, v.equipe_id, v.tipo_servico_id,
             coalesce(v.tecnico_responsavel_id, v.equipe_id) as fila,
             v.situacao, v.janela_inicio, v.janela_fim, v.inicio, v.bloqueado_em, v.situacao_em,
             v.lat, v.lng,
             norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) as st,
             minutos_de_hhmm(v.dados_origem->>'Tempo de Deslocamento') as desl_toa,
             v.dados_origem->>'Intervalo de Tempo' as intervalo,
             coalesce(ts.tec1_carencia_min, 120) as tol, ts.nome as grupo
        from visita v
        left join tipo_atividade ta on ta.id = v.tipo_atividade_id
        left join tipo_servico ts on ts.id = v.tipo_servico_id
       where v.empresa_id = (select minha_empresa()) and v.excluido_em is null
         and v.data_agendada = v_hoje
         and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
         and v.situacao <> all (situacoes_terminais())
         and coalesce(v.tecnico_responsavel_id, v.equipe_id) is not null
         -- Fechado no TOA: o TEC1 já está decidido, não há o que prever.
         and norm_txt(coalesce(v.dados_origem->>'Status da Atividade', ''))
               not in ('CONCLUIDO', 'NAO CONCLUIDO', 'CANCELADO')
         and v.base_id in (select bases_visiveis())
         and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
    )
    select a.*,
           (a.st = 'INICIADO' or a.situacao = 'EM_EXECUCAO') as comecou,
           exists (select 1 from ordem_servico o left join tipo_os t on t.id = o.tipo_os_id
                    where o.visita_id = a.id
                      and tec1_janela_conta(a.intervalo, a.janela_inicio, a.janela_fim, t.descricao)) as conta,
           rf.dur as ref_dur, rf.desl as ref_desl,
           t.nome as tecnico, e.codigo as equipe,
           p.lat as p_lat, p.lng as p_lng, p.capturado_em as p_em
      from abertos a
      left join jsonb_to_recordset(v_ref) rf(tipo_servico_id uuid, dur numeric, desl numeric, geral boolean)
             on not rf.geral and rf.tipo_servico_id = a.tipo_servico_id
      left join tecnico t on t.id = a.tecnico_responsavel_id
      left join equipe e on e.id = a.equipe_id
      left join lateral (
        select rp.lat, rp.lng, rp.capturado_em from rastro_ponto rp
         where rp.tecnico_id = a.tecnico_responsavel_id and not rp.simulado
           and rp.capturado_em >= v_agora - interval '20 minutes'
         order by rp.capturado_em desc limit 1) p on true
     order by a.fila,
              (a.st = 'INICIADO' or a.situacao = 'EM_EXECUCAO') desc,
              (a.situacao = 'EM_DESLOCAMENTO') desc,
              coalesce(a.inicio, (a.data_agendada + coalesce(a.janela_inicio, time '08:00')) at time zone 'America/Manaus'),
              a.janela_fim nulls last
  loop
    if v_fila is distinct from r.fila then
      v_fila := r.fila; v_livre := v_agora; v_frente := 0;
    end if;

    v_dur  := coalesce(r.ref_dur, v_ger_dur, 60);
    v_desl := coalesce(nullif(r.desl_toa, 0), r.ref_desl, v_ger_desl, 15);
    v_prazo := case when r.janela_fim is not null
                    then (r.data_agendada + r.janela_fim) at time zone 'America/Manaus' end;
    v_prazo_fim := v_prazo + make_interval(mins => r.tol);

    if r.comecou then
      -- Quem mudou a situação deu a hora (bloqueado_em); senão, o TOA (D-224).
      v_ini := case when r.situacao = 'EM_EXECUCAO' and r.bloqueado_em is not null
                    then r.situacao_em else coalesce(r.inicio, r.situacao_em, v_agora) end;
      v_cheg := v_ini;
      v_fim := greatest(v_ini + make_interval(mins => v_dur::int), v_agora);
    else
      v_cheg := case when r.situacao = 'EM_DESLOCAMENTO' and r.bloqueado_em is not null
                     then greatest(v_livre, r.situacao_em + make_interval(mins => v_desl::int))
                     else v_livre + make_interval(mins => v_desl::int) end;
      v_ini := greatest(v_cheg, (r.data_agendada + coalesce(r.janela_inicio, time '00:00')) at time zone 'America/Manaus');
      v_fim := v_ini + make_interval(mins => v_dur::int);
    end if;

    v_nivel := null;
    if r.conta and v_prazo is not null then
      if not r.comecou and v_agora > v_prazo then
        v_nivel := 'PERDIDO';
        v_folga := round(extract(epoch from v_prazo - v_agora) / 60);
      elsif r.comecou and v_ini > v_prazo then
        v_nivel := null;  -- começou depois da janela: já é SEM PADRÃO, o TEC1 do fechamento fala
      else
        v_folga := round(extract(epoch from least(
                     case when r.comecou then null else v_prazo - v_cheg end,
                     v_prazo_fim - v_fim)) / 60);
        v_nivel := case when v_folga < 0 then 'VAI_ESTOURAR'
                        when v_folga < v_antec then 'EM_RISCO' end;
      end if;
    end if;

    if v_nivel is not null then
      v_out := v_out || jsonb_build_object(
        'visita_id', r.id, 'contrato', r.contrato, 'nivel', v_nivel,
        'tecnico_id', r.tecnico_responsavel_id, 'tecnico', r.tecnico,
        'equipe_id', r.equipe_id, 'equipe', r.equipe, 'grupo', r.grupo,
        'situacao', r.situacao, 'comecou', r.comecou,
        'janela', to_char(r.janela_inicio, 'HH24:MI') || '–' || to_char(r.janela_fim, 'HH24:MI'),
        'prazo_chegada', v_prazo, 'prazo_fim', v_prazo_fim,
        'previsto_chegada', case when r.comecou then null else v_cheg end,
        'previsto_fim', v_fim, 'folga_min', v_folga,
        'na_frente', v_frente, 'duracao_min', round(v_dur), 'deslocamento_min', round(v_desl),
        'toa_inicio_planejado', case when r.st = 'PENDENTE' then r.inicio end,
        'distancia_km', case when r.p_lat is not null and r.lat is not null and not r.comecou
                             then round((distancia_m(r.p_lat, r.p_lng, r.lat, r.lng) / 1000)::numeric, 1) end,
        'posicao_em', case when r.p_lat is not null and r.lat is not null and not r.comecou then r.p_em end);
    end if;

    v_livre := v_fim;
    v_frente := v_frente + 1;
  end loop;

  return v_out;
end;
$function$;

notify pgrst, 'reload schema';
