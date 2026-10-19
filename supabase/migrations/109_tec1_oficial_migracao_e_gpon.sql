-- ┌─ 109 · TEC1 pelo livro da CLARO, migração pelo produto, GPON pela skill ┐
-- │ > "corrija essa tela no card [...] 'chegou dentro da janela', tire     │
-- │ >  essa frase e coloque - TEC1 - Atendimento no Prazo [...] o cálculo  │
-- │ >  é pra fazer em tudo que foi encerrado" · "fazer a análise da        │
-- │ >  migração [...] acredito eu que é no produto" · "analise como        │
-- │ >  identificar [...] se é uma adesão, ou uma adesão gpon [...] subir o │
-- │ >  marcador no contrato" — Emanuel, 19/10                              │
-- │                                                                        │
-- │ Escolhas dele (19/10): migração vai para MIGRACAO GPON; GPON é         │
-- │ etiqueta no contrato (o grupo não muda); dia passado sem baixa fica    │
-- │ de fora como pendente; tolerância alinhada ao PDF (2 h / 1 h, "menor   │
-- │ que"). Ver D-187, D-188.                                               │
-- └────────────────────────────────────────────────────────────────────────┘

-- ════════════════════════════════════════════════════════════════════
-- A · TEC1 ("Indicadores COP - TEC1", CLARO, v1.0 de 05/07/2021)
-- ════════════════════════════════════════════════════════════════════
-- Tolerância (item 10.3): Instalação e Serviços +2 h, Manutenção +1 h, e a
-- baixa tem de ser MENOR que o fim da janela + tolerância. Era 119/59 com
-- "até" — diferença só no último minuto.
update tipo_servico set tec1_carencia_min = 120 where tec1_carencia_min = 119;
update tipo_servico set tec1_carencia_min = 60  where tec1_carencia_min = 59;

-- Comparado O.S. a O.S. contra a versão anterior, nos 909 O.S. de 17 e
-- 19/10: as 909 deram a mesma classe (464 PADRAO, 16 SEM_PADRAO, 25
-- EXPURGADA, 404 em aberto). Os casos novos do livro não aconteceram nesses
-- dois dias — a regra fica certa para quando acontecerem.
create or replace function public.tec1_da_os(p_os uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  r record;
  v_status text; v_motivo text; v_janela text; v_tipo text;
  v_tol int;
  v_ini_janela timestamptz; v_fim_janela timestamptz;
  v_executado boolean; v_reagendada boolean;
begin
  select o.id, o.status_operadora,
         t.descricao as tipo_os,
         v.situacao, v.data_agendada, v.janela_inicio, v.janela_fim, v.inicio, v.fim,
         v.dados_origem,
         ts.tec1_carencia_min
    into r
    from ordem_servico o
    join visita v on v.id = o.visita_id
    left join tipo_os t on t.id = o.tipo_os_id
    left join tipo_servico ts on ts.id = v.tipo_servico_id
   where o.id = p_os;
  if r.id is null then return null; end if;

  -- Só entra o que foi ENCERRADO no TOA. Em aberto = pendente, fica de fora
  -- — inclusive o "Sem tratamento" (11.10) de dia passado: se a última
  -- importação do dia foi ao meio-dia, a tarde contaria contra sem ser
  -- (escolha do Emanuel, 19/10).
  v_status := norm_txt(coalesce(r.dados_origem->>'Status da Atividade', ''));
  if v_status not in ('CONCLUIDO', 'NAO CONCLUIDO') then return null; end if;

  -- 6 · Expurgos. Cancelado pelo sistema NETSMS (já existia, D-047).
  v_motivo := norm_txt(coalesce(r.dados_origem->>'Motivo de Fechamento Externo', ''));
  if v_status = 'NAO CONCLUIDO' and v_motivo = 'CANCELADO NO SISTEMA NETSMS' then
    return 'EXPURGADA';
  end if;
  -- 9 · O.S. imediata e janela vazia não são contabilizadas.
  v_janela := norm_txt(coalesce(r.dados_origem->>'Intervalo de Tempo', ''));
  if v_janela in ('IMEDIATA', '') or r.janela_inicio is null or r.janela_fim is null then
    return 'EXPURGADA';
  end if;
  -- 6 · Janela de atendimento 08:00 - 22:00.
  if r.janela_inicio = time '08:00' and r.janela_fim = time '22:00' then
    return 'EXPURGADA';
  end if;
  -- 6 · Tipos de O.S. fora do indicador.
  v_tipo := norm_txt(coalesce(r.tipo_os, ''));
  if v_tipo in ('MANUTENCAO CORRETIVA - MDU', 'MANUTENCAO PREVENTIVA - MDU',
                'MANUTENCAO PREVENTIVA INDOOR', 'VARREDURA DE REDE EXTERNA',
                'DESCONEXAO POR OPCAO EBT') then
    return 'EXPURGADA';
  end if;

  -- Sem a hora do fechamento não há o que medir (nulo, nunca chute).
  if r.fim is null then return null; end if;

  v_ini_janela := (r.data_agendada + r.janela_inicio) at time zone 'America/Manaus';
  v_fim_janela := (r.data_agendada + r.janela_fim)    at time zone 'America/Manaus';

  v_executado := case
    when r.status_operadora is not null then r.status_operadora = 'EXECUTADA'
    else r.situacao = 'CONCLUIDA'
  end;

  if not v_executado then
    -- Cancelada ou reagendada (11.1-11.3, 11.7-11.9). Antes da janela:
    -- reagendada sempre expurga (11.7); cancelada só se não houve início
    -- (11.1) — cancelada com início antes da janela é 11.2, com padrão.
    v_reagendada := r.situacao = 'REAGENDAMENTO';
    if r.fim < v_ini_janela and (v_reagendada or r.inicio is null) then
      return 'EXPURGADA';
    end if;
    return case when r.fim <= v_fim_janela then 'PADRAO' else 'SEM_PADRAO' end;
  end if;

  -- Executada (11.1, 11.4-11.6).
  if r.inicio is null then
    -- Baixa antes da janela e sem início = script automático (11.1).
    if r.fim < v_ini_janela then return 'EXPURGADA'; end if;
    return null;
  end if;
  -- 11.4 · Execução antes da janela.
  if r.fim < v_ini_janela then return 'PADRAO'; end if;

  -- 11.5 / 11.6 · Início até o fim da janela E baixa antes do fim + tolerância.
  v_tol := coalesce(r.tec1_carencia_min, 120);
  return case
    when r.inicio <= v_fim_janela
     and r.fim    <  v_fim_janela + make_interval(mins => v_tol)
    then 'PADRAO' else 'SEM_PADRAO'
  end;
end;
$function$;

-- O TEC1 de cada O.S. AO VIVO, como coluna calculada do PostgREST: a tela
-- pede `ordem_servico(..., tec1_ao_vivo)` e não lê o cache `tec1`, que
-- envelhece calado (D-150).
create or replace function public.tec1_ao_vivo(o ordem_servico)
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  select tec1_da_os(o.id);
$function$;

-- ════════════════════════════════════════════════════════════════════
-- B · Migração e GPON, lidas da linha do TOA
-- ════════════════════════════════════════════════════════════════════
-- ┌─ de onde veio a regra (D-188) ──────────────────────────────────────┐
-- │ Analítico de MIGRAÇÃO da CLARO (1.132 O.S., 01-09/10/2026):        │
-- │   · TIPO_OS = MUDANCA DE PACOTE em 100%;                           │
-- │   · o produto NOVO traz MIG, PON ou FIBRA em 100% (MIG ou PON      │
-- │     sozinhos: 66%);                                                │
-- │   · o produto ANTERIOR nunca traz PON nem FIBRA (0 de 1.132).      │
-- │ No TOA o produto novo é o item "pendente" da coluna Produto; o     │
-- │ "instalado" é o que o cliente já tem. Sem a trava do anterior, a   │
-- │ troca de pacote de quem JÁ é fibra contaria como migração.         │
-- │                                                                    │
-- │ Analítico de ADESÃO GPON (708 O.S., 01-10/10/2026):                │
-- │   · TIPO_OS é o mesmo da adesão comum;                             │
-- │   · o produto falha: 211 vêm só "ACESSO VIRTUA", sem PON;          │
-- │   · TECNOLOGIA = GPON em 100% — coluna que o TOA não traz.         │
-- │ No TOA o sinal é a skill exigida: "PON(1/100)" em Habilidade de    │
-- │ Trabalho. Nos dados de 17 e 19/10 ela contém todos os outros       │
-- │ sinais (produto PON, workzone GPON, tipo INST GPON).               │
-- └────────────────────────────────────────────────────────────────────┘

alter table visita add column if not exists tecnologia text
  check (tecnologia is null or tecnologia = 'GPON');
comment on column visita.tecnologia is
  'GPON quando a linha do TOA tem sinal de GPON (skill PON, workzone GPON, tipo '
  'INST GPON, produto pendente PON, ou migração). NULO = não identificada — '
  'não quer dizer HFC (D-188).';

create or replace function public.eh_migracao(p_visita uuid)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select exists (select 1 from ordem_servico o join tipo_os t on t.id = o.tipo_os_id
                  where o.visita_id = p_visita and norm_txt(t.descricao) = 'MUDANCA DE PACOTE')
     and exists (select 1 from visita_produto p
                  where p.visita_id = p_visita and p.situacao = 'pendente'
                    and norm_txt(p.nome) ~ '(^|[^A-Z])(MIG|PON|FIBRA)([^A-Z]|$)')
     and not exists (select 1 from visita_produto p
                      where p.visita_id = p_visita and p.situacao = 'instalado'
                        and norm_txt(p.nome) ~ '(^|[^A-Z])(PON|FIBRA)([^A-Z]|$)');
$function$;

create or replace function public.tecnologia_da_visita(p_visita uuid)
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  select case when
         (v.dados_origem->>'Habilidade de Trabalho') ~* '(^|[^A-Za-z])PON\('
      or (v.dados_origem->>'Workzone key') ~* 'GPON'
      or (v.dados_origem->>'Tipo de Atividade__2') ~* 'GPON'
      or exists (select 1 from visita_produto p
                  where p.visita_id = v.id and p.situacao = 'pendente'
                    and norm_txt(p.nome) ~ '(^|[^A-Z])PON([^A-Z]|$)')
      or eh_migracao(v.id)
    then 'GPON' end
    from visita v where v.id = p_visita;
$function$;

-- O grupo: o de sempre (tipo de O.S., menor prioridade), agora com a
-- migração detectada como candidata. Adesão (2) continua na frente de
-- migração (4), como sempre foi.
create or replace function public.grupo_da_visita(p_visita uuid)
 returns uuid
 language sql
 stable
 set search_path to 'public'
as $function$
  select x.id from (
    select ts.id, ts.prioridade
      from ordem_servico o
      join tipo_os t on t.id = o.tipo_os_id
      join tipo_servico ts on ts.id = t.tipo_servico_id
     where o.visita_id = p_visita
    union all
    select ts.id, ts.prioridade
      from tipo_servico ts
     where ts.nome = 'MIGRACAO GPON' and ts.ativo and eh_migracao(p_visita)
  ) x
  order by x.prioridade
  limit 1;
$function$;

-- A reconciliação (2ª chamada da importação, D-181) classifica as visitas
-- desta importação — o produto (visita_produto) já foi extraído. ANTES do
-- TEC1, porque o grupo dá a tolerância.
do $$
declare d text;
  marca text := E'  -- 082: as visitas que ESTA importacao tocou.';
  bloco text := E'  -- 109: tecnologia e migracao, lidas da linha do TOA (D-188). Antes do\n'
             || E'  -- TEC1: o grupo da a tolerancia.\n'
             || E'  update visita v\n'
             || E'     set tecnologia = tecnologia_da_visita(v.id),\n'
             || E'         tipo_servico_id = coalesce(grupo_da_visita(v.id), v.tipo_servico_id)\n'
             || E'   where v.id in (select l.visita_id from importacao_linha l\n'
             || E'                   where l.importacao_id = p_importacao_id\n'
             || E'                     and l.visita_id is not null);\n\n';
begin
  d := pg_get_functiondef('public.reconciliar_importacao'::regproc);
  if position('tecnologia_da_visita' in d) > 0 then return; end if;
  if position(marca in d) = 0 then
    raise exception 'reconciliar_importacao mudou: nao achei onde classificar';
  end if;
  execute replace(d, marca, bloco || marca);
end $$;

-- Os contratos já importados desde 17/10 (antes da regra).
update visita v
   set tecnologia = tecnologia_da_visita(v.id),
       tipo_servico_id = coalesce(grupo_da_visita(v.id), v.tipo_servico_id)
 where v.data_agendada >= date '2026-10-17' and v.excluido_em is null;

revoke all on function public.tec1_da_os(uuid)              from public, anon;
revoke all on function public.tec1_ao_vivo(ordem_servico)   from public, anon;
revoke all on function public.eh_migracao(uuid)             from public, anon;
revoke all on function public.tecnologia_da_visita(uuid)    from public, anon;
revoke all on function public.grupo_da_visita(uuid)         from public, anon;
revoke all on function public.reconciliar_importacao(uuid)  from public, anon;
grant execute on function public.tec1_da_os(uuid)             to authenticated;
grant execute on function public.tec1_ao_vivo(ordem_servico)  to authenticated;
grant execute on function public.eh_migracao(uuid)            to authenticated;
grant execute on function public.tecnologia_da_visita(uuid)   to authenticated;
grant execute on function public.grupo_da_visita(uuid)        to authenticated;
grant execute on function public.reconciliar_importacao(uuid) to authenticated;

notify pgrst, 'reload schema';
