-- ============================================================================
-- 096 · O rastro do técnico, o local da baixa e o melhor contato do cliente
-- ============================================================================
-- Pedidos do Emanuel (27/09), numa leva só:
--
-- ┌─ 1. o melhor contato do cliente, ao concluir ─────────────────────┐
-- │ > "na hora em que o técnico finalizar no app como concluído, o    │
-- │ >  sistema automaticamente deve subir uma caixinha informando,    │
-- │ >  você deseja subir o melhor contato do cliente? SIM ou NÃO? […] │
-- │ >  essa informação deve subir no analítico também quando for      │
-- │ >  exportar, quem está colocando número e quem não está. Só é pra │
-- │ >  aparecer nesse status"                                          │
-- │ Tabela própria (`contato_cliente`), uma linha por contrato, e NÃO │
-- │ um item a mais em `visita.telefones`: aquele array é do TOA e a   │
-- │ reimportação do dia o reescreve. O "NÃO" também é gravado — é     │
-- │ justamente o que mostra quem não está colocando. Sem linha =      │
-- │ "não perguntado", que é outra coisa (regra 6: zero ≠ desconhecido).│
-- │ O evento que vai para o histórico diz SÓ que foi informado — o    │
-- │ número não entra em `visita_evento`, que vai pelo Realtime e é    │
-- │ magra de propósito (D-119/D-120).                                  │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ 2. o rastro do técnico ──────────────────────────────────────────┐
-- │ > "deve mostrar a trilha do técnico desde o momento que o técnico │
-- │ >  loga até o final, o final da rota, ou enquanto ele estiver     │
-- │ >  usando o app, o sistema deve captar a cada 2 a 5 minutos o     │
-- │ >  sinal do gps do técnico"                                        │
-- │ Também em segundo plano (escolha do Emanuel, 27/09) — o que exige  │
-- │ o APK; no Expo Go só grava com o app aberto.                       │
-- │ "2 a 5 minutos" virou: ponto a cada 2 min se ele andou mais de    │
-- │ 30 m, e no máximo 5 min sem ponto mesmo parado. Parado não enche o │
-- │ banco; andando, a trilha tem resolução de rua.                     │
-- │ "Final da rota": `registrar_rastro` devolve se ainda há contrato  │
-- │ produtivo de hoje em aberto para ele. Sem nenhum, o segundo plano  │
-- │ desliga sozinho — rastrear o técnico em casa depois do último      │
-- │ contrato não foi pedido, e é dado pessoal de empregado.            │
-- │ Quem carimba técnico e usuário é o servidor (D-061). O técnico não │
-- │ lê rastro de ninguém — nem o dele: é ferramenta do controle.       │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ 3. o local da baixa ─────────────────────────────────────────────┐
-- │ > "a baixa deve pegar a distância que ele baixou da casa do        │
-- │ >  cliente […] técnicos precisam baixar no local, temos que ver o │
-- │ >  raio na tela de contratos ou equipe quando ele baixar"          │
-- │ A coordenada da baixa já era gravada desde a 055 (é a trava do    │
-- │ D-113). Faltava a PRECISÃO: 35 m com ±8 m e 35 m com ±2.000 m      │
-- │ contam histórias diferentes. `baixar_os` e `registrar_etapa`       │
-- │ ganham `p_precisao` (com default: todas as chamadas são por nome   │
-- │ ou posicionais de 7 — nenhuma fica ambígua, porque a versão antiga │
-- │ é DERRUBADA, não convive; ver traps.md).                           │
-- │ A distância é CALCULADA NA LEITURA (`local_da_baixa`), não         │
-- │ guardada: se o TOA corrigir a coordenada do endereço, a conta      │
-- │ acompanha — cache de regra fica errado calado (D-150).             │
-- │ O raio (200 m) é parâmetro, escolhido pelo Emanuel em 27/09.       │
-- └───────────────────────────────────────────────────────────────────┘
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A · distância entre dois pontos (Haversine), em metros
-- ---------------------------------------------------------------------------
-- Sem PostGIS neste projeto (e não vale instalar por uma conta). Nulo em
-- qualquer ponta = nulo: "não sei a distância" não é "zero metros".
create or replace function distancia_m(a_lat double precision, a_lng double precision,
                                       b_lat double precision, b_lng double precision)
returns integer
language sql immutable parallel safe set search_path to 'public' as $fn$
  select case when a_lat is null or a_lng is null or b_lat is null or b_lng is null
              then null
              else round(2 * 6371000 * asin(sqrt(
                     power(sin(radians(b_lat - a_lat) / 2), 2)
                     + cos(radians(a_lat)) * cos(radians(b_lat))
                       * power(sin(radians(b_lng - a_lng) / 2), 2))))::integer
         end;
$fn$;
revoke all on function distancia_m(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function distancia_m(double precision, double precision, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- B · o raio da baixa
-- ---------------------------------------------------------------------------
insert into parametro (empresa_id, chave, valor, descricao)
select e.id, 'raio_baixa_m', '200'::jsonb,
       'Distancia maxima (m) entre a baixa do campo e o endereco do cliente antes de acusar FORA DO RAIO. So acusa: nao bloqueia a baixa.'
  from empresa e
on conflict (empresa_id, chave) do nothing;

-- ---------------------------------------------------------------------------
-- C · a precisão do GPS vai junto com a baixa
-- ---------------------------------------------------------------------------
alter table visita_evento add column if not exists precisao_m numeric;
comment on column visita_evento.precisao_m is
  'Precisao (m) informada pelo GPS do celular no momento do evento. Nulo = o campo nao informou (web, importacao, ou versao antiga do app).';

-- baixar_os: o corpo é o que está NO BANCO (conferido com
-- pg_get_functiondef em 27/09), mais o parâmetro e a coluna.
drop function if exists baixar_os(uuid, integer, uuid, text, text, numeric, numeric);
create function baixar_os(p_os uuid, p_codigo integer, p_sub_falha uuid default null,
                          p_observacao text default null, p_situacao text default null,
                          p_lat numeric default null, p_lng numeric default null,
                          p_precisao numeric default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare v_visita uuid; v_cod uuid; v_conj text; v_tecnico uuid;
        v_ja uuid; v_campo boolean;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para baixar.' using errcode = '42501';
  end if;
  if not tem_permissao('servicos.baixar') then
    raise exception 'Seu perfil de acesso nao inclui "Baixar servico".'
      using errcode = '42501';
  end if;

  v_campo := tem_papel('TECNICO') and not eh_gestor()
             and not (tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'));

  select o.visita_id, o.codigo_baixa_afline_id into v_visita, v_ja
    from ordem_servico o where o.id = p_os;
  if v_visita is null then
    raise exception 'O.S. nao encontrada.' using errcode = 'P0002';
  end if;

  if not eh_gestor() and not exists (
       select 1 from visita v where v.id = v_visita
        and v.empresa_id = minha_empresa()
        and v.base_id in (select bases_visiveis())
        and v.equipe_id in (select equipes_visiveis())) then
    raise exception 'Esta O.S. nao e da sua equipe.' using errcode = '42501';
  end if;

  if v_campo then
    if p_lat is null or p_lng is null then
      raise exception 'Ligue a localizacao do celular para dar baixa.'
        using errcode = '42501';
    end if;
    if v_ja is not null then
      raise exception 'Esta O.S. ja foi baixada. Peca ao controlador para corrigir.'
        using errcode = '42501';
    end if;
  end if;

  select id into v_cod from codigo_baixa where codigo = p_codigo;
  if v_cod is null then
    raise exception 'Codigo de baixa % nao existe.', p_codigo using errcode = '23503';
  end if;

  if p_sub_falha is not null then
    select conjunto_sub_falha into v_conj from empresa limit 1;
    if not exists (select 1 from sub_falha s
                    where s.id = p_sub_falha and s.codigo = p_codigo
                      and (v_conj is null or s.conjunto = v_conj)) then
      raise exception 'Sub-falha nao pertence ao codigo % no conjunto vigente.', p_codigo
        using errcode = '23514';
    end if;
  end if;

  v_tecnico := meu_tecnico_id();

  update ordem_servico
     set codigo_baixa_afline_id = v_cod, sub_falha_id = p_sub_falha,
         baixa_observacao = nullif(btrim(coalesce(p_observacao,'')),''),
         baixa_em = now(), baixa_por = auth.uid()
   where id = p_os;

  if p_situacao is not null then
    update visita set situacao = p_situacao, situacao_em = now() where id = v_visita;
  end if;

  insert into visita_evento
    (visita_id, os_id, tipo, para, origem, usuario_id, login, tecnico_id,
     codigo_baixa_id, sub_falha_id, observacao, lat, lng, precisao_m)
  values (v_visita, p_os, 'BAIXA',
          jsonb_build_object('codigo', p_codigo, 'situacao', p_situacao),
          case when v_campo then 'MOBILE' else 'TELA' end,
          auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico, v_cod, p_sub_falha,
          nullif(btrim(coalesce(p_observacao,'')),''),
          p_lat, p_lng, p_precisao);

  return jsonb_build_object('ok', true, 'os', p_os, 'codigo', p_codigo);
end;
$function$;
-- Função criada do ZERO nasce aberta ao anon (security.md).
revoke all on function baixar_os(uuid, integer, uuid, text, text, numeric, numeric, numeric) from public, anon;
grant execute on function baixar_os(uuid, integer, uuid, text, text, numeric, numeric, numeric) to authenticated;

drop function if exists registrar_etapa(uuid, text, text, numeric, numeric);
create function registrar_etapa(p_visita uuid, p_situacao text, p_observacao text default null,
                                p_lat numeric default null, p_lng numeric default null,
                                p_precisao numeric default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare v_atual text; v_equipe uuid; v_tecnico uuid; v_campo boolean;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para registrar etapa.' using errcode = '42501';
  end if;

  v_campo := tem_papel('TECNICO') and not eh_gestor()
             and not (tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'));

  select situacao, equipe_id into v_atual, v_equipe
    from visita
   where id = p_visita and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis());
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  if not eh_gestor() and (v_equipe is null
      or v_equipe not in (select equipes_visiveis())) then
    raise exception 'Este contrato nao e da sua equipe.' using errcode = '42501';
  end if;

  if v_campo then
    if v_atual = any (situacoes_terminais()) then
      raise exception 'Contrato ja encerrado. Peca ao controlador para voltar.'
        using errcode = '42501';
    end if;
    if p_situacao = any (situacoes_terminais())
       and (p_lat is null or p_lng is null) then
      raise exception 'Ligue a localizacao do celular para encerrar a visita.'
        using errcode = '42501';
    end if;
  end if;

  perform exige_todas_baixadas(p_visita, p_situacao);

  v_tecnico := meu_tecnico_id();

  update visita set
    situacao    = p_situacao,
    situacao_em = now(),
    inicio      = case when p_situacao = 'EM_EXECUCAO' and inicio is null
                       then now() else inicio end,
    fim         = case when p_situacao = 'CONCLUIDA' then now() else fim end,
    tecnico_responsavel_id = coalesce(tecnico_responsavel_id, v_tecnico)
  where id = p_visita;

  insert into visita_evento (visita_id, tipo, de, para, origem,
                             usuario_id, login, tecnico_id, equipe_id,
                             observacao, lat, lng, precisao_m)
  values (p_visita, 'SITUACAO',
          jsonb_build_object('situacao', v_atual),
          jsonb_build_object('situacao', p_situacao),
          case when v_campo then 'MOBILE' else 'WEB' end,
          auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico, v_equipe,
          nullif(btrim(coalesce(p_observacao, '')), ''),
          p_lat, p_lng, p_precisao);

  return jsonb_build_object('de', v_atual, 'para', p_situacao);
end;
$function$;
revoke all on function registrar_etapa(uuid, text, text, numeric, numeric, numeric) from public, anon;
grant execute on function registrar_etapa(uuid, text, text, numeric, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- D · onde a baixa foi dada, e a que distância do cliente
-- ---------------------------------------------------------------------------
-- ┌─ qual ponto conta ──────────────────────────────────────────────┐
-- │ Um contrato tem uma baixa por O.S. e um encerramento — todos com │
-- │ coordenada quando vêm do campo. Devolvemos o MAIS LONGE do        │
-- │ endereço: é a pergunta do controle ("baixou no local?"), e basta  │
-- │ UMA afirmação feita de longe para a resposta ser não. O total de  │
-- │ registros e quantos ficaram fora vão junto.                       │
-- │ Só conta o que veio do campo (`origem = MOBILE`): baixa pela web  │
-- │ não tem GPS, e não é por isso que está errada — é o controlador.  │
-- └─────────────────────────────────────────────────────────────────┘
-- INVOKER de propósito: quem enxerga o contrato e o evento é o RLS.
create or replace function local_da_baixa(p_visitas uuid[])
returns table (visita_id uuid, em timestamptz, tipo text, login text,
               lat double precision, lng double precision, precisao_m numeric,
               cliente_lat double precision, cliente_lng double precision,
               distancia_m integer, raio_m integer, fora_do_raio boolean,
               registros integer, registros_fora integer)
language sql stable security invoker set search_path to 'public' as $fn$
  with raio as materialized (
    select coalesce((select (valor #>> '{}')::integer from parametro
                      where empresa_id = (select minha_empresa())
                        and chave = 'raio_baixa_m'), 200) as m
  ),
  ev as materialized (
    select e.visita_id, e.criado_em, e.tipo, e.login,
           e.lat::double precision as lat, e.lng::double precision as lng, e.precisao_m,
           v.lat::double precision as clat, v.lng::double precision as clng,
           distancia_m(e.lat::double precision, e.lng::double precision,
                       v.lat::double precision, v.lng::double precision) as dist
      from visita_evento e
      join visita v on v.id = e.visita_id
     where e.visita_id = any (p_visitas)
       and e.origem = 'MOBILE'
       and e.lat is not null and e.lng is not null
       and (e.tipo = 'BAIXA'
            or (e.tipo = 'SITUACAO' and e.para->>'situacao' = any (situacoes_terminais())))
  )
  select distinct on (ev.visita_id)
         ev.visita_id, ev.criado_em, ev.tipo, ev.login, ev.lat, ev.lng, ev.precisao_m,
         ev.clat, ev.clng, ev.dist, r.m,
         case when ev.dist is null then null else ev.dist > r.m end,
         (count(*) over w)::integer,
         (count(*) filter (where ev.dist > r.m) over w)::integer
    from ev cross join raio r
  window w as (partition by ev.visita_id)
   order by ev.visita_id, ev.dist desc nulls last, ev.criado_em desc;
$fn$;
revoke all on function local_da_baixa(uuid[]) from public, anon;
grant execute on function local_da_baixa(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- E · o melhor contato do cliente
-- ---------------------------------------------------------------------------
create table if not exists contato_cliente (
  visita_id     uuid primary key references visita(id) on delete cascade,
  empresa_id    uuid not null references empresa(id),
  -- Só dígitos, com DDD. Nulo = o técnico respondeu NÃO.
  telefone      text check (telefone is null or telefone ~ '^[1-9][1-9][0-9]{8,9}$'),
  informou      boolean generated always as (telefone is not null) stored,
  tecnico_id    uuid references tecnico(id),
  usuario_id    uuid not null,
  login         text,
  origem        text not null check (origem in ('MOBILE', 'WEB')),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table contato_cliente is
  'Melhor contato do cliente, perguntado ao tecnico quando ele CONCLUI pelo app (096). Linha com telefone nulo = ele respondeu NAO. Sem linha = nao foi perguntado.';

alter table contato_cliente enable row level security;
-- Leitura: exatamente quem já enxerga o contrato — o mesmo desenho da
-- evidência. Escrita só pela função (sem policy de INSERT/UPDATE).
drop policy if exists contato_cliente_leitura on contato_cliente;
create policy contato_cliente_leitura on contato_cliente for select to authenticated
  using (exists (select 1 from visita v where v.id = contato_cliente.visita_id));

create or replace function informar_contato_cliente(p_visita uuid, p_telefone text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare v_sit text; v_empresa uuid; v_tel text; v_tecnico uuid; v_campo boolean;
begin
  -- Mesma porta do anexo (055-D): equipe dele, e o campo só no dia.
  perform pode_anexar_na_visita(p_visita);

  select situacao, empresa_id into v_sit, v_empresa from visita where id = p_visita;
  -- "Só é pra aparecer nesse status" — e só se grava nele.
  if v_sit is distinct from 'CONCLUIDA' then
    raise exception 'O melhor contato so e informado em contrato concluido.'
      using errcode = '23514';
  end if;

  v_tel := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
  if v_tel is not null and v_tel !~ '^[1-9][1-9][0-9]{8,9}$' then
    raise exception 'Telefone invalido: use DDD + numero, como (92) 99999-9999.'
      using errcode = '23514';
  end if;

  v_campo := tem_papel('TECNICO') and not eh_gestor()
             and not (tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'));
  v_tecnico := meu_tecnico_id();

  insert into contato_cliente as c (visita_id, empresa_id, telefone, tecnico_id,
                                    usuario_id, login, origem)
  values (p_visita, v_empresa, v_tel, v_tecnico, auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          case when v_campo then 'MOBILE' else 'WEB' end)
  on conflict (visita_id) do update
     set telefone = excluded.telefone, tecnico_id = excluded.tecnico_id,
         usuario_id = excluded.usuario_id, login = excluded.login,
         origem = excluded.origem, atualizado_em = now();

  -- O histórico diz QUE foi informado; o número fica fora do evento,
  -- que viaja pelo Realtime (D-119/D-120). `aviso_do_evento` ignora o tipo.
  insert into visita_evento (visita_id, tipo, para, origem, usuario_id, login,
                             tecnico_id, observacao)
  values (p_visita, 'CONTATO', jsonb_build_object('informou', v_tel is not null),
          case when v_campo then 'MOBILE' else 'WEB' end, auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico,
          case when v_tel is null then 'Melhor contato do cliente: NAO informado'
               else 'Melhor contato do cliente: informado' end);

  return jsonb_build_object('ok', true, 'informou', v_tel is not null);
end;
$fn$;
revoke all on function informar_contato_cliente(uuid, text) from public, anon;
grant execute on function informar_contato_cliente(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- F · o rastro
-- ---------------------------------------------------------------------------
create table if not exists rastro_ponto (
  id            bigint generated always as identity primary key,
  empresa_id    uuid not null references empresa(id),
  tecnico_id    uuid not null references tecnico(id),
  usuario_id    uuid not null,
  -- A hora do CELULAR, quando o ponto foi lido. O ponto pode subir
  -- horas depois (fila offline); `recebido_em` é a do servidor.
  capturado_em  timestamptz not null,
  recebido_em   timestamptz not null default now(),
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  precisao_m    real,
  velocidade_ms real,
  bateria       smallint check (bateria between 0 and 100),
  -- ABRIU = login ou app aberto · PERIODICO = app aberto · SEGUNDO_PLANO =
  -- app fechado, com o APK · SAIU = o app foi para trás e o segundo plano
  -- NÃO está ligado (a trilha tem buraco a partir daqui, e ela diz isso) ·
  -- ENCERROU = o rastro parou (fim da rota ou saiu do login).
  motivo        text not null check (motivo in
                  ('ABRIU', 'PERIODICO', 'SEGUNDO_PLANO', 'SAIU', 'ENCERROU'))
);
-- A fila do celular reenvia o que não teve confirmação: o mesmo ponto
-- (técnico + instante) não entra duas vezes. É também o índice da trilha.
create unique index if not exists rastro_ponto_tecnico_em_uk
  on rastro_ponto (tecnico_id, capturado_em);
create index if not exists rastro_ponto_empresa_em_ix
  on rastro_ponto (empresa_id, capturado_em);

alter table rastro_ponto enable row level security;
drop policy if exists rastro_ponto_leitura on rastro_ponto;
create policy rastro_ponto_leitura on rastro_ponto for select to authenticated using (
  empresa_id = (select minha_empresa())
  and (select eh_gestao())
  and ((select eh_gestor())
       or tecnico_id in (select t.id from tecnico t
                          where t.equipe_id in (select equipes_visiveis())))
);

create or replace function registrar_rastro(p_pontos jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare v_tec uuid; v_empresa uuid; v_equipe uuid; v_n integer; v_aberta boolean;
begin
  select id, empresa_id, equipe_id into v_tec, v_empresa, v_equipe
    from tecnico where usuario_id = auth.uid() limit 1;
  if v_tec is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_pontos) is distinct from 'array' then
    raise exception 'Envie uma lista de pontos.' using errcode = '22023';
  end if;

  -- Relógio do celular adiantado ou atrasado demais é descartado: a trilha
  -- se ordena por ele, e um ponto "de amanhã" embaralharia o dia.
  insert into rastro_ponto (empresa_id, tecnico_id, usuario_id, capturado_em,
                            lat, lng, precisao_m, velocidade_ms, bateria, motivo)
  select v_empresa, v_tec, auth.uid(), x.em, x.lat, x.lng,
         nullif(x.precisao, 'NaN'), case when x.velocidade >= 0 then x.velocidade end,
         case when x.bateria between 0 and 100 then x.bateria end,
         coalesce(x.motivo, 'PERIODICO')
    from jsonb_to_recordset(p_pontos) as x(em timestamptz, lat double precision,
           lng double precision, precisao real, velocidade real, bateria smallint, motivo text)
   where x.em is not null and x.lat is not null and x.lng is not null
     and x.lat between -90 and 90 and x.lng between -180 and 180
     and not (x.lat = 0 and x.lng = 0)
     and x.em between now() - interval '3 days' and now() + interval '10 minutes'
     and coalesce(x.motivo, 'PERIODICO') in
         ('ABRIU', 'PERIODICO', 'SEGUNDO_PLANO', 'SAIU', 'ENCERROU')
   limit 500
  on conflict (tecnico_id, capturado_em) do nothing;
  get diagnostics v_n = row_count;

  -- "Até o final da rota": ainda há contrato produtivo de hoje em aberto
  -- para ele (pelo responsável ou, sem responsável, pela equipe)?
  select exists (
    select 1 from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.data_agendada = hoje_local()
       and v.excluido_em is null
       and (v.tecnico_responsavel_id = v_tec
            or (v.tecnico_responsavel_id is null and v.equipe_id = v_equipe))
       and not (v.situacao = any (situacoes_terminais()))
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA')
    into v_aberta;

  return jsonb_build_object('gravados', v_n, 'rota_aberta', v_aberta);
end;
$fn$;
revoke all on function registrar_rastro(jsonb) from public, anon;
grant execute on function registrar_rastro(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- G · a central de monitoramento
-- ---------------------------------------------------------------------------
-- ┌─ o km percorrido é ESTIMADO, e diz por quê ──────────────────────┐
-- │ Parado, o GPS "anda" sozinho uns metros a cada leitura; somar     │
-- │ tudo inventaria quilômetros. Entram só os trechos entre dois      │
-- │ pontos com precisão de até 100 m e deslocamento de 25 m ou mais.  │
-- │ Em segundo plano a leitura é mais espaçada, e o trecho é linha    │
-- │ reta: a conta subestima curva. É ordem de grandeza, não odômetro. │
-- └──────────────────────────────────────────────────────────────────┘
-- DEFINER porque a placa mora na frota (RLS de `frota.ver`) e o
-- controlador que olha o mapa nem sempre tem essa chave. O escopo é
-- conferido aqui dentro: gestão, e só técnico de equipe visível.
create or replace function monitor_tecnicos(p_data date)
returns table (
  tecnico_id uuid, nome text, matricula text,
  equipe_id uuid, equipe_codigo text, equipe_nome text, placa text,
  pontos integer, primeiro_em timestamptz, ultimo_em timestamptz,
  ultimo_lat double precision, ultimo_lng double precision,
  ultimo_precisao real, ultimo_motivo text, bateria smallint,
  km numeric,
  contrato_ativo text, situacao_ativa text, visita_ativa uuid,
  contratos integer, encerrados integer,
  baixas_campo integer, baixas_fora integer
)
language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
-- ↑ as colunas de saída (tecnico_id, equipe_id, nome…) têm o nome das
-- colunas das tabelas; sem isto o plpgsql acusa referência ambígua.
declare v_ini timestamptz; v_fim timestamptz; v_raio integer;
begin
  if not eh_gestao() then
    raise exception 'Monitoramento e do controle.' using errcode = '42501';
  end if;
  v_ini := (p_data::timestamp) at time zone 'America/Manaus';
  v_fim := ((p_data + 1)::timestamp) at time zone 'America/Manaus';
  select coalesce((valor #>> '{}')::integer, 200) into v_raio
    from parametro where empresa_id = minha_empresa() and chave = 'raio_baixa_m';
  v_raio := coalesce(v_raio, 200);

  return query
  with tec as materialized (
    select t.id, t.nome, t.matricula, t.equipe_id, e.codigo, e.nome as enome
      from tecnico t
      left join equipe e on e.id = t.equipe_id
     where t.empresa_id = minha_empresa()
       and t.situacao = 'ATIVO'
       and (eh_gestor() or t.equipe_id in (select equipes_visiveis()))
  ),
  pt as materialized (
    select r.tecnico_id, r.capturado_em, r.lat, r.lng, r.precisao_m, r.motivo, r.bateria,
           lag(r.lat) over w as plat, lag(r.lng) over w as plng,
           lag(r.precisao_m) over w as pprec,
           row_number() over (partition by r.tecnico_id order by r.capturado_em desc) as rn
      from rastro_ponto r
     where r.tecnico_id in (select id from tec)
       and r.capturado_em >= v_ini and r.capturado_em < v_fim
    window w as (partition by r.tecnico_id order by r.capturado_em)
  ),
  resumo as (
    select p.tecnico_id,
           count(*)::integer as n,
           min(p.capturado_em) as prim,
           max(p.capturado_em) as ult,
           round(coalesce(sum(d.m) filter (
             where d.m >= 25 and coalesce(p.precisao_m, 0) <= 100
               and coalesce(p.pprec, 0) <= 100), 0) / 1000.0, 1) as km
      from pt p
      cross join lateral (select distancia_m(p.plat, p.plng, p.lat, p.lng) as m) d
     group by p.tecnico_id
  ),
  vis as materialized (
    select v.id, v.contrato, v.situacao, v.equipe_id, v.tecnico_responsavel_id, v.situacao_em
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.data_agendada = p_data and v.excluido_em is null
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       and v.equipe_id in (select equipe_id from tec)
  ),
  loc as materialized (
    select e.tecnico_id,
           count(*)::integer as n,
           count(*) filter (where distancia_m(e.lat::double precision, e.lng::double precision,
                                              v.lat::double precision, v.lng::double precision) > v_raio)::integer as fora
      from visita_evento e
      join visita v on v.id = e.visita_id
     where e.visita_id in (select id from vis)
       and e.origem = 'MOBILE' and e.lat is not null
       and (e.tipo = 'BAIXA'
            or (e.tipo = 'SITUACAO' and e.para->>'situacao' = any (situacoes_terminais())))
     group by e.tecnico_id
  )
  select t.id, t.nome, t.matricula, t.equipe_id, t.codigo, t.enome,
         (select vc.placa from veiculo_condutor c join veiculo vc on vc.id = c.veiculo_id
           where c.tecnico_id = t.id and c.ate is null and vc.arquivado_em is null
           order by c.desde desc limit 1),
         coalesce(r.n, 0), r.prim, r.ult,
         u.lat, u.lng, u.precisao_m, u.motivo, u.bateria,
         coalesce(r.km, 0),
         a.contrato, a.situacao, a.id,
         (select count(*)::integer from vis x
           where x.tecnico_responsavel_id = t.id
              or (x.tecnico_responsavel_id is null and x.equipe_id = t.equipe_id)),
         (select count(*)::integer from vis x
           where (x.tecnico_responsavel_id = t.id
                  or (x.tecnico_responsavel_id is null and x.equipe_id = t.equipe_id))
             and x.situacao = any (situacoes_terminais())),
         coalesce(l.n, 0), coalesce(l.fora, 0)
    from tec t
    left join resumo r on r.tecnico_id = t.id
    left join pt u on u.tecnico_id = t.id and u.rn = 1
    left join lateral (
      select x.id, x.contrato, x.situacao from vis x
       where x.situacao in ('EM_DESLOCAMENTO', 'EM_EXECUCAO')
         and (x.tecnico_responsavel_id = t.id
              or (x.tecnico_responsavel_id is null and x.equipe_id = t.equipe_id))
       order by x.situacao_em desc nulls last limit 1) a on true
    left join loc l on l.tecnico_id = t.id
   -- Só quem tem algo no dia: sinal, contrato ou baixa. 104 técnicos
   -- com 7 trabalhando seria o painel de Equipes antes da D-137.
   where r.n is not null or l.n is not null
      or exists (select 1 from vis x where x.equipe_id = t.equipe_id);
end;
$fn$;
revoke all on function monitor_tecnicos(date) from public, anon;
grant execute on function monitor_tecnicos(date) to authenticated;

notify pgrst, 'reload schema';
