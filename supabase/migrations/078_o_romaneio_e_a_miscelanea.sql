-- ============================================================
-- 078 · O romaneio e a miscelânea — fase 2 do almoxarifado
--
-- > "o almoxarife monta uma carga para o técnico (vários equipamentos +
-- >  miscelânea), fecha o documento e o técnico confirma. A devolutiva
-- >  também é um documento" — escolha do Emanuel entre três
-- > "cada item tem um saldo no almoxarifado e um saldo COM CADA TÉCNICO"
-- >  — escolha dele entre três
--
-- A fase 1 (077) trouxe a carga e disse onde NÃO se sabe onde a peça
-- está: 15.603 sem posse declarada. Esta fase dá o instrumento de
-- declarar — e de declarar com documento, não com um clique solto.
--
-- ┌─ AS DUAS METADES DO ALMOXARIFADO ────────────────────────────────┐
-- │ SERIALIZADO   a peça tem número de série, é única, e o que muda   │
-- │               é a POSSE dela (077). Um decoder não tem "saldo 3". │
-- │ MISCELÂNEA    conector, cabo, fita: não tem série, tem            │
-- │               QUANTIDADE. E o saldo é por lugar — o do            │
-- │               almoxarifado e o de cada técnico.                   │
-- │                                                                   │
-- │ São mecânicas diferentes e por isso são tabelas diferentes. O que │
-- │ as une é o ROMANEIO: um documento carrega os dois.                │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ O SALDO É DERIVADO, NÃO GUARDADO ───────────────────────────────┐
-- │ `miscelanea_movimento` é um RAZÃO: cada linha é um lançamento com │
-- │ sinal, e o saldo é a soma. Nada de coluna `saldo` mantida por     │
-- │ gatilho.                                                          │
-- │                                                                   │
-- │ O motivo está escrito em `traps.md`: cache de regra que virou     │
-- │ cadastro fica errado CALADO. Um saldo materializado que diverge   │
-- │ do razão é a mesma doença — e num almoxarifado ele diverge no dia │
-- │ em que alguém cancelar um romaneio antigo. Se um dia a soma       │
-- │ pesar, mede-se primeiro; hoje são dezenas de linhas.              │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ QUEM CONFIRMA, NESTA FASE ──────────────────────────────────────┐
-- │ O Emanuel disse "o técnico confirma". O técnico confirma pelo     │
-- │ CELULAR, e o aplicativo (`campo/`) ainda não tem essa tela.       │
-- │                                                                   │
-- │ Então nesta fase quem confirma é o ALMOXARIFE, no balcão, com o   │
-- │ técnico na frente — que é como a carga acontece de manhã. A       │
-- │ assinatura do técnico no celular é a fase 3, e o documento já     │
-- │ nasce com `confirmado_por` para receber a mão dele sem migration  │
-- │ nova.                                                             │
-- │                                                                   │
-- │ Isto é ESCOPO, não regra inventada: o fato "fulano confirmou" é   │
-- │ registrado com quem de fato clicou, nunca com quem se supõe.      │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ O QUE ESTA MIGRATION *NÃO* DECIDE ──────────────────────────────┐
-- │ Peça em PERDA ou SUCATA no Atlas PODE ser entregue ao técnico: o  │
-- │ banco aceita e a tela AVISA em vermelho. Bloquear seria inventar  │
-- │ política de patrimônio que ninguém combinou — e 48,9% da carga    │
-- │ está em PERDA, então bloquear travaria metade do estoque.         │
-- │                                                                   │
-- │ Saldo NEGATIVO de miscelânea, esse sim, é recusado: entregar 10   │
-- │ conectores de um saldo de 3 não é política, é conta errada.       │
-- └───────────────────────────────────────────────────────────────────┘
-- ============================================================

-- ------------------------------------------------------------
-- A · O item de miscelânea
-- ------------------------------------------------------------
create table if not exists item_miscelanea (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresa(id),
  codigo     text not null,
  nome       text not null,
  -- UN, M, KG, PC… texto livre de propósito: a unidade vem da nota do
  -- fornecedor e inventar um enum aqui viraria cadastro travado.
  unidade    text not null default 'UN',
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  criado_por uuid references perfil(id)
);
create unique index if not exists item_miscelanea_codigo_uk
  on item_miscelanea (empresa_id, upper(codigo));

-- ------------------------------------------------------------
-- B · O romaneio: o documento
-- ------------------------------------------------------------
create table if not exists romaneio (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id),
  numero      int not null,
  tipo        text not null check (tipo in ('ENTREGA', 'DEVOLUCAO')),
  tecnico_id  uuid not null references tecnico(id),
  situacao    text not null default 'ABERTO'
              check (situacao in ('ABERTO', 'CONFIRMADO', 'CANCELADO')),
  observacao  text,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references perfil(id),
  confirmado_em  timestamptz,
  confirmado_por uuid references perfil(id),
  cancelado_em   timestamptz,
  cancelado_por  uuid references perfil(id),
  cancelado_motivo text
);
create unique index if not exists romaneio_numero_uk on romaneio (empresa_id, numero);
create index if not exists romaneio_tecnico_ix on romaneio (empresa_id, tecnico_id, situacao);

create table if not exists romaneio_item (
  id            uuid primary key default gen_random_uuid(),
  romaneio_id   uuid not null references romaneio(id) on delete cascade,
  -- Um OU outro, nunca os dois: serializado tem peça, miscelânea tem
  -- item e quantidade.
  equipamento_id uuid references equipamento(id),
  item_id        uuid references item_miscelanea(id),
  quantidade     numeric(14,3) not null default 1,
  criado_em      timestamptz not null default now(),
  criado_por     uuid references perfil(id),
  constraint romaneio_item_um_ou_outro check (
    (equipamento_id is not null and item_id is null and quantidade = 1)
    or (equipamento_id is null and item_id is not null and quantidade > 0)
  )
);
-- A mesma peça não entra duas vezes no mesmo documento.
create unique index if not exists romaneio_item_equip_uk
  on romaneio_item (romaneio_id, equipamento_id) where equipamento_id is not null;
create unique index if not exists romaneio_item_misc_uk
  on romaneio_item (romaneio_id, item_id) where item_id is not null;
-- Uma peça só pode estar em UM romaneio aberto por vez. Índice parcial
-- não resolve (depende de outra tabela), então a guarda está na RPC.
create index if not exists romaneio_item_equip_ix on romaneio_item (equipamento_id);

-- ------------------------------------------------------------
-- C · O razão da miscelânea
-- ------------------------------------------------------------
create table if not exists miscelanea_movimento (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id),
  item_id     uuid not null references item_miscelanea(id),
  -- NULO = almoxarifado. Preenchido = a mão daquele técnico.
  tecnico_id  uuid references tecnico(id),
  -- Positivo entra no lugar, negativo sai dele.
  quantidade  numeric(14,3) not null check (quantidade <> 0),
  tipo        text not null check (tipo in
              ('ENTRADA', 'ENTREGA', 'DEVOLUCAO', 'AJUSTE')),
  romaneio_id uuid references romaneio(id),
  motivo      text,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references perfil(id)
);
create index if not exists miscelanea_mov_ix
  on miscelanea_movimento (empresa_id, item_id, tecnico_id);

comment on table miscelanea_movimento is
  'RAZAO: o saldo e a SOMA daqui, nunca uma coluna guardada. Cache de '
  'saldo diverge calado no dia em que alguem cancela um romaneio antigo.';

-- ------------------------------------------------------------
-- D · RLS
-- ------------------------------------------------------------
alter table item_miscelanea      enable row level security;
alter table romaneio             enable row level security;
alter table romaneio_item        enable row level security;
alter table miscelanea_movimento enable row level security;

-- Leitura para quem tem a chave do modulo. `(select ...)` obrigatorio:
-- funcao solta na policy e chamada por linha (D-118).
drop policy if exists item_miscelanea_leitura on item_miscelanea;
create policy item_miscelanea_leitura on item_miscelanea for select
  to authenticated using (
    empresa_id = (select minha_empresa())
    and (select tem_permissao('almoxarifado.ver')));

drop policy if exists romaneio_leitura on romaneio;
create policy romaneio_leitura on romaneio for select
  to authenticated using (
    empresa_id = (select minha_empresa())
    and ((select tem_permissao('almoxarifado.ver'))
         -- O tecnico enxerga o QUE E DELE, mesmo sem a chave do modulo:
         -- e o comprovante do que ele recebeu e devolveu.
         or tecnico_id = (select meu_tecnico_id())));

drop policy if exists romaneio_item_leitura on romaneio_item;
create policy romaneio_item_leitura on romaneio_item for select
  to authenticated using (
    romaneio_id in (select r.id from romaneio r));

drop policy if exists miscelanea_movimento_leitura on miscelanea_movimento;
create policy miscelanea_movimento_leitura on miscelanea_movimento for select
  to authenticated using (
    empresa_id = (select minha_empresa())
    and (select tem_permissao('almoxarifado.ver')));

-- Escrita: so por RPC. Nenhuma policy de insert/update/delete.

-- ------------------------------------------------------------
-- E · A guarda comum
-- ------------------------------------------------------------
create or replace function almox_pode_mexer()
returns void language plpgsql stable security definer
set search_path to 'public' as $fn$
begin
  if not (eh_gestor() or tem_papel('ALMOXARIFE')) then
    raise exception 'Sem permissao no almoxarifado.' using errcode = '42501';
  end if;
  if not tem_permissao('almoxarifado.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Declarar a posse".'
      using errcode = '42501';
  end if;
end;
$fn$;
revoke all on function almox_pode_mexer() from public, anon;
grant execute on function almox_pode_mexer() to authenticated;

-- ------------------------------------------------------------
-- F · Cadastro de item de miscelânea
-- ------------------------------------------------------------
create or replace function salvar_item_miscelanea(
  p_id uuid, p_codigo text, p_nome text, p_unidade text, p_ativo boolean)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_id uuid;
begin
  perform almox_pode_mexer();
  if btrim(coalesce(p_codigo,'')) = '' or btrim(coalesce(p_nome,'')) = '' then
    raise exception 'Codigo e nome sao obrigatorios.' using errcode = '23514';
  end if;

  if p_id is null then
    insert into item_miscelanea (empresa_id, codigo, nome, unidade, ativo, criado_por)
    values (minha_empresa(), upper(btrim(p_codigo)), btrim(p_nome),
            upper(coalesce(nullif(btrim(p_unidade),''),'UN')),
            coalesce(p_ativo, true), auth.uid())
    returning id into v_id;
  else
    update item_miscelanea
       set codigo = upper(btrim(p_codigo)), nome = btrim(p_nome),
           unidade = upper(coalesce(nullif(btrim(p_unidade),''),'UN')),
           ativo = coalesce(p_ativo, true)
     where id = p_id and empresa_id = minha_empresa()
    returning id into v_id;
    if v_id is null then
      raise exception 'Item nao encontrado.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$fn$;
revoke all on function salvar_item_miscelanea(uuid, text, text, text, boolean)
  from public, anon;
grant execute on function salvar_item_miscelanea(uuid, text, text, text, boolean)
  to authenticated;

-- Entrada no almoxarifado (compra, recebimento, acerto de inventario).
-- Sem ela o saldo nasce negativo na primeira entrega -- e conta que
-- comeca errada nunca mais fecha.
create or replace function miscelanea_entrada(
  p_item uuid, p_quantidade numeric, p_motivo text, p_tipo text default 'ENTRADA')
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_id uuid;
begin
  perform almox_pode_mexer();
  if p_tipo not in ('ENTRADA', 'AJUSTE') then
    raise exception 'Tipo deve ser ENTRADA ou AJUSTE.' using errcode = '23514';
  end if;
  if p_quantidade = 0 or p_quantidade is null then
    raise exception 'Quantidade tem de ser diferente de zero.' using errcode = '23514';
  end if;
  -- AJUSTE aceita negativo (quebra, perda no deposito); ENTRADA nao.
  if p_tipo = 'ENTRADA' and p_quantidade < 0 then
    raise exception 'Entrada nao pode ser negativa -- use AJUSTE com motivo.'
      using errcode = '23514';
  end if;
  if p_tipo = 'AJUSTE' and btrim(coalesce(p_motivo,'')) = '' then
    raise exception 'Ajuste exige motivo.' using errcode = '23514';
  end if;

  insert into miscelanea_movimento (empresa_id, item_id, tecnico_id, quantidade,
                                    tipo, motivo, criado_por)
  values (minha_empresa(), p_item, null, p_quantidade, p_tipo,
          nullif(btrim(coalesce(p_motivo,'')),''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function miscelanea_entrada(uuid, numeric, text, text) from public, anon;
grant execute on function miscelanea_entrada(uuid, numeric, text, text) to authenticated;

-- ------------------------------------------------------------
-- G · O romaneio
-- ------------------------------------------------------------
create or replace function abrir_romaneio(
  p_tipo text, p_tecnico uuid, p_observacao text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_id uuid; v_num int; v_emp uuid;
begin
  perform almox_pode_mexer();
  if p_tipo not in ('ENTREGA', 'DEVOLUCAO') then
    raise exception 'Tipo deve ser ENTREGA ou DEVOLUCAO.' using errcode = '23514';
  end if;
  v_emp := minha_empresa();
  if not exists (select 1 from tecnico where id = p_tecnico and empresa_id = v_emp) then
    raise exception 'Tecnico nao encontrado.' using errcode = 'P0002';
  end if;

  -- Numeracao por empresa. `max + 1` sob o unique: se dois abrirem no
  -- mesmo instante, o segundo leva erro de chave e tenta de novo -- e
  -- melhor do que dois romaneios com o mesmo numero.
  select coalesce(max(numero), 0) + 1 into v_num from romaneio where empresa_id = v_emp;

  insert into romaneio (empresa_id, numero, tipo, tecnico_id, observacao, criado_por)
  values (v_emp, v_num, p_tipo, p_tecnico,
          nullif(btrim(coalesce(p_observacao,'')),''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function abrir_romaneio(text, uuid, text) from public, anon;
grant execute on function abrir_romaneio(text, uuid, text) to authenticated;

-- Acrescenta uma PEÇA ao documento, pelo número de série.
create or replace function romaneio_por_serial(p_romaneio uuid, p_serial text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_r romaneio%rowtype; v_e equipamento%rowtype; v_serial text; v_outro int;
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

  -- A peça não pode estar pendurada em outro documento aberto.
  select count(*) into v_outro from romaneio_item ri
    join romaneio r on r.id = ri.romaneio_id
   where ri.equipamento_id = v_e.id and r.situacao = 'ABERTO' and r.id <> p_romaneio;
  if v_outro > 0 then
    raise exception 'A peca % ja esta em outro romaneio aberto.', v_serial
      using errcode = '23505';
  end if;

  -- ENTREGA: tem de estar no almoxarifado (ou sem posse declarada — aí
  -- quem pega da prateleira é gente, e a entrega É a declaração).
  -- DEVOLUCAO: tem de estar com ESTE tecnico.
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

  return jsonb_build_object('serial', v_e.serial, 'tipo', v_e.tipo,
                            'modelo', v_e.modelo, 'estado_atlas', v_e.estado_atlas,
                            -- A tela avisa; o banco nao bloqueia (ver cabecalho).
                            'alerta', case when v_e.estado_atlas in
                                        ('PERDA','SUCATA','INUTILIZADO','COM DEFEITO')
                                      then v_e.estado_atlas end);
end;
$fn$;
revoke all on function romaneio_por_serial(uuid, text) from public, anon;
grant execute on function romaneio_por_serial(uuid, text) to authenticated;

create or replace function romaneio_por_item(
  p_romaneio uuid, p_item uuid, p_quantidade numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_r romaneio%rowtype; v_id uuid;
begin
  perform almox_pode_mexer();
  select * into v_r from romaneio where id = p_romaneio and empresa_id = minha_empresa();
  if not found then raise exception 'Romaneio nao encontrado.' using errcode='P0002'; end if;
  if v_r.situacao <> 'ABERTO' then
    raise exception 'Romaneio % ja esta %.', v_r.numero, lower(v_r.situacao)
      using errcode = '23514';
  end if;
  if coalesce(p_quantidade, 0) <= 0 then
    raise exception 'Quantidade tem de ser maior que zero.' using errcode = '23514';
  end if;

  insert into romaneio_item (romaneio_id, item_id, quantidade, criado_por)
  values (p_romaneio, p_item, p_quantidade, auth.uid())
  on conflict (romaneio_id, item_id) where item_id is not null
  do update set quantidade = romaneio_item.quantidade + excluded.quantidade
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function romaneio_por_item(uuid, uuid, numeric) from public, anon;
grant execute on function romaneio_por_item(uuid, uuid, numeric) to authenticated;

create or replace function romaneio_tirar_item(p_item_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare v_sit text;
begin
  perform almox_pode_mexer();
  select r.situacao into v_sit from romaneio_item ri
    join romaneio r on r.id = ri.romaneio_id
   where ri.id = p_item_id and r.empresa_id = minha_empresa();
  if not found then raise exception 'Item nao encontrado.' using errcode='P0002'; end if;
  if v_sit <> 'ABERTO' then
    raise exception 'Romaneio ja esta %. Item de documento fechado nao sai.',
      lower(v_sit) using errcode = '23514';
  end if;
  delete from romaneio_item where id = p_item_id;
end;
$fn$;
revoke all on function romaneio_tirar_item(uuid) from public, anon;
grant execute on function romaneio_tirar_item(uuid) to authenticated;

-- ------------------------------------------------------------
-- H · Confirmar: é AQUI que a posse e o saldo se movem
-- ------------------------------------------------------------
create or replace function confirmar_romaneio(p_romaneio uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_r romaneio%rowtype; v_destino text; v_tec uuid;
  v_pecas int := 0; v_itens int := 0; v_saldo numeric; v_i record;
begin
  perform almox_pode_mexer();
  select * into v_r from romaneio where id = p_romaneio and empresa_id = minha_empresa();
  if not found then raise exception 'Romaneio nao encontrado.' using errcode='P0002'; end if;
  if v_r.situacao <> 'ABERTO' then
    raise exception 'Romaneio % ja esta %.', v_r.numero, lower(v_r.situacao)
      using errcode = '23514';
  end if;
  if not exists (select 1 from romaneio_item where romaneio_id = p_romaneio) then
    raise exception 'Romaneio vazio nao se confirma.' using errcode = '23514';
  end if;

  if v_r.tipo = 'ENTREGA' then v_destino := 'COM_TECNICO'; v_tec := v_r.tecnico_id;
  else                         v_destino := 'NO_ALMOXARIFADO'; v_tec := null;
  end if;

  -- 1) A miscelanea PRIMEIRO, porque ela pode recusar por saldo -- e
  --    recusar depois de ja ter mexido na posse deixaria meia verdade.
  for v_i in select ri.item_id, ri.quantidade from romaneio_item ri
              where ri.romaneio_id = p_romaneio and ri.item_id is not null loop
    if v_r.tipo = 'ENTREGA' then
      select coalesce(sum(quantidade), 0) into v_saldo from miscelanea_movimento
       where item_id = v_i.item_id and tecnico_id is null
         and empresa_id = v_r.empresa_id;
      if v_saldo < v_i.quantidade then
        raise exception 'Saldo insuficiente de % no almoxarifado: tem %, pediu %.',
          (select nome from item_miscelanea where id = v_i.item_id),
          v_saldo, v_i.quantidade using errcode = '23514';
      end if;
    else
      select coalesce(sum(quantidade), 0) into v_saldo from miscelanea_movimento
       where item_id = v_i.item_id and tecnico_id = v_r.tecnico_id
         and empresa_id = v_r.empresa_id;
      if v_saldo < v_i.quantidade then
        raise exception 'O tecnico tem % de %, nao da para devolver %.',
          v_saldo, (select nome from item_miscelanea where id = v_i.item_id),
          v_i.quantidade using errcode = '23514';
      end if;
    end if;

    -- Duas pernas: sai de um lugar, entra no outro. O razao fecha.
    insert into miscelanea_movimento (empresa_id, item_id, tecnico_id, quantidade,
                                      tipo, romaneio_id, criado_por)
    values
      (v_r.empresa_id, v_i.item_id,
       case when v_r.tipo = 'ENTREGA' then null else v_r.tecnico_id end,
       -v_i.quantidade, v_r.tipo, p_romaneio, auth.uid()),
      (v_r.empresa_id, v_i.item_id,
       case when v_r.tipo = 'ENTREGA' then v_r.tecnico_id else null end,
       v_i.quantidade, v_r.tipo, p_romaneio, auth.uid());
    v_itens := v_itens + 1;
  end loop;

  -- 2) As pecas serializadas.
  update equipamento e
     set posse = v_destino,
         posse_tecnico_id = v_tec,
         posse_em = now(),
         posse_por = auth.uid(),
         posse_motivo = 'romaneio ' || v_r.numero,
         atualizado_em = now()
    from romaneio_item ri
   where ri.romaneio_id = p_romaneio and ri.equipamento_id = e.id;
  get diagnostics v_pecas = row_count;

  update romaneio set situacao = 'CONFIRMADO', confirmado_em = now(),
                      confirmado_por = auth.uid()
   where id = p_romaneio;

  return jsonb_build_object('numero', v_r.numero, 'tipo', v_r.tipo,
                            'pecas', v_pecas, 'itens', v_itens,
                            'posse', v_destino);
end;
$fn$;
revoke all on function confirmar_romaneio(uuid) from public, anon;
grant execute on function confirmar_romaneio(uuid) to authenticated;

-- Cancelar so vale enquanto ABERTO. Documento confirmado nao se desfaz:
-- a correcao e um romaneio no sentido contrario, que deixa rastro dos
-- dois lados (mesma logica da baixa que nao se apaga -- D-030).
create or replace function cancelar_romaneio(p_romaneio uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare v_sit text;
begin
  perform almox_pode_mexer();
  select situacao into v_sit from romaneio
   where id = p_romaneio and empresa_id = minha_empresa();
  if not found then raise exception 'Romaneio nao encontrado.' using errcode='P0002'; end if;
  if v_sit = 'CONFIRMADO' then
    raise exception 'Romaneio confirmado nao se cancela. Faca o documento inverso.'
      using errcode = '23514';
  end if;
  if v_sit = 'CANCELADO' then return; end if;
  if btrim(coalesce(p_motivo,'')) = '' then
    raise exception 'Cancelamento exige motivo.' using errcode = '23514';
  end if;

  update romaneio set situacao = 'CANCELADO', cancelado_em = now(),
                      cancelado_por = auth.uid(), cancelado_motivo = btrim(p_motivo)
   where id = p_romaneio;
end;
$fn$;
revoke all on function cancelar_romaneio(uuid, text) from public, anon;
grant execute on function cancelar_romaneio(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- I · Os saldos, somados do razão
-- ------------------------------------------------------------
create or replace function miscelanea_saldos()
returns table (item_id uuid, codigo text, nome text, unidade text,
               no_almoxarifado numeric, com_tecnicos numeric,
               por_tecnico jsonb)
language sql stable security definer set search_path to 'public' as $fn$
  with permitido as (
    select eh_gestor() or tem_permissao('almoxarifado.ver') as ok
  ),
  mov as materialized (
    select m.* from miscelanea_movimento m, permitido p
     where p.ok and m.empresa_id = minha_empresa()
  )
  select i.id, i.codigo, i.nome, i.unidade,
         coalesce((select sum(quantidade) from mov
                    where item_id = i.id and tecnico_id is null), 0),
         coalesce((select sum(quantidade) from mov
                    where item_id = i.id and tecnico_id is not null), 0),
         coalesce((select jsonb_agg(jsonb_build_object(
                            'tecnico', t.nome, 'matricula', t.matricula,
                            'qtd', x.q) order by x.q desc)
                     from (select tecnico_id, sum(quantidade) as q from mov
                            where item_id = i.id and tecnico_id is not null
                            group by tecnico_id having sum(quantidade) <> 0) x
                     join tecnico t on t.id = x.tecnico_id), '[]'::jsonb)
    from item_miscelanea i, permitido p
   where p.ok and i.empresa_id = minha_empresa() and i.ativo
   order by i.nome;
$fn$;
revoke all on function miscelanea_saldos() from public, anon;
grant execute on function miscelanea_saldos() to authenticated;

notify pgrst, 'reload schema';
