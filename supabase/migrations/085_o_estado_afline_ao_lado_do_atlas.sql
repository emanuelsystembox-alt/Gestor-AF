-- ============================================================
-- 085 - O estado AFLINE, ao lado do estado do Atlas
--
-- > "olhando estoque, nao sei como passar o tecnico? por exemplo o
-- >  perda eu achei, como mudar o status para inicializado e transferir
-- >  para o tecnico? para ele inserir no contrato quando ele for usar?"
-- >                                                 -- Emanuel, 23/09
--
-- Escolha dele entre tres (D-160): "estado nosso ao lado". Recusadas:
--   * so a posse, Atlas intocado -- a peca achada continuaria gritando
--     PERDA em vermelho em todo romaneio, sem ter como dizer "achei";
--   * editar `estado_atlas` direto -- a proxima carga do Atlas desfaz
--     calado, e o sistema passa a afirmar o que a CLARO nao disse.
--
-- ┌─ dois eixos viram tres, e nenhum apaga o outro ──────────────────┐
-- │ estado_atlas   o que a CLARO diz      so a importacao grava       │
-- │ estado_afline  o que NOS afirmamos    so esta RPC grava, c/ motivo│
-- │ posse          onde esta, para nos    romaneio e campo (078/079)  │
-- │                                                                   │
-- │ NULO em `estado_afline` = ninguem daqui declarou; vale o Atlas.   │
-- │ A importacao grava colunas NOMEADAS (077), entao nao toca aqui:   │
-- │ quando a CLARO corrigir o Atlas, os dois passam a concordar, e a  │
-- │ tela mostra que concordam em vez de apagar a nossa afirmacao.     │
-- └───────────────────────────────────────────────────────────────────┘
--
-- O VOCABULARIO e o do proprio Atlas: o estado declarado tem de ser um
-- que a carga ja trouxe (INICIALIZADO, PERDA, SUSPEITO...). Inventar
-- "RECUPERADA" seria criar categoria de patrimonio que ninguem combinou
-- com a CLARO.
--
-- Todo lancamento fica no historico `equipamento_estado_evento`, com o
-- que o Atlas dizia naquele instante -- a divergencia e o dado que o
-- almoxarife leva para a CLARO.
--
-- O romaneio passa a avisar pelo estado EFETIVO: peca declarada
-- INICIALIZADO por nos nao grita PERDA. Continua sem bloquear (D-154).
-- ============================================================

-- ------------------------------------------------------------
-- A · As colunas
-- ------------------------------------------------------------
alter table equipamento
  add column if not exists estado_afline        text,
  add column if not exists estado_afline_em     timestamptz,
  add column if not exists estado_afline_por    uuid references perfil(id),
  add column if not exists estado_afline_motivo text;

comment on column equipamento.estado_afline is
  'Estado AFIRMADO pela AFLINE, ao lado do estado_atlas (D-160). NULO = '
  'ninguem declarou; vale o Atlas. Gravado so por declarar_estado_equipamento.';

-- ------------------------------------------------------------
-- B · O historico
-- ------------------------------------------------------------
create table if not exists equipamento_estado_evento (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresa(id),
  equipamento_id  uuid not null references equipamento(id),
  -- O que o Atlas dizia NAQUELE instante: a carga seguinte muda a
  -- coluna, e sem isto o historico perde a divergencia que o justificou.
  estado_atlas    text,
  de              text,     -- estado_afline antes (NULO = valia o Atlas)
  para            text,     -- estado_afline depois (NULO = volta ao Atlas)
  motivo          text not null,
  criado_em       timestamptz not null default now(),
  criado_por      uuid references perfil(id)
);
create index if not exists equipamento_estado_evento_equip_idx
  on equipamento_estado_evento (equipamento_id, criado_em desc);

alter table equipamento_estado_evento enable row level security;

-- Le quem le o estoque -- a mesma regra de `equipamento_leitura`, com as
-- funcoes de escopo em (select), uma chamada por consulta (D-118).
-- Sem policy de escrita: quem grava e a RPC abaixo.
drop policy if exists equipamento_estado_evento_leitura on equipamento_estado_evento;
create policy equipamento_estado_evento_leitura on equipamento_estado_evento
  for select to authenticated
  using (empresa_id = (select minha_empresa())
         and (select tem_permissao('almoxarifado.ver')));

-- ------------------------------------------------------------
-- C · Declarar
-- ------------------------------------------------------------
-- `p_estado` NULO ou vazio desfaz a declaracao: volta a valer o Atlas.
-- Motivo sempre obrigatorio -- inclusive para desfazer.
create or replace function declarar_estado_equipamento(
  p_equipamento uuid, p_estado text, p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_e equipamento%rowtype; v_estado text; v_motivo text;
begin
  perform almox_pode_mexer();

  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'Diga o motivo: e ele que explica a divergencia com o Atlas.'
      using errcode = '23514';
  end if;

  select * into v_e from equipamento
   where id = p_equipamento and empresa_id = minha_empresa()
   for update;
  if not found then
    raise exception 'Equipamento nao encontrado.' using errcode = 'P0002';
  end if;

  v_estado := nullif(upper(btrim(coalesce(p_estado, ''))), '');
  if v_estado is not null and not exists (
       select 1 from equipamento x
        where x.empresa_id = v_e.empresa_id and x.estado_atlas = v_estado) then
    raise exception 'Estado "%" nao existe na carga do Atlas. Use um que o Atlas usa.',
      v_estado using errcode = '23514';
  end if;

  if v_estado is not distinct from v_e.estado_afline then
    return jsonb_build_object('serial', v_e.serial, 'estado_afline', v_estado,
                              'mudou', false);
  end if;

  update equipamento
     set estado_afline        = v_estado,
         estado_afline_em     = case when v_estado is null then null else now() end,
         estado_afline_por    = case when v_estado is null then null else auth.uid() end,
         estado_afline_motivo = case when v_estado is null then null else v_motivo end,
         atualizado_em        = now()
   where id = v_e.id;

  insert into equipamento_estado_evento
    (empresa_id, equipamento_id, estado_atlas, de, para, motivo, criado_por)
  values (v_e.empresa_id, v_e.id, v_e.estado_atlas, v_e.estado_afline, v_estado,
          v_motivo, auth.uid());

  return jsonb_build_object('serial', v_e.serial, 'estado_atlas', v_e.estado_atlas,
                            'estado_afline', v_estado, 'mudou', true);
end;
$fn$;
revoke all on function declarar_estado_equipamento(uuid, text, text) from public, anon;
grant execute on function declarar_estado_equipamento(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- D · O romaneio avisa pelo estado EFETIVO
-- ------------------------------------------------------------
-- Igual a versao viva (078), mudando so o `alerta` e devolvendo o
-- estado AFLINE junto. `create or replace` mantem a ACL.
create or replace function romaneio_por_serial(p_romaneio uuid, p_serial text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_r romaneio%rowtype; v_e equipamento%rowtype; v_serial text; v_outro int;
  v_efetivo text;
begin
  perform almox_pode_mexer();
  select * into v_r from romaneio where id = p_romaneio and empresa_id = minha_empresa();
  if not found then raise exception 'Romaneio nao encontrado.' using errcode='P0002'; end if;
  if v_r.situacao <> 'ABERTO' then
    raise exception 'Romaneio % ja esta %.', v_r.numero, lower(v_r.situacao)
      using errcode = '23514';
  end if;

  v_serial := upper(regexp_replace(coalesce(p_serial,''), '\s', '', 'g'));
  select * into v_e from equipamento
   where empresa_id = v_r.empresa_id and serial = v_serial;
  if not found then
    raise exception 'Serial % nao esta na carga. Importe a carga do Atlas ou confira o numero.',
      v_serial using errcode = 'P0002';
  end if;

  select count(*) into v_outro from romaneio_item ri
    join romaneio r on r.id = ri.romaneio_id
   where ri.equipamento_id = v_e.id and r.situacao = 'ABERTO' and r.id <> p_romaneio;
  if v_outro > 0 then
    raise exception 'A peca % ja esta em outro romaneio aberto.', v_serial
      using errcode = '23505';
  end if;

  if v_r.tipo = 'ENTREGA' and v_e.posse is not null
     and v_e.posse <> 'NO_ALMOXARIFADO' then
    raise exception 'A peca % nao esta no almoxarifado (esta como %).',
      v_serial, v_e.posse using errcode = '23514';
  end if;
  if v_r.tipo = 'DEVOLUCAO'
     and (v_e.posse is distinct from 'COM_TECNICO'
          or v_e.posse_tecnico_id is distinct from v_r.tecnico_id) then
    raise exception 'A peca % nao esta com este tecnico.', v_serial
      using errcode = '23514';
  end if;

  insert into romaneio_item (romaneio_id, equipamento_id, quantidade, criado_por)
  values (p_romaneio, v_e.id, 1, auth.uid())
  on conflict do nothing;

  -- 085: a nossa afirmacao, quando existe, e a que vale para o aviso.
  v_efetivo := coalesce(v_e.estado_afline, v_e.estado_atlas);
  return jsonb_build_object('serial', v_e.serial, 'tipo', v_e.tipo,
                            'modelo', v_e.modelo, 'estado_atlas', v_e.estado_atlas,
                            'estado_afline', v_e.estado_afline,
                            -- A tela avisa; o banco nao bloqueia (D-154).
                            'alerta', case when v_efetivo in
                                        ('PERDA','SUCATA','INUTILIZADO','COM DEFEITO')
                                      then v_efetivo end);
end;
$fn$;

-- ------------------------------------------------------------
-- E · A posicao conta quantas o Atlas e nos dizemos diferente
-- ------------------------------------------------------------
create or replace function estoque_posicao()
returns jsonb language sql stable security definer set search_path to 'public' as $fn$
  with permitido as (
    select eh_gestor() or tem_permissao('almoxarifado.ver') as ok
  ),
  -- `materialized` e o que esta NO BANCO (o arquivo 077 nao tem): a
  -- versao viva e a que vale, e esta migration parte dela.
  base as materialized (
    select e.* from equipamento e, permitido p
     where p.ok and e.empresa_id = minha_empresa()
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'sem_posse', (select count(*) from base where posse is null),
    -- 085: quantas tem estado declarado por nos, e quantas DIVERGEM do
    -- Atlas -- esta e a lista que o almoxarife leva para a CLARO.
    'com_estado_afline', (select count(*) from base where estado_afline is not null),
    'divergem_do_atlas', (select count(*) from base
                           where estado_afline is not null
                             and estado_afline is distinct from estado_atlas),
    'por_estado', coalesce((
      select jsonb_agg(jsonb_build_object('estado', x.estado, 'qtd', x.n)
                       order by x.n desc)
        from (select coalesce(estado_atlas, '(sem estado)') as estado,
                     count(*) as n from base group by 1) x), '[]'::jsonb),
    'por_tipo', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', x.tipo, 'qtd', x.n)
                       order by x.n desc)
        from (select coalesce(tipo, '(sem tipo)') as tipo,
                     count(*) as n from base group by 1) x), '[]'::jsonb),
    'por_posse', coalesce((
      select jsonb_agg(jsonb_build_object('posse', x.posse, 'qtd', x.n)
                       order by x.n desc)
        from (select posse, count(*) as n from base group by 1) x), '[]'::jsonb),
    'por_modelo', coalesce((
      select jsonb_agg(jsonb_build_object('modelo', x.modelo, 'tipo', x.tipo,
                                          'qtd', x.n) order by x.n desc)
        from (select coalesce(modelo,'(sem modelo)') as modelo,
                     coalesce(tipo,'(sem tipo)') as tipo, count(*) as n
                from base group by 1, 2 order by n desc limit 25) x), '[]'::jsonb),
    'ultima_importacao', (
      select jsonb_build_object('em', i.criado_em, 'arquivo', i.arquivo,
                                'linhas', i.linhas, 'criados', i.criados,
                                'atualizados', i.atualizados)
        from estoque_importacao i
       where i.empresa_id = minha_empresa()
       order by i.criado_em desc limit 1)
  );
$fn$;

revoke all on function estoque_posicao() from public, anon;
grant execute on function estoque_posicao() to authenticated;

notify pgrst, 'reload schema';
