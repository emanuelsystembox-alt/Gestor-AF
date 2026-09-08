-- 047 · TEC1 — aderência à janela
--
-- ┌─ O QUE O EMANUEL PEDIU ──────────────────────────────────────────┐
-- │ "Analise o HTML e busque a regra do TEC1: quando o contrato for   │
-- │  finalizado no TOA, deve subir um sinalizador — TEC1 PADRÃO,      │
-- │  TEC1 SEM PADRÃO. Precisa subir na situação e aparecer como       │
-- │  coluna no relatório."                                             │
-- └───────────────────────────────────────────────────────────────────┘
--
-- A regra foi **lida** do `painel_produtividade.html` que ele já usa
-- (função `classifyTEC1Row`), não inventada aqui. Transcrita:
--
--   MANUTENÇÃO  = Tipo de Serviço casa
--                 /(VISITA TECNICA|RETORNO(?!\s+DE\s+CREDENCIADA))/
--                 → carência de 59 min
--   INSTALAÇÃO  = todo o resto, inclusive RETORNO DE CREDENCIADA
--                 → carência de 119 min
--
--   Só entram atividades com Status da Atividade **Concluído** ou
--   **Não Concluído**. Cancelado, Suspenso, Iniciado e Pendente ficam
--   de fora — que é exatamente o "quando for finalizado no TOA".
--
--   Expurgos (contam à parte, não como falha):
--     · "Não Concluído" + motivo "Cancelado no Sistema NETSMS"
--     · janela "Imediata"
--
--   1) encerrou até o fim da janela ....... PADRÃO (qualquer status)
--   2) passou da janela e EXECUTADO ....... PADRÃO se dentro da carência
--   3) passou da janela e NÃO executado:
--        manutenção .......................  a regra não se aplica
--        instalação ....................... SEM PADRÃO
--
--   EXECUTADO = alguma O.S. com status EXECUTADA. Sem status de O.S.,
--   cai para a situação (CONCLUIDA = executado) — mesmo fallback do
--   painel, e pela mesma razão: a situação pode estar "em execução"
--   mesmo já tendo sido baixada.
--
-- Meta do painel: ≥ 95%. Nos 935 contratos do banco hoje: 363 PADRÃO,
-- 14 SEM PADRÃO, 24 expurgadas, 534 sem regra aplicável — 96,3%.
--
-- ⚠ Isto NÃO substitui a coluna "Aderência à janela" do relatório, que
--   mede outra coisa: se o técnico CHEGOU dentro da janela. O TEC1 olha
--   o FIM, com carência. As duas convivem.

alter table visita add column if not exists tec1 text
  check (tec1 in ('PADRAO','SEM_PADRAO','EXPURGADA'));

comment on column visita.tec1 is
  'Aderencia a janela (047). PADRAO / SEM_PADRAO / EXPURGADA / nulo quando nao se aplica.';

-- ⚠ Duas armadilhas que esta função já pagou:
--   1. `unaccent_simples` não existe neste banco — quem normaliza é
--      `norm_txt` (upper + sem acento + espaço colapsado).
--   2. a variável record não pode se chamar `v` se a tabela tem alias
--      `v`: o plpgsql resolve `v.id` como a variável ainda não
--      atribuída e estoura "record v is not assigned yet".
create or replace function tec1_da_visita(p_visita uuid)
returns text language plpgsql stable set search_path to 'public' as $fn$
declare
  r record; v_status text; v_motivo text; v_janela text;
  v_manut boolean; v_carencia int; v_fim_min int; v_jan_min int;
  v_executado boolean; v_tem_os_status boolean;
begin
  select vi.id, vi.situacao, vi.janela_fim, vi.fim, vi.dados_origem,
         ts.nome as tipo_servico
    into r
    from visita vi
    left join tipo_servico ts on ts.id = vi.tipo_servico_id
   where vi.id = p_visita;
  if r.id is null then return null; end if;

  v_status := norm_txt(coalesce(r.dados_origem->>'Status da Atividade',''));
  if v_status not in ('CONCLUIDO','NAO CONCLUIDO') then return null; end if;

  v_motivo := norm_txt(coalesce(r.dados_origem->>'Motivo de Fechamento Externo',''));
  if v_status = 'NAO CONCLUIDO' and v_motivo = 'CANCELADO NO SISTEMA NETSMS' then
    return 'EXPURGADA';
  end if;

  v_janela := norm_txt(coalesce(r.dados_origem->>'Intervalo de Tempo',''));
  if v_janela = 'IMEDIATA' then return 'EXPURGADA'; end if;

  if r.janela_fim is null then return null; end if;

  v_manut := norm_txt(coalesce(r.tipo_servico,'')) ~
             '(VISITA ?TECNICA|RETORNO(?! DE CREDENCIADA))';
  v_carencia := case when v_manut then 59 else 119 end;

  select bool_or(o.status_operadora = 'EXECUTADA'),
         bool_or(o.status_operadora is not null)
    into v_executado, v_tem_os_status
    from ordem_servico o where o.visita_id = p_visita;
  if not coalesce(v_tem_os_status, false) then
    v_executado := (r.situacao = 'CONCLUIDA');
  end if;

  v_jan_min := extract(hour from r.janela_fim) * 60 + extract(minute from r.janela_fim);
  -- `fim` é timestamptz: em Manaus (UTC−4) comparar sem converter joga
  -- o encerramento 4 horas para frente e reprova quem cumpriu (D-084).
  v_fim_min := case when r.fim is null then null
    else extract(hour from (r.fim at time zone 'America/Manaus')) * 60
       + extract(minute from (r.fim at time zone 'America/Manaus')) end;

  if v_fim_min is not null and v_fim_min <= v_jan_min then return 'PADRAO'; end if;

  if coalesce(v_executado, false) then
    return case when v_fim_min is not null and v_fim_min <= v_jan_min + v_carencia
                then 'PADRAO' else 'SEM_PADRAO' end;
  end if;

  if v_manut then return null; end if;
  return 'SEM_PADRAO';
end;
$fn$;

revoke all on function tec1_da_visita(uuid) from public, anon;
grant execute on function tec1_da_visita(uuid) to authenticated;

create or replace function recalcular_tec1(p_de date default null, p_ate date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare n int;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  update visita v set tec1 = tec1_da_visita(v.id)
   where v.excluido_em is null
     and v.base_id in (select bases_visiveis())
     and (p_de is null or v.data_agendada >= p_de)
     and (p_ate is null or v.data_agendada <= p_ate);
  get diagnostics n = row_count;
  return jsonb_build_object('visitas', n);
end;
$fn$;

revoke all on function recalcular_tec1(date, date) from public, anon;
grant execute on function recalcular_tec1(date, date) to authenticated;

update visita v set tec1 = tec1_da_visita(v.id) where v.excluido_em is null;

-- O TEC1 é recalculado a cada importação, SEMPRE — não só quando a
-- baixa automática está ligada. Ele é medição, não decisão: não muda o
-- contrato, só diz se a janela foi respeitada.
do $$
declare src text; novo text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'importar_toa_interno';

  novo := replace(src,
    '        n_os := n_os + 1;' || chr(10) || '      end loop;',
    '        n_os := n_os + 1;' || chr(10) ||
    '      end loop;' || chr(10) || chr(10) ||
    '      update visita set tec1 = tec1_da_visita(v_id) where id = v_id;');
  if novo = src then
    raise exception 'Nao achei o fim do loop de O.S. no importador.';
  end if;
  execute novo;
end $$;

revoke all on function importar_toa_interno(uuid, boolean) from public, anon;

notify pgrst, 'reload schema';
