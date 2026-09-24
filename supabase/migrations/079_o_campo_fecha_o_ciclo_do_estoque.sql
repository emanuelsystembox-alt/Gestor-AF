-- ============================================================
-- 079 · O campo fecha o ciclo do estoque — fase 3
--
-- Duas coisas que ficaram escritas como pendência em D-154, e que o
-- Emanuel mandou seguir em 23/09:
--
--   1. o TÉCNICO confirma o romaneio, pelo celular
--   2. quando ele lança o serial na baixa, a peça sai da mão dele
--
-- ┌─ 1 · QUEM CONFIRMA ──────────────────────────────────────────────┐
-- │ > "o almoxarife monta a carga […] e o técnico confirma" — Emanuel │
-- │                                                                   │
-- │ Na fase 2 quem confirmava era o almoxarife, no balcão, porque o   │
-- │ aplicativo não tinha a tela. Agora tem. `confirmar_romaneio`      │
-- │ passa a aceitar DUAS mãos:                                        │
-- │                                                                   │
-- │   · o almoxarife/gestor (como antes), e                           │
-- │   · o TÉCNICO DONO daquele documento — e só o dele.               │
-- │                                                                   │
-- │ `confirmado_por` continua sendo quem de fato clicou. Quando for o │
-- │ técnico, o documento passa a valer como recibo: a assinatura tem  │
-- │ nome, hora e é dele.                                              │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ 2 · O CAMPO MOVE A POSSE, E NUNCA TRAVA POR CAUSA DELA ─────────┐
-- │ `registrar_equipamento` (055-F) já registra o serial que o        │
-- │ técnico instalou ou retirou no contrato. Faltava a outra ponta:   │
-- │ essa peça é a MESMA que saiu do almoxarifado, e a posse dela      │
-- │ tinha de acompanhar.                                              │
-- │                                                                   │
-- │   INSTALADO  → a peça ficou na casa do assinante → COM_ASSINANTE  │
-- │   RETIRADO   → a peça voltou para a mão do técnico → COM_TECNICO  │
-- │                                                                   │
-- │ O gatilho mora em `equipamento_movimento`, que é o FUNIL — mesma  │
-- │ razão pela qual o gatilho de avisos mora em `visita_evento`       │
-- │ (059): pendurar em cada RPC é escrever a regra cinco vezes e      │
-- │ esquecer na sexta.                                                │
-- │                                                                   │
-- │ ⚠ ELE NUNCA LEVANTA EXCEÇÃO. O técnico está na casa do cliente    │
-- │ com o celular na mão; travar a baixa porque o estoque discorda    │
-- │ seria parar o serviço por causa de uma planilha. Serial que não   │
-- │ está na nossa carga (equipamento do assinante, de outra           │
-- │ empreiteira, digitado errado) simplesmente não move nada.         │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ a divergência é REGISTRADA, não corrigida em silêncio ──────────┐
-- │ Se a peça instalada estava, para nós, "no almoxarifado" — ou seja │
-- │ ninguém entregou ao técnico — a posse muda do mesmo jeito (o fato │
-- │ é que ela está na casa do cliente) e `posse_motivo` guarda de     │
-- │ ONDE ela veio. Quem conferir o inventário vê que houve uma peça   │
-- │ que saiu sem romaneio, em vez de ver um estoque redondo e falso.  │
-- └───────────────────────────────────────────────────────────────────┘
-- ============================================================

-- ------------------------------------------------------------
-- A · O gatilho: o que o campo declara move a posse
-- ------------------------------------------------------------
create or replace function posse_do_movimento_do_campo()
returns trigger language plpgsql security definer
set search_path to 'public' as $fn$
declare
  v_emp uuid; v_contrato text; v_e equipamento%rowtype;
  v_destino text; v_tec uuid;
begin
  -- A empresa e o contrato vêm da visita: `equipamento_movimento` não
  -- carrega empresa, e o serial só é único DENTRO de uma.
  select v.empresa_id, v.contrato into v_emp, v_contrato
    from visita v where v.id = new.visita_id;
  if v_emp is null then return null; end if;

  select * into v_e from equipamento
   where empresa_id = v_emp and serial = new.serial;
  -- Serial fora da nossa carga: equipamento do assinante, de outra
  -- empreiteira, ou digitado errado. Não é nosso, não mexemos.
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
         -- De onde ela veio fica escrito: peça que aparece instalada
         -- vindo do almoxarifado saiu sem romaneio, e isso é achado de
         -- inventario, nao ruido.
         posse_motivo = 'campo: ' || lower(new.operacao)
                        || ' no contrato ' || coalesce(v_contrato, '?')
                        || ' (antes: ' || coalesce(v_e.posse, 'sem posse declarada') || ')',
         atualizado_em = now()
   where id = v_e.id;

  return null;
exception when others then
  -- O campo NAO PARA por causa do estoque. Se qualquer coisa aqui der
  -- errado, a baixa do tecnico segue e a posse fica como estava.
  return null;
end;
$fn$;

revoke all on function posse_do_movimento_do_campo() from public, anon;

drop trigger if exists trg_posse_do_campo on equipamento_movimento;
create trigger trg_posse_do_campo
  after insert on equipamento_movimento
  for each row execute function posse_do_movimento_do_campo();

-- ------------------------------------------------------------
-- B · O técnico confirma o romaneio dele
-- ------------------------------------------------------------
create or replace function confirmar_romaneio(p_romaneio uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_r romaneio%rowtype; v_destino text; v_tec uuid;
  v_pecas int := 0; v_itens int := 0; v_saldo numeric; v_i record;
  v_meu uuid;
begin
  select * into v_r from romaneio where id = p_romaneio and empresa_id = minha_empresa();
  if not found then raise exception 'Romaneio nao encontrado.' using errcode='P0002'; end if;

  -- 079: duas maos. O almoxarife/gestor, ou o TECNICO DONO deste
  -- documento -- e so o dele.
  v_meu := meu_tecnico_id();
  if v_meu is distinct from v_r.tecnico_id then
    perform almox_pode_mexer();
  end if;

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
                            'posse', v_destino,
                            'confirmado_pelo_tecnico', v_meu is not distinct from v_r.tecnico_id);
end;
$fn$;

revoke all on function confirmar_romaneio(uuid) from public, anon;
grant execute on function confirmar_romaneio(uuid) to authenticated;

-- ------------------------------------------------------------
-- C · O que o celular do técnico precisa ler
-- ------------------------------------------------------------
-- Um embed do PostgREST resolveria, mas em TRES viagens e com o
-- aplicativo montando a arvore. Aqui vai pronto, numa chamada so --
-- mesma escolha de `agenda_do_campo` (055-I), e pela mesma razao: no
-- campo a rede e ruim.
create or replace function meus_romaneios()
returns table (id uuid, numero int, tipo text, situacao text,
               observacao text, criado_em timestamptz,
               confirmado_em timestamptz, pecas jsonb, itens jsonb)
language sql stable security definer set search_path to 'public' as $fn$
  with meu as materialized (select meu_tecnico_id() as tecnico)
  select r.id, r.numero, r.tipo, r.situacao, r.observacao, r.criado_em,
         r.confirmado_em,
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
   where r.tecnico_id = m.tecnico
     and r.empresa_id = minha_empresa()
     -- O que ele precisa agir, e o que ele acabou de assinar. Documento
     -- de tres meses atras nao e assunto do celular.
     and (r.situacao = 'ABERTO' or r.confirmado_em > now() - interval '7 days')
   order by (r.situacao = 'ABERTO') desc, r.numero desc
   limit 30;
$fn$;

revoke all on function meus_romaneios() from public, anon;
grant execute on function meus_romaneios() to authenticated;

notify pgrst, 'reload schema';
