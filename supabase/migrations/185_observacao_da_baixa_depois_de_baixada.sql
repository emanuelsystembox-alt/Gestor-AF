-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 185 — A observação da baixa depois de baixada                         │
-- │                                                                      │
-- │ "coloca na baixa a observação - mesmo apos baixado técnico consegue  │
-- │  colocar observação da baixa"                     — Emanuel, 03/11  │
-- │                                                                      │
-- │ Até aqui a observação só entrava junto com o código, em `baixar_os`, │
-- │ e o campo não rebaixa (trava 2, 055): esqueceu de escrever, ficou    │
-- │ sem. Agora a observação se escreve (ou se reescreve) com a O.S. já   │
-- │ baixada — SEM mexer no código, na sub-falha nem na situação, que     │
-- │ continuam sendo do controlador corrigir (D-030).                     │
-- │                                                                      │
-- │ Quem pode e quando: a mesma porta do anexo (`pode_anexar_na_visita`, │
-- │ sem o prazo extra da evidência). O controle, no escopo dele; o       │
-- │ campo, na equipe dele e só no contrato do DIA — é a trava 3: depois  │
-- │ de baixado o técnico ainda acrescenta, enquanto o contrato é de hoje.│
-- │                                                                      │
-- │ Nada se perde: o texto anterior vai no `de` do evento                │
-- │ OBSERVACAO_BAIXA. O autor é carimbado aqui (D-061).                  │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.observar_baixa(p_os uuid, p_observacao text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_visita uuid; v_baixada uuid; v_antes text; v_nova text;
  v_tecnico uuid; v_campo boolean;
begin
  select o.visita_id, o.codigo_baixa_afline_id, o.baixa_observacao
    into v_visita, v_baixada, v_antes
    from ordem_servico o where o.id = p_os;
  if v_visita is null then
    raise exception 'O.S. nao encontrada.' using errcode = 'P0002';
  end if;

  -- Escopo, permissão "Anexar" e o dia do campo: a regra do anexo, sem cópia.
  perform pode_anexar_na_visita(v_visita, false);

  if v_baixada is null then
    raise exception 'Esta O.S. ainda nao foi baixada: escreva a observacao na baixa.'
      using errcode = '23514';
  end if;

  v_nova := nullif(btrim(coalesce(p_observacao, '')), '');
  if v_nova is not distinct from v_antes then
    return jsonb_build_object('ok', true, 'os', p_os, 'mudou', false);
  end if;

  v_campo := tem_papel('TECNICO') and not (select eh_gestor())
             and not (tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'));
  v_tecnico := meu_tecnico_id();

  update ordem_servico set baixa_observacao = v_nova where id = p_os;

  insert into visita_evento
    (visita_id, os_id, tipo, de, para, origem, usuario_id, login, tecnico_id, observacao)
  values (v_visita, p_os, 'OBSERVACAO_BAIXA',
          jsonb_build_object('observacao', v_antes),
          jsonb_build_object('observacao', v_nova),
          case when v_campo then 'MOBILE' else 'TELA' end,
          auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico, coalesce(v_nova, '(observacao apagada)'));

  return jsonb_build_object('ok', true, 'os', p_os, 'mudou', true);
end;
$function$;

revoke all on function public.observar_baixa(uuid, text) from public, anon;
grant execute on function public.observar_baixa(uuid, text) to authenticated;

notify pgrst, 'reload schema';
