-- ┌─ 128 · importação: baixa automática no que o campo não baixou, e sem ┐
-- │       o vai-e-volta de situação                                      │
-- │                                                                      │
-- │ > "227087686 — esse contrato já foi encerrado e ainda está em        │
-- │ >  execução no app do técnico e site (...) acho que é devido a regra │
-- │ >  de tocada pelo campo" — Emanuel, 24/10                            │
-- │                                                                      │
-- │ DEFEITO 1 (o 227087686). O contrato foi tocado pelo campo (suporte,  │
-- │ 12:45) e a importação fazia duas coisas incoerentes com ele:         │
-- │  · o STATUS espelhava o TOA ("concluído" → EM_EXECUCAO, 095);        │
-- │  · a BAIXA AUTOMÁTICA era pulada (`not v_bloqueada`).                │
-- │ O TOA fechou com 409 nas duas O.S., ninguém deu baixa da AFLINE, e o │
-- │ contrato ficava em execução para sempre — e o técnico com 2 ativos.  │
-- │ Esse ramo também não atualizava início/fim nem a linha do TOA (o     │
-- │ banco dizia "pendente" e 15:00; o arquivo, concluído 12:34–12:48).   │
-- │ DECISÃO (Emanuel, 24/10): a baixa automática vale para o contrato    │
-- │ que o campo NÃO BAIXOU. Se alguma O.S. tem baixa da AFLINE, o        │
-- │ contrato continua protegido (D-006).                                 │
-- │                                                                      │
-- │ DEFEITO 2 (223471716 e todo concluído sem toque do campo). Cada      │
-- │ importação gravava "concluído" → EM_EXECUCAO e, no mesmo instante, a │
-- │ baixa automática voltava para CONCLUIDA: 2 eventos e 2 AVISOS ao     │
-- │ técnico a cada sincronização (11:56, 12:56, 13:03, 13:06 no dia 24). │
-- │ Agora, se as O.S. JÁ têm código, a situação é a do código desde a    │
-- │ primeira escrita. Código novo no arquivo continua sendo aplicado     │
-- │ pela baixa automática no fim, com evento, como antes.                │
-- │                                                                      │
-- │ Aplicado como REPLACE sobre a função viva (19 KB), com cada âncora   │
-- │ conferida para aparecer exatamente 1 vez — traps.md: o arquivo de    │
-- │ migration pode estar atrasado em relação à função do banco.          │
-- └──────────────────────────────────────────────────────────────────────┘
do $$
declare d text; d2 text; n int;
  a1 text := $x$  v_baixa_auto boolean := false; v_sit_baixa text; v_sit_agora text;
$x$;
  b1 text := $x$  v_baixa_auto boolean := false; v_sit_baixa text; v_sit_agora text;
  v_auto_aqui boolean;  -- 128: a baixa automática vale para ESTE contrato?
$x$;
  a2 text := $x$      v_nova := situacao_do_toa(j_txt(d, 'Status da Atividade'));
$x$;
  b2 text := $x$      v_nova := situacao_do_toa(j_txt(d, 'Status da Atividade'));

      -- 128: a baixa automática vale para o contrato que o campo NÃO BAIXOU
      -- (Emanuel, 24/10). Tocado pelo campo só protege quem deu baixa da
      -- AFLINE em alguma O.S. (D-006).
      v_auto_aqui := v_baixa_auto and (not coalesce(v_bloqueada, false)
        or not exists (select 1 from ordem_servico o
                        where o.visita_id = v_id and o.codigo_baixa_afline_id is not null));
      -- 128: sem o vai-e-volta. Com TODAS as O.S. já com código, a baixa
      -- automática no fim SEMPRE leva à situação do código, qualquer que
      -- seja o status do TOA ("concluído", ou "iniciado" de quem reabriu a
      -- atividade — traps.md). Então grava essa situação desde a primeira
      -- escrita: mesmo resultado, sem 2 eventos e 2 avisos por importação.
      if v_id is not null and v_auto_aqui then
        v_nova := coalesce(situacao_da_baixa(v_id), v_nova);
      end if;
$x$;
  a3 text := $x$            situacao_em    = case when v_nova is distinct from v_atual
                                  then now() else situacao_em end
          where id = v_id;
$x$;
  b3 text := $x$            situacao_em    = case when v_nova is distinct from v_atual
                                  then now() else situacao_em end,
            -- 128: a hora e a linha do TOA também no contrato tocado pelo
            -- campo — são do TOA, não trabalho do campo (D-006 protege a baixa).
            inicio = coalesce(j_ts_no_dia(d, v_dia, 'Início'), inicio),
            fim    = coalesce(j_ts_no_dia(d, v_dia, 'Fim'), fim),
            tempo_deslocamento = coalesce(j_interv(d,'Tempo de Deslocamento'), tempo_deslocamento),
            dados_origem = d
          where id = v_id;
$x$;
  a4 text := $x$      if v_baixa_auto and not coalesce(v_bloqueada, false) then
$x$;
  b4 text := $x$      if v_auto_aqui then  -- 128 (antes: not v_bloqueada)
$x$;
begin
  d := pg_get_functiondef('importar_toa_interno'::regproc);
  if position('v_auto_aqui' in d) > 0 then return; end if;  -- já aplicado
  foreach d2 in array array[a1, a2, a3, a4] loop
    n := (length(d) - length(replace(d, d2, ''))) / length(d2);
    if n <> 1 then raise exception 'ancora aparece % vezes: %', n, left(d2, 60); end if;
  end loop;
  d2 := replace(replace(replace(replace(d, a1, b1), a2, b2), a3, b3), a4, b4);
  execute d2;
end $$;
