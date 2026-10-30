-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 157c · A tela de permissões diz quais ainda NÃO controlam nada   ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- Medido em 30/10, ao montar a tela da 157a: das 33 permissoes
-- `disponivel`, DOZE nao sao conferidas por funcao nem policy nenhuma
-- do banco, nem pela web:
--   admin.cargos, admin.empresa, configuracoes.ver, configuracoes.cadastrar,
--   configuracoes.excluir, pontuacao.editar, equipes.ver, importacao.ver,
--   importacao.executar, relatorios.ver, servicos.ver,
--   servicos.desatribuir_pontuacao
-- (importar a planilha, por exemplo, e decidido por PAPEL dentro de
-- `importar_toa`, nao por `importacao.executar`).
--
-- Uma caixa que se desmarca e nao muda nada e uma tela mentindo: o ADMIN
-- tira "Importar planilha" de alguem e a pessoa continua importando.
-- Zero e desconhecido nao sao a mesma coisa -- a tela tem de dizer
-- "ainda nao controla nada".
--
-- `em_uso` e calculado NA LEITURA, procurando a chave nas funcoes
-- (`tem_permissao('chave'`) e nas policies -- nunca guardado: no dia em
-- que alguem passar a conferir `importacao.executar`, a etiqueta some
-- sozinha (a armadilha do cache de regra, D-150). A bateria de teste fica
-- de fora da busca: ela cita chaves sem conferir nada.
--
-- Fiacao das doze NAO foi feita aqui: decidir o que cada uma barra (o
-- menu? a RPC? as duas?) e regra de negocio -- pergunta ao Emanuel.
--
-- De passagem: rotulos sem acento ("Gerenciar usuarios") ganham acento.

update permissao set rotulo = v.r from (values
  ('admin.usuarios', 'Gerenciar usuários'),
  ('comissao.editar', 'Editar meta e comissão do técnico'),
  ('pontuacao.editar', 'Editar tabela de pontuação'),
  ('equipes.editar', 'Editar equipe e técnico'),
  ('relatorios.ver', 'Gerar relatórios'),
  ('servicos.desatribuir_pontuacao', 'Desatribuir pontuação')
) v(c, r) where permissao.chave = v.c;

drop function if exists permissoes_do_usuario(uuid, uuid);
create function permissoes_do_usuario(p_usuario uuid, p_perfil uuid default null)
returns table(chave text, modulo text, rotulo text, descricao text, disponivel boolean,
              do_perfil boolean, excecao boolean, efetiva boolean,
              definido_por text, definido_em timestamptz, alvo_admin boolean,
              em_uso boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_perfil uuid; v_admin boolean;
begin
  if not tem_permissao('admin.usuarios') then
    raise exception 'Sem permissao para ver as permissoes de outro login.' using errcode = '42501';
  end if;
  select coalesce(p_perfil, p.perfil_acesso_id) into v_perfil
    from perfil p where p.id = p_usuario and p.empresa_id = minha_empresa();
  if not found then raise exception 'Login nao encontrado.'; end if;
  v_admin := exists (select 1 from usuario_papel where usuario_id = p_usuario and papel = 'ADMIN');

  return query
  with fonte as materialized (
    select pr.prosrc as txt
      from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'public' and pr.proname not like 'testar\_%'
    union all
    select coalesce(po.qual, '') || ' ' || coalesce(po.with_check, '')
      from pg_policies po where po.schemaname in ('public', 'storage')
  )
  select pm.chave, pm.modulo, pm.rotulo, pm.descricao, pm.disponivel,
         exists (select 1 from perfil_acesso_permissao pap
                  where pap.perfil_acesso_id = v_perfil and pap.permissao_chave = pm.chave),
         up.concedida,
         v_admin or coalesce(up.concedida, exists (select 1 from perfil_acesso_permissao pap
                  where pap.perfil_acesso_id = v_perfil and pap.permissao_chave = pm.chave)),
         q.nome, up.definido_em, v_admin,
         exists (select 1 from fonte f
                  where strpos(f.txt, 'tem_permissao(''' || pm.chave || '''') > 0
                     or strpos(f.txt, '''' || pm.chave || '''') > 0
                        and strpos(f.txt, 'tem_permissao') > 0)
    from permissao pm
    left join usuario_permissao up on up.usuario_id = p_usuario and up.permissao_chave = pm.chave
    left join perfil q on q.id = up.definido_por
   order by pm.modulo, pm.ordem;
end $$;
revoke all on function permissoes_do_usuario(uuid, uuid) from public, anon;
grant execute on function permissoes_do_usuario(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
