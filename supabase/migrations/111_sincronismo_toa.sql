-- ┌─ 111 · o sincronismo com o TOA ────────────────────────────────────┐
-- │ > "seria bom ter um botão chamado sincronismo (...) conseguimos    │
-- │ >  escolher quanto e quanto tempo queremos que o sistema importe   │
-- │ >  o excel que alimenta o nosso sistema" — Emanuel, 19/10          │
-- │                                                                    │
-- │ O que o Emanuel decidiu (19/10):                                   │
-- │  · a CLARO permite acesso automatizado com login de prestador;     │
-- │    credencial de API ela não dá — então é o caminho do "robô";     │
-- │  · um login do TOA EXCLUSIVO para importação (logar o robô com o   │
-- │    login de uma pessoa derruba a sessão dela — testado);           │
-- │  · quem opera escolhe os buckets e o intervalo: 15, 30 ou 60 min;  │
-- │  · a importação entra em nome de um usuário "Robô de sincronismo"  │
-- │    (papel ROBO, 110), com o registro de quem configurou;           │
-- │  · o robô é um PC da AFLINE com a nossa tela aberta e o TOA        │
-- │    logado; uma extensão do Chrome só busca o arquivo (o navegador  │
-- │    proíbe um site de usar o login de outro).                       │
-- │                                                                    │
-- │ O que o banco guarda:                                              │
-- │  · toa_bucket.numero_toa — o "providerId" do TOA. A exportação é   │
-- │    `?m=gridexport&a=download&providerId=<n>&date=<dia>`; o nome    │
-- │    do bucket não serve na URL.                                     │
-- │  · toa_bucket.sincronizar — os buckets que o robô baixa.           │
-- │  · sincronismo — um por cidade: ligado, intervalo, quem configurou │
-- │    e o PULSO do PC (para a tela dizer "sem sinal há X min" em vez  │
-- │    de deixar todo mundo achando que está importando).              │
-- │  · sincronismo_rodada — cada tentativa, inclusive as que não       │
-- │    viraram importação (sessão do TOA caiu, arquivo igual).         │
-- │                                                                    │
-- │ O DIA é o do servidor (hoje_local), não o relógio do PC (D-166).   │
-- │ Ver D-189.                                                         │
-- └────────────────────────────────────────────────────────────────────┘

-- ─── 1. o número do bucket no TOA ───────────────────────────────────────
alter table toa_bucket
  add column if not exists numero_toa  integer check (numero_toa > 0),
  add column if not exists sincronizar boolean not null default false;

create unique index if not exists toa_bucket_numero_toa_key
  on toa_bucket (empresa_id, numero_toa) where numero_toa is not null;

comment on column toa_bucket.numero_toa is
  'providerId do bucket no TOA (atributo data-id da árvore do Console de Alocação). A exportação é por ele.';
comment on column toa_bucket.sincronizar is
  'O robô de sincronismo baixa este bucket (111, D-189).';

-- Lido da árvore do Console de Alocação do TOA em 19/10/2026, logado com
-- o usuário do Emanuel. Só os buckets que já estão cadastrados aqui; os
-- outros números vistos naquele dia, para quando entrarem:
--   AFLINE - GERAL 259764 · BSB-AFLINE_01 254323 · BSB-AFLINE_02 260307
--   BSB-AFLINE_03_VT 33116 · BSB-AFLINE_04 254321 · BSB-AFLINE_06_VT 33119
--   BSB-AFLINE_08 254322 · BSB-AFLINE_11 254320 · BSB-AFLINE_12_VT 33121
--   BSB-AFLINE_14_VT 35800 · BSB-AFLINE_15_VT 33123 · BSB-AFLINE_17 254325
--   CWL-AFLINE 27274 · CXS-AFLINE 36157 · ITZ-AFLINE 1837
--   ITZ-AFLINE_ADM 69045 · JIP-AFLINE 24786 · MAN-AFLINE_01 251601
--   MAN-AFLINE_02 251602 · MAN-AFLINE_03 263902 · MAN-AFLINE_04 263066
--   MAN-AFLINE_05 251603 · MAN-AFLINE_05_VT 250573 · MAN-AFLINE_ADM 32043
--   MBA-AFLINE 953 · PIT-AFLINE 31698 · PMJ-AFLINE 20252
--   PMJ-AFLINE_VT 20254 · SLS-AFLINE_04 251667 · TMN-AFLINE 28130
--   VHA-AFLINE 26199 · SWAP - INSTALAÇÃO 252393
update toa_bucket t set numero_toa = v.n
  from (values ('ARN-AFLINE', 19946), ('BLM-AFLINE', 38249),
               ('BLM-AFLINE_02_VT', 34779), ('BLM-AFLINE_03_VT', 34780),
               ('BSB-AFLINE', 32891), ('BSB-AFLINE_13_VT', 33122),
               ('GUR-AFLINE', 26806), ('MAN-AFLINE', 32041),
               ('MAN-AFLINE_01_VT', 32040), ('SLS-AFLINE_02', 822),
               ('SLS-AFLINE_02_VT', 824)) as v(nome, n)
 where t.nome = v.nome and t.numero_toa is null;

-- ─── 2. a configuração, uma por cidade ──────────────────────────────────
create table if not exists sincronismo (
  base_id           uuid primary key references base(id),
  empresa_id        uuid not null references empresa(id),
  ligado            boolean not null default false,
  intervalo_min     smallint not null default 30 check (intervalo_min in (15, 30, 60)),
  configurado_por   uuid references perfil(id),
  configurado_em    timestamptz,
  -- o pulso do PC: a tela mede o silêncio por aqui
  executor_id       uuid references perfil(id),
  executor_visto_em timestamptz,
  executor_info     text,
  -- a última vez que o robô falou com o TOA: a sessão estava viva?
  toa_sessao        text check (toa_sessao in ('OK', 'CAIU')),
  toa_sessao_em     timestamptz
);
alter table sincronismo enable row level security;

drop policy if exists sincronismo_leitura on sincronismo;
create policy sincronismo_leitura on sincronismo for select to authenticated using (
  empresa_id = (select minha_empresa())
  and base_id in (select bases_visiveis())
  and ((select eh_gestor()) or (select tem_papel('CONTROLADOR'))
       or (select tem_papel('ROBO'))));
-- Escrita só pelas RPCs abaixo: quem configura e quem pulsa são portas diferentes.

-- ─── 3. cada rodada do robô ─────────────────────────────────────────────
create table if not exists sincronismo_rodada (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresa(id),
  base_id         uuid not null references base(id),
  bucket_id       uuid references toa_bucket(id),
  bucket          text not null,
  dia             date not null,
  iniciada_em     timestamptz not null,
  terminada_em    timestamptz not null default now(),
  -- IMPORTADA   = virou importação (importacao_id preenchido)
  -- SEM_MUDANCA = o TOA devolveu as mesmas linhas da última importação
  -- SEM_SESSAO  = o TOA devolveu a tela de login: alguém tem de entrar de novo
  -- ERRO        = qualquer outra coisa, com a mensagem
  resultado       text not null check (resultado in ('IMPORTADA', 'SEM_MUDANCA', 'SEM_SESSAO', 'ERRO')),
  mensagem        text,
  importacao_id   uuid references importacao(id),
  impressao       text,
  linhas          integer,
  executor_id     uuid references perfil(id) default auth.uid(),
  configurado_por uuid references perfil(id)
);
create index if not exists sincronismo_rodada_base_idx
  on sincronismo_rodada (base_id, terminada_em desc);
create index if not exists sincronismo_rodada_bucket_idx
  on sincronismo_rodada (bucket_id, dia, terminada_em desc);
alter table sincronismo_rodada enable row level security;

drop policy if exists sincronismo_rodada_leitura on sincronismo_rodada;
create policy sincronismo_rodada_leitura on sincronismo_rodada for select to authenticated using (
  empresa_id = (select minha_empresa())
  and base_id in (select bases_visiveis())
  and ((select eh_gestor()) or (select tem_papel('CONTROLADOR'))
       or (select tem_papel('ROBO'))));

-- ─── 4. o robô importa — e só importa ───────────────────────────────────
-- Políticas próprias, mais estreitas que a da gestão: em nome PRÓPRIO,
-- na cidade dele, sem DELETE.
drop policy if exists importacao_robo_ler on importacao;
create policy importacao_robo_ler on importacao for select to authenticated using (
  (select tem_papel('ROBO'))
  and usuario_id = (select auth.uid())
  and empresa_id = (select minha_empresa())
  and base_id in (select bases_visiveis()));

drop policy if exists importacao_robo_criar on importacao;
create policy importacao_robo_criar on importacao for insert to authenticated with check (
  (select tem_papel('ROBO'))
  and usuario_id = (select auth.uid())
  and base_id in (select bases_visiveis()));

drop policy if exists importacao_robo_atualizar on importacao;
create policy importacao_robo_atualizar on importacao for update to authenticated
  using ((select tem_papel('ROBO')) and usuario_id = (select auth.uid())
         and base_id in (select bases_visiveis()))
  with check ((select tem_papel('ROBO')) and usuario_id = (select auth.uid())
              and base_id in (select bases_visiveis()));

drop policy if exists importacao_linha_robo on importacao_linha;
create policy importacao_linha_robo on importacao_linha for insert to authenticated with check (
  (select tem_papel('ROBO'))
  and importacao_id in (select i.id from importacao i where i.usuario_id = (select auth.uid())));

-- importar_toa e reconciliar_importacao: a mesma porta, com o ROBO.
-- Editado sobre a versão VIVA (pg_get_functiondef), não sobre o arquivo
-- da migration — ver traps.md, "o arquivo pode estar atrasado".
do $do$
declare
  v_def text; v_n int; f text;
  v_de   constant text := '(eh_gestor() or tem_papel(''CONTROLADOR''))';
  v_para constant text := '(eh_gestor() or tem_papel(''CONTROLADOR'') or tem_papel(''ROBO''))';
begin
  foreach f in array array['public.importar_toa(uuid,boolean)', 'public.reconciliar_importacao(uuid)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    v_n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
    if v_n <> 1 then
      raise exception '%: esperava 1 trecho de permissao, achei %', f, v_n;
    end if;
    execute replace(v_def, v_de, v_para);
  end loop;
end
$do$;

-- ─── 5. as portas ───────────────────────────────────────────────────────

-- Quem opera liga, desliga, escolhe intervalo e buckets.
create or replace function public.configurar_sincronismo(
  p_base uuid, p_ligado boolean, p_intervalo smallint, p_buckets uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_buckets uuid[] := coalesce(p_buckets, '{}');
begin
  -- A mesma porta de quem importa à mão. O robô NÃO se configura: quem
  -- decide o que ele faz é gente (D-189).
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao para configurar o sincronismo.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_visiveis()) then
    raise exception 'Esta cidade nao e a cidade ativa da sua tela.' using errcode = '42501';
  end if;
  if p_intervalo is null or p_intervalo not in (15, 30, 60) then
    raise exception 'Intervalo invalido: use 15, 30 ou 60 minutos.';
  end if;
  if exists (select 1 from unnest(v_buckets) b
              where b not in (select t.id from toa_bucket t where t.base_id = p_base)) then
    raise exception 'Um dos buckets marcados nao e desta cidade.';
  end if;
  if coalesce(p_ligado, false) and not exists (
       select 1 from toa_bucket t
        where t.base_id = p_base and t.id = any(v_buckets)
          and t.ativo and t.numero_toa is not null) then
    raise exception 'Para ligar, marque ao menos um bucket ligado e com o numero do TOA.';
  end if;

  update toa_bucket set sincronizar = (id = any(v_buckets)) where base_id = p_base;

  insert into sincronismo (base_id, empresa_id, ligado, intervalo_min, configurado_por, configurado_em)
  select b.id, b.empresa_id, coalesce(p_ligado, false), p_intervalo, auth.uid(), now()
    from base b where b.id = p_base
  on conflict (base_id) do update
     set ligado = excluded.ligado, intervalo_min = excluded.intervalo_min,
         configurado_por = excluded.configurado_por, configurado_em = excluded.configurado_em;

  return jsonb_build_object('base', p_base, 'ligado', coalesce(p_ligado, false),
                            'intervalo_min', p_intervalo, 'buckets', to_jsonb(v_buckets));
end;
$function$;

-- O número do bucket no TOA: cadastro, como o próprio bucket — ADMIN.
create or replace function public.definir_numero_toa(p_bucket uuid, p_numero integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not tem_papel('ADMIN') then
    raise exception 'So o ADMIN cadastra o numero do bucket no TOA.' using errcode = '42501';
  end if;
  if not exists (select 1 from toa_bucket t
                  where t.id = p_bucket and t.base_id in (select bases_visiveis())) then
    raise exception 'Bucket fora da cidade ativa.' using errcode = '42501';
  end if;
  if p_numero is not null and p_numero <= 0 then
    raise exception 'O numero do TOA e positivo (ex.: 32041).';
  end if;
  begin
    update toa_bucket set numero_toa = p_numero,
           sincronizar = sincronizar and p_numero is not null
     where id = p_bucket;
  exception when unique_violation then
    raise exception 'O numero % ja e de outro bucket.', p_numero;
  end;
end;
$function$;

-- O PC do robô bate o pulso a cada minuto e recebe o que fazer. O
-- servidor decide o que está VENCIDO e o dia: o relógio do PC não manda.
create or replace function public.sincronismo_pulso(
  p_base uuid, p_info text default null, p_toa_sessao text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s sincronismo; v_hoje date := hoje_local();
begin
  if not tem_papel('ROBO') then
    raise exception 'So o usuario do robo de sincronismo bate o pulso.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_visiveis()) then
    raise exception 'Cidade fora do acesso do robo.' using errcode = '42501';
  end if;
  if p_toa_sessao is not null and p_toa_sessao not in ('OK', 'CAIU') then
    raise exception 'Estado de sessao invalido.';
  end if;

  insert into sincronismo (base_id, empresa_id)
  select b.id, b.empresa_id from base b where b.id = p_base
  on conflict (base_id) do nothing;

  update sincronismo
     set executor_id = auth.uid(), executor_visto_em = now(),
         executor_info = left(p_info, 300),
         toa_sessao = coalesce(p_toa_sessao, toa_sessao),
         toa_sessao_em = case when p_toa_sessao is null then toa_sessao_em else now() end
   where base_id = p_base
  returning * into s;

  return jsonb_build_object(
    'ligado', s.ligado, 'intervalo_min', s.intervalo_min, 'hoje', v_hoje, 'agora', now(),
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'nome', t.nome, 'numero_toa', t.numero_toa,
               -- vencido: a última tentativa foi há um intervalo ou mais
               -- (30 s de folga para o pulso de 60 s não escorregar um minuto
               -- por rodada)
               'vencido', u.em is null
                          or now() - u.em >= make_interval(mins => s.intervalo_min) - interval '30 seconds',
               -- a impressão da última importação DE HOJE: arquivo igual não
               -- reimporta — a menos que faça 1 hora, para código cadastrado
               -- depois (D-185) e reconciliação acabarem valendo.
               'impressao', case when imp.em > now() - interval '60 minutes' then imp.impressao end
             ) order by t.nome)
        from toa_bucket t
        left join lateral (
          select max(r.terminada_em) as em from sincronismo_rodada r
           where r.bucket_id = t.id and r.dia = v_hoje) u on true
        left join lateral (
          select r.impressao, r.terminada_em as em from sincronismo_rodada r
           where r.bucket_id = t.id and r.dia = v_hoje and r.resultado = 'IMPORTADA'
           order by r.terminada_em desc limit 1) imp on true
       where t.base_id = p_base and t.ativo and t.sincronizar and t.numero_toa is not null
    ), '[]'::jsonb));
end;
$function$;

-- Cada tentativa fica registrada — inclusive a que não importou nada.
create or replace function public.sincronismo_registrar_rodada(
  p_base uuid, p_bucket uuid, p_dia date, p_iniciada_em timestamptz,
  p_resultado text, p_mensagem text default null, p_importacao uuid default null,
  p_impressao text default null, p_linhas integer default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id uuid; v_nome text; v_emp uuid;
begin
  if not tem_papel('ROBO') then
    raise exception 'So o usuario do robo de sincronismo registra rodada.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_visiveis()) then
    raise exception 'Cidade fora do acesso do robo.' using errcode = '42501';
  end if;
  select t.nome, t.empresa_id into v_nome, v_emp
    from toa_bucket t where t.id = p_bucket and t.base_id = p_base;
  if v_nome is null then
    raise exception 'Bucket nao e desta cidade.';
  end if;
  if p_importacao is not null and not exists (
       select 1 from importacao i
        where i.id = p_importacao and i.usuario_id = auth.uid() and i.base_id = p_base) then
    raise exception 'Importacao nao e deste robo.' using errcode = '42501';
  end if;

  insert into sincronismo_rodada (empresa_id, base_id, bucket_id, bucket, dia, iniciada_em,
         resultado, mensagem, importacao_id, impressao, linhas, executor_id, configurado_por)
  values (v_emp, p_base, p_bucket, v_nome, coalesce(p_dia, hoje_local()),
         least(coalesce(p_iniciada_em, now()), now()), p_resultado, left(p_mensagem, 1000),
         p_importacao, p_impressao, p_linhas, auth.uid(),
         (select s.configurado_por from sincronismo s where s.base_id = p_base))
  returning id into v_id;

  -- A sessão do TOA se lê do resultado: login de volta = caiu.
  update sincronismo
     set toa_sessao = case p_resultado when 'SEM_SESSAO' then 'CAIU'
                                       when 'IMPORTADA' then 'OK'
                                       when 'SEM_MUDANCA' then 'OK'
                                       else toa_sessao end,
         toa_sessao_em = case when p_resultado = 'ERRO' then toa_sessao_em else now() end
   where base_id = p_base;
  return v_id;
end;
$function$;

-- Função criada do zero nasce aberta para o anon (security.md).
revoke all on function public.configurar_sincronismo(uuid, boolean, smallint, uuid[]) from public, anon;
revoke all on function public.definir_numero_toa(uuid, integer) from public, anon;
revoke all on function public.sincronismo_pulso(uuid, text, text) from public, anon;
revoke all on function public.sincronismo_registrar_rodada(uuid, uuid, date, timestamptz, text, text, uuid, text, integer) from public, anon;
grant execute on function public.configurar_sincronismo(uuid, boolean, smallint, uuid[]) to authenticated;
grant execute on function public.definir_numero_toa(uuid, integer) to authenticated;
grant execute on function public.sincronismo_pulso(uuid, text, text) to authenticated;
grant execute on function public.sincronismo_registrar_rodada(uuid, uuid, date, timestamptz, text, text, uuid, text, integer) to authenticated;

-- ─── 6. a bateria ganha o robô ──────────────────────────────────────────
create or replace function public._prepara_teste_robo(p_base uuid)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare v uuid := gen_random_uuid(); v_emp uuid;
begin
  select empresa_id into v_emp from base where id = p_base;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          '_teste_robo@policy.local', 'x', now(), now());
  insert into perfil (id, nome, email, empresa_id, base_id, ativo)
  values (v, '_TESTE ROBO', '_teste_robo@policy.local', v_emp, p_base, true);
  insert into usuario_papel (usuario_id, papel, escopo, base_id) values (v, 'ROBO', 'BASE', p_base);
  return v;
end;
$function$;

create or replace function public._limpa_teste_robo(p_robo uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if p_robo is null then return; end if;
  delete from sincronismo_rodada where executor_id = p_robo;
  delete from importacao_linha where importacao_id in (select id from importacao where usuario_id = p_robo);
  delete from importacao     where usuario_id = p_robo;
  delete from usuario_papel  where usuario_id = p_robo;
  delete from perfil         where id = p_robo;
  delete from auth.users     where id = p_robo;
end;
$function$;

revoke all on function public._prepara_teste_robo(uuid) from public, anon, authenticated;
revoke all on function public._limpa_teste_robo(uuid) from public, anon, authenticated;

-- testar_policies: a versão viva da 103, com o bloco ROBO antes do
-- CONTROLADOR (que exclui a visita de teste — o robô tem de tentar
-- excluir uma visita que ainda existe, senão "barrado" não prova nada).
create or replace function public.testar_policies()
 returns table(cenario text, esperado text, obtido text, passou boolean)
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_tec uuid; v_sup uuid; v_ctrl uuid; v_visita uuid; n int; v_robo uuid; v_base uuid;
begin
  select p.tec, p.sup, p.ctrl, p.visita into v_tec, v_sup, v_ctrl, v_visita
    from _prepara_teste_policy() p;
  select base_id into v_base from perfil where id = v_sup;
  v_robo := _prepara_teste_robo(v_base);

  -- ============ TECNICO ============
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tec::text, 'role','authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from perfil;
  return query select 'TECNICO enxerga perfis'::text,'1 (so o proprio)'::text,n::text,n=1;
  return query select 'TECNICO tem_papel(ADMIN)'::text,'false'::text,
    tem_papel('ADMIN')::text, tem_papel('ADMIN')=false;
  return query select 'TECNICO tem_permissao(admin.usuarios)'::text,'false'::text,
    tem_permissao('admin.usuarios')::text, tem_permissao('admin.usuarios')=false;

  begin
    insert into usuario_papel (usuario_id,papel,escopo) values (v_tec,'ADMIN','GLOBAL');
    return query select 'TECNICO se promove a ADMIN'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO se promove a ADMIN'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    update perfil set perfil_acesso_id=(select id from perfil_acesso where nome='Administrador')
     where id=v_tec;
    return query select 'TECNICO troca proprio perfil de acesso'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO troca proprio perfil de acesso'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    update perfil set whatsapp='92000000000' where id=v_tec;
    get diagnostics n = row_count;
    return query select 'TECNICO muda proprio telefone'::text,'1 linha'::text,n::text||' linha',n=1;
  exception when others then
    return query select 'TECNICO muda proprio telefone'::text,'1 linha'::text,'BARRADO'::text,false;
  end;

  -- 101: a data de contratacao e registro da empresa. A policy de
  -- autoedicao libera a linha inteira; quem barra e o gatilho.
  begin
    update perfil set data_contratacao = date '2000-01-01' where id=v_tec;
    return query select 'TECNICO muda propria data de contratacao'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO muda propria data de contratacao'::text,'barrado'::text,'barrado'::text,true;
  end;

  -- 103: cidade que nao e dele, e a propria foto.
  begin
    perform trocar_cidade((select b.id from base b where b.id not in (select bases_permitidas()) limit 1));
    return query select 'TECNICO troca para cidade que nao e dele'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO troca para cidade que nao e dele'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    update perfil set foto_path = v_tec::text || '/teste.jpg' where id=v_tec;
    return query select 'TECNICO troca a propria foto'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO troca a propria foto'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    perform definir_papeis(v_tec, array['ADMIN']);
    return query select 'TECNICO chama definir_papeis'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO chama definir_papeis'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    perform excluir_visita(v_visita,'teste');
    return query select 'TECNICO exclui contrato'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'TECNICO exclui contrato'::text,'barrado'::text,'barrado'::text,true;
  end;

  select count(*) into n from regra_pontuacao;
  return query select 'TECNICO le tabela de pontuacao'::text,'maior que zero'::text,n::text,n>0;

  update regra_pontuacao set observacao = observacao
   where id = (select id from regra_pontuacao order by criado_em limit 1);
  get diagnostics n = row_count;
  return query select 'TECNICO edita pontuacao'::text,'0 linhas'::text,n::text||' linhas',n=0;

  select count(*) into n from visita;
  return query select 'TECNICO enxerga visitas'::text,'0 (nao tem tecnico vinculado)'::text,n::text,n=0;

  -- ============ SUPERVISOR ============
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sup::text,'role','authenticated')::text, true);
  begin
    insert into cargo (nome) values ('_TESTE CARGO');
    return query select 'SUPERVISOR cria cargo'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'SUPERVISOR cria cargo'::text,'barrado'::text,'barrado'::text,true;
  end;

  select count(*) into n from perfil;
  return query select 'SUPERVISOR enxerga perfis'::text,'1 (nao e gestor)'::text,n::text,n=1;

  -- 111: quem configura o robo e quem importa a mao, nao o supervisor.
  begin
    perform configurar_sincronismo(v_base, false, 30::smallint, '{}'::uuid[]);
    return query select 'SUPERVISOR configura o sincronismo'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'SUPERVISOR configura o sincronismo'::text,'barrado'::text,'barrado'::text,true;
  end;

  -- ============ ROBO (111) ============
  -- O robo importa -- e so importa. A senha dele mora num PC ligado o dia
  -- todo: se vazar, o estrago tem de ser "importou uma planilha".
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_robo::text,'role','authenticated')::text, true);

  select count(*) into n from visita;
  return query select 'ROBO enxerga contratos'::text,'0 (so importa)'::text,n::text,n=0;

  begin
    perform excluir_visita(v_visita,'teste');
    return query select 'ROBO exclui contrato'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'ROBO exclui contrato'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    insert into importacao (base_id, usuario_id, arquivo_nome, arquivo_path, fonte)
    values (v_base, v_robo, '_teste_robo.xlsx', 'teste/_teste_robo.xlsx', 'TOA');
    return query select 'ROBO registra importacao em nome proprio'::text,'permitido'::text,'permitido'::text,true;
  exception when others then
    return query select 'ROBO registra importacao em nome proprio'::text,'permitido'::text,('BARRADO: '||SQLERRM)::text,false;
  end;

  begin
    insert into importacao (base_id, usuario_id, arquivo_nome, arquivo_path, fonte)
    values (v_base, v_ctrl, '_teste_robo_outro.xlsx', 'teste/_teste_robo_outro.xlsx', 'TOA');
    return query select 'ROBO registra importacao em nome de outro'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'ROBO registra importacao em nome de outro'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    perform configurar_sincronismo(v_base, true, 15::smallint, '{}'::uuid[]);
    return query select 'ROBO configura o proprio sincronismo'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'ROBO configura o proprio sincronismo'::text,'barrado'::text,'barrado'::text,true;
  end;

  -- ============ CONTROLADOR ============
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ctrl::text,'role','authenticated')::text, true);

  select count(*) into n from perfil;
  return query select 'CONTROLADOR enxerga perfis da empresa'::text,'mais de 1'::text,n::text,n>1;

  begin
    perform sincronismo_pulso(v_base, 'teste', null);
    return query select 'CONTROLADOR se passa pelo robo'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'CONTROLADOR se passa pelo robo'::text,'barrado'::text,'barrado'::text,true;
  end;

  begin
    perform excluir_visita(v_visita,'teste de policy');
    return query select 'CONTROLADOR exclui contrato'::text,'permitido'::text,'permitido'::text,true;
  exception when others then
    return query select 'CONTROLADOR exclui contrato'::text,'permitido'::text,('BARRADO: '||SQLERRM)::text,false;
  end;

  begin
    insert into permissao (chave,modulo,rotulo) values ('_teste.x','X','X');
    return query select 'CONTROLADOR escreve no catalogo de permissao'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'CONTROLADOR escreve no catalogo de permissao'::text,'barrado'::text,'barrado'::text,true;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims','',true);
  perform _limpa_teste_robo(v_robo);
  perform _limpa_teste_policy(v_tec, v_sup, v_ctrl, v_visita);
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims','',true);
  perform _limpa_teste_robo(v_robo);
  perform _limpa_teste_policy(v_tec, v_sup, v_ctrl, v_visita);
  raise;
end;
$function$;

notify pgrst, 'reload schema';
