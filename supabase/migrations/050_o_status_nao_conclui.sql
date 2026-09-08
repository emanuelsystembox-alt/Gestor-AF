-- 050 · O status do TOA não conclui contrato
--
-- ┌─ O QUE O EMANUEL PEGOU ──────────────────────────────────────────┐
-- │ "Esse 'encerrou' tira, se o técnico nem encerrou ainda — é para   │
-- │  deixar só quando for finalizado o contrato no TOA."              │
-- │                                                                    │
-- │ "Uma W.O. foi reagendada, código 101, e a outra foi executada. O  │
-- │  sistema acabou baixando uma de forma automática."                │
-- └───────────────────────────────────────────────────────────────────┘
--
-- O contrato 227014948 mostrou as duas pontas do mesmo defeito:
--
--   WO 231344870 · status "concluído" → a tela dizia CONCLUÍDA,
--                  mas as O.S. têm baixa 101 (Endereço Não Localizado),
--                  que é REAGENDAMENTO. O serviço não foi feito.
--   WO 231380148 · status "iniciado"  → a tela dizia EM EXECUÇÃO,
--                  mas as O.S. têm baixa 409 (Instalação Efetuada).
--                  O serviço foi feito.
--
-- É o D-097 outra vez, agora doendo: **o status diz que a atividade
-- encerrou; o código diz o que aconteceu.** O importador traduzia
-- `situacao_do_toa('CONCLUIDO') = 'CONCLUIDA'` e, com isso, concluía
-- contrato que ninguém executou. Medido no banco: **110 contratos com
-- a situação errada, 77 deles marcados como concluídos** sem terem
-- sido — número que ia direto para produtividade e faturamento.
--
-- Daqui em diante o status **nunca conclui**. Ele leva até onde é
-- operação — entrada, deslocamento, execução, cancelada — e a
-- conclusão vem de quem tem competência para dizer:
--
--   · a baixa automática, pelo CÓDIGO (quando ligada); ou
--   · o técnico, na tela de campo.
--
-- É o que o Emanuel pediu ao descrever o modo desligado: "fazer somente
-- a leitura dos códigos e contratos e dá deslocamento e em execução".

-- ============================================================
-- A · Foi finalizado no TOA?
-- ============================================================
-- `fim` vem preenchido mesmo em atividade que só foi iniciada — por
-- isso a tela mostrava "encerrou 12:00" numa visita em execução, em
-- **329 das 947 visitas**. Esta coluna diz quando aquele horário
-- significa encerramento de verdade.
alter table visita add column if not exists finalizado_toa boolean not null default false;

comment on column visita.finalizado_toa is
  'Status da Atividade e Concluido ou Nao Concluido: o tecnico fechou no TOA.';

update visita
   set finalizado_toa = norm_txt(coalesce(dados_origem->>'Status da Atividade',''))
                        in ('CONCLUIDO','NAO CONCLUIDO');

-- ============================================================
-- B · A tradução do status para de concluir
-- ============================================================
create or replace function situacao_do_toa(v text)
returns text language sql immutable set search_path to 'public' as $function$
  select case norm_txt(v)
    -- CONCLUIDO e NAO CONCLUIDO dizem que a ATIVIDADE fechou, nao que o
    -- servico foi executado. Quem diz isso e o codigo de baixa (D-097).
    -- A visita para em EM_EXECUCAO ate a baixa chegar -- automatica,
    -- pelo codigo, ou manual, pelo tecnico.
    when 'CONCLUIDO'     then 'EM_EXECUCAO'
    when 'NAO CONCLUIDO' then 'EM_EXECUCAO'
    when 'INICIADO'      then 'EM_EXECUCAO'
    when 'EM ROTA'       then 'EM_DESLOCAMENTO'
    when 'CANCELADO'     then 'CANCELADA'
    when 'SUSPENSO'      then 'COM_IMPEDIMENTO'
    when 'PENDENTE'      then 'ENTRADA'
    else 'ENTRADA'
  end;
$function$;

-- ============================================================
-- C · O importador grava o "finalizado"
-- ============================================================
do $$
declare src text; novo text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'importar_toa_interno';

  novo := replace(src,
    '      update visita set tec1 = tec1_da_visita(v_id) where id = v_id;',
    '      update visita set tec1 = tec1_da_visita(v_id),' || chr(10) ||
    '             finalizado_toa = norm_txt(coalesce(j_txt(d, ''Status da Atividade''),''''))' || chr(10) ||
    '                              in (''CONCLUIDO'',''NAO CONCLUIDO'')' || chr(10) ||
    '       where id = v_id;');
  if novo = src then
    raise exception 'Nao achei a linha do tec1 no importador.';
  end if;
  execute novo;
end $$;

revoke all on function importar_toa_interno(uuid, boolean) from public, anon;

-- ============================================================
-- D · A baixa automática foi LIGADA
-- ============================================================
-- Decisão do Emanuel em 08/09, perguntado com os números na mão: com o
-- status já não concluindo, sem a automática todo contrato ficaria em
-- execução esperando baixa manual.
--
-- Ele decidiu, na mesma conversa, **não corrigir os 110 contratos já
-- importados**: valem daqui para a frente. Quem quiser acertar um dia
-- antigo reimporta aquele arquivo.
update parametro
   set valor = 'true'::jsonb, atualizado_em = now()
 where chave = 'baixa_automatica';

notify pgrst, 'reload schema';
