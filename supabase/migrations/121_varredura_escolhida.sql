-- ┌─ 121 · quem opera escolhe o que a varredura lê ─────────────────────┐
-- │ > "seria interessante eu escolher também o que eu vou varrer,       │
-- │ >  coloquei para começar primeiro na VT e não vai, ele segue o      │
-- │ >  padrão dos dois" — Emanuel, 20/10                                │
-- │                                                                    │
-- │ `varredura_pendentes` ganha dois filtros, os dois opcionais:       │
-- │   p_buckets — só estes buckets (nulo ou vazio = todos);            │
-- │   p_o_que   — 'TUDO' (padrão, o de sempre), 'NOME' (só quem está   │
-- │               sem nome) ou 'EQUIPAMENTO' (só os encerrados no TOA  │
-- │               ainda sem a lista lida).                             │
-- │ Em 'NOME' a extensão não abre a lista de equipamento — e           │
-- │ `registrar_varredura` só marca `toa_varrido_em` quando a lista foi │
-- │ lida, então o encerrado continua pendente para a próxima.          │
-- │                                                                    │
-- │ Assinatura nova com default: a de 1 argumento é derrubada, senão a │
-- │ chamada da extensão antiga (só p_base) fica ambígua (traps.md). A  │
-- │ 0.5.0 continua funcionando: os dois novos têm default.             │
-- └────────────────────────────────────────────────────────────────────┘

drop function if exists public.varredura_pendentes(uuid);

create function public.varredura_pendentes(
  p_base uuid, p_buckets text[] default null, p_o_que text default 'TUDO')
 returns table(aid text, contrato text, precisa_nome boolean, precisa_equipamento boolean, bucket text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_o_que text := upper(coalesce(nullif(btrim(p_o_que), ''), 'TUDO'));
  v_todos boolean := p_buckets is null or cardinality(p_buckets) = 0;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('ROBO')) then
    raise exception 'Sem permissao para varrer.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_visiveis()) then
    raise exception 'Esta cidade nao e a cidade ativa da sua tela.' using errcode = '42501';
  end if;
  if v_o_que not in ('TUDO', 'NOME', 'EQUIPAMENTO') then
    raise exception 'O que varrer: TUDO, NOME ou EQUIPAMENTO (veio %).', p_o_que;
  end if;
  return query
  with c as (
    select v.toa_atividade_id as aid, v.contrato, v.toa_bucket as bucket, v.fim, v.janela_inicio,
           nullif(btrim(coalesce(v.cliente_nome, '')), '') is null as sem_nome,
           coalesce(v.finalizado_toa, false) and v.toa_varrido_em is null as sem_lista
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.base_id = p_base
       and v.data_agendada = hoje_local()
       and v.excluido_em is null
       and v.toa_atividade_id is not null
       and coalesce(ta.natureza, '') <> 'JORNADA'
       and (v_todos or v.toa_bucket = any (p_buckets))
  )
  select c.aid, c.contrato,
         c.sem_nome and v_o_que <> 'EQUIPAMENTO',
         c.sem_lista and v_o_que <> 'NOME',
         c.bucket
    from c
   where (v_o_que in ('TUDO', 'NOME') and c.sem_nome)
      or (v_o_que in ('TUDO', 'EQUIPAMENTO') and c.sem_lista)
   -- um bucket de cada vez (120); a extensão põe o bucket ABERTO no Console primeiro
   order by c.bucket nulls last, c.fim nulls last, c.janela_inicio nulls last;
end;
$function$;

revoke all on function public.varredura_pendentes(uuid, text[], text) from public, anon;
grant execute on function public.varredura_pendentes(uuid, text[], text) to authenticated;

notify pgrst, 'reload schema';
