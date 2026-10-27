-- 151 · Quantas equipes rodam VT e quantas rodam ADESAO hoje
--
-- > "seria bom tambem mostrar aqui quantidade de tecnico de VT rodando
-- >  hoje e tecnico de adesao, contar as equipes que estao com rota mais
-- >  de 1 contrato em linha" -- Emanuel, 26/10, apontando o item Equipes
--
-- "EM ROTA" = equipe com MAIS DE UM contrato produtivo no dia, como ele
-- pediu. Uma visita solta nao e rota.
--
-- A FRENTE SAI DO QUE A EQUIPE ESTA FAZENDO HOJE, nao do cadastro: a
-- escala muda todo dia, e `tecnico.skill` e cadastro que envelhece. A
-- regra e o grupo de servico PREDOMINANTE da rota.
--
-- Medido em 26/10 antes de escrever: 54 equipes com contrato, TODAS com
-- 2 ou mais. 17 predominam VISITA TECNICA, 30 ADESAO, e apenas DUAS
-- fazem as duas coisas no mesmo dia -- ou seja, o predominante quase
-- nunca e desempate, e sim o retrato fiel da frente. As 7 restantes nao
-- fazem nem VT nem adesao (servico, migracao GPON, mudanca de
-- endereco): entram em OUTRAS, e nao sao empurradas para um dos dois.
--
-- Empate de verdade (mesma quantidade de VT e de adesao, as duas > 0)
-- cai em OUTRAS tambem: inventar um criterio de desempate seria o
-- sistema decidindo no lugar de quem opera (D-088).
--
-- Cancelado pela central, desatribuido e jornada ficam FORA, como em
-- toda contagem de volume (D-225).
--
-- Ver D-230.

create or replace function public.equipes_em_rota()
returns table(frente text, equipes integer, contratos integer)
language sql stable security definer
set search_path to 'public'
as $function$
  with eq as (
    select v.equipe_id,
           count(*)::int as n,
           count(*) filter (where norm_txt(coalesce(ts.nome,'')) = 'VISITA TECNICA')::int as vt,
           count(*) filter (where norm_txt(coalesce(ts.nome,'')) = 'ADESAO')::int as ad
      from visita v
      join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join tipo_servico ts on ts.id = v.tipo_servico_id
     where v.data_agendada = hoje_local()
       and v.excluido_em is null
       and v.contrato is not null
       and v.equipe_id is not null
       and ta.natureza = 'PRODUTIVA'
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
       and not (v.situacao = 'CANCELADA' and (
            norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO'
            or exists (select 1 from ordem_servico o
                        join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                       where o.visita_id = v.id and cb.codigo = 800)))
     group by v.equipe_id
    having count(*) > 1          -- "mais de 1 contrato em linha"
  )
  select case when eq.vt > eq.ad then 'VT'
              when eq.ad > eq.vt then 'ADESAO'
              else 'OUTRAS' end,
         count(*)::int,
         sum(eq.n)::int
    from eq
   group by 1;
$function$;

revoke all on function public.equipes_em_rota() from public, anon;
grant execute on function public.equipes_em_rota() to authenticated, service_role;

comment on function public.equipes_em_rota() is
  '151: equipes com MAIS DE UM contrato no dia, repartidas pela frente '
  'PREDOMINANTE da rota (VT / ADESAO / OUTRAS). A frente sai do que a equipe '
  'faz hoje, nao do cadastro de skill. Ver D-230.';

notify pgrst, 'reload schema';
