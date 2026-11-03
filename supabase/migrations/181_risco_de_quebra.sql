-- 181 · Risco de quebra antes do despacho
--
-- O QUE RESOLVE
--   A quebra (O.S. com baixa IMPRODUTIVA da operadora, D-167) só aparece
--   DEPOIS: o técnico foi, o cliente não estava, o contrato voltou. O maior
--   grupo é AGENDAMENTO (106 · Cliente Ausente: 167 O.S. de 17/10 a 02/11).
--   Pacote de inteligência de 02/11 (D-262): avisar ANTES de perder — a COP
--   liga para o cliente antes, ou manda o técnico mais experiente.
--
-- O QUE NÃO FAZ (D-262)
--   É SUGESTÃO para a gestão, no site. Nada muda sozinho, nada vai para o app
--   do técnico, nenhum aviso no sino. A faixa e os motivos ficam ao lado; quem
--   opera decide.
--
-- DE ONDE VEM CADA NÚMERO (nenhum peso escrito à mão)
--   Para cada cidade e cada dia, a régua sai do PRÓPRIO histórico da cidade,
--   nos 60 dias antes do dia (o dia não entra):
--     · população: contrato produtivo (sem jornada), não excluído, com baixa
--       da operadora em alguma O.S. (sem baixa = resultado DESCONHECIDO, fica
--       fora — não é "não quebrou"); fora também o cancelado pela central, o
--       desatribuído e o 800 (a mesma exclusão de `impacto_quebra`, 143);
--     · quebra: alguma O.S. com natureza IMPRODUTIVA, fora SEM_QUEBRA e fora o
--       que leva a CONCLUIDA — a mesma conta de `impacto_quebra`, por contrato;
--     · para cada fator (família + valor): taxa de quebra, e a RAZÃO contra a
--       taxa da cidade, suavizada (20 contratos "fantasmas" na taxa da cidade,
--       para 3 de 5 não virar 60%).
--   Um fator só vale (aceito) com as três: pelo menos 30 contratos; o piso do
--   intervalo de confiança (Wilson, 95% unilateral) ACIMA da taxa da cidade —
--   não basta estar acima por acaso —; e razão de pelo menos 1,25. A cidade
--   precisa de 300 contratos com resultado na janela; menos que isso a tela
--   diz "sem histórico", não "baixo".
--
-- AS FAMÍLIAS CANDIDATAS (cada valor passa ou não pela regra acima, todo dia)
--   GRUPO (grupo de serviço) · JANELA (hora de início da janela) · BAIRRO ·
--   SEGMENTACAO · EDIFICACAO (`edificacao_de`) · LOG ("Contador de log" do TOA,
--   0/1/2/3+; conferido: o valor da 1ª importação é IGUAL ao final em 4.489 de
--   4.489 contratos, então não vaza o resultado) · ANTERIOR (o contrato passou
--   antes e não concluiu: a O.S. já esteve numa instalação não concluída —
--   `sinais_das_visitas`, D-261 — ou o contrato quebrou nos 30 dias antes) ·
--   VAI_E_VOLTA (VT da VT / retorno do retorno, `sinais_das_visitas`) ·
--   REVISITA (`revisita_dos_contratos`, D-245).
--   Fora de propósito: área (`visita.area_id` vazia em 100%), telefone
--   (`visita.telefones` vazio em 100%), tipo de pessoa (vazio em 100%) e dia
--   da semana (é igual para o dia inteiro: não ordena nada).
--
-- A FAIXA
--   O fator do contrato é o PRODUTO das razões dos fatores aceitos que ele tem.
--   ALTO = 2× a taxa da cidade ou mais · MÉDIO = algum motivo, menos que 2× ·
--   BAIXO = nenhum motivo. Só fatores que AUMENTAM o risco entram: um fator que
--   abaixa não vira motivo escondido.
--
-- VALIDADO PARA TRÁS (ver integracao.md da fase): régua de 17 a 26/10, teste
-- de 27/10 a 01/11 (dias que não entraram na conta), Manaus.
--
-- CUSTO
--   A régua é cara (60 dias de contratos pelas funções de sinal e revisita):
--   fica em `risco_quebra_fator`, uma vez por cidade por dia. A tela calcula
--   sozinha na primeira leitura do dia se o relógio ainda não calculou; o
--   pg_cron pode adiantar (05h30 de Manaus = 09h30 UTC):
--     select cron.schedule('risco-de-quebra', '30 9 * * *',
--       $$select public.rodar_por_cidade('recalcular_risco_quebra')$$);

create table if not exists public.risco_quebra_fator (
  empresa_id   uuid not null references empresa(id),
  base_id      uuid not null references base(id),
  dia          date not null,        -- o dia que esta régua serve (ela vem de antes dele)
  familia      text not null,        -- BASE = a taxa da cidade
  valor        text not null,
  n            integer not null,
  quebras      integer not null,
  taxa         numeric not null,     -- quebras / n
  razao        numeric,              -- suavizada ÷ taxa da cidade
  piso         numeric,              -- Wilson 95% unilateral
  aceito       boolean not null,
  de           date not null,
  ate          date not null,
  calculado_em timestamptz not null default now(),
  primary key (base_id, dia, familia, valor)
);
alter table public.risco_quebra_fator enable row level security;
-- Sem policy de propósito: só as funções abaixo leem e escrevem.
revoke all on table public.risco_quebra_fator from anon, authenticated;

/*
 * Os fatores de cada contrato, um por linha (família, valor, detalhe).
 * A MESMA função serve a régua (contratos do passado) e o dia (contratos de
 * hoje) — o que se mede é exatamente o que se aplica.
 * Tudo olha só para TRÁS do dia do contrato (as funções de sinal e revisita
 * já são assim; a quebra anterior, aqui, também).
 * DEFINER porque o contrato anterior pode ser de outra equipe; a resposta não
 * carrega dado do cliente. Fechada a authenticated: só as funções daqui chamam.
 */
create or replace function public._risco_quebra_fatores(p_visitas uuid[])
returns table (visita_id uuid, familia text, valor text, detalhe text)
language sql
stable
security definer
set search_path = public
as $$
  with alvo as materialized (
    select v.id, v.empresa_id, v.contrato, v.data_agendada as dia, ts.nome as grupo,
           v.janela_inicio, nullif(norm_txt(v.bairro), '') as bairro, s.nome as seg,
           edificacao_de(v.tipo_residencia, v.complemento, v.logradouro) as ed,
           case when btrim(v.dados_origem->>'Contador de log') ~ '^\d+$'
                then btrim(v.dados_origem->>'Contador de log')::int end as clog
      from visita v
      left join tipo_servico ts on ts.id = v.tipo_servico_id
      left join segmentacao s on s.id = v.segmentacao_id
     where v.id = any (p_visitas)
  ),
  sin as materialized (select * from sinais_das_visitas(p_visitas)),
  rev as materialized (select * from revisita_dos_contratos(p_visitas) r where r.revisita),
  -- A quebra mais recente do MESMO contrato nos 30 dias antes (a mesma conta
  -- de quebra de `impacto_quebra`, por O.S.).
  ant as materialized (
    select a.id, q.dia, q.codigo, q.descricao, q.agrupamento
      from alvo a
      cross join lateral (
        select v2.data_agendada as dia, c.codigo, c.descricao,
               agrupamento_da_quebra(c.agrupamento_quebra, c.agrupamento_quebra_vt, ts2.nome) as agrupamento
          from visita v2
          join ordem_servico o on o.visita_id = v2.id
          join codigo_baixa c on c.id = o.codigo_baixa_id
          left join tipo_servico ts2 on ts2.id = v2.tipo_servico_id
         where a.contrato is not null
           and v2.empresa_id = a.empresa_id and v2.contrato = a.contrato
           and v2.excluido_em is null
           and v2.data_agendada >= a.dia - 30 and v2.data_agendada < a.dia
           and c.natureza = 'IMPRODUTIVA'
           and coalesce(c.situacao_destino, '') <> 'CONCLUIDA'
           and coalesce(agrupamento_da_quebra(c.agrupamento_quebra, c.agrupamento_quebra_vt, ts2.nome), '') <> 'SEM_QUEBRA'
         order by v2.data_agendada desc, o.sequencia
         limit 1) q
  )
  select a.id, 'GRUPO', a.grupo, null::text from alvo a where a.grupo is not null
  union all
  select a.id, 'JANELA', to_char(a.janela_inicio, 'HH24') || 'h', null from alvo a where a.janela_inicio is not null
  union all
  select a.id, 'BAIRRO', a.bairro, null from alvo a where a.bairro is not null
  union all
  select a.id, 'SEGMENTACAO', a.seg, null from alvo a where a.seg is not null
  union all
  select a.id, 'EDIFICACAO', a.ed, null from alvo a where a.ed is not null
  union all
  select a.id, 'LOG', case when a.clog >= 3 then '3+' else a.clog::text end, null
    from alvo a where a.clog is not null
  union all
  -- Passou antes e não concluiu: quebrou (com o código), ou a O.S. esteve numa
  -- instalação que não fechou (D-261). Um fator só — os dois são quase o mesmo
  -- contrato (34 de 44 quebras anteriores tinham também o sinal, 17–26/10).
  select a.id, 'ANTERIOR', 'SIM',
         case when an.id is not null
              then 'quebrou em ' || to_char(an.dia, 'DD/MM') || ' · ' || an.codigo || ' ' || an.descricao
              else 'O.S. em visita não concluída em ' || to_char(s.anterior_data, 'DD/MM') end
    from alvo a
    left join ant an on an.id = a.id
    left join sin s on s.visita_id = a.id and s.revisita_motivo = 'OS_NAO_CONCLUIDA'
   where an.id is not null or s.visita_id is not null
  union all
  select s.visita_id, 'VAI_E_VOLTA', s.revisita_motivo, 'anterior em ' || to_char(s.anterior_data, 'DD/MM')
    from sin s where s.revisita_motivo in ('VT_DA_VT', 'RETORNO_DO_RETORNO')
  union all
  select r.visita_id, 'REVISITA', 'SIM',
         'concluída em ' || to_char(r.anterior_data, 'DD/MM') || coalesce(' por ' || r.anterior_tecnico, '')
    from rev r;
$$;
revoke all on function public._risco_quebra_fatores(uuid[]) from public, anon, authenticated;

/*
 * A régua de uma cidade para um dia: taxas dos 60 dias antes dele.
 * Interna (sem conferência de papel): só a leitura e o relógio chamam.
 */
create or replace function public._recalcular_risco_quebra(p_base uuid, p_dia date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid;
  v_de  date := p_dia - 60;
  v_ate date := p_dia - 1;
  v_hist uuid[];
  v_quebrou uuid[];
  v_n int; v_q int; v_pb numeric;
  v_linhas int;
  z constant numeric := 1.645;    -- 95% unilateral
  k constant numeric := 20;       -- contratos "fantasmas" da suavização
begin
  select b.empresa_id into v_emp from base b where b.id = p_base;
  if v_emp is null then return 0; end if;

  with hist as materialized (
    select v.id,
           exists (select 1 from ordem_servico o
                     join codigo_baixa c on c.id = o.codigo_baixa_id
                    where o.visita_id = v.id
                      and c.natureza = 'IMPRODUTIVA'
                      and coalesce(c.situacao_destino, '') <> 'CONCLUIDA'
                      and coalesce(agrupamento_da_quebra(c.agrupamento_quebra, c.agrupamento_quebra_vt, ts.nome), '') <> 'SEM_QUEBRA') as quebra
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join tipo_servico ts on ts.id = v.tipo_servico_id
     where v.empresa_id = v_emp and v.base_id = p_base and v.excluido_em is null
       and v.data_agendada between v_de and v_ate
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       -- resultado conhecido: alguma O.S. com baixa da operadora
       and exists (select 1 from ordem_servico o where o.visita_id = v.id and o.codigo_baixa_id is not null)
       -- o que não é quebra da operação (143): cancelado pela central, desatribuído, 800
       and not (v.situacao = 'CANCELADA' and (
             norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) = 'CANCELADO'
             or v.desatribuido_em is not null
             or exists (select 1 from ordem_servico o2
                          join codigo_baixa c2 on c2.id = o2.codigo_baixa_afline_id
                         where o2.visita_id = v.id and c2.codigo = 800)))
  )
  select coalesce(array_agg(id), '{}'), coalesce(array_agg(id) filter (where quebra), '{}')
    into v_hist, v_quebrou
    from hist;

  v_n := coalesce(array_length(v_hist, 1), 0);
  v_q := coalesce(array_length(v_quebrou, 1), 0);
  v_pb := case when v_n > 0 then v_q::numeric / v_n end;

  delete from risco_quebra_fator where base_id = p_base and dia = p_dia;
  -- Guarda 90 dias de régua (para responder "por que estava alto no dia X").
  delete from risco_quebra_fator where base_id = p_base and dia < p_dia - 90;

  insert into risco_quebra_fator (empresa_id, base_id, dia, familia, valor, n, quebras, taxa,
                                  razao, piso, aceito, de, ate)
  values (v_emp, p_base, p_dia, 'BASE', '*', v_n, v_q, coalesce(v_pb, 0), 1, null,
          v_n >= 300, v_de, v_ate);

  if v_n > 0 and v_q > 0 then
    insert into risco_quebra_fator (empresa_id, base_id, dia, familia, valor, n, quebras, taxa,
                                    razao, piso, aceito, de, ate)
    select v_emp, p_base, p_dia, x.familia, x.valor, x.n, x.q, x.p,
           round(((x.q + k * v_pb) / (x.n + k)) / v_pb, 3),
           round(x.lb, 4),
           v_n >= 300 and x.n >= 30 and x.lb > v_pb and ((x.q + k * v_pb) / (x.n + k)) / v_pb >= 1.25,
           v_de, v_ate
      from (select f.familia, f.valor, count(*) as n,
                   count(*) filter (where f.visita_id = any (v_quebrou)) as q,
                   count(*) filter (where f.visita_id = any (v_quebrou))::numeric / count(*) as p
              from _risco_quebra_fatores(v_hist) f
             group by 1, 2) y
      cross join lateral (
        select y.familia, y.valor, y.n, y.q, y.p,
               -- Wilson: piso do intervalo
               (y.p + z * z / (2 * y.n) - z * sqrt(y.p * (1 - y.p) / y.n + z * z / (4.0 * y.n * y.n)))
                 / (1 + z * z / y.n) as lb) x;
  end if;

  get diagnostics v_linhas = row_count;
  return v_linhas;
end;
$$;
revoke all on function public._recalcular_risco_quebra(uuid, date) from public, anon, authenticated;

/*
 * A faixa de cada contrato, com a régua de um dia (a do dia do contrato, na
 * tela; a de um dia de corte, na validação para trás).
 */
create or replace function public._risco_quebra_pontuar(p_visitas uuid[], p_regua date)
returns table (visita_id uuid, faixa text, fator numeric, motivos jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with vis as materialized (
    select v.id, v.base_id from visita v where v.id = any (p_visitas)
  ),
  base as materialized (
    select r.base_id, r.taxa, r.aceito from risco_quebra_fator r
     where r.dia = p_regua and r.familia = 'BASE'
       and r.base_id in (select distinct base_id from vis)
  ),
  mot as (
    select f.visita_id, f.familia, f.valor, f.detalhe, r.taxa, r.razao, r.n
      from _risco_quebra_fatores(p_visitas) f
      join vis on vis.id = f.visita_id
      join risco_quebra_fator r on r.base_id = vis.base_id and r.dia = p_regua
                               and r.familia = f.familia and r.valor = f.valor and r.aceito
  )
  select vis.id,
         case when b.aceito is not true then 'SEM_HISTORICO'
              when exp(sum(ln(m.razao))) >= 2 then 'ALTO'
              when count(m.familia) > 0 then 'MEDIO'
              else 'BAIXO' end,
         case when b.aceito then round(coalesce(exp(sum(ln(m.razao))), 1), 2) end,
         coalesce(jsonb_agg(jsonb_build_object(
             'familia', m.familia, 'valor', m.valor, 'detalhe', m.detalhe,
             'taxa', round(m.taxa * 100, 1), 'razao', m.razao, 'n', m.n)
           order by m.razao desc) filter (where m.familia is not null and b.aceito), '[]')
    from vis
    left join base b on b.base_id = vis.base_id
    left join mot m on m.visita_id = vis.id
   group by vis.id, b.aceito;
$$;
revoke all on function public._risco_quebra_pontuar(uuid[], date) from public, anon, authenticated;

/*
 * A régua de hoje da cidade ativa — a porta do relógio (`rodar_por_cidade`).
 */
create or replace function public.recalcular_risco_quebra()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_base uuid;
begin
  if not eh_gestao() then
    raise exception 'O risco de quebra é da gestão.' using errcode = '42501';
  end if;
  select case when count(*) = 1 then min(b::text)::uuid end into v_base from bases_visiveis() b;
  if v_base is null then
    raise exception 'Escolha uma cidade no topo.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('risco_quebra:' || v_base));
  return _recalcular_risco_quebra(v_base, hoje_local());
end;
$$;
revoke all on function public.recalcular_risco_quebra() from public, anon, authenticated;

/*
 * A tela: os contratos de HOJE ainda não executados, da cidade ativa, com a
 * faixa e os motivos. Calcula a régua do dia na primeira leitura, se o relógio
 * ainda não calculou.
 */
create or replace function public.risco_quebra_do_dia()
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
  v_regua jsonb;
  v_out jsonb;
begin
  if not eh_gestao() then
    raise exception 'O risco de quebra é da gestão.' using errcode = '42501';
  end if;
  select case when count(*) = 1 then min(b::text)::uuid end into v_base from bases_visiveis() b;
  if v_base is null then
    raise exception 'Escolha uma cidade no topo.' using errcode = '22023';
  end if;

  if not exists (select 1 from risco_quebra_fator
                  where base_id = v_base and dia = v_hoje and familia = 'BASE') then
    perform pg_advisory_xact_lock(hashtext('risco_quebra:' || v_base));
    if not exists (select 1 from risco_quebra_fator
                    where base_id = v_base and dia = v_hoje and familia = 'BASE') then
      perform _recalcular_risco_quebra(v_base, v_hoje);
    end if;
  end if;

  -- Ainda não executados: na entrada, atribuídos e a caminho.
  select coalesce(array_agg(v.id), '{}') into v_vis
    from visita v
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
   where v.empresa_id = v_emp and v.base_id = v_base and v.excluido_em is null
     and v.data_agendada = v_hoje
     and v.situacao in ('ENTRADA', 'ATRIBUIDA', 'EM_DESLOCAMENTO')
     and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
     and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()));

  select jsonb_build_object(
      'n', r.n, 'quebras', r.quebras, 'taxa', round(r.taxa * 100, 1),
      'de', r.de, 'ate', r.ate, 'suficiente', r.aceito, 'calculado_em', r.calculado_em,
      'fatores', (select coalesce(jsonb_agg(jsonb_build_object(
                     'familia', f.familia, 'valor', f.valor, 'n', f.n, 'quebras', f.quebras,
                     'taxa', round(f.taxa * 100, 1), 'razao', f.razao) order by f.razao desc), '[]')
                    from risco_quebra_fator f
                   where f.base_id = v_base and f.dia = v_hoje and f.aceito and f.familia <> 'BASE'))
    into v_regua
    from risco_quebra_fator r
   where r.base_id = v_base and r.dia = v_hoje and r.familia = 'BASE';

  select jsonb_build_object(
      'dia', v_hoje,
      'cidade', (select b.nome from base b where b.id = v_base),
      'regua', v_regua,
      'contratos', coalesce(jsonb_agg(jsonb_build_object(
          'visita_id', v.id, 'contrato', v.contrato, 'bairro', v.bairro,
          'grupo', ts.nome, 'situacao', v.situacao, 'situacao_label', sv.label,
          'janela_inicio', to_char(v.janela_inicio, 'HH24:MI'),
          'janela_fim', to_char(v.janela_fim, 'HH24:MI'),
          'equipe_id', v.equipe_id, 'equipe', e.codigo, 'tecnico', t.nome,
          'faixa', p.faixa, 'fator', p.fator, 'motivos', p.motivos)
        order by case p.faixa when 'ALTO' then 0 when 'MEDIO' then 1 when 'BAIXO' then 2 else 3 end,
                 p.fator desc nulls last, v.janela_inicio nulls last, v.contrato), '[]'))
    into v_out
    from _risco_quebra_pontuar(v_vis, v_hoje) p
    join visita v on v.id = p.visita_id
    left join tipo_servico ts on ts.id = v.tipo_servico_id
    left join situacao_visita sv on sv.codigo = v.situacao
    left join equipe e on e.id = v.equipe_id
    left join tecnico t on t.id = v.tecnico_responsavel_id;

  return v_out;
end;
$$;
revoke all on function public.risco_quebra_do_dia() from public, anon;
grant execute on function public.risco_quebra_do_dia() to authenticated;

-- rodar_por_cidade: a do banco depois da 178, com recalcular_risco_quebra na lista fechada.
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
  if p_funcao not in ('sinais_do_dia', 'gerar_resumo_do_dia', 'recalcular_risco_quebra') then
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

select cron.schedule('risco-de-quebra', '30 9 * * *',
                     $$select public.rodar_por_cidade('recalcular_risco_quebra')$$);

notify pgrst, 'reload schema';
