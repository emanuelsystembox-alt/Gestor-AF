-- ┌─ 118 · a varredura entra no histórico de rodadas ──────────────────┐
-- │ > "ele não diz o que importou (...) ele não mostra se foi com      │
-- │ >  sucesso ou falha" — Emanuel, 19/10, sobre a primeira varredura  │
-- │                                                                    │
-- │ A varredura (117) só deixava `sincronismo.varredura_info` — uma    │
-- │ linha que se sobrescreve. Agora cada varredura terminada vira uma  │
-- │ linha em `sincronismo_rodada` (resultado VARREDURA), com o resumo  │
-- │ e quantos contratos passaram, ao lado das rodadas de baixa. Quem   │
-- │ grava é a extensão (D-193), pelo `varredura_estado` de sempre.     │
-- └────────────────────────────────────────────────────────────────────┘

alter table sincronismo_rodada drop constraint if exists sincronismo_rodada_resultado_check;
alter table sincronismo_rodada add constraint sincronismo_rodada_resultado_check
  check (resultado in ('IMPORTADA', 'SEM_MUDANCA', 'SEM_SESSAO', 'ERRO', 'VARREDURA'));

create or replace function public.varredura_estado(p_base uuid, p_terminou text default null, p_contratos integer default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s sincronismo;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('ROBO')) then
    raise exception 'Sem permissao para varrer.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_visiveis()) then
    raise exception 'Esta cidade nao e a cidade ativa da sua tela.' using errcode = '42501';
  end if;
  if p_terminou is not null then
    update sincronismo set varredura_em = now(), varredura_info = left(p_terminou, 300)
     where base_id = p_base;
    -- 118: e uma linha no histórico, ao lado das rodadas de baixa.
    insert into sincronismo_rodada (empresa_id, base_id, bucket_id, bucket, dia, iniciada_em,
           resultado, mensagem, linhas, executor_id, configurado_por)
    select b.empresa_id, b.id, null, 'Varredura do TOA', hoje_local(), now(),
           'VARREDURA', left(p_terminou, 1000), p_contratos, auth.uid(),
           (select s2.configurado_por from sincronismo s2 where s2.base_id = p_base)
      from base b where b.id = p_base;
  end if;
  select * into s from sincronismo where base_id = p_base;
  return jsonb_build_object(
    'intervalo_min', s.varredura_intervalo_min,
    'ultima', s.varredura_em, 'info', s.varredura_info,
    'vencida', s.varredura_intervalo_min is not null
               and (s.varredura_em is null
                    or now() - s.varredura_em >= make_interval(mins => s.varredura_intervalo_min)));
end;
$function$;

-- A assinatura mudou (p_contratos): a de 2 parâmetros sai, para a chamada
-- não ficar ambígua (traps.md).
drop function if exists public.varredura_estado(uuid, text);
revoke all on function public.varredura_estado(uuid, text, integer) from public, anon;
grant execute on function public.varredura_estado(uuid, text, integer) to authenticated;

notify pgrst, 'reload schema';
