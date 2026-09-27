-- ============================================================================
-- 091 · O campo conversa com o controle
-- ============================================================================
-- > "vamos começar a deixar o sistema mais dinâmico agora […] temos as telas
-- >  do app do técnico para melhorar e sincronizar almox, entre outros, e
-- >  temos agora que melhorar a interação do sistema com o app do técnico"
-- >  — Emanuel, 27/09
--
-- Seis peças, todas no banco (a tela só mostra):
--
--   1. PRODUÇÃO por técnico, numa conta só — pontos, quebradas, pontos
--      perdidos, TEC1 perdido — que alimenta o painel do técnico, o
--      ranking e a central do controle. Uma conta, três telas: se cada uma
--      somasse do seu jeito, o técnico e o controlador veriam números
--      diferentes para o mesmo dia.
--   2. RANKING com a lista inteira (decisão do Emanuel, 27/09).
--   3. RITMO: "menos produtivos até 12h, 15h, 18h" = quem está abaixo da
--      fração da meta do dia esperada naquele horário.
--   4. CENTRAL do controle: pedido de ajuda (= Impedimento pelo campo),
--      TEC1 perdido, ritmo, quem mais quebrou, mensagens, material e
--      abastecimento — o "selo no canto superior direito".
--   5. CHAT controlador ↔ técnico, uma conversa por técnico.
--   6. SINALIZAÇÃO de material (faltando / com defeito) e ABASTECIMENTO
--      pedido pelo campo.
--
-- Definições do Emanuel (27/09), perguntadas antes de escrever:
--   · "pendente, que é ajuda ao controlador" = o Impedimento do app.
--   · "quebrado" = visita com O.S. de baixa IMPRODUTIVA. "Pontos perdidos"
--     = o que ela valeria se tivesse sido concluída.
--   · o técnico vê o ranking INTEIRO, com nome e pontos.
--   · "menos produtivo" = abaixo do ritmo da meta.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Quem é gestão
-- ---------------------------------------------------------------------------
-- A web decide "gestão" como ADMIN/COP/CONTROLADOR/SUPERVISOR (App.tsx).
-- Até aqui o banco só tinha `eh_gestor()` (ADMIN/COP) e o escopo por
-- equipe. A central e o chat precisam da MESMA porta que a tela usa.
create or replace function eh_gestao()
returns boolean language sql stable security definer set search_path to 'public' as $fn$
  select eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR');
$fn$;
revoke all on function eh_gestao() from public, anon;
grant execute on function eh_gestao() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. A produção por técnico — a conta única
-- ---------------------------------------------------------------------------
-- Mesmas regras de `produtividade_periodo`: jornada fora, pontos só de
-- visita CONCLUÍDA, pontos pela `pontos_da_visita`. O escopo é a EMPRESA
-- inteira (o ranking compara todo mundo); quem restringe por equipe é
-- quem chama.
--
-- ┌─ quebrada e pontos perdidos ──────────────────────────────────────┐
-- │ Quebrada = a visita tem O.S. com código de baixa IMPRODUTIVA — o  │
-- │ código da OPERADORA (`codigo_baixa_id`), o mesmo que o Dashboard  │
-- │ e a tela de Serviços já contam. Outro código aqui faria o técnico │
-- │ e o controlador lerem números diferentes.                         │
-- │                                                                   │
-- │ Pontos perdidos só contam a quebrada que NÃO foi concluída: uma   │
-- │ visita com uma O.S. improdutiva e outra de sucesso, concluída,    │
-- │ recebeu os pontos — não perdeu nada. E quebrada SEM regra de      │
-- │ pontuação não vira zero perdido: é contada à parte                │
-- │ (`perdidos_sem_regra`), porque não sabemos quanto valia (D-117).  │
-- └───────────────────────────────────────────────────────────────────┘
create or replace function producao_por_tecnico(p_de date, p_ate date)
returns table (tecnico_id uuid, visitas bigint, concluidas bigint, pontos numeric,
               dias bigint, quebradas bigint, pontos_perdidos numeric,
               perdidos_sem_regra bigint, tec1_perdidos bigint)
language sql stable security definer set search_path to 'public' as $fn$
  with v as materialized (
    select v.id, v.tecnico_responsavel_id as tec, v.situacao, v.data_agendada, v.tec1
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.empresa_id = minha_empresa()
       and v.excluido_em is null
       and v.data_agendada between p_de and p_ate
       and v.tecnico_responsavel_id is not null
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
  ),
  -- `left join lateral`: o `cross` derrubaria a visita se a função não
  -- devolvesse linha (traps.md).
  p as materialized (
    select v.id as visita_id, x.pontos_claro, coalesce(x.achou, false) as achou
      from v left join lateral pontos_da_visita(v.id) x on true
  ),
  q as materialized (
    select distinct o.visita_id
      from ordem_servico o
      join codigo_baixa c on c.id = o.codigo_baixa_id
     where c.natureza = 'IMPRODUTIVA'
       and o.visita_id in (select id from v)
  )
  select v.tec,
         count(*),
         count(*) filter (where v.situacao = 'CONCLUIDA'),
         round(coalesce(sum(p.pontos_claro) filter (where v.situacao = 'CONCLUIDA'), 0), 4),
         count(distinct v.data_agendada) filter (where v.situacao = 'CONCLUIDA'),
         count(*) filter (where q.visita_id is not null),
         round(coalesce(sum(p.pontos_claro) filter (
           where q.visita_id is not null and v.situacao <> 'CONCLUIDA' and p.achou), 0), 4),
         count(*) filter (
           where q.visita_id is not null and v.situacao <> 'CONCLUIDA' and not p.achou),
         count(*) filter (where v.tec1 = 'SEM_PADRAO')
    from v
    left join p on p.visita_id = v.id
    left join q on q.visita_id = v.id
   group by v.tec;
$fn$;
-- Interna: devolve a empresa inteira. Só as funções abaixo a chamam.
revoke all on function producao_por_tecnico(date, date) from public, anon, authenticated;

-- A meta e a faixa pela skill. Mesmo critério de `produtividade_periodo`,
-- inclusive o `coalesce(skill, 'SINGLE MASTER')` que é padrão nosso (037,
-- D-094). Sem meta cadastrada para a skill, NULO — nunca zero.
create or replace function meta_da_skill(p_skill text, p_de date, p_ate date)
returns numeric language sql stable security definer set search_path to 'public' as $fn$
  select m.meta_pontos from meta_tecnico m
   where m.ativo and m.empresa_id = minha_empresa()
     and m.skill = coalesce(p_skill, 'SINGLE MASTER')
     and m.vigencia_inicio <= p_ate
     and (m.vigencia_fim is null or m.vigencia_fim >= p_de)
   order by m.vigencia_inicio desc limit 1;
$fn$;
revoke all on function meta_da_skill(text, date, date) from public, anon;
grant execute on function meta_da_skill(text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. O ranking — a lista inteira
-- ---------------------------------------------------------------------------
-- Entra quem teve visita produtiva no período, inclusive com 0 pts: esse
-- zero é medido (trabalhou e não concluiu), não desconhecido. Empate
-- divide a posição (`rank`), e a tela mostra "3º" nos dois.
create or replace function ranking_tecnicos(p_de date, p_ate date)
returns table (posicao int, tecnico_id uuid, nome text, equipe text,
               pontos numeric, concluidas bigint, eu boolean)
language plpgsql stable security definer set search_path to 'public' as $fn$
begin
  if meu_tecnico_id() is null and not eh_gestao() then
    raise exception 'Ranking e para tecnico e gestao.' using errcode = '42501';
  end if;
  return query
    select (rank() over (order by p.pontos desc))::int,
           t.id, t.nome, e.codigo, p.pontos, p.concluidas,
           t.id is not distinct from meu_tecnico_id()
      from producao_por_tecnico(p_de, p_ate) p
      join tecnico t on t.id = p.tecnico_id
      left join equipe e on e.id = t.equipe_id
     order by p.pontos desc, t.nome;
end;
$fn$;
revoke all on function ranking_tecnicos(date, date) from public, anon;
grant execute on function ranking_tecnicos(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. O ritmo — parâmetros e a conta
-- ---------------------------------------------------------------------------
-- "Abaixo do ritmo da meta" (Emanuel, 27/09) precisa de três números que
-- ninguém tinha dito. Viram PARÂMETRO, editável, com o valor de partida
-- escrito aqui e na D-167 — não uma constante escondida:
--   · ritmo_dias_mes = 26: a meta do dia é a do mês ÷ 26 (segunda a sábado);
--   · ritmo_jornada  = 08:00 às 18:00: a fração esperada cresce em linha
--     reta nesse intervalo (12h → 40%, 15h → 70%, 18h → 100%);
--   · ritmo_cortes   = 12, 15, 18: os horários que a central confere.
insert into parametro (empresa_id, chave, valor, descricao)
select e.id, x.chave, x.valor, x.descricao
  from empresa e
 cross join (values
   ('ritmo_dias_mes', '26'::jsonb,
    'Dias de trabalho no mes: a meta do dia e a meta do mes dividida por isto (091).'),
   ('ritmo_jornada', '{"inicio":"08:00","fim":"18:00"}'::jsonb,
    'Jornada em que a meta do dia deve ser cumprida, em linha reta (091).'),
   ('ritmo_cortes', '[12,15,18]'::jsonb,
    'Horarios em que a central confere quem esta abaixo do ritmo (091).')
 ) as x(chave, valor, descricao)
on conflict do nothing;

create or replace function parametro_valor(p_chave text)
returns jsonb language sql stable security definer set search_path to 'public' as $fn$
  select valor from parametro where empresa_id = minha_empresa() and chave = p_chave;
$fn$;
revoke all on function parametro_valor(text) from public, anon;
grant execute on function parametro_valor(text) to authenticated;

-- A hora em que a visita foi concluída. `fim` do TOA só vale se o TOA
-- diz que finalizou (`finalizado_toa`) — ele vem preenchido até em
-- atividade só iniciada (D-103). Senão, a hora em que a situação mudou.
create or replace function concluida_em(p_visita uuid)
returns timestamptz language sql stable security definer set search_path to 'public' as $fn$
  select case when v.finalizado_toa and v.fim is not null then v.fim else v.situacao_em end
    from visita v where v.id = p_visita;
$fn$;
revoke all on function concluida_em(uuid) from public, anon;
grant execute on function concluida_em(uuid) to authenticated;

-- Quem está abaixo do ritmo em cada corte JÁ PASSADO de hoje, entre os
-- técnicos das equipes que quem pergunta enxerga. Técnico sem meta para a
-- skill não é "abaixo" nem "acima": entra em `sem_meta`.
create or replace function ritmo_do_dia()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_hoje date := hoje_local();
  v_agora time := (now() at time zone 'America/Manaus')::time;
  v_dias numeric := coalesce((parametro_valor('ritmo_dias_mes'))::text::numeric, 26);
  v_ini time := coalesce((parametro_valor('ritmo_jornada')->>'inicio')::time, '08:00');
  v_fim time := coalesce((parametro_valor('ritmo_jornada')->>'fim')::time, '18:00');
  v_cortes jsonb := coalesce(parametro_valor('ritmo_cortes'), '[12,15,18]'::jsonb);
  v_mes_de date := date_trunc('month', v_hoje)::date;
  v_mes_ate date := (date_trunc('month', v_hoje) + interval '1 month - 1 day')::date;
  c int; v_frac numeric; v_lim timestamptz; r jsonb := '[]'::jsonb; v_lista jsonb; v_sem int;
begin
  if not eh_gestao() then
    raise exception 'Ritmo e para a gestao.' using errcode = '42501';
  end if;
  if v_dias <= 0 or v_fim <= v_ini then
    raise exception 'Parametros de ritmo invalidos.' using errcode = '22023';
  end if;

  for c in select (jsonb_array_elements_text(v_cortes))::int loop
    continue when make_time(c, 0, 0) > v_agora;
    v_frac := least(1, greatest(0,
      extract(epoch from (make_time(c, 0, 0) - v_ini)) / extract(epoch from (v_fim - v_ini))));
    v_lim := (v_hoje + make_time(c, 0, 0)) at time zone 'America/Manaus';

    with tec as materialized (
      select distinct v.tecnico_responsavel_id as id
        from visita v
        left join tipo_atividade ta on ta.id = v.tipo_atividade_id
       where v.empresa_id = minha_empresa() and v.excluido_em is null
         and v.data_agendada = v_hoje
         and v.tecnico_responsavel_id is not null
         and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
         and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
    ),
    feito as (
      select v.tecnico_responsavel_id as id, sum(x.pontos_claro) as pts
        from visita v
        left join tipo_atividade ta on ta.id = v.tipo_atividade_id
        left join lateral pontos_da_visita(v.id) x on true
       where v.tecnico_responsavel_id in (select id from tec)
         and v.data_agendada = v_hoje and v.excluido_em is null
         and v.situacao = 'CONCLUIDA'
         and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
         and concluida_em(v.id) <= v_lim
       group by 1
    ),
    conta as (
      select t.id, t.nome, e.codigo as equipe,
             round(coalesce(f.pts, 0), 2) as pontos,
             round(meta_da_skill(t.skill, v_mes_de, v_mes_ate) / v_dias * v_frac, 2) as esperado
        from tec
        join tecnico t on t.id = tec.id
        left join equipe e on e.id = t.equipe_id
        left join feito f on f.id = tec.id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'tecnico_id', id, 'nome', nome, 'equipe', equipe,
             'pontos', pontos, 'esperado', esperado) order by pontos - esperado)
             filter (where esperado is not null and pontos < esperado), '[]'::jsonb),
           count(*) filter (where esperado is null)
      into v_lista, v_sem
      from conta;

    r := r || jsonb_build_object('corte', c, 'fracao', round(v_frac, 4),
                                 'abaixo', v_lista, 'sem_meta', v_sem);
  end loop;
  return r;
end;
$fn$;
revoke all on function ritmo_do_dia() from public, anon;
grant execute on function ritmo_do_dia() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. O painel do técnico
-- ---------------------------------------------------------------------------
create or replace function painel_do_tecnico(p_de date, p_ate date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_tec uuid := meu_tecnico_id(); t tecnico%rowtype;
  v_hoje date := hoje_local();
  m record; h record; v_meta numeric; v_fator numeric; v_prox numeric;
  v_pos int; v_total int; v_acima numeric; v_dias numeric;
  v_por_dia jsonb; v_afazer int;
begin
  if v_tec is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  select * into t from tecnico where id = v_tec;

  select * into m from producao_por_tecnico(p_de, p_ate) x where x.tecnico_id = v_tec;
  select * into h from producao_por_tecnico(v_hoje, v_hoje) x where x.tecnico_id = v_tec;

  v_meta := meta_da_skill(t.skill, p_de, p_ate);
  select f.fator into v_fator from faixa_comissao f
   where f.ativo and f.empresa_id = t.empresa_id
     and f.skill = coalesce(t.skill, 'SINGLE MASTER')
     and coalesce(m.pontos, 0) >= f.pontos_de
   order by f.pontos_de desc limit 1;
  select min(f.pontos_de) into v_prox from faixa_comissao f
   where f.ativo and f.empresa_id = t.empresa_id
     and f.skill = coalesce(t.skill, 'SINGLE MASTER')
     and f.pontos_de > coalesce(m.pontos, 0);

  select r.posicao, (select count(*) from ranking_tecnicos(p_de, p_ate))
    into v_pos, v_total
    from ranking_tecnicos(p_de, p_ate) r where r.eu;
  -- Quanto falta para passar o de cima: os pontos do primeiro que está
  -- ESTRITAMENTE acima. Em primeiro lugar, nulo — não há ninguém a passar.
  select min(r.pontos) into v_acima from ranking_tecnicos(p_de, p_ate) r
   where r.pontos > coalesce(m.pontos, 0);

  select coalesce(jsonb_agg(jsonb_build_object('dia', d, 'pontos', pts) order by d), '[]'::jsonb)
    into v_por_dia
    from (
      select v.data_agendada as d, round(sum(coalesce(x.pontos_claro, 0)), 2) as pts
        from visita v
        left join tipo_atividade ta on ta.id = v.tipo_atividade_id
        left join lateral pontos_da_visita(v.id) x on true
       where v.tecnico_responsavel_id = v_tec and v.excluido_em is null
         and v.data_agendada between p_de and p_ate
         and v.situacao = 'CONCLUIDA'
         and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       group by 1
    ) s;

  select count(*) into v_afazer
    from visita v
    join situacao_visita s on s.codigo = v.situacao and s.em_aberto
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
   where v.tecnico_responsavel_id = v_tec and v.excluido_em is null
     and v.data_agendada = v_hoje
     and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA';

  v_dias := coalesce((parametro_valor('ritmo_dias_mes'))::text::numeric, 26);

  return jsonb_build_object(
    'tecnico', t.nome, 'skill', t.skill,
    'pontos', coalesce(m.pontos, 0),
    'visitas', coalesce(m.visitas, 0),
    'concluidas', coalesce(m.concluidas, 0),
    'dias', coalesce(m.dias, 0),
    'quebradas', coalesce(m.quebradas, 0),
    'pontos_perdidos', coalesce(m.pontos_perdidos, 0),
    'perdidos_sem_regra', coalesce(m.perdidos_sem_regra, 0),
    'tec1_perdidos', coalesce(m.tec1_perdidos, 0),
    -- NULO quando não há meta para a skill: a tela escreve "sem meta
    -- cadastrada", nunca "de 0,00 pts" (era o que aparecia — D-167).
    'meta', v_meta,
    'meta_dia', case when v_meta is null then null else round(v_meta / v_dias, 2) end,
    'fator', v_fator,
    'valor', case when v_fator is null then null else round(coalesce(m.pontos, 0) * v_fator, 2) end,
    'proxima_faixa', v_prox,
    'posicao', v_pos, 'total', v_total,
    'pontos_do_de_cima', v_acima,
    'hoje', jsonb_build_object(
      'pontos', coalesce(h.pontos, 0), 'concluidas', coalesce(h.concluidas, 0),
      'quebradas', coalesce(h.quebradas, 0), 'a_fazer', v_afazer),
    'por_dia', v_por_dia);
end;
$fn$;
revoke all on function painel_do_tecnico(date, date) from public, anon;
grant execute on function painel_do_tecnico(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. O chat — uma conversa por técnico
-- ---------------------------------------------------------------------------
-- ┌─ por que a conversa é do TÉCNICO, e não do par ───────────────────┐
-- │ "cada controlador vai poder conversar com o técnico               │
-- │ individualmente" — individual do lado do técnico: ninguém mais do │
-- │ campo lê. Do lado do controle, a conversa é UMA por técnico, e    │
-- │ todo controlador que enxerga a equipe dele lê e responde. Se fosse│
-- │ uma por par, a troca de turno deixaria a pergunta do técnico      │
-- │ numa caixa que ninguém mais abre. Cada mensagem carrega o NOME de │
-- │ quem escreveu, carimbado pelo servidor (D-061).                   │
-- └───────────────────────────────────────────────────────────────────┘
create table if not exists mensagem (
  id          bigint generated always as identity primary key,
  empresa_id  uuid not null references empresa(id),
  tecnico_id  uuid not null references tecnico(id),
  do_campo    boolean not null,
  autor_id    uuid not null,
  autor_nome  text,
  texto       text not null check (length(btrim(texto)) between 1 and 2000),
  criado_em   timestamptz not null default now(),
  lida_em     timestamptz
);
create index if not exists mensagem_tecnico_idx on mensagem (tecnico_id, criado_em desc);
create index if not exists mensagem_nao_lida_idx on mensagem (empresa_id, do_campo) where lida_em is null;
alter table mensagem enable row level security;

-- Leitura: o técnico, a conversa dele; a gestão, a dos técnicos das
-- equipes que enxerga. Sem policy de escrita: só pelas RPCs.
drop policy if exists mensagem_leitura on mensagem;
create policy mensagem_leitura on mensagem for select to authenticated using (
  empresa_id = (select minha_empresa())
  and (
    tecnico_id = (select meu_tecnico_id())
    or ((select eh_gestao()) and (
          (select eh_gestor())
          or tecnico_id in (select t.id from tecnico t
                             where t.equipe_id in (select equipes_visiveis()))))
  )
);

create or replace function enviar_mensagem(p_tecnico_id uuid, p_texto text)
returns bigint language plpgsql security definer set search_path to 'public' as $fn$
declare v_tec uuid; v_campo boolean; v_id bigint; v_emp uuid;
begin
  if nullif(btrim(coalesce(p_texto, '')), '') is null then
    raise exception 'Mensagem vazia.' using errcode = '23514';
  end if;
  if length(btrim(p_texto)) > 2000 then
    raise exception 'Mensagem longa demais (maximo 2000 caracteres).' using errcode = '23514';
  end if;

  if p_tecnico_id is null then
    -- Do campo: a conversa é sempre a DELE. O cliente não escolhe.
    v_tec := meu_tecnico_id(); v_campo := true;
    if v_tec is null then
      raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
    end if;
  else
    if not eh_gestao() then
      raise exception 'So a gestao escreve para um tecnico.' using errcode = '42501';
    end if;
    select t.id into v_tec from tecnico t
     where t.id = p_tecnico_id and t.empresa_id = minha_empresa()
       and (eh_gestor() or t.equipe_id in (select equipes_visiveis()));
    if v_tec is null then
      raise exception 'Tecnico fora do seu escopo.' using errcode = '42501';
    end if;
    v_campo := false;
  end if;

  select empresa_id into v_emp from tecnico where id = v_tec;
  insert into mensagem (empresa_id, tecnico_id, do_campo, autor_id, autor_nome, texto)
  values (v_emp, v_tec, v_campo, auth.uid(),
          (select coalesce(nullif(apelido, ''), nome) from perfil where id = auth.uid()),
          btrim(p_texto))
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function enviar_mensagem(uuid, text) from public, anon;
grant execute on function enviar_mensagem(uuid, text) to authenticated;

-- Marca como lido o que veio DO OUTRO LADO. Nulo = o técnico lendo a
-- própria conversa.
create or replace function marcar_conversa_lida(p_tecnico_id uuid)
returns int language plpgsql security definer set search_path to 'public' as $fn$
declare v_tec uuid; v_do_campo boolean; n int;
begin
  if p_tecnico_id is null then
    v_tec := meu_tecnico_id(); v_do_campo := false;
    if v_tec is null then
      raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
    end if;
  else
    if not eh_gestao() then
      raise exception 'Sem permissao.' using errcode = '42501';
    end if;
    select t.id into v_tec from tecnico t
     where t.id = p_tecnico_id and t.empresa_id = minha_empresa()
       and (eh_gestor() or t.equipe_id in (select equipes_visiveis()));
    if v_tec is null then
      raise exception 'Tecnico fora do seu escopo.' using errcode = '42501';
    end if;
    v_do_campo := true;
  end if;
  update mensagem set lida_em = now()
   where tecnico_id = v_tec and do_campo = v_do_campo and lida_em is null;
  get diagnostics n = row_count;
  return n;
end;
$fn$;
revoke all on function marcar_conversa_lida(uuid) from public, anon;
grant execute on function marcar_conversa_lida(uuid) to authenticated;

-- A caixa de entrada do controle: uma linha por técnico que tem conversa.
create or replace function conversas_do_controle()
returns table (tecnico_id uuid, nome text, equipe text, tem_app boolean,
               ultima_texto text, ultima_em timestamptz, ultima_do_campo boolean,
               nao_lidas bigint)
language plpgsql stable security definer set search_path to 'public' as $fn$
begin
  if not eh_gestao() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  return query
    with visiveis as materialized (
      select t.id from tecnico t
       where t.empresa_id = minha_empresa()
         and (eh_gestor() or t.equipe_id in (select equipes_visiveis()))
    ),
    ult as (
      select distinct on (m.tecnico_id) m.tecnico_id, m.texto, m.criado_em, m.do_campo
        from mensagem m where m.tecnico_id in (select id from visiveis)
       order by m.tecnico_id, m.criado_em desc
    )
    select t.id, t.nome, e.codigo, t.usuario_id is not null,
           u.texto, u.criado_em, u.do_campo,
           (select count(*) from mensagem m
             where m.tecnico_id = t.id and m.do_campo and m.lida_em is null)
      from ult u
      join tecnico t on t.id = u.tecnico_id
      left join equipe e on e.id = t.equipe_id
     order by u.criado_em desc;
end;
$fn$;
revoke all on function conversas_do_controle() from public, anon;
grant execute on function conversas_do_controle() to authenticated;

-- O Realtime carrega a linha; a verdade é a tabela (D-119). A mensagem é
-- magra: não traz nome, telefone nem endereço de assinante.
do $$ begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and tablename = 'mensagem') then
    execute 'alter publication supabase_realtime add table mensagem';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6a. Sinalização de material pelo campo
-- ---------------------------------------------------------------------------
create table if not exists sinalizacao_material (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresa(id),
  tecnico_id    uuid not null references tecnico(id),
  tipo          text not null check (tipo in ('FALTANDO', 'DEFEITO')),
  item_id       uuid references item_miscelanea(id),
  serial        text,
  descricao     text,
  situacao      text not null default 'ABERTA'
                check (situacao in ('ABERTA', 'ATENDIDA', 'RECUSADA')),
  criado_em     timestamptz not null default now(),
  criado_por    uuid not null,
  resolvido_em  timestamptz,
  resolvido_por uuid,
  resposta      text,
  -- Sinalizar "falta alguma coisa" sem dizer o quê não ajuda ninguém.
  constraint sinalizacao_diz_o_que check (
    item_id is not null or nullif(btrim(coalesce(serial, '')), '') is not null
    or nullif(btrim(coalesce(descricao, '')), '') is not null)
);
create index if not exists sinalizacao_aberta_idx on sinalizacao_material (empresa_id)
  where situacao = 'ABERTA';
alter table sinalizacao_material enable row level security;

drop policy if exists sinalizacao_leitura on sinalizacao_material;
create policy sinalizacao_leitura on sinalizacao_material for select to authenticated using (
  empresa_id = (select minha_empresa())
  and (tecnico_id = (select meu_tecnico_id())
       or (select tem_permissao('almoxarifado.ver')))
);

create or replace function sinalizar_material(p_tipo text, p_item_id uuid,
                                              p_serial text, p_descricao text)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_tec uuid := meu_tecnico_id(); v_id uuid;
begin
  if v_tec is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  if p_item_id is not null and not exists (
       select 1 from item_miscelanea where id = p_item_id and empresa_id = minha_empresa()) then
    raise exception 'Item nao encontrado.' using errcode = 'P0002';
  end if;
  insert into sinalizacao_material (empresa_id, tecnico_id, tipo, item_id, serial,
                                    descricao, criado_por)
  values (minha_empresa(), v_tec, p_tipo, p_item_id,
          nullif(upper(btrim(coalesce(p_serial, ''))), ''),
          nullif(btrim(coalesce(p_descricao, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function sinalizar_material(text, uuid, text, text) from public, anon;
grant execute on function sinalizar_material(text, uuid, text, text) to authenticated;

-- O técnico não lê o catálogo (é do almoxarifado). Aqui lê só o que
-- precisa para dizer O QUE falta: nome, código, tipo.
create or replace function catalogo_para_o_campo()
returns table (item_id uuid, codigo text, nome text, tipo text, unidade text)
language sql stable security definer set search_path to 'public' as $fn$
  select i.id, i.codigo, i.nome, i.tipo, i.unidade
    from item_miscelanea i
   where i.empresa_id = minha_empresa() and i.ativo
     and meu_tecnico_id() is not null
   order by i.tipo, i.nome;
$fn$;
revoke all on function catalogo_para_o_campo() from public, anon;
grant execute on function catalogo_para_o_campo() to authenticated;

create or replace function minhas_sinalizacoes()
returns table (id uuid, tipo text, item text, serial text, descricao text,
               situacao text, criado_em timestamptz, resolvido_em timestamptz, resposta text)
language sql stable security definer set search_path to 'public' as $fn$
  select s.id, s.tipo, i.nome, s.serial, s.descricao, s.situacao, s.criado_em,
         s.resolvido_em, s.resposta
    from sinalizacao_material s
    left join item_miscelanea i on i.id = s.item_id
   where s.tecnico_id = meu_tecnico_id()
   order by s.criado_em desc limit 50;
$fn$;
revoke all on function minhas_sinalizacoes() from public, anon;
grant execute on function minhas_sinalizacoes() to authenticated;

-- O almoxarifado responde. A resposta vira AVISO na equipe do técnico —
-- a mesma porta por onde o campo já recebe o que muda (059).
create or replace function resolver_sinalizacao(p_id uuid, p_situacao text, p_resposta text)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare s sinalizacao_material%rowtype; v_eq uuid; v_item text;
begin
  perform almox_pode_mexer();
  if p_situacao not in ('ATENDIDA', 'RECUSADA') then
    raise exception 'A resposta e ATENDIDA ou RECUSADA.' using errcode = '23514';
  end if;
  if p_situacao = 'RECUSADA' and nullif(btrim(coalesce(p_resposta, '')), '') is null then
    raise exception 'Recusar exige dizer o motivo ao tecnico.' using errcode = '23514';
  end if;
  select * into s from sinalizacao_material
   where id = p_id and empresa_id = minha_empresa() for update;
  if not found then raise exception 'Sinalizacao nao encontrada.' using errcode = 'P0002'; end if;
  if s.situacao <> 'ABERTA' then
    raise exception 'Esta sinalizacao ja foi respondida.' using errcode = '23514';
  end if;

  update sinalizacao_material
     set situacao = p_situacao, resposta = nullif(btrim(coalesce(p_resposta, '')), ''),
         resolvido_em = now(), resolvido_por = auth.uid()
   where id = p_id;

  select equipe_id into v_eq from tecnico where id = s.tecnico_id;
  select nome into v_item from item_miscelanea where id = s.item_id;
  if v_eq is not null then
    insert into aviso (empresa_id, equipe_id, tipo, titulo, detalhe, autor_login)
    values (s.empresa_id, v_eq, 'MATERIAL',
            case p_situacao when 'ATENDIDA' then 'O almoxarifado atendeu o seu pedido'
                            else 'O almoxarifado recusou o seu pedido' end,
            concat_ws(' — ', coalesce(v_item, s.serial, s.descricao),
                      nullif(btrim(coalesce(p_resposta, '')), '')),
            (select coalesce(nullif(apelido, ''), nome) from perfil where id = auth.uid()));
  end if;
end;
$fn$;
revoke all on function resolver_sinalizacao(uuid, text, text) from public, anon;
grant execute on function resolver_sinalizacao(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6b. Abastecimento pedido pelo campo
-- ---------------------------------------------------------------------------
-- A pendência 3 da D-164 ("o técnico pede abastecimento pelo celular?")
-- respondida: sim. O pedido nasce EM ABERTO e a frota aprova — o fluxo que
-- já existia. O carro é o que está no NOME dele (condutor atual): o
-- cliente não escolhe o veículo.
--
-- Odômetro é opcional, como na web: exceção de odômetro é para CONFERIR,
-- nunca bloqueia lançamento (D-164). A tela pede com ênfase, porque sem
-- ele o km/l daquele trecho não se mede.
create or replace function meu_veiculo()
returns table (veiculo_id uuid, placa text, apelido text, modelo text,
               hodometro_atual int, ultimo_abastecimento date, desde timestamptz)
language sql stable security definer set search_path to 'public' as $fn$
  select v.id, v.placa, v.apelido, v.modelo,
         greatest(v.hodometro_cadastro,
                  (select max(a.hodometro) from abastecimento a
                    where a.veiculo_id = v.id and a.situacao <> 'CANCELADO'),
                  (select max(m.hodometro) from manutencao m
                    where m.veiculo_id = v.id and m.situacao <> 'CANCELADA')),
         (select max(a.data) from abastecimento a
           where a.veiculo_id = v.id and a.situacao <> 'CANCELADO'),
         c.desde
    from veiculo_condutor c
    join veiculo v on v.id = c.veiculo_id
   where c.tecnico_id = meu_tecnico_id() and c.ate is null
     and v.arquivado_em is null and v.empresa_id = minha_empresa()
   order by c.desde desc limit 1;
$fn$;
revoke all on function meu_veiculo() from public, anon;
grant execute on function meu_veiculo() to authenticated;

create or replace function pedir_abastecimento(p_dados jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_tec uuid := meu_tecnico_id(); v_veic uuid; v_emp uuid; v_id uuid;
        v_valor numeric; v_preco numeric; v_litros numeric;
begin
  if v_tec is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  select m.veiculo_id into v_veic from meu_veiculo() m;
  if v_veic is null then
    raise exception 'Nenhum carro esta no seu nome. Fale com a frota.' using errcode = 'P0002';
  end if;
  select empresa_id into v_emp from veiculo where id = v_veic;

  v_valor := nullif(p_dados->>'valor', '')::numeric;
  v_preco := nullif(p_dados->>'valor_litro', '')::numeric;
  if v_valor is null or v_valor <= 0 then
    raise exception 'Informe o valor do abastecimento.' using errcode = '23514';
  end if;
  if v_preco is null or v_preco <= 0 then
    raise exception 'Informe o preco do litro.' using errcode = '23514';
  end if;
  v_litros := coalesce(nullif(p_dados->>'litros', '')::numeric, round(v_valor / v_preco, 3));

  insert into abastecimento (empresa_id, veiculo_id, tecnico_id, data, combustivel, valor,
                             valor_litro, litros, hodometro, posto, observacao, situacao,
                             criado_por)
  values (v_emp, v_veic, v_tec, hoje_local(),
          coalesce(nullif(p_dados->>'combustivel', ''), 'GASOLINA_COMUM'),
          v_valor, v_preco, v_litros, nullif(p_dados->>'hodometro', '')::int,
          nullif(btrim(p_dados->>'posto'), ''), nullif(btrim(p_dados->>'observacao'), ''),
          'EM_ABERTO', auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function pedir_abastecimento(jsonb) from public, anon;
grant execute on function pedir_abastecimento(jsonb) to authenticated;

create or replace function meus_abastecimentos()
returns table (id uuid, data date, placa text, combustivel text, valor numeric,
               valor_litro numeric, litros numeric, hodometro int, posto text,
               situacao text, cancelado_motivo text, criado_em timestamptz)
language sql stable security definer set search_path to 'public' as $fn$
  select a.id, a.data, v.placa, a.combustivel, a.valor, a.valor_litro, a.litros,
         a.hodometro, a.posto, a.situacao, a.cancelado_motivo, a.criado_em
    from abastecimento a join veiculo v on v.id = a.veiculo_id
   where a.tecnico_id = meu_tecnico_id() and a.empresa_id = minha_empresa()
   order by a.criado_em desc limit 30;
$fn$;
revoke all on function meus_abastecimentos() from public, anon;
grant execute on function meus_abastecimentos() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. A central do controle — o selo do canto superior direito
-- ---------------------------------------------------------------------------
-- Uma chamada devolve tudo que pede atenção, e cada seção só aparece para
-- quem tem a chave dela: o almoxarife vê material, a frota vê
-- abastecimento, a gestão vê a operação.
create or replace function central_do_controle()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_hoje date := hoje_local(); r jsonb := '{}'::jsonb; v_gestao boolean := eh_gestao();
  v_ajuda jsonb; v_tec1 jsonb; v_quebrou jsonb; v_msg jsonb; v_mat jsonb; v_abast jsonb;
begin
  if not (v_gestao or tem_permissao('almoxarifado.ver') or tem_permissao('frota.ver')) then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;

  if v_gestao then
    -- Pedido de ajuda = contrato de hoje em IMPEDIMENTO cujo último
    -- evento para essa situação veio do CAMPO (Emanuel, 27/09).
    select coalesce(jsonb_agg(x order by x->>'desde' desc), '[]'::jsonb) into v_ajuda
      from (
        select jsonb_build_object(
                 'visita_id', v.id, 'contrato', v.contrato,
                 'servico', coalesce(ts.nome, ta.nome, 'Visita'),
                 'tecnico', t.nome, 'equipe', e.codigo,
                 'desde', ev.criado_em, 'observacao', ev.observacao) as x
          from visita v
          join lateral (
            select ve.criado_em, ve.observacao, ve.origem from visita_evento ve
             where ve.visita_id = v.id and ve.para->>'situacao' = 'COM_IMPEDIMENTO'
             order by ve.criado_em desc limit 1) ev on ev.origem = 'MOBILE'
          left join tipo_servico ts on ts.id = v.tipo_servico_id
          left join tipo_atividade ta on ta.id = v.tipo_atividade_id
          left join tecnico t on t.id = v.tecnico_responsavel_id
          left join equipe e on e.id = v.equipe_id
         where v.empresa_id = minha_empresa() and v.excluido_em is null
           and v.data_agendada = v_hoje and v.situacao = 'COM_IMPEDIMENTO'
           and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
      ) s;

    -- TEC1 perdido hoje, por técnico.
    select coalesce(jsonb_agg(jsonb_build_object('tecnico_id', tec, 'nome', nome,
                    'equipe', eq, 'qtd', qtd) order by qtd desc), '[]'::jsonb) into v_tec1
      from (
        select v.tecnico_responsavel_id tec, t.nome, e.codigo eq, count(*) qtd
          from visita v
          join tecnico t on t.id = v.tecnico_responsavel_id
          left join equipe e on e.id = t.equipe_id
         where v.empresa_id = minha_empresa() and v.excluido_em is null
           and v.data_agendada = v_hoje and v.tec1 = 'SEM_PADRAO'
           and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
         group by 1, 2, 3
      ) s;

    -- Quem mais quebrou hoje (os 5 primeiros), no escopo de quem pergunta.
    -- O escopo filtra ANTES do corte dos 5: cortar primeiro mostraria ao
    -- controlador menos gente do que ele tem.
    select coalesce(jsonb_agg(jsonb_build_object('tecnico_id', p.tec, 'nome', p.nome,
                    'equipe', p.eq, 'quebradas', p.quebradas,
                    'pontos_perdidos', p.pontos_perdidos)
                    order by p.quebradas desc, p.pontos_perdidos desc), '[]'::jsonb)
      into v_quebrou
      from (select x.tecnico_id as tec, t.nome, e.codigo as eq, x.quebradas, x.pontos_perdidos
              from producao_por_tecnico(v_hoje, v_hoje) x
              join tecnico t on t.id = x.tecnico_id
              left join equipe e on e.id = t.equipe_id
             where x.quebradas > 0
               and (eh_gestor() or t.equipe_id in (select equipes_visiveis()))
             order by x.quebradas desc, x.pontos_perdidos desc limit 5) p;

    select coalesce(jsonb_agg(jsonb_build_object('tecnico_id', c.tecnico_id, 'nome', c.nome,
                    'nao_lidas', c.nao_lidas, 'ultima_texto', c.ultima_texto,
                    'ultima_em', c.ultima_em)), '[]'::jsonb)
      into v_msg
      from conversas_do_controle() c where c.nao_lidas > 0;

    r := r || jsonb_build_object('ajuda', v_ajuda, 'tec1', v_tec1,
                                 'ritmo', ritmo_do_dia(), 'quebrou', v_quebrou,
                                 'mensagens', v_msg);
  end if;

  if tem_permissao('almoxarifado.ver') then
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'tipo', s.tipo,
                    'tecnico', t.nome, 'item', coalesce(i.nome, s.serial, s.descricao),
                    'criado_em', s.criado_em) order by s.criado_em desc), '[]'::jsonb)
      into v_mat
      from sinalizacao_material s
      join tecnico t on t.id = s.tecnico_id
      left join item_miscelanea i on i.id = s.item_id
     where s.empresa_id = minha_empresa() and s.situacao = 'ABERTA';
    r := r || jsonb_build_object('material', v_mat);
  end if;

  if tem_permissao('frota.ver') then
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'placa', v.placa,
                    'tecnico', t.nome, 'valor', a.valor, 'criado_em', a.criado_em)
                    order by a.criado_em desc), '[]'::jsonb)
      into v_abast
      from abastecimento a
      join veiculo v on v.id = a.veiculo_id
      left join tecnico t on t.id = a.tecnico_id
     where a.empresa_id = minha_empresa() and a.situacao = 'EM_ABERTO';
    r := r || jsonb_build_object('abastecimento', v_abast);
  end if;

  return r || jsonb_build_object('gerado_em', now());
end;
$fn$;
revoke all on function central_do_controle() from public, anon;
grant execute on function central_do_controle() to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 091b · o aviso aceita MATERIAL (aplicada em separado, depois do teste)
-- ---------------------------------------------------------------------------
-- O teste da 091 pegou: `aviso.tipo` é uma lista fechada (CHECK), e a
-- resposta do almoxarifado estourou 23514 na primeira recusa. A
-- conferência de restrições tem de olhar CHECK também, não só NOT NULL.
alter table aviso drop constraint aviso_tipo_check;
alter table aviso add constraint aviso_tipo_check check (tipo = any (array[
  'NOVO','SITUACAO','REABERTO','CANCELADO_OPERADORA','CHEGOU','SAIU','MATERIAL']));

-- ---------------------------------------------------------------------------
-- 091c · o painel calcula a produção UMA vez (aplicada em separado)
-- ---------------------------------------------------------------------------
-- Medido como `authenticated`: o painel levava 528 ms com 240 visitas no
-- mês — calculava a produção do mês QUATRO vezes (uma direta e três pelo
-- `ranking_tecnicos`). Agora uma, com a posição saindo da mesma conta
-- (`rank()` por pontos): 178 ms, números idênticos.
-- E `producao_por_tecnico` só chama `pontos_da_visita` para quem precisa:
-- concluída (pontos) ou quebrada (pontos perdidos).
--
-- ⚠ ESCALA: `pontos_da_visita` é por visita (~0,5 ms cada), a mesma
-- limitação de `produtividade_periodo`. Com um mês cheio (milhares de
-- visitas) o ranking passa de segundos. O remédio é uma versão em
-- conjunto do cálculo de pontos — registrado como pendência na D-167.
--
-- As versões finais de `producao_por_tecnico` e `painel_do_tecnico` estão
-- no banco (aplicadas como `091c_painel_calcula_uma_vez`); o texto acima
-- delas, nesta migration, é a primeira versão.
