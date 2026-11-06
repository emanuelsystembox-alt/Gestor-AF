-- 218 · Monitoramento: quantas EQUIPES saíram da área NO DIA (e quem)
--
-- > "Fora da área que ele está cadastrado, quantas equipes saíram no dia
-- >  entendeu?" — Emanuel, 06/11
--
-- A 214 contava TÉCNICOS fora AGORA. O pedido é outro: EQUIPES que, em
-- algum momento do dia escolhido, estiveram fora da área cadastrada para
-- elas — inclusive as que já voltaram — e, menor, quantas estão fora agora.
-- Por isso a 214 sai (nada publicado a chamava) e entra esta, com a data.
-- Uma linha por técnico com pelo menos uma área; a tela agrupa por equipe.
--
-- ┌─ A ÁREA DE ATUAÇÃO continua sendo a SOMA das áreas da equipe (214) ───┐
-- │ Fora = fora de TODAS as áreas que valem para a equipe ao mesmo tempo. │
-- │ Com uma área só, é "teve SAIU no dia" (ou começou o dia fora dela).   │
-- │ Quem vale para a cerca: a MESMA condição de `registrar_rastro`        │
-- │ (`cerca_equipe`, ou `todas_equipes` na cidade do técnico), lida HOJE: │
-- │ `cerca_equipe` não guarda histórico.                                   │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ COMO SE MONTA O DIA — sem regra nova de dentro/fora ─────────────────┐
-- │ Quem decide dentro/fora é `registrar_rastro` (097, D-171: 2 pontos    │
-- │ seguidos, precisão até 100 m). Aqui só se costura o que ele gravou:   │
-- │  · cada evento SAIU/ENTROU de `cerca_evento` muda o lado;             │
-- │  · antes do primeiro evento ele estava do OUTRO lado;                 │
-- │  · `cerca_estado` diz o lado desde `desde` — cobre o técnico cujo     │
-- │    primeiro ponto já caiu fora (esse não gera evento nenhum).         │
-- │ Redesenhar a cerca recomeça o dentro/fora (`salvar_cerca` apaga o     │
-- │ estado): evento de ANTES do último salvamento é do desenho velho e    │
-- │ não entra.                                                             │
-- │ O dia é cortado no que foi OBSERVADO: do primeiro ao último ponto     │
-- │ real (não simulado, até 100 m) do técnico no dia. O lado guardado de  │
-- │ ontem à noite não é observação de hoje; quem não mandou ponto no dia  │
-- │ não "saiu" — não se sabe.                                              │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- Dois jeitos de estar fora, devolvidos SEPARADOS (a tela soma os dois):
--  · SAIU: passou de dentro (de alguma área dele) para fora de todas, no dia
--    — com uma área só, é "teve SAIU". `primeira_saida`, `fora_seg`.
--  · COMEÇOU FORA: o primeiro ponto do dia já estava fora (o caminho de casa,
--    quase sempre; ou o dia inteiro trabalhando fora). `comecou_fora`,
--    `inicial_seg` — o trecho do 1º ponto até entrar.
-- Medido em 05/11 em São Luís: 7 dos 11 técnicos com ponto começaram o dia
-- fora; um deles (equipe 112) ficou 8h40 fora antes de entrar. Às 7h de
-- 06/11, 6 de 7 estavam "fora" só por ainda não terem chegado. Por isso os
-- dois vêm à parte: quem decide se o começo do dia conta é quem lê.
-- `fora_no_fim` = fora no último ponto (hoje, "fora agora").
--
-- Dias além da retenção (`rastro_retencao_dias`, 90 — `expurgar_rastro`
-- apaga ponto e evento) são RECUSADOS com o recado: zero ali seria mentira.
--
-- Escopo: o do `monitor_tecnicos` (a cidade ativa; só a gestão). O rastro é
-- dado pessoal de empregado (096): `cerca_estado` não tem policy, e só a
-- função DEFINER, com o papel conferido dentro, o lê.

drop function if exists public.monitor_fora_da_area();
drop function if exists public.monitor_equipes_fora_da_area(date);

create function public.monitor_equipes_fora_da_area(p_data date)
returns table (
  tecnico_id     uuid,
  equipe_id      uuid,
  areas          integer,
  cercas         text,
  cerca_ids      uuid[],
  primeiro_ponto timestamptz,
  ultimo_ponto   timestamptz,
  primeira_saida timestamptz,
  fora_seg       integer,
  comecou_fora   boolean,
  inicial_seg    integer,
  fora_no_fim    boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare v_ini timestamptz; v_fim timestamptz; v_ret integer;
begin
  if not (select eh_gestao()) then
    raise exception 'Monitoramento e do controle.' using errcode = '42501';
  end if;
  select (valor #>> '{}')::integer into v_ret
    from parametro where empresa_id = (select minha_empresa()) and chave = 'rastro_retencao_dias';
  v_ret := coalesce(v_ret, 90);
  if p_data < hoje_local() - v_ret then
    raise exception 'O rastro e guardado por % dias: este dia ja foi apagado.', v_ret
      using errcode = '22023';
  end if;
  v_ini := (p_data::timestamp) at time zone 'America/Manaus';
  v_fim := ((p_data + 1)::timestamp) at time zone 'America/Manaus';

  return query
  with tec as materialized (
    select t.id, t.equipe_id, t.base_id
      from tecnico t
     where t.empresa_id = (select minha_empresa())
       and t.situacao = 'ATIVO'
       -- a cidade ATIVA antes do atalho do gestor (traps.md, D-235)
       and t.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or t.equipe_id in (select equipes_legiveis()))
  ),
  vale as materialized (
    select t.id as tec_id, t.equipe_id as eq_id, c.id as c_id, c.nome, c.atualizado_em as c_desde
      from tec t
      join cerca c
        on c.empresa_id = (select minha_empresa())
       and c.tipo = 'AREA'
       and c.arquivado_em is null
       and ((c.todas_equipes and (c.base_id is null or c.base_id = t.base_id))
            or exists (select 1 from cerca_equipe ce
                        where ce.cerca_id = c.id and ce.equipe_id = t.equipe_id))
  ),
  qtd as materialized (
    select v.tec_id, v.eq_id, count(*)::integer as n,
           string_agg(v.nome, ', ' order by v.nome) as nomes,
           array_agg(v.c_id order by v.nome) as ids
      from vale v group by v.tec_id, v.eq_id
  ),
  -- o que foi observado no dia: os pontos que `registrar_rastro` confere
  obs as materialized (
    select r.tecnico_id as tec_id, min(r.capturado_em) as o_ini, max(r.capturado_em) as o_fim
      from rastro_ponto r
     where r.tecnico_id in (select q.tec_id from qtd q)
       and r.capturado_em >= v_ini and r.capturado_em < v_fim
       and not r.simulado and coalesce(r.precisao_m, 0) <= 100
     group by r.tecnico_id
  ),
  marco as materialized (
    -- cada troca de lado gravada, desde o último desenho da cerca
    select v.tec_id, v.c_id, e.em, (e.tipo = 'ENTROU') as dentro
      from vale v
      join cerca_evento e on e.tecnico_id = v.tec_id and e.cerca_id = v.c_id
     where e.em >= v.c_desde and e.em < v_fim
    union all
    -- antes da primeira troca, ele estava do outro lado
    select v.tec_id, v.c_id, v.c_desde, (f.tipo <> 'ENTROU')
      from vale v
      cross join lateral (
        select e.tipo from cerca_evento e
         where e.tecnico_id = v.tec_id and e.cerca_id = v.c_id and e.em >= v.c_desde
         order by e.em limit 1) f
    union all
    -- o lado guardado, desde quando (cobre o 1º ponto que já caiu fora)
    select v.tec_id, v.c_id, st.desde, st.dentro
      from vale v
      join cerca_estado st on st.tecnico_id = v.tec_id and st.cerca_id = v.c_id
     where st.desde < v_fim
  ),
  seg as materialized (
    select m.tec_id, m.c_id, m.dentro, m.em as s,
           coalesce(lead(m.em) over (partition by m.tec_id, m.c_id order by m.em),
                    'infinity'::timestamptz) as e
      from (select distinct on (x.tec_id, x.c_id, x.em) x.*
              from marco x order by x.tec_id, x.c_id, x.em) m
  ),
  corte as (
    select o.tec_id, o.o_ini as t from obs o
    union
    select o.tec_id, o.o_fim from obs o
    union
    select s.tec_id, s.s from seg s join obs o on o.tec_id = s.tec_id
     where s.s > o.o_ini and s.s < o.o_fim
  ),
  pedaco as (
    select c.tec_id, c.t as a,
           coalesce(lead(c.t) over (partition by c.tec_id order by c.t), c.t) as b
      from corte c
  ),
  avalia as (
    select p.tec_id, p.a, p.b,
           (select count(*) from seg s
             where s.tec_id = p.tec_id and s.s <= p.a and p.a < s.e and not s.dentro)
             = (select q.n from qtd q where q.tec_id = p.tec_id) as fora
      from pedaco p
  ),
  -- trechos seguidos fora; o que começa no 1º ponto do dia NÃO é saída
  trecho as (
    select x.*, sum(case when x.fora and not coalesce(x.antes, false) then 1 else 0 end)
                  over (partition by x.tec_id order by x.a) as k
      from (select y.*, lag(y.fora) over (partition by y.tec_id order by y.a) as antes
              from avalia y) x
  ),
  run as (
    select r.tec_id, r.k, min(r.a) as ini, sum(extract(epoch from r.b - r.a)) as seg,
           min(r.a) = min(o.o_ini) as inicial,
           bool_or(r.a = o.o_fim) as no_fim
      from trecho r join obs o on o.tec_id = r.tec_id
     where r.fora
     group by r.tec_id, r.k
  ),
  dia as (
    select r.tec_id,
           min(r.ini) filter (where not r.inicial) as prim,
           coalesce(sum(r.seg) filter (where not r.inicial), 0)::integer as seg_fora,
           coalesce(sum(r.seg) filter (where r.inicial), 0)::integer as seg_inicial,
           bool_or(r.inicial) as no_ini,
           bool_or(r.no_fim) as no_fim
      from run r
     group by r.tec_id
  )
  select q.tec_id, q.eq_id, q.n, q.nomes, q.ids, o.o_ini, o.o_fim,
         d.prim, coalesce(d.seg_fora, 0), coalesce(d.no_ini, false), coalesce(d.seg_inicial, 0),
         coalesce(d.no_fim, false)
    from qtd q
    left join obs o on o.tec_id = q.tec_id
    left join dia d on d.tec_id = q.tec_id;
end;
$$;

revoke all on function public.monitor_equipes_fora_da_area(date) from public, anon;
grant execute on function public.monitor_equipes_fora_da_area(date) to authenticated;

notify pgrst, 'reload schema';
