-- ┌─ 183 · Sugestões no site: redistribuição e ordem das paradas ──────────┐
-- │ > "sobre a questão de rota e sugestões vamos manter em nosso sistema  │
-- │ >  do controlador, nada será sugerido pelo app do técnico (...) isso  │
-- │ >  é mais para quem acessa pelo site." — Emanuel, 02/11 (D-262)       │
-- │                                                                       │
-- │ MUDA A D-088 SÓ PARA A OPERAÇÃO DO DIA, E SÓ NA WEB. O sistema passa  │
-- │ a SUGERIR, com o motivo escrito ao lado; quem opera aceita com um     │
-- │ clique. NADA aqui grava: as três funções públicas são STABLE e só     │
-- │ leem. Aceitar a redistribuição é chamar `transferir_visita` (170,     │
-- │ D-257) — a mesma porta de Serviços e da Rota do dia, com a mesma      │
-- │ trava (`eh_gestao()` e `servicos.transferir`). Não existe segundo     │
-- │ caminho de transferência. Cadastro (login → equipe) continua sem      │
-- │ sugestão nenhuma: a D-089 vale como estava.                           │
-- │                                                                       │
-- │ 1. A FILA DO DIA VIRA UMA FUNÇÃO SÓ (`fila_do_dia`)                   │
-- │    A conta da 176 — fila de cada técnico na ordem do TOA, mediana de  │
-- │    30 dias do próprio TOA para duração e deslocamento, ninguém começa │
-- │    antes da janela — saiu de dentro de `tec1_em_risco` e virou        │
-- │    tabela. `tec1_em_risco` passa a ler dela e devolve o MESMO jsonb   │
-- │    (conferido: md5 igual, Manaus e São Luís, no mesmo instante). A    │
-- │    redistribuição e a ordem sugerida leem a mesma fila: uma previsão  │
-- │    só, três leituras.                                                 │
-- │                                                                       │
-- │ 2. REDISTRIBUIÇÃO SUGERIDA (`sugestoes_redistribuicao`)               │
-- │    Gatilho: contrato em TEC1_RISCO (EM_RISCO / VAI_ESTOURAR — o       │
-- │    PERDIDO não: a janela já fechou, ninguém chega a tempo) ou técnico │
-- │    com Ticket de suporte aberto pelo campo (a regra da D-167, lida de │
-- │    `central_do_controle()->'ajuda'`, sem segunda cópia).              │
-- │    O que se sugere mover: o contrato em risco; no suporte, os         │
-- │    próximos dele. Só Na entrada / Atribuída e que ninguém abriu.      │
-- │    Para quem: mesma skill (`tecnico.skill`, as frentes de             │
-- │    `ritmo_janelas`), em rota hoje na cidade ativa, outra equipe, e    │
-- │    que não está ele mesmo em risco nem com suporte aberto. Ele pega o │
-- │    contrato DEPOIS da fila dele (conta conservadora), com a mediana   │
-- │    de deslocamento do grupo — a posição não entra no relógio, como na │
-- │    176. Só entra quem chega na janela e termina na tolerância; o mais │
-- │    perto primeiro (linha reta), depois quem chega antes.              │
-- │    Posição: onde ele fica livre — o último contrato da fila; fila     │
-- │    vazia, o rastro dos últimos 20 min; sem rastro, o último concluído.│
-- │                                                                       │
-- │ 3. ORDEM SUGERIDA (`ordem_sugerida`) — só informação                  │
-- │    "A janela que fecha primeiro vem primeiro; dentro da mesma janela, │
-- │    o mais perto." (prazo mais cedo primeiro + vizinho mais próximo).  │
-- │    Comparada com a ordem do TOA em km de LINHA RETA. Não grava nada:  │
-- │    a ordem real é do TOA. Em dia passado compara com a ordem que foi  │
-- │    EXECUTADA, a partir do primeiro contrato do dia.                   │
-- │    O tempo ganho só sai com velocidade MEDIDA no rastro (mediana,     │
-- │    mínimo de 30 trechos na cidade): o "Tempo de Deslocamento" do TOA  │
-- │    não acompanha a distância (medido em 30 dias, 2.434 trechos de     │
-- │    Manaus: r² = 0,007), e em 02/11 o rastro tinha 16 trechos. Sem     │
-- │    medida, o tempo vem NULO — "sem velocidade medida", nunca 0.       │
-- └───────────────────────────────────────────────────────────────────────┘

/*
 * A fila do dia, contrato a contrato (a conta da 176, agora em tabela).
 * Gestão, cidade ativa. Cada linha: quem está na frente, quando chega,
 * quando começa e termina, o prazo do livro e o nível do TEC1.
 *
 * O laço é o MESMO da 176, linha por linha; só passou a devolver todas as
 * linhas (o nível e a folga vão como coluna). `ordem` é a posição global
 * no laço — é por ela que `tec1_em_risco` mantém a ordem de antes.
 */
create or replace function public.fila_do_dia()
returns table (
  ordem int, visita_id uuid, contrato text, fila uuid, na_frente int,
  tecnico_id uuid, tecnico text, equipe_id uuid, equipe text,
  tipo_servico_id uuid, grupo text, situacao text, status_toa text,
  comecou boolean, conta boolean,
  janela_inicio time, janela_fim time,
  prazo_chegada timestamptz, prazo_fim timestamptz,
  previsto_chegada timestamptz, previsto_inicio timestamptz, previsto_fim timestamptz,
  duracao_min numeric, deslocamento_min numeric, deslocamento_ref_min numeric,
  toa_inicio_planejado timestamptz,
  lat numeric, lng numeric,
  p_lat double precision, p_lng double precision, p_em timestamptz,
  nivel text, folga_min numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_hoje  date := hoje_local();
  v_agora timestamptz := now();
  v_antec int := coalesce((parametro_valor('atraso_antecedencia_min') #>> '{}')::int, 30);
  r record;
  v_fila uuid;
  v_livre timestamptz;
  v_frente int;
  v_ordem int := 0;
  v_cheg timestamptz; v_ini timestamptz; v_fim timestamptz;
  v_prazo timestamptz; v_prazo_fim timestamptz;
  v_folga numeric; v_nivel text;
  v_ger_dur numeric; v_ger_desl numeric;
  v_dur numeric; v_desl numeric;
  v_ref jsonb;
begin
  if not eh_gestao() then
    raise exception 'TEC1 em risco é para a gestão.' using errcode = '42501';
  end if;

  -- A régua guardada (179, `regua_servico`): só concluídos de fato, sem jornada.
  -- `rg`, não `r`: `r` é a variável record do laço (traps.md).
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

    v_nivel := null; v_folga := null;
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

    v_ordem := v_ordem + 1;
    ordem := v_ordem; visita_id := r.id; contrato := r.contrato; fila := r.fila;
    na_frente := v_frente;
    tecnico_id := r.tecnico_responsavel_id; tecnico := r.tecnico;
    equipe_id := r.equipe_id; equipe := r.equipe;
    tipo_servico_id := r.tipo_servico_id; grupo := r.grupo;
    situacao := r.situacao; status_toa := r.st;
    comecou := r.comecou; conta := r.conta;
    janela_inicio := r.janela_inicio; janela_fim := r.janela_fim;
    prazo_chegada := v_prazo; prazo_fim := v_prazo_fim;
    previsto_chegada := case when r.comecou then null else v_cheg end;
    previsto_inicio := v_ini; previsto_fim := v_fim;
    duracao_min := v_dur; deslocamento_min := v_desl;
    deslocamento_ref_min := coalesce(r.ref_desl, v_ger_desl, 15);
    toa_inicio_planejado := case when r.st = 'PENDENTE' then r.inicio end;
    lat := r.lat; lng := r.lng;
    p_lat := r.p_lat; p_lng := r.p_lng; p_em := r.p_em;
    nivel := v_nivel; folga_min := v_folga;
    return next;

    v_livre := v_fim;
    v_frente := v_frente + 1;
  end loop;
end;
$$;
revoke all on function public.fila_do_dia() from public, anon;
grant execute on function public.fila_do_dia() to authenticated;

/*
 * TEC1 em risco (176), agora lendo a fila. Mesmo jsonb, mesma ordem,
 * mesmos campos — conferido pelo md5 no mesmo instante.
 */
create or replace function public.tec1_em_risco()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not eh_gestao() then
    raise exception 'TEC1 em risco é para a gestão.' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'visita_id', f.visita_id, 'contrato', f.contrato, 'nivel', f.nivel,
             'tecnico_id', f.tecnico_id, 'tecnico', f.tecnico,
             'equipe_id', f.equipe_id, 'equipe', f.equipe, 'grupo', f.grupo,
             'situacao', f.situacao, 'comecou', f.comecou,
             'janela', to_char(f.janela_inicio, 'HH24:MI') || '–' || to_char(f.janela_fim, 'HH24:MI'),
             'prazo_chegada', f.prazo_chegada, 'prazo_fim', f.prazo_fim,
             'previsto_chegada', f.previsto_chegada,
             'previsto_fim', f.previsto_fim, 'folga_min', f.folga_min,
             'na_frente', f.na_frente, 'duracao_min', round(f.duracao_min),
             'deslocamento_min', round(f.deslocamento_min),
             'toa_inicio_planejado', f.toa_inicio_planejado,
             'distancia_km', case when f.p_lat is not null and f.lat is not null and not f.comecou
                                  then round((distancia_m(f.p_lat, f.p_lng, f.lat, f.lng) / 1000)::numeric, 1) end,
             'posicao_em', case when f.p_lat is not null and f.lat is not null and not f.comecou then f.p_em end)
             order by f.ordem), '[]'::jsonb)
      from fila_do_dia() f
     where f.nivel is not null);
end;
$$;
revoke all on function public.tec1_em_risco() from public, anon;
grant execute on function public.tec1_em_risco() to authenticated;

/*
 * Velocidade MEDIDA no rastro da cidade ativa, 30 dias: trechos entre dois
 * pontos reais seguidos, de 1 a 6 min (o app grava a cada 2 min andando) e
 * mais de 300 m (andando de verdade). Mediana em km/h. Com menos de 30
 * trechos, NULO: a 176 recusou tirar velocidade de 17 trechos, e esta
 * função não é mais corajosa que ela. Interna: só as definer chamam.
 */
create or replace function public.velocidade_do_rastro(out kmh numeric, out trechos int)
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select rp.capturado_em as t, rp.lat, rp.lng,
           lag(rp.capturado_em) over w as t0, lag(rp.lat) over w as lat0, lag(rp.lng) over w as lng0
      from rastro_ponto rp
      join tecnico tc on tc.id = rp.tecnico_id
     where rp.empresa_id = (select minha_empresa()) and not rp.simulado
       and rp.capturado_em >= now() - interval '30 days'
       and tc.base_id in (select bases_visiveis())
    window w as (partition by rp.tecnico_id order by rp.capturado_em)
  ), tr as (
    select distancia_m(lat0, lng0, lat, lng) / extract(epoch from t - t0)::float8 * 3.6 as v
      from p
     where t0 is not null
       and t - t0 between interval '1 minute' and interval '6 minutes'
       and distancia_m(lat0, lng0, lat, lng) > 300
  )
  select case when count(*) >= 30
              then round(percentile_cont(0.5) within group (order by v)::numeric, 1) end,
         count(*)::int
    from tr;
$$;
revoke all on function public.velocidade_do_rastro() from public, anon, authenticated;

/*
 * Redistribuição sugerida (gestão, cidade ativa). Uma linha por contrato
 * que vale mover, com o motivo e até 3 técnicos que chegam na janela.
 * Não grava nada: aceitar é `transferir_visita(visita, equipe do escolhido)`.
 */
create or replace function public.sugestoes_redistribuicao()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoje  date := hoje_local();
  v_agora timestamptz := now();
  v_out   jsonb;
begin
  if not eh_gestao() then
    raise exception 'Sugestões são para a gestão.' using errcode = '42501';
  end if;

  with f as materialized (
    select * from fila_do_dia()
  ),
  -- A pessoa por trás da fila: o técnico; sem técnico, o ÚNICO ativo da
  -- equipe (hoje toda equipe tem um). Equipe de dois fica sem dono — e sem
  -- sugestão, em vez de um palpite.
  fq as materialized (
    select f.*, coalesce(f.tecnico_id,
             (select case when count(*) = 1 then (array_agg(t.id))[1] end
                from tecnico t where t.equipe_id = f.equipe_id and t.situacao = 'ATIVO')) as quem
      from f
  ),
  -- Ticket de suporte aberto pelo campo: a regra da D-167, lida da central.
  aj as materialized (
    select (x->>'visita_id')::uuid as visita_id, (x->>'desde')::timestamptz as desde,
           x->>'observacao' as observacao, v.contrato,
           coalesce(v.tecnico_responsavel_id,
             (select case when count(*) = 1 then (array_agg(t.id))[1] end
                from tecnico t where t.equipe_id = v.equipe_id and t.situacao = 'ATIVO')) as quem
      from jsonb_array_elements(coalesce(central_do_controle()->'ajuda', '[]'::jsonb)) x
      join visita v on v.id = (x->>'visita_id')::uuid
  ),
  -- Quem não recebe: quem está ele mesmo em risco ou pediu suporte.
  apuro as (
    select quem from fq where nivel is not null and quem is not null
    union
    select quem from aj where quem is not null
  ),
  mover as materialized (
    select fq.*, s.desde as suporte_desde, s.observacao as suporte_obs,
           s.contrato as suporte_contrato, tor.nome as origem_nome, tor.skill
      from fq
      left join lateral (
        select a.desde, a.observacao, a.contrato from aj a
         where a.quem = fq.quem order by a.desde desc limit 1) s on fq.quem is not null
      left join tecnico tor on tor.id = fq.quem
     where fq.situacao in ('ENTRADA', 'ATRIBUIDA') and not fq.comecou
       and (fq.nivel in ('EM_RISCO', 'VAI_ESTOURAR') or s.desde is not null)
  ),
  cand as materialized (
    select t.id, t.nome, t.skill, t.equipe_id, e.codigo as equipe
      from tecnico t
      join equipe e on e.id = t.equipe_id
     where t.empresa_id = (select minha_empresa()) and t.situacao = 'ATIVO'
       and coalesce(e.ativo, true)
       and e.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or t.equipe_id in (select equipes_visiveis()))
       and t.skill in (select m.skill from mover m)
       and not exists (select 1 from apuro a where a.quem = t.id)
       -- Em rota hoje: tem contrato produtivo do dia, na cidade ativa.
       and exists (select 1 from visita v
                     left join tipo_atividade ta on ta.id = v.tipo_atividade_id
                    where v.tecnico_responsavel_id = t.id and v.data_agendada = v_hoje
                      and v.excluido_em is null
                      and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
                      and v.base_id in (select bases_visiveis()))
  ),
  -- Onde e quando cada candidato fica livre.
  livre as materialized (
    select c.*,
           coalesce(q.na_fila, 0) as na_fila,
           greatest(coalesce(q.livre_em, v_agora), v_agora) as livre_em,
           case when q.f_lat is not null then 'FILA'
                when rp.lat is not null then 'RASTRO'
                when uc.lat is not null then 'CONCLUIDO' end as posicao,
           coalesce(q.f_lat, rp.lat, uc.lat) as pos_lat,
           coalesce(q.f_lng, rp.lng, uc.lng) as pos_lng,
           case when q.f_lat is not null then q.livre_em
                when rp.lat is not null then rp.capturado_em
                else uc.quando end as posicao_em,
           case when q.f_lat is not null then q.f_contrato
                when rp.lat is null then uc.contrato end as posicao_contrato
      from cand c
      left join lateral (
        select count(*) as na_fila, max(fq.previsto_fim) as livre_em,
               (array_agg(fq.lat::float8 order by fq.ordem desc) filter (where fq.lat is not null))[1] as f_lat,
               (array_agg(fq.lng::float8 order by fq.ordem desc) filter (where fq.lat is not null))[1] as f_lng,
               (array_agg(fq.contrato order by fq.ordem desc) filter (where fq.lat is not null))[1] as f_contrato
          from fq where fq.quem = c.id) q on true
      left join lateral (
        select rp.lat, rp.lng, rp.capturado_em from rastro_ponto rp
         where rp.tecnico_id = c.id and not rp.simulado
           and rp.capturado_em >= v_agora - interval '20 minutes'
         order by rp.capturado_em desc limit 1) rp on true
      left join lateral (
        select v.lat::float8 as lat, v.lng::float8 as lng, v.contrato,
               coalesce(v.fim, v.situacao_em) as quando
          from visita v
         where v.tecnico_responsavel_id = c.id and v.data_agendada = v_hoje
           and v.excluido_em is null and v.situacao = 'CONCLUIDA' and v.lat is not null
         order by coalesce(v.fim, v.situacao_em) desc limit 1) uc on true
  ),
  par as (
    select m.visita_id, l.id, l.nome, l.equipe_id, l.equipe, l.na_fila, l.livre_em,
           l.posicao, l.posicao_em, l.posicao_contrato,
           round((distancia_m(l.pos_lat, l.pos_lng, m.lat, m.lng) / 1000.0)::numeric, 1) as km,
           x.chega, x.termina,
           round(extract(epoch from least(m.prazo_chegada - x.chega, m.prazo_fim - x.termina)) / 60) as folga,
           m.prazo_chegada, m.prazo_fim, m.nivel, m.previsto_chegada
      from mover m
      join livre l on l.skill = m.skill and l.id is distinct from m.quem
                  and l.equipe_id is distinct from m.equipe_id
      cross join lateral (
        select l.livre_em + make_interval(mins => m.deslocamento_ref_min::int) as chega) c0
      cross join lateral (
        select c0.chega,
               greatest(c0.chega, (v_hoje + coalesce(m.janela_inicio, time '00:00')) at time zone 'America/Manaus')
                 + make_interval(mins => m.duracao_min::int) as termina) x
  ),
  bons as (
    select p.*, row_number() over (partition by p.visita_id order by p.km nulls last, p.chega) as n
      from par p
     where (p.prazo_chegada is null or p.chega <= p.prazo_chegada)
       and (p.prazo_fim is null or p.termina < p.prazo_fim)
       -- No risco, só serve quem chega ANTES do que a fila de hoje prevê.
       and (p.nivel is null or p.chega < p.previsto_chegada)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'visita_id', m.visita_id, 'contrato', m.contrato, 'grupo', m.grupo,
           'situacao', m.situacao,
           'janela', to_char(m.janela_inicio, 'HH24:MI') || '–' || to_char(m.janela_fim, 'HH24:MI'),
           'tem_coordenada', m.lat is not null,
           'risco', case when m.nivel is not null then jsonb_build_object(
                      'nivel', m.nivel, 'folga_min', m.folga_min,
                      'previsto_chegada', m.previsto_chegada, 'previsto_fim', m.previsto_fim,
                      'prazo_chegada', m.prazo_chegada, 'na_frente', m.na_frente) end,
           'suporte', case when m.suporte_desde is not null then jsonb_build_object(
                        'desde', m.suporte_desde, 'observacao', m.suporte_obs,
                        'contrato', m.suporte_contrato) end,
           'origem', jsonb_build_object('tecnico_id', m.quem, 'tecnico', coalesce(m.origem_nome, m.tecnico),
                                        'equipe_id', m.equipe_id, 'equipe', m.equipe, 'skill', m.skill),
           'sem_candidato', case when m.skill is null then 'SEM_SKILL'
                                 when cs.lista is null then 'NINGUEM_CHEGA' end,
           'candidatos', coalesce(cs.lista, '[]'::jsonb))
           order by coalesce(m.prazo_chegada, 'infinity'::timestamptz), m.ordem), '[]'::jsonb)
    into v_out
    from mover m
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'tecnico_id', b.id, 'tecnico', b.nome, 'equipe_id', b.equipe_id, 'equipe', b.equipe,
               'km', b.km, 'posicao', b.posicao, 'posicao_em', b.posicao_em,
               'posicao_contrato', b.posicao_contrato,
               'na_fila', b.na_fila, 'livre_em', b.livre_em,
               'chega', b.chega, 'termina', b.termina, 'folga_min', b.folga) order by b.n) as lista
        from bons b where b.visita_id = m.visita_id and b.n <= 3) cs on true;

  return v_out;
end;
$$;
revoke all on function public.sugestoes_redistribuicao() from public, anon;
grant execute on function public.sugestoes_redistribuicao() to authenticated;

/*
 * Ordem sugerida das paradas ainda não iniciadas, por técnico — SÓ
 * informação; a ordem real é do TOA e nada aqui é gravado.
 *
 * Regra: a janela que fecha primeiro vem primeiro; dentro da mesma janela,
 * o mais perto de onde ele está. Comparada com a ordem do TOA (a da fila
 * da 176) em km de linha reta e, hoje, em contratos que a previsão põe fora
 * da janela (a mesma conta da fila, só trocando a ordem). Se a sugerida
 * puser mais contrato fora da janela que a do TOA, ela não é oferecida.
 *
 * p_data passado: compara com a ordem EXECUTADA (pelo início real), a
 * partir do primeiro contrato do dia — mede o que a regra teria economizado.
 * Contrato sem coordenada fica fora das duas contas, e é contado.
 */
create or replace function public.ordem_sugerida(p_data date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_data  date := coalesce(p_data, hoje_local());
  v_eh_hoje boolean := coalesce(p_data, hoje_local()) = hoje_local();
  v_vel numeric; v_trechos int;
  g record;
  it jsonb; n int; i int; k int; melhor int;
  v_usado boolean[];
  v_seq int[];
  v_plat float8; v_plng float8;
  v_d float8; v_dmelhor float8;
  v_bjf time; v_bji time; v_tem_bloco boolean;
  v_km_toa float8; v_km_sug float8;
  v_fora_toa int; v_fora_sug int;
  v_t timestamptz; v_cheg timestamptz; v_ini timestamptz; v_fim timestamptz;
  v_lista_toa jsonb; v_lista_sug jsonb;
  v_ant_lat float8; v_ant_lng float8; v_leg float8;
  v_tecs jsonb := '[]'::jsonb;
  v_total_toa float8 := 0; v_total_sug float8 := 0;
  v_ordem int[];
  v_passo int;
begin
  if not eh_gestao() then
    raise exception 'Sugestões são para a gestão.' using errcode = '42501';
  end if;

  select kmh, trechos into v_vel, v_trechos from velocidade_do_rastro();

  if v_data > hoje_local() then
    return jsonb_build_object('data', v_data, 'base_ordem', 'TOA', 'tecnicos', '[]'::jsonb,
                              'velocidade_kmh', v_vel, 'velocidade_trechos', v_trechos);
  end if;

  for g in
    -- ── HOJE: a fila da 176. Partida = o contrato em execução/a caminho;
    --    senão o rastro de 20 min; senão o último concluído do dia.
    select f.fila,
           min(f.tecnico_id::text)::uuid as tecnico_id, min(f.tecnico) as tecnico,
           min(f.equipe_id::text)::uuid as equipe_id, min(f.equipe) as equipe,
           (array_agg(f.lat::float8 order by f.ordem desc)
              filter (where (f.comecou or f.situacao = 'EM_DESLOCAMENTO') and f.lat is not null))[1] as at_lat,
           (array_agg(f.lng::float8 order by f.ordem desc)
              filter (where (f.comecou or f.situacao = 'EM_DESLOCAMENTO') and f.lat is not null))[1] as at_lng,
           (array_agg(f.contrato order by f.ordem desc)
              filter (where (f.comecou or f.situacao = 'EM_DESLOCAMENTO') and f.lat is not null))[1] as at_contrato,
           max(f.p_lat) filter (where f.p_lat is not null) as r_lat,
           max(f.p_lng) filter (where f.p_lat is not null) as r_lng,
           max(f.p_em) as r_em,
           -- quando ele fica livre para o 1º pendente: a chegada prevista menos o deslocamento
           (array_agg(f.previsto_chegada - make_interval(mins => f.deslocamento_min::int) order by f.ordem)
              filter (where f.situacao in ('ENTRADA', 'ATRIBUIDA') and not f.comecou))[1] as livre_em,
           count(*) filter (where f.situacao in ('ENTRADA', 'ATRIBUIDA') and not f.comecou
                              and f.lat is null) as sem_coordenada,
           coalesce(jsonb_agg(jsonb_build_object(
             'id', f.visita_id, 'contrato', f.contrato, 'lat', f.lat::float8, 'lng', f.lng::float8,
             'ji', f.janela_inicio, 'jf', f.janela_fim, 'conta', f.conta,
             'prazo', f.prazo_chegada, 'prazo_fim', f.prazo_fim,
             'desl', f.deslocamento_min, 'dur', f.duracao_min) order by f.ordem)
             filter (where f.situacao in ('ENTRADA', 'ATRIBUIDA') and not f.comecou
                       and f.lat is not null), '[]'::jsonb) as itens
      from fila_do_dia() f
     where v_eh_hoje
     group by f.fila
    union all
    -- ── DIA PASSADO: o que foi executado, pelo início real. Partida = o
    --    primeiro contrato do dia (o mesmo nas duas ordens).
    select x.tecnico_responsavel_id, x.tecnico_responsavel_id, min(x.tecnico),
           min(x.equipe_id::text)::uuid, min(x.equipe),
           (array_agg(x.lat order by x.inicio) filter (where x.lat is not null))[1],
           (array_agg(x.lng order by x.inicio) filter (where x.lat is not null))[1],
           (array_agg(x.contrato order by x.inicio) filter (where x.lat is not null))[1],
           null::float8, null::float8, null::timestamptz, null::timestamptz,
           count(*) filter (where x.lat is null),
           coalesce(jsonb_agg(jsonb_build_object(
             'id', x.id, 'contrato', x.contrato, 'lat', x.lat, 'lng', x.lng,
             'ji', x.janela_inicio, 'jf', x.janela_fim) order by x.inicio)
             filter (where x.lat is not null and x.n > 1), '[]'::jsonb)
      from (
        select v.id, v.contrato, v.tecnico_responsavel_id, t.nome as tecnico, v.equipe_id, e.codigo as equipe,
               v.lat::float8 as lat, v.lng::float8 as lng, v.inicio, v.janela_inicio, v.janela_fim,
               row_number() over (partition by v.tecnico_responsavel_id
                                  order by (v.lat is null), v.inicio, v.id) as n
          from visita v
          left join tipo_atividade ta on ta.id = v.tipo_atividade_id
          left join tecnico t on t.id = v.tecnico_responsavel_id
          left join equipe e on e.id = v.equipe_id
         where not v_eh_hoje
           and v.empresa_id = (select minha_empresa()) and v.excluido_em is null
           and v.data_agendada = v_data
           and v.tecnico_responsavel_id is not null and v.inicio is not null
           and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
           -- Alguém FOI: o TOA abriu e fechou; nem cancelado pela central nem
           -- desatribuído (D-227).
           and norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) in ('CONCLUIDO', 'NAO CONCLUIDO')
           and not exists (select 1 from ordem_servico o
                             join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                            where o.visita_id = v.id and cb.codigo = 800)
           and v.base_id in (select bases_visiveis())
           and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
      ) x
     group by x.tecnico_responsavel_id
  loop
    it := g.itens;
    n := jsonb_array_length(it);
    continue when n < 2;   -- com uma parada só não há ordem a sugerir

    -- A partida
    if v_eh_hoje then
      v_plat := coalesce(g.at_lat, g.r_lat); v_plng := coalesce(g.at_lng, g.r_lng);
      if v_plat is null then
        select v.lat::float8, v.lng::float8 into v_plat, v_plng
          from visita v
         where v.tecnico_responsavel_id = g.tecnico_id and v.data_agendada = v_data
           and v.excluido_em is null and v.situacao = 'CONCLUIDA' and v.lat is not null
         order by coalesce(v.fim, v.situacao_em) desc limit 1;
      end if;
    else
      v_plat := g.at_lat; v_plng := g.at_lng;
    end if;

    -- A sugerida: prazo mais cedo primeiro; na mesma janela, o mais perto.
    v_usado := array_fill(false, array[n]);
    v_seq := '{}';
    v_ant_lat := v_plat; v_ant_lng := v_plng;
    for v_passo in 1..n loop
      -- o bloco: a janela que fecha primeiro entre as que sobram
      v_tem_bloco := false; v_bjf := null; v_bji := null;
      for i in 1..n loop
        continue when v_usado[i];
        if not v_tem_bloco
           or ((it->(i-1)->>'jf')::time is not null and v_bjf is null)
           or ((it->(i-1)->>'jf')::time < v_bjf)
           or ((it->(i-1)->>'jf')::time is not distinct from v_bjf
               and (it->(i-1)->>'ji')::time is not null
               and (v_bji is null or (it->(i-1)->>'ji')::time < v_bji)) then
          v_tem_bloco := true;
          v_bjf := (it->(i-1)->>'jf')::time; v_bji := (it->(i-1)->>'ji')::time;
        end if;
      end loop;
      -- dentro do bloco, o mais perto (sem partida: o primeiro do TOA)
      melhor := null; v_dmelhor := null;
      for i in 1..n loop
        continue when v_usado[i]
          or (it->(i-1)->>'jf')::time is distinct from v_bjf
          or (it->(i-1)->>'ji')::time is distinct from v_bji;
        if v_ant_lat is null then
          melhor := i; exit;
        end if;
        v_d := distancia_m(v_ant_lat, v_ant_lng, (it->(i-1)->>'lat')::float8, (it->(i-1)->>'lng')::float8);
        if melhor is null or v_d < v_dmelhor then melhor := i; v_dmelhor := v_d; end if;
      end loop;
      v_usado[melhor] := true;
      v_seq := v_seq || melhor;
      v_ant_lat := (it->(melhor-1)->>'lat')::float8; v_ant_lng := (it->(melhor-1)->>'lng')::float8;
    end loop;

    -- As duas ordens, medidas igual: km de linha reta e (hoje) fora da janela.
    v_km_toa := 0; v_km_sug := 0; v_fora_toa := 0; v_fora_sug := 0;
    v_lista_toa := '[]'; v_lista_sug := '[]';
    for k in 1..2 loop
      if k = 1 then v_ordem := array(select generate_series(1, n)); else v_ordem := v_seq; end if;
      v_ant_lat := v_plat; v_ant_lng := v_plng; v_t := g.livre_em;
      for v_passo in 1..n loop
        i := v_ordem[v_passo];
        v_leg := case when v_ant_lat is null then null
                      else distancia_m(v_ant_lat, v_ant_lng, (it->(i-1)->>'lat')::float8,
                                       (it->(i-1)->>'lng')::float8) / 1000.0 end;
        if k = 1 then v_km_toa := v_km_toa + coalesce(v_leg, 0);
        else v_km_sug := v_km_sug + coalesce(v_leg, 0); end if;

        if v_eh_hoje and v_t is not null then
          v_cheg := v_t + make_interval(mins => (it->(i-1)->>'desl')::numeric::int);
          v_ini := greatest(v_cheg, (v_data + coalesce((it->(i-1)->>'ji')::time, time '00:00'))
                                     at time zone 'America/Manaus');
          v_fim := v_ini + make_interval(mins => (it->(i-1)->>'dur')::numeric::int);
          if (it->(i-1)->>'conta')::boolean and (it->(i-1)->>'prazo') is not null
             and least((it->(i-1)->>'prazo')::timestamptz - v_cheg,
                       (it->(i-1)->>'prazo_fim')::timestamptz - v_fim) < interval '0' then
            if k = 1 then v_fora_toa := v_fora_toa + 1; else v_fora_sug := v_fora_sug + 1; end if;
          end if;
          v_t := v_fim;
        end if;

        if k = 1 then
          v_lista_toa := v_lista_toa || jsonb_build_object(
            'visita_id', it->(i-1)->>'id', 'contrato', it->(i-1)->>'contrato',
            'janela', to_char((it->(i-1)->>'ji')::time, 'HH24:MI') || '–' || to_char((it->(i-1)->>'jf')::time, 'HH24:MI'),
            'km', round(v_leg::numeric, 1));
        else
          v_lista_sug := v_lista_sug || jsonb_build_object(
            'visita_id', it->(i-1)->>'id', 'contrato', it->(i-1)->>'contrato',
            'janela', to_char((it->(i-1)->>'ji')::time, 'HH24:MI') || '–' || to_char((it->(i-1)->>'jf')::time, 'HH24:MI'),
            'km', round(v_leg::numeric, 1), 'era', i);
        end if;
        v_ant_lat := (it->(i-1)->>'lat')::float8; v_ant_lng := (it->(i-1)->>'lng')::float8;
      end loop;
    end loop;

    v_total_toa := v_total_toa + v_km_toa;
    v_total_sug := v_total_sug + v_km_sug;

    v_tecs := v_tecs || jsonb_build_object(
      'fila', g.fila, 'tecnico_id', g.tecnico_id, 'tecnico', g.tecnico,
      'equipe_id', g.equipe_id, 'equipe', g.equipe,
      'login', (select coalesce(nullif(btrim(coalesce(v.dados_origem->>'Login do Técnico', '')), ''),
                                login_do_recurso(v.base_id, v.dados_origem->>'ID do Recurso'))
                  from visita v where v.id = (it->0->>'id')::uuid),
      'partida', case when v_plat is null then null
                      when not v_eh_hoje then 'PRIMEIRO_DO_DIA'
                      when g.at_lat is not null then 'CONTRATO_ATUAL'
                      when g.r_lat is not null then 'RASTRO'
                      else 'ULTIMO_CONCLUIDO' end,
      'partida_contrato', case when v_plat is not null and g.at_lat is not null then g.at_contrato end,
      'paradas', n, 'sem_coordenada', g.sem_coordenada,
      'km_toa', round(v_km_toa::numeric, 1), 'km_sugerido', round(v_km_sug::numeric, 1),
      'km_ganho', round((v_km_toa - v_km_sug)::numeric, 1),
      'min_ganho', case when v_vel is not null
                        then round(((v_km_toa - v_km_sug) / v_vel * 60)::numeric) end,
      'fora_janela_toa', case when v_eh_hoje and g.livre_em is not null then v_fora_toa end,
      'fora_janela_sugerida', case when v_eh_hoje and g.livre_em is not null then v_fora_sug end,
      'oferecer', round((v_km_toa - v_km_sug)::numeric, 1) > 0
                  and not (v_eh_hoje and g.livre_em is not null and v_fora_sug > v_fora_toa),
      'ordem_toa', v_lista_toa, 'ordem_sugerida', v_lista_sug);
  end loop;

  return jsonb_build_object(
    'data', v_data, 'base_ordem', case when v_eh_hoje then 'TOA' else 'EXECUTADA' end,
    'velocidade_kmh', v_vel, 'velocidade_trechos', v_trechos,
    'km_toa', round(v_total_toa::numeric, 1), 'km_sugerido', round(v_total_sug::numeric, 1),
    'km_ganho', round((v_total_toa - v_total_sug)::numeric, 1),
    'tecnicos', (select coalesce(jsonb_agg(t order by (t->>'km_ganho')::numeric desc), '[]'::jsonb)
                   from jsonb_array_elements(v_tecs) t));
end;
$$;
revoke all on function public.ordem_sugerida(date) from public, anon;
grant execute on function public.ordem_sugerida(date) to authenticated;

notify pgrst, 'reload schema';
