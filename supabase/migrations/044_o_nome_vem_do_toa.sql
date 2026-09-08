-- 044 · O nome do técnico vem do TOA, não do palpite
--
-- ┌─ O QUE O EMANUEL PERGUNTOU ──────────────────────────────────────┐
-- │ "Vi que meu sistema está importando informações a mais e a menos. │
-- │  Os dois são aceitos? Um tem o nome do login, o outro não tem.    │
-- │  E se não aparecer o login, como vai ser cadastrado?"             │
-- └───────────────────────────────────────────────────────────────────┘
--
-- Conferido nos dois arquivos de 07/09 (66 linhas cada, mesmas 120
-- colunas, mesma ordem):
--
--   Atividades…(5).xlsx → 120 colunas
--   Atividades…(4).xlsx → 121 colunas — uma a mais: **Recurso**
--
-- **Os dois têm "Login do Técnico".** A coluna que só o (4) traz é
-- `Recurso`, e ela não é o login: é o NOME de quem estava logado
-- ("Z634559" → "FABIO SOUZA DA SILVA"). Os dois são aceitos, e nenhum
-- desloca a leitura — `toa.ts` monta o objeto pela CHAVE depois de
-- desduplicar por posição, então coluna a mais no começo não empurra
-- nada.
--
-- O que estava errado é outra coisa: **o `Recurso` já está guardado em
-- `dados_origem` e ninguém lê**. 207 das 617 visitas têm o nome do
-- técnico dentro delas — 27 dos 55 logins — e a tela de Equipes
-- perguntava "de quem é o Z634559?" com a resposta no próprio registro.
--
-- Isto NÃO revoga o D-089. Lá o nome era dedução nossa (casar login com
-- a matrícula da planilha de equipes); aqui é o campo que o TOA emite
-- junto do apontamento. Sugestão continua fora; **dado da fonte entra**.
-- O nome identifica de quem é o login; quem diz a EQUIPE continua sendo
-- quem opera.

drop function if exists logins_sem_cadastro(date, date);

create function logins_sem_cadastro(
  p_de date default null, p_ate date default null)
returns table(login text, visitas bigint, primeira date, ultima date,
              nome_toa text)
language sql stable security definer set search_path to 'public' as $fn$
  with v as (
    select v.base_id,
           nullif(btrim(coalesce(v.dados_origem->>'Login do Técnico','')),'') as login,
           nullif(btrim(coalesce(v.dados_origem->>'Recurso','')),'')          as recurso,
           v.data_agendada
      from visita v
     where v.excluido_em is null
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and eh_gestor()
       and (p_de  is null or v.data_agendada >= p_de)
       and (p_ate is null or v.data_agendada <= p_ate)
  )
  select v.login, count(*) as visitas,
         min(v.data_agendada) as primeira, max(v.data_agendada) as ultima,
         -- o mais frequente: se o login trocou de dono no período, o
         -- nome de um dia solto não pode mandar na etiqueta.
         mode() within group (order by v.recurso)
           filter (where v.recurso is not null) as nome_toa
    from v
   where v.login is not null
     and equipe_do_login(v.base_id, v.login, v.data_agendada) is null
   group by 1
   order by 2 desc;
$fn$;

revoke all on function logins_sem_cadastro(date, date) from public, anon;
grant execute on function logins_sem_cadastro(date, date) to authenticated;

notify pgrst, 'reload schema';
