-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 208 — "Cancelado pela central" marcado pelo site (D-306)              │
-- │                                                                      │
-- │ "nessa tela o correto é ter outros status de escolher, em vez de     │
-- │  ficar concluído, cancelado, reagendado" · "eu quero adicionar       │
-- │  cancelado central e auditar também" — Emanuel, 04/11.               │
-- │                                                                      │
-- │ Até aqui "cancelado pela central" só existia quando o TOA dizia      │
-- │ ("Status da Atividade" = cancelado, ou "Cancelado no Sistema         │
-- │ NETSMS", D-289). Agora o COP pode afirmar isso pela baixa:           │
-- │  · `cancelar_pela_central` dá a baixa da AFLINE com o código -1      │
-- │    ("Cancelado no Sistema NETSMS", destino CANCELADA) em todas as   │
-- │    O.S., pela mesma `baixar_visita` (trava de situação terminal,     │
-- │    permissão, escopo), e grava a MARCA `visita.cancelado_central_em` │
-- │    / `_por` — quem afirmou e quando;                                 │
-- │  · a marca só se grava por essa porta (gatilho) e cai sozinha quando │
-- │    o contrato sai de CANCELADA (reversão, D-030);                    │
-- │  · as funções que tiram "cancelado pela central" das contas (volume, │
-- │    painel de equipes, ritmo, risco de quebra, impacto, qualidade,    │
-- │    revisita, REV D-10, origem para o app) passam a ler o status do   │
-- │    TOA OU a marca. Regeradas do banco, trocando só essa condição.    │
-- │    Hoje nenhum contrato tem a marca: as contas não mudam (conferido).│
-- │                                                                      │
-- │ O "Status da Atividade" do TOA NÃO é tocado — é da operadora (D-042).│
-- │ Fica de fora: o TEC1 (`tec1_da_os` só conta o que o TOA encerrou) e  │
-- │ o tempo de execução da Rota (`rota_do_dia`).                         │
-- │ O Auditar não precisa de nada aqui: é o 800 em toda O.S., que a tela │
-- │ põe e `baixar_visita` já aceita (D-191).                             │
-- └──────────────────────────────────────────────────────────────────────┘

alter table public.visita add column if not exists cancelado_central_em timestamptz;
alter table public.visita add column if not exists cancelado_central_por uuid references public.perfil(id);

-- A marca só pela porta; e sai quando o contrato deixa de ser CANCELADA.
create or replace function public.guarda_cancelado_central()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.situacao is distinct from 'CANCELADA' then
    new.cancelado_central_em := null;
    new.cancelado_central_por := null;
    return new;
  end if;
  if (new.cancelado_central_em is distinct from old.cancelado_central_em
      or new.cancelado_central_por is distinct from old.cancelado_central_por)
     and coalesce(current_setting('app.cancelado_central', true), '') <> '1' then
    raise exception 'A marca de cancelado pela central so se grava pela baixa (Baixar servico).'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function public.guarda_cancelado_central() from public, anon;

drop trigger if exists trg_guarda_cancelado_central on public.visita;
create trigger trg_guarda_cancelado_central before update on public.visita
  for each row execute function public.guarda_cancelado_central();

create or replace function public.cancelar_pela_central(p_visita uuid, p_observacao text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_itens jsonb; r jsonb;
begin
  select jsonb_agg(jsonb_build_object('os_id', o.id, 'codigo', -1, 'sub_falha_id', null,
                                      'observacao', nullif(btrim(coalesce(p_observacao, '')), '')))
    into v_itens
    from ordem_servico o where o.visita_id = p_visita;
  if v_itens is null then
    raise exception 'Contrato sem O.S. para baixar.' using errcode = 'P0002';
  end if;

  -- a baixa: permissão, escopo, trava terminal e destino do código são dela
  r := baixar_visita(p_visita, v_itens, 'CANCELADA', null, null);

  perform set_config('app.cancelado_central', '1', true);
  update visita set cancelado_central_em = now(), cancelado_central_por = auth.uid()
   where id = p_visita;
  perform set_config('app.cancelado_central', '', true);
  return coalesce(r, '{}'::jsonb) || jsonb_build_object('cancelado_central', true);
end;
$function$;
revoke all on function public.cancelar_pela_central(uuid, text) from public, anon;
grant execute on function public.cancelar_pela_central(uuid, text) to authenticated;

-- ── as funções que separam "cancelado pela central", regeradas do BANCO ──
-- _recalcular_risco_quebra: 1 troca(s)
CREATE OR REPLACE FUNCTION public._recalcular_risco_quebra(p_base uuid, p_dia date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
             (norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) = 'CANCELADO' or v.cancelado_central_em is not null)
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
$function$;

-- equipes_em_rota: 1 troca(s)
CREATE OR REPLACE FUNCTION public.equipes_em_rota()
 RETURNS TABLE(frente text, equipes integer, contratos integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with eq as (
    select v.equipe_id, count(*)::int as n
      from visita v
      join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.data_agendada = hoje_local()
       and v.excluido_em is null
       and v.contrato is not null
       and v.equipe_id is not null
       and ta.natureza = 'PRODUTIVA'
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and (((select ve_cidade_inteira()) and v.base_id in (select bases_visiveis())) or v.equipe_id in (select equipes_legiveis()))
       -- ninguem foi: fora do volume (D-225)
       and not (v.situacao = 'CANCELADA' and (
            (norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO' or v.cancelado_central_em is not null)
            or exists (select 1 from ordem_servico o
                        join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                       where o.visita_id = v.id and cb.codigo = 800)))
     group by v.equipe_id
    having count(*) > 1          -- "mais de 1 contrato em linha"
  )
  select case norm_txt(coalesce(sk.skill, ''))
           when 'ADESAO'     then 'ADESAO'
           when 'MANUTENCAO' then 'VT'
           else 'OUTRAS'            -- equipe em rota sem tecnico ativo
         end,
         count(*)::int,
         sum(eq.n)::int
    from eq
    -- O tecnico ATIVO da equipe. Mais de um na mesma equipe e raro aqui
    -- (a dupla costuma ter um login so); o primeiro pelo nome decide, e
    -- e deterministico entre um refresh e outro.
    left join lateral (
      select tc.skill from tecnico tc
       where tc.equipe_id = eq.equipe_id and tc.situacao = 'ATIVO'
       order by tc.nome limit 1
    ) sk on true
   group by 1;
$function$;

-- impacto_quebra: 1 troca(s)
CREATE OR REPLACE FUNCTION public.impacto_quebra(p_de date, p_ate date)
 RETURNS TABLE(agrupamento text, quebras bigint, total_un bigint, pct_un numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with vis as (
    select v.id, ts.nome as grupo_servico,
           -- 143: o que NAO e quebra. Cancelado pela central (o TOA
           -- cancelou antes de o tecnico ir) e Auditar (o 800 e nosso,
           -- nao da operacao) saem da conta, como na tela.
           (v.situacao = 'CANCELADA' and (
              (norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO' or v.cancelado_central_em is not null)
              or v.desatribuido_em is not null
              or exists (select 1 from ordem_servico o2
                          join codigo_baixa c2 on c2.id = o2.codigo_baixa_afline_id
                         where o2.visita_id = v.id and c2.codigo = 800))) as fora
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join tipo_servico ts on ts.id = v.tipo_servico_id
     where v.data_agendada between p_de and p_ate
       and v.excluido_em is null
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and (((select ve_cidade_inteira()) and v.base_id in (select bases_visiveis())) or v.equipe_id in (select equipes_legiveis()))
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
  ),
  os as (
    -- 169: o agrupamento pode ser outro na VT
    select c.natureza, agrupamento_da_quebra(c.agrupamento_quebra, c.agrupamento_quebra_vt, vis.grupo_servico) as agrupamento_quebra,
           c.situacao_destino, vis.fora
      from ordem_servico o
      join vis on vis.id = o.visita_id
      join codigo_baixa c on c.id = o.codigo_baixa_id
  ),
  tot as materialized (select count(*) as un from os)
  select coalesce(o.agrupamento_quebra, 'SEM_AGRUPAMENTO'),
         count(*), t.un,
         case when t.un > 0 then round(100.0 * count(*) / t.un, 2) end
    from os o cross join tot t
   where o.natureza = 'IMPRODUTIVA'
     and not o.fora
     and coalesce(o.agrupamento_quebra, '') <> 'SEM_QUEBRA'
     and coalesce(o.situacao_destino, '') <> 'CONCLUIDA'
   group by 1, t.un
   order by 2 desc;
$function$;

-- painel_equipes: 1 troca(s)
CREATE OR REPLACE FUNCTION public.painel_equipes(p_data date, p_visitas uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(equipe_id uuid, codigo text, nome text, area text, supervisor text, supervisor_declarado boolean, login_toa text, tecnicos bigint, visitas bigint, ordens bigint, periodos jsonb, situacoes jsonb, ultima_atividade timestamp with time zone, situacao_final text, minutos_parada integer, ocioso boolean, ultima_baixa timestamp with time zone, ultima_baixa_origem text, ultimo_contrato text, pontos_concluidos numeric, pontos_sem_regra integer, jornada jsonb, tec1 jsonb, min_deslocamento integer, min_execucao integer, desconexoes integer, fora_da_conta integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with cfg as (
  select coalesce(min(em.minutos_ocioso), 10)::int as minutos from empresa em
),
tudo as (
  select vi.id, vi.equipe_id, vi.situacao, vi.janela_inicio, vi.janela_fim,
         vi.contrato, vi.fim, vi.inicio, vi.finalizado_toa, vi.tipo_atividade_id,
         vi.tempo_deslocamento,
         coalesce(ta.natureza, 'PRODUTIVA') as natureza,
         ta.nome as tipo_nome,
         ts.nome as grupo_nome,
         norm_txt(coalesce(ts.nome, '')) = 'DESCONEXAO' as desconexao,
         -- 144: o tecnico nem chegou a ir. Cancelado pela central (o TOA
         -- cancelou antes de alguem sair) e Desatribuido (o 800: sumiu do
         -- TOA, 116) nao sao execucao. Mesma regra de `origemCancelada`
         -- na tela, e so uma copia dela.
         (vi.situacao = 'CANCELADA' and (
            (norm_txt(coalesce(vi.dados_origem->>'Status da Atividade','')) = 'CANCELADO' or vi.cancelado_central_em is not null)
            or exists (select 1 from ordem_servico o
                        join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                       where o.visita_id = vi.id and cb.codigo = 800)
         )) as fora_da_conta,
         coalesce(vi.fim,
                  case when vi.bloqueado_em is not null then vi.situacao_em end
         ) as encerrado_em
    from visita vi
    left join tipo_atividade ta on ta.id = vi.tipo_atividade_id
    left join tipo_servico  ts on ts.id = vi.tipo_servico_id
   where vi.data_agendada = p_data
     and vi.equipe_id is not null
     and vi.excluido_em is null
     -- 131: só os contratos que passaram no filtro da tela; a jornada fica
     and (p_visitas is null or vi.id = any (p_visitas)
          or coalesce(ta.natureza, 'PRODUTIVA') = 'JORNADA')
),
v as (
  select * from tudo where natureza <> 'JORNADA' and not fora_da_conta
),
fora as (
  select t.equipe_id, count(*)::int as n
    from tudo t where t.natureza <> 'JORNADA' and t.fora_da_conta group by 1
),
vs as (
  select * from v where not desconexao
),
desc_n as (
  select v.equipe_id, count(*)::int as n from v where v.desconexao group by 1
),
jor as (
  select t.equipe_id,
         jsonb_agg(jsonb_build_object(
           'tipo', t.tipo_nome,
           'situacao', t.situacao,
           'inicio', t.inicio,
           'fim', t.fim,
           'minutos', case when t.inicio is not null and t.fim is not null
                           then floor(extract(epoch from t.fim - t.inicio) / 60)::int
                      end
         ) order by t.inicio nulls last) as lista
    from tudo t
   where t.natureza = 'JORNADA'
   group by t.equipe_id
),
tec as materialized (
  select v.equipe_id,
         count(*) filter (where t.tec1 = 'PADRAO')     as padrao,
         count(*) filter (where t.tec1 = 'SEM_PADRAO') as sem_padrao,
         count(*) filter (where t.tec1 = 'EXPURGADA')  as expurgada,
         count(*) filter (where t.tec1 is null)        as sem_regra
    from vs v
    join ordem_servico o on o.visita_id = v.id
    cross join lateral (select tec1_da_os(o.id) as tec1) t
   group by 1
),
pers as (
  select t.equipe_id,
         jsonb_agg(jsonb_build_object(
           'janela', t.j, 'qtd', t.n, 'vt', t.vt) order by t.j) as lista
    from (
      select v.equipe_id,
             case when v.janela_inicio is null then 'SEM JANELA'
                  else to_char(v.janela_inicio, 'HH24:MI') || ' - ' ||
                       coalesce(to_char(v.janela_fim, 'HH24:MI'), '?')
             end as j,
             count(*) as n,
             count(*) filter (
               where norm_txt(coalesce(v.grupo_nome, '')) = 'VISITA TECNICA')::int as vt
        from vs v group by 1, 2
    ) t
   group by t.equipe_id
),
tempos as (
  select v.equipe_id,
         round(avg(extract(epoch from v.tempo_deslocamento) / 60)
               filter (where v.tempo_deslocamento is not null
                         and extract(epoch from v.tempo_deslocamento)
                             between 0 and 86400))::int as desloc,
         round(avg(extract(epoch from (v.fim - v.inicio)) / 60)
               filter (where v.inicio is not null and v.fim is not null
                         and v.fim > v.inicio
                         and v.fim - v.inicio < interval '24 hours'))::int as exec
    from vs v group by 1
),
sit_pts as materialized (
  select v.equipe_id, v.situacao,
         count(*) as n,
         count(*) filter (where v.natureza = 'PRODUTIVA')::int as produtivas,
         sum(p.pontos_claro) filter (
           where p.achou and v.natureza = 'PRODUTIVA'
             and not exists (select 1 from expurgo_pontuacao xx
                              where xx.visita_id = v.id and xx.escopo = 'TODOS'
                                and xx.desfeito_em is null)) as pontos,
         count(*) filter (
           where not coalesce(p.achou, false)
             and v.natureza = 'PRODUTIVA')::int as sem_regra,
         sum(p.pontos_claro) filter (
           where p.achou and v.natureza = 'PRODUTIVA'
             and not v.desconexao
             and not exists (select 1 from expurgo_pontuacao xx
                              where xx.visita_id = v.id and xx.escopo = 'TODOS'
                                and xx.desfeito_em is null)) as pontos_eq,
         count(*) filter (
           where not coalesce(p.achou, false)
             and v.natureza = 'PRODUTIVA'
             and not v.desconexao)::int as sem_regra_eq
    from v
    -- 165: em lote; por visita, cada chamada reavaliava o RLS (D-183)
    left join pontos_das_visitas(array(select id from v)) p on p.visita_id = v.id
   group by 1, 2
),
sits as (
  select t.equipe_id,
         jsonb_agg(jsonb_build_object(
           'situacao', t.situacao, 'qtd', t.n,
           'produtivas', t.produtivas, 'pontos', t.pontos, 'sem_regra', t.sem_regra
         ) order by t.n desc) as lista
    from sit_pts t
   group by t.equipe_id
),
pts as (
  select s.equipe_id, s.pontos_eq as soma, s.sem_regra_eq as sem_regra
    from sit_pts s
   where s.situacao = 'CONCLUIDA'
),
oss as (
  select v.equipe_id, count(o.id) as n
    from v join ordem_servico o on o.visita_id = v.id
   group by 1
),
cont as (
  select v.equipe_id, count(*) as n from v group by 1
),
ult as (
  select distinct on (v.equipe_id) v.equipe_id, v.encerrado_em, v.situacao
    from v where v.encerrado_em is not null
   order by v.equipe_id, v.encerrado_em desc
),
evt as (
  select ve.equipe_id, max(ve.criado_em) as em
    from visita_evento ve
    join v on v.id = ve.visita_id
   where ve.equipe_id is not null
   group by 1
),
baixa_af as materialized (
  select distinct on (v.equipe_id)
         v.equipe_id, o.baixa_em as em, v.contrato
    from v join ordem_servico o on o.visita_id = v.id
   where o.baixa_em is not null
   order by v.equipe_id, o.baixa_em desc
),
baixa_toa as materialized (
  select distinct on (v.equipe_id)
         v.equipe_id, v.fim as em, v.contrato
    from v
   where v.finalizado_toa and v.fim is not null
   order by v.equipe_id, v.fim desc
),
sup_dec as (
  select x.equipe_id, x.nome from (
    select t.equipe_id, p.nome,
           row_number() over (partition by t.equipe_id
                              order by count(*) desc, p.nome) as rn
      from tecnico t join perfil p on p.id = t.supervisor_id
     where t.situacao = 'ATIVO' and t.equipe_id is not null
     group by t.equipe_id, p.nome
  ) x where x.rn = 1
),
base as (
  select e.id, e.codigo, e.nome,
         a.apelido as area,
         coalesce(sd.nome, pe.nome, norm_supervisor(e.supervisor_nome)) as supervisor,
         (sd.nome is not null or pe.nome is not null) as supervisor_declarado,
         (select l.login_toa from equipe_login_toa l
           where l.equipe_id = e.id and l.inicio <= p_data
             and (l.fim is null or l.fim >= p_data)
           order by l.inicio desc limit 1) as login_toa,
         (select count(*) from tecnico t
           where t.equipe_id = e.id and t.situacao = 'ATIVO') as tecnicos,
         coalesce(cont.n, 0) as visitas,
         coalesce(oss.n, 0) as ordens,
         pers.lista as periodos,
         sits.lista as situacoes,
         greatest(ult.encerrado_em, evt.em) as ultima_atividade,
         ult.situacao as situacao_final,
         coalesce(baf.em, btoa.em) as ultima_baixa,
         case when baf.em is not null then 'AFLINE'
              when btoa.em is not null then 'TOA' end as ultima_baixa_origem,
         coalesce(baf.contrato, btoa.contrato) as ultimo_contrato,
         pts.soma as pontos_concluidos,
         coalesce(pts.sem_regra, 0) as pontos_sem_regra,
         jor.lista as jornada,
         case when tec.equipe_id is null then null else jsonb_build_object(
           'padrao', tec.padrao, 'sem_padrao', tec.sem_padrao,
           'expurgada', tec.expurgada, 'sem_regra', tec.sem_regra,
           'pct', case when (tec.padrao + tec.sem_padrao) > 0
                       then round(100.0 * tec.padrao / (tec.padrao + tec.sem_padrao), 1)
                  end) end as tec1,
         tp.desloc as min_deslocamento,
         tp.exec   as min_execucao,
         coalesce(dn.n, 0) as desconexoes,
         coalesce(fr.n, 0) as fora_da_conta
    from equipe e
    left join area_trabalho a on a.id = e.area_id
    left join sup_dec sd on sd.equipe_id = e.id
    left join perfil  pe on pe.id = e.supervisor_id
    left join cont on cont.equipe_id = e.id
    left join oss  on oss.equipe_id  = e.id
    left join pers on pers.equipe_id = e.id
    left join sits on sits.equipe_id = e.id
    left join ult  on ult.equipe_id  = e.id
    left join evt  on evt.equipe_id  = e.id
    left join baixa_af  baf  on baf.equipe_id  = e.id
    left join baixa_toa btoa on btoa.equipe_id = e.id
    left join pts on pts.equipe_id = e.id
    left join jor on jor.equipe_id = e.id
    left join tec on tec.equipe_id = e.id
    left join tempos tp on tp.equipe_id = e.id
    left join desc_n dn on dn.equipe_id = e.id
    left join fora fr on fr.equipe_id = e.id
)
select b.id, b.codigo, b.nome, b.area, b.supervisor, b.supervisor_declarado,
       b.login_toa, b.tecnicos, b.visitas, b.ordens, b.periodos, b.situacoes,
       b.ultima_atividade, b.situacao_final,
       -- 084: "hoje" em Manaus, nao em UTC. current_date virava as 20h locais.
       case when p_data = hoje_local() and b.ultima_atividade is not null
            then floor(extract(epoch from now() - b.ultima_atividade) / 60)::int
       end,
       case when p_data = hoje_local()
            then b.situacao_final in ('CONCLUIDA', 'CANCELADA')
                 and b.ultima_atividade is not null
                 and now() - b.ultima_atividade > ((select c.minutos from cfg c) || ' minutes')::interval
       end,
       b.ultima_baixa, b.ultima_baixa_origem, b.ultimo_contrato,
       b.pontos_concluidos, b.pontos_sem_regra, b.jornada, b.tec1,
       b.min_deslocamento, b.min_execucao, b.desconexoes, b.fora_da_conta
  from base b;
$function$;

-- qualidade_fila: 1 troca(s)
CREATE OR REPLACE FUNCTION public.qualidade_fila(p_de date, p_ate date)
 RETURNS TABLE(visita_id uuid, contrato text, cliente_nome text, endereco text, bairro text, grupo text, situacao_contrato text, status_toa text, data_agendada date, operacao text, equipe text, area text, tecnico text, tecnico_id uuid, encerrou timestamp with time zone, janela text, baixa_codigo integer, baixa_descricao text, baixa_natureza text, contador_log integer, tem_improdutiva boolean, desfecho text, canal text, telefone text, nota_tecnico smallint, tratou_bem boolean, observacao text, tentativas smallint, registrado_em timestamp with time zone, analista text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  /*
   * 148: a fila traz tudo o que os cinco filtros precisam -- tipo de
   * servico, situacao, codigo de baixa, janela e LOG -- numa consulta
   * so. Filtrar no cliente e deliberado: sao ~300 linhas no dia, e cada
   * troca de filtro sem ida ao servidor deixa a tela instantanea para
   * quem passa o dia inteiro nela.
   *
   * A fila continua sendo "tudo onde o tecnico FOI" (D-228).
   */
  select v.id, v.contrato, v.cliente_nome,
         concat_ws(', ', v.logradouro, v.complemento),
         v.bairro, coalesce(ts.nome, ta.nome),
         v.situacao,
         nullif(btrim(coalesce(v.dados_origem->>'Status da Atividade','')),''),
         v.data_agendada,
         b.nome,
         e.codigo, a.apelido,
         tc.nome, tc.id, v.fim,
         case when v.janela_inicio is null then null
              else to_char(v.janela_inicio,'HH24:MI') || ' - '
                   || coalesce(to_char(v.janela_fim,'HH24:MI'),'?') end,
         bx.codigo, bx.descricao, bx.natureza,
         nullif(btrim(coalesce(v.dados_origem->>'Contador de log','')),'')::int,
         exists (select 1 from ordem_servico o
                  join codigo_baixa cb on cb.id = o.codigo_baixa_id
                 where o.visita_id = v.id and cb.natureza = 'IMPRODUTIVA'),
         q.desfecho, q.canal, coalesce(q.telefone, cc.telefone),
         q.nota_tecnico, q.tratou_bem, q.observacao,
         coalesce(q.tentativas, 0::smallint), q.registrado_em, p.nome
    from visita v
    join tipo_atividade ta on ta.id = v.tipo_atividade_id
    left join tipo_servico ts on ts.id = v.tipo_servico_id
    left join base b on b.id = v.base_id
    left join equipe e on e.id = v.equipe_id
    left join area_trabalho a on a.id = v.area_id
    left join tecnico tc on tc.id = v.tecnico_responsavel_id
    left join pesquisa_qualidade q on q.visita_id = v.id
    left join perfil p on p.id = q.usuario_id
    -- a baixa da O.S. de menor sequencia que tenha uma: e a que a CLARO
    -- reconhece, a mesma escolha da reincidencia (033)
    left join lateral (
      select cb.codigo, cb.descricao, cb.natureza
        from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_id
       where o.visita_id = v.id order by o.sequencia limit 1
    ) bx on true
    left join lateral (
      select cc.telefone from contato_cliente cc
       where cc.visita_id = v.id and cc.informou limit 1
    ) cc on true
   where v.data_agendada between p_de and p_ate
     and v.excluido_em is null
     and v.contrato is not null
     and ta.natureza = 'PRODUTIVA'
     and v.situacao in ('CONCLUIDA','CANCELADA','REAGENDAMENTO')
     and not (v.situacao = 'CANCELADA' and (
          (norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO' or v.cancelado_central_em is not null)
          or exists (select 1 from ordem_servico o
                      join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                     where o.visita_id = v.id and cb.codigo = 800)))
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis())
     and (select tem_permissao('qualidade.ver'))
   order by (q.desfecho is null) desc, v.fim desc nulls last;
$function$;

-- ritmo_do_dia: 1 troca(s)
CREATE OR REPLACE FUNCTION public.ritmo_do_dia()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_hoje date := hoje_local();
  v_agora time := (now() at time zone 'America/Manaus')::time;
  v_janelas jsonb := coalesce(parametro_valor('ritmo_janelas'), '{}'::jsonb);
  v_cortes jsonb := coalesce(parametro_valor('ritmo_cortes'), '[9,10,11,12,13,14,15,16,17,18]'::jsonb);
  c int; v_lim timestamptz; r jsonb := '[]'::jsonb; v_lista jsonb; v_sem int; v_sem_hora int;
begin
  if not eh_gestao() then
    raise exception 'Ritmo e para a gestao.' using errcode = '42501';
  end if;

  for c in select (jsonb_array_elements_text(v_cortes))::int loop
    continue when make_time(c, 0, 0) > v_agora;
    v_lim := (v_hoje + make_time(c, 0, 0)) at time zone 'America/Manaus';

    with tec as materialized (
      select distinct v.tecnico_responsavel_id as id
        from visita v
        left join tipo_atividade ta on ta.id = v.tipo_atividade_id
       where v.empresa_id = minha_empresa() and v.excluido_em is null
         and v.data_agendada = v_hoje
         and v.tecnico_responsavel_id is not null
         and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
         -- 155b: a cidade ATIVA, aqui tambem.
         and v.base_id in (select bases_visiveis())
         and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
    ),
    /*
     * EXECUTADO = concluido, reagendado ou cancelado por codigo.
     * Fora: cancelado pela central (o TOA cancelou antes de alguem ir) e
     * desatribuido/auditar (o 800, que sumiu da planilha). Sao os dois
     * que ele mandou tirar, e os mesmos que ja saem de todo o Dashboard.
     */
    exec as materialized (
      select v.tecnico_responsavel_id as tec,
             case when v.finalizado_toa and v.fim is not null then v.fim
                  when v.bloqueado_em is not null then v.situacao_em end as quando
        from visita v
        left join tipo_atividade ta on ta.id = v.tipo_atividade_id
       where v.tecnico_responsavel_id in (select id from tec)
         and v.data_agendada = v_hoje and v.excluido_em is null
         and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
         and v.situacao in ('CONCLUIDA', 'REAGENDAMENTO', 'CANCELADA')
         and not (v.situacao = 'CANCELADA' and (
                    (norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO' or v.cancelado_central_em is not null)
                    or exists (select 1 from ordem_servico o
                                 join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                                where o.visita_id = v.id and cb.codigo = 800)))
    ),
    feito as (
      select tec, count(*) filter (where quando is not null and quando <= v_lim) as qtd,
             count(*) filter (where quando is null) as sem_hora
        from exec group by 1
    ),
    /*
     * O esperado e CUMULATIVO: as janelas cheias que ja passaram, mais a
     * fatia proporcional da janela em curso. Fora de qualquer janela
     * antes da primeira, zero; depois da ultima, o total do dia.
     */
    esperado as (
      select t.id as tec,
             sum(
               case
                 when make_time(c,0,0) >= (j->>'ate')::time then (j->>'qtd')::numeric
                 when make_time(c,0,0) <= (j->>'de')::time  then 0
                 else (j->>'qtd')::numeric
                      * (extract(epoch from (make_time(c,0,0) - (j->>'de')::time))
                         / nullif(extract(epoch from ((j->>'ate')::time - (j->>'de')::time)), 0))
               end) as qtd,
             sum((j->>'qtd')::numeric) as total_dia
        from tec t
        join tecnico tc on tc.id = t.id
        cross join lateral jsonb_array_elements(coalesce(v_janelas -> tc.skill, '[]'::jsonb)) j
       group by t.id
    ),
    conta as (
      select t.id, tc.nome, e.codigo as equipe, tc.skill,
             coalesce(f.qtd, 0)::int as feitos,
             round(es.qtd, 2) as esperado,
             es.total_dia::int as total_dia,
             coalesce(f.sem_hora, 0)::int as sem_hora
        from tec t
        join tecnico tc on tc.id = t.id
        left join equipe e on e.id = tc.equipe_id
        left join feito f on f.tec = t.id
        left join esperado es on es.tec = t.id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'tecnico_id', id, 'nome', nome, 'equipe', equipe, 'frente', skill,
             'feitos', feitos, 'esperado', esperado, 'total_dia', total_dia,
             'detalhe', feitos || ' de ' || esperado || ' contrato(s) ate ' || c
                        || 'h (' || coalesce(skill, 'sem skill')
                        || ', ' || total_dia || ' no dia)')
             order by esperado - feitos desc)
             -- Sem janela cadastrada para a skill: SEM META, nao "abaixo".
             -- E so acende quando falta um contrato INTEIRO.
             filter (where esperado is not null and esperado >= 1 and feitos < esperado), '[]'::jsonb),
           count(*) filter (where esperado is null),
           coalesce(sum(sem_hora), 0)
      into v_lista, v_sem, v_sem_hora
      from conta;

    r := r || jsonb_build_object('corte', c, 'fracao', null,
                                 'abaixo', v_lista, 'sem_meta', v_sem,
                                 'sem_hora', v_sem_hora);
  end loop;
  return r;
end;
$function$;

-- volume_do_dia: 1 troca(s)
CREATE OR REPLACE FUNCTION public.volume_do_dia()
 RETURNS TABLE(situacao text, qtd integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select v.situacao, count(*)::int
    from visita v
    join tipo_atividade ta on ta.id = v.tipo_atividade_id
   where v.data_agendada = hoje_local()
     and v.excluido_em is null
     and ta.natureza = 'PRODUTIVA'
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis())
     and (((select ve_cidade_inteira()) and v.base_id in (select bases_visiveis())) or v.equipe_id in (select equipes_legiveis()))
     -- ninguem foi: fora do volume (D-225)
     and not (v.situacao = 'CANCELADA' and (
          (norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO' or v.cancelado_central_em is not null)
          or exists (select 1 from ordem_servico o
                      join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                     where o.visita_id = v.id and cb.codigo = 800)))
   group by v.situacao;
$function$;

-- revisita_do_tecnico
CREATE OR REPLACE FUNCTION public.revisita_do_tecnico(p_de date, p_ate date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tec uuid := meu_tecnico_id();
  v_skill text;
  v_manut boolean;
  v_total bigint;
  v_rev bigint;
begin
  if v_tec is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  select skill into v_skill from tecnico where id = v_tec;
  v_manut := norm_txt(coalesce(v_skill, '')) = norm_txt('MANUTENÇÃO');

  with base as materialized (
    select v.id, v.empresa_id, v.contrato, v.data_agendada, v.criado_em, v.situacao,
           g.nome as grupo,
           -- o "Status da Atividade" do TOA vem só no JSON cru (como na web)
           case when v.cancelado_central_em is not null then 'CANCELADO'
                else norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) end as status_toa
      from visita v
      left join tipo_servico g on g.id = v.tipo_servico_id
     where v.tecnico_responsavel_id = v_tec
       and v.excluido_em is null
       and v.contrato is not null
       and v.data_agendada between p_de and p_ate
  ),
  meus as (
    select b.* from base b
     where case when v_manut then
             b.grupo = 'VISITA TECNICA'
             and b.situacao in ('CONCLUIDA', 'REAGENDAMENTO', 'CANCELADA')
             -- o desatribuído (800 na baixa da AFLINE) — o "Auditar"
             and not exists (select 1 from ordem_servico o
                               join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                              where o.visita_id = b.id and cb.codigo = 800)
             -- o cancelado pela central (status do TOA "CANCELADO")
             and not (b.situacao = 'CANCELADA' and b.status_toa = 'CANCELADO')
           else
             b.situacao = 'CONCLUIDA'
           end
  ),
  voltou as (
    select m.id from meus m
     where exists (
       select 1 from visita d
         left join tipo_servico gd on gd.id = d.tipo_servico_id
        where d.empresa_id = m.empresa_id and d.contrato = m.contrato
          and d.id <> m.id and d.excluido_em is null
          and (d.data_agendada > m.data_agendada
               or (d.data_agendada = m.data_agendada and d.criado_em > m.criado_em))
          and d.data_agendada - m.data_agendada <= 30
          and case when v_manut then
                gd.nome = 'VISITA TECNICA'
              else
                gd.nome = 'VISITA TECNICA'
                or (gd.nome = 'RETORNO DE CREDENCIADA'
                    and m.grupo in ('ADESAO', 'MIGRACAO GPON', 'REINSTALACAO',
                                    'MUDANCA DE ENDERECO', 'RETORNO DE CREDENCIADA'))
              end)
  )
  select (select count(*) from meus), (select count(*) from voltou)
    into v_total, v_rev;

  return jsonb_build_object(
    'modelo', case when v_manut then 'MANUTENCAO' else 'ADESAO' end,
    'skill', v_skill,
    'total', v_total,
    'revisitas', v_rev,
    'pct', case when v_total = 0 then null
                else round(100.0 * v_rev / v_total, 1) end);
end;
$function$;

-- aplicar_rev_d10: 1 troca(s)
CREATE OR REPLACE FUNCTION public.aplicar_rev_d10(p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_de  date := coalesce(p_de, hoje_local());
  v_ate date := coalesce(p_ate, hoje_local() + 1);
  v_ids uuid[];
  n_pos int := 0;
  n_tir int := 0;
begin
  -- só o relógio (sem usuário) ou a gestão chamam
  if auth.uid() is not null and not (select eh_gestao()) then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  -- "só de hoje em diante" (Emanuel, 03/11)
  v_de := greatest(v_de, hoje_local());

  select array_agg(v.id) into v_ids
    from visita v
   where v.data_agendada between v_de and v_ate
     and v.excluido_em is null and v.contrato is not null;
  if v_ids is null then
    return jsonb_build_object('postos', 0, 'tirados', 0);
  end if;

  create temp table if not exists _rev_d10 (visita_id uuid primary key, empresa_id uuid,
                                            marca boolean, obs text) on commit drop;
  truncate _rev_d10;
  insert into _rev_d10
  select v.id, v.empresa_id,
         coalesce(
           r.anterior_situacao = 'CONCLUIDA'
           and r.dias between 0 and 30
           and ((gv.nome = 'VISITA TECNICA' and r.anterior_grupo = 'VISITA TECNICA')
                or (gv.nome = 'RETORNO DE CREDENCIADA'
                    and r.anterior_grupo in ('RETORNO DE CREDENCIADA', 'ADESAO', 'MIGRACAO GPON',
                                             'REINSTALACAO', 'MUDANCA DE ENDERECO')))
           -- Auditar: o 800 do próprio sistema (D-191)
           and v.desatribuido_em is null
           and not exists (select 1 from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                            where o.visita_id = v.id and cb.codigo = 800)
           -- cancelado pela central no TOA
           and not (v.situacao = 'CANCELADA'
                    and (cancelado_pela_central(v.dados_origem ->> 'Status da Atividade',
                                               v.dados_origem ->> 'Motivo de Fechamento Externo') or v.cancelado_central_em is not null)),
           false),
         'Automático: ' || coalesce(r.anterior_grupo, '?') || ' de '
           || to_char(r.anterior_data, 'DD/MM/YYYY') || ', ' || coalesce(r.dias, 0) || ' dia(s) antes'
           || coalesce(', equipe ' || r.anterior_equipe, '')
    from visita v
    left join tipo_servico gv on gv.id = v.tipo_servico_id
    left join revisita_dos_contratos(v_ids) r on r.visita_id = v.id
   where v.id = any (v_ids);

  -- 194: desmarcado à mão neste contrato → não volta (outro dia é outra visita)
  insert into visita_marcador (visita_id, indicador_id, observacao)
  select x.visita_id, iq.id, x.obs
    from _rev_d10 x
    join indicador_qualidade iq on iq.empresa_id = x.empresa_id and iq.nome = 'REV D-10' and iq.ativo
   where x.marca
     and not exists (select 1 from rev_d10_recusado rr where rr.visita_id = x.visita_id)
  on conflict (visita_id, indicador_id) do nothing;
  get diagnostics n_pos = row_count;

  -- tira só o que ELE pôs e deixou de valer — sem contar como recusa (194)
  perform set_config('app.origem', 'REV_D10', true);
  delete from visita_marcador vm
   using _rev_d10 x, indicador_qualidade iq
   where vm.visita_id = x.visita_id and not x.marca
     and iq.id = vm.indicador_id and iq.nome = 'REV D-10'
     and vm.observacao like 'Automático:%';
  get diagnostics n_tir = row_count;
  perform set_config('app.origem', '', true);

  return jsonb_build_object('postos', n_pos, 'tirados', n_tir);
end;
$function$;

-- origem_do_cancelamento: 2 troca(s)
CREATE OR REPLACE FUNCTION public.origem_do_cancelamento(p_visitas uuid[])
 RETURNS TABLE(visita_id uuid, origem text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select v.id,
         case when v.desatribuido_em is not null
                or exists (select 1 from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                            where o.visita_id = v.id and cb.codigo = 800)
              then 'AUDITAR'
              when (cancelado_pela_central(v.dados_origem ->> 'Status da Atividade', v.dados_origem ->> 'Motivo de Fechamento Externo') or v.cancelado_central_em is not null)
              then 'CANCELADO_CENTRAL' end
    from visita v
   where v.id = any (p_visitas)
     and v.situacao = 'CANCELADA'
     and (v.desatribuido_em is not null
          or (cancelado_pela_central(v.dados_origem ->> 'Status da Atividade', v.dados_origem ->> 'Motivo de Fechamento Externo') or v.cancelado_central_em is not null)
          or exists (select 1 from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                      where o.visita_id = v.id and cb.codigo = 800));
$function$;

notify pgrst, 'reload schema';
