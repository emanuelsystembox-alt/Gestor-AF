-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 229 — A entrada de material nas Movimentações e no histórico (D-339)  │
-- │                                                                      │
-- │ A 228 criou a ENTRADA (estoque_entrada). Ela tem de aparecer onde o  │
-- │ almoxarife procura o que aconteceu: a lista de movimentações do      │
-- │ período e o histórico de um serial. Só um ramo novo em cada uma —    │
-- │ o retorno não muda (o site no ar continua lendo igual).              │
-- └──────────────────────────────────────────────────────────────────────┘

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
  select coalesce(r.confirmado_em, r.cancelado_em, r.criado_em), 'ROMANEIO',
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
         (select p.nome from perfil p where p.id = coalesce(r.confirmado_por, r.criado_por))
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

CREATE OR REPLACE FUNCTION public.estoque_movimentacoes(p_de date, p_ate date)
 RETURNS TABLE(quando timestamp with time zone, tipo text, documento text, serial text, item text, quantidade numeric, de text, para text, quem text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with r as materialized (
    select r.* from romaneio r
     where r.empresa_id = (select minha_empresa()) and r.base_id in (select bases_visiveis()) and r.situacao = 'CONFIRMADO'
       and (r.confirmado_em at time zone 'America/Manaus')::date between p_de and p_ate
       and (select tem_permissao('almoxarifado.ver'))
  )
  select r.confirmado_em, r.tipo, 'romaneio ' || r.numero,
         e.serial, i.nome, ri.quantidade,
         case r.tipo when 'ENTREGA' then 'almoxarifado'
                     when 'DEVOLUCAO' then tr.nome else tro.nome end,
         case r.tipo when 'DEVOLUCAO' then 'almoxarifado' else tr.nome end,
         (select p.nome from perfil p where p.id = r.confirmado_por)
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

notify pgrst, 'reload schema';
