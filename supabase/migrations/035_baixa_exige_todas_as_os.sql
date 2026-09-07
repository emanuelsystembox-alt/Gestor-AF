-- 035 · Situação terminal exige TODAS as O.S. baixadas
--
-- Um contrato de 3 O.S. que fecha com 1 baixada mente duas vezes: diz
-- que o serviço acabou, e deixa duas ordens sem resultado — que é
-- justamente o que a CLARO fatura. O usuário informa o código de cada
-- uma antes de concluir, cancelar ou reagendar.
--
-- A regra mora num lugar só (`exige_todas_baixadas`) e as três portas
-- chamam ela: `baixar_visita`, `registrar_etapa` e a tela.

create or replace function situacoes_terminais() returns text[]
language sql immutable as $fn$
  select array['CONCLUIDA','CANCELADA','REAGENDAMENTO'];
$fn$;

create or replace function exige_todas_baixadas(p_visita uuid, p_situacao text)
returns void language plpgsql stable set search_path to 'public' as $fn$
declare v_falta int; v_lista text;
begin
  if p_situacao is null or not (p_situacao = any (situacoes_terminais())) then
    return;
  end if;
  select count(*), string_agg(o.numero_os, ', ' order by o.sequencia)
    into v_falta, v_lista
    from ordem_servico o
   where o.visita_id = p_visita and o.codigo_baixa_afline_id is null;
  if v_falta > 0 then
    -- Diz QUAIS faltam. "Faltam 2 O.S." manda o usuário procurar.
    raise exception 'Faltam % O.S. sem codigo de baixa: %', v_falta, v_lista
      using errcode = '23514';
  end if;
end;
$fn$;

revoke all on function exige_todas_baixadas(uuid, text) from public, anon;
grant execute on function exige_todas_baixadas(uuid, text) to authenticated;

-- Baixa em lote: uma chamada, todas as O.S. do contrato.
--
-- `p_itens` = [{"os_id":"…","codigo":409,"sub_falha_id":null,"observacao":null}]
--
-- Cada item passa por `baixar_os`, que já confere papel, permissão,
-- escopo de equipe, existência do código e coerência da sub-falha. Não
-- duplicamos regra aqui: duplicar é onde as duas versões divergem.
create or replace function baixar_visita(
  p_visita uuid, p_itens jsonb, p_situacao text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare it jsonb; n int := 0;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para baixar.' using errcode = '42501';
  end if;

  perform 1 from visita v
   where v.id = p_visita and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb))
  loop
    perform baixar_os(
      (it->>'os_id')::uuid,
      (it->>'codigo')::integer,
      nullif(it->>'sub_falha_id','')::uuid,
      nullif(btrim(coalesce(it->>'observacao','')),''),
      null);
    n := n + 1;
  end loop;

  if p_situacao is not null then
    perform exige_todas_baixadas(p_visita, p_situacao);

    update visita set situacao = p_situacao, situacao_em = now()
     where id = p_visita;

    insert into visita_evento (visita_id, tipo, para, origem, usuario_id, login,
                               tecnico_id, observacao)
    values (p_visita, 'SITUACAO',
            jsonb_build_object('situacao', p_situacao),
            case when tem_papel('TECNICO') and not eh_gestor() then 'MOBILE' else 'TELA' end,
            auth.uid(),
            coalesce((select matricula from tecnico where id = meu_tecnico_id()),
                     (select email from perfil where id = auth.uid())),
            meu_tecnico_id(),
            format('Baixa de %s O.S.', n));
  end if;

  return jsonb_build_object('baixadas', n, 'situacao', p_situacao);
end;
$fn$;

revoke all on function baixar_visita(uuid, jsonb, text) from public, anon;
grant execute on function baixar_visita(uuid, jsonb, text) to authenticated;

-- `registrar_etapa` ganhou a mesma guarda:
--   perform exige_todas_baixadas(p_visita, p_situacao);
-- logo antes do UPDATE. Corpo completo aplicado no banco (035b).
--
-- Testado ponta a ponta:
--   concluir com 0 de 2  -> barrado: "Faltam 2 O.S. ...: AF-…06, AF-…07"
--   concluir com 1 de 2  -> barrado: "Faltam 1 O.S. ...: AF-…07"
--   baixar_visita com as duas + CONCLUIDA -> situacao = CONCLUIDA
