-- 156h: quem esta no grupo, com nome. `perfil` nao mostra outras pessoas
-- a quem nao e gestor (supervisor e tecnico veem so o proprio perfil), e
-- membro de grupo precisa saber com quem esta falando. So membro le.
create or replace function membros_do_grupo(p_grupo uuid)
returns table(usuario_id uuid, nome text, tipo text, equipe text, adicionado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.apelido, ''), p.nome),
         case when t.id is not null then 'TECNICO' else 'GESTAO' end,
         e.codigo, m.adicionado_em
    from grupo_membro m
    join perfil p on p.id = m.usuario_id
    left join tecnico t on t.usuario_id = p.id and t.situacao = 'ATIVO'
    left join equipe e on e.id = t.equipe_id
   where m.grupo_id = p_grupo
     and p_grupo in (select meus_grupos())
   order by 3, 2;
$$;
revoke all on function membros_do_grupo(uuid) from public, anon;
grant execute on function membros_do_grupo(uuid) to authenticated;
notify pgrst, 'reload schema';
