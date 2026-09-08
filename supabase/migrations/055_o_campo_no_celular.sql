-- 055 · O campo no celular: evidência, equipamento e as travas da baixa
--
-- ┌─ O QUE ESTA MIGRATION RESOLVE ───────────────────────────────────┐
-- │ O aplicativo do técnico (Expo, `campo/`) precisa de três coisas   │
-- │ que o banco ainda não dava:                                       │
-- │                                                                   │
-- │  1. Onde guardar foto e vídeo — bucket `evidencia` no Storage,    │
-- │     privado, com a MESMA regra de visibilidade da visita.         │
-- │  2. Quem tirou a foto e de onde — carimbado pelo servidor, como   │
-- │     em `registrar_etapa` (D-061). Autor que vem do cliente não é  │
-- │     prova de nada.                                                │
-- │  3. As travas que o Emanuel pediu em 08/09/2026:                  │
-- │       · o técnico só baixa com o GPS ligado (lat/lng na chamada); │
-- │       · baixa dada não se desfaz pelo campo;                      │
-- │       · situação terminal (CONCLUÍDA/CANCELADA/REAGENDAMENTO)     │
-- │         não volta pela mão do técnico;                            │
-- │       · depois de baixado ele ainda ANEXA foto e equipamento,     │
-- │         mas só enquanto o contrato for do dia corrente.           │
-- └───────────────────────────────────────────────────────────────────┘
--
-- Ver D-112 a D-116 em docs/03-DECISOES.md.

-- ============================================================
-- A · O dia é o de Manaus, não o do servidor
-- ============================================================
-- `current_date` no Postgres da Supabase é UTC: às 20h de Manaus ele já
-- virou. A regra "só anexa no contrato de hoje" medida em UTC tiraria o
-- celular do técnico do ar quatro horas antes da meia-noite dele. É o
-- mesmo erro do `toISOString()` na tela (D-084), do lado do banco.
create or replace function hoje_local() returns date
language sql stable set search_path to 'public' as $fn$
  select (now() at time zone 'America/Manaus')::date;
$fn$;

revoke all on function hoje_local() from public, anon;
grant execute on function hoje_local() to authenticated;

comment on function hoje_local() is
  'A data corrente no fuso da operação (America/Manaus). Use no lugar de current_date em qualquer regra que o usuário enxergue.';

-- ============================================================
-- B · A evidência ganha mídia, autor e origem
-- ============================================================
-- A tabela nasceu em 004 pensando só em foto. Vídeo tem duração e pesa
-- 200 vezes mais: sem `midia` e `mime` a tela não sabe se renderiza um
-- <img> ou um player, e sem `tamanho_bytes` ninguém percebe o técnico
-- subindo 80 MB no 4G da rua.
alter table evidencia add column if not exists midia text not null default 'FOTO';
alter table evidencia add column if not exists mime text;
alter table evidencia add column if not exists duracao_seg integer;
alter table evidencia add column if not exists usuario_id uuid references perfil(id);
alter table evidencia add column if not exists login text;
alter table evidencia add column if not exists origem text;
alter table evidencia add column if not exists observacao text;
alter table evidencia add column if not exists precisao_m numeric(8,2);

do $$ begin
  alter table evidencia add constraint evidencia_midia_ck
    check (midia in ('FOTO','VIDEO'));
exception when duplicate_object then null; end $$;

comment on column evidencia.midia is
  'FOTO ou VIDEO. Decide o player na tela e o limite de tamanho no envio.';
comment on column evidencia.precisao_m is
  'Raio de incerteza do GPS em metros, como o aparelho reportou. Foto com 2 km de precisão não prova presença — quem audita precisa ver isso.';
comment on column evidencia.arquivo_path is
  'Caminho dentro do bucket `evidencia`, sempre <visita_id>/<arquivo>. O prefixo NÃO é enfeite: é por ele que a policy do Storage descobre de qual visita o arquivo é.';

-- O equipamento também precisa dizer quem lançou.
alter table equipamento_movimento add column if not exists usuario_id uuid references perfil(id);
alter table equipamento_movimento add column if not exists login text;
alter table equipamento_movimento add column if not exists origem text;
alter table equipamento_movimento add column if not exists observacao text;

-- ============================================================
-- C · O bucket, e a regra de quem enxerga o arquivo
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencia', 'evidencia', false, 52428800,
        array['image/jpeg','image/png','image/webp','image/heic',
              'video/mp4','video/quicktime'])
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- O caminho carrega a visita. Sem esta função a policy teria de fazer
-- `substring(name,1,36)::uuid`, que estoura em qualquer objeto cujo nome
-- não seja um UUID — e policy que estoura vira negação silenciosa em
-- cima de tudo. O CASE garante a ordem de avaliação.
create or replace function visita_do_path(p_name text) returns uuid
language sql immutable as $fn$
  select case
    when p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
    then substring(p_name from 1 for 36)::uuid
  end;
$fn$;

revoke all on function visita_do_path(text) from public, anon;
grant execute on function visita_do_path(text) to authenticated;

-- `select id from visita` passa pelo RLS da visita: o arquivo é visível
-- para exatamente quem já podia ver o contrato. Uma regra só, um lugar só.
drop policy if exists evidencia_arquivo_ver    on storage.objects;
drop policy if exists evidencia_arquivo_enviar on storage.objects;

create policy evidencia_arquivo_ver on storage.objects for select to authenticated
  using (bucket_id = 'evidencia' and visita_do_path(name) in (select id from visita));

create policy evidencia_arquivo_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'evidencia' and visita_do_path(name) in (select id from visita));

-- Não há policy de UPDATE nem de DELETE: evidência é prova.

-- ============================================================
-- D · Onde a permissão do campo é conferida
-- ============================================================
-- Um lugar só, chamado por `registrar_evidencia` e `registrar_equipamento`.
-- Duplicar a regra é onde as duas cópias divergem (035).
create or replace function pode_anexar_na_visita(p_visita uuid)
returns date language plpgsql stable security definer set search_path to 'public'
as $fn$
declare v_data date; v_equipe uuid;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para anexar.' using errcode = '42501';
  end if;
  if not tem_permissao('servicos.anexar') then
    raise exception 'Seu perfil de acesso nao inclui "Anexar".'
      using errcode = '42501';
  end if;

  select data_agendada, equipe_id into v_data, v_equipe
    from visita
   where id = p_visita and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis())
     and excluido_em is null;
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  if not eh_gestor() and (v_equipe is null
      or v_equipe not in (select equipes_visiveis())) then
    raise exception 'Este contrato nao e da sua equipe.' using errcode = '42501';
  end if;

  -- A janela do campo. Baixado ou não, o técnico anexa o que faltou —
  -- foto que não subiu, equipamento que ele esqueceu de lançar — mas só
  -- no dia. Depois disso a prova vira assunto do controlador.
  if tem_papel('TECNICO') and not eh_gestor()
     and not (tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'))
     and v_data <> hoje_local() then
    raise exception 'Contrato de % — o campo so anexa no dia. Fale com o controlador.',
      to_char(v_data, 'DD/MM')
      using errcode = '42501';
  end if;

  return v_data;
end;
$fn$;

revoke all on function pode_anexar_na_visita(uuid) from public, anon;
grant execute on function pode_anexar_na_visita(uuid) to authenticated;

-- ============================================================
-- E · registrar_evidencia
-- ============================================================
-- O aplicativo sobe o arquivo para o Storage e depois chama isto. O
-- técnico manda o caminho e a coordenada; QUEM tirou a foto quem diz é
-- o servidor — mesma razão de D-061.
create or replace function registrar_evidencia(
  p_visita       uuid,
  p_arquivo_path text,
  p_tipo         text default 'LIVRE',
  p_midia        text default 'FOTO',
  p_os           uuid default null,
  p_mime         text default null,
  p_bytes        bigint default null,
  p_lat          numeric default null,
  p_lng          numeric default null,
  p_precisao_m   numeric default null,
  p_capturada_em timestamptz default null,
  p_duracao_seg  integer default null,
  p_observacao   text default null)
returns uuid language plpgsql security definer set search_path to 'public'
as $fn$
declare v_tecnico uuid; v_login text; v_id uuid; v_origem text;
begin
  perform pode_anexar_na_visita(p_visita);

  if coalesce(btrim(p_arquivo_path), '') = '' then
    raise exception 'Caminho do arquivo vazio.' using errcode = '23514';
  end if;
  -- O prefixo é a chave da policy do Storage. Caminho fora do padrão
  -- gera linha que aponta para arquivo que ninguém consegue abrir.
  if visita_do_path(p_arquivo_path) is distinct from p_visita then
    raise exception 'O caminho tem de comecar pelo id do contrato.'
      using errcode = '23514';
  end if;
  if p_midia not in ('FOTO','VIDEO') then
    raise exception 'Midia deve ser FOTO ou VIDEO.' using errcode = '23514';
  end if;
  if p_os is not null and not exists (
       select 1 from ordem_servico where id = p_os and visita_id = p_visita) then
    raise exception 'Esta O.S. nao e deste contrato.' using errcode = '23503';
  end if;

  v_tecnico := meu_tecnico_id();
  v_login := coalesce((select matricula from tecnico where id = v_tecnico),
                      (select email from perfil where id = auth.uid()));
  v_origem := case when tem_papel('TECNICO') and not eh_gestor()
                   then 'MOBILE' else 'WEB' end;

  insert into evidencia (visita_id, os_id, tipo, arquivo_path, midia, mime,
                         tamanho_bytes, duracao_seg, lat, lng, precisao_m,
                         capturada_em, tecnico_id, usuario_id, login, origem,
                         observacao)
  values (p_visita, p_os, upper(btrim(p_tipo)), p_arquivo_path, p_midia, p_mime,
          p_bytes, p_duracao_seg, p_lat, p_lng, p_precisao_m,
          coalesce(p_capturada_em, now()), v_tecnico, auth.uid(), v_login,
          v_origem, nullif(btrim(coalesce(p_observacao,'')),''))
  returning id into v_id;

  insert into visita_evento (visita_id, os_id, tipo, para, origem, usuario_id,
                             login, tecnico_id, lat, lng, observacao)
  values (p_visita, p_os, 'EVIDENCIA',
          jsonb_build_object('evidencia_id', v_id, 'midia', p_midia,
                             'tipo', upper(btrim(p_tipo))),
          v_origem, auth.uid(), v_login, v_tecnico, p_lat, p_lng,
          nullif(btrim(coalesce(p_observacao,'')),''));

  return v_id;
end;
$fn$;

revoke all on function registrar_evidencia(uuid, text, text, text, uuid, text, bigint,
                                           numeric, numeric, numeric, timestamptz,
                                           integer, text) from public, anon;
grant execute on function registrar_evidencia(uuid, text, text, text, uuid, text, bigint,
                                              numeric, numeric, numeric, timestamptz,
                                              integer, text) to authenticated;

-- ============================================================
-- F · registrar_equipamento
-- ============================================================
create or replace function registrar_equipamento(
  p_visita     uuid,
  p_operacao   text,
  p_serial     text,
  p_os         uuid default null,
  p_tipo       text default null,
  p_modelo     text default null,
  p_observacao text default null)
returns uuid language plpgsql security definer set search_path to 'public'
as $fn$
declare v_tecnico uuid; v_login text; v_id uuid; v_serial text; v_origem text;
begin
  perform pode_anexar_na_visita(p_visita);

  if p_operacao not in ('INSTALADO','RETIRADO') then
    raise exception 'Operacao deve ser INSTALADO ou RETIRADO.' using errcode = '23514';
  end if;

  -- Serial vem de leitor de código de barras e de dedo em tela pequena:
  -- espaço e caixa variam, o equipamento não.
  v_serial := upper(regexp_replace(coalesce(p_serial,''), '\s', '', 'g'));
  if length(v_serial) < 4 then
    raise exception 'Serial invalido.' using errcode = '23514';
  end if;

  if p_os is not null and not exists (
       select 1 from ordem_servico where id = p_os and visita_id = p_visita) then
    raise exception 'Esta O.S. nao e deste contrato.' using errcode = '23503';
  end if;

  -- Mesmo serial, mesma operação, mesmo contrato: é o técnico batendo
  -- duas vezes no botão, não dois aparelhos.
  select id into v_id from equipamento_movimento
   where visita_id = p_visita and serial = v_serial and operacao = p_operacao;
  if v_id is not null then
    return v_id;
  end if;

  v_tecnico := meu_tecnico_id();
  v_login := coalesce((select matricula from tecnico where id = v_tecnico),
                      (select email from perfil where id = auth.uid()));
  v_origem := case when tem_papel('TECNICO') and not eh_gestor()
                   then 'MOBILE' else 'WEB' end;

  insert into equipamento_movimento (visita_id, os_id, operacao, serial, tipo,
                                     modelo, tecnico_id, usuario_id, login,
                                     origem, observacao)
  values (p_visita, p_os, p_operacao, v_serial, nullif(btrim(coalesce(p_tipo,'')),''),
          nullif(btrim(coalesce(p_modelo,'')),''), v_tecnico, auth.uid(), v_login,
          v_origem, nullif(btrim(coalesce(p_observacao,'')),''))
  returning id into v_id;

  insert into visita_evento (visita_id, os_id, tipo, para, origem, usuario_id,
                             login, tecnico_id, observacao)
  values (p_visita, p_os, 'EQUIPAMENTO',
          jsonb_build_object('operacao', p_operacao, 'serial', v_serial,
                             'tipo', p_tipo, 'modelo', p_modelo),
          v_origem, auth.uid(), v_login, v_tecnico,
          nullif(btrim(coalesce(p_observacao,'')),''));

  return v_id;
end;
$fn$;

revoke all on function registrar_equipamento(uuid, text, text, uuid, text, text, text)
  from public, anon;
grant execute on function registrar_equipamento(uuid, text, text, uuid, text, text, text)
  to authenticated;

-- ============================================================
-- G · A baixa do técnico exige GPS, e não se desfaz
-- ============================================================
-- Duas travas pedidas pelo Emanuel, e a razão de a assinatura mudar:
-- `baixar_os` não recebia coordenada. Como não dá para acrescentar
-- parâmetro com default sem deixar a chamada de 5 argumentos ambígua
-- para o PostgREST, a versão antiga sai e a nova entra — a tela e o
-- aplicativo passam a mandar lat/lng.
drop function if exists baixar_visita(uuid, jsonb, text);
drop function if exists baixar_os(uuid, integer, uuid, text, text);

create or replace function baixar_os(
  p_os uuid, p_codigo integer, p_sub_falha uuid default null,
  p_observacao text default null, p_situacao text default null,
  p_lat numeric default null, p_lng numeric default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
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

  -- "Campo" é quem só tem o papel do campo. Controlador que também é
  -- técnico continua controlador.
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
    -- A trava do GPS. A baixa é o momento em que a AFLINE afirma o que
    -- aconteceu no endereço; afirmar isso sem dizer de onde é o que o
    -- sistema atual permite e o Emanuel quis fechar.
    if p_lat is null or p_lng is null then
      raise exception 'Ligue a localizacao do celular para dar baixa.'
        using errcode = '42501';
    end if;
    -- Baixa dada não se desfaz pelo campo. Trocar código é do
    -- controlador, que tem `reverter_situacao` e deixa motivo (030).
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
     codigo_baixa_id, sub_falha_id, observacao, lat, lng)
  values (v_visita, p_os, 'BAIXA',
          jsonb_build_object('codigo', p_codigo, 'situacao', p_situacao),
          case when v_campo then 'MOBILE' else 'TELA' end,
          auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico, v_cod, p_sub_falha,
          nullif(btrim(coalesce(p_observacao,'')),''),
          p_lat, p_lng);

  return jsonb_build_object('ok', true, 'os', p_os, 'codigo', p_codigo);
end;
$fn$;

revoke all on function baixar_os(uuid, integer, uuid, text, text, numeric, numeric)
  from public, anon;
grant execute on function baixar_os(uuid, integer, uuid, text, text, numeric, numeric)
  to authenticated;

-- Baixa em lote, agora repassando a coordenada. Continua sem duplicar
-- regra: cada item passa por `baixar_os`.
create or replace function baixar_visita(
  p_visita uuid, p_itens jsonb, p_situacao text default null,
  p_lat numeric default null, p_lng numeric default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare it jsonb; n int := 0;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para baixar.' using errcode = '42501';
  end if;

  perform 1 from visita v
   where v.id = p_visita and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb))
  loop
    perform baixar_os(
      (it->>'os_id')::uuid,
      (it->>'codigo')::integer,
      nullif(it->>'sub_falha_id','')::uuid,
      nullif(btrim(coalesce(it->>'observacao','')),''),
      null, p_lat, p_lng);
    n := n + 1;
  end loop;

  if p_situacao is not null then
    perform exige_todas_baixadas(p_visita, p_situacao);

    update visita set situacao = p_situacao, situacao_em = now()
     where id = p_visita;

    insert into visita_evento (visita_id, tipo, para, origem, usuario_id, login,
                               tecnico_id, observacao, lat, lng)
    values (p_visita, 'SITUACAO',
            jsonb_build_object('situacao', p_situacao),
            case when tem_papel('TECNICO') and not eh_gestor()
                 then 'MOBILE' else 'TELA' end,
            auth.uid(),
            coalesce((select matricula from tecnico where id = meu_tecnico_id()),
                     (select email from perfil where id = auth.uid())),
            meu_tecnico_id(),
            format('Baixa de %s O.S.', n), p_lat, p_lng);
  end if;

  return jsonb_build_object('ok', true, 'baixadas', n, 'situacao', p_situacao);
end;
$fn$;

revoke all on function baixar_visita(uuid, jsonb, text, numeric, numeric)
  from public, anon;
grant execute on function baixar_visita(uuid, jsonb, text, numeric, numeric)
  to authenticated;

-- ============================================================
-- H · Situação terminal não volta pela mão do técnico
-- ============================================================
-- A versão de 032 travava CONCLUIDA e CANCELADA, mas REAGENDAMENTO
-- passava — e desde 046 é o código da operadora que manda 1.075
-- contratos para REAGENDAMENTO sozinho. A lista canônica é
-- `situacoes_terminais()` (035); usar ela e não uma cópia.
--
-- E a mesma trava de GPS da baixa vale para FINALIZAR: encerrar a visita
-- é a mesma afirmação, feita pela outra porta.
create or replace function registrar_etapa(
  p_visita     uuid,
  p_situacao   text,
  p_observacao text default null,
  p_lat        numeric default null,
  p_lng        numeric default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
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
    -- Encerrado é encerrado. Para voltar existe `reverter_situacao`,
    -- que é do controlador e pede motivo (030).
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
                             observacao, lat, lng)
  values (p_visita, 'SITUACAO',
          jsonb_build_object('situacao', v_atual),
          jsonb_build_object('situacao', p_situacao),
          case when v_campo then 'MOBILE' else 'WEB' end,
          auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico, v_equipe,
          nullif(btrim(coalesce(p_observacao, '')), ''),
          p_lat, p_lng);

  return jsonb_build_object('de', v_atual, 'para', p_situacao);
end;
$fn$;

revoke all on function registrar_etapa(uuid, text, text, numeric, numeric)
  from public, anon;
grant execute on function registrar_etapa(uuid, text, text, numeric, numeric)
  to authenticated;

-- ============================================================
-- I · O que o aplicativo lê de uma vez só
-- ============================================================
-- O celular do técnico abre em 4G de rua. Cada ida ao servidor custa
-- segundo, e a agenda dele precisa de contagem de O.S., de evidência e
-- de equipamento — três embeds que o PostgREST resolveria em três
-- viagens. Uma função devolve o dia inteiro pronto.
create or replace function agenda_do_campo(p_data date default null)
returns table (
  visita_id      uuid,
  contrato       text,
  cliente_nome   text,
  logradouro     text,
  complemento    text,
  bairro         text,
  cep            text,
  telefones      text[],
  lat            numeric,
  lng            numeric,
  janela_inicio  time,
  janela_fim     time,
  situacao       text,
  data_agendada  date,
  servico        text,
  os_total       int,
  os_baixadas    int,
  evidencias     int,
  equipamentos   int
)
language sql stable security definer set search_path to 'public' as $fn$
  select v.id, v.contrato, v.cliente_nome, v.logradouro, v.complemento,
         v.bairro, v.cep, v.telefones, v.lat, v.lng,
         v.janela_inicio, v.janela_fim, v.situacao, v.data_agendada,
         coalesce(ts.nome, ta.nome, 'Visita'),
         (select count(*)::int from ordem_servico o where o.visita_id = v.id),
         (select count(*)::int from ordem_servico o where o.visita_id = v.id
            and o.codigo_baixa_afline_id is not null),
         (select count(*)::int from evidencia e where e.visita_id = v.id),
         (select count(*)::int from equipamento_movimento m where m.visita_id = v.id)
    from visita v
    left join tipo_servico   ts on ts.id = v.tipo_servico_id
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
   where v.excluido_em is null
     and v.data_agendada = coalesce(p_data, hoje_local())
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis())
     and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
     and coalesce(ta.natureza, 'PRODUTIVA') = 'PRODUTIVA'
   order by v.janela_inicio nulls last, v.contrato;
$fn$;

revoke all on function agenda_do_campo(date) from public, anon;
grant execute on function agenda_do_campo(date) to authenticated;

comment on function agenda_do_campo(date) is
  'A agenda do técnico em uma viagem só. Jornada (Na Base, Refeição) não entra: natureza PRODUTIVA apenas — CLAUDE.md.';
