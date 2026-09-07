-- 038 · A regra do dinheiro
--
--     A receber = pontuação × fator
--
-- Confirmada pelo Emanuel em 07/09/2026. Fecha a pendência que estava
-- aberta desde a 027 (`pontos_equipe`) e desde a 037.
--
-- O fator sai da faixa em que a pontuação do mês caiu. Abaixo da
-- primeira faixa não há fator, e sem fator não há valor — é o que a tela
-- do sistema atual mostra como R$ 0,00.
--
-- Fica no BANCO, e não na tela, porque dinheiro tem de ter uma fórmula
-- só: relatório, tela e futura folha precisam concordar sem ninguém
-- reimplementar a multiplicação.
--
-- Conferido:  120 pts × 2,0 = R$ 240,00 · 150 × 4,0 = R$ 600,00
--             300 × 12  = R$ 3.600,00

-- ┌─ BURACO ENTRE AS FAIXAS ─────────────────────────────────────────┐
-- │ A tabela dele é escrita em inteiros: 190→199, depois 200→219.     │
-- │ Entre 199,00 e 200,00 não há faixa. A nossa pontuação NÃO é       │
-- │ inteira (1,4648 · 2,1560 · 20,3331), então esse intervalo é       │
-- │ alcançável de verdade:                                            │
-- │                                                                   │
-- │   199,00 pts → fator 5,8 → R$ 1.154,20                            │
-- │   199,50 pts → SEM FATOR → R$ 0,00     ← o técnico perde tudo     │
-- │   200,00 pts → fator 7,0 → R$ 1.400,00                            │
-- │                                                                   │
-- │ Um centésimo de ponto a mais zerando a comissão não é regra de    │
-- │ negócio: é defeito de arredondamento na tabela.                   │
-- └───────────────────────────────────────────────────────────────────┘
--
-- A busca passa a ser por PISO: vale a maior faixa cujo início já foi
-- alcançado. Não há buraco, e quem passa do teto (400) continua no fator
-- do teto em vez de perder tudo.
--
-- ⚠ Isto muda o comportamento em relação à tabela literal do sistema
--   atual. Se a AFLINE quiser faixa estrita mesmo, com buraco, é trocar
--   `>= pontos_de` por `between pontos_de and pontos_ate` aqui e em
--   `Produtividade.tsx` (`fatorDe`). Emanuel decide.

create or replace function fator_da_pontuacao(p_skill text, p_pontos numeric)
returns numeric language sql stable set search_path to 'public' as $fn$
  select f.fator
    from faixa_comissao f
   where f.ativo
     and f.skill = coalesce(p_skill, 'SINGLE MASTER')
     and coalesce(p_pontos, 0) >= f.pontos_de
   order by f.pontos_de desc
   limit 1;
$fn$;

revoke all on function fator_da_pontuacao(text, numeric) from public, anon;
grant execute on function fator_da_pontuacao(text, numeric) to authenticated;

-- `produtividade_periodo` ganhou a coluna `valor`. Coluna nova exige
-- derrubar a função antes: `create or replace` não muda o tipo de
-- retorno. O corpo vigente está aplicado no banco (038/038b) — ver
-- `pg_get_functiondef`. A linha que importa:
--
--   case when v_fator is null then null
--        else round(coalesce(pontos, 0) * v_fator, 2) end as valor
--
-- NULL, e não zero: zero diz "calculei e deu nada"; nulo diz "não há
-- faixa alcançada".
