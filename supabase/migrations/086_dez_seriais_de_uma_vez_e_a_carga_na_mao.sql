-- ============================================================================
-- 086 · Dez seriais de uma vez, e a carga na mão do técnico
-- ============================================================================
--
-- > "se eu quiser enviar 10 seriais pra ele de uma única vez e retirar?
-- >  como fazer?"  — Emanuel, 26/09
--
-- Até a 085 o romaneio só aceitava UM serial por chamada: o balcão bipava
-- peça por peça. Isso serve ao leitor de código de barras, e continua
-- servindo. O que faltava era o outro jeito de a lista chegar: colada de
-- uma planilha, ou marcada na carga do técnico na hora da devolutiva.
--
-- O concorrente (Alfa Gestor → Estoque → Saída Unificada) resolve assim:
-- bipa ou "Colar do Excel", o servidor confere a lista inteira e devolve
-- uma tabela com o que ENTROU e o que foi RECUSADO, e por quê. Um serial
-- ruim não derruba os outros nove. É essa a mecânica que entra aqui.
--
-- ┌─ POR QUE NÃO UMA SEGUNDA CÓPIA DAS REGRAS ───────────────────────────┐
-- │ `romaneio_por_serial` já sabe tudo que o banco recusa (078/085):    │
-- │ serial fora da carga, peça em outro romaneio aberto, entrega de     │
-- │ peça que não está no almoxarifado, devolução do que o técnico não   │
-- │ tem. O lote CHAMA essa função uma vez por serial, dentro de um      │
-- │ bloco de exceção próprio. Reescrever a condição aqui seria ter duas │
-- │ regras para divergir no dia em que alguém mexer numa delas.         │
-- └──────────────────────────────────────────────────────────────────────┘
--
-- E o técnico passa a ver o que está NA MÃO dele — `minha_carga()`. Hoje
-- ele só via os romaneios dos últimos sete dias (079), que é recibo, não
-- saldo. A policy de `equipamento` exige `almoxarifado.ver`, e o técnico
-- não tem nem deve ter: ele veria as 15.603 peças da empresa. A função
-- devolve só as linhas `COM_TECNICO` dele, e só as colunas que servem.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 086-A · O lote
-- ---------------------------------------------------------------------------
create or replace function romaneio_por_seriais(p_romaneio uuid, p_seriais text[])
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_r        romaneio%rowtype;
  v_serial   text;
  v_res      jsonb;
  v_linhas   jsonb := '[]'::jsonb;
  v_ok       int := 0;
  v_recusa   int := 0;
  v_vistos   text[] := '{}';
begin
  perform almox_pode_mexer();

  -- O documento é conferido UMA vez, antes do laço: romaneio fechado
  -- recusaria cada serial com a mesma frase, e a tela mostraria dez
  -- recusas iguais para um problema só.
  select * into v_r from romaneio
   where id = p_romaneio and empresa_id = minha_empresa();
  if not found then
    raise exception 'Romaneio nao encontrado.' using errcode = 'P0002';
  end if;
  if v_r.situacao <> 'ABERTO' then
    raise exception 'Romaneio % ja esta %.', v_r.numero, lower(v_r.situacao)
      using errcode = '23514';
  end if;

  -- Teto por chamada. Não é regra de negócio: é o tamanho de um corpo de
  -- requisição que não estoura o tempo. A tela manda em lotes.
  if coalesce(array_length(p_seriais, 1), 0) > 500 then
    raise exception 'No maximo 500 seriais por vez (vieram %).',
      array_length(p_seriais, 1) using errcode = '22023';
  end if;

  foreach v_serial in array coalesce(p_seriais, '{}') loop
    -- Mesma normalização de `romaneio_por_serial`, para o "repetido na
    -- lista" enxergar `abc 123` e `ABC123` como a mesma peça.
    v_serial := upper(regexp_replace(coalesce(v_serial, ''), '\s', '', 'g'));
    continue when v_serial = '';

    if v_serial = any(v_vistos) then
      v_linhas := v_linhas || jsonb_build_object(
        'serial', v_serial, 'ok', false, 'erro', 'Repetido na lista.');
      v_recusa := v_recusa + 1;
      continue;
    end if;
    v_vistos := v_vistos || v_serial;

    -- Cada serial no seu próprio sub-bloco: a recusa de um desfaz só o
    -- dele, e os outros continuam lançados.
    begin
      v_res := romaneio_por_serial(p_romaneio, v_serial);
      v_linhas := v_linhas || jsonb_build_object(
        'serial', v_serial, 'ok', true,
        'tipo', v_res->>'tipo', 'modelo', v_res->>'modelo',
        'alerta', v_res->>'alerta',
        'estado_afline', v_res->>'estado_afline');
      v_ok := v_ok + 1;
    exception when others then
      v_linhas := v_linhas || jsonb_build_object(
        'serial', v_serial, 'ok', false, 'erro', sqlerrm);
      v_recusa := v_recusa + 1;
    end;
  end loop;

  return jsonb_build_object('numero', v_r.numero, 'lancadas', v_ok,
                            'recusadas', v_recusa, 'linhas', v_linhas);
end;
$fn$;

revoke all on function romaneio_por_seriais(uuid, text[]) from public, anon;
grant execute on function romaneio_por_seriais(uuid, text[]) to authenticated;


-- ---------------------------------------------------------------------------
-- 086-B · A carga na mão do técnico
-- ---------------------------------------------------------------------------
-- `dias` é contado no dia LOCAL (hoje_local), não em current_date, que é
-- UTC e vira o dia às 20h em Manaus (traps.md).
--
-- O que NÃO está aqui, de propósito: bloqueio por carga vencida. O
-- concorrente recusa entrega nova a quem tem peça parada há mais de N
-- dias. É regra de negócio, e o Emanuel ainda não decidiu se quer nem
-- qual é o N. A função só MOSTRA os dias; quem decide é ele.
create or replace function minha_carga()
returns table (serial text, tipo text, modelo text, estado text,
               posse_em timestamptz, posse_motivo text, dias int)
language sql stable security definer set search_path to 'public' as $fn$
  with meu as materialized (select meu_tecnico_id() as tecnico)
  select e.serial, e.tipo, e.modelo,
         coalesce(e.estado_afline, e.estado_atlas),
         e.posse_em, e.posse_motivo,
         (hoje_local() - (e.posse_em at time zone 'America/Manaus')::date)::int
    from equipamento e, meu m
   where m.tecnico is not null
     and e.posse = 'COM_TECNICO'
     and e.posse_tecnico_id = m.tecnico
     and e.empresa_id = minha_empresa()
   order by e.posse_em, e.serial;
$fn$;

revoke all on function minha_carga() from public, anon;
grant execute on function minha_carga() to authenticated;

notify pgrst, 'reload schema';
