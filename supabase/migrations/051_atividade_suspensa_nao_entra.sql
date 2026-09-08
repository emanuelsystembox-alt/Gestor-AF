-- 051 · Atividade suspensa não entra
--
-- ┌─ O QUE O EMANUEL PEGOU ──────────────────────────────────────────┐
-- │ "225853870 foi baixado e tem código de baixa, porém o sistema     │
-- │  colocou como impedimento. Acho que ele pode ter lido a atividade │
-- │  suspensa — não vamos ler ela, pois é uma ação que foi suspensa,  │
-- │  ou seja não aconteceu."                                           │
-- └───────────────────────────────────────────────────────────────────┘
--
-- Ele acertou o diagnóstico antes de eu abrir o arquivo. A WO
-- 00121|231317484 tem DUAS atividades no TOA, do mesmo técnico, no
-- mesmo dia:
--
--   199375883 · suspenso   · 08:29–09:40 · sem baixa, sem status de O.S.
--   199020500 · concluído  · 10:28–10:56 · baixa 409 nas duas O.S.
--
-- A suspensa entrava como visita e virava COM IMPEDIMENTO — um
-- contrato "parado" que na verdade foi executado às 10:56.
--
-- Atividade suspensa é tentativa abortada: não tem baixa, não tem O.S.
-- executada, não gera pontuação e não é trabalho feito. Ela deixa de
-- ser lida, como a linha sem "ID da Atividade" já era ignorada (D-004).
--
-- ⚠ Efeito colateral medido ANTES de aplicar: das 3 suspensas no banco,
--   **2 estão sozinhas na WO** — para essas, ignorar significa o
--   contrato não aparecer em lugar nenhum. Por isso a importação passa
--   a CONTAR as suspensas e mostrar o número no resumo: some da tela,
--   não do relatório da importação.
do $$
declare src text; novo text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'importar_toa_interno';

  -- contador
  novo := replace(src,
    '  n_erro int := 0; n_conflito int := 0; n_os int := 0;',
    '  n_erro int := 0; n_conflito int := 0; n_os int := 0; n_susp int := 0;');
  if novo = src then raise exception 'Nao achei os contadores.'; end if;
  src := novo;

  -- a recusa, logo depois da checagem de ID da Atividade
  novo := replace(src,
    '      v_login := j_txt(d, ''Login do Técnico'');',
    '      -- Suspensa e tentativa abortada: sem baixa, sem O.S.' || chr(10) ||
    '      -- executada, sem trabalho feito. Nao entra (051).' || chr(10) ||
    '      if norm_txt(coalesce(j_txt(d, ''Status da Atividade''),'''')) = ''SUSPENSO'' then' || chr(10) ||
    '        n_susp := n_susp + 1;' || chr(10) ||
    '        update importacao_linha set resultado = ''IGNORADA'',' || chr(10) ||
    '          mensagem = ''Atividade suspensa -- nao aconteceu'' where id = r.id;' || chr(10) ||
    '        continue;' || chr(10) ||
    '      end if;' || chr(10) || chr(10) ||
    '      v_login := j_txt(d, ''Login do Técnico'');');
  if novo = src then raise exception 'Nao achei a leitura do login.'; end if;
  src := novo;

  -- e aparece no resumo
  novo := replace(src,
    '    ''conflitos'', n_conflito, ''ordens_servico'', n_os,',
    '    ''conflitos'', n_conflito, ''ordens_servico'', n_os,' || chr(10) ||
    '    ''suspensas'', n_susp,');
  if novo = src then raise exception 'Nao achei o resumo.'; end if;

  execute novo;
end $$;

revoke all on function importar_toa_interno(uuid, boolean) from public, anon;

notify pgrst, 'reload schema';
