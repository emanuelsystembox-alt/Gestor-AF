-- 263 · A fila "O que fazer agora" — fase 3 do pacote preditivo (D-378)
--
-- > "o gestor não procura o problema, o problema chega na ordem certa" — a proposta de 12/11,
-- > aprovada pelo Emanuel ("as 4 fases, na ordem").
--
-- Uma lista só, na ordem que ELE escolheu (13/11), o mais urgente primeiro dentro de cada grupo:
--   1 PESSOA   suporte técnico, GPS anormal, sumiu do TOA, dois em andamento  (do sino, na tela)
--   2 TEC1     contrato que ainda dá para SALVAR no TEC1, e o de folga curta  (aqui)
--   3 ATRASO   equipe de VT abaixo da régua agora (09:10 … 17:20, D-372)      (aqui)
--   4 REDE     node em degradação (D-376)                                       (do sino, na tela)
--   5 REVISITA serviço concluído hoje com risco ALTO de voltar (D-375)          (aqui)
--   6 RESTO    o que não cabe até o fim da jornada (aqui) e o sincronismo (do sino)
--
-- NENHUMA REGRA NOVA: cada item sai da função que já decide aquilo —
--   `previsao_do_dia` (260), `dashboard_visita_tecnica` (o bloco `atraso`, 257/258),
--   `risco_revisita_do_dia` (261). Os grupos 1, 4 e o sincronismo já chegam à tela pelo sino
--   (`sinais_do_dia`, com vigência e dispensa próprias): a tela junta, não recalcula.
--
-- INVOKER de propósito: `dashboard_visita_tecnica` é INVOKER e confia no RLS para a equipe que a
-- pessoa enxerga — chamada de dentro de uma DEFINER, rodaria como o dono e veria tudo.
--
-- TRATADO (escolha dele): o item some sozinho quando a situação resolve, e cada um pode
-- DISPENSAR um item para si (`fila_dispensa`, como no sino). A chave carrega o estado — o
-- contrato que estava "em risco" e passou a "vai estourar", a equipe que ficou abaixo de um
-- marco NOVO, o técnico com mais contratos fora do dia —, então o que piora volta.

create table if not exists public.fila_dispensa (
  usuario_id uuid not null default auth.uid(),
  empresa_id uuid not null,
  dia        date not null,
  chave      text not null,
  criado_em  timestamptz not null default now(),
  primary key (usuario_id, dia, chave)
);
alter table public.fila_dispensa enable row level security;
revoke all on public.fila_dispensa from public, anon, authenticated;
grant select on public.fila_dispensa to authenticated;
drop policy if exists fila_dispensa_minha on public.fila_dispensa;
create policy fila_dispensa_minha on public.fila_dispensa for select to authenticated
  using (usuario_id = (select auth.uid()));

-- Quem dispensa é quem está logado: o servidor carimba (D-061).
create or replace function public.dispensar_item_da_fila(p_chave text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not eh_gestao() then
    raise exception 'A fila é da gestão.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_chave), '') = '' or length(p_chave) > 200 then
    raise exception 'Item inválido.' using errcode = '22023';
  end if;
  insert into fila_dispensa (usuario_id, empresa_id, dia, chave)
  values (auth.uid(), minha_empresa(), hoje_local(), p_chave)
  on conflict do nothing;
end $$;
revoke all on function public.dispensar_item_da_fila(text) from public, anon;
grant execute on function public.dispensar_item_da_fila(text) to authenticated;

create or replace function public.o_que_fazer_agora()
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_hoje date := hoje_local();
  p   jsonb;
  vt  jsonb;
  rv  jsonb;
  v_disp text[];
  v_itens jsonb := '[]'::jsonb;
begin
  if not eh_gestao() then
    raise exception 'A fila é da gestão.' using errcode = '42501';
  end if;

  select coalesce(array_agg(chave), '{}') into v_disp
    from fila_dispensa where usuario_id = auth.uid() and dia = v_hoje;

  p  := previsao_do_dia();
  vt := dashboard_visita_tecnica(p_dia => v_hoje, p_ate => v_hoje);
  -- o risco de revisita calcula a régua do dia se o relógio ainda não calculou
  rv := risco_revisita_do_dia();

  -- 2 · TEC1: o que ainda dá para salvar (fora do prazo previsto) e o de folga curta.
  --     O perdido e o que começou tarde não têm o que fazer: ficam na Previsão do dia.
  v_itens := v_itens || coalesce((
    select jsonb_agg(jsonb_build_object(
      'grupo', 2, 'tipo', case when d ->> 'prev' = 'SEM_PADRAO' then 'TEC1_SALVAR' else 'TEC1_RISCO' end,
      'chave', 'TEC1:' || (d ->> 'visita_id') || ':' || coalesce(d ->> 'nivel', d ->> 'prev'),
      'titulo', case when d ->> 'prev' = 'SEM_PADRAO' then 'Salvar o TEC1' else 'TEC1 com folga curta' end
                || ': contrato ' || coalesce(d ->> 'contrato', 'sem número'),
      'detalhe', concat_ws(' · ',
                   'janela ' || (d ->> 'janela'),
                   'previsto acabar ' || to_char((d ->> 'previsto_fim')::timestamptz at time zone 'America/Manaus', 'HH24:MI'),
                   'folga ' || (d ->> 'folga_min') || ' min',
                   case when (d ->> 'na_frente')::int > 0 then (d ->> 'na_frente') || ' na frente' end,
                   (d ->> 'n_os') || ' O.S.'),
      'prazo', d ->> 'prazo_chegada',
      'visita_id', d ->> 'visita_id',
      'equipe', d ->> 'equipe', 'tecnico', d ->> 'tecnico')
      order by (d ->> 'prev' = 'SEM_PADRAO') desc, (d ->> 'prazo_chegada'))
      from jsonb_array_elements(p -> 'decidem') d
     where (d ->> 'salvavel')::boolean
       and ('TEC1:' || (d ->> 'visita_id') || ':' || coalesce(d ->> 'nivel', d ->> 'prev')) <> all (v_disp)), '[]');

  -- 3 · ATRASO: equipe de VT abaixo do marco de agora (a régua da D-372)
  v_itens := v_itens || coalesce((
    select jsonb_agg(jsonb_build_object(
      'grupo', 3, 'tipo', 'ATRASO_VT',
      'chave', 'ATRASO:' || (a ->> 'equipe_id') || ':' || (a ->> 'deve_agora'),
      'titulo', 'Equipe ' || coalesce(a ->> 'codigo', '?') || ' atrasada na régua da VT',
      'detalhe', concat_ws(' · ',
                   'baixou ' || (a ->> 'baixados') || ', devia ' || (a ->> 'deve_agora'),
                   (a ->> 'agenda') || ' VT na agenda',
                   'atrasou desde ' || (a ->> 'primeiro')),
      'falta', (a ->> 'deve_agora')::int - (a ->> 'baixados')::int,
      'link', '/controle/dashboard-vt',
      'equipe', a ->> 'codigo', 'tecnico', a ->> 'tecnico')
      order by ((a ->> 'deve_agora')::int - (a ->> 'baixados')::int) desc, a ->> 'codigo')
      from jsonb_array_elements(vt -> 'atraso' -> 'lista') a
     where (a ->> 'atrasada_agora')::boolean
       and ('ATRASO:' || (a ->> 'equipe_id') || ':' || (a ->> 'deve_agora')) <> all (v_disp)), '[]');

  -- 5 · REVISITA: concluído hoje com risco ALTO, que ainda não voltou
  v_itens := v_itens || coalesce((
    select jsonb_agg(jsonb_build_object(
      'grupo', 5, 'tipo', 'REVISITA_ALTO',
      'chave', 'REV:' || (s ->> 'visita_id'),
      'titulo', 'Risco alto de revisita: contrato ' || coalesce(s ->> 'contrato', 'sem número'),
      'detalhe', concat_ws(' · ', s ->> 'grupo',
                   (select string_agg(coalesce(m ->> 'detalhe', m ->> 'familia' || ' ' || (m ->> 'valor')), ', ')
                      from (select m from jsonb_array_elements(s -> 'motivos') m limit 3) x),
                   case when s ->> 'sinal' = 'REGULAR' then 'sinal validado' end),
      'fator', (s ->> 'fator')::numeric,
      'visita_id', s ->> 'visita_id',
      'equipe', s ->> 'equipe', 'tecnico', s ->> 'tecnico')
      order by (s ->> 'fator')::numeric desc nulls last)
      from jsonb_array_elements(rv -> 'servicos') s
     where s ->> 'faixa' = 'ALTO' and jsonb_typeof(s -> 'voltou') is distinct from 'object'
       and ('REV:' || (s ->> 'visita_id')) <> all (v_disp)), '[]');

  -- 6 · NÃO CABE: técnico (sem técnico, equipe) com contrato previsto para depois da jornada
  v_itens := v_itens || coalesce((
    select jsonb_agg(jsonb_build_object(
      'grupo', 6, 'tipo', 'NAO_CABE',
      'chave', 'NAOCABE:' || (f ->> 'fila') || ':' || (f ->> 'depois'),
      'titulo', coalesce(f ->> 'tecnico', 'Equipe ' || coalesce(f ->> 'equipe', '?'))
                || ': ' || (f ->> 'depois') || ' contrato(s) não cabem até ' || (p ->> 'fim_jornada'),
      'detalhe', concat_ws(' · ', case when f ->> 'tecnico' is not null then 'equipe ' || (f ->> 'equipe') end,
                   'a fila acaba ' || to_char((f ->> 'fim_previsto')::timestamptz at time zone 'America/Manaus', 'HH24:MI'),
                   (f ->> 'abertos') || ' em aberto'),
      'fim_previsto', f ->> 'fim_previsto',
      'link', '/controle/previsao',
      'equipe', f ->> 'equipe', 'tecnico', f ->> 'tecnico')
      order by (f ->> 'fim_previsto') desc)
      from jsonb_array_elements(p -> 'filas') f
     where (f ->> 'depois')::int > 0
       and ('NAOCABE:' || (f ->> 'fila') || ':' || (f ->> 'depois')) <> all (v_disp)), '[]');

  return jsonb_build_object(
    'agora', now(), 'dia', v_hoje, 'cidade', p -> 'cidade',
    'tec1', p -> 'tec1', 'meta', p -> 'meta',
    'itens', v_itens);
end $$;
revoke all on function public.o_que_fazer_agora() from public, anon;
grant execute on function public.o_que_fazer_agora() to authenticated;

notify pgrst, 'reload schema';
