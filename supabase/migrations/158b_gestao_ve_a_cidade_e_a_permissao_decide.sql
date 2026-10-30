-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 158b · Toda a gestão vê a cidade; o que faz, a PERMISSÃO decide  ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "o renan nao consegue ver nada da rota sendo que ja dei todas as
-- >  permissoes de servico (...) todos conseguem olhar a rota, porem tem
-- >  as permissoes que precisam funcionar"  -- Emanuel, 30/10
--
-- ┌─ o defeito ────────────────────────────────────────────────────────┐
-- │ O CONTROLADOR so enxergava as equipes da CARTEIRA dele (031). Medido│
-- │ em 30/10: `carteira` tem 0 linhas e nenhuma equipe tem             │
-- │ `controlador_id` -- todo controlador do sistema via ZERO contrato. │
-- │ O Renan (CONTROLADOR, Sao Luis) tinha todas as permissoes de       │
-- │ Servicos marcadas e nenhuma valia: a permissao diz O QUE se faz,   │
-- │ mas o escopo dizia que nao havia ONDE fazer.                       │
-- │ E o mesmo defeito do supervisor na 156a, do outro papel.           │
-- └────────────────────────────────────────────────────────────────────┘
--
-- O modelo daqui em diante:
--   · ONDE: toda a gestao (ADMIN, COP, COORDENADOR, CONTROLADOR,
--     SUPERVISOR) ve a cidade ativa inteira. `ve_cidade_inteira()` =
--     `eh_gestao()`.
--   · O QUE: a permissao. Nos contratos, a trava de papel vira "e da
--     gestao" e quem decide e `tem_permissao(...)`. Um supervisor a quem
--     o ADMIN der "Baixar servico" baixa; um controlador de quem tirar
--     "Transferir equipe" deixa de transferir.
--   · COORDENADOR tem tudo o que o CONTROLADOR tem: `tem_papel('CONTROLADOR')`
--     responde sim para o coordenador. Uma linha, e as ~30 funcoes e as
--     policies que perguntam CONTROLADOR passam a valer para ele -- em
--     vez de reescrever cada uma e esquecer a trigesima primeira.
--
-- O que NAO muda: a escrita direta pela API (policy `visita_gestao`,
-- ALL) continua em `equipes_visiveis()` -- a armadilha da 156a: abrir a
-- visao por ela abriria a escrita. O site nao escreve em `visita` direto
-- (conferido: so le); toda acao passa pelas RPCs, que conferem permissao.
--
-- TRANSFERIR passa a exigir a permissao tambem de COP e controlador
-- (antes: papel OU permissao -- e o "ou" deixava QUALQUER login com a
-- chave transferir, ate tecnico). Quem tem perfil COP ou Controlador ja
-- tem a chave; o perfil Coordenador NAO tem.

-- ---- coordenador = controlador e mais ----
create or replace function tem_papel(p papel_tipo) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuario_papel
    where usuario_id = auth.uid()
      and (papel = p or (p = 'CONTROLADOR' and papel = 'COORDENADOR'))
  );
$$;

-- `eh_gestao` ja era ADMIN/COP/CONTROLADOR/SUPERVISOR; com a linha acima
-- passa a incluir o coordenador sem mudar o texto.
create or replace function ve_cidade_inteira() returns boolean
language sql stable security definer set search_path = public as $$
  select eh_gestao();
$$;

-- ---- as RPCs dos contratos ----
do $$
declare f text; d text; antes text;
begin
  -- 1. a trava de papel vira "e da gestao"; a permissao, que ja estava
  --    logo abaixo, passa a decidir sozinha
  foreach f in array array['excluir_visita','remover_os','reverter_situacao'] loop
    d := pg_get_functiondef(f::regproc); antes := d;
    d := replace(d, 'if not (eh_gestor() or tem_papel(''CONTROLADOR'')) then',
                    'if not eh_gestao() then');
    if d = antes then raise exception '158b: trava de papel nao achada em %', f; end if;
    execute d;
  end loop;

  -- 2. transferir: gestao E permissao (era papel OU permissao)
  d := pg_get_functiondef('transferir_visita'::regproc); antes := d;
  d := replace(d, 'if not (eh_gestor() or tem_papel(''CONTROLADOR'') or tem_permissao(''servicos.transferir'')) then',
                  'if not (eh_gestao() and tem_permissao(''servicos.transferir'')) then');
  if d = antes then raise exception '158b: trava de transferir_visita nao achada'; end if;
  execute d;

  -- 3. observacao do COP: gestao E "Editar contrato"; e o escopo da cidade
  d := pg_get_functiondef('definir_observacao_cop'::regproc); antes := d;
  d := replace(d, 'if not (eh_gestor() or tem_papel(''CONTROLADOR'') or tem_permissao(''servicos.editar'')) then',
                  'if not (eh_gestao() and tem_permissao(''servicos.editar'')) then');
  d := replace(d, 'select equipes_visiveis()', 'select equipes_legiveis()');
  if d = antes or d ~ 'equipes_visiveis' then raise exception '158b: definir_observacao_cop nao trocou'; end if;
  execute d;

  -- 4. o escopo de baixar, anexar e registrar etapa: a gestao age na
  --    cidade (`equipes_legiveis`); o tecnico continua so na equipe dele
  --    (para quem nao e da gestao, `equipes_legiveis` = `equipes_visiveis`)
  foreach f in array array['baixar_os','pode_anexar_na_visita','registrar_etapa'] loop
    d := pg_get_functiondef(f::regproc); antes := d;
    d := replace(d, 'select equipes_visiveis()', 'select equipes_legiveis()');
    if d = antes then raise exception '158b: escopo nao achado em %', f; end if;
    execute d;
  end loop;
end $$;

notify pgrst, 'reload schema';
