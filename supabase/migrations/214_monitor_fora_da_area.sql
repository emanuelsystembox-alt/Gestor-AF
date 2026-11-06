-- 214 · Monitoramento: quem está FORA DA ÁREA agora
--
-- > "no Card de monitoramento deve aparecer a quantidade de técnico que saiu
-- >  da sua área de atuação, e quando clicar em cima deve mostrar eles."
-- >  — Emanuel, 05/11
--
-- ┌─ A REGRA NÃO É NOVA: é o estado que o sistema já mantém (097, D-171) ─┐
-- │ `registrar_rastro` confere cada ponto real (não simulado, precisão até │
-- │ 100 m) contra as cercas que valem para a equipe do técnico e guarda o  │
-- │ dentro/fora em `cerca_estado` — a troca só vale com 2 pontos seguidos  │
-- │ do outro lado. Esta função só LÊ esse estado; não reconfere polígono   │
-- │ nenhum, para o card e o sino não discordarem.                          │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ "A SUA ÁREA DE ATUAÇÃO" é a SOMA das áreas que valem para ele ───────┐
-- │ Uma equipe pode ter mais de uma área (em São Luís, as equipes 100,    │
-- │ 101, 107, 108 e 109 valem para "área 2" E "área 4"). Quem está dentro │
-- │ da área 2 não saiu da área de atuação só porque está fora da área 4 — │
-- │ medido em 05/11 às 22h30: contando cerca a cerca, 6 técnicos de São   │
-- │ Luís e 2 de Manaus apareceriam "fora" estando dentro de outra área    │
-- │ deles (5 + 2 fora de verdade). FORA = fora de TODAS as                │
-- │ áreas que valem para ele. O aviso do sino continua cerca a cerca      │
-- │ (097): esta função não mexe nele.                                      │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- Três respostas, e nenhuma é "zero" no lugar de "não sei":
--   FORA        todas as áreas dele têm leitura de HOJE e ele está fora de todas
--   DENTRO      está dentro de pelo menos uma
--   SEM_LEITURA tem área, mas falta leitura de hoje em alguma (sem ponto real
--               hoje, ou cerca redesenhada depois do último ponto)
-- Quem não tem área nenhuma que valha para a equipe dele NÃO aparece: é
-- "sem cerca", não "fora".
--
-- Só HOJE: `cerca_estado` é o presente, não guarda o dia. A leitura de ontem
-- não diz onde ele está agora — por isso o `ultimo_em >= início de hoje`.
--
-- Escopo: o mesmo do `monitor_tecnicos` (a cidade ativa; só a gestão). O
-- rastro é dado pessoal de empregado (096): `cerca_estado` não tem policy
-- nenhuma, e só esta função DEFINER, com o papel conferido dentro, o lê.

-- `drop` antes: nada chama esta função fora da tela nova, e o arquivo pode
-- ser reaplicado (create or replace não troca o returns table — traps.md).
drop function if exists public.monitor_fora_da_area();

create function public.monitor_fora_da_area()
returns table (
  tecnico_id uuid,
  situacao   text,
  areas      integer,
  cercas     text,
  cerca_ids  uuid[],
  desde      timestamptz,
  ultimo_em  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare v_ini timestamptz;
begin
  if not (select eh_gestao()) then
    raise exception 'Monitoramento e do controle.' using errcode = '42501';
  end if;
  v_ini := (hoje_local()::timestamp) at time zone 'America/Manaus';

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
  -- Quem vale para cada cerca: a MESMA condição de `registrar_rastro`.
  vale as materialized (
    select t.id as tec_id, c.id as c_id, c.nome, st.dentro, st.desde as st_desde, st.ultimo_em as st_ultimo
      from tec t
      join cerca c
        on c.empresa_id = (select minha_empresa())
       and c.tipo = 'AREA'
       and c.arquivado_em is null
       and ((c.todas_equipes and (c.base_id is null or c.base_id = t.base_id))
            or exists (select 1 from cerca_equipe ce
                        where ce.cerca_id = c.id and ce.equipe_id = t.equipe_id))
      left join cerca_estado st
        on st.tecnico_id = t.id and st.cerca_id = c.id and st.ultimo_em >= v_ini
  )
  select v.tec_id,
         case
           when bool_or(v.dentro) then 'DENTRO'
           when count(v.dentro) = count(*) then 'FORA'
           else 'SEM_LEITURA'
         end,
         count(*)::integer,
         string_agg(v.nome, ', ' order by v.nome),
         array_agg(v.c_id order by v.nome),
         -- fora de todas desde que saiu da ÚLTIMA em que estava
         case when count(v.dentro) = count(*) and not bool_or(v.dentro)
              then max(v.st_desde) end,
         max(v.st_ultimo)
    from vale v
   group by v.tec_id;
end;
$$;

revoke all on function public.monitor_fora_da_area() from public, anon;
grant execute on function public.monitor_fora_da_area() to authenticated;

notify pgrst, 'reload schema';
