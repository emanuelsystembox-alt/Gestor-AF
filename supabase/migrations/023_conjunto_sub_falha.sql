-- 023 · Qual conjunto de sub-falhas vale, e como a tela pergunta isso ao banco
--
-- O arquivo CONSOLIDADO_SUBFALHAS_CLARO_2026.xlsx traz DOIS conjuntos
-- (`CASO 1` e `NÍVEL HARD`). Guardamos os dois (D-027) e `empresa`
-- aponta qual vale. Faltavam duas coisas para a tela existir:
--
--   1. `empresa` só tem policy de SELECT. Ninguém consegue gravar
--      `conjunto_sub_falha` pelo PostgREST — de propósito: empresa não é
--      cadastro que o operador edite. Então a escolha vira RPC com papel.
--   2. A tela precisa contar o que já entrou, por conjunto, sem baixar
--      1.400 linhas só para somar.

-- ---------- escolher o conjunto vigente ----------
create or replace function definir_conjunto_sub_falha(p_conjunto text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_emp uuid; v_qtd int;
begin
  if not tem_papel('ADMIN') then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;

  v_emp := minha_empresa();
  if v_emp is null then
    raise exception 'Usuario sem empresa.' using errcode = '42501';
  end if;

  -- null limpa a escolha; qualquer outro valor precisa existir de fato.
  if p_conjunto is not null then
    select count(*) into v_qtd from sub_falha
     where conjunto = p_conjunto and (empresa_id is null or empresa_id = v_emp);
    if v_qtd = 0 then
      raise exception 'Conjunto "%" nao tem nenhuma sub-falha importada.', p_conjunto
        using errcode = '23514';
    end if;
  end if;

  update empresa set conjunto_sub_falha = p_conjunto where id = v_emp;

  return jsonb_build_object('conjunto', p_conjunto, 'sub_falhas', coalesce(v_qtd, 0));
end;
$fn$;

-- ---------- o que já entrou, por conjunto ----------
-- Sem SECURITY DEFINER: roda como o chamador, então o RLS de sub_falha
-- continua valendo. É consulta, não privilégio.
create or replace function resumo_sub_falhas()
returns table (
  conjunto            text,
  sub_falhas          bigint,
  codigos_de_baixa    bigint,
  categorias          bigint,
  sem_codigo_de_baixa bigint
) language sql stable set search_path = public as $fn$
  -- Colunas qualificadas por sf: os nomes de RETURNS TABLE entram no
  -- escopo e colidiriam com as colunas da tabela.
  select sf.conjunto,
         count(*),
         count(distinct sf.codigo),
         count(distinct sf.categoria),
         count(*) filter (where sf.codigo_baixa_id is null)
    from sub_falha sf
   group by sf.conjunto
   order by sf.conjunto;
$fn$;

-- ---------- fechar o que o Supabase abre sozinho ----------
-- Toda funcao criada em `public` nasce com EXECUTE concedido NOMINALMENTE
-- a `anon`. `revoke from public` nao tira isso. Ver CLAUDE.md.
revoke all on function definir_conjunto_sub_falha(text) from public, anon;
revoke all on function resumo_sub_falhas()             from public, anon;
grant execute on function definir_conjunto_sub_falha(text) to authenticated;
grant execute on function resumo_sub_falhas()             to authenticated;
