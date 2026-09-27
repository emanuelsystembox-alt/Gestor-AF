-- ============================================================================
-- 089c · O Kardex tem ordem
-- ============================================================================
-- O teste da 089 pegou: dois lançamentos do mesmo lugar com o mesmo
-- `criado_em` (mesma transação, ou o mesmo segundo) eram ordenados pelo
-- `id`, que é uuid aleatório. O saldo FINAL batia, mas o "saldo anterior"
-- de cada linha saía embaralhado — uma devolução aparecia antes da entrada
-- que a tornou possível. Um Kardex que conta a história fora de ordem não
-- serve para responder "por que o saldo está assim".
--
-- `seq` é a ordem em que o banco gravou. Preenchida nas linhas antigas na
-- ordem física, que para elas é o melhor que existe.
-- ============================================================================
alter table miscelanea_movimento
  add column if not exists seq bigint generated always as identity;

create or replace function miscelanea_kardex(p_item uuid, p_tecnico uuid, p_de date, p_ate date)
returns table (quando timestamptz, tipo text, documento text, outro_lado text,
               saldo_anterior numeric, quantidade numeric, saldo_atual numeric,
               motivo text, quem text)
language sql stable security definer set search_path to 'public' as $fn$
  with mov as materialized (
    select m.*,
           sum(m.quantidade) over (order by m.criado_em, m.seq rows unbounded preceding) as corrido
      from miscelanea_movimento m
     where m.empresa_id = minha_empresa() and m.item_id = p_item
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
$fn$;
