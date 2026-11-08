-- 232 · Quais O.S. do portal da Claro já têm os níveis gravados num dia (D-342)
--
-- > "so não quero deixar nenhum contrato descoberto" — Emanuel, 08/11
--
-- A extensão 0.10 lê o detalhe dos níveis devagar (um por vez, no máximo 30
-- por rodada) para não acordar o firewall da Claro. Para nenhum contrato ficar
-- sem nível, a conta do "falta ler" não pode depender só da memória do
-- navegador (que se perde ao trocar de versão, de máquina ou ao limpar dados):
-- ela pergunta ao BANCO quais O.S. do dia já têm `equipamentos` gravado. O que
-- tem contrato e não tem nível entra na fila — hoje e na revisão de ontem.
--
-- Por que função e não SELECT direto: a policy de `sinal_claro` segue
-- `visita`, que segue a cidade ATIVA do topo (`bases_visiveis`). A extensão
-- trabalha nas cidades que a pessoa ACESSA (`bases_permitidas`), como a
-- `registrar_sinal_claro` — e com a mesma trava de quem pode rodar a extensão.
-- Devolve só números do portal: nada de assinante.

create or replace function public.sinal_claro_ja_lidos(p_dia date)
returns setof bigint
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- quem pode rodar a extensão (o mesmo de registrar_sinal_claro)
  if not ((eh_gestao() or tem_papel('ROBO')) and tem_permissao('importacao.executar')) then
    raise exception 'Sem permissao para ler o sinal do portal.' using errcode = '42501';
  end if;
  if p_dia is null then
    raise exception 'Dia obrigatorio.' using errcode = '22023';
  end if;
  return query
    select s.portal_id
      from sinal_claro s
     where s.dia = p_dia
       and s.equipamentos is not null
       and s.portal_id is not null
       and s.empresa_id = (select minha_empresa())
       and s.base_id in (select bases_permitidas());
end;
$$;

revoke all on function public.sinal_claro_ja_lidos(date) from public, anon;
grant execute on function public.sinal_claro_ja_lidos(date) to authenticated;

comment on function public.sinal_claro_ja_lidos(date) is
  'Ids do portal da Claro com os níveis já gravados no dia (cidades que a pessoa acessa). A extensão usa para não deixar contrato sem nível (D-342).';

notify pgrst, 'reload schema';
