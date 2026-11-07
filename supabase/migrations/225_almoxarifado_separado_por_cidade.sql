-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 225 — O almoxarifado separado por CIDADE (D-336)                      │
-- │                                                                      │
-- │ "não podemos juntar os estoques, estou vendo que o mesmo estoque de  │
-- │  Manaus está aparecendo em São Luís, tem que separar os assuntos"    │
-- │  — Emanuel, 07/11.                                                   │
-- │                                                                      │
-- │ O almoxarifado nasceu (077 a 089) por EMPRESA: nenhuma tabela tinha  │
-- │ cidade, e as regras só filtravam empresa. Decisões do Emanuel        │
-- │ (07/11), as três recomendadas:                                       │
-- │   · a carga do Atlas entra na CIDADE ATIVA do topo;                  │
-- │   · romaneio e transferência entre cidades: BLOQUEADOS;              │
-- │   · cada um vê o estoque só da cidade ativa (como Serviços).         │
-- │                                                                      │
-- │ Como:                                                                │
-- │   · base_id em equipamento, estoque_importacao, romaneio e           │
-- │     miscelanea_movimento (romaneio_item e o evento de estado vão     │
-- │     pela tabela-mãe). O catálogo de miscelânea continua da empresa   │
-- │     — o código SAP é da CLARO.                                       │
-- │   · CARIMBO por gatilho no INSERT: peça e importação = cidade ativa; │
-- │     romaneio = cidade do técnico; movimento de miscelânea = cidade   │
-- │     do romaneio, senão do técnico, senão a ativa (o depósito). Assim │
-- │     nenhuma das ~20 funções que gravam precisou ser reescrita.       │
-- │   · TRAVA no banco: romaneio com técnicos de cidades diferentes,     │
-- │     serial de outra cidade no romaneio e peça indo para técnico de   │
-- │     outra cidade são recusados. O que o CAMPO declara nunca trava a  │
-- │     baixa (D-157): o gatilho do campo só procura a peça na cidade do │
-- │     contrato — de outra cidade, não mexe.                            │
-- │   · LEITURA: as policies e as funções que leem o estoque filtram     │
-- │     bases_visiveis() (a cidade ativa); busca por id de romaneio usa  │
-- │     bases_permitidas() (o técnico confirma o dele de qualquer tela). │
-- │   · Saldo do DEPÓSITO de miscelânea (técnico nulo) passa a ser por   │
-- │     cidade — sem isso, São Luís somaria a entrada de Manaus.         │
-- │   · Importar serial que já é de OUTRA cidade: não é tocado e volta   │
-- │     no resultado ("outra_cidade") — o serial é único na empresa.     │
-- │                                                                      │
-- │ O estoque foi zerado antes, a pedido do Emanuel (07/11; cópia em     │
-- │ /root/copias-almox na VPS). Sobrou 1 movimento de miscelânea         │
-- │ (ENTRADA no depósito, feita de Manaus) — vai para Manaus.            │
-- └──────────────────────────────────────────────────────────────────────┘

-- ── a coluna ────────────────────────────────────────────────────────────
alter table equipamento          add column if not exists base_id uuid references base(id);
alter table estoque_importacao   add column if not exists base_id uuid references base(id);
alter table romaneio             add column if not exists base_id uuid references base(id);
alter table miscelanea_movimento add column if not exists base_id uuid references base(id);

-- o que já existe: pela cidade do técnico, do romaneio, ou de quem gravou
update romaneio r set base_id = coalesce(
    (select t.base_id from tecnico t where t.id = r.tecnico_id),
    (select p.base_id from perfil p where p.id = r.criado_por))
 where base_id is null;
update miscelanea_movimento m set base_id = coalesce(
    (select r.base_id from romaneio r where r.id = m.romaneio_id),
    (select t.base_id from tecnico t where t.id = m.tecnico_id),
    (select p.base_id from perfil p where p.id = m.criado_por))
 where base_id is null;
update equipamento e set base_id = (select i.base_id from estoque_importacao i where i.id = e.importacao_id)
 where base_id is null;

alter table equipamento          alter column base_id set not null;
alter table estoque_importacao   alter column base_id set not null;
alter table romaneio             alter column base_id set not null;
alter table miscelanea_movimento alter column base_id set not null;

create index if not exists equipamento_base_ix          on equipamento (base_id);
create index if not exists romaneio_base_ix             on romaneio (base_id);
create index if not exists miscelanea_movimento_base_ix on miscelanea_movimento (base_id, item_id, tecnico_id);

-- ── as funções de apoio ─────────────────────────────────────────────────
-- A cidade ativa, quando ela é UMA só (bases_visiveis() devolve a ativa). Nula se
-- não houver como saber — e aí o gatilho recusa, em vez de adivinhar (regra 6).
create or replace function base_ativa_unica() returns uuid
language sql stable security definer set search_path = public as $$
  select case when count(*) = 1 then min(b::text)::uuid end from bases_visiveis() b
$$;

-- A cidade do estoque de um técnico; sem técnico (o depósito), a cidade ativa.
create or replace function base_do_estoque(p_tecnico uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select t.base_id from tecnico t where t.id = p_tecnico), base_ativa_unica())
$$;

revoke all on function base_ativa_unica() from public, anon;
revoke all on function base_do_estoque(uuid) from public, anon;
grant execute on function base_ativa_unica() to authenticated, service_role;
grant execute on function base_do_estoque(uuid) to authenticated, service_role;

-- ── o carimbo e a trava ─────────────────────────────────────────────────
create or replace function estoque_carimba_cidade() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_a uuid; v_b uuid;
begin
  if tg_table_name in ('equipamento', 'estoque_importacao') then
    new.base_id := coalesce(new.base_id, base_ativa_unica());

  elsif tg_table_name = 'romaneio' then
    v_a := (select t.base_id from tecnico t where t.id = new.tecnico_id);
    if new.tecnico_origem_id is not null then
      v_b := (select t.base_id from tecnico t where t.id = new.tecnico_origem_id);
      if v_a is distinct from v_b then
        raise exception 'Os dois tecnicos sao de cidades diferentes: o estoque de cada cidade e separado.'
          using errcode = '23514';
      end if;
    end if;
    new.base_id := coalesce(v_a, new.base_id, base_ativa_unica());

  elsif tg_table_name = 'miscelanea_movimento' then
    v_a := (select r.base_id from romaneio r where r.id = new.romaneio_id);
    v_b := (select t.base_id from tecnico t where t.id = new.tecnico_id);
    if v_a is not null and v_b is not null and v_a <> v_b then
      raise exception 'O tecnico e de outra cidade: o estoque de cada cidade e separado.'
        using errcode = '23514';
    end if;
    new.base_id := coalesce(new.base_id, v_a, v_b, base_ativa_unica());
  end if;

  if new.base_id is null then
    raise exception 'Escolha a cidade no topo da tela antes de mexer no estoque.' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function estoque_guarda_cidade_da_peca() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.base_id is distinct from old.base_id then
    raise exception 'A cidade de uma peca nao muda.' using errcode = '23514';
  end if;
  if new.posse_tecnico_id is not null and new.posse_tecnico_id is distinct from old.posse_tecnico_id
     and (select t.base_id from tecnico t where t.id = new.posse_tecnico_id) is distinct from new.base_id then
    raise exception 'O serial % e do estoque de outra cidade: nao vai para tecnico de outra cidade.', new.serial
      using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function estoque_guarda_cidade_do_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.equipamento_id is not null
     and (select e.base_id from equipamento e where e.id = new.equipamento_id)
         is distinct from (select r.base_id from romaneio r where r.id = new.romaneio_id) then
    raise exception 'Este serial e do estoque de outra cidade.' using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function estoque_carimba_cidade() from public, anon;
revoke all on function estoque_guarda_cidade_da_peca() from public, anon;
revoke all on function estoque_guarda_cidade_do_item() from public, anon;

drop trigger if exists estoque_carimba_cidade on equipamento;
drop trigger if exists estoque_carimba_cidade on estoque_importacao;
drop trigger if exists estoque_carimba_cidade on romaneio;
drop trigger if exists estoque_carimba_cidade on miscelanea_movimento;
create trigger estoque_carimba_cidade before insert on equipamento          for each row execute function estoque_carimba_cidade();
create trigger estoque_carimba_cidade before insert on estoque_importacao   for each row execute function estoque_carimba_cidade();
create trigger estoque_carimba_cidade before insert on romaneio             for each row execute function estoque_carimba_cidade();
create trigger estoque_carimba_cidade before insert on miscelanea_movimento for each row execute function estoque_carimba_cidade();

drop trigger if exists estoque_guarda_cidade on equipamento;
create trigger estoque_guarda_cidade before update on equipamento
  for each row execute function estoque_guarda_cidade_da_peca();
drop trigger if exists estoque_guarda_cidade on romaneio_item;
create trigger estoque_guarda_cidade before insert on romaneio_item
  for each row execute function estoque_guarda_cidade_do_item();

-- ── as funções que leem e gravam o estoque (versão viva + o filtro de cidade) ──

-- estoque_posicao
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
     where p.ok and e.empresa_id = minha_empresa() and e.base_id in (select bases_visiveis())
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
       where i.empresa_id = minha_empresa() and i.base_id in (select bases_visiveis())
       order by i.criado_em desc limit 1)
  );
$function$;

-- estoque_cargas
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
     where e.empresa_id = minha_empresa() and e.base_id in (select bases_visiveis()) and e.posse = 'COM_TECNICO'
  ), mi as materialized (
    select m.tecnico_id tid, m.item_id, sum(m.quantidade) q
      from miscelanea_movimento m
     where m.empresa_id = minha_empresa() and m.base_id in (select bases_visiveis()) and m.tecnico_id is not null
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

-- estoque_movimentacoes
CREATE OR REPLACE FUNCTION public.estoque_movimentacoes(p_de date, p_ate date)
 RETURNS TABLE(quando timestamp with time zone, tipo text, documento text, serial text, item text, quantidade numeric, de text, para text, quem text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with r as materialized (
    select r.* from romaneio r
     where r.empresa_id = minha_empresa() and r.base_id in (select bases_visiveis()) and r.situacao = 'CONFIRMADO'
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
   where m.empresa_id = minha_empresa() and m.base_id in (select bases_visiveis()) and m.tipo in ('ENTRADA', 'AJUSTE', 'CONSUMO')
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
   where v.empresa_id = minha_empresa() and v.base_id in (select bases_visiveis())
     and (m.criado_em at time zone 'America/Manaus')::date between p_de and p_ate
     and exists (select 1 from equipamento e where e.empresa_id = v.empresa_id and e.base_id = v.base_id and e.serial = m.serial)
     and (select tem_permissao('almoxarifado.ver'))
  order by 1 desc;
$function$;

-- estoque_historico_serial
CREATE OR REPLACE FUNCTION public.estoque_historico_serial(p_serial text)
 RETURNS TABLE(quando timestamp with time zone, tipo text, descricao text, quem text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with e as materialized (
    select * from equipamento
     where empresa_id = minha_empresa() and base_id in (select bases_visiveis())
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
   where exists (select 1 from visita v where v.id = m.visita_id and v.empresa_id = minha_empresa())
  order by 1 desc;
$function$;

-- miscelanea_saldos
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
     where p.ok and m.empresa_id = minha_empresa() and m.base_id in (select bases_visiveis())
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
   where p.ok and i.empresa_id = minha_empresa() and i.ativo
   order by i.tipo nulls last, i.nome;
$function$;

-- miscelanea_kardex
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
     where m.empresa_id = minha_empresa() and m.base_id in (select bases_visiveis()) and m.item_id = p_item
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

-- confirmar_romaneio
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
     set posse = v_destino, posse_tecnico_id = v_tec, posse_em = now(), posse_por = auth.uid(),
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

-- ajustar_saldo_miscelanea
CREATE OR REPLACE FUNCTION public.ajustar_saldo_miscelanea(p_item uuid, p_tecnico uuid, p_contado numeric, p_motivo text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp uuid := minha_empresa(); v_atual numeric; v_dif numeric;
begin
  perform almox_pode_mexer();
  if p_contado is null or p_contado < 0 then
    raise exception 'A contagem e um numero de zero para cima.' using errcode = '23514';
  end if;
  if btrim(coalesce(p_motivo,'')) = '' then
    raise exception 'Ajuste exige motivo (inventario, perda, achado...).' using errcode = '23514';
  end if;
  if not exists (select 1 from item_miscelanea where id = p_item and empresa_id = v_emp) then
    raise exception 'Item nao encontrado.' using errcode = 'P0002';
  end if;
  select coalesce(sum(quantidade), 0) into v_atual from miscelanea_movimento
   where item_id = p_item and tecnico_id is not distinct from p_tecnico and empresa_id = v_emp
     and base_id = base_do_estoque(p_tecnico);
  v_dif := p_contado - v_atual;
  if v_dif = 0 then return 0; end if;
  insert into miscelanea_movimento (empresa_id, item_id, tecnico_id, quantidade, tipo, motivo, criado_por)
  values (v_emp, p_item, p_tecnico, v_dif, 'AJUSTE',
          format('auditoria: contado %s, sistema dizia %s — %s', p_contado, v_atual, btrim(p_motivo)),
          auth.uid());
  return v_dif;
end;
$function$;

-- conferencia_estoque_toa
CREATE OR REPLACE FUNCTION public.conferencia_estoque_toa(p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp   uuid := minha_empresa();
  v_hoje  date := hoje_local();
  v_ate   date := coalesce(p_ate, hoje_local());
  v_de    date := coalesce(p_de, coalesce(p_ate, hoje_local()) - 30);
  v_prazo int;
  v_res   jsonb;
begin
  if not tem_permissao('almoxarifado.ver') then
    raise exception 'Sem permissao para ver o almoxarifado.' using errcode = '42501';
  end if;
  if v_de > v_ate then
    raise exception 'Periodo invertido.' using errcode = '22023';
  end if;
  if v_ate - v_de > 92 then
    raise exception 'Periodo de ate 3 meses.' using errcode = '22023';
  end if;

  select (valor #>> '{}')::int into v_prazo
    from parametro where empresa_id = v_emp and chave = 'retirado_devolutiva_dias';
  v_prazo := coalesce(v_prazo, 7);

  with vis as materialized (
    -- Os contratos que o TOA encerrou, na cidade ativa e no período.
    select v.id, v.contrato, v.data_agendada as dia, v.tecnico_responsavel_id as tec,
           v.equipe_id, v.toa_varrido_em
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.empresa_id = v_emp
       and v.base_id in (select bases_visiveis())
       and v.data_agendada between v_de and v_ate
       and v.excluido_em is null
       and coalesce(v.finalizado_toa, false)
       and coalesce(ta.natureza, '') <> 'JORNADA'
  ),
  toa as materialized (
    -- O que o TOA diz, só dos contratos LIDOS; item com serial.
    select vi.id as visita_id, vi.contrato, vi.dia, vi.tec, vi.equipe_id,
           t.secao, upper(regexp_replace(t.serial, '\s', '', 'g')) as serial,
           t.tipo as eq_tipo, t.modelo, t.lido_em
      from vis vi
      join visita_equipamento_toa t on t.visita_id = vi.id
     where vi.toa_varrido_em is not null
       and not t.miscelanea
       and t.secao in ('INSTALADO', 'DESINSTALADO')
  ),
  cruz as materialized (
    select o.*, e.id as equip_id, e.serial as serial_cadastro,
           e.posse, e.posse_tecnico_id, e.posse_em,
           m.posse_antes, m.posse_tecnico_antes, (m.id is not null) as campo_lancou,
           -- a posse que vale para "estava na carga de quem": antes do
           -- lançamento do campo neste contrato, ou a de agora
           case when m.id is not null then m.posse_antes else e.posse end as posse_ref,
           case when m.id is not null then m.posse_tecnico_antes else e.posse_tecnico_id end as tec_ref
      from toa o
      left join lateral (
        select e.* from equipamento e
         where e.empresa_id = v_emp and e.base_id in (select bases_visiveis()) and e.serial in (o.serial, '*' || o.serial)
         order by (e.serial = o.serial) desc
         limit 1) e on true
      left join lateral (
        select m.* from equipamento_movimento m
         where m.visita_id = o.visita_id and m.serial = o.serial
           and m.operacao = case o.secao when 'INSTALADO' then 'INSTALADO' else 'RETIRADO' end
         order by m.criado_em
         limit 1) m on true
  ),
  classe as materialized (
    select c.*,
           case
             when c.secao = 'INSTALADO' and c.equip_id is null then 'SEM_CADASTRO'
             when c.secao = 'INSTALADO' and c.posse_ref = 'COM_TECNICO'
                  and (case when c.tec is not null then c.tec_ref = c.tec
                            else (select t.equipe_id from tecnico t where t.id = c.tec_ref)
                                   is not distinct from c.equipe_id end)
                  then case when c.campo_lancou then null else 'POSSE_NAO_BAIXADA' end
             when c.secao = 'INSTALADO' and c.posse_ref = 'COM_TECNICO' then 'CARGA_DE_OUTRO'
             -- COM_ASSINANTE sem lançamento neste contrato é peça que, para nós,
             -- estava em outro cliente: também não saiu da carga de ninguém.
             when c.secao = 'INSTALADO' then 'FORA_DA_CARGA'
             when c.secao = 'DESINSTALADO' and v_hoje - c.dia > v_prazo
                  and not (
                    -- devolutiva confirmada depois do contrato…
                    (c.equip_id is not null and exists (
                       select 1 from romaneio_item ri
                         join romaneio r on r.id = ri.romaneio_id
                        where ri.equipamento_id = c.equip_id
                          and r.tipo = 'DEVOLUCAO' and r.situacao = 'CONFIRMADO'
                          and (r.confirmado_em at time zone 'America/Manaus')::date >= c.dia))
                    -- …ou a peça já está de volta, por qualquer documento
                    -- (coalesce: peça fora do cadastro tem posse NULA, e `not null`
                    --  é nulo — a linha sumia da fila calada; pegou no 1º teste)
                    or coalesce(c.posse in ('NO_ALMOXARIFADO', 'DEVOLVIDO_CLARO')
                        and (c.posse_em at time zone 'America/Manaus')::date >= c.dia, false))
                  then 'RETIRADO_SEM_DEVOLUTIVA'
           end as tipo
      from cruz c
  ),
  campo as materialized (
    -- O que o técnico lançou num contrato LIDO e o TOA não mostra.
    select vi.id as visita_id, vi.contrato, vi.dia, vi.tec, vi.equipe_id,
           case m.operacao when 'INSTALADO' then 'INSTALADO' else 'DESINSTALADO' end as secao,
           m.serial, m.tipo as eq_tipo, m.modelo, null::timestamptz as lido_em,
           m.tecnico_id as tec_lancou, m.criado_em as lancado_em
      from vis vi
      join equipamento_movimento m on m.visita_id = vi.id
     where vi.toa_varrido_em is not null
       and not exists (
         select 1 from visita_equipamento_toa t
          where t.visita_id = vi.id and not t.miscelanea
            and upper(regexp_replace(t.serial, '\s', '', 'g')) = m.serial
            and t.secao = case m.operacao when 'INSTALADO' then 'INSTALADO' else 'DESINSTALADO' end)
  ),
  fila as (
    select k.tipo, k.visita_id, k.contrato, k.dia, k.tec, k.equipe_id, k.secao, k.serial,
           k.eq_tipo, k.modelo, k.lido_em, k.posse, k.posse_tecnico_id, k.posse_em,
           k.tec_ref, null::timestamptz as lancado_em
      from classe k
     where k.tipo is not null
    union all
    select 'LANCADO_SEM_TOA', c.visita_id, c.contrato, c.dia, c.tec, c.equipe_id, c.secao, c.serial,
           c.eq_tipo, c.modelo, c.lido_em, e.posse, e.posse_tecnico_id, e.posse_em,
           c.tec_lancou, c.lancado_em
      from campo c
      left join equipamento e on e.empresa_id = v_emp and e.base_id in (select bases_visiveis()) and e.serial = c.serial
  ),
  itens as (
    select f.*, tr.motivo, tr.tratada_em,
           (select p.nome from perfil p where p.id = tr.tratada_por) as tratada_por
      from fila f
      left join conferencia_toa_tratada tr
        on tr.visita_id = f.visita_id and tr.tipo = f.tipo and tr.serial = f.serial
  )
  select jsonb_build_object(
    'de', v_de, 'ate', v_ate, 'prazo_retirado_dias', v_prazo,
    'cadastro_pecas', (select count(*) from equipamento where empresa_id = v_emp and base_id in (select bases_visiveis())),
    'contratos', jsonb_build_object(
      'encerrados', (select count(*) from vis),
      'conferidos', (select count(*) from vis where toa_varrido_em is not null),
      'nao_conferidos', (select count(*) from vis where toa_varrido_em is null)),
    'seriais_lidos', jsonb_build_object(
      'instalados', (select count(*) from toa where secao = 'INSTALADO'),
      'retirados', (select count(*) from toa where secao = 'DESINSTALADO')),
    -- retirado ainda dentro do prazo: não é divergência, mas é o que vem
    'retirados_no_prazo', (select count(*) from classe
                            where secao = 'DESINSTALADO' and v_hoje - dia <= v_prazo),
    'por_tipo', coalesce((
      select jsonb_object_agg(x.tipo, jsonb_build_object('abertas', x.a, 'tratadas', x.t))
        from (select tipo, count(*) filter (where motivo is null) a,
                     count(*) filter (where motivo is not null) t
                from itens group by tipo) x), '{}'::jsonb),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tipo', i.tipo, 'visita_id', i.visita_id, 'contrato', i.contrato, 'dia', i.dia,
               'secao', i.secao, 'serial', i.serial, 'equipamento', i.eq_tipo, 'modelo', i.modelo,
               'tecnico', (select t.nome from tecnico t where t.id = i.tec),
               'equipe', (select q.codigo from equipe q where q.id = i.equipe_id),
               'posse', i.posse,
               'posse_tecnico', (select t.nome from tecnico t where t.id = i.posse_tecnico_id),
               'posse_em', i.posse_em,
               -- CARGA_DE_OUTRO: de quem era; LANCADO_SEM_TOA: quem lançou
               'outro_tecnico', case when i.tipo in ('CARGA_DE_OUTRO', 'LANCADO_SEM_TOA')
                                     then (select t.nome from tecnico t where t.id = i.tec_ref) end,
               'dias', v_hoje - i.dia,
               'lido_em', i.lido_em, 'lancado_em', i.lancado_em,
               'tratada', case when i.motivo is not null then jsonb_build_object(
                             'motivo', i.motivo, 'em', i.tratada_em, 'por', i.tratada_por) end)
             order by i.dia desc, i.contrato, i.serial)
        from itens i), '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$function$;

-- romaneio_por_serial
CREATE OR REPLACE FUNCTION public.romaneio_por_serial(p_romaneio uuid, p_serial text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_r romaneio%rowtype; v_e equipamento%rowtype; v_serial text; v_outro int;
  v_efetivo text; v_venc jsonb;
begin
  perform almox_pode_mexer();
  select * into v_r from romaneio where id = p_romaneio and empresa_id = minha_empresa() and base_id in (select bases_permitidas());
  if not found then raise exception 'Romaneio nao encontrado.' using errcode='P0002'; end if;
  if v_r.situacao <> 'ABERTO' then
    raise exception 'Romaneio % ja esta %.', v_r.numero, lower(v_r.situacao)
      using errcode = '23514';
  end if;

  v_serial := upper(regexp_replace(coalesce(p_serial,''), '\s', '', 'g'));
  select * into v_e from equipamento
   where empresa_id = v_r.empresa_id and base_id = v_r.base_id and serial = v_serial;
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
  if v_r.tipo = 'TRANSFERENCIA'
     and (v_e.posse is distinct from 'COM_TECNICO'
          or v_e.posse_tecnico_id is distinct from v_r.tecnico_origem_id) then
    raise exception 'A peca % nao esta com o tecnico de origem.', v_serial
      using errcode = '23514';
  end if;

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
$function$;

-- romaneio_por_seriais
CREATE OR REPLACE FUNCTION public.romaneio_por_seriais(p_romaneio uuid, p_seriais text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_r        romaneio%rowtype;
  v_serial   text;
  v_res      jsonb;
  v_linhas   jsonb := '[]'::jsonb;
  v_ok       int := 0;
  v_recusa   int := 0;
  v_vistos   text[] := '{}';
begin
  perform almox_pode_mexer();

  -- O documento é conferido UMA vez, antes do laço: romaneio fechado
  -- recusaria cada serial com a mesma frase, e a tela mostraria dez
  -- recusas iguais para um problema só.
  select * into v_r from romaneio
   where id = p_romaneio and empresa_id = minha_empresa() and base_id in (select bases_permitidas());
  if not found then
    raise exception 'Romaneio nao encontrado.' using errcode = 'P0002';
  end if;
  if v_r.situacao <> 'ABERTO' then
    raise exception 'Romaneio % ja esta %.', v_r.numero, lower(v_r.situacao)
      using errcode = '23514';
  end if;

  -- Teto por chamada. Não é regra de negócio: é o tamanho de um corpo de
  -- requisição que não estoura o tempo. A tela manda em lotes.
  if coalesce(array_length(p_seriais, 1), 0) > 500 then
    raise exception 'No maximo 500 seriais por vez (vieram %).',
      array_length(p_seriais, 1) using errcode = '22023';
  end if;

  foreach v_serial in array coalesce(p_seriais, '{}') loop
    -- Mesma normalização de `romaneio_por_serial`, para o "repetido na
    -- lista" enxergar `abc 123` e `ABC123` como a mesma peça.
    v_serial := upper(regexp_replace(coalesce(v_serial, ''), '\s', '', 'g'));
    continue when v_serial = '';

    if v_serial = any(v_vistos) then
      v_linhas := v_linhas || jsonb_build_object(
        'serial', v_serial, 'ok', false, 'erro', 'Repetido na lista.');
      v_recusa := v_recusa + 1;
      continue;
    end if;
    v_vistos := v_vistos || v_serial;

    -- Cada serial no seu próprio sub-bloco: a recusa de um desfaz só o
    -- dele, e os outros continuam lançados.
    begin
      v_res := romaneio_por_serial(p_romaneio, v_serial);
      v_linhas := v_linhas || jsonb_build_object(
        'serial', v_serial, 'ok', true,
        'tipo', v_res->>'tipo', 'modelo', v_res->>'modelo',
        'alerta', v_res->>'alerta',
        'estado_afline', v_res->>'estado_afline');
      v_ok := v_ok + 1;
    exception when others then
      v_linhas := v_linhas || jsonb_build_object(
        'serial', v_serial, 'ok', false, 'erro', sqlerrm);
      v_recusa := v_recusa + 1;
    end;
  end loop;

  return jsonb_build_object('numero', v_r.numero, 'lancadas', v_ok,
                            'recusadas', v_recusa, 'linhas', v_linhas);
end;
$function$;

-- romaneio_por_item
CREATE OR REPLACE FUNCTION public.romaneio_por_item(p_romaneio uuid, p_item uuid, p_quantidade numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_r romaneio%rowtype; v_id uuid;
begin
  perform almox_pode_mexer();
  select * into v_r from romaneio where id = p_romaneio and empresa_id = minha_empresa() and base_id in (select bases_permitidas());
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
$function$;

-- posse_do_movimento_do_campo
CREATE OR REPLACE FUNCTION public.posse_do_movimento_do_campo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp uuid; v_contrato text; v_e equipamento%rowtype;
  v_destino text; v_tec uuid;
begin
  select v.empresa_id, v.contrato into v_emp, v_contrato
    from visita v where v.id = new.visita_id;
  if v_emp is null then return null; end if;

  select * into v_e from equipamento
   where empresa_id = v_emp and serial = new.serial
     and base_id = (select v.base_id from visita v where v.id = new.visita_id);
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
  return null;
end;
$function$;

-- editar_equipamento
CREATE OR REPLACE FUNCTION public.editar_equipamento(p_movimento uuid, p_operacao text, p_serial text, p_tipo text DEFAULT NULL::text, p_modelo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m equipamento_movimento%rowtype;
  v_serial text; v_tipo text; v_modelo text;
  v_tecnico uuid; v_login text; v_origem text; v_campo boolean;
  v_contrato text; v_e equipamento%rowtype;
  v_posse text; v_novo uuid;
begin
  select * into m from equipamento_movimento where id = p_movimento;
  if not found then
    raise exception 'Lancamento nao encontrado.' using errcode = 'P0002';
  end if;

  perform pode_anexar_na_visita(m.visita_id);

  v_campo := tem_papel('TECNICO') and not (select eh_gestor())
             and not (tem_papel('CONTROLADOR') or (tem_papel('SUPERVISOR') and not (select supervisor_esta_em_campo())));
  v_tecnico := meu_tecnico_id();
  if v_campo and m.tecnico_id is distinct from v_tecnico then
    raise exception 'Voce so corrige o equipamento que voce lancou.' using errcode = '42501';
  end if;

  if p_operacao not in ('INSTALADO','RETIRADO') then
    raise exception 'Operacao deve ser INSTALADO ou RETIRADO.' using errcode = '23514';
  end if;
  v_serial := upper(regexp_replace(coalesce(p_serial,''), '\s', '', 'g'));
  if length(v_serial) < 4 then
    raise exception 'Serial invalido.' using errcode = '23514';
  end if;
  v_tipo := nullif(btrim(coalesce(p_tipo,'')),'');
  v_modelo := nullif(btrim(coalesce(p_modelo,'')),'');

  v_login := coalesce((select matricula from tecnico where id = v_tecnico),
                      (select email from perfil where id = auth.uid()));
  v_origem := case when v_campo then 'MOBILE' else 'WEB' end;

  if v_serial = m.serial and p_operacao = m.operacao then
    update equipamento_movimento set tipo = v_tipo, modelo = v_modelo where id = m.id;
    insert into visita_evento (visita_id, os_id, tipo, para, origem, usuario_id,
                               login, tecnico_id, observacao)
    values (m.visita_id, m.os_id, 'EQUIPAMENTO',
            jsonb_build_object('corrigido', true, 'operacao', m.operacao, 'serial', m.serial,
                               'tipo', v_tipo, 'modelo', v_modelo),
            v_origem, auth.uid(), v_login, v_tecnico,
            'Equipamento corrigido: tipo/modelo');
    return m.id;
  end if;

  if exists (select 1 from equipamento_movimento
              where visita_id = m.visita_id and serial = v_serial
                and operacao = p_operacao and id <> m.id) then
    raise exception 'Este serial ja esta lancado neste contrato.' using errcode = '23505';
  end if;

  select contrato into v_contrato from visita where id = m.visita_id;
  select e.* into v_e from equipamento e
    join visita v on v.id = m.visita_id and v.empresa_id = e.empresa_id and v.base_id = e.base_id
   where e.serial = m.serial;
  if not found then
    v_posse := 'peca fora do cadastro: posse nao mexida';
  elsif not m.antes_registrado then
    v_posse := 'lancamento anterior a 126: posse do serial antigo nao desfeita, conferir';
  elsif v_e.posse_em < m.criado_em
        or v_e.posse_motivo not like 'campo: ' || lower(m.operacao) || ' no contrato '
                                     || coalesce(v_contrato, '?') || '%' then
    v_posse := 'a peca ja mudou depois do lancamento: posse do serial antigo nao desfeita';
  else
    update equipamento
       set posse = m.posse_antes, posse_tecnico_id = m.posse_tecnico_antes,
           condicao = m.condicao_antes, posse_em = now(), posse_por = auth.uid(),
           posse_motivo = 'campo: lancamento corrigido no contrato '
                          || coalesce(v_contrato, '?') || ' (volta ao estado anterior)',
           atualizado_em = now()
     where id = v_e.id;
    v_posse := 'posse do serial antigo desfeita';
  end if;

  delete from equipamento_movimento where id = m.id;
  insert into equipamento_movimento (visita_id, os_id, operacao, serial, tipo, modelo,
                                     tecnico_id, usuario_id, login, origem, observacao)
  values (m.visita_id, m.os_id, p_operacao, v_serial, v_tipo, v_modelo,
          v_tecnico, auth.uid(), v_login, v_origem, m.observacao)
  returning id into v_novo;

  insert into visita_evento (visita_id, os_id, tipo, para, origem, usuario_id,
                             login, tecnico_id, observacao)
  values (m.visita_id, m.os_id, 'EQUIPAMENTO',
          jsonb_build_object('corrigido', true,
                             'de', jsonb_build_object('operacao', m.operacao, 'serial', m.serial),
                             'operacao', p_operacao, 'serial', v_serial,
                             'tipo', v_tipo, 'modelo', v_modelo),
          v_origem, auth.uid(), v_login, v_tecnico,
          'Equipamento corrigido: ' || m.serial || ' -> ' || v_serial || ' (' || v_posse || ')');

  return v_novo;
end;
$function$;

-- declarar_estado_equipamento
CREATE OR REPLACE FUNCTION public.declarar_estado_equipamento(p_equipamento uuid, p_estado text, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   where id = p_equipamento and empresa_id = minha_empresa() and base_id in (select bases_visiveis())
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
$function$;

-- importar_estoque
CREATE OR REPLACE FUNCTION public.importar_estoque(p_arquivo text, p_formato text, p_linhas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp uuid; v_imp uuid; v_l jsonb; v_serial text;
  v_criados int := 0; v_atualizados int := 0; v_ignorados int := 0;
  v_existe boolean;
  -- 225 (D-336): a cidade da carga e os seriais que ja sao de outra cidade
  v_base uuid := base_ativa_unica(); v_base_peca uuid; v_outra int := 0; v_outras text[] := '{}';
begin
  if not ((select eh_gestor()) or tem_papel('ALMOXARIFE')) then
    raise exception 'Sem permissao para importar estoque.' using errcode = '42501';
  end if;
  if not tem_permissao('almoxarifado.importar') then
    raise exception 'Seu perfil de acesso nao inclui "Importar a carga".'
      using errcode = '42501';
  end if;

  v_emp := minha_empresa();
  if v_base is null then
    raise exception 'Escolha a cidade no topo da tela antes de importar a carga.' using errcode = '23514';
  end if;
  insert into estoque_importacao (empresa_id, base_id, arquivo, formato, linhas, criado_por)
  values (v_emp, v_base, p_arquivo, p_formato, jsonb_array_length(p_linhas), auth.uid())
  returning id into v_imp;

  for v_l in select * from jsonb_array_elements(p_linhas) loop
    v_serial := upper(regexp_replace(coalesce(v_l->>'serial',''), '\s', '', 'g'));
    if length(v_serial) < 4 then
      v_ignorados := v_ignorados + 1;
      continue;
    end if;

    v_existe := null; v_base_peca := null;
    select true, base_id into v_existe, v_base_peca from equipamento
     where empresa_id = v_emp and serial = v_serial;
    -- 225: serial que ja e de OUTRA cidade nao e tocado (o serial e unico na empresa)
    if v_base_peca is not null and v_base_peca <> v_base then
      v_outra := v_outra + 1;
      if cardinality(v_outras) < 20 then v_outras := v_outras || v_serial; end if;
      continue;
    end if;

    insert into equipamento (
      empresa_id, base_id, serial, enderecavel, tipo, modelo, item_jde, material_sap,
      operacao, estado_atlas, local_atlas, tipo_local_atlas, responsavel_atlas,
      contrato_atlas, classificacao, empresa_material, reusos, atlas_em,
      posse, dados_origem, importacao_id)
    values (
      v_emp, v_base, v_serial,
      nullif(btrim(coalesce(v_l->>'enderecavel','')),''),
      nullif(btrim(coalesce(v_l->>'tipo','')),''),
      nullif(btrim(coalesce(v_l->>'modelo','')),''),
      nullif(btrim(coalesce(v_l->>'item_jde','')),''),
      nullif(btrim(coalesce(v_l->>'material_sap','')),''),
      nullif(btrim(coalesce(v_l->>'operacao','')),''),
      nullif(btrim(coalesce(v_l->>'estado_atlas','')),''),
      nullif(btrim(coalesce(v_l->>'local_atlas','')),''),
      nullif(btrim(coalesce(v_l->>'tipo_local_atlas','')),''),
      nullif(btrim(coalesce(v_l->>'responsavel_atlas','')),''),
      nullif(btrim(coalesce(v_l->>'contrato_atlas','')),''),
      nullif(btrim(coalesce(v_l->>'classificacao','')),''),
      nullif(btrim(coalesce(v_l->>'empresa_material','')),''),
      nullif(v_l->>'reusos','')::int,
      nullif(v_l->>'atlas_em','')::timestamptz,
      case when upper(coalesce(v_l->>'tipo_local_atlas','')) = 'ASSINANTE'
           then 'COM_ASSINANTE' end,
      v_l, v_imp)
    on conflict (empresa_id, serial) do update set
      enderecavel       = coalesce(excluded.enderecavel, equipamento.enderecavel),
      tipo              = coalesce(excluded.tipo, equipamento.tipo),
      modelo            = coalesce(excluded.modelo, equipamento.modelo),
      item_jde          = coalesce(excluded.item_jde, equipamento.item_jde),
      material_sap      = coalesce(excluded.material_sap, equipamento.material_sap),
      operacao          = coalesce(excluded.operacao, equipamento.operacao),
      estado_atlas      = coalesce(excluded.estado_atlas, equipamento.estado_atlas),
      local_atlas       = coalesce(excluded.local_atlas, equipamento.local_atlas),
      tipo_local_atlas  = coalesce(excluded.tipo_local_atlas, equipamento.tipo_local_atlas),
      responsavel_atlas = coalesce(excluded.responsavel_atlas, equipamento.responsavel_atlas),
      contrato_atlas    = coalesce(excluded.contrato_atlas, equipamento.contrato_atlas),
      classificacao     = coalesce(excluded.classificacao, equipamento.classificacao),
      empresa_material  = coalesce(excluded.empresa_material, equipamento.empresa_material),
      reusos            = coalesce(excluded.reusos, equipamento.reusos),
      atlas_em          = coalesce(excluded.atlas_em, equipamento.atlas_em),
      posse             = case
                            when upper(coalesce(excluded.tipo_local_atlas,'')) = 'ASSINANTE'
                            then 'COM_ASSINANTE' else equipamento.posse end,
      dados_origem      = excluded.dados_origem,
      importacao_id     = excluded.importacao_id,
      atualizado_em     = now();

    if v_existe then v_atualizados := v_atualizados + 1;
    else v_criados := v_criados + 1; end if;
  end loop;

  update estoque_importacao
     set criados = v_criados, atualizados = v_atualizados, ignorados = v_ignorados
   where id = v_imp;

  return jsonb_build_object('importacao', v_imp, 'linhas', jsonb_array_length(p_linhas),
                            'criados', v_criados, 'atualizados', v_atualizados,
                            'ignorados', v_ignorados,
                            'outra_cidade', v_outra, 'seriais_outra_cidade', to_jsonb(v_outras));
end;
$function$;

-- ── a leitura direta (a web lê equipamento e romaneio pela tabela) ─────
alter policy equipamento_leitura on equipamento using (
  empresa_id = (select minha_empresa())
  and (select tem_permissao('almoxarifado.ver'))
  and base_id in (select bases_visiveis()));

alter policy equipamento_estado_evento_leitura on equipamento_estado_evento using (
  empresa_id = (select minha_empresa())
  and (select tem_permissao('almoxarifado.ver'))
  and equipamento_id in (select e.id from equipamento e));

alter policy estoque_importacao_leitura on estoque_importacao using (
  empresa_id = (select minha_empresa())
  and base_id in (select bases_visiveis()));

alter policy miscelanea_movimento_leitura on miscelanea_movimento using (
  empresa_id = (select minha_empresa())
  and (select tem_permissao('almoxarifado.ver'))
  and base_id in (select bases_visiveis()));

-- o técnico continua vendo o romaneio DELE; o almoxarifado, os da cidade ativa
alter policy romaneio_leitura on romaneio using (
  empresa_id = (select minha_empresa())
  and ( tecnico_id = (select meu_tecnico_id())
     or tecnico_origem_id = (select meu_tecnico_id())
     or ((select tem_permissao('almoxarifado.ver')) and base_id in (select bases_visiveis()))));

-- Sinalizações: o pedido de FERRAMENTAL que o almoxarifado lê vinha de TODAS as
-- cidades. Agora, como as ocorrências, só dos técnicos da cidade ativa.
alter policy sinalizacao_leitura on sinalizacao_material using (
  empresa_id = (select minha_empresa())
  and ( tecnico_id = (select meu_tecnico_id())
     or ( tecnico_id in (select t.id from tecnico t where t.base_id in (select bases_visiveis()))
          and ( (assunto = 'FERRAMENTAL' and (select tem_permissao('almoxarifado.ver')))
             or (select tem_permissao('campo.ocorrencias')) ))));

notify pgrst, 'reload schema';
