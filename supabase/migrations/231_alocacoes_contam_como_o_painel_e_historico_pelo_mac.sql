-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 231 — Alocações com a mesma conta do painel; histórico pelo MAC (D-340)│
-- │                                                                      │
-- │ No piloto da equipe 004 (07/11), o painel mostrou as 33 peças em     │
-- │ "Com técnico · inicializado" e Equipes / Alocações mostrou "0        │
-- │ inicializadas, 33 sem condição": a entrega não declara condição, e   │
-- │ só o painel (situacao_estoque, 228) contava a vazia como             │
-- │ inicializada. A mesma tela não pode se contradizer (traps.md): agora │
-- │ estoque_cargas conta igual, e "sem condição" fica para o que não é   │
-- │ nenhuma das três. E o histórico de um serial acha também pelo MAC.   │
-- └──────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION public.estoque_cargas()
 RETURNS TABLE(tecnico_id uuid, tecnico text, matricula text, equipe text, seriais integer, inicializadas integer, retiradas integer, com_defeito integer, sem_condicao integer, mais_antiga_dias integer, itens_misc integer, qtd_misc numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with eq as materialized (
    select e.posse_tecnico_id tid, e.condicao,
           hoje_local() - (e.posse_em at time zone 'America/Manaus')::date dias
      from equipamento e
     where e.empresa_id = (select minha_empresa()) and e.base_id in (select bases_visiveis()) and e.posse = 'COM_TECNICO'
  ), mi as materialized (
    select m.tecnico_id tid, m.item_id, sum(m.quantidade) q
      from miscelanea_movimento m
     where m.empresa_id = (select minha_empresa()) and m.base_id in (select bases_visiveis()) and m.tecnico_id is not null
     group by 1, 2 having sum(m.quantidade) > 0
  ), quem as (
    select tid from eq union select tid from mi
  )
  select t.id, t.nome, t.matricula,
         (select e.codigo || ' - ' || coalesce(e.nome,'') from equipe e where e.id = t.equipe_id),
         (select count(*) from eq where eq.tid = t.id)::int,
         (select count(*) from eq where eq.tid = t.id and (eq.condicao = 'INICIALIZADO' or eq.condicao is null))::int,
         (select count(*) from eq where eq.tid = t.id and eq.condicao = 'RETIRADO')::int,
         (select count(*) from eq where eq.tid = t.id and eq.condicao = 'COM_DEFEITO')::int,
         (select count(*) from eq where eq.tid = t.id
            and eq.condicao not in ('INICIALIZADO', 'RETIRADO', 'COM_DEFEITO'))::int,
         (select max(dias) from eq where eq.tid = t.id)::int,
         (select count(*) from mi where mi.tid = t.id)::int,
         coalesce((select sum(q) from mi where mi.tid = t.id), 0)
    from quem join tecnico t on t.id = quem.tid
   where (select tem_permissao('almoxarifado.ver'))
   order by t.nome;
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
       and (serial = upper(regexp_replace(coalesce(p_serial,''), '\s', '', 'g'))
            -- 231: também pelo MAC (o "Endereçável" do Atlas), como o bipe e a busca
            or chave_enderecavel(enderecavel) = chave_enderecavel(p_serial))
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
