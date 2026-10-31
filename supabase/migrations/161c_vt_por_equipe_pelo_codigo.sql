-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 161c · VT por equipe: a régua passa a ser o CÓDIGO de baixa      ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- A 156f media pelo "Status da Atividade" do TOA (CONCLUIDO x NAO
-- CONCLUIDO) e dava ~100% para quase todos: no TOA "concluido" inclui a VT
-- fechada com codigo improdutivo (529 x 7 em 14 dias). Separar quem
-- RESOLVEU de quem so fechou pede o codigo -- Emanuel aprovou a troca
-- (31/10).
--
-- Por contrato (codigo da OPERADORA, o mesmo da `producao_por_tecnico`):
--   executado     = tem O.S. com codigo SUCESSO e nenhuma IMPRODUTIVA;
--   nao executado = tem O.S. com codigo IMPRODUTIVA (o "quebrado", D-167);
--   fora da conta = cancelado, reagendado ou sem codigo ainda.
-- Mesma assinatura e mesmas colunas: a tela nao muda de forma, so de regua.

do $$
declare d text; antes text;
begin
  d := pg_get_functiondef('vt_por_equipe(date, date, text, text[])'::regprocedure); antes := d;
  d := replace(d,
    $a$           norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) as st$a$,
    $b$           -- 161c: a regua e o codigo de baixa da operadora, nao o status do TOA.
           case
             when exists (select 1 from ordem_servico o join codigo_baixa c on c.id = o.codigo_baixa_id
                           where o.visita_id = v.id and c.natureza = 'IMPRODUTIVA') then 'NAO CONCLUIDO'
             when exists (select 1 from ordem_servico o join codigo_baixa c on c.id = o.codigo_baixa_id
                           where o.visita_id = v.id and c.natureza = 'SUCESSO') then 'CONCLUIDO'
             else 'FORA'
           end as st$b$);
  if d = antes then raise exception '161c: troca nao pegou'; end if;
  execute d;
end $$;
