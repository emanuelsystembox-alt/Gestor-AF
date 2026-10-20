-- ┌─ 120 · a varredura sabe o bucket de cada contrato ─────────────────┐
-- │ > "nosso sistema de varrer não pegou dados de nenhum vt" — Emanuel, │
-- │ >  20/10                                                            │
-- │                                                                    │
-- │ A varredura acha o contrato pelo bloco no Console de Alocação — e o │
-- │ Console mostra UM bucket (o marcado na árvore do TOA). Os 56 da VT  │
-- │ moram em MAN-AFLINE_01_VT; com MAN-AFLINE aberto, todos caíam em    │
-- │ "fora do Console". Às 12:42 foram 192 de 192: o Console estava em   │
-- │ outro bucket.                                                       │
-- │                                                                    │
-- │ Agora `varredura_pendentes` devolve o bucket (`visita.toa_bucket`,  │
-- │ 119) e ordena por ele, e a extensão (0.5.0) abre o bucket na árvore │
-- │ antes de procurar os contratos dele — um clique de navegação, como  │
-- │ faria uma pessoa.                                                   │
-- │                                                                    │
-- │ Coluna nova no `returns table` exige drop (traps.md) — e função     │
-- │ recriada nasce com a ACL aberta: revoke/grant abaixo.               │
-- └────────────────────────────────────────────────────────────────────┘

drop function if exists public.varredura_pendentes(uuid);

create function public.varredura_pendentes(p_base uuid)
 returns table(aid text, contrato text, precisa_nome boolean, precisa_equipamento boolean, bucket text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('ROBO')) then
    raise exception 'Sem permissao para varrer.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_visiveis()) then
    raise exception 'Esta cidade nao e a cidade ativa da sua tela.' using errcode = '42501';
  end if;
  return query
  select v.toa_atividade_id, v.contrato,
         nullif(btrim(coalesce(v.cliente_nome, '')), '') is null,
         coalesce(v.finalizado_toa, false) and v.toa_varrido_em is null,
         v.toa_bucket
    from visita v
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
   where v.base_id = p_base
     and v.data_agendada = hoje_local()
     and v.excluido_em is null
     and v.toa_atividade_id is not null
     and coalesce(ta.natureza, '') <> 'JORNADA'
     and (nullif(btrim(coalesce(v.cliente_nome, '')), '') is null
          or (coalesce(v.finalizado_toa, false) and v.toa_varrido_em is null))
   -- um bucket de cada vez: trocar o Console a cada contrato custaria um
   -- recarregamento da árvore por linha
   order by v.toa_bucket nulls last, v.fim nulls last, v.janela_inicio nulls last;
end;
$function$;

revoke all on function public.varredura_pendentes(uuid) from public, anon;
grant execute on function public.varredura_pendentes(uuid) to authenticated;

notify pgrst, 'reload schema';
