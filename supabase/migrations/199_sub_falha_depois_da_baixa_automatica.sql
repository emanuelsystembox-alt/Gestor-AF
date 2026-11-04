-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 199 — O técnico põe a sub-falha depois da baixa automática do TOA     │
-- │                                                                      │
-- │ "depois de baixado o técnico deve conseguir colocar as subfalhas com │
-- │  base no código toa baixado depois de concluído automático"          │
-- │  — Emanuel, 03/11.                                                   │
-- │                                                                      │
-- │ A sub-falha só entrava pela baixa da AFLINE (`baixar_os`). Quando o  │
-- │ contrato fecha sozinho pelo código do TOA, o técnico não baixa — e a │
-- │ O.S. ficava sem sub-falha. `definir_sub_falha` grava a do código do  │
-- │ TOA daquela O.S. (sub_falha.codigo = código do TOA, conjunto vigente │
-- │ da empresa, ativa), com as travas da observação depois da baixa      │
-- │ (185): `pode_anexar_na_visita(…, false)` — escopo, e o campo só no   │
-- │ dia. Só em O.S. com código do TOA e SEM baixa da AFLINE: com baixa   │
-- │ nossa a sub-falha é a da baixa (`baixar_os`), e não se sobrescreve.  │
-- │ Nulo apaga. Tudo fica no histórico (evento SUB_FALHA; o aviso ao     │
-- │ técnico ignora o tipo).                                              │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.definir_sub_falha(p_os uuid, p_sub_falha uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_visita uuid; v_cod_toa int; v_tem_afline boolean; v_antes uuid;
  v_conj text; v_nome_antes text; v_nome text; v_tecnico uuid; v_campo boolean;
begin
  select o.visita_id, cb.codigo, o.codigo_baixa_afline_id is not null, o.sub_falha_id
    into v_visita, v_cod_toa, v_tem_afline, v_antes
    from ordem_servico o
    left join codigo_baixa cb on cb.id = o.codigo_baixa_id
   where o.id = p_os;
  if v_visita is null then
    raise exception 'O.S. nao encontrada.' using errcode = 'P0002';
  end if;
  perform pode_anexar_na_visita(v_visita, false);

  if v_cod_toa is null then
    raise exception 'Esta O.S. ainda nao tem codigo de baixa do TOA.' using errcode = '23514';
  end if;
  if v_tem_afline then
    raise exception 'Esta O.S. foi baixada pela AFLINE: a sub-falha e a da baixa.' using errcode = '23514';
  end if;

  if p_sub_falha is not null then
    select conjunto_sub_falha into v_conj from empresa where id = minha_empresa();
    select s.nome into v_nome from sub_falha s
     where s.id = p_sub_falha and s.codigo = v_cod_toa and s.ativo
       and (v_conj is null or s.conjunto = v_conj);
    if v_nome is null then
      raise exception 'Esta sub-falha nao e do codigo % do TOA.', v_cod_toa using errcode = '23514';
    end if;
  end if;

  if p_sub_falha is not distinct from v_antes then
    return jsonb_build_object('ok', true, 'os', p_os, 'mudou', false);
  end if;
  select nome into v_nome_antes from sub_falha where id = v_antes;

  v_campo := tem_papel('TECNICO') and not (select eh_gestor())
             and not (tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'));
  v_tecnico := meu_tecnico_id();

  update ordem_servico set sub_falha_id = p_sub_falha where id = p_os;

  insert into visita_evento (visita_id, os_id, tipo, de, para, origem, usuario_id, login,
                             tecnico_id, sub_falha_id, observacao)
  values (v_visita, p_os, 'SUB_FALHA',
          jsonb_build_object('sub_falha', v_nome_antes), jsonb_build_object('sub_falha', v_nome),
          case when v_campo then 'MOBILE' else 'TELA' end, auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico, p_sub_falha, coalesce(v_nome, '(sub-falha apagada)'));

  return jsonb_build_object('ok', true, 'os', p_os, 'mudou', true);
end;
$function$;

revoke all on function public.definir_sub_falha(uuid, uuid) from public, anon;
grant execute on function public.definir_sub_falha(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
