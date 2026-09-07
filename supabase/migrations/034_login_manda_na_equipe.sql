-- 034 · O login do TOA manda na equipe, e o status espelha o TOA
--
-- ┌─ O QUE ESTAVA ERRADO ────────────────────────────────────────────┐
-- │ Cada contrato do TOA traz um "Login do Técnico". Esse login       │
-- │ pertence a uma equipe, e é ele que decide para onde o contrato    │
-- │ vai. Existia até uma função pronta para isso, `equipe_do_login()` │
-- │ (migration 021), com três critérios em ordem de prioridade.       │
-- │                                                                   │
-- │ A importação não usava a função. Usava só o TERCEIRO critério —   │
-- │ a matrícula do técnico. Resultado: o que o usuário cadastrava em  │
-- │ `equipe.login_toa` era simplesmente ignorado.                     │
-- │                                                                   │
-- │ Medido: 55 logins distintos no TOA, 9 equipes com login           │
-- │ cadastrado, 7 contratos na equipe errada (na 203, quando o        │
-- │ cadastro dizia 020 e 026).                                        │
-- └───────────────────────────────────────────────────────────────────┘

-- ============================================================
-- A · O login é único entre equipes
-- ============================================================
-- Se repetir, a importação passa a ter duas respostas para a mesma
-- pergunta e escolhe uma por acaso.

create unique index if not exists equipe_login_toa_uk
  on equipe (base_id, norm_txt(login_toa))
  where login_toa is not null;

-- No histórico, o mesmo login não pode ter duas atribuições ABERTAS.
-- Fechar a anterior (pondo `fim`) é o jeito certo de trocar de dono — o
-- login muda de equipe com o tempo, e a produtividade histórica depende
-- de saber de quem ele era em cada dia.
create unique index if not exists equipe_login_toa_aberto_uk
  on equipe_login_toa (norm_txt(login_toa))
  where fim is null;

-- Foto do técnico, para a bolinha na lista de equipes.
alter table tecnico add column if not exists foto_url text;

comment on column tecnico.foto_url is
  'Caminho da foto no Storage. A lista de equipes mostra a bolinha com '
  'as iniciais quando está vazio.';

-- ============================================================
-- B · `equipe_do_login` devolvia equipe para login NULO
-- ============================================================
--
-- ┌─ BUG LATENTE DESDE A 021, ACHADO AQUI ───────────────────────────┐
-- │ `norm_txt(NULL)` devolve STRING VAZIA, não NULL. E equipe sem     │
-- │ `login_toa` também normaliza para string vazia. Portanto:         │
-- │                                                                   │
-- │   equipe_do_login(base, NULL, data) → a primeira equipe SEM login │
-- │                                                                   │
-- │ Contrato sem login no TOA — todo apontamento de jornada é assim — │
-- │ era atribuído a uma equipe qualquer, em silêncio.                 │
-- │                                                                   │
-- │ Só apareceu quando rodei o realinhamento em lote e 158            │
-- │ apontamentos de jornada foram parar na equipe 002. Revertido.     │
-- └───────────────────────────────────────────────────────────────────┘
--
-- Sem login não há resposta. A função passa a dizer isso em vez de
-- inventar uma. E cada ramo passa a exigir que o próprio cadastro tenha
-- login, pela mesma razão.
create or replace function equipe_do_login(
  p_base uuid, p_login text, p_data date default current_date)
returns uuid language sql stable set search_path to 'public' as $function$
  select case when nullif(btrim(coalesce(p_login, '')), '') is null then null
  else (
    select eq from (
      (select e.id as eq, 1 as ordem
         from equipe_login_toa h
         join equipe e on e.id = h.equipe_id
        where e.base_id = p_base
          and nullif(btrim(coalesce(h.login_toa, '')), '') is not null
          and norm_txt(h.login_toa) = norm_txt(p_login)
          and h.inicio <= p_data and (h.fim is null or h.fim >= p_data)
        limit 1)
      union all
      (select e.id, 2
         from equipe e
        where e.base_id = p_base
          and nullif(btrim(coalesce(e.login_toa, '')), '') is not null
          and norm_txt(e.login_toa) = norm_txt(p_login)
        limit 1)
      union all
      (select t.equipe_id, 3
         from tecnico t
        where t.base_id = p_base
          and nullif(btrim(coalesce(t.matricula, '')), '') is not null
          and norm_txt(t.matricula) = norm_txt(p_login)
          and t.equipe_id is not null
        limit 1)
    ) c order by ordem limit 1)
  end;
$function$;

revoke all on function equipe_do_login(uuid, text, date) from public, anon;

-- ============================================================
-- C · Semeia o cadastro de login das equipes
-- ============================================================
-- Não é invenção: para 45 dos 55 logins vistos no TOA existe um técnico
-- com aquela matrícula e uma equipe para ele. O que faltava era
-- registrar isso em `equipe.login_toa`. Conferido antes de rodar:
-- nenhum login aponta para duas equipes distintas.

with l as (
  select distinct
    norm_txt(v.dados_origem->>'Login do Técnico') as login,
    v.base_id
  from visita v
  where nullif(btrim(coalesce(v.dados_origem->>'Login do Técnico','')),'') is not null
    and v.excluido_em is null
),
alvo as (
  select l.login, l.base_id,
         (select t.equipe_id from tecnico t
           where t.base_id = l.base_id and norm_txt(t.matricula) = l.login
             and t.equipe_id is not null limit 1) as equipe_id
  from l
  where not exists (select 1 from equipe e
                     where e.base_id = l.base_id
                       and norm_txt(e.login_toa) = l.login)
)
update equipe e
   set login_toa = a.login
  from alvo a
 where e.id = a.equipe_id and a.equipe_id is not null and e.login_toa is null;

with l as (
  select
    norm_txt(v.dados_origem->>'Login do Técnico') as login,
    v.base_id, min(v.data_agendada) as desde
  from visita v
  where nullif(btrim(coalesce(v.dados_origem->>'Login do Técnico','')),'') is not null
    and v.excluido_em is null
  group by 1,2
)
insert into equipe_login_toa (equipe_id, login_toa, inicio)
select e.id, e.login_toa, l.desde
  from equipe e
  join l on l.base_id = e.base_id and l.login = norm_txt(e.login_toa)
 where e.login_toa is not null
   and not exists (select 1 from equipe_login_toa h
                    where norm_txt(h.login_toa) = norm_txt(e.login_toa)
                      and h.fim is null);

-- Resultado: 9 → 54 equipes com login cadastrado.

-- ============================================================
-- D · Realinhar o que já está gravado
-- ============================================================
-- A importação antiga podia deixar contrato na equipe errada. Isto
-- conserta, deixando evento — ninguém descobre depois que a equipe
-- mudou sozinha.
--
-- ⚠ Rode DEPOIS da correção do `equipe_do_login` acima. Antes dela,
--   esta função joga todo apontamento sem login numa equipe qualquer.
create or replace function corrigir_equipe_pelo_login(
  p_de date default null, p_ate date default null)
returns TABLE(contrato text, de text, para text)
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;

  return query
  with alvo as (
    select v.id, v.contrato, v.equipe_id as antiga,
           equipe_do_login(v.base_id, v.dados_origem->>'Login do Técnico',
                           v.data_agendada) as nova,
           v.dados_origem->>'Login do Técnico' as login
    from visita v
    where v.excluido_em is null
      and v.empresa_id = minha_empresa()
      and v.base_id in (select bases_visiveis())
      and (p_de is null or v.data_agendada >= p_de)
      and (p_ate is null or v.data_agendada <= p_ate)
  ),
  mudar as (
    select * from alvo where nova is not null and nova is distinct from antiga
  ),
  ev as (
    insert into visita_evento (visita_id, tipo, de, para, origem,
                               usuario_id, login, equipe_id, observacao)
    select m.id, 'TRANSFERENCIA',
           jsonb_build_object('equipe', (select codigo from equipe where id = m.antiga)),
           jsonb_build_object('equipe', (select codigo from equipe where id = m.nova)),
           'SISTEMA', auth.uid(), m.login, m.antiga,
           'Realinhado pelo cadastro de login do TOA'
      from mudar m
    returning visita_id
  ),
  upd as (
    update visita v set equipe_id = m.nova
      from mudar m where v.id = m.id
    returning v.id
  )
  select m.contrato,
         (select codigo from equipe where id = m.antiga),
         (select codigo from equipe where id = m.nova)
    from mudar m
   where m.id in (select id from upd) and exists (select 1 from ev);
end;
$fn$;

revoke all on function corrigir_equipe_pelo_login(date, date) from public, anon;
grant execute on function corrigir_equipe_pelo_login(date, date) to authenticated;

-- ============================================================
-- E · A importação passa a usar o cadastro, e a espelhar o status
-- ============================================================
-- Duas mudanças em `importar_toa_interno`:
--
-- 1. `v_equipe := equipe_do_login(...)` em vez de olhar só a matrícula.
--
-- 2. A trava do D-006 continua protegendo o TRABALHO do campo (baixa
--    da AFLINE, foto, observação), mas NÃO segura mais o status. O
--    sistema é espelho do TOA, e status que não espelha não serve para
--    despachar. O evento CONFLITO_TOA continua sendo gravado, então
--    nada se perde da trilha.
--
--    ⚠ Consequência: com o app do técnico em uso, uma planilha do TOA
--      mais velha que a última etapa dele vai desfazer essa etapa. Foi
--      decisão do Emanuel, tomada com esse risco na mesa.
--
-- O corpo completo da função está aplicado no banco (034c). Ver
-- `pg_get_functiondef` para a versão vigente.
