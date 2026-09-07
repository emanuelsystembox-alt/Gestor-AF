-- 033 · Reincidência derivada do dado
--
-- ┌─ CINCO COLUNAS QUE SAÍAM SEMPRE VAZIAS ──────────────────────────┐
-- │ O relatório do sistema atual tem SERVICO-ANTERIOR-DATA, -QUANT-   │
-- │ DIAS, -EQUIPE, -COD-BAIXA e -TIPO-DE-SERVICO. O nosso emitia as   │
-- │ colunas e nunca punha nada nelas: a tabela `reincidencia` existia │
-- │ desde a 004 e jamais foi preenchida. Nada era calculado.          │
-- └───────────────────────────────────────────────────────────────────┘
--
-- A regra sai do dado, não de palpite: **visita anterior no mesmo
-- contrato**. É o que o relatório dele mostra — contrato 226749618,
-- SERVICO-ANTERIOR-DATA 07/08/2026, 30 dias, equipe 025, baixa
-- "409 - Instalacao Efetuada".
--
-- D-041 já dizia que o mesmo contrato ser atendido mais de uma vez é
-- NORMAL. Isto põe número nisso.
--
-- Nos três dias carregados: **12 reincidências em 11 contratos**, de 373
-- distintos. Cinco delas com `dias_desde = 0` — retorno no mesmo dia,
-- que é exatamente o caso do D-041. Uma delas conta a história inteira:
-- contrato 227011035, ADESAO em 06/09 pela equipe 062, dois dias depois
-- de a equipe 014 fechar em "110 - Problema Na Tubulação".

create or replace function detectar_reincidencia()
returns integer language plpgsql security definer
set search_path to 'public' as $fn$
declare n integer;
begin
  with anterior as (
    select
      v.id as visita_id,
      lag(v.id)            over w as visita_anterior_id,
      v.data_agendada - lag(v.data_agendada) over w as dias_desde,
      lag(v.equipe_id)     over w as equipe_anterior_id,
      -- Qual baixa, se a visita anterior tinha várias O.S.? A da
      -- OPERADORA, na O.S. de menor sequência que tenha uma. É a que o
      -- relatório dele mostra ("409 - Instalacao Efetuada"), e a da
      -- operadora é a que a CLARO reconhece (D-042).
      lag((select o.codigo_baixa_id from ordem_servico o
            where o.visita_id = v.id and o.codigo_baixa_id is not null
            order by o.sequencia limit 1)) over w as codigo_baixa_anterior_id
    from visita v
    where v.excluido_em is null
      and v.contrato is not null
    -- Jornada não tem contrato, então cai fora sozinha — como deve.
    window w as (partition by v.empresa_id, v.contrato
                 order by v.data_agendada, v.criado_em)
  )
  insert into reincidencia (visita_id, visita_anterior_id, dias_desde,
                            equipe_anterior_id, codigo_baixa_anterior_id)
  select visita_id, visita_anterior_id, dias_desde,
         equipe_anterior_id, codigo_baixa_anterior_id
    from anterior
   where visita_anterior_id is not null
  on conflict (visita_id) do update set
    visita_anterior_id       = excluded.visita_anterior_id,
    dias_desde               = excluded.dias_desde,
    equipe_anterior_id       = excluded.equipe_anterior_id,
    codigo_baixa_anterior_id = excluded.codigo_baixa_anterior_id,
    detectado_em             = now();

  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function detectar_reincidencia() from public, anon;
grant execute on function detectar_reincidencia() to authenticated;

-- Recalculado a cada importação aplicada.
--
-- Fica aqui, no invólucro público, e não dentro de
-- `importar_toa_interno`: a prévia (`p_simular`) estoura de propósito
-- para desfazer a transação, e recalcular reincidência num ensaio que
-- vai ser descartado é trabalho jogado fora.
create or replace function importar_toa(
  p_importacao_id uuid, p_simular boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare r jsonb;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao para importar planilha.'
      using errcode = '42501';
  end if;

  r := importar_toa_interno(p_importacao_id, p_simular);

  -- Só chega aqui quando não é simulação: a prévia sai por exception.
  return r || jsonb_build_object('reincidencias', detectar_reincidencia());
end;
$function$;

revoke all on function importar_toa(uuid, boolean) from public, anon;
grant execute on function importar_toa(uuid, boolean) to authenticated;

-- Conferido: anon não executa nenhuma das duas.
