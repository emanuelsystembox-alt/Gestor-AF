-- ┌─ 166 · o rastro liga sem o "Estou ciente" (D-249) ─────────────────┐
-- │ > "retire a mensagem de a cada 2 minutos o GPS vai colher sua      │
-- │ >  localização (...) não precisa dizer quando o usuário logar,     │
-- │ >  olha, você vai estar enviando sinal, não precisa nada disso"    │
-- │ >  — Emanuel, 31/10                                                │
-- │                                                                    │
-- │ Perguntado, decidiu: o rastro liga para todos, sem a ciência (muda │
-- │ a D-170: "o rastro só começa depois do Estou ciente"); o aviso ao  │
-- │ funcionário passa a ser da AFLINE (contrato/termo). A tela saiu do │
-- │ app. No banco, só a Geo-Rota (130) exigia a ciência v2 para        │
-- │ mostrar o técnico ao colega — sem a tela, ninguém novo apareceria  │
-- │ nunca. A condição sai; o resto (mesma cidade, em rota hoje, visto  │
-- │ há até 30 min, ponto real, nunca a trilha) continua.               │
-- │ `registrar_rastro` nunca exigiu a ciência (a trava era no app).    │
-- │ `ciencia_rastro` fica, como histórico de quem deu ciência; o       │
-- │ Monitoramento continua mostrando a data, vazia para quem é novo.   │
-- └────────────────────────────────────────────────────────────────────┘
do $$
declare d text := pg_get_functiondef('public.colegas_por_perto(double precision,double precision)'::regprocedure);
  velho text := E'\n       and exists (select 1 from ciencia_rastro c\n                    where c.usuario_id = t.usuario_id and c.versao = ''rastro-v2-2026-10-24'')';
begin
  if d not like '%ciencia_rastro%' then return; end if;
  if (length(d) - length(replace(d, velho, ''))) / length(velho) <> 1 then
    raise exception 'colegas_por_perto: a condicao da ciencia nao aparece exatamente uma vez';
  end if;
  execute replace(d, velho, '');
end $$;
