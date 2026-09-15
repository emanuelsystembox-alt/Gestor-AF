-- ============================================================
-- 073 · O de/para do grupo de serviço sai do código e vira cadastro
--
-- > "tem serviços que ainda não ganha categoria, por exemplo: ctt
-- >  1143258, ele não sabe qual grupo de serviço ou tipo de serviço ele
-- >  é, ele é uma desconexão […] eu preciso que no menu configurações
-- >  habilite uma função para 'Tipo de Serviço', dá acesso ao usuário
-- >  para editar e escolher o tipo de serviço para determinado tipo de
-- >  o.s." — Emanuel, 14/09
--
-- ┌─ o que está acontecendo ─────────────────────────────────────────┐
-- │ O grupo da VISITA é derivado das O.S. dela: `grupo_da_visita()`   │
-- │ pega o `tipo_servico` de maior prioridade entre os `tipo_os` da   │
-- │ visita (014). Se o tipo de O.S. não tem grupo, a visita fica sem  │
-- │ grupo — e a coluna mostra "—", que é o certo: ela não sabe.       │
-- │                                                                   │
-- │ Os três tipos sem grupo HOJE são exatamente os três que a 070     │
-- │ aprendeu da planilha de Araguaína, e que por isso nunca passaram  │
-- │ pelo cruzamento de 04/09 que produziu o de/para:                  │
-- │                                                                   │
-- │    32  DESCONEXAO I C/ RETIRADA DE EQUIPAMENTO      7 O.S.        │
-- │    79  DESCONEXAO OPCAO C/ RETIRADA DE EQUIPAMENTO  3 O.S.        │
-- │    87  RETIRAR EMTA                                 3 O.S.        │
-- │                                                                   │
-- │ O ctt 1143258 é uma O.S. 32. O catálogo vai continuar aprendendo  │
-- │ tipo novo a cada planilha nova (070), então isto não é um buraco  │
-- │ de três linhas: é um buraco que se reabre. Cadastro, não UPDATE.  │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ por que RPC e não escrita direta na tabela ─────────────────────┐
-- │ `tipo_os_admin` exige `empresa_id = minha_empresa()`, e 37 dos 40 │
-- │ tipos são do catálogo SEED, com `empresa_id` nulo. Escrita direta │
-- │ por RLS acertaria só os 3 que a 070 criou e falharia calada nos   │
-- │ outros 37. A RPC é `security definer` e confere o papel DENTRO,   │
-- │ como `definir_situacao_do_codigo` (046-C) — mesmo par de guardas: │
-- │ `eh_gestor()` e a permissão fina `configuracoes.editar`.          │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ o que esta migration NÃO faz, e é decisão do Emanuel ───────────┐
-- │ Perguntado se o de/para novo deveria recalcular os contratos já   │
-- │ importados, ele escolheu **"só daqui pra frente"**. Então nada de │
-- │ `update visita … grupo_da_visita()` aqui, e o gatilho da 014      │
-- │ continua pendurado só em `ordem_servico` — mexer em `tipo_os` não │
-- │ dispara nada.                                                     │
-- │                                                                   │
-- │ CONSEQUÊNCIA, escrita para ninguém se assustar: o ctt 1143258 de  │
-- │ 14/09 continua com "—" na coluna GRUPO depois de você declarar o  │
-- │ grupo do tipo 32. Ele passa a mostrar DESCONEXAO quando a         │
-- │ planilha daquele dia for importada de novo — aí o gatilho da 014  │
-- │ roda no `ordem_servico` e o grupo da visita se refaz.             │
-- └───────────────────────────────────────────────────────────────────┘
--
-- A tabela passa a dizer DE ONDE veio cada mapeamento, pela mesma razão
-- que `codigo_baixa` diz (D-097): quem digitou vale mais do que o que eu
-- deduzi, e sem autor não é cadastro (D-079).
-- ============================================================

-- ------------------------------------------------------------
-- A · A procedência do mapeamento
-- ------------------------------------------------------------
alter table tipo_os
  add column if not exists grupo_origem text,
  add column if not exists grupo_por uuid references perfil(id),
  add column if not exists grupo_em timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tipo_os_grupo_origem_ck') then
    alter table tipo_os add constraint tipo_os_grupo_origem_ck
      check (grupo_origem is null or grupo_origem in ('CRUZAMENTO', 'CADASTRO'));
  end if;
end $$;

comment on column tipo_os.grupo_origem is
  'CRUZAMENTO = derivado do cruzamento TOA x ngestor de 04/09/2026 (014). '
  'CADASTRO = alguem declarou na tela de Configuracoes (073). Nulo = sem grupo.';

-- O que já estava mapeado veio do cruzamento, não de gente.
update tipo_os
   set grupo_origem = 'CRUZAMENTO'
 where tipo_servico_id is not null and grupo_origem is null;

-- ------------------------------------------------------------
-- B · Declarar o grupo de um tipo de O.S.
-- ------------------------------------------------------------
-- Recebe o NOME do grupo, não o uuid: a tela manda o que a pessoa leu.
-- Nulo limpa o mapeamento e o tipo volta a dizer que não sabe.
create or replace function definir_grupo_do_tipo_os(
  p_codigo integer, p_tipo_servico text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_desc text; v_antes text; v_id uuid; v_novo_id uuid;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  if not tem_permissao('configuracoes.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar" em configuracoes.'
      using errcode = '42501';
  end if;

  if p_tipo_servico is not null and btrim(p_tipo_servico) <> '' then
    select s.id into v_novo_id from tipo_servico s
     where s.nome = p_tipo_servico
       and (s.empresa_id is null or s.empresa_id = minha_empresa());
    if v_novo_id is null then
      raise exception 'Grupo de servico "%" nao existe.', p_tipo_servico
        using errcode = '23514';
    end if;
  end if;

  select t.id, t.descricao, s.nome into v_id, v_desc, v_antes
    from tipo_os t
    left join tipo_servico s on s.id = t.tipo_servico_id
   where t.codigo = p_codigo
     and (t.empresa_id is null or t.empresa_id = minha_empresa());
  if v_id is null then
    raise exception 'Tipo de O.S. % nao encontrado.', p_codigo using errcode = 'P0002';
  end if;

  update tipo_os
     set tipo_servico_id = v_novo_id,
         grupo_origem    = case when v_novo_id is null then null else 'CADASTRO' end,
         grupo_por       = case when v_novo_id is null then null else auth.uid() end,
         grupo_em        = case when v_novo_id is null then null else now() end
   where id = v_id;

  -- Nada de recalcular visita: "so daqui pra frente" (ver cabecalho).
  return jsonb_build_object('codigo', p_codigo, 'descricao', v_desc,
                            'de', v_antes, 'para', p_tipo_servico);
end;
$fn$;

revoke all on function definir_grupo_do_tipo_os(integer, text) from public, anon;
grant execute on function definir_grupo_do_tipo_os(integer, text) to authenticated;

-- ------------------------------------------------------------
-- C · O catálogo, como a tela precisa ler
-- ------------------------------------------------------------
-- INVOKER de proposito: `qtd_os` tem de contar o que QUEM PERGUNTA
-- enxerga. Como `security definer` o numero seria o da empresa inteira,
-- e a tela mentiria para o supervisor de uma base so.
create or replace function catalogo_tipo_os()
returns table (codigo integer, descricao text, grupo text,
               grupo_origem text, grupo_em timestamptz,
               depende_de_contexto boolean, qtd_os bigint)
language sql stable set search_path to 'public' as $fn$
  with usos as materialized (
    select o.tipo_os_id, count(*) as n
      from ordem_servico o
     where o.tipo_os_id is not null
     group by o.tipo_os_id
  )
  select t.codigo, t.descricao, s.nome, t.grupo_origem, t.grupo_em,
         t.depende_de_contexto, coalesce(u.n, 0)
    from tipo_os t
    left join tipo_servico s on s.id = t.tipo_servico_id
    left join usos u on u.tipo_os_id = t.id
   where t.ativo
     and (t.empresa_id is null or t.empresa_id = (select minha_empresa()))
   order by (s.nome is not null), coalesce(u.n, 0) desc, t.codigo;
$fn$;

revoke all on function catalogo_tipo_os() from public, anon;
grant execute on function catalogo_tipo_os() to authenticated;

notify pgrst, 'reload schema';
