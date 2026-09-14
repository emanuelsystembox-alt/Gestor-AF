-- ============================================================
-- 069 · O supervisor do painel é o declarado, não o da planilha
--
-- > "não aparece em nenhum canto que o supervisor é o Supervisor X,
-- >  aparece o nome Raphael Felipe, não sei de onde […] nosso time é só
-- >  isso, não tem por que ter mais nomes de fora e nem suposições"
-- >  — Emanuel
--
-- De onde vinha: `painel_equipes` mostrava
-- `norm_supervisor(equipe.supervisor_nome)` — o texto da coluna
-- SUPERVISOR da planilha de equipes, com o prefixo "SUPERVISOR - "
-- tirado. Nunca foi suposição do sistema; é dado da própria planilha.
-- Mas aparecia SEM ETIQUETA, igualzinho a um nome de gente com acesso.
--
-- A precedência passa a ser explícita:
--
--     1. tecnico.supervisor_id    o que ALGUEM declarou (068)
--     2. equipe.supervisor_id     o acesso ligado ao nome da planilha (040)
--     3. equipe.supervisor_nome   o texto da planilha -> a tela marca
--                                 "da planilha", acinzentado
--
-- `supervisor_declarado` existe para a tela poder fazer essa distinção
-- sem repetir a regra: quem decide o que mostrar e o que marcar e o
-- banco, num lugar so.
--
-- Quando os tecnicos de uma equipe tem supervisores declarados
-- DIFERENTES, vale o mais frequente -- e continua marcado como
-- declarado. E caso de borda: equipe tem 1 ou 2 tecnicos aqui.
--
-- ┌─ por que DROP e nao CREATE OR REPLACE ───────────────────────────┐
-- │ Coluna nova no `returns table` -> "cannot change return type".    │
-- │ E funcao recriada do zero NASCE COM A ACL ABERTA ao anon, entao o │
-- │ revoke/grant vem junto, obrigatoriamente. Ver agent_docs/traps.md │
-- │ e o par 059 -> 061.                                               │
-- └───────────────────────────────────────────────────────────────────┘
--
-- CONFERIDO com o dado real de 10/09:
--     antes   001 - EQUIPE   RAPHAEL FELIPE
--     depois  001 - EQUIPE   Supervisor X   (supervisor_declarado = true)
-- ============================================================

drop function if exists public.painel_equipes(date);

create function public.painel_equipes(p_data date)
returns table(equipe_id uuid, codigo text, nome text, area text,
              supervisor text, supervisor_declarado boolean,
              login_toa text, tecnicos bigint, visitas bigint, ordens bigint,
              periodos jsonb, situacoes jsonb,
              ultima_atividade timestamp with time zone, situacao_final text,
              minutos_parada integer, ocioso boolean)
language sql
stable
set search_path to 'public'
as $function$
with cfg as (
  select coalesce(min(em.minutos_ocioso), 10)::int as minutos from empresa em
),
v as (
  select vi.id, vi.equipe_id, vi.situacao, vi.janela_inicio, vi.janela_fim,
         coalesce(vi.fim,
                  case when vi.bloqueado_em is not null then vi.situacao_em end
         ) as encerrado_em
    from visita vi
   where vi.data_agendada = p_data
     and vi.equipe_id is not null
     and vi.excluido_em is null
),
pers as (
  select t.equipe_id,
         jsonb_agg(jsonb_build_object('janela', t.j, 'qtd', t.n) order by t.j) as lista
    from (
      select v.equipe_id,
             case when v.janela_inicio is null then 'SEM JANELA'
                  else to_char(v.janela_inicio, 'HH24:MI') || ' - ' ||
                       coalesce(to_char(v.janela_fim, 'HH24:MI'), '?')
             end as j,
             count(*) as n
        from v group by 1, 2
    ) t
   group by t.equipe_id
),
sits as (
  select t.equipe_id,
         jsonb_agg(jsonb_build_object('situacao', t.situacao, 'qtd', t.n) order by t.n desc) as lista
    from (select v.equipe_id, v.situacao, count(*) as n from v group by 1, 2) t
   group by t.equipe_id
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
    from visita_evento ve where ve.equipe_id is not null group by 1
),
-- 069: o supervisor DECLARADO dos tecnicos desta equipe (068). Quando
-- os declarados divergem, vale o mais frequente -- e a tela marca como
-- declarado do mesmo jeito.
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
         -- Precedencia: o que ALGUEM declarou, depois o acesso ligado a
         -- equipe, e so por ultimo o texto que veio da planilha.
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
         ult.situacao as situacao_final
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
)
select b.id, b.codigo, b.nome, b.area, b.supervisor, b.supervisor_declarado,
       b.login_toa, b.tecnicos, b.visitas, b.ordens, b.periodos, b.situacoes,
       b.ultima_atividade, b.situacao_final,
       case when p_data = current_date and b.ultima_atividade is not null
            then floor(extract(epoch from now() - b.ultima_atividade) / 60)::int
       end,
       case when p_data = current_date
            then b.situacao_final in ('CONCLUIDA', 'CANCELADA')
                 and b.ultima_atividade is not null
                 and now() - b.ultima_atividade > ((select c.minutos from cfg c) || ' minutes')::interval
       end
  from base b;
$function$;

revoke all on function public.painel_equipes(date) from public, anon;
grant execute on function public.painel_equipes(date) to authenticated;

notify pgrst, 'reload schema';
