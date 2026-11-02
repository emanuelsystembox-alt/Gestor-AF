-- 176 · TEC1 em risco, ao vivo
--
-- O QUE RESOLVE
--   O TEC1 vale meta com a CLARO (94%, D-187) e até aqui só aparecia DEPOIS:
--   o sinal "TEC1 perdido" nasce quando o TOA fecha a atividade fora do
--   padrão, e o "Janela acabando sem chegada" (ATRASO) avisa 30 min antes do
--   fim da janela — tarde para mandar outro técnico.
--
--   "TEC1 em risco, ao vivo. A central recebe: contrato X vai estourar a
--    janela em 40 min" — pacote aprovado pelo Emanuel em 02/11.
--
-- A PREVISÃO (de onde vem cada número)
--   Para cada técnico (sem técnico, a equipe), a fila do dia na ordem do TOA:
--   o que está em execução, o que está a caminho, e o resto pelo início que o
--   TOA planejou. Cada contrato ocupa DESLOCAMENTO + DURAÇÃO, e ninguém começa
--   antes de a janela abrir.
--     · DURAÇÃO e DESLOCAMENTO são a MEDIANA do próprio TOA, por grupo de
--       serviço, nos 30 dias anteriores (colunas "Duração" e "Tempo de
--       Deslocamento" dos contratos CONCLUÍDOS). Medido em 02/11: adesão 56 e
--       14 min (1.342 contratos), VT 48 e 16 (843), serviço 36 e 14 (508),
--       migração GPON 78,5 e 15 (290).
--     · Quando o TOA já trouxe o deslocamento DAQUELE contrato, vale o dele.
--   O prazo é o do livro (D-187, `tec1_da_os`): começar até o fim da janela e
--   terminar antes de fim + tolerância (2 h / 1 h, `tipo_servico`).
--
--   A posição do técnico NÃO entra na conta: em 02/11 o rastro tinha 8
--   técnicos com ponto em 13 dias (17 trechos medidos em movimento) — pouco
--   para tirar velocidade. Quando há ponto dos últimos 20 min, a distância vai
--   junto como INFORMAÇÃO ("a 9,2 km às 14:10"). O início planejado pelo TOA
--   também vai como informação, não como decisão.
--
-- O SINAL
--   TEC1_RISCO, só ANTES de o ATRASO começar (fim da janela além da
--   antecedência): depois disso o ATRASO já fala do mesmo contrato. A chave
--   leva o nível — se o risco vira "vai estourar", avisa de novo (D-169).
--   Só contrato que CONTA no TEC1 (`tec1_janela_conta`, as regras de expurgo
--   da janela e do tipo, que agora moram num lugar só).

-- Minutos de um "HH:MM" do TOA. Nulo quando não é isso.
create or replace function public.minutos_de_hhmm(p text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case when btrim(p) ~ '^\d{1,3}:\d{2}$'
              then split_part(btrim(p), ':', 1)::int * 60 + split_part(btrim(p), ':', 2)::int end;
$$;
revoke all on function public.minutos_de_hhmm(text) from public, anon;
grant execute on function public.minutos_de_hhmm(text) to authenticated;

/*
 * A janela e o tipo de O.S. contam no TEC1? (D-187, livro da CLARO, itens 6 e 9)
 * Tirado de dentro de `tec1_da_os` para a previsão usar a MESMA regra.
 */
create or replace function public.tec1_janela_conta(
  p_intervalo text, p_janela_inicio time, p_janela_fim time, p_tipo_os text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select not (
    -- 9 . O.S. imediata e janela vazia não são contabilizadas.
    norm_txt(coalesce(p_intervalo, '')) in ('IMEDIATA', '')
    or p_janela_inicio is null or p_janela_fim is null
    -- 6 . Janela de atendimento 08:00 - 22:00.
    or (p_janela_inicio = time '08:00' and p_janela_fim = time '22:00')
    -- 6 . Tipos de O.S. fora do indicador.
    or norm_txt(coalesce(p_tipo_os, '')) in ('MANUTENCAO CORRETIVA - MDU', 'MANUTENCAO PREVENTIVA - MDU',
                'MANUTENCAO PREVENTIVA INDOOR', 'VARREDURA DE REDE EXTERNA',
                'DESCONEXAO POR OPCAO EBT'));
$$;
revoke all on function public.tec1_janela_conta(text, time, time, text) from public, anon;
grant execute on function public.tec1_janela_conta(text, time, time, text) to authenticated;

-- A mesma de antes (lida do banco em 02/11), com os três expurgos de janela e
-- tipo trocados pela função acima. Conferido: resultado idêntico em 60 dias.
CREATE OR REPLACE FUNCTION public.tec1_da_os(p_os uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_status text; v_motivo text;
  v_tol int;
  v_ini_janela timestamptz; v_fim_janela timestamptz;
  v_executado boolean; v_reagendada boolean;
begin
  select o.id, o.status_operadora,
         t.descricao as tipo_os,
         v.situacao, v.data_agendada, v.janela_inicio, v.janela_fim, v.inicio, v.fim,
         v.dados_origem,
         ts.tec1_carencia_min
    into r
    from ordem_servico o
    join visita v on v.id = o.visita_id
    left join tipo_os t on t.id = o.tipo_os_id
    left join tipo_servico ts on ts.id = v.tipo_servico_id
   where o.id = p_os;
  if r.id is null then return null; end if;

  -- So entra o que foi ENCERRADO no TOA. Em aberto = pendente, fica de fora
  -- (inclusive o "Sem tratamento" de dia passado; Emanuel, 19/10).
  v_status := norm_txt(coalesce(r.dados_origem->>'Status da Atividade', ''));
  if v_status not in ('CONCLUIDO', 'NAO CONCLUIDO') then return null; end if;

  -- 6 . Expurgos. Cancelado pelo sistema NETSMS (D-047).
  v_motivo := norm_txt(coalesce(r.dados_origem->>'Motivo de Fechamento Externo', ''));
  if v_status = 'NAO CONCLUIDO' and v_motivo = 'CANCELADO NO SISTEMA NETSMS' then
    return 'EXPURGADA';
  end if;
  -- 6 e 9 . Janela imediata, vazia ou 08-22, e tipos fora do indicador (176).
  if not tec1_janela_conta(r.dados_origem->>'Intervalo de Tempo',
                           r.janela_inicio, r.janela_fim, r.tipo_os) then
    return 'EXPURGADA';
  end if;

  if r.fim is null then return null; end if;

  v_ini_janela := (r.data_agendada + r.janela_inicio) at time zone 'America/Manaus';
  v_fim_janela := (r.data_agendada + r.janela_fim)    at time zone 'America/Manaus';

  v_executado := case
    when r.status_operadora is not null then r.status_operadora = 'EXECUTADA'
    else r.situacao = 'CONCLUIDA'
  end;

  if not v_executado then
    -- Cancelada ou reagendada (11.1-11.3, 11.7-11.9).
    v_reagendada := r.situacao = 'REAGENDAMENTO';
    if r.fim < v_ini_janela and (v_reagendada or r.inicio is null) then
      return 'EXPURGADA';
    end if;
    return case when r.fim <= v_fim_janela then 'PADRAO' else 'SEM_PADRAO' end;
  end if;

  -- Executada (11.1, 11.4-11.6).
  if r.inicio is null then
    if r.fim < v_ini_janela then return 'EXPURGADA'; end if;
    return null;
  end if;
  if r.fim < v_ini_janela then return 'PADRAO'; end if;

  v_tol := coalesce(r.tec1_carencia_min, 120);
  return case
    when r.inicio <= v_fim_janela
     and r.fim    <  v_fim_janela + make_interval(mins => v_tol)
    then 'PADRAO' else 'SEM_PADRAO'
  end;
end;
$function$;

/*
 * Os contratos de hoje cujo TEC1 está em risco, com a conta à vista.
 * Gestão, cidade ativa (como o resto da central).
 *
 * nivel: VAI_ESTOURAR (a previsão já passa do prazo) · EM_RISCO (sobra menos
 * que a antecedência do ATRASO, `atraso_antecedencia_min`) · PERDIDO (a janela
 * fechou e ninguém começou). O resto não volta.
 */
create or replace function public.tec1_em_risco()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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

  -- A régua do próprio TOA: mediana de 30 dias, por grupo de serviço. A linha
  -- do rollup (todos os grupos) cobre o grupo sem histórico.
  select coalesce(jsonb_agg(jsonb_build_object('tipo_servico_id', x.tipo_servico_id,
                                               'dur', x.dur, 'desl', x.desl, 'geral', x.geral)), '[]')
    into v_ref
    from (select v.tipo_servico_id, grouping(v.tipo_servico_id) = 1 as geral,
                 percentile_cont(0.5) within group (order by minutos_de_hhmm(v.dados_origem->>'Duração')) as dur,
                 percentile_cont(0.5) within group (order by minutos_de_hhmm(v.dados_origem->>'Tempo de Deslocamento'))
                   filter (where minutos_de_hhmm(v.dados_origem->>'Tempo de Deslocamento') > 0) as desl
            from visita v
           where v.empresa_id = (select minha_empresa()) and v.excluido_em is null
             and v.data_agendada between v_hoje - 30 and v_hoje - 1
             and norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) = 'CONCLUIDO'
           group by rollup (v.tipo_servico_id)) x;
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
$$;
revoke all on function public.tec1_em_risco() from public, anon;
grant execute on function public.tec1_em_risco() to authenticated;

alter table sinal drop constraint sinal_tipo_check;
alter table sinal add constraint sinal_tipo_check check (tipo = any (array[
  'AJUDA', 'TEC1', 'RITMO', 'QUEBROU', 'MATERIAL', 'ABASTECIMENTO', 'CERCA', 'GPS',
  'DOIS_ATIVOS', 'SUMIU_TOA', 'LOCAL', 'ATRASO', 'TEC1_RISCO']));

-- sinais_do_dia: a mesma do banco (lida em 02/11), com o bloco TEC1_RISCO
-- logo depois do ATRASO e o tipo novo na lista da gestão.
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
           when s.tipo in ('AJUDA','TEC1','RITMO','QUEBROU','CERCA','GPS','DOIS_ATIVOS','SUMIU_TOA','LOCAL','ATRASO','TEC1_RISCO')
             then v_gestao and ((select ve_cidade_inteira()) or s.equipe_id in (select equipes_visiveis()))
           when s.tipo = 'MATERIAL' then tem_permissao('almoxarifado.ver')
           when s.tipo = 'ABASTECIMENTO' then tem_permissao('frota.ver')
           else false
         end;

  return jsonb_build_object('central', v_c, 'sinais', v_sinais);
end;
$function$;

notify pgrst, 'reload schema';
