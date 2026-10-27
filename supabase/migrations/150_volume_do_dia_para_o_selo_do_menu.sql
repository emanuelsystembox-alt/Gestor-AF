-- 150 · O volume do dia por situacao, para o selo do menu
--
-- > "e bom colocar o volume de contratos conforme as cores ao lado de
-- >  servicos pra saber o volume de cara, tire o cancelado central e
-- >  desatribuido" -- Emanuel, 26/10
--
-- O selo mostrava SO os contratos em aberto (10 num dia de 343) -- o
-- numero respondia "quanto falta", nao "quanto e o dia". Agora e o dia
-- inteiro, repartido pelas cores da situacao, para ler de relance.
--
-- POR QUE UMA RPC E NAO UMA CONSULTA NA TELA: o menu existe em TODAS as
-- telas e reconta a cada 2 min e a cada navegacao. Trazer as ~340 linhas
-- do dia com o embed de `ordem_servico` so para contar seria pagar o dia
-- inteiro em cada clique. Aqui volta uma linha por situacao -- e a regra
-- de exclusao fica num lugar so.
--
-- FORA DA CONTA, por pedido dele: cancelado pela central e desatribuido
-- (800). Mesma regra da D-225 e da D-228 -- ninguem foi, nao e volume de
-- trabalho. A jornada tambem fica fora, como em toda contagem de
-- contrato (Na Base e Refeicao nao sao servico).
--
-- Ver D-230.

create or replace function public.volume_do_dia()
returns table(situacao text, qtd integer)
language sql stable security definer
set search_path to 'public'
as $function$
  select v.situacao, count(*)::int
    from visita v
    join tipo_atividade ta on ta.id = v.tipo_atividade_id
   where v.data_agendada = hoje_local()
     and v.excluido_em is null
     and ta.natureza = 'PRODUTIVA'
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis())
     and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
     -- ninguem foi: fora do volume (D-225)
     and not (v.situacao = 'CANCELADA' and (
          norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO'
          or exists (select 1 from ordem_servico o
                      join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                     where o.visita_id = v.id and cb.codigo = 800)))
   group by v.situacao;
$function$;

revoke all on function public.volume_do_dia() from public, anon;
grant execute on function public.volume_do_dia() to authenticated, service_role;

comment on function public.volume_do_dia() is
  '150: o volume do dia por situacao, para o selo do menu. Cancelado pela '
  'central, desatribuido e jornada ficam FORA -- ninguem foi. Ver D-230.';

notify pgrst, 'reload schema';
