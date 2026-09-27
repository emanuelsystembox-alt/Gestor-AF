-- ============================================================================
-- 087 · As regras do estoque do concorrente, do jeito que a AFLINE usa lá
-- ============================================================================
--
-- > "pode seguir com a regra da concorrente"  — Emanuel, 26/09
--
-- Resposta às seis perguntas do D-162. "A regra da concorrente" foi lida
-- no PRÓPRIO Alfa Gestor da AFLINE, e não imaginada: onde a regra tem um
-- parâmetro, o valor é o que está configurado lá hoje. Onde o dado disse
-- que a AFLINE não usa, não entra. Medido em 26/09 (últimos 30 dias,
-- 8.865 documentos de movimentação):
--
--   Com Técnico - Inicializado   1.643   (entregas)
--   Com Técnico - Retirado       2.112   (retirado do cliente)
--   Em Estoque  - Retirada         739   (devolveu o retirado)
--   Em Estoque  - Inicializado     407   (devolveu peça boa)
--   Em Estoque  - Com Defeito RNC    0
--   ACEITE DIGITAL - AGUARDANDO      0
--   Com Técnico - Proc. Cobrança     0   (termo de desconto)
--   endereçamentos cadastrados       0
--   prazo da carga (diasLimite)      0   em 10 de 10 equipes consultadas,
--                                        inclusive uma com peça de 233 dias
--
-- O que entra:
--   A · prazo da carga — parâmetro `carga_dias_limite`, nasce em 0 (desligado)
--   B · a condição da peça (inicializado / retirado / com defeito), que a
--       devolutiva declara e o campo carimba no RETIRADO
--   C · transferência técnico → técnico, sem passar pelo balcão
--   D · o aceite registra COMO foi confirmado (aparelho, senha, balcão)
--
-- O que NÃO entra, e por quê: termo de desconto (0 uso e sem tabela de
-- valor por modelo) e endereçamento (0 cadastrado). Ver D-163.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 087-A · O prazo da carga
-- ---------------------------------------------------------------------------
-- No concorrente: "<equipe> não pode receber equipamentos, pois existem N
-- equipamento(s) em sua carga que ainda não foram utilizados ou devolvidos
-- com mais de D dias". D = 0 desliga (`isDiasLimit = diasLimite === 0`).
insert into parametro (empresa_id, chave, valor, descricao)
select e.id, 'carga_dias_limite', '0'::jsonb,
       'Dias que uma peca pode ficar na mao do tecnico sem ser instalada ou '
       || 'devolvida. Passou disso, ele nao recebe peca nova ate acertar. '
       || '0 desliga (e o valor que a AFLINE usa no sistema anterior).'
  from empresa e
on conflict do nothing;

-- Quantas peças o técnico tem PARADAS além do prazo. `dias` no dia local
-- (hoje_local), como `minha_carga` — current_date é UTC.
--
-- Duas funções: a CONTA, interna, que o lançamento chama sem depender de
-- quem pergunta (o almoxarife que lança pode ter `editar` sem `ver`); e a
-- CONSULTA, que a tela chama e confere permissão.
create or replace function carga_vencida_de(p_tecnico uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare v_lim int; v_n int := 0; v_max int := 0; v_emp uuid;
begin
  select empresa_id into v_emp from tecnico where id = p_tecnico;
  select coalesce((valor)::int, 0) into v_lim from parametro
   where empresa_id = v_emp and chave = 'carga_dias_limite';
  v_lim := coalesce(v_lim, 0);
  if v_lim > 0 then
    select count(*),
           coalesce(max(hoje_local() - (posse_em at time zone 'America/Manaus')::date), 0)
      into v_n, v_max
      from equipamento
     where empresa_id = v_emp
       and posse = 'COM_TECNICO' and posse_tecnico_id = p_tecnico
       and hoje_local() - (posse_em at time zone 'America/Manaus')::date > v_lim;
  end if;
  return jsonb_build_object('limite', v_lim, 'vencidos', v_n, 'mais_antiga', v_max);
end;
$fn$;
-- Interna: nem o authenticated chama direto.
revoke all on function carga_vencida_de(uuid) from public, anon, authenticated;

create or replace function carga_vencida(p_tecnico uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
begin
  -- Quem pode perguntar: o almoxarifado, ou o próprio técnico.
  if p_tecnico is distinct from meu_tecnico_id()
     and not (tem_permissao('almoxarifado.ver') or tem_permissao('almoxarifado.editar')) then
    raise exception 'Sem permissao no almoxarifado.' using errcode = '42501';
  end if;
  if not exists (select 1 from tecnico where id = p_tecnico and empresa_id = minha_empresa()) then
    raise exception 'Tecnico nao encontrado.' using errcode = 'P0002';
  end if;
  return carga_vencida_de(p_tecnico);
end;
$fn$;
revoke all on function carga_vencida(uuid) from public, anon;
grant execute on function carga_vencida(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 087-B · A condição da peça
-- ---------------------------------------------------------------------------
-- O concorrente junta LUGAR e CONDIÇÃO numa palavra só ("Em Estoque -
-- Retirada", "Com Técnico - Inicializado"). Aqui o lugar já é `posse`; a
-- condição é esta coluna. Não é o estado do Atlas (esse é da CLARO, e o
-- `estado_afline` é a nossa correção DELE, no vocabulário dele — D-160):
-- é a leitura operacional do almoxarifado, que é o que o concorrente
-- chama de situação. Nula = ninguém declarou (D-117).
alter table equipamento
  add column if not exists condicao text
    check (condicao in ('INICIALIZADO', 'RETIRADO', 'COM_DEFEITO'));

-- A devolutiva diz em que condição a peça volta — antes de bipar, como no
-- concorrente (Devolução → "Devolução - Situação" → Bipar serial).
alter table romaneio
  add column if not exists condicao_destino text
    check (condicao_destino in ('INICIALIZADO', 'RETIRADO', 'COM_DEFEITO'));


-- ---------------------------------------------------------------------------
-- 087-C · Transferência entre técnicos
-- ---------------------------------------------------------------------------
-- `tecnico_id` continua sendo QUEM RECEBE (quem confirma). A origem é
-- nova coluna. Na devolutiva e na entrega ela fica nula.
alter table romaneio add column if not exists tecnico_origem_id uuid references tecnico(id);

alter table romaneio drop constraint if exists romaneio_tipo_check;
alter table romaneio add constraint romaneio_tipo_check
  check (tipo in ('ENTREGA', 'DEVOLUCAO', 'TRANSFERENCIA'));

alter table romaneio drop constraint if exists romaneio_transferencia_check;
alter table romaneio add constraint romaneio_transferencia_check check (
  (tipo = 'TRANSFERENCIA') = (tecnico_origem_id is not null)
  and (tecnico_origem_id is distinct from tecnico_id)
);
alter table romaneio drop constraint if exists romaneio_condicao_check;
alter table romaneio add constraint romaneio_condicao_check check (
  (tipo = 'DEVOLUCAO') = (condicao_destino is not null)
  -- Documentos da fase 2 (078) nasceram sem condição. A regra vale do
  -- 087 em diante; o que já estava confirmado não se reescreve.
  or situacao <> 'ABERTO'
);

alter table miscelanea_movimento drop constraint if exists miscelanea_movimento_tipo_check;
alter table miscelanea_movimento add constraint miscelanea_movimento_tipo_check
  check (tipo in ('ENTRADA', 'ENTREGA', 'DEVOLUCAO', 'AJUSTE', 'TRANSFERENCIA'));

-- O técnico de ORIGEM também lê o documento (é a carga dele que sai).
drop policy if exists romaneio_leitura on romaneio;
create policy romaneio_leitura on romaneio for select using (
  empresa_id = (select minha_empresa())
  and ( (select tem_permissao('almoxarifado.ver'))
        or tecnico_id = (select meu_tecnico_id())
        or tecnico_origem_id = (select meu_tecnico_id()) )
);


-- ---------------------------------------------------------------------------
-- 087-D · O aceite diz como foi dado
-- ---------------------------------------------------------------------------
-- No concorrente o termo assinado diz "Aceite confirmado em … por
-- biometria do aparelho / credencial do aparelho / senha do usuário".
-- O banco não tem como conferir a biometria — quem afirma é o aparelho,
-- lá também. O que ele garante é que o método foi GRAVADO, e que o
-- balcão não se passa por aceite do técnico.
alter table romaneio add column if not exists confirmado_metodo text
  check (confirmado_metodo in ('APARELHO', 'SENHA', 'BALCAO'));


-- ---------------------------------------------------------------------------
-- abrir_romaneio — ganha condição e origem
-- ---------------------------------------------------------------------------
-- DROP antes: a versão de 3 parâmetros convivendo com a de 5 (com default)
-- deixa a chamada nomeada AMBÍGUA para o PostgREST (traps.md).
drop function if exists abrir_romaneio(text, uuid, text);

create function abrir_romaneio(p_tipo text, p_tecnico uuid,
                               p_observacao text default null,
                               p_condicao text default null,
                               p_tecnico_origem uuid default null)
returns uuid
language plpgsql security definer set search_path to 'public' as $fn$
declare v_id uuid; v_num int; v_emp uuid;
begin
  perform almox_pode_mexer();
  if p_tipo not in ('ENTREGA', 'DEVOLUCAO', 'TRANSFERENCIA') then
    raise exception 'Tipo deve ser ENTREGA, DEVOLUCAO ou TRANSFERENCIA.' using errcode = '23514';
  end if;
  v_emp := minha_empresa();
  if not exists (select 1 from tecnico where id = p_tecnico and empresa_id = v_emp) then
    raise exception 'Tecnico nao encontrado.' using errcode = 'P0002';
  end if;

  if p_tipo = 'DEVOLUCAO' and p_condicao is null then
    raise exception 'A devolutiva diz em que condicao as pecas voltam: inicializado, retirado ou com defeito.'
      using errcode = '23514';
  end if;
  if p_tipo <> 'DEVOLUCAO' and p_condicao is not null then
    raise exception 'Condicao so se declara na devolutiva.' using errcode = '23514';
  end if;

  if p_tipo = 'TRANSFERENCIA' then
    if p_tecnico_origem is null or p_tecnico_origem = p_tecnico then
      raise exception 'Transferencia precisa de um tecnico de origem diferente do destino.'
        using errcode = '23514';
    end if;
    if not exists (select 1 from tecnico where id = p_tecnico_origem and empresa_id = v_emp) then
      raise exception 'Tecnico de origem nao encontrado.' using errcode = 'P0002';
    end if;
  elsif p_tecnico_origem is not null then
    raise exception 'Origem so existe na transferencia.' using errcode = '23514';
  end if;

  select coalesce(max(numero), 0) + 1 into v_num from romaneio where empresa_id = v_emp;

  insert into romaneio (empresa_id, numero, tipo, tecnico_id, tecnico_origem_id,
                        condicao_destino, observacao, criado_por)
  values (v_emp, v_num, p_tipo, p_tecnico, p_tecnico_origem, p_condicao,
          nullif(btrim(coalesce(p_observacao,'')),''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function abrir_romaneio(text, uuid, text, text, uuid) from public, anon;
grant execute on function abrir_romaneio(text, uuid, text, text, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- romaneio_por_serial — transferência e prazo da carga
-- ---------------------------------------------------------------------------
-- Escrita a partir da versão VIVA (085), não do arquivo (traps.md).
create or replace function romaneio_por_serial(p_romaneio uuid, p_serial text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_r romaneio%rowtype; v_e equipamento%rowtype; v_serial text; v_outro int;
  v_efetivo text; v_venc jsonb;
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
  -- 087-C: na transferência a peça sai da carga do técnico de ORIGEM.
  if v_r.tipo = 'TRANSFERENCIA'
     and (v_e.posse is distinct from 'COM_TECNICO'
          or v_e.posse_tecnico_id is distinct from v_r.tecnico_origem_id) then
    raise exception 'A peca % nao esta com o tecnico de origem.', v_serial
      using errcode = '23514';
  end if;

  -- 087-A: quem RECEBE com carga parada além do prazo não recebe. Mesmo
  -- momento do concorrente: no bipar, antes de o documento existir de
  -- fato. Não se trava a confirmação — a peça já pode estar na mão dele.
  if v_r.tipo in ('ENTREGA', 'TRANSFERENCIA') then
    v_venc := carga_vencida_de(v_r.tecnico_id);
    if (v_venc->>'vencidos')::int > 0 then
      raise exception 'O tecnico nao pode receber: tem % peca(s) na carga ha mais de % dias sem instalar nem devolver.',
        v_venc->>'vencidos', v_venc->>'limite' using errcode = '23514';
    end if;
  end if;

  insert into romaneio_item (romaneio_id, equipamento_id, quantidade, criado_por)
  values (p_romaneio, v_e.id, 1, auth.uid())
  on conflict do nothing;

  v_efetivo := coalesce(v_e.estado_afline, v_e.estado_atlas);
  return jsonb_build_object('serial', v_e.serial, 'tipo', v_e.tipo,
                            'modelo', v_e.modelo, 'estado_atlas', v_e.estado_atlas,
                            'estado_afline', v_e.estado_afline,
                            'condicao', v_e.condicao,
                            'alerta', case when v_efetivo in
                                        ('PERDA','SUCATA','INUTILIZADO','COM DEFEITO')
                                      then v_efetivo end);
end;
$fn$;


-- ---------------------------------------------------------------------------
-- confirmar_romaneio — transferência, condição e método
-- ---------------------------------------------------------------------------
drop function if exists confirmar_romaneio(uuid);

create function confirmar_romaneio(p_romaneio uuid, p_metodo text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_r romaneio%rowtype; v_destino text; v_tec uuid; v_origem uuid;
  v_pecas int := 0; v_itens int := 0; v_saldo numeric; v_i record;
  v_meu uuid; v_pelo_tecnico boolean; v_metodo text;
begin
  select * into v_r from romaneio where id = p_romaneio and empresa_id = minha_empresa();
  if not found then raise exception 'Romaneio nao encontrado.' using errcode='P0002'; end if;

  -- Duas mãos (079): o almoxarifado, ou QUEM RECEBE. Na transferência o
  -- técnico de origem não confirma pelo outro — é a carga do outro que
  -- aumenta, e é ele quem assina.
  v_meu := meu_tecnico_id();
  v_pelo_tecnico := v_meu is not distinct from v_r.tecnico_id;
  if not v_pelo_tecnico then
    perform almox_pode_mexer();
  end if;

  if v_pelo_tecnico then
    if p_metodo not in ('APARELHO', 'SENHA') or p_metodo is null then
      raise exception 'O aceite do tecnico precisa dizer como foi feito: APARELHO ou SENHA.'
        using errcode = '23514';
    end if;
    v_metodo := p_metodo;
  else
    -- O balcão não se passa por aceite do técnico, diga o cliente o que disser.
    v_metodo := 'BALCAO';
  end if;

  if v_r.situacao <> 'ABERTO' then
    raise exception 'Romaneio % ja esta %.', v_r.numero, lower(v_r.situacao)
      using errcode = '23514';
  end if;
  if not exists (select 1 from romaneio_item where romaneio_id = p_romaneio) then
    raise exception 'Romaneio vazio nao se confirma.' using errcode = '23514';
  end if;

  -- De onde sai e para onde vai. `null` em tecnico = almoxarifado.
  if v_r.tipo = 'ENTREGA' then
    v_destino := 'COM_TECNICO'; v_tec := v_r.tecnico_id; v_origem := null;
  elsif v_r.tipo = 'TRANSFERENCIA' then
    v_destino := 'COM_TECNICO'; v_tec := v_r.tecnico_id; v_origem := v_r.tecnico_origem_id;
  else
    v_destino := 'NO_ALMOXARIFADO'; v_tec := null; v_origem := v_r.tecnico_id;
  end if;

  for v_i in select ri.item_id, ri.quantidade from romaneio_item ri
              where ri.romaneio_id = p_romaneio and ri.item_id is not null loop
    select coalesce(sum(quantidade), 0) into v_saldo from miscelanea_movimento
     where item_id = v_i.item_id and tecnico_id is not distinct from v_origem
       and empresa_id = v_r.empresa_id;
    if v_saldo < v_i.quantidade then
      raise exception 'Saldo insuficiente de % %: tem %, pediu %.',
        (select nome from item_miscelanea where id = v_i.item_id),
        case when v_origem is null then 'no almoxarifado' else 'com o tecnico de origem' end,
        v_saldo, v_i.quantidade using errcode = '23514';
    end if;

    insert into miscelanea_movimento (empresa_id, item_id, tecnico_id, quantidade,
                                      tipo, romaneio_id, criado_por)
    values
      (v_r.empresa_id, v_i.item_id, v_origem, -v_i.quantidade, v_r.tipo, p_romaneio, auth.uid()),
      (v_r.empresa_id, v_i.item_id, v_tec,     v_i.quantidade, v_r.tipo, p_romaneio, auth.uid());
    v_itens := v_itens + 1;
  end loop;

  -- A peça ainda está onde o documento diz que ela sai? Entre o bipar e a
  -- confirmação o campo pode ter instalado (079). Recusa em vez de puxar
  -- da casa do cliente de volta para a van.
  if exists (
    select 1 from romaneio_item ri join equipamento e on e.id = ri.equipamento_id
     where ri.romaneio_id = p_romaneio
       and not ( (v_r.tipo = 'ENTREGA' and (e.posse is null or e.posse = 'NO_ALMOXARIFADO'))
              or (v_r.tipo <> 'ENTREGA' and e.posse = 'COM_TECNICO'
                  and e.posse_tecnico_id is not distinct from v_origem) )
  ) then
    raise exception 'Uma ou mais pecas ja nao estao onde o romaneio diz que saem (o campo pode ter instalado). Tire-as e confirme de novo.'
      using errcode = '23514';
  end if;

  update equipamento e
     set posse = v_destino,
         posse_tecnico_id = v_tec,
         posse_em = now(),
         posse_por = auth.uid(),
         posse_motivo = 'romaneio ' || v_r.numero,
         -- 087-B: a devolutiva declara a condição; entrega e transferência
         -- levam a condição que a peça já tinha.
         condicao = case when v_r.tipo = 'DEVOLUCAO' then v_r.condicao_destino
                         else e.condicao end,
         atualizado_em = now()
    from romaneio_item ri
   where ri.romaneio_id = p_romaneio and ri.equipamento_id = e.id;
  get diagnostics v_pecas = row_count;

  update romaneio set situacao = 'CONFIRMADO', confirmado_em = now(),
                      confirmado_por = auth.uid(), confirmado_metodo = v_metodo
   where id = p_romaneio;

  return jsonb_build_object('numero', v_r.numero, 'tipo', v_r.tipo,
                            'pecas', v_pecas, 'itens', v_itens,
                            'posse', v_destino, 'metodo', v_metodo,
                            'confirmado_pelo_tecnico', v_pelo_tecnico);
end;
$fn$;
revoke all on function confirmar_romaneio(uuid, text) from public, anon;
grant execute on function confirmar_romaneio(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- O campo carimba a condição (079 + 087-B)
-- ---------------------------------------------------------------------------
-- RETIRADO da casa do cliente = condição RETIRADO: é o "Com Técnico -
-- Retirado" do concorrente, 2.112 movimentos em 30 dias. INSTALADO tira a
-- condição: a peça não é mais nossa para ter condição de almoxarifado.
create or replace function posse_do_movimento_do_campo()
returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_emp uuid; v_contrato text; v_e equipamento%rowtype;
  v_destino text; v_tec uuid;
begin
  select v.empresa_id, v.contrato into v_emp, v_contrato
    from visita v where v.id = new.visita_id;
  if v_emp is null then return null; end if;

  select * into v_e from equipamento
   where empresa_id = v_emp and serial = new.serial;
  if not found then return null; end if;

  if new.operacao = 'INSTALADO' then
    v_destino := 'COM_ASSINANTE'; v_tec := null;
  elsif new.operacao = 'RETIRADO' then
    v_destino := 'COM_TECNICO'; v_tec := new.tecnico_id;
  else
    return null;
  end if;

  update equipamento
     set posse = v_destino,
         posse_tecnico_id = v_tec,
         posse_em = now(),
         posse_por = new.usuario_id,
         posse_motivo = 'campo: ' || lower(new.operacao)
                        || ' no contrato ' || coalesce(v_contrato, '?')
                        || ' (antes: ' || coalesce(v_e.posse, 'sem posse declarada') || ')',
         condicao = case when new.operacao = 'RETIRADO' then 'RETIRADO' end,
         atualizado_em = now()
   where id = v_e.id;

  return null;
exception when others then
  -- Nunca trava a baixa (D-157).
  return null;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- O que o técnico lê
-- ---------------------------------------------------------------------------
-- `returns table` mudou: create or replace não aceita (traps.md). DROP e
-- recria — e a ACL nasce aberta de novo, por isso o revoke logo abaixo.
drop function if exists minha_carga();
create function minha_carga()
returns table (serial text, tipo text, modelo text, estado text, condicao text,
               posse_em timestamptz, posse_motivo text, dias int)
language sql stable security definer set search_path to 'public' as $fn$
  with meu as materialized (select meu_tecnico_id() as tecnico)
  select e.serial, e.tipo, e.modelo,
         coalesce(e.estado_afline, e.estado_atlas), e.condicao,
         e.posse_em, e.posse_motivo,
         (hoje_local() - (e.posse_em at time zone 'America/Manaus')::date)::int
    from equipamento e, meu m
   where m.tecnico is not null
     and e.posse = 'COM_TECNICO'
     and e.posse_tecnico_id = m.tecnico
     and e.empresa_id = minha_empresa()
   order by e.posse_em, e.serial;
$fn$;
revoke all on function minha_carga() from public, anon;
grant execute on function minha_carga() to authenticated;

drop function if exists meus_romaneios();
create function meus_romaneios()
returns table (id uuid, numero int, tipo text, situacao text,
               observacao text, criado_em timestamptz,
               confirmado_em timestamptz, confirmado_metodo text,
               eu_recebo boolean, outro_tecnico text, condicao_destino text,
               pecas jsonb, itens jsonb)
language sql stable security definer set search_path to 'public' as $fn$
  with meu as materialized (select meu_tecnico_id() as tecnico)
  select r.id, r.numero, r.tipo, r.situacao, r.observacao, r.criado_em,
         r.confirmado_em, r.confirmado_metodo,
         r.tecnico_id = m.tecnico,
         -- Na transferência, o nome do outro lado: de quem vem, ou para quem vai.
         case when r.tipo = 'TRANSFERENCIA' then
           (select t.nome from tecnico t
             where t.id = case when r.tecnico_id = m.tecnico
                               then r.tecnico_origem_id else r.tecnico_id end)
         end,
         r.condicao_destino,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'serial', e.serial, 'tipo', e.tipo, 'modelo', e.modelo)
                     order by e.serial)
                     from romaneio_item ri join equipamento e on e.id = ri.equipamento_id
                    where ri.romaneio_id = r.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'nome', i.nome, 'codigo', i.codigo,
                     'unidade', i.unidade, 'qtd', ri.quantidade) order by i.nome)
                     from romaneio_item ri join item_miscelanea i on i.id = ri.item_id
                    where ri.romaneio_id = r.id), '[]'::jsonb)
    from romaneio r, meu m
   where (r.tecnico_id = m.tecnico or r.tecnico_origem_id = m.tecnico)
     and r.empresa_id = minha_empresa()
     and (r.situacao = 'ABERTO' or r.confirmado_em > now() - interval '7 days')
   order by (r.situacao = 'ABERTO' and r.tecnico_id = m.tecnico) desc, r.numero desc
   limit 30;
$fn$;
revoke all on function meus_romaneios() from public, anon;
grant execute on function meus_romaneios() to authenticated;

notify pgrst, 'reload schema';
