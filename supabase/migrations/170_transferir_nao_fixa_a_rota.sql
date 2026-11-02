-- ┌─ 170 · transferir não desarma mais o roteamento do TOA (D-257) ────┐
-- │ > "quando eu transferir manualmente um contrato de um técnico para │
-- │ >  outro, não deve desarmar automático, o usuário que precisa      │
-- │ >  desarmar se ele quiser" — Emanuel, 02/11                        │
-- │                                                                     │
-- │ MUDA A D-131 ("Transferir passa a fixar sozinho"): `transferir_    │
-- │ visita` gravava `rota_fixada_em` em toda transferência. Agora não  │
-- │ toca nas colunas da rota fixada: o contrato que estava armado      │
-- │ continua armado, e o que alguém tinha fixado continua fixado. Fixar│
-- │ é só pela chave "Roteamento do TOA" (`fixar_rota_da_visita`).      │
-- │                                                                     │
-- │ CONSEQUÊNCIA, dita ao Emanuel: com o roteamento ARMADO, a próxima  │
-- │ importação devolve o contrato à equipe do login do técnico no      │
-- │ relatório — a transferência só segura se quem transferiu desarmar  │
-- │ a chave. Foi exatamente o defeito que a D-131 corrigiu; agora é    │
-- │ escolha de quem opera, contrato a contrato.                         │
-- └─────────────────────────────────────────────────────────────────────┘

create or replace function public.transferir_visita(p_visita uuid, p_equipe uuid, p_motivo text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_ant uuid; v_cod_ant text; v_cod_novo text; v_fixada boolean;
begin
  if not (eh_gestao() and tem_permissao('servicos.transferir')) then
    raise exception 'Sem permissao para transferir.' using errcode = '42501';
  end if;

  select equipe_id, rota_fixada_em is not null into v_ant, v_fixada from visita
   where id = p_visita and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis());
  if not found then raise exception 'Visita nao encontrada.'; end if;

  if v_ant is not distinct from p_equipe then
    return jsonb_build_object('mudou', false);
  end if;

  select codigo into v_cod_ant  from equipe where id = v_ant;
  select codigo into v_cod_novo from equipe where id = p_equipe;

  insert into visita_evento (visita_id, usuario_id, equipe_id, tipo,
                             de, para, observacao, origem)
  values (p_visita, auth.uid(), v_ant, 'TRANSFERENCIA',
          jsonb_build_object('equipe', v_cod_ant),
          jsonb_build_object('equipe', v_cod_novo),
          p_motivo, 'WEB');

  -- 170: a rota fixada fica como estava (D-257)
  update visita set
      equipe_id = p_equipe,
      tecnico_responsavel_id = null
   where id = p_visita;

  return jsonb_build_object('mudou', true, 'de', v_cod_ant, 'para', v_cod_novo,
                            'rota_fixada', v_fixada);
end;
$function$;

notify pgrst, 'reload schema';
