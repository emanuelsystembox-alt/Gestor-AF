-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 209 — Observação da baixa também na O.S. encerrada pelo TOA (D-311)   │
-- │                                                                      │
-- │ "da direito de depois de baixado, ele colocar a observação da baixa, │
-- │  isso ja tem porém não nos contratos encerrados" — Emanuel, 05/11    │
-- │ (pela sessão AFLINE 360). Perguntado: só os contratos de HOJE; a     │
-- │ observação fica na O.S., como a da baixa do app; a miscelânea não    │
-- │ muda.                                                                 │
-- │                                                                      │
-- │ `observar_baixa` (185) exigia `codigo_baixa_afline_id` — a baixa que │
-- │ o técnico deu no app. O contrato que o TOA fechou sozinho (baixa     │
-- │ automática, 128) tem só o código da operadora, e o app oferecia ali  │
-- │ apenas a sub-falha (199). Agora vale qualquer uma das duas baixas.   │
-- │ O resto é o mesmo: escopo, permissão "Anexar" e o DIA do campo pela  │
-- │ `pode_anexar_na_visita(…, false)` — sem prazo extra (a regra da 136).│
-- │ A importação não toca em `baixa_observacao` (conferido: só           │
-- │ baixar_os, desatribuir_ausentes e esta função escrevem nela).        │
-- │ Regerada do banco (pg_get_functiondef), trocando só a condição.      │
-- └──────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION public.observar_baixa(p_os uuid, p_observacao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_visita uuid; v_baixada uuid; v_antes text; v_nova text;
  v_tecnico uuid; v_campo boolean;
begin
  -- 209: a O.S. encerrada pelo TOA (codigo do TOA, sem baixa nossa) tambem recebe observacao
  select o.visita_id, coalesce(o.codigo_baixa_afline_id, o.codigo_baixa_id), o.baixa_observacao
    into v_visita, v_baixada, v_antes
    from ordem_servico o where o.id = p_os;
  if v_visita is null then
    raise exception 'O.S. nao encontrada.' using errcode = 'P0002';
  end if;

  -- Escopo, permissão "Anexar" e o dia do campo: a regra do anexo, sem cópia.
  perform pode_anexar_na_visita(v_visita, false);

  if v_baixada is null then
    raise exception 'Esta O.S. ainda nao tem baixa (nem do app nem do TOA): escreva a observacao na baixa.'
      using errcode = '23514';
  end if;

  v_nova := nullif(btrim(coalesce(p_observacao, '')), '');
  if v_nova is not distinct from v_antes then
    return jsonb_build_object('ok', true, 'os', p_os, 'mudou', false);
  end if;

  v_campo := tem_papel('TECNICO') and not (select eh_gestor())
             and not (tem_papel('CONTROLADOR') or (tem_papel('SUPERVISOR') and not (select supervisor_esta_em_campo())));
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
