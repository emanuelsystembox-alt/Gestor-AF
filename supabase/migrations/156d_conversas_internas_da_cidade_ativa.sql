-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 156d · As conversas internas são da cidade ativa                 ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "os chats nao podem se embolar. No chat (...) tem que ser o grupo de
-- >  mensagens daquela cidade"  -- Emanuel, 30/10
--
-- A conversa com tecnico foi para a cidade ativa na 155g. A lista de
-- conversas INTERNAS (gestao com gestao, 133) mostrava conversa com gente
-- de qualquer cidade. Passa a mostrar so quem e da cidade ativa -- a
-- mesma regra de `pessoas_da_gestao`: a cidade do cadastro, as cidades
-- que a pessoa acessa, ou ADMIN (que e de todas). As mensagens nao somem:
-- trocando de cidade no topo, a conversa volta.

create or replace function conversas_internas()
returns table(usuario_id uuid, nome text, grupo text, cargo text, ultima_texto text, ultima_em timestamp with time zone, ultima_minha boolean, nao_lidas bigint)
language sql stable security definer set search_path to 'public' as $function$
  with eu as materialized (
    select (select auth.uid()) as uid, (select minha_empresa()) as emp
  ),
  par as (
    select case when m.de_usuario_id = eu.uid then m.para_usuario_id
                else m.de_usuario_id end as outro,
           m.texto, m.criado_em, m.lida_em,
           m.de_usuario_id = eu.uid as minha
      from mensagem_interna m, eu
     where m.empresa_id = eu.emp
       and eu.uid in (m.de_usuario_id, m.para_usuario_id)
  ),
  ult as (
    select distinct on (outro) outro, texto, criado_em, minha
      from par order by outro, criado_em desc
  )
  select u.outro, coalesce(nullif(p.apelido, ''), p.nome),
         grupo_interno(u.outro), c.nome,
         u.texto, u.criado_em, u.minha,
         (select count(*) from par x
           where x.outro = u.outro and not x.minha and x.lida_em is null)
    from ult u
    join perfil p on p.id = u.outro
    left join cargo c on c.id = p.cargo_id
   where p.base_id in (select bases_visiveis())
      or exists (select 1 from usuario_base ub
                  where ub.usuario_id = p.id and ub.base_id in (select bases_visiveis()))
      or exists (select 1 from usuario_papel up
                  where up.usuario_id = p.id and up.papel = 'ADMIN')
   order by u.criado_em desc;
$function$;
revoke all on function conversas_internas() from public, anon;
grant execute on function conversas_internas() to authenticated;
notify pgrst, 'reload schema';
