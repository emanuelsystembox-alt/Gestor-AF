-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 247 — VT por equipe: o agregado por cidade (D-359)                   │
-- │                                                                      │
-- │ O relatório que a operação manda por dia: "Eqps realizadas / Eqps    │
-- │ projetadas — BSB 8,48 (10,00) · MAO 2,57 (3,24) …", do mês e do dia. │
-- │ "isso é um simulado do que o rapaz manda por dia (...) é bom o       │
-- │  sistema mostrar também" — Emanuel, 10/11.                           │
-- │                                                                      │
-- │ A regra das atividades com ponto sai de `vt_por_equipe_mes` para     │
-- │ `_vt_atividades` (interna), e as duas leem dela — uma cópia só. A    │
-- │ saída de `vt_por_equipe_mes` foi conferida idêntica antes de aplicar.│
-- │ `vt_por_equipe_cidades` usa `bases_permitidas()`: o ADMIN vê todas;  │
-- │ os demais, a do cadastro + "Cidades que acessa", no escopo de equipe.│
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public._vt_atividades(p_ini date, p_fim date, p_bases uuid[])
 returns table(base_id uuid, login text, dia date, tec uuid, tipo1 text, pontos numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- A regra do VT por equipe (234): atividade FINALIZADA no TOA, num bucket _VT, o login
  -- do TOA (sem ele, a matrícula), e os pontos da 1ª O.S. (`vt_ponto`; sem cadastro = nulo).
  -- Só nas cidades pedidas QUE a pessoa pode ver, e no escopo de equipe dela.
  with ativ as materialized (
    select upper(coalesce(nullif(btrim(v.dados_origem->>'Login do Técnico'), ''), t.matricula)) as login,
           v.data_agendada as dia,
           v.base_id,
           v.tecnico_responsavel_id as tec,
           (select tos.codigo
              from ordem_servico o join tipo_os tos on tos.id = o.tipo_os_id
             where o.visita_id = v.id
             order by o.sequencia limit 1) as tipo1
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
     where v.data_agendada between p_ini and p_fim
       and v.excluido_em is null
       and v.finalizado_toa
       and v.toa_bucket ilike '%\_VT'
       and v.empresa_id = (select minha_empresa())
       and v.base_id = any(p_bases)
       and v.base_id in (select bases_permitidas())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
  )
  select a.base_id, a.login, a.dia, a.tec, a.tipo1, p.pontos
    from ativ a
    left join vt_ponto p on p.empresa_id = (select minha_empresa()) and p.tipo_os_codigo = a.tipo1
   where a.tipo1 is not null and a.login is not null;
$function$;
-- interna: só as funções do VT (definer, do dono) a chamam
revoke all on function public._vt_atividades(date, date, uuid[]) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.vt_por_equipe_mes(p_mes date)
 RETURNS TABLE(login text, nome text, equipe text, por_dia jsonb, escala jsonb, sem_ponto integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lim as materialized (
    select date_trunc('month', p_mes)::date as ini,
           (date_trunc('month', p_mes) + interval '1 month - 1 day')::date as fim,
           coalesce((select (valor #>> '{}')::numeric from parametro
                      where empresa_id = minha_empresa() and chave = 'vt_pontos_por_vt'), 35) as div
  ),
  -- 247: as atividades com ponto vêm de _vt_atividades (a mesma regra do agregado por cidade)
  com_ponto as materialized (
    select a.login, a.dia, a.base_id, a.tec, a.tipo1, a.pontos
      from lim, _vt_atividades(lim.ini, lim.fim, array(select bases_visiveis())) a
  ),
  por_dia as (
    select c.login, c.dia,
           round(sum(coalesce(c.pontos, 0)) / (select div from lim), 4) as vt,
           count(*)::int as atividades,
           count(*) filter (where c.pontos is null)::int as sem_ponto
      from com_ponto c group by c.login, c.dia
  ),
  esc as (
    select e.login, e.dia, e.codigo
      from vt_escala e cross join lim
     where e.dia between lim.ini and lim.fim
       and e.empresa_id = (select minha_empresa())
       and e.base_id in (select bases_visiveis())
  ),
  logins as (
    select distinct login from por_dia
    union
    select distinct login from esc
  ),
  -- O nome é o do técnico dono do login na cidade; sem ele, o de quem
  -- estava responsável pela atividade.
  quem as (
    select l.login,
           coalesce(
             (select t.nome from tecnico t
               where upper(t.matricula) = l.login and t.base_id in (select bases_visiveis())
               order by (t.situacao = 'ATIVO') desc limit 1),
             (select t.nome from com_ponto c join tecnico t on t.id = c.tec
               where c.login = l.login order by c.dia desc limit 1)) as nome,
           coalesce(
             (select e.codigo from tecnico t join equipe e on e.id = t.equipe_id
               where upper(t.matricula) = l.login and t.base_id in (select bases_visiveis())
               order by (t.situacao = 'ATIVO') desc limit 1),
             (select e.codigo from com_ponto c join tecnico t on t.id = c.tec
                join equipe e on e.id = t.equipe_id
               where c.login = l.login order by c.dia desc limit 1)) as equipe
      from logins l
  )
  select q.login, q.nome, q.equipe,
         coalesce((select jsonb_agg(jsonb_build_object('dia', d.dia, 'vt', d.vt, 'atividades', d.atividades)
                                    order by d.dia)
                     from por_dia d where d.login = q.login), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('dia', e.dia, 'codigo', e.codigo) order by e.dia)
                     from esc e where e.login = q.login), '[]'::jsonb),
         coalesce((select sum(d.sem_ponto) from por_dia d where d.login = q.login), 0)::int
    from quem q
   order by q.nome nulls last, q.login;
$function$;

-- O agregado por cidade (247): cada cidade que a pessoa pode ver, login a login,
-- com os valores do dia e os períodos ETN. As contas (SE, SOMA, equipes) a tela
-- faz com a MESMA função da tabela da cidade ativa.
create or replace function public.vt_por_equipe_cidades(p_ini date, p_fim date)
 returns table(base_id uuid, codigo text, cidade text, login text, por_dia jsonb, etn jsonb)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with lim as materialized (
    select coalesce((select (valor #>> '{}')::numeric from parametro
                      where empresa_id = minha_empresa() and chave = 'vt_pontos_por_vt'), 35) as div
  ),
  pd as (
    select a.base_id, a.login, a.dia,
           round(sum(coalesce(a.pontos, 0)) / (select div from lim), 4) as vt
      from _vt_atividades(p_ini, p_fim, array(select bases_permitidas())) a
     group by a.base_id, a.login, a.dia
  )
  select b.id, b.codigo, b.nome, x.login,
         jsonb_agg(jsonb_build_object('dia', x.dia, 'vt', x.vt) order by x.dia),
         coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'login', e.login, 'de', e.de, 'ate', e.ate) order by e.de)
                     from vt_etn e
                    where e.base_id = b.id and e.login = x.login
                      and e.empresa_id = (select minha_empresa())
                      and e.de <= p_fim and (e.ate is null or e.ate >= p_ini)), '[]'::jsonb)
    from pd x
    join base b on b.id = x.base_id
   group by b.id, b.codigo, b.nome, x.login
   order by b.nome, x.login;
$function$;
revoke all on function public.vt_por_equipe_cidades(date, date) from public, anon;
grant execute on function public.vt_por_equipe_cidades(date, date) to authenticated;

notify pgrst, 'reload schema';
