-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 230 — Romaneio com DATA DE REPORTE e OPERADOR, só o ADMIN (D-340)     │
-- │                                                                      │
-- │ "a ideia é ir com operador data movimentação, tem que aparecer, e    │
-- │  não de hoje, como eu sou o admin eu posso controlar essa data de    │
-- │  reporte" — Emanuel, 07/11 (o piloto da equipe 004 com a planilha    │
-- │  do ngestor: cada peça tem a data e o operador de lá).               │
-- │                                                                      │
-- │ romaneio.data_reporte (quando o movimento aconteceu) e               │
-- │ romaneio.operador (quem fez lá fora). Só o ADMIN grava, só com o     │
-- │ documento ABERTO, data no passado (até um ano). Na confirmação, a    │
-- │ peça recebe a data de reporte como posse_em — é dela que saem os     │
-- │ "dias com o técnico". Movimentações e o histórico do serial mostram  │
-- │ a data de reporte e o operador. confirmado_em e confirmado_por       │
-- │ continuam sendo de QUEM REGISTROU aqui e QUANDO — o rastro real.     │
-- └──────────────────────────────────────────────────────────────────────┘

alter table romaneio add column if not exists data_reporte timestamptz;
alter table romaneio add column if not exists operador text;

create or replace function definir_reporte_romaneio(p_romaneio uuid, p_data timestamptz, p_operador text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not (select tem_papel('ADMIN')) then
    raise exception 'So o ADMIN informa a data de reporte.' using errcode = '42501';
  end if;
  if p_data is not null and (p_data > now() or p_data < now() - interval '1 year') then
    raise exception 'A data de reporte tem de estar no passado (ate um ano).' using errcode = '23514';
  end if;
  update romaneio
     set data_reporte = p_data,
         operador = nullif(left(btrim(coalesce(p_operador, '')), 120), '')
   where id = p_romaneio and empresa_id = (select minha_empresa())
     and base_id in (select bases_permitidas()) and situacao = 'ABERTO';
  if not found then
    raise exception 'Romaneio nao encontrado ou ja fechado.' using errcode = 'P0002';
  end if;
end $fn$;

revoke all on function definir_reporte_romaneio(uuid, timestamptz, text) from public, anon;
grant execute on function definir_reporte_romaneio(uuid, timestamptz, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.confirmar_romaneio(p_romaneio uuid, p_metodo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_r romaneio%rowtype; v_destino text; v_tec uuid; v_origem uuid;
  v_pecas int := 0; v_itens int := 0; v_saldo numeric; v_i record;
  v_meu uuid; v_pelo_tecnico boolean; v_metodo text;
begin
  select * into v_r from romaneio where id = p_romaneio and empresa_id = minha_empresa() and base_id in (select bases_permitidas());
  if not found then raise exception 'Romaneio nao encontrado.' using errcode='P0002'; end if;
  if v_r.situacao <> 'ABERTO' then
    raise exception 'Romaneio % ja esta %.', v_r.numero, lower(v_r.situacao)
      using errcode = '23514';
  end if;

  v_meu := meu_tecnico_id();
  v_pelo_tecnico := v_meu is not distinct from v_r.tecnico_id;

  if v_pelo_tecnico and (p_metodo is null or p_metodo not in ('APARELHO', 'SENHA')) then
    raise exception 'O aceite do tecnico precisa dizer como foi feito: APARELHO ou SENHA.'
      using errcode = '23514';
  end if;

  if v_r.solicitado_por_tecnico then
    if v_pelo_tecnico then
      if v_r.aceito_em is not null then
        raise exception 'Voce ja aceitou. Falta o almoxarifado aprovar.' using errcode = '23514';
      end if;
      update romaneio set aceito_em = now(), aceito_por = auth.uid(), aceito_metodo = p_metodo
       where id = p_romaneio;
      return jsonb_build_object('numero', v_r.numero, 'tipo', v_r.tipo,
                                'aguardando_aprovacao', true, 'metodo', p_metodo);
    end if;
    perform almox_pode_mexer();
    if v_r.aceito_em is null then
      raise exception 'O tecnico de destino ainda nao aceitou. A aprovacao vem depois do aceite.'
        using errcode = '23514';
    end if;
    v_metodo := v_r.aceito_metodo;
  elsif v_pelo_tecnico then
    v_metodo := p_metodo;
  else
    perform almox_pode_mexer();
    v_metodo := 'BALCAO';
  end if;

  if not exists (select 1 from romaneio_item where romaneio_id = p_romaneio) then
    raise exception 'Romaneio vazio nao se confirma.' using errcode = '23514';
  end if;

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
       and empresa_id = v_r.empresa_id and base_id = v_r.base_id;
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
     set posse = v_destino, posse_tecnico_id = v_tec, posse_em = coalesce(v_r.data_reporte, now()), posse_por = auth.uid(),
         posse_motivo = 'romaneio ' || v_r.numero,
         condicao = case when v_r.tipo = 'DEVOLUCAO' then v_r.condicao_destino else e.condicao end,
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
                            'aprovado_pelo_almoxarifado', v_r.solicitado_por_tecnico,
                            'confirmado_pelo_tecnico', v_pelo_tecnico);
end;
$function$;

CREATE OR REPLACE FUNCTION public.estoque_movimentacoes(p_de date, p_ate date)
 RETURNS TABLE(quando timestamp with time zone, tipo text, documento text, serial text, item text, quantidade numeric, de text, para text, quem text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with r as materialized (
    select r.* from romaneio r
     where r.empresa_id = (select minha_empresa()) and r.base_id in (select bases_visiveis()) and r.situacao = 'CONFIRMADO'
       and (coalesce(r.data_reporte, r.confirmado_em) at time zone 'America/Manaus')::date between p_de and p_ate
       and (select tem_permissao('almoxarifado.ver'))
  )
  select coalesce(r.data_reporte, r.confirmado_em), r.tipo, 'romaneio ' || r.numero,
         e.serial, i.nome, ri.quantidade,
         case r.tipo when 'ENTREGA' then 'almoxarifado'
                     when 'DEVOLUCAO' then tr.nome else tro.nome end,
         case r.tipo when 'DEVOLUCAO' then 'almoxarifado' else tr.nome end,
         coalesce(r.operador, (select p.nome from perfil p where p.id = r.confirmado_por))
    from r join romaneio_item ri on ri.romaneio_id = r.id
    left join equipamento e on e.id = ri.equipamento_id
    left join item_miscelanea i on i.id = ri.item_id
    left join tecnico tr on tr.id = r.tecnico_id
    left join tecnico tro on tro.id = r.tecnico_origem_id
  union all
  select m.criado_em, m.tipo,
         case when m.visita_id is not null
              then 'contrato ' || coalesce((select v.contrato from visita v where v.id = m.visita_id), '?')
              else coalesce(m.motivo, '') end,
         null, i.nome, m.quantidade,
         case when m.quantidade < 0 then coalesce(t.nome, 'almoxarifado') end,
         case when m.quantidade > 0 then coalesce(t.nome, 'almoxarifado') end,
         (select p.nome from perfil p where p.id = m.criado_por)
    from miscelanea_movimento m join item_miscelanea i on i.id = m.item_id
    left join tecnico t on t.id = m.tecnico_id
   where m.empresa_id = (select minha_empresa()) and m.base_id in (select bases_visiveis()) and m.tipo in ('ENTRADA', 'AJUSTE', 'CONSUMO')
     and (m.criado_em at time zone 'America/Manaus')::date between p_de and p_ate
     and (select tem_permissao('almoxarifado.ver'))
  union all
  -- 229 (D-339): a ENTRADA de serializado no estoque
  select x.criado_em, 'ENTRADA', 'entrada ' || x.numero, ei.serial, null, 1,
         coalesce(lower(ei.posse_antes), 'sem posse declarada'), 'almoxarifado',
         (select p.nome from perfil p where p.id = x.criado_por)
    from estoque_entrada x join estoque_entrada_item ei on ei.entrada_id = x.id
   where x.empresa_id = (select minha_empresa()) and x.base_id in (select bases_visiveis())
     and (x.criado_em at time zone 'America/Manaus')::date between p_de and p_ate
     and (select tem_permissao('almoxarifado.ver'))
  union all
  select m.criado_em, 'CAMPO_' || m.operacao,
         'contrato ' || coalesce(v.contrato, '?'), m.serial, null, 1,
         case when m.operacao = 'RETIRADO' then 'cliente' else t.nome end,
         case when m.operacao = 'RETIRADO' then t.nome else 'cliente' end,
         coalesce(m.login, t.nome)
    from equipamento_movimento m join visita v on v.id = m.visita_id
    left join tecnico t on t.id = m.tecnico_id
   where v.empresa_id = (select minha_empresa()) and v.base_id in (select bases_visiveis())
     and (m.criado_em at time zone 'America/Manaus')::date between p_de and p_ate
     and exists (select 1 from equipamento e where e.empresa_id = v.empresa_id and e.base_id = v.base_id and e.serial = m.serial)
     and (select tem_permissao('almoxarifado.ver'))
  order by 1 desc;
$function$;

CREATE OR REPLACE FUNCTION public.estoque_historico_serial(p_serial text)
 RETURNS TABLE(quando timestamp with time zone, tipo text, descricao text, quem text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with e as materialized (
    select * from equipamento
     where empresa_id = (select minha_empresa()) and base_id in (select bases_visiveis())
       and serial = upper(regexp_replace(coalesce(p_serial,''), '\s', '', 'g'))
       and (select tem_permissao('almoxarifado.ver'))
  )
  select e.criado_em, 'CARGA',
         format('entrou pela carga do Atlas (%s)', coalesce(e.estado_atlas, 'sem estado')), null::text
    from e
  union all
  select ev.criado_em, 'ESTADO',
         format('estado AFLINE: %s → %s (Atlas: %s) — %s',
                coalesce(ev.de, 'nenhum'), coalesce(ev.para, 'desfeito'),
                coalesce(ev.estado_atlas, '—'), coalesce(ev.motivo, '')),
         (select p.nome from perfil p where p.id = ev.criado_por)
    from equipamento_estado_evento ev join e on e.id = ev.equipamento_id
  union all
  select coalesce(r.data_reporte, r.confirmado_em, r.cancelado_em, r.criado_em), 'ROMANEIO',
         format('%s %s — %s%s%s',
                lower(r.tipo), r.numero,
                case r.tipo when 'ENTREGA' then 'para ' || tr.nome
                            when 'DEVOLUCAO' then 'de ' || tr.nome || ' para o almoxarifado'
                            else 'de ' || coalesce(tro.nome, '?') || ' para ' || tr.nome end,
                case r.situacao when 'CONFIRMADO' then
                       ' · confirmado' || case r.confirmado_metodo
                         when 'BALCAO' then ' no balcão'
                         when 'APARELHO' then ' pelo técnico no celular'
                         when 'SENHA' then ' pelo técnico com senha' else '' end
                     when 'CANCELADO' then ' · cancelado: ' || coalesce(r.cancelado_motivo, '')
                     else ' · aberto' end,
                case when r.condicao_destino is not null then ' · volta como ' || lower(r.condicao_destino) else '' end),
         coalesce(r.operador, (select p.nome from perfil p where p.id = coalesce(r.confirmado_por, r.criado_por)))
    from romaneio_item ri join e on e.id = ri.equipamento_id
    join romaneio r on r.id = ri.romaneio_id
    left join tecnico tr on tr.id = r.tecnico_id
    left join tecnico tro on tro.id = r.tecnico_origem_id
  union all
  -- 229 (D-339): a ENTRADA no estoque
  select x.criado_em, 'ENTRADA',
         format('entrada %s — no almoxarifado como %s (antes: %s)%s', x.numero, lower(x.condicao),
                coalesce(lower(ei.posse_antes), 'sem posse declarada'),
                case when x.observacao is not null then ' · ' || x.observacao else '' end),
         (select p.nome from perfil p where p.id = x.criado_por)
    from estoque_entrada_item ei join e on e.id = ei.equipamento_id
    join estoque_entrada x on x.id = ei.entrada_id
  union all
  select m.criado_em, 'CAMPO',
         format('%s no contrato %s', lower(m.operacao),
                coalesce((select v.contrato from visita v where v.id = m.visita_id), '?')),
         coalesce(m.login, (select t.nome from tecnico t where t.id = m.tecnico_id))
    from equipamento_movimento m join e on m.serial = e.serial
   where exists (select 1 from visita v where v.id = m.visita_id and v.empresa_id = (select minha_empresa()))
  order by 1 desc;
$function$;

notify pgrst, 'reload schema';
