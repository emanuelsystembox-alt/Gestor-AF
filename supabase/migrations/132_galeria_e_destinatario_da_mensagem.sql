-- ┌─ 132 · foto/vídeo da galeria e a mensagem com destinatário ─────────┐
-- │ > "as fotos e vídeos precisam da opção pra ele enviar da galeria   │
-- │ >  também (...) lembrando que o nosso app tem que ser contra a     │
-- │ >  fraude" · "o técnico poderá escolher para qual usuário mandar   │
-- │ >  mensagem, se é para técnico (...) ou COP, supervisor e          │
-- │ >  coordenador (...) direcionar a demanda" — Emanuel, 25/10        │
-- │                                                                    │
-- │ GALERIA. A câmera do app garante hora e GPS do momento; a galeria  │
-- │ não. Então a evidência que veio da galeria FICA MARCADA            │
-- │ (`da_galeria`), com a hora e o GPS do PRÓPRIO ARQUIVO (EXIF) quando │
-- │ ele traz — e nulos quando não traz: "sem GPS" é melhor que o GPS do │
-- │ celular agora, que mentiria o lugar da foto. Quem audita vê a      │
-- │ marca. Nenhuma regra de bloqueio foi inventada (pergunta aberta).  │
-- │                                                                    │
-- │ DESTINATÁRIO. A conversa continua UMA POR TÉCNICO (091): é a caixa │
-- │ que o controle já usa no site. Cada mensagem do campo passa a      │
-- │ levar PARA QUEM foi (`para_usuario_id`): nulo = o controle todo,   │
-- │ como sempre; ou uma pessoa de COP, supervisão ou coordenação, que  │
-- │ vê o destaque "para você" no site. Técnico com técnico é a conversa│
-- │ entre colegas da 130.                                              │
-- │ Grupo pela pessoa: cargo CONTROLADOR (COP) ou perfil COP/Controla- │
-- │ dor → COP; cargo SUPERVISOR ou perfil Supervisor → SUPERVISOR;      │
-- │ cargo COORDENADOR → COORDENADOR. Só quem acessa a cidade do técnico.│
-- │ Medido em 25/10: 2 coordenadores; nenhum COP nem supervisor ainda. │
-- │                                                                    │
-- │ As duas RPCs ganham parâmetro com default: a versão antiga SAI      │
-- │ (traps.md: as duas juntas deixam a chamada ambígua no PostgREST) e  │
-- │ a nova nasce com a ACL aberta — revoke/grant.                      │
-- └────────────────────────────────────────────────────────────────────┘

alter table evidencia add column if not exists da_galeria boolean not null default false;
comment on column evidencia.da_galeria is
  'A foto/vídeo veio da galeria do celular, não da câmera do app (132): hora e GPS são os do arquivo, quando ele traz.';

alter table mensagem add column if not exists para_usuario_id uuid references perfil(id);
comment on column mensagem.para_usuario_id is
  'Para quem o técnico mandou (132). Nulo = o controle todo.';
create index if not exists mensagem_para_ix on mensagem (para_usuario_id) where para_usuario_id is not null;

-- ── registrar_evidencia + p_galeria ──────────────────────────────────
drop function if exists public.registrar_evidencia(uuid, text, text, text, uuid, text, bigint,
  numeric, numeric, numeric, timestamptz, integer, text);

create function public.registrar_evidencia(
  p_visita uuid, p_arquivo_path text, p_tipo text default 'LIVRE', p_midia text default 'FOTO',
  p_os uuid default null, p_mime text default null, p_bytes bigint default null,
  p_lat numeric default null, p_lng numeric default null, p_precisao_m numeric default null,
  p_capturada_em timestamptz default null, p_duracao_seg integer default null,
  p_observacao text default null, p_galeria boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tecnico uuid; v_login text; v_id uuid; v_origem text;
begin
  perform pode_anexar_na_visita(p_visita);

  if coalesce(btrim(p_arquivo_path), '') = '' then
    raise exception 'Caminho do arquivo vazio.' using errcode = '23514';
  end if;
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
                         observacao, da_galeria)
  values (p_visita, p_os, upper(btrim(p_tipo)), p_arquivo_path, p_midia, p_mime,
          p_bytes, p_duracao_seg, p_lat, p_lng, p_precisao_m,
          -- 132: da galeria, a hora é a do arquivo; sem ela, fica nula (não "agora")
          case when coalesce(p_galeria, false) then p_capturada_em
               else coalesce(p_capturada_em, now()) end,
          v_tecnico, auth.uid(), v_login, v_origem,
          nullif(btrim(coalesce(p_observacao,'')),''), coalesce(p_galeria, false))
  returning id into v_id;

  insert into visita_evento (visita_id, os_id, tipo, para, origem, usuario_id,
                             login, tecnico_id, lat, lng, observacao)
  values (p_visita, p_os, 'EVIDENCIA',
          jsonb_build_object('evidencia_id', v_id, 'midia', p_midia,
                             'tipo', upper(btrim(p_tipo)), 'galeria', coalesce(p_galeria, false)),
          v_origem, auth.uid(), v_login, v_tecnico, p_lat, p_lng,
          nullif(btrim(coalesce(p_observacao,'')),''));

  return v_id;
end;
$function$;

revoke all on function public.registrar_evidencia(uuid, text, text, text, uuid, text, bigint,
  numeric, numeric, numeric, timestamptz, integer, text, boolean) from public, anon;
grant execute on function public.registrar_evidencia(uuid, text, text, text, uuid, text, bigint,
  numeric, numeric, numeric, timestamptz, integer, text, boolean) to authenticated, service_role;

-- ── para quem o técnico pode mandar ──────────────────────────────────
create or replace function public.destinatarios_do_campo()
returns table(usuario_id uuid, nome text, grupo text, cargo text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with eu as materialized (
    select t.base_id, t.empresa_id from tecnico t where t.id = meu_tecnico_id()
  ),
  gente as (
    select p.id, coalesce(nullif(p.apelido, ''), p.nome) as nome, c.nome as cargo,
           case
             when upper(coalesce(c.nome, '')) like 'COORDENADOR%' then 'COORDENADOR'
             when upper(coalesce(c.nome, '')) like 'SUPERVISOR%'
               or pa.nome = 'Supervisor' then 'SUPERVISOR'
             when upper(coalesce(c.nome, '')) like '%COP%'
               or pa.nome in ('COP', 'Controlador') then 'COP'
           end as grupo
      from perfil p
      cross join eu
      left join cargo c on c.id = p.cargo_id
      left join perfil_acesso pa on pa.id = p.perfil_acesso_id
     where p.ativo and p.empresa_id = eu.empresa_id
       and p.id <> auth.uid()
       and (p.base_id = eu.base_id
            or exists (select 1 from usuario_base ub where ub.usuario_id = p.id and ub.base_id = eu.base_id)
            or exists (select 1 from usuario_papel up where up.usuario_id = p.id and up.papel = 'ADMIN'))
  )
  select g.id, g.nome, g.grupo, g.cargo from gente g
   where g.grupo is not null
   order by g.grupo, g.nome;
$function$;

revoke all on function public.destinatarios_do_campo() from public, anon;
grant execute on function public.destinatarios_do_campo() to authenticated, service_role;

-- ── os colegas da cidade (para escolher com quem falar) ──────────────
create or replace function public.tecnicos_da_cidade()
returns table(tecnico_id uuid, nome text, equipe text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select t.id, t.nome, e.codigo
    from tecnico t
    left join equipe e on e.id = t.equipe_id
   where t.empresa_id = minha_empresa()
     and t.base_id in (select bases_visiveis())
     and coalesce(t.situacao, 'ATIVO') = 'ATIVO'
     and t.usuario_id is not null              -- sem login no app, não lê
     and t.id is distinct from meu_tecnico_id()
   order by t.nome;
$function$;

revoke all on function public.tecnicos_da_cidade() from public, anon;
grant execute on function public.tecnicos_da_cidade() to authenticated, service_role;

-- ── enviar_mensagem + p_para ─────────────────────────────────────────
drop function if exists public.enviar_mensagem(uuid, text);

create function public.enviar_mensagem(p_tecnico_id uuid, p_texto text, p_para uuid default null)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tec uuid; v_campo boolean; v_id bigint; v_emp uuid;
begin
  if nullif(btrim(coalesce(p_texto, '')), '') is null then
    raise exception 'Mensagem vazia.' using errcode = '23514';
  end if;
  if length(btrim(p_texto)) > 2000 then
    raise exception 'Mensagem longa demais (maximo 2000 caracteres).' using errcode = '23514';
  end if;

  if p_tecnico_id is null then
    v_tec := meu_tecnico_id(); v_campo := true;
    if v_tec is null then
      raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
    end if;
    -- 132: o destinatário tem de ser alguém que o campo pode escolher.
    if p_para is not null and not exists (
         select 1 from destinatarios_do_campo() d where d.usuario_id = p_para) then
      raise exception 'Este destinatario nao esta disponivel para voce.' using errcode = '42501';
    end if;
  else
    if not eh_gestao() then
      raise exception 'So a gestao escreve para um tecnico.' using errcode = '42501';
    end if;
    select t.id into v_tec from tecnico t
     where t.id = p_tecnico_id and t.empresa_id = minha_empresa()
       and (eh_gestor() or t.equipe_id in (select equipes_visiveis()));
    if v_tec is null then
      raise exception 'Tecnico fora do seu escopo.' using errcode = '42501';
    end if;
    v_campo := false;
  end if;

  select empresa_id into v_emp from tecnico where id = v_tec;
  insert into mensagem (empresa_id, tecnico_id, do_campo, autor_id, autor_nome, texto, para_usuario_id)
  values (v_emp, v_tec, v_campo, auth.uid(),
          (select coalesce(nullif(apelido, ''), nome) from perfil where id = auth.uid()),
          btrim(p_texto), case when v_campo then p_para end)
  returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.enviar_mensagem(uuid, text, uuid) from public, anon;
grant execute on function public.enviar_mensagem(uuid, text, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
