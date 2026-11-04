-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 188 — A exclusão definitiva não trava na casa marcada do cliente      │
-- │                                                                      │
-- │ "tentem apagar em massa esses contratos de hoje, está dando erro,     │
-- │  são de São Luís" — Emanuel, 03/11. O "Apagar do banco" estourava:   │
-- │ violates foreign key constraint "casa_cliente_visita_id_fkey".       │
-- │                                                                      │
-- │ `casa_cliente` aponta para a visita sem ON DELETE (NO ACTION). Em    │
-- │ São Luís, 39 dos 171 contratos de hoje tinham casa marcada (69       │
-- │ marcações) — um só na seleção já derrubava o lote inteiro.           │
-- │                                                                      │
-- │ A marcação é do CLIENTE (chave: empresa + contrato + endereço) e     │
-- │ vale para as próximas visitas; `visita_id` só diz onde foi feita, e  │
-- │ aceita nulo. Então ela fica e perde o elo — o mesmo que a função já  │
-- │ faz com a reincidência. Apagar a casa junto foi recusado: perderia   │
-- │ uma posição verdadeira do cliente por causa de um contrato errado.   │
-- │                                                                      │
-- │ `miscelanea_movimento` também é NO ACTION e não foi mexido: é o      │
-- │ razão do saldo do técnico (D-157), e o que fazer com material gasto  │
-- │ num contrato apagado é pergunta para o Emanuel. Hoje: 0 casos.       │
-- │                                                                      │
-- │ Corpo copiado da função VIVA (traps.md).                             │
-- └──────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION public.excluir_visitas_definitivo(p_visitas uuid[], p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n_reg int := 0; n_del int := 0;
begin
  -- Mais restrito que a exclusão lógica de propósito: aquilo se desfaz,
  -- isto não. Gestor marca; só ADMIN apaga.
  if not tem_papel('ADMIN') then
    raise exception 'Somente ADMIN apaga contrato do banco. Exclusao definitiva nao se desfaz.'
      using errcode = '42501';
  end if;
  if not tem_permissao('servicos.excluir') then
    raise exception 'Seu perfil de acesso nao inclui "Excluir contrato".'
      using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da exclusao.' using errcode = '23514';
  end if;
  if p_visitas is null or array_length(p_visitas, 1) is null then
    raise exception 'Nenhum contrato selecionado.' using errcode = '23514';
  end if;
  if array_length(p_visitas, 1) > 500 then
    raise exception 'Selecao de % contratos e grande demais para uma acao so (limite 500).',
      array_length(p_visitas, 1) using errcode = '23514';
  end if;

  -- 1. registra ANTES de apagar: depois do delete não há o que ler
  insert into exclusao_definitiva (
    empresa_id, base_id, visita_id, toa_atividade_id, contrato, wo_numero,
    data_agendada, situacao, equipe_codigo, ordens, motivo, excluido_por)
  select v.empresa_id, v.base_id, v.id, v.toa_atividade_id, v.contrato, v.wo_numero,
         v.data_agendada, v.situacao, e.codigo,
         (select count(*) from ordem_servico o where o.visita_id = v.id),
         btrim(p_motivo), auth.uid()
    from visita v
    left join equipe e on e.id = v.equipe_id
   where v.id = any(p_visitas)
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  get diagnostics n_reg = row_count;

  if n_reg = 0 then
    raise exception 'Nenhum dos contratos selecionados esta visivel para voce.'
      using errcode = 'P0002';
  end if;

  -- 2. a reincidência que aponta para ela como ANTERIOR perde o elo,
  --    em vez de impedir o delete
  update reincidencia set visita_anterior_id = null
   where visita_anterior_id = any(p_visitas);

  -- 188: a casa marcada é do CLIENTE (contrato + endereço), não da visita:
  --      fica para as próximas visitas e só perde o elo com esta
  update casa_cliente set visita_id = null
   where visita_id = any(p_visitas);

  -- 3. e agora sai de verdade (o resto vai por CASCADE)
  delete from visita v
   where v.id = any(p_visitas)
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  get diagnostics n_del = row_count;

  return jsonb_build_object('apagados', n_del, 'registrados', n_reg);
end;
$function$;
