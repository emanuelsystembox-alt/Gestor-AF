-- ============================================================================
-- 097 · Cercas e garagens, antifraude do GPS, ciência do rastro e retenção
-- ============================================================================
-- Respostas do Emanuel (27/09) às pendências da 096 (D-171):
--
-- > "quanto tempo guardar o rastro […] vamos fazer 90 também"
-- > "podemos configurar isso no mapa, tipo cerca, area 1 - desenhar ela no
-- >  mapa, se ele sair daquilo, deve chegar notificação para o cop e
-- >  gestores que estão conectados […] então garagem, cerca no mapa deve
-- >  ter de fato"
-- > "Aviso formal ao técnico sobre o rastro […] pode fazer também"
-- > "quero nosso app que seja com base em anti fraude […] se ele desligar o
-- >  gps e quiser usar o sistema, o sistema vai travar as ações dele […] se
-- >  ele habilitar no celular dele o modo desenvolvedor para instalar o gps
-- >  simulator, o app também deve bloquear isso, informar que há ações
-- >  anormais no gps e que ele precisa corrigir isso para usar o app. temos
-- >  que ser intuitivos sem ser agressivo"
--
-- ┌─ o que é decisão do Emanuel e o que é leitura nossa ──────────────┐
-- │ DELE: 90 dias; cerca desenhada; aviso à central ao sair; garagem;  │
-- │ termo "Estou ciente"; travar com GPS desligado e com GPS simulado. │
-- │ NOSSA, e escrita para poder ser trocada:                            │
-- │  · a cerca diz a quais equipes vale e se avisa ao SAIR e/ou ao      │
-- │    ENTRAR — quem desenha decide (garagem nasce sem aviso);          │
-- │  · a troca dentro/fora só vale com 2 pontos seguidos e precisão até │
-- │    100 m — GPS tremendo na borda não pode disparar alerta;          │
-- │  · "salto" = mais de 1 km a mais de 180 km/h entre dois pontos: só  │
-- │    ACUSA, não trava (um GPS ruim também salta);                     │
-- │  · o modo desenvolvedor em si NÃO trava: é a localização SIMULADA   │
-- │    que trava (o Android marca cada leitura falsa). Muita gente tem  │
-- │    o modo desenvolvedor ligado sem fraudar nada.                    │
-- └─────────────────────────────────────────────────────────────────────┘
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A · retenção: 90 dias
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

insert into parametro (empresa_id, chave, valor, descricao)
select e.id, 'rastro_retencao_dias', '90'::jsonb,
       'Dias que o rastro do tecnico (pontos, alertas de GPS e eventos de cerca) fica guardado. O expurgo roda toda madrugada.'
  from empresa e
on conflict (empresa_id, chave) do nothing;

alter table rastro_ponto add column if not exists simulado boolean not null default false;
comment on column rastro_ponto.simulado is
  'O Android marcou a leitura como vinda de provedor de localizacao simulada (app de GPS falso). Ponto simulado nao entra em cerca nem em salto (097).';

-- ---------------------------------------------------------------------------
-- B · o estado do GPS de cada técnico, e os alertas
-- ---------------------------------------------------------------------------
create table if not exists tecnico_gps (
  tecnico_id    uuid primary key references tecnico(id) on delete cascade,
  empresa_id    uuid not null references empresa(id),
  estado        text not null default 'NORMAL'
                check (estado in ('NORMAL', 'SIMULADO', 'DESLIGADO', 'SEM_PERMISSAO')),
  desde         timestamptz not null default now(),
  aparelho_modificado boolean not null default false,
  atualizado_em timestamptz not null default now()
);
alter table tecnico_gps enable row level security;
drop policy if exists tecnico_gps_leitura on tecnico_gps;
create policy tecnico_gps_leitura on tecnico_gps for select to authenticated using (
  empresa_id = (select minha_empresa())
  and (tecnico_id = (select meu_tecnico_id())
       or ((select eh_gestao()) and ((select eh_gestor())
           or tecnico_id in (select t.id from tecnico t where t.equipe_id in (select equipes_visiveis())))))
);

create table if not exists gps_alerta (
  id          bigint generated always as identity primary key,
  empresa_id  uuid not null references empresa(id),
  tecnico_id  uuid not null references tecnico(id) on delete cascade,
  equipe_id   uuid,
  tipo        text not null check (tipo in ('SIMULADO', 'DESLIGADO', 'SEM_PERMISSAO',
                                            'NORMALIZADO', 'SALTO', 'APARELHO_MODIFICADO')),
  em          timestamptz not null,
  lat         double precision,
  lng         double precision,
  detalhe     text
);
create index if not exists gps_alerta_tec_em_ix on gps_alerta (tecnico_id, em);
create index if not exists gps_alerta_emp_em_ix on gps_alerta (empresa_id, em);
alter table gps_alerta enable row level security;
drop policy if exists gps_alerta_leitura on gps_alerta;
create policy gps_alerta_leitura on gps_alerta for select to authenticated using (
  empresa_id = (select minha_empresa()) and (select eh_gestao())
  and ((select eh_gestor()) or equipe_id in (select equipes_visiveis()))
);

-- Muda o estado e grava o alerta SÓ quando muda (o mesmo estado repetido a
-- cada ponto não vira cem alertas). Interna: ninguém chama pelo PostgREST.
create or replace function mudar_estado_gps(p_tec uuid, p_estado text, p_em timestamptz,
                                            p_lat double precision, p_lng double precision,
                                            p_detalhe text)
returns boolean
language plpgsql security definer set search_path to 'public' as $fn$
declare v_emp uuid; v_equipe uuid; v_atual text;
begin
  select empresa_id, equipe_id into v_emp, v_equipe from tecnico where id = p_tec;
  select estado into v_atual from tecnico_gps where tecnico_id = p_tec;
  if v_atual is not distinct from p_estado or (v_atual is null and p_estado = 'NORMAL') then
    if v_atual is null then
      insert into tecnico_gps (tecnico_id, empresa_id, estado, desde) values (p_tec, v_emp, 'NORMAL', p_em)
      on conflict (tecnico_id) do nothing;
    else
      update tecnico_gps set atualizado_em = now() where tecnico_id = p_tec;
    end if;
    return false;
  end if;
  insert into tecnico_gps (tecnico_id, empresa_id, estado, desde, atualizado_em)
  values (p_tec, v_emp, p_estado, p_em, now())
  on conflict (tecnico_id) do update
     set estado = excluded.estado, desde = excluded.desde, atualizado_em = now();
  insert into gps_alerta (empresa_id, tecnico_id, equipe_id, tipo, em, lat, lng, detalhe)
  values (v_emp, p_tec, v_equipe,
          case when p_estado = 'NORMAL' then 'NORMALIZADO' else p_estado end,
          p_em, p_lat, p_lng, p_detalhe);
  return true;
end;
$fn$;
revoke all on function mudar_estado_gps(uuid, text, timestamptz, double precision, double precision, text) from public, anon, authenticated;

/** A trava: localização simulada ativa. Só um ponto REAL destrava. */
create or replace function gps_bloqueado(p_tec uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $fn$
  select exists (select 1 from tecnico_gps where tecnico_id = p_tec and estado = 'SIMULADO');
$fn$;
revoke all on function gps_bloqueado(uuid) from public, anon;
grant execute on function gps_bloqueado(uuid) to authenticated;

-- O app avisa o que só ele vê: GPS desligado, permissão negada, simulação
-- lida na hora da baixa, aparelho com root. "NORMAL" daqui só desfaz
-- desligado/sem permissão — simulação só se desfaz com um ponto real.
create or replace function registrar_estado_gps(p_estado text, p_detalhe text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare v_tec uuid; v_atual text; v_emp uuid; v_equipe uuid;
begin
  v_tec := meu_tecnico_id();
  if v_tec is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  if p_estado not in ('NORMAL', 'DESLIGADO', 'SEM_PERMISSAO', 'SIMULADO', 'APARELHO_MODIFICADO') then
    raise exception 'Estado de GPS desconhecido: %', p_estado using errcode = '22023';
  end if;
  select estado into v_atual from tecnico_gps where tecnico_id = v_tec;

  if p_estado = 'APARELHO_MODIFICADO' then
    select empresa_id, equipe_id into v_emp, v_equipe from tecnico where id = v_tec;
    insert into tecnico_gps (tecnico_id, empresa_id, aparelho_modificado)
    values (v_tec, v_emp, true)
    on conflict (tecnico_id) do update set aparelho_modificado = true, atualizado_em = now();
    -- Um alerta por dia basta: é o mesmo aparelho.
    if not exists (select 1 from gps_alerta where tecnico_id = v_tec and tipo = 'APARELHO_MODIFICADO'
                    and em >= (hoje_local()::timestamp at time zone 'America/Manaus')) then
      insert into gps_alerta (empresa_id, tecnico_id, equipe_id, tipo, em, detalhe)
      values (v_emp, v_tec, v_equipe, 'APARELHO_MODIFICADO', now(), p_detalhe);
    end if;
  elsif p_estado = 'NORMAL' and v_atual = 'SIMULADO' then
    null;  -- só um ponto real (registrar_rastro) tira a simulação
  else
    perform mudar_estado_gps(v_tec, p_estado, now(), null, null, p_detalhe);
  end if;

  return jsonb_build_object('estado', coalesce((select estado from tecnico_gps where tecnico_id = v_tec), 'NORMAL'),
                            'bloqueado', gps_bloqueado(v_tec));
end;
$fn$;
revoke all on function registrar_estado_gps(text, text) from public, anon;
grant execute on function registrar_estado_gps(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- C · cercas e garagens
-- ---------------------------------------------------------------------------
create table if not exists cerca (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresa(id),
  base_id       uuid references base(id),
  nome          text not null check (length(btrim(nome)) between 1 and 60),
  tipo          text not null check (tipo in ('AREA', 'GARAGEM')),
  -- [[lat, lng], …] — o polígono como foi desenhado, de 3 a 300 vértices.
  poligono      jsonb not null check (jsonb_typeof(poligono) = 'array'
                                      and jsonb_array_length(poligono) between 3 and 300),
  cor           text not null default '#6366f1' check (cor ~ '^#[0-9a-fA-F]{6}$'),
  alerta_sair   boolean not null default false,
  alerta_entrar boolean not null default false,
  -- Verdadeiro = vale para todas as equipes da base; falso = só as de cerca_equipe.
  todas_equipes boolean not null default true,
  criado_por    uuid,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  arquivado_em  timestamptz,
  arquivado_por uuid
);
create table if not exists cerca_equipe (
  cerca_id  uuid not null references cerca(id) on delete cascade,
  equipe_id uuid not null references equipe(id) on delete cascade,
  primary key (cerca_id, equipe_id)
);
-- Onde cada técnico está em relação a cada cerca. `contra` conta pontos
-- seguidos do lado oposto; com 2, a troca vale (e o evento leva a hora do
-- PRIMEIRO, `contra_desde`).
create table if not exists cerca_estado (
  tecnico_id   uuid not null references tecnico(id) on delete cascade,
  cerca_id     uuid not null references cerca(id) on delete cascade,
  dentro       boolean not null,
  desde        timestamptz not null,
  ultimo_em    timestamptz not null,
  contra       smallint not null default 0,
  contra_desde timestamptz,
  primary key (tecnico_id, cerca_id)
);
create table if not exists cerca_evento (
  id          bigint generated always as identity primary key,
  empresa_id  uuid not null references empresa(id),
  cerca_id    uuid not null references cerca(id) on delete cascade,
  tecnico_id  uuid not null references tecnico(id) on delete cascade,
  equipe_id   uuid,
  tipo        text not null check (tipo in ('ENTROU', 'SAIU')),
  em          timestamptz not null,
  lat         double precision,
  lng         double precision,
  alerta      boolean not null default false
);
create index if not exists cerca_evento_tec_em_ix on cerca_evento (tecnico_id, em);
create index if not exists cerca_evento_emp_em_ix on cerca_evento (empresa_id, em);

alter table cerca enable row level security;
alter table cerca_equipe enable row level security;
alter table cerca_estado enable row level security;
alter table cerca_evento enable row level security;
drop policy if exists cerca_leitura on cerca;
create policy cerca_leitura on cerca for select to authenticated using (
  empresa_id = (select minha_empresa()) and (select eh_gestao()));
drop policy if exists cerca_equipe_leitura on cerca_equipe;
create policy cerca_equipe_leitura on cerca_equipe for select to authenticated using (
  cerca_id in (select id from cerca));
drop policy if exists cerca_evento_leitura on cerca_evento;
create policy cerca_evento_leitura on cerca_evento for select to authenticated using (
  empresa_id = (select minha_empresa()) and (select eh_gestao())
  and ((select eh_gestor()) or equipe_id in (select equipes_visiveis())));
-- cerca_estado: só pelas funções (RLS ligado, nenhuma policy).

/** Ponto dentro do polígono (raio cruzando as arestas). */
create or replace function ponto_na_cerca(p_lat double precision, p_lng double precision, p_poligono jsonb)
returns boolean
language plpgsql immutable set search_path to 'public' as $fn$
declare n int := jsonb_array_length(p_poligono); i int; j int;
        yi double precision; xi double precision; yj double precision; xj double precision;
        dentro boolean := false;
begin
  j := n - 1;
  for i in 0 .. n - 1 loop
    yi := (p_poligono->i->>0)::double precision; xi := (p_poligono->i->>1)::double precision;
    yj := (p_poligono->j->>0)::double precision; xj := (p_poligono->j->>1)::double precision;
    if ((yi > p_lat) <> (yj > p_lat))
       and (p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi) then
      dentro := not dentro;
    end if;
    j := i;
  end loop;
  return dentro;
end;
$fn$;
revoke all on function ponto_na_cerca(double precision, double precision, jsonb) from public, anon;
grant execute on function ponto_na_cerca(double precision, double precision, jsonb) to authenticated;

create or replace function salvar_cerca(p_id uuid, p_nome text, p_tipo text, p_poligono jsonb,
                                        p_cor text, p_alerta_sair boolean, p_alerta_entrar boolean,
                                        p_equipes uuid[])
returns uuid
language plpgsql security definer set search_path to 'public' as $fn$
declare v_id uuid; v_emp uuid := minha_empresa(); v_base uuid; v_ponto jsonb; v_mudou boolean := true;
begin
  if not eh_gestao() then
    raise exception 'So a gestao desenha cerca.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_poligono) is distinct from 'array' or jsonb_array_length(p_poligono) < 3 then
    raise exception 'A cerca precisa de pelo menos 3 pontos no mapa.' using errcode = '23514';
  end if;
  for v_ponto in select * from jsonb_array_elements(p_poligono) loop
    if jsonb_array_length(v_ponto) <> 2
       or (v_ponto->>0)::double precision not between -90 and 90
       or (v_ponto->>1)::double precision not between -180 and 180 then
      raise exception 'Ponto invalido no desenho da cerca.' using errcode = '23514';
    end if;
  end loop;
  select base_id into v_base from perfil where id = auth.uid();

  if p_id is null then
    insert into cerca (empresa_id, base_id, nome, tipo, poligono, cor, alerta_sair, alerta_entrar,
                       todas_equipes, criado_por)
    values (v_emp, v_base, btrim(p_nome), p_tipo, p_poligono, coalesce(p_cor, '#6366f1'),
            p_alerta_sair, p_alerta_entrar, coalesce(cardinality(p_equipes), 0) = 0, auth.uid())
    returning id into v_id;
  else
    select (c.poligono is distinct from p_poligono)
           or (c.todas_equipes is distinct from (coalesce(cardinality(p_equipes), 0) = 0))
      into v_mudou from cerca c where c.id = p_id and c.empresa_id = v_emp and c.arquivado_em is null;
    if not found then
      raise exception 'Cerca nao encontrada.' using errcode = 'P0002';
    end if;
    update cerca set nome = btrim(p_nome), tipo = p_tipo, poligono = p_poligono,
                     cor = coalesce(p_cor, cor), alerta_sair = p_alerta_sair,
                     alerta_entrar = p_alerta_entrar,
                     todas_equipes = coalesce(cardinality(p_equipes), 0) = 0,
                     atualizado_em = now()
     where id = p_id;
    v_id := p_id;
    delete from cerca_equipe where cerca_id = v_id;
    v_mudou := true;
  end if;

  insert into cerca_equipe (cerca_id, equipe_id)
  select v_id, e.id from equipe e
   where e.id = any (coalesce(p_equipes, '{}')) and e.empresa_id = v_emp
  on conflict do nothing;

  -- Desenho ou equipes mudaram: o "dentro/fora" de todo mundo recomeça do
  -- próximo ponto, sem alerta — senão redesenhar a cerca dispararia um
  -- "saiu" para quem nunca se mexeu.
  if v_mudou then delete from cerca_estado where cerca_id = v_id; end if;
  return v_id;
end;
$fn$;
revoke all on function salvar_cerca(uuid, text, text, jsonb, text, boolean, boolean, uuid[]) from public, anon;
grant execute on function salvar_cerca(uuid, text, text, jsonb, text, boolean, boolean, uuid[]) to authenticated;

create or replace function arquivar_cerca(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not eh_gestao() then
    raise exception 'So a gestao arquiva cerca.' using errcode = '42501';
  end if;
  -- Arquivar, não apagar: os eventos antigos continuam dizendo de que
  -- cerca eram.
  update cerca set arquivado_em = now(), arquivado_por = auth.uid()
   where id = p_id and empresa_id = minha_empresa() and arquivado_em is null;
  delete from cerca_estado where cerca_id = p_id;
end;
$fn$;
revoke all on function arquivar_cerca(uuid) from public, anon;
grant execute on function arquivar_cerca(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- D · o rastro agora lê simulação, salto e cerca
-- ---------------------------------------------------------------------------
create or replace function registrar_rastro(p_pontos jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare v_tec uuid; v_empresa uuid; v_equipe uuid; v_base uuid; v_n integer; v_aberta boolean;
        rr record; ant record; cc record; st record; v_dentro boolean; v_estado text;
        v_d integer; v_seg double precision;
begin
  select id, empresa_id, equipe_id, base_id into v_tec, v_empresa, v_equipe, v_base
    from tecnico where usuario_id = auth.uid() limit 1;
  if v_tec is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_pontos) is distinct from 'array' then
    raise exception 'Envie uma lista de pontos.' using errcode = '22023';
  end if;

  insert into rastro_ponto (empresa_id, tecnico_id, usuario_id, capturado_em,
                            lat, lng, precisao_m, velocidade_ms, bateria, motivo, simulado)
  select v_empresa, v_tec, auth.uid(), x.em, x.lat, x.lng,
         nullif(x.precisao, 'NaN'), case when x.velocidade >= 0 then x.velocidade end,
         case when x.bateria between 0 and 100 then x.bateria end,
         coalesce(x.motivo, 'PERIODICO'), coalesce(x.simulado, false)
    from jsonb_to_recordset(p_pontos) as x(em timestamptz, lat double precision,
           lng double precision, precisao real, velocidade real, bateria smallint,
           motivo text, simulado boolean)
   where x.em is not null and x.lat is not null and x.lng is not null
     and x.lat between -90 and 90 and x.lng between -180 and 180
     and not (x.lat = 0 and x.lng = 0)
     and x.em between now() - interval '3 days' and now() + interval '10 minutes'
     and coalesce(x.motivo, 'PERIODICO') in
         ('ABRIU', 'PERIODICO', 'SEGUNDO_PLANO', 'SAIU', 'ENCERROU')
   limit 500
  on conflict (tecnico_id, capturado_em) do nothing;
  get diagnostics v_n = row_count;

  -- Os pontos que entraram AGORA (`recebido_em` é o now() desta transação),
  -- na ordem em que foram lidos no celular.
  for rr in select * from rastro_ponto
             where tecnico_id = v_tec and recebido_em = now()
             order by capturado_em loop
    select estado into v_estado from tecnico_gps where tecnico_id = v_tec;

    -- 1 · simulação: o ponto falso trava e não entra em mais nada
    if rr.simulado then
      perform mudar_estado_gps(v_tec, 'SIMULADO', rr.capturado_em, rr.lat, rr.lng,
                               'O celular informou localizacao simulada');
      continue;
    elsif v_estado is not null and v_estado <> 'NORMAL' then
      perform mudar_estado_gps(v_tec, 'NORMAL', rr.capturado_em, rr.lat, rr.lng, null);
    end if;

    if coalesce(rr.precisao_m, 0) > 100 then continue; end if;

    -- 2 · salto: mais de 1 km a mais de 180 km/h — acusa, não trava
    select capturado_em, lat, lng into ant from rastro_ponto
     where tecnico_id = v_tec and capturado_em < rr.capturado_em
       and not simulado and coalesce(precisao_m, 0) <= 100
     order by capturado_em desc limit 1;
    if found then
      v_d := distancia_m(ant.lat, ant.lng, rr.lat, rr.lng);
      v_seg := extract(epoch from rr.capturado_em - ant.capturado_em);
      if v_d >= 1000 and v_seg > 0 and v_d / v_seg > 50
         and not exists (select 1 from gps_alerta g where g.tecnico_id = v_tec and g.tipo = 'SALTO'
                          and g.em > rr.capturado_em - interval '10 minutes') then
        insert into gps_alerta (empresa_id, tecnico_id, equipe_id, tipo, em, lat, lng, detalhe)
        values (v_empresa, v_tec, v_equipe, 'SALTO', rr.capturado_em, rr.lat, rr.lng,
                format('%s km em %s min (%s km/h)', round(v_d / 1000.0, 1),
                       round((v_seg / 60.0)::numeric, 1), round((v_d / v_seg * 3.6)::numeric)));
      end if;
    end if;

    -- 3 · cercas que valem para ele
    for cc in select c.* from cerca c
               where c.empresa_id = v_empresa and c.arquivado_em is null
                 and ((c.todas_equipes and (c.base_id is null or c.base_id = v_base))
                      or exists (select 1 from cerca_equipe ce
                                  where ce.cerca_id = c.id and ce.equipe_id = v_equipe)) loop
      v_dentro := ponto_na_cerca(rr.lat, rr.lng, cc.poligono);
      select * into st from cerca_estado where tecnico_id = v_tec and cerca_id = cc.id;
      if not found then
        -- Primeiro ponto: só aprende onde ele está. Sem evento.
        insert into cerca_estado (tecnico_id, cerca_id, dentro, desde, ultimo_em)
        values (v_tec, cc.id, v_dentro, rr.capturado_em, rr.capturado_em);
      elsif rr.capturado_em <= st.ultimo_em then
        null;  -- ponto atrasado da fila: a ordem já passou por ele
      elsif v_dentro = st.dentro then
        update cerca_estado set contra = 0, contra_desde = null, ultimo_em = rr.capturado_em
         where tecnico_id = v_tec and cerca_id = cc.id;
      elsif st.contra + 1 >= 2 then
        update cerca_estado
           set dentro = v_dentro, desde = coalesce(st.contra_desde, rr.capturado_em),
               contra = 0, contra_desde = null, ultimo_em = rr.capturado_em
         where tecnico_id = v_tec and cerca_id = cc.id;
        insert into cerca_evento (empresa_id, cerca_id, tecnico_id, equipe_id, tipo, em, lat, lng, alerta)
        values (v_empresa, cc.id, v_tec, v_equipe,
                case when v_dentro then 'ENTROU' else 'SAIU' end,
                coalesce(st.contra_desde, rr.capturado_em), rr.lat, rr.lng,
                case when v_dentro then cc.alerta_entrar else cc.alerta_sair end);
      else
        update cerca_estado set contra = st.contra + 1,
               contra_desde = coalesce(st.contra_desde, rr.capturado_em),
               ultimo_em = rr.capturado_em
         where tecnico_id = v_tec and cerca_id = cc.id;
      end if;
    end loop;
  end loop;

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

  return jsonb_build_object('gravados', v_n, 'rota_aberta', v_aberta,
                            'bloqueado', gps_bloqueado(v_tec));
end;
$fn$;
revoke all on function registrar_rastro(jsonb) from public, anon;
grant execute on function registrar_rastro(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- E · a trava do GPS simulado mora no banco (baixa e status)
-- ---------------------------------------------------------------------------
-- Mesmos corpos da 096, com uma guarda a mais para o campo. CREATE OR
-- REPLACE com a mesma assinatura: a ACL se mantém.
create or replace function baixar_os(p_os uuid, p_codigo integer, p_sub_falha uuid default null,
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
    -- 097: localização simulada ativa trava a baixa.
    if gps_bloqueado(meu_tecnico_id()) then
      raise exception 'O GPS do celular esta informando uma localizacao simulada. Desative o app de localizacao simulada para continuar.'
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

create or replace function registrar_etapa(p_visita uuid, p_situacao text, p_observacao text default null,
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
    -- 097: com localização simulada ativa, o campo não muda status.
    if gps_bloqueado(meu_tecnico_id()) then
      raise exception 'O GPS do celular esta informando uma localizacao simulada. Desative o app de localizacao simulada para continuar.'
        using errcode = '42501';
    end if;
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

-- ---------------------------------------------------------------------------
-- F · a ciência do técnico
-- ---------------------------------------------------------------------------
create table if not exists ciencia_rastro (
  id         bigint generated always as identity primary key,
  empresa_id uuid not null references empresa(id),
  usuario_id uuid not null,
  tecnico_id uuid references tecnico(id) on delete set null,
  -- A versão do texto. Texto novo = versão nova = pergunta de novo.
  versao     text not null,
  aceito_em  timestamptz not null default now(),
  unique (usuario_id, versao)
);
alter table ciencia_rastro enable row level security;
drop policy if exists ciencia_rastro_leitura on ciencia_rastro;
create policy ciencia_rastro_leitura on ciencia_rastro for select to authenticated using (
  usuario_id = (select auth.uid())
  or (empresa_id = (select minha_empresa()) and (select eh_gestao())));

create or replace function registrar_ciencia_rastro(p_versao text)
returns timestamptz
language plpgsql security definer set search_path to 'public' as $fn$
declare v_em timestamptz;
begin
  if coalesce(btrim(p_versao), '') = '' then
    raise exception 'Versao do aviso vazia.' using errcode = '22023';
  end if;
  insert into ciencia_rastro (empresa_id, usuario_id, tecnico_id, versao)
  values (minha_empresa(), auth.uid(), meu_tecnico_id(), p_versao)
  on conflict (usuario_id, versao) do nothing;
  select aceito_em into v_em from ciencia_rastro where usuario_id = auth.uid() and versao = p_versao;
  return v_em;
end;
$fn$;
revoke all on function registrar_ciencia_rastro(text) from public, anon;
grant execute on function registrar_ciencia_rastro(text) to authenticated;

-- ---------------------------------------------------------------------------
-- G · o sino: CERCA e GPS entram como sinais (095)
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'sinal'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%tipo%' loop
    execute format('alter table sinal drop constraint %I', r.conname);
  end loop;
end $$;
alter table sinal add constraint sinal_tipo_check check (tipo in
  ('AJUDA','TEC1','RITMO','QUEBROU','MATERIAL','ABASTECIMENTO','CERCA','GPS'));

-- Corpo = o que está NO BANCO (com a 095c), mais o bloco 097 e o filtro.
create or replace function sinais_do_dia()
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_c jsonb := central_do_controle();
  v_hoje date := hoje_local();
  v_ini timestamptz := (hoje_local()::timestamp at time zone 'America/Manaus');
  v_emp uuid := minha_empresa();
  v_gestao boolean := eh_gestao();
  v_vigentes text[] := '{}';
  v_sinais jsonb;
begin
  if v_gestao then
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'AJUDA:' || (x->>'visita_id') || ':' || (x->>'desde'), v_hoje, 'AJUDA',
           'Suporte técnico: ' || coalesce(x->>'tecnico', 'técnico'),
           concat_ws(' · ', x->>'servico',
                     case when x->>'contrato' is not null then 'contrato ' || (x->>'contrato') end,
                     x->>'observacao'),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from jsonb_array_elements(coalesce(v_c->'ajuda', '[]')) x
      join visita v on v.id = (x->>'visita_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'AJUDA:' || (x->>'visita_id') || ':' || (x->>'desde')
                                        from jsonb_array_elements(coalesce(v_c->'ajuda', '[]')) x);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'TEC1:' || v.id, v_hoje, 'TEC1', 'TEC1 perdido: ' || coalesce(t.nome, 'sem técnico'),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     case when e.codigo is not null then 'equipe ' || e.codigo end),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe e on e.id = v.equipe_id
     where v.empresa_id = v_emp and v.excluido_em is null
       and v.data_agendada = v_hoje and v.tec1 = 'SEM_PADRAO'
       and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'TEC1:' || v.id from visita v
       where v.empresa_id = v_emp and v.excluido_em is null
         and v.data_agendada = v_hoje and v.tec1 = 'SEM_PADRAO');

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'RITMO:' || (a->>'tecnico_id') || ':' || v_hoje || ':' || (c->>'corte'), v_hoje, 'RITMO',
           'Abaixo do ritmo até ' || (c->>'corte') || 'h: ' || (a->>'nome'),
           (a->>'pontos') || ' de ' || (a->>'esperado') || ' pts esperados',
           (a->>'tecnico_id')::uuid, t.equipe_id
      from jsonb_array_elements(coalesce(v_c->'ritmo', '[]')) c
      cross join jsonb_array_elements(c->'abaixo') a
      left join tecnico t on t.id = (a->>'tecnico_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    -- 095c: vigente e so o corte mais recente; os anteriores sao historico.
    v_vigentes := v_vigentes || array(
      select 'RITMO:' || (a->>'tecnico_id') || ':' || v_hoje || ':' || (u.c->>'corte')
        from (select e.c from jsonb_array_elements(coalesce(v_c->'ritmo', '[]'))
                         with ordinality e(c, i)
               order by e.i desc limit 1) u
        cross join jsonb_array_elements(u.c->'abaixo') a);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'QUEBROU:' || (q->>'tecnico_id') || ':' || v_hoje || ':' || (q->>'quebradas'), v_hoje, 'QUEBROU',
           'Contrato quebrado: ' || (q->>'nome'),
           (q->>'quebradas') || ' quebrado(s) hoje · −' || (q->>'pontos_perdidos') || ' pts',
           (q->>'tecnico_id')::uuid, t.equipe_id
      from jsonb_array_elements(coalesce(v_c->'quebrou', '[]')) q
      left join tecnico t on t.id = (q->>'tecnico_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'QUEBROU:' || (q->>'tecnico_id') || ':' || v_hoje || ':' || (q->>'quebradas')
        from jsonb_array_elements(coalesce(v_c->'quebrou', '[]')) q);

    -- 097 · cerca: por EVENTO. Vigente enquanto ele continua do lado que
    -- disparou (saiu e não voltou).
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'CERCA:' || ev.id, v_hoje, 'CERCA',
           case ev.tipo when 'SAIU' then 'Saiu ' else 'Entrou ' end
             || case ce.tipo when 'GARAGEM' then 'da garagem ' else 'da área ' end
             || '"' || ce.nome || '": ' || coalesce(t.nome, 'técnico'),
           to_char(ev.em at time zone 'America/Manaus', 'HH24:MI'),
           ev.tecnico_id, ev.equipe_id
      from cerca_evento ev
      join cerca ce on ce.id = ev.cerca_id
      left join tecnico t on t.id = ev.tecnico_id
     where ev.empresa_id = v_emp and ev.alerta and ev.em >= v_ini
       and (eh_gestor() or ev.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'CERCA:' || ev.id from cerca_evento ev
        join cerca_estado st on st.tecnico_id = ev.tecnico_id and st.cerca_id = ev.cerca_id
       where ev.empresa_id = v_emp and ev.alerta and ev.em >= v_ini
         and st.dentro = (ev.tipo = 'ENTROU') and st.desde = ev.em);

    -- 097 · GPS: por ALERTA. Simulado/desligado/negado: vigente enquanto o
    -- estado continua o mesmo. Salto e aparelho modificado: o dia.
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'GPS:' || ga.id, v_hoje, 'GPS',
           case ga.tipo
             when 'SIMULADO' then 'Localização simulada: '
             when 'DESLIGADO' then 'GPS desligado: '
             when 'SEM_PERMISSAO' then 'Localização negada: '
             when 'SALTO' then 'Salto de posição: '
             else 'Aparelho modificado: ' end || coalesce(t.nome, 'técnico'),
           concat_ws(' · ', to_char(ga.em at time zone 'America/Manaus', 'HH24:MI'), ga.detalhe),
           ga.tecnico_id, ga.equipe_id
      from gps_alerta ga
      left join tecnico t on t.id = ga.tecnico_id
     where ga.empresa_id = v_emp and ga.em >= v_ini and ga.tipo <> 'NORMALIZADO'
       and (eh_gestor() or ga.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'GPS:' || ga.id from gps_alerta ga
        left join tecnico_gps g on g.tecnico_id = ga.tecnico_id
       where ga.empresa_id = v_emp and ga.em >= v_ini and ga.tipo <> 'NORMALIZADO'
         and (ga.tipo in ('SALTO', 'APARELHO_MODIFICADO')
              or (g.estado = ga.tipo and g.desde = ga.em)));
  end if;

  if v_c ? 'material' then
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe)
    select v_emp, 'MATERIAL:' || (m->>'id'), v_hoje, 'MATERIAL',
           case m->>'tipo' when 'FALTANDO' then 'Faltando: ' else 'Com defeito: ' end || coalesce(m->>'item', '—'),
           m->>'tecnico'
      from jsonb_array_elements(v_c->'material') m
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'MATERIAL:' || (m->>'id') from jsonb_array_elements(v_c->'material') m);
  end if;

  if v_c ? 'abastecimento' then
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe)
    select v_emp, 'ABAST:' || (a->>'id'), v_hoje, 'ABASTECIMENTO',
           'Abastecimento pedido: ' || (a->>'placa'),
           concat_ws(' · ', a->>'tecnico', 'R$ ' || (a->>'valor'))
      from jsonb_array_elements(v_c->'abastecimento') a
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'ABAST:' || (a->>'id') from jsonb_array_elements(v_c->'abastecimento') a);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'tipo', s.tipo, 'titulo', s.titulo, 'detalhe', s.detalhe,
           'visita_id', s.visita_id, 'tecnico_id', s.tecnico_id, 'criado_em', s.criado_em,
           'vigente', s.chave = any(v_vigentes),
           'dispensado', d.sinal_id is not null) order by s.criado_em desc), '[]'::jsonb)
    into v_sinais
    from sinal s
    left join sinal_dispensa d on d.sinal_id = s.id and d.usuario_id = auth.uid()
   where s.empresa_id = v_emp and s.dia = v_hoje
     and case
           when s.tipo in ('AJUDA','TEC1','RITMO','QUEBROU','CERCA','GPS')
             then v_gestao and (eh_gestor() or s.equipe_id in (select equipes_visiveis()))
           when s.tipo = 'MATERIAL' then tem_permissao('almoxarifado.ver')
           when s.tipo = 'ABASTECIMENTO' then tem_permissao('frota.ver')
           else false
         end;

  return jsonb_build_object('central', v_c, 'sinais', v_sinais);
end;
$function$;

-- A central ouve os dois pelo Realtime (linhas magras: sem dado de
-- assinante) e relê o sino na hora, em vez de esperar o minuto.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'gps_alerta') then
    execute 'alter publication supabase_realtime add table gps_alerta';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'cerca_evento') then
    execute 'alter publication supabase_realtime add table cerca_evento';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- H · o monitor ganha GPS, ciência, cerca e garagem
-- ---------------------------------------------------------------------------
drop function if exists monitor_tecnicos(date);
create function monitor_tecnicos(p_data date)
returns table (
  tecnico_id uuid, nome text, matricula text,
  equipe_id uuid, equipe_codigo text, equipe_nome text, placa text,
  pontos integer, primeiro_em timestamptz, ultimo_em timestamptz,
  ultimo_lat double precision, ultimo_lng double precision,
  ultimo_precisao real, ultimo_motivo text, bateria smallint,
  km numeric,
  contrato_ativo text, situacao_ativa text, visita_ativa uuid,
  contratos integer, encerrados integer,
  baixas_campo integer, baixas_fora integer,
  gps_estado text, gps_desde timestamptz, aparelho_modificado boolean,
  ciencia_em timestamptz, fora_de_area text, na_garagem text, alertas_gps integer
)
language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
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
    select t.id, t.nome, t.matricula, t.equipe_id, e.codigo, e.nome as enome, t.usuario_id
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
       and not r.simulado
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
       and v.equipe_id in (select tec.equipe_id from tec)
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
         coalesce(l.n, 0), coalesce(l.fora, 0),
         coalesce(g.estado, 'NORMAL'), g.desde, coalesce(g.aparelho_modificado, false),
         (select max(ci.aceito_em) from ciencia_rastro ci where ci.usuario_id = t.usuario_id),
         (select string_agg(ce.nome, ', ') from cerca_estado st join cerca ce on ce.id = st.cerca_id
           where st.tecnico_id = t.id and not st.dentro and ce.tipo = 'AREA'
             and ce.arquivado_em is null and ce.alerta_sair),
         (select string_agg(ce.nome, ', ') from cerca_estado st join cerca ce on ce.id = st.cerca_id
           where st.tecnico_id = t.id and st.dentro and ce.tipo = 'GARAGEM' and ce.arquivado_em is null),
         (select count(*)::integer from gps_alerta ga
           where ga.tecnico_id = t.id and ga.em >= v_ini and ga.em < v_fim and ga.tipo <> 'NORMALIZADO')
    from tec t
    left join resumo r on r.tecnico_id = t.id
    left join pt u on u.tecnico_id = t.id and u.rn = 1
    left join tecnico_gps g on g.tecnico_id = t.id
    left join lateral (
      select x.id, x.contrato, x.situacao from vis x
       where x.situacao in ('EM_DESLOCAMENTO', 'EM_EXECUCAO')
         and (x.tecnico_responsavel_id = t.id
              or (x.tecnico_responsavel_id is null and x.equipe_id = t.equipe_id))
       order by x.situacao_em desc nulls last limit 1) a on true
    left join loc l on l.tecnico_id = t.id
   where r.n is not null or l.n is not null
      or exists (select 1 from vis x where x.equipe_id = t.equipe_id)
      or exists (select 1 from gps_alerta ga where ga.tecnico_id = t.id and ga.em >= v_ini and ga.em < v_fim);
end;
$fn$;
revoke all on function monitor_tecnicos(date) from public, anon;
grant execute on function monitor_tecnicos(date) to authenticated;

-- ---------------------------------------------------------------------------
-- I · o expurgo de 90 dias, toda madrugada
-- ---------------------------------------------------------------------------
create or replace function expurgar_rastro()
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare r record; n1 int := 0; n2 int := 0; n3 int := 0; k int;
begin
  for r in select e.id, coalesce((select (p.valor #>> '{}')::int from parametro p
                                   where p.empresa_id = e.id and p.chave = 'rastro_retencao_dias'), 90) as dias
             from empresa e loop
    delete from rastro_ponto where empresa_id = r.id and capturado_em < now() - make_interval(days => r.dias);
    get diagnostics k = row_count; n1 := n1 + k;
    delete from gps_alerta where empresa_id = r.id and em < now() - make_interval(days => r.dias);
    get diagnostics k = row_count; n2 := n2 + k;
    delete from cerca_evento where empresa_id = r.id and em < now() - make_interval(days => r.dias);
    get diagnostics k = row_count; n3 := n3 + k;
  end loop;
  return jsonb_build_object('rastro_ponto', n1, 'gps_alerta', n2, 'cerca_evento', n3);
end;
$fn$;
revoke all on function expurgar_rastro() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'expurgar-rastro';
  -- 07:17 UTC = 03:17 em Manaus: longe do dia de trabalho.
  perform cron.schedule('expurgar-rastro', '17 7 * * *', 'select public.expurgar_rastro()');
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- Aplicada em três partes pelo MCP: 097 (tabelas, cercas, rastro, ciência),
-- 097b (travas em baixar_os/registrar_etapa, sino, monitor, expurgo) e
-- 097c · testar_campo() recriada com 18 cenários (4 novos: GPS simulado
-- barra a baixa; ponto real destrava; técnico não lê rastro; 2 pontos fora
-- da cerca = 1 SAIU; funções da 096/097 fechadas ao anon). A versão final
-- da bateria está NO BANCO: `select pg_get_functiondef('testar_campo()'::regprocedure)`.
-- ============================================================================
