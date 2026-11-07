-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 226 — Almoxarifado: o escopo resolvido uma vez por consulta (D-337)   │
-- │                                                                      │
-- │ Em 07/11, com a carga nova (17.993 peças de Manaus), a tela do       │
-- │ almoxarifado deu "canceling statement due to statement timeout" logo │
-- │ depois da importação — que tinha dado certo. Era a LEITURA:          │
-- │ `estoque_posicao` filtrava `e.empresa_id = minha_empresa()` SOLTO,   │
-- │ chamado uma vez POR LINHA (traps.md, D-118). Medido como             │
-- │ authenticated: count(*) com a chamada solta 1.711 ms, com            │
-- │ `(select minha_empresa())` 17 ms. Com 33 peças (até a 225) ninguém   │
-- │ via; com 18 mil, o painel passou dos 8 s no clique.                  │
-- │                                                                      │
-- │ As seis funções de leitura do estoque tinham a mesma forma. Troca só │
-- │ `minha_empresa()` por `(select minha_empresa())` — nada mais muda.   │
-- └──────────────────────────────────────────────────────────────────────┘

-- estoque_posicao: 2 chamada(s) solta(s) -> (select minha_empresa())
CREATE OR REPLACE FUNCTION public.estoque_posicao()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with permitido as (
    select eh_gestor() or tem_permissao('almoxarifado.ver') as ok
  ),
  base as materialized (
    select e.* from equipamento e, permitido p
     where p.ok and e.empresa_id = (select minha_empresa()) and e.base_id in (select bases_visiveis())
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'sem_posse', (select count(*) from base where posse is null),
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
       where i.empresa_id = (select minha_empresa()) and i.base_id in (select bases_visiveis())
       order by i.criado_em desc limit 1)
  );
$function$;

-- estoque_cargas: 2 chamada(s) solta(s) -> (select minha_empresa())
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
         (select count(*) from eq where eq.tid = t.id and eq.condicao = 'INICIALIZADO')::int,
         (select count(*) from eq where eq.tid = t.id and eq.condicao = 'RETIRADO')::int,
         (select count(*) from eq where eq.tid = t.id and eq.condicao = 'COM_DEFEITO')::int,
         (select count(*) from eq where eq.tid = t.id and eq.condicao is null)::int,
         (select max(dias) from eq where eq.tid = t.id)::int,
         (select count(*) from mi where mi.tid = t.id)::int,
         coalesce((select sum(q) from mi where mi.tid = t.id), 0)
    from quem join tecnico t on t.id = quem.tid
   where (select tem_permissao('almoxarifado.ver'))
   order by t.nome;
$function$;

-- estoque_movimentacoes: 3 chamada(s) solta(s) -> (select minha_empresa())
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

-- estoque_historico_serial: 2 chamada(s) solta(s) -> (select minha_empresa())
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
  select m.criado_em, 'CAMPO',
         format('%s no contrato %s', lower(m.operacao),
                coalesce((select v.contrato from visita v where v.id = m.visita_id), '?')),
         coalesce(m.login, (select t.nome from tecnico t where t.id = m.tecnico_id))
    from equipamento_movimento m join e on m.serial = e.serial
   where exists (select 1 from visita v where v.id = m.visita_id and v.empresa_id = (select minha_empresa()))
  order by 1 desc;
$function$;

-- miscelanea_saldos: 2 chamada(s) solta(s) -> (select minha_empresa())
CREATE OR REPLACE FUNCTION public.miscelanea_saldos()
 RETURNS TABLE(item_id uuid, codigo text, nome text, unidade text, tipo text, valor numeric, ca text, consumivel boolean, no_almoxarifado numeric, com_tecnicos numeric, por_tecnico jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with permitido as (
    select eh_gestor() or tem_permissao('almoxarifado.ver') as ok
  ),
  mov as materialized (
    select m.* from miscelanea_movimento m, permitido p
     where p.ok and m.empresa_id = (select minha_empresa()) and m.base_id in (select bases_visiveis())
  )
  select i.id, i.codigo, i.nome, i.unidade, i.tipo, i.valor, i.ca, i.consumivel,
         coalesce((select sum(quantidade) from mov
                    where item_id = i.id and tecnico_id is null), 0),
         coalesce((select sum(quantidade) from mov
                    where item_id = i.id and tecnico_id is not null), 0),
         coalesce((select jsonb_agg(jsonb_build_object(
                            'tecnico_id', x.tecnico_id, 'tecnico', t.nome,
                            'matricula', t.matricula, 'qtd', x.q) order by x.q desc)
                     from (select tecnico_id, sum(quantidade) as q from mov
                            where item_id = i.id and tecnico_id is not null
                            group by tecnico_id having sum(quantidade) <> 0) x
                     join tecnico t on t.id = x.tecnico_id), '[]'::jsonb)
    from item_miscelanea i, permitido p
   where p.ok and i.empresa_id = (select minha_empresa()) and i.ativo
   order by i.tipo nulls last, i.nome;
$function$;

-- miscelanea_kardex: 1 chamada(s) solta(s) -> (select minha_empresa())
CREATE OR REPLACE FUNCTION public.miscelanea_kardex(p_item uuid, p_tecnico uuid, p_de date, p_ate date)
 RETURNS TABLE(quando timestamp with time zone, tipo text, documento text, outro_lado text, saldo_anterior numeric, quantidade numeric, saldo_atual numeric, motivo text, quem text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mov as materialized (
    select m.*,
           sum(m.quantidade) over (order by m.criado_em, m.seq rows unbounded preceding) as corrido
      from miscelanea_movimento m
     where m.empresa_id = (select minha_empresa()) and m.base_id in (select bases_visiveis()) and m.item_id = p_item
       and m.tecnico_id is not distinct from p_tecnico
       and (select tem_permissao('almoxarifado.ver'))
  )
  select m.criado_em, m.tipo,
         case when m.romaneio_id is not null
                then 'romaneio ' || (select r.numero from romaneio r where r.id = m.romaneio_id)
              when m.visita_id is not null
                then 'contrato ' || coalesce((select v.contrato from visita v where v.id = m.visita_id), '?')
              else '' end,
         (select coalesce(t.nome, 'almoxarifado') from miscelanea_movimento o
            left join tecnico t on t.id = o.tecnico_id
           where o.romaneio_id = m.romaneio_id and o.item_id = m.item_id and o.id <> m.id
             and sign(o.quantidade) <> sign(m.quantidade) limit 1),
         m.corrido - m.quantidade, m.quantidade, m.corrido, m.motivo,
         (select p.nome from perfil p where p.id = m.criado_por)
    from mov m
   where (m.criado_em at time zone 'America/Manaus')::date between p_de and p_ate
   order by m.criado_em desc, m.seq desc;
$function$;

notify pgrst, 'reload schema';
