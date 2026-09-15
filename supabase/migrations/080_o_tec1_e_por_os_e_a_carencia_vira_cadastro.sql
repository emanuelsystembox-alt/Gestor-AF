-- ============================================================
-- 080 · O TEC1 é por O.S., e a carência vira cadastro
--
-- > "Esses serviços precisam ser iniciados antes do fim da janela, ou
-- >  antes de iniciar a janela e baixado até 1h:59 minutos depois do fim
-- >  da janela para ser padrão [...] se for não executado, depois do fim
-- >  da janela, o caso é considerado como sem padrão [...] agora se ele
-- >  baixar não executado dentro da janela de atendimento ou antes? aí
-- >  sim é dentro do padrão na certa."   — Emanuel, 15/09
--
-- ┌─ isto REVOGA a regra herdada do concorrente ─────────────────────┐
-- │ A D-099 transcreveu o TEC1 do `painel_produtividade.html` que o   │
-- │ Emanuel usava — `classifyTEC1Row`. Agora ele DEFINIU a regra da   │
-- │ AFLINE, e ela difere em três pontos. Está escrito aqui para       │
-- │ ninguém "consertar" de volta daqui a seis meses:                  │
-- │                                                                   │
-- │ 1. RETORNO DE CREDENCIADA sai de 119 e vai para 59 min. O painel  │
-- │    antigo tinha uma exceção escrita de propósito —                │
-- │    `RETORNO(?! DE CREDENCIADA)` — para jogá-lo no balde de        │
-- │    instalação. Perguntei, e ele confirmou a inversão.             │
-- │ 2. DESCONEXAO ganha 59 min. Antes caía em "todo o resto" = 119.   │
-- │ 3. O INÍCIO passa a contar. A regra antiga olhava só o fim; a     │
-- │    nova exige ter começado até o fim da janela.                   │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ a carência sai do código e vira CADASTRO ───────────────────────┐
-- │ Estava num regex dentro da função:                                │
-- │     '(VISITA ?TECNICA|RETORNO(?! DE CREDENCIADA))' → 59, resto 119 │
-- │                                                                   │
-- │ Regex escondido numa função é onde regra de negócio vai para      │
-- │ morrer: para mudar 59 → 45 alguém precisa de migration, e por     │
-- │ isso ninguém muda. A carência agora é coluna de `tipo_servico`,   │
-- │ ao lado do grupo que ela governa.                                 │
-- │                                                                   │
-- │ A TELA para editá-la ainda NÃO existe — hoje só muda por SQL. E   │
-- │ quem mudar precisa rodar `recalcular_tec1()` depois: a coluna      │
-- │ `ordem_servico.tec1` é cache, e cache de regra que muda fica       │
-- │ errado calado. (A 082 tirou o PAINEL dessa dependência; o          │
-- │ relatório e o filtro ainda leem a coluna.)                         │
-- │                                                                   │
-- │ Grupo SEM carência cadastrada assume 59 — o mais rígido. Escolha  │
-- │ do Emanuel: "trata como 00:59 (o mais rígido)". Nunca afrouxa a   │
-- │ cobrança por falta de cadastro.                                   │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ por O.S., não por visita ───────────────────────────────────────┐
-- │ > "status executado e não executado, ela que mostrará o TEC1, ele │
-- │ >  também é por o.s a estouro"                                    │
-- │                                                                   │
-- │ Uma visita tem de 1 a 10 O.S., e é a O.S. que a CLARO fatura. O   │
-- │ `Status da O.S.` é por O.S. — a planilha traz `Status da O.S 1`   │
-- │ a `Status da O.S 10`. Então o TEC1 nasce na O.S.                  │
-- │                                                                   │
-- │ A visita continua tendo um rótulo, porque a lista e a rota        │
-- │ mostram contrato, não O.S. Ele é o CONSOLIDADO, e é severo: uma   │
-- │ O.S. fora do padrão põe o contrato fora do padrão. Mesma lógica   │
-- │ da 035 ("situação terminal exige TODAS as O.S."), e pela mesma    │
-- │ razão — dizer que o contrato está no padrão com uma O.S. estourada│
-- │ esconde exatamente o que a CLARO vai cobrar.                      │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ qual hora conta ────────────────────────────────────────────────┐
-- │ Perguntei, porque são duas baixas e elas divergem (D-042). Ele    │
-- │ escolheu: **só a do TOA** (`visita.fim`). O TEC1 passa a ser a    │
-- │ medida do que a CLARO enxerga — que é quem cobra. Contrato        │
-- │ baixado só aqui dentro fica SEM TEC1, e isso é consequência       │
-- │ declarada, não esquecimento.                                      │
-- │                                                                   │
-- │ `inicio` e `fim` são da VISITA: o TOA não manda hora por O.S.     │
-- │ Então as O.S. de um mesmo contrato compartilham as duas pontas e  │
-- │ só se separam pelo `Status da O.S.` — que é justamente o que o    │
-- │ Emanuel disse que decide.                                         │
-- └───────────────────────────────────────────────────────────────────┘
--
-- Comparação por TIMESTAMP, não por minuto-do-dia. A função antiga fazia
-- `extract(hour)*60 + extract(minute)` nos dois lados: janela que fecha
-- 22:00 mais 119 min dá 24:59, que não existe nesse esquema, e o
-- encerramento depois da meia-noite voltava para o começo do dia. Somar
-- `data_agendada + janela_fim` resolve, e ainda fica mais curto de ler.
--
-- O que NÃO muda: só entram atividades com Status da Atividade
-- `Concluído` ou `Não Concluído`; expurgo de "Cancelado no Sistema
-- NETSMS" e de janela "Imediata"; sem `janela_fim` não há regra.
-- ============================================================

-- ------------------------------------------------------------------
-- A. A carência, ao lado do grupo que ela governa
-- ------------------------------------------------------------------
alter table tipo_servico
  add column if not exists tec1_carencia_min integer;

comment on column tipo_servico.tec1_carencia_min is
  'Minutos de tolerância DEPOIS do fim da janela para a O.S. executada '
  'ainda contar como TEC1 PADRÃO. Nulo assume 59 — o mais rígido, para '
  'falta de cadastro nunca afrouxar a cobrança. Ver D-150.';

-- Os valores que o Emanuel ditou em 15/09.
update tipo_servico set tec1_carencia_min = 119
 where norm_txt(nome) in ('ADESAO', 'SERVICO', 'REINSTALACAO',
                          'MUDANCA DE ENDERECO', 'MIGRACAO GPON');

update tipo_servico set tec1_carencia_min = 59
 where norm_txt(nome) in ('VISITA TECNICA', 'RETORNO DE CREDENCIADA',
                          'DESCONEXAO');


-- ------------------------------------------------------------------
-- B. O TEC1 nasce na O.S.
-- ------------------------------------------------------------------
alter table ordem_servico
  add column if not exists tec1 text
  check (tec1 in ('PADRAO', 'SEM_PADRAO', 'EXPURGADA'));

comment on column ordem_servico.tec1 is
  'Aderência TEC1 desta O.S. (D-150). `visita.tec1` é o consolidado: uma '
  'O.S. fora do padrão põe o contrato fora do padrão.';


-- ------------------------------------------------------------------
-- C. A regra, por O.S.
-- ------------------------------------------------------------------
create or replace function public.tec1_da_os(p_os uuid)
returns text
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  r record;
  v_status text; v_motivo text; v_janela text;
  v_carencia int;
  v_fim_janela timestamptz;
  v_executado boolean;
begin
  select o.id, o.status_operadora,
         v.situacao, v.data_agendada, v.janela_fim, v.inicio, v.fim,
         v.dados_origem,
         ts.tec1_carencia_min
    into r
    from ordem_servico o
    join visita v on v.id = o.visita_id
    left join tipo_servico ts on ts.id = v.tipo_servico_id
   where o.id = p_os;
  if r.id is null then return null; end if;

  -- ESCOPO: só o que o TOA deu por encerrado. "Iniciado" e "Pendente"
  -- ainda podem virar padrão; classificá-los agora seria julgar o que
  -- não terminou.
  v_status := norm_txt(coalesce(r.dados_origem->>'Status da Atividade', ''));
  if v_status not in ('CONCLUIDO', 'NAO CONCLUIDO') then return null; end if;

  -- EXPURGOS (contam à parte, não como falha) -- herdados e mantidos.
  v_motivo := norm_txt(coalesce(r.dados_origem->>'Motivo de Fechamento Externo', ''));
  if v_status = 'NAO CONCLUIDO' and v_motivo = 'CANCELADO NO SISTEMA NETSMS' then
    return 'EXPURGADA';
  end if;
  v_janela := norm_txt(coalesce(r.dados_origem->>'Intervalo de Tempo', ''));
  if v_janela = 'IMEDIATA' then return 'EXPURGADA'; end if;

  -- Sem janela não há contra o que medir. Nulo, não "padrão": zero e
  -- desconhecido não são a mesma coisa (D-117).
  if r.janela_fim is null or r.fim is null then return null; end if;

  v_fim_janela := (r.data_agendada + r.janela_fim) at time zone 'America/Manaus';

  -- Executado é o STATUS DA O.S. -- decisão do Emanuel, e é por isso que
  -- o TEC1 mora aqui e não na visita. Sem status de O.S., cai para a
  -- situação do contrato, como a regra antiga já fazia.
  v_executado := case
    when r.status_operadora is not null then r.status_operadora = 'EXECUTADA'
    else r.situacao = 'CONCLUIDA'
  end;

  -- ---------- NÃO EXECUTADO ----------
  -- Sem carência, e de propósito: quem não fez o serviço devia ao menos
  -- ter avisado dentro da janela. "Se ele baixar não executado dentro da
  -- janela de atendimento ou antes? aí sim é dentro do padrão na certa."
  if not v_executado then
    return case when r.fim <= v_fim_janela then 'PADRAO' else 'SEM_PADRAO' end;
  end if;

  -- ---------- EXECUTADO ----------
  -- Duas condições, as duas obrigatórias: começou até o fim da janela E
  -- encerrou dentro da carência.
  --
  -- Sem hora de início não dá para avaliar a primeira. Devolve NULO em
  -- vez de chutar: classificar sem o dado é inventar resultado, e o
  -- contrato sumir da conta é menos grave do que entrar na conta errado.
  if r.inicio is null then return null; end if;

  v_carencia := coalesce(r.tec1_carencia_min, 59);

  return case
    when r.inicio <= v_fim_janela
     and r.fim    <= v_fim_janela + (v_carencia || ' minutes')::interval
    then 'PADRAO' else 'SEM_PADRAO'
  end;
end;
$function$;

revoke all on function public.tec1_da_os(uuid) from public, anon;
grant execute on function public.tec1_da_os(uuid) to authenticated;


-- ------------------------------------------------------------------
-- D. O consolidado do contrato
-- ------------------------------------------------------------------
create or replace function public.tec1_da_visita(p_visita uuid)
returns text
language sql
stable
set search_path to 'public'
as $function$
  -- SEVERO de propósito: uma O.S. fora do padrão põe o contrato fora do
  -- padrão. Dizer "padrão" com uma O.S. estourada esconderia justamente
  -- a O.S. que a CLARO vai cobrar. Mesma lógica da 035.
  --
  -- A ordem do `min` sobre o texto NÃO serve: 'EXPURGADA' < 'PADRAO' <
  -- 'SEM_PADRAO' em ordem alfabética, e EXPURGADA venceria. Por isso o
  -- case explícito.
  select case
    when bool_or(t.tec1 = 'SEM_PADRAO') then 'SEM_PADRAO'
    when bool_or(t.tec1 = 'PADRAO')     then 'PADRAO'
    when bool_or(t.tec1 = 'EXPURGADA')  then 'EXPURGADA'
  end
  from (select tec1_da_os(o.id) as tec1
          from ordem_servico o where o.visita_id = p_visita) t;
$function$;

revoke all on function public.tec1_da_visita(uuid) from public, anon;
grant execute on function public.tec1_da_visita(uuid) to authenticated;


-- ------------------------------------------------------------------
-- E. Recalcular os dois níveis
-- ------------------------------------------------------------------
create or replace function public.recalcular_tec1(p_de date default null,
                                                  p_ate date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n_os int; n_v int;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao para recalcular TEC1.' using errcode = '42501';
  end if;

  -- A O.S. PRIMEIRO: o consolidado da visita lê a regra da O.S.
  update ordem_servico o set tec1 = tec1_da_os(o.id)
    from visita v
   where v.id = o.visita_id
     and v.excluido_em is null
     and (p_de is null or v.data_agendada >= p_de)
     and (p_ate is null or v.data_agendada <= p_ate);
  get diagnostics n_os = row_count;

  update visita v set tec1 = tec1_da_visita(v.id)
   where v.excluido_em is null
     and (p_de is null or v.data_agendada >= p_de)
     and (p_ate is null or v.data_agendada <= p_ate);
  get diagnostics n_v = row_count;

  return jsonb_build_object('ordens', n_os, 'visitas', n_v);
end;
$function$;

revoke all on function public.recalcular_tec1(date, date) from public, anon;
grant execute on function public.recalcular_tec1(date, date) to authenticated;


-- ------------------------------------------------------------------
-- F. A importação passa a carimbar os dois
-- ------------------------------------------------------------------
-- `importar_toa_interno` já grava `visita.tec1` no fim de cada linha, e
-- isso continua certo — `tec1_da_visita` calcula a partir de
-- `tec1_da_os` na hora, sem depender da coluna materializada. O que
-- faltava era a coluna da O.S.; a reconciliação (078) fecha isso na
-- mesma transação, depois das O.S. já estarem inseridas.
create or replace function public.reconciliar_importacao(p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_base    uuid;
  v_empresa uuid;
  n_recurso int := 0;
  n_tipo    int := 0;
  n_ligado  int := 0;
  n_jornada int := 0;
  n_tec1    int := 0;
begin
  select i.base_id into v_base from importacao i where i.id = p_importacao_id;
  if v_base is null then
    return jsonb_build_object('erro', 'importacao sem base');
  end if;
  select b.empresa_id into v_empresa from base b where b.id = v_base;

  with candidatos as (
    select nullif(btrim(l.dados->>'ID do Recurso'), '')     as recurso,
           nullif(btrim(l.dados->>'Login do Técnico'), '')  as login,
           coalesce(j_data(l.dados, 'Data'), current_date)  as dia
      from importacao_linha l
     where l.importacao_id = p_importacao_id
  ),
  validos as (
    select recurso, login, min(dia) as de, max(dia) as ate, count(*) as qtd
      from candidatos
     where recurso is not null and login is not null
     group by 1, 2
  ),
  vencedor as (
    select distinct on (recurso) recurso, login, de, ate, qtd
      from validos order by recurso, qtd desc, login
  )
  insert into toa_recurso (base_id, recurso_id, login_toa,
                           primeira_vez, ultima_vez, vezes, empresa_id)
  select v_base, x.recurso, x.login, x.de, x.ate, x.qtd, v_empresa
    from vencedor x
  on conflict (base_id, recurso_id) do update
    set login_toa    = excluded.login_toa,
        ultima_vez   = greatest(toa_recurso.ultima_vez, excluded.ultima_vez),
        primeira_vez = least(toa_recurso.primeira_vez, excluded.primeira_vez),
        vezes        = toa_recurso.vezes + excluded.vezes;
  get diagnostics n_recurso = row_count;

  with novos as (
    select distinct btrim(l.dados->>'Tipo de Atividade__2') as nome
      from importacao_linha l
     where l.importacao_id = p_importacao_id
       and nullif(btrim(coalesce(l.dados->>'Tipo de Atividade__2','')),'') is not null
  )
  insert into tipo_atividade (nome, natureza, ativo, conferir, empresa_id)
  select x.nome, 'PRODUTIVA', true, true, v_empresa
    from novos x
   where not exists (select 1 from tipo_atividade t
                      where norm_txt(t.nome) = norm_txt(x.nome))
  on conflict (nome) do nothing;
  get diagnostics n_tipo = row_count;

  update visita v
     set tipo_atividade_id = t.id
    from tipo_atividade t
   where v.tipo_atividade_id is null
     and v.base_id = v_base
     and v.excluido_em is null
     and nullif(btrim(coalesce(v.dados_origem->>'Tipo de Atividade__2','')),'') is not null
     and norm_txt(t.nome) = norm_txt(v.dados_origem->>'Tipo de Atividade__2');
  get diagnostics n_ligado = row_count;

  update visita v
     set equipe_id = coalesce(v.equipe_id,
                              equipe_do_contrato(v.base_id, x.login, v.data_agendada)),
         tecnico_responsavel_id = coalesce(v.tecnico_responsavel_id, x.tecnico),
         atualizado_em = now()
    from (
      select vi.id,
             login_do_recurso(vi.base_id, vi.dados_origem->>'ID do Recurso') as login,
             (select t.id from tecnico t
               where t.base_id = vi.base_id
                 and norm_txt(t.matricula) =
                     norm_txt(login_do_recurso(vi.base_id,
                                               vi.dados_origem->>'ID do Recurso'))
               limit 1) as tecnico
        from visita vi
       where vi.base_id = v_base
         and vi.excluido_em is null
         and vi.rota_fixada_em is null
         and nullif(btrim(coalesce(vi.dados_origem->>'Login do Técnico','')),'') is null
         and (vi.equipe_id is null or vi.tecnico_responsavel_id is null)
    ) x
   where v.id = x.id
     and x.login is not null;
  get diagnostics n_jornada = row_count;

  -- 080: o TEC1 da O.S. Depois de tudo, porque depende do tipo de
  -- servico que os passos acima acabaram de acertar.
  update ordem_servico o set tec1 = tec1_da_os(o.id)
    from visita v
   where v.id = o.visita_id
     and v.base_id = v_base
     and v.excluido_em is null
     and v.importacao_id = p_importacao_id;
  get diagnostics n_tec1 = row_count;

  update visita v set tec1 = tec1_da_visita(v.id)
   where v.base_id = v_base and v.excluido_em is null
     and v.importacao_id = p_importacao_id;

  return jsonb_build_object(
    'recursos_aprendidos', n_recurso,
    'tipos_criados', n_tipo,
    'visitas_ligadas_ao_tipo', n_ligado,
    'jornada_atribuida', n_jornada,
    'tec1_de_os', n_tec1);
end;
$function$;

revoke all on function public.reconciliar_importacao(uuid) from public, anon;
grant execute on function public.reconciliar_importacao(uuid) to authenticated;


-- ------------------------------------------------------------------
-- G. Reclassificar o que já está no banco
-- ------------------------------------------------------------------
update ordem_servico o set tec1 = tec1_da_os(o.id)
  from visita v where v.id = o.visita_id and v.excluido_em is null;

update visita v set tec1 = tec1_da_visita(v.id) where v.excluido_em is null;

notify pgrst, 'reload schema';
