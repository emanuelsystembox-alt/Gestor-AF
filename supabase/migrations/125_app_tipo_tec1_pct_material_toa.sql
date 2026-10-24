-- ┌─ 125 · o app: tipo do contrato, % de TEC1 e o material que o TOA leu ┐
-- │ > "é bom colocar o tipo de os, se é adesão, serviço, mudança de     │
-- │ >  endereço (...) é bom colocar a % do TEC1 que está sendo entregue,│
-- │ >  % padrão (...) nosso sistema pode fazer a leitura do TOA e puxar │
-- │ >  as miscelânias e os equipamentos baixados e retirados (...)      │
-- │ >  queria que mostrasse esses lançamentos para o técnico também"    │
-- │ >  — Emanuel, 24/10                                                 │
-- │                                                                    │
-- │ A. agenda_do_campo ganha `tipo_atividade` (Instalacao, Mudanca de  │
-- │    Pacote…) e `tecnologia` (GPON) — o que a coluna GRUPO da web já │
-- │    mostra embaixo do grupo. `returns table` mudou: derruba e recria.│
-- │                                                                    │
-- │ B. painel_do_tecnico ganha `tec1` com a MESMA conta do painel de   │
-- │    Equipes (081/D-187): por O.S. (`tec1_da_os`), sem jornada e sem │
-- │    desconexão; pct = padrão / (padrão + sem padrão). Nenhuma O.S.  │
-- │    avaliada → pct NULO, nunca 0% nem 100% (regra 6). O corpo é o   │
-- │    da função viva (pg_get_functiondef, 24/10) com o bloco novo.     │
-- │                                                                    │
-- │ C. material_do_toa: o que a varredura leu (117, D-192) ao lado do  │
-- │    que o técnico lançou. Só LEITURA — a regra de correção do       │
-- │    lançamento ainda está em aberto com o Emanuel e nada aqui mexe  │
-- │    em saldo, posse ou lançamento (D-192 continua valendo).         │
-- │    Equipamento casa por serial (sem caixa); miscelânea pelo código │
-- │    SAP do começo do nome do TOA ("22062579_FONTE…" → 22062579), que│
-- │    casa com item_miscelanea.codigo em 860 de 907 linhas (24/10).   │
-- └────────────────────────────────────────────────────────────────────┘

-- ── A. agenda ──────────────────────────────────────────────────────────
drop function if exists public.agenda_do_campo(date);

create function public.agenda_do_campo(p_data date default null)
returns table(
  visita_id uuid, contrato text, wo_numero text, cliente_nome text,
  logradouro text, complemento text, bairro text, cep text, node text,
  telefones text[], lat numeric, lng numeric,
  janela_inicio time, janela_fim time, situacao text, data_agendada date,
  servico text, os_total integer, os_baixadas integer, evidencias integer,
  equipamentos integer, pontos numeric, pontos_achou boolean,
  segmento text, ouvidoria boolean, tec1 text, produtos text[],
  tipo_atividade text, tecnologia text
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with dia as materialized (select coalesce(p_data, hoje_local()) as d),
  escopo as materialized (select minha_empresa() as empresa, eh_gestor() as gestor),
  bases as materialized (select b from bases_visiveis() b),
  equipes_ok as materialized (select e from equipes_visiveis() e),
  minhas as materialized (
    select v.id, v.contrato, v.wo_numero, v.cliente_nome, v.logradouro,
           v.complemento, v.bairro, v.cep, v.node, v.telefones, v.lat, v.lng,
           v.janela_inicio, v.janela_fim, v.situacao, v.data_agendada,
           coalesce(ts.nome, ta.nome, 'Visita') as servico,
           sg.nome as segmento, v.ouvidoria, v.tec1, v.produtos_pendentes,
           ta.nome as tipo_atividade, v.tecnologia
      from visita v
      cross join escopo s
      left join tipo_servico   ts on ts.id = v.tipo_servico_id
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join segmentacao    sg on sg.id = v.segmentacao_id
     where v.excluido_em is null
       and v.data_agendada = (select d from dia)
       and v.empresa_id = s.empresa
       and v.base_id in (select b from bases)
       and (s.gestor or v.equipe_id in (select e from equipes_ok))
       and coalesce(ta.natureza, 'PRODUTIVA') = 'PRODUTIVA'
  ),
  pts as materialized (
    select m.id as visita_id, p.pontos_claro, p.achou
      from minhas m cross join lateral pontos_da_visita(m.id) p
  ),
  contagem as materialized (
    select o.visita_id, count(*)::int as total,
           count(*) filter (where o.codigo_baixa_afline_id is not null)::int as baixadas
      from ordem_servico o where o.visita_id in (select id from minhas)
     group by o.visita_id
  ),
  evid as materialized (
    select e.visita_id, count(*)::int as n from evidencia e
     where e.visita_id in (select id from minhas) group by e.visita_id
  ),
  equip as materialized (
    select m.visita_id, count(*)::int as n from equipamento_movimento m
     where m.visita_id in (select id from minhas) group by m.visita_id
  )
  select m.id, m.contrato, m.wo_numero, m.cliente_nome, m.logradouro,
         m.complemento, m.bairro, m.cep, m.node, m.telefones, m.lat, m.lng,
         m.janela_inicio, m.janela_fim, m.situacao, m.data_agendada, m.servico,
         coalesce(c.total, 0), coalesce(c.baixadas, 0),
         coalesce(ev.n, 0), coalesce(eq.n, 0),
         case when p.achou then p.pontos_claro end,
         coalesce(p.achou, false),
         m.segmento, m.ouvidoria, m.tec1, m.produtos_pendentes,
         m.tipo_atividade, m.tecnologia
    from minhas m
    left join pts      p  on p.visita_id  = m.id
    left join contagem c  on c.visita_id  = m.id
    left join evid     ev on ev.visita_id = m.id
    left join equip    eq on eq.visita_id = m.id
   order by m.janela_inicio nulls last, m.contrato;
$function$;

revoke all on function public.agenda_do_campo(date) from public, anon;
grant execute on function public.agenda_do_campo(date) to authenticated, service_role;

-- ── B. painel do técnico ───────────────────────────────────────────────
create or replace function public.painel_do_tecnico(p_de date, p_ate date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_tec uuid := meu_tecnico_id(); t tecnico%rowtype;
  v_hoje date := hoje_local();
  v_pontos numeric; v_visitas bigint; v_concl bigint; v_diasc bigint; v_queb bigint;
  v_perd numeric; v_semr bigint; v_tec1 bigint;
  h record; v_meta numeric; v_fator numeric; v_prox numeric;
  v_pos int; v_total int; v_acima numeric; v_dias numeric;
  v_por_dia jsonb; v_afazer int;
  v_tec1_os jsonb;
begin
  if v_tec is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  select * into t from tecnico where id = v_tec;

  with pr as materialized (
    select x.* from producao_por_tecnico(p_de, p_ate) x
      join tecnico tt on tt.id = x.tecnico_id
  ),
  rk as (select x.tecnico_id, x.pontos, rank() over (order by x.pontos desc) as pos from pr x),
  eu as (select * from pr where pr.tecnico_id = v_tec)
  select eu.pontos, eu.visitas, eu.concluidas, eu.dias, eu.quebradas, eu.pontos_perdidos,
         eu.perdidos_sem_regra, eu.tec1_perdidos,
         (select rk.pos from rk where rk.tecnico_id = v_tec),
         (select count(*) from rk),
         (select min(rk.pontos) from rk where rk.pontos > coalesce(eu.pontos, 0))
    into v_pontos, v_visitas, v_concl, v_diasc, v_queb, v_perd, v_semr, v_tec1,
         v_pos, v_total, v_acima
    from (select 1) um left join eu on true;

  select * into h from producao_por_tecnico(v_hoje, v_hoje) x where x.tecnico_id = v_tec;

  v_meta := meta_da_skill(t.skill, p_de, p_ate);
  select f.fator into v_fator from faixa_comissao f
   where f.ativo and f.empresa_id = t.empresa_id
     and f.skill = coalesce(t.skill, 'SINGLE MASTER')
     and coalesce(v_pontos, 0) >= f.pontos_de
   order by f.pontos_de desc limit 1;
  select min(f.pontos_de) into v_prox from faixa_comissao f
   where f.ativo and f.empresa_id = t.empresa_id
     and f.skill = coalesce(t.skill, 'SINGLE MASTER')
     and f.pontos_de > coalesce(v_pontos, 0);

  -- 093: os pontos do dia a dia em conjunto.
  with vs as materialized (
    select v.id, v.data_agendada
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.tecnico_responsavel_id = v_tec and v.excluido_em is null
       and v.data_agendada between p_de and p_ate
       and v.situacao = 'CONCLUIDA'
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
  )
  select coalesce(jsonb_agg(jsonb_build_object('dia', d, 'pontos', pts) order by d), '[]'::jsonb)
    into v_por_dia
    from (
      select vs.data_agendada as d, round(sum(coalesce(x.pontos_claro, 0)), 2) as pts
        from vs join pontos_das_visitas(array(select id from vs)) x on x.visita_id = vs.id
       group by 1
    ) s;

  -- 125: o TEC1 do técnico no período, com a conta do painel de Equipes
  -- (painel_equipes, cte `tec`): por O.S., sem jornada nem desconexão.
  with os as materialized (
    select tec1_da_os(o.id) as tec1
      from visita v
      join ordem_servico o on o.visita_id = v.id
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join tipo_servico  ts on ts.id = v.tipo_servico_id
     where v.tecnico_responsavel_id = v_tec and v.excluido_em is null
       and v.data_agendada between p_de and p_ate
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       and norm_txt(coalesce(ts.nome, '')) <> 'DESCONEXAO'
  ),
  c as (
    select count(*) filter (where tec1 = 'PADRAO')     as padrao,
           count(*) filter (where tec1 = 'SEM_PADRAO') as sem_padrao,
           count(*) filter (where tec1 = 'EXPURGADA')  as expurgada,
           count(*) filter (where tec1 is null)        as sem_regra
      from os
  )
  select jsonb_build_object(
           'padrao', c.padrao, 'sem_padrao', c.sem_padrao,
           'expurgada', c.expurgada, 'sem_regra', c.sem_regra,
           'pct', case when (c.padrao + c.sem_padrao) > 0
                       then round(100.0 * c.padrao / (c.padrao + c.sem_padrao), 1) end)
    into v_tec1_os
    from c;

  select count(*) into v_afazer
    from visita v
    join situacao_visita s on s.codigo = v.situacao and s.em_aberto
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
   where v.tecnico_responsavel_id = v_tec and v.excluido_em is null
     and v.data_agendada = v_hoje
     and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA';

  v_dias := coalesce((parametro_valor('ritmo_dias_mes'))::text::numeric, 26);

  return jsonb_build_object(
    'tecnico', t.nome, 'skill', t.skill,
    'pontos', coalesce(v_pontos, 0),
    'visitas', coalesce(v_visitas, 0),
    'concluidas', coalesce(v_concl, 0),
    'dias', coalesce(v_diasc, 0),
    'quebradas', coalesce(v_queb, 0),
    'pontos_perdidos', coalesce(v_perd, 0),
    'perdidos_sem_regra', coalesce(v_semr, 0),
    'tec1_perdidos', coalesce(v_tec1, 0),
    'tec1', v_tec1_os,
    'meta', v_meta,
    'meta_dia', case when v_meta is null then null else round(v_meta / v_dias, 2) end,
    'fator', v_fator,
    'valor', case when v_fator is null then null else round(coalesce(v_pontos, 0) * v_fator, 2) end,
    'proxima_faixa', v_prox,
    'posicao', v_pos, 'total', v_total,
    'pontos_do_de_cima', v_acima,
    'hoje', jsonb_build_object(
      'pontos', coalesce(h.pontos, 0), 'concluidas', coalesce(h.concluidas, 0),
      'quebradas', coalesce(h.quebradas, 0), 'a_fazer', v_afazer),
    'por_dia', v_por_dia);
end;
$function$;

-- ── C. o material do TOA ao lado do que o técnico lançou ──────────────
create or replace function public.material_do_toa(p_visita uuid)
returns table(
  secao text, tipo text, modelo text, serial text, serial_substituido text,
  quantidade numeric, miscelanea boolean, item text, lancado numeric, lido_em timestamptz
)
language sql
stable security definer
set search_path to 'public'
as $function$
  -- O escopo é o MESMO da miscelanea_do_contrato: quem vê o contrato.
  with ok as materialized (
    select v.id from visita v
     where v.id = p_visita and v.empresa_id = minha_empresa()
       and (eh_gestor() or v.equipe_id in (select equipes_visiveis())
            or tem_permissao('almoxarifado.ver'))
  ),
  toa as (
    select t.*, i.id as item_id, i.nome as item_nome
      from visita_equipamento_toa t
      join ok on ok.id = t.visita_id
      left join item_miscelanea i
             on t.miscelanea and i.empresa_id = t.empresa_id
            and i.codigo = split_part(t.modelo, '_', 1)
  )
  select t.secao, t.tipo, t.modelo, t.serial, t.serial_substituido,
         t.quantidade, t.miscelanea, t.item_nome,
         case
           -- equipamento: lançado = o serial aparece no lançamento do campo (1/0)
           when not t.miscelanea and t.serial is not null then
             case when exists (select 1 from equipamento_movimento m
                                where m.visita_id = t.visita_id
                                  and upper(btrim(m.serial)) = upper(btrim(t.serial)))
                  then 1 else 0 end
           -- miscelânea: a quantidade que o técnico baixou deste item no contrato
           when t.miscelanea and t.item_id is not null then
             (select coalesce(sum(-m.quantidade), 0) from miscelanea_movimento m
               where m.visita_id = t.visita_id and m.item_id = t.item_id and m.tipo = 'CONSUMO')
         end,
         t.lido_em
    from toa t
   order by case t.secao when 'INSTALADO' then 1 when 'DESINSTALADO' then 2 else 3 end,
            t.miscelanea, t.tipo, t.modelo;
$function$;

revoke all on function public.material_do_toa(uuid) from public, anon;
grant execute on function public.material_do_toa(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
