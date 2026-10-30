-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 156e · A OBSERVAÇÃO DO COP e a CASA DO CLIENTE                   ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "um campo de observacao COP. Esse campo serve para o COP ou
-- >  controlador adicionar informacoes importantes para o tecnico
-- >  visualizar no app dele. Por exemplo, o cliente estara somente as
-- >  14 horas (...) essas informacoes precisam ir tambem para o
-- >  aplicativo"
-- > "na hora que o tecnico baixar no aplicativo, o sistema deve
-- >  informar para ele setar a localizacao do cliente (...) quando for
-- >  um outro tecnico la, na residencia do cliente, a gente ja sabe
-- >  onde e (...) um campo de casa do cliente"  -- Emanuel, 30/10
--
-- Decisao dele (30/10): marcar a casa e PERGUNTA, pode pular.
--
-- ═══ 1. A OBSERVAÇÃO ═══════════════════════════════════════════════
--
-- Coluna PROPRIA, nao `visita.observacao`: aquela existe, esta vazia nos
-- 5.531 contratos de 30 dias, e e escrita por funcoes que eu nao li uma a
-- uma (a importacao entre elas). Nota do COP apagada pela importacao das
-- 14h seria o pior defeito possivel aqui -- o tecnico iria as 10h.
--
-- So uma porta escreve: `definir_observacao_cop`. RLS nao protege
-- coluna (D-050); quem protege e o gatilho, que recusa mudanca na nota
-- fora da porta. O aviso ao tecnico vai pelo FUNIL (visita_evento ->
-- aviso_do_evento), como todo aviso desde a 059.

alter table visita add column if not exists observacao_cop text;
alter table visita add column if not exists observacao_cop_em timestamptz;
alter table visita add column if not exists observacao_cop_por uuid references perfil(id);

create or replace function guarda_observacao_cop() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.observacao_cop is distinct from old.observacao_cop
      or new.observacao_cop_em is distinct from old.observacao_cop_em
      or new.observacao_cop_por is distinct from old.observacao_cop_por)
     and coalesce(current_setting('app.observacao_cop', true), '') <> '1' then
    raise exception 'A observacao do COP so muda pela tela do contrato.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function guarda_observacao_cop() from public, anon;

drop trigger if exists trg_visita_observacao_cop on visita;
create trigger trg_visita_observacao_cop before update on visita
  for each row execute function guarda_observacao_cop();

create or replace function definir_observacao_cop(p_visita uuid, p_texto text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v visita%rowtype; v_txt text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  -- "COP ou controlador". Supervisor, so se o ADMIN der a permissao.
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_permissao('servicos.editar')) then
    raise exception 'Sem permissao para escrever a observacao.' using errcode = '42501';
  end if;
  select * into v from visita
   where id = p_visita and empresa_id = minha_empresa() and excluido_em is null
     and base_id in (select bases_visiveis())
     and (eh_gestor() or equipe_id in (select equipes_visiveis()));
  if not found then raise exception 'Contrato nao encontrado.'; end if;
  if v_txt is not distinct from v.observacao_cop then
    return jsonb_build_object('mudou', false);
  end if;
  if length(v_txt) > 500 then
    raise exception 'Observacao longa demais (maximo 500 caracteres).';
  end if;

  perform set_config('app.observacao_cop', '1', true);
  update visita set observacao_cop = v_txt,
                    observacao_cop_em = case when v_txt is null then null else now() end,
                    observacao_cop_por = case when v_txt is null then null else auth.uid() end
   where id = v.id;
  perform set_config('app.observacao_cop', '', true);

  -- O funil: o historico guarda, e o gatilho do aviso leva ao tecnico.
  insert into visita_evento (visita_id, usuario_id, equipe_id, tipo, observacao, origem)
  values (v.id, auth.uid(), v.equipe_id, 'OBSERVACAO_COP',
          coalesce(v_txt, '(observacao apagada)'), 'WEB');

  return jsonb_build_object('mudou', true, 'texto', v_txt);
end $$;
revoke all on function definir_observacao_cop(uuid, text) from public, anon;
grant execute on function definir_observacao_cop(uuid, text) to authenticated;

-- Lista fechada em CHECK pega tipo novo (traps.md): amplia na mesma migration.
alter table aviso drop constraint if exists aviso_tipo_check;
alter table aviso add constraint aviso_tipo_check check (tipo = any (array[
  'NOVO','SITUACAO','REABERTO','CANCELADO_OPERADORA','CHEGOU','SAIU','MATERIAL',
  'DOIS_ATIVOS','SUMIU_TOA','OBSERVACAO']));

do $$
declare d text;
begin
  d := pg_get_functiondef('aviso_do_evento()'::regprocedure);
  d := replace(d, $a$    elsif new.tipo = 'REVERSAO' then$a$,
$a$    elsif new.tipo = 'OBSERVACAO_COP' then
      -- 156e: a nota do COP para o tecnico ("cliente so as 14h").
      -- Apagar a nota nao avisa: sumir um recado nao pede acao de ninguem.
      if new.observacao = '(observacao apagada)' then return new; end if;
      v_tipo := 'OBSERVACAO';
      v_titulo := 'Observação do COP';

    elsif new.tipo = 'REVERSAO' then$a$);
  if d !~ 'OBSERVACAO_COP' then raise exception 'aviso_do_evento: troca nao pegou'; end if;
  execute d;
end $$;
revoke all on function aviso_do_evento() from public, anon;

-- ═══ 2. A CASA DO CLIENTE ══════════════════════════════════════════
--
-- A chave e o CONTRATO + o ENDERECO (logradouro e bairro normalizados):
-- MUDANCA DE ENDERECO e o mesmo contrato numa casa nova, e a marca da
-- casa velha nao pode mandar o proximo tecnico para la.
--
-- Toda marca fica guardada (quem, quando, com que precisao); vale a mais
-- recente. Nada se apaga: se dois tecnicos discordarem, a tela mostra
-- quantas marcas existem.
--
-- So o tecnico marca, so no contrato de HOJE, e nunca com GPS simulado
-- -- a mesma trava da baixa (097). A tabela nao tem policy de leitura:
-- quem le e `casa_do_cliente`, com o escopo do proprio contrato.

create table if not exists casa_cliente (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresa(id),
  contrato text not null,
  endereco_chave text not null,
  lat double precision not null,
  lng double precision not null,
  precisao_m numeric,
  visita_id uuid references visita(id),
  tecnico_id uuid references tecnico(id),
  usuario_id uuid references perfil(id),
  marcado_em timestamptz not null default now()
);
create index if not exists casa_cliente_chave_idx
  on casa_cliente (empresa_id, contrato, endereco_chave, marcado_em desc);
alter table casa_cliente enable row level security;

create or replace function chave_endereco(p_logradouro text, p_bairro text) returns text
language sql stable set search_path = public as $$
  select norm_txt(coalesce(p_logradouro, '')) || '|' || norm_txt(coalesce(p_bairro, ''));
$$;
revoke all on function chave_endereco(text, text) from public, anon;
grant execute on function chave_endereco(text, text) to authenticated;

create or replace function marcar_casa_cliente(
  p_visita uuid, p_lat double precision, p_lng double precision,
  p_precisao numeric default null, p_simulado boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v visita%rowtype; v_tec uuid := meu_tecnico_id();
begin
  if v_tec is null then
    raise exception 'So o tecnico marca a casa do cliente, pelo aplicativo.' using errcode = '42501';
  end if;
  if coalesce(p_simulado, false) then
    raise exception 'GPS simulado nao marca a casa do cliente.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'Sem posicao do GPS.';
  end if;
  select * into v from visita
   where id = p_visita and empresa_id = minha_empresa() and excluido_em is null
     and equipe_id in (select equipes_visiveis());
  if not found then raise exception 'Contrato nao encontrado na sua agenda.'; end if;
  if v.data_agendada <> hoje_local() then
    raise exception 'So se marca a casa no contrato de hoje.';
  end if;
  if v.contrato is null then
    raise exception 'Contrato sem numero: nao ha a quem ligar a casa.';
  end if;

  insert into casa_cliente (empresa_id, contrato, endereco_chave, lat, lng, precisao_m,
                            visita_id, tecnico_id, usuario_id)
  values (v.empresa_id, v.contrato, chave_endereco(v.logradouro, v.bairro), p_lat, p_lng,
          p_precisao, v.id, v_tec, auth.uid());

  return jsonb_build_object('ok', true,
    'distancia_toa_m', case when v.lat is not null
      then round(distancia_m(p_lat, p_lng, v.lat::double precision, v.lng::double precision)) end);
end $$;
revoke all on function marcar_casa_cliente(uuid, double precision, double precision, numeric, boolean) from public, anon;
grant execute on function marcar_casa_cliente(uuid, double precision, double precision, numeric, boolean) to authenticated;

create or replace function casa_do_cliente(p_visitas uuid[])
returns table(visita_id uuid, lat double precision, lng double precision, precisao_m numeric,
              marcado_em timestamptz, marcado_por text, marcas integer,
              distancia_toa_m integer)
language sql stable security definer set search_path = public as $$
  with vis as materialized (
    select v.id, v.empresa_id, v.contrato, chave_endereco(v.logradouro, v.bairro) as chave,
           v.lat::double precision as tlat, v.lng::double precision as tlng
      from visita v
     where v.id = any (p_visitas)
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and (ve_cidade_inteira() or v.equipe_id in (select equipes_legiveis()))
       and v.contrato is not null
  )
  select vis.id, c.lat, c.lng, c.precisao_m, c.marcado_em,
         coalesce(t.nome, p.nome),
         (select count(*)::int from casa_cliente x
           where x.empresa_id = vis.empresa_id and x.contrato = vis.contrato
             and x.endereco_chave = vis.chave),
         case when vis.tlat is not null
              then round(distancia_m(c.lat, c.lng, vis.tlat, vis.tlng))::int end
    from vis
    join lateral (
      select * from casa_cliente cc
       where cc.empresa_id = vis.empresa_id and cc.contrato = vis.contrato
         and cc.endereco_chave = vis.chave
       order by cc.marcado_em desc limit 1) c on true
    left join tecnico t on t.id = c.tecnico_id
    left join perfil p on p.id = c.usuario_id;
$$;
revoke all on function casa_do_cliente(uuid[]) from public, anon;
grant execute on function casa_do_cliente(uuid[]) to authenticated;

-- ═══ 3. A AGENDA DO APP traz as duas coisas ═══════════════════════
-- `returns table` ganhou colunas: DROP, e a ACL de novo (traps.md).

drop function if exists agenda_do_campo(date);
create function agenda_do_campo(p_data date default null)
returns table(visita_id uuid, contrato text, wo_numero text, cliente_nome text, logradouro text,
              complemento text, bairro text, cep text, node text, telefones text[],
              lat numeric, lng numeric, janela_inicio time, janela_fim time, situacao text,
              data_agendada date, servico text, os_total integer, os_baixadas integer,
              evidencias integer, equipamentos integer, pontos numeric, pontos_achou boolean,
              segmento text, ouvidoria boolean, tec1 text, produtos text[], tipo_atividade text,
              tecnologia text,
              observacao_cop text, observacao_cop_em timestamptz,
              casa_lat double precision, casa_lng double precision, casa_marcado_em timestamptz)
language sql stable security definer set search_path = public as $function$
  with dia as materialized (select coalesce(p_data, hoje_local()) as d),
  escopo as materialized (select minha_empresa() as empresa, eh_gestor() as gestor),
  bases as materialized (select b from bases_visiveis() b),
  equipes_ok as materialized (select e from equipes_visiveis() e),
  minhas as materialized (
    select v.id, v.contrato, v.wo_numero, v.cliente_nome, v.logradouro,
           v.complemento, v.bairro, v.cep, v.node, v.telefones, v.lat, v.lng,
           v.janela_inicio, v.janela_fim, v.situacao, v.data_agendada,
           coalesce(ts.nome, ta.nome, 'Visita') as servico,
           sg.nome as segmento, v.ouvidoria, v.tec1, v.produtos_pendentes,
           ta.nome as tipo_atividade, v.tecnologia,
           v.observacao_cop, v.observacao_cop_em, v.empresa_id,
           chave_endereco(v.logradouro, v.bairro) as chave
      from visita v
      cross join escopo s
      left join tipo_servico   ts on ts.id = v.tipo_servico_id
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join segmentacao    sg on sg.id = v.segmentacao_id
     where v.excluido_em is null
       and v.data_agendada = (select d from dia)
       and v.empresa_id = s.empresa
       and v.base_id in (select b from bases)
       and (s.gestor or v.equipe_id in (select e from equipes_ok))
       and coalesce(ta.natureza, 'PRODUTIVA') = 'PRODUTIVA'
  ),
  pts as materialized (
    select m.id as visita_id, p.pontos_claro, p.achou
      from minhas m cross join lateral pontos_da_visita(m.id) p
  ),
  contagem as materialized (
    select o.visita_id, count(*)::int as total,
           count(*) filter (where o.codigo_baixa_afline_id is not null)::int as baixadas
      from ordem_servico o where o.visita_id in (select id from minhas)
     group by o.visita_id
  ),
  evid as materialized (
    select e.visita_id, count(*)::int as n from evidencia e
     where e.visita_id in (select id from minhas) group by e.visita_id
  ),
  equip as materialized (
    select m.visita_id, count(*)::int as n from equipamento_movimento m
     where m.visita_id in (select id from minhas) group by m.visita_id
  )
  select m.id, m.contrato, m.wo_numero, m.cliente_nome, m.logradouro,
         m.complemento, m.bairro, m.cep, m.node, m.telefones, m.lat, m.lng,
         m.janela_inicio, m.janela_fim, m.situacao, m.data_agendada, m.servico,
         coalesce(c.total, 0), coalesce(c.baixadas, 0),
         coalesce(ev.n, 0), coalesce(eq.n, 0),
         case when p.achou then p.pontos_claro end,
         coalesce(p.achou, false),
         m.segmento, m.ouvidoria, m.tec1, m.produtos_pendentes,
         m.tipo_atividade, m.tecnologia,
         m.observacao_cop, m.observacao_cop_em,
         casa.lat, casa.lng, casa.marcado_em
    from minhas m
    left join pts      p  on p.visita_id  = m.id
    left join contagem c  on c.visita_id  = m.id
    left join evid     ev on ev.visita_id = m.id
    left join equip    eq on eq.visita_id = m.id
    left join lateral (
      select cc.lat, cc.lng, cc.marcado_em from casa_cliente cc
       where cc.empresa_id = m.empresa_id and cc.contrato = m.contrato
         and cc.endereco_chave = m.chave
       order by cc.marcado_em desc limit 1) casa on true
   order by m.janela_inicio nulls last, m.contrato;
$function$;
revoke all on function agenda_do_campo(date) from public, anon;
grant execute on function agenda_do_campo(date) to authenticated;

notify pgrst, 'reload schema';
