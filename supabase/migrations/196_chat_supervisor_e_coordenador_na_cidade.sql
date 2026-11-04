-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 196 — Supervisor e coordenador conversam com qualquer técnico da      │
-- │       cidade                                                         │
-- │                                                                      │
-- │ "supervisor deve ter acesso ao chat para falar com quem ele quiser do│
-- │  time, ele não fica limitado somente o time dele ok, a mesma coisa   │
-- │  para o coordenador também" — Emanuel, 03/11.                        │
-- │                                                                      │
-- │ O chat (conversa por técnico, D-167) usava a CARTEIRA                │
-- │ (`equipes_visiveis`). `equipes_do_chat()` = a carteira de sempre +   │
-- │ todas as equipes da cidade ativa para quem tem o papel SUPERVISOR ou │
-- │ COORDENADOR. Controlador continua na carteira — o pedido foi dos     │
-- │ dois. Vale para listar, ler, enviar e marcar como lida, e para ler a │
-- │ conversa entre técnicos (mensagem_colega).                           │
-- │                                                                      │
-- │ Função de leitura própria, e não alargar `equipes_visiveis`: ela     │
-- │ decide policies de escrita (traps.md, policy ALL, D-236).            │
-- │ Corpos das três funções copiados dos VIVOS.                          │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.equipes_do_chat()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select equipes_visiveis()
  union
  select e.id from equipe e
   where e.empresa_id = (select minha_empresa())
     and e.base_id in (select bases_visiveis())
     and (tem_papel('SUPERVISOR') or tem_papel('COORDENADOR'));
$function$;
revoke all on function public.equipes_do_chat() from public, anon;
grant execute on function public.equipes_do_chat() to authenticated;

CREATE OR REPLACE FUNCTION public.conversas_do_controle()
 RETURNS TABLE(tecnico_id uuid, nome text, equipe text, tem_app boolean, ultima_texto text, ultima_em timestamp with time zone, ultima_do_campo boolean, nao_lidas bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not eh_gestao() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  return query
    with visiveis as materialized (
      select t.id from tecnico t
       where t.empresa_id = minha_empresa()
         -- 155g: a cidade ATIVA, antes do atalho do gestor (traps.md).
         and t.base_id in (select bases_visiveis())
         and ((select eh_gestor()) or t.equipe_id in (select equipes_do_chat()))
    ),
    ult as (
      select distinct on (m.tecnico_id) m.tecnico_id, m.texto, m.criado_em, m.do_campo
        from mensagem m where m.tecnico_id in (select id from visiveis)
       order by m.tecnico_id, m.criado_em desc
    )
    select t.id, t.nome, e.codigo, t.usuario_id is not null,
           u.texto, u.criado_em, u.do_campo,
           (select count(*) from mensagem m
             where m.tecnico_id = t.id and m.do_campo and m.lida_em is null)
      from ult u
      join tecnico t on t.id = u.tecnico_id
      left join equipe e on e.id = t.equipe_id
     order by u.criado_em desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enviar_mensagem(p_tecnico_id uuid, p_texto text, p_para uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and ((select eh_gestor()) or t.equipe_id in (select equipes_do_chat()));
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

CREATE OR REPLACE FUNCTION public.marcar_conversa_lida(p_tecnico_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tec uuid; v_do_campo boolean; n int;
begin
  if p_tecnico_id is null then
    v_tec := meu_tecnico_id(); v_do_campo := false;
    if v_tec is null then
      raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
    end if;
  else
    if not eh_gestao() then
      raise exception 'Sem permissao.' using errcode = '42501';
    end if;
    select t.id into v_tec from tecnico t
     where t.id = p_tecnico_id and t.empresa_id = minha_empresa()
       and ((select eh_gestor()) or t.equipe_id in (select equipes_do_chat()));
    if v_tec is null then
      raise exception 'Tecnico fora do seu escopo.' using errcode = '42501';
    end if;
    v_do_campo := true;
  end if;
  update mensagem set lida_em = now()
   where tecnico_id = v_tec and do_campo = v_do_campo and lida_em is null;
  get diagnostics n = row_count;
  return n;
end;
$function$;

drop policy if exists mensagem_leitura on public.mensagem;
create policy mensagem_leitura on public.mensagem for select to authenticated
  using ((empresa_id = (select minha_empresa()))
         and ((tecnico_id = (select meu_tecnico_id()))
              or ((select eh_gestao())
                  and ((select eh_gestor())
                       or tecnico_id in (select t.id from tecnico t
                                          where t.equipe_id in (select equipes_do_chat()))))));

drop policy if exists mensagem_colega_leitura on public.mensagem_colega;
create policy mensagem_colega_leitura on public.mensagem_colega for select to authenticated
  using ((empresa_id = (select minha_empresa()))
         and ((de_tecnico_id = (select meu_tecnico_id()))
              or (para_tecnico_id = (select meu_tecnico_id()))
              or ((select eh_gestao())
                  and ((select eh_gestor())
                       or exists (select 1 from tecnico t
                                   where t.id = any (array[mensagem_colega.de_tecnico_id, mensagem_colega.para_tecnico_id])
                                     and t.equipe_id in (select equipes_do_chat()))))));

notify pgrst, 'reload schema';
