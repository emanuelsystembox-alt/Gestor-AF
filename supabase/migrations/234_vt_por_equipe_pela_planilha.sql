-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 234 — VT por equipe como a planilha da operação (D-343)              │
-- │                                                                      │
-- │ "atualizar o indicador VT por equipe, pegando as regras conforme     │
-- │  esta na planilha, e precisa bater com os numeros atualizado até o   │
-- │  dia da planilha (...) opção de colocar os F em cima das caixinhas   │
-- │  para quando for folga" — Emanuel, 09/11. "é baseado no TOA (...)    │
-- │  somente desse mês" e "é voltado apenas para bucket de VT".          │
-- │                                                                      │
-- │ A REGRA, lida das fórmulas de "VT POR EQP MNS NOVEMBRO.xlsx":        │
-- │   valor do dia = SOMA(pontos) ÷ 35, por login do TOA e dia;          │
-- │   pontos = a tabela da aba DADOS, por tipo de O.S. (48 = 35,         │
-- │            226 = 140, 61 = 15, 212 = 0…) — `vt_ponto`;               │
-- │   DIAS = dias com valor; MÉDIA = total ÷ DIAS;                       │
-- │   "SE" = média ≥ 5,7; SOMA 1 / SOMA 0 = os DIAS de quem passou /     │
-- │   não passou; EQUIPES REALIZADAS = SOMA 1 ÷ 21; a projeção leva ao   │
-- │   mês inteiro. Essas contas de cima moram na tela, sobre as linhas.  │
-- │                                                                      │
-- │ QUAIS atividades contam não está escrito na planilha (a aba TOA não  │
-- │ veio no arquivo) — foi DERIVADO do dado: cruzamos o banco com os     │
-- │ números da planilha, login a login, de 01 a 06/11 (os dias que ela   │
-- │ tem), e o que fecha 72 de 72 células é:                              │
-- │   • atividade FINALIZADA no TOA (concluída ou não concluída —        │
-- │     `finalizado_toa`); cancelada e pendente não contam;              │
-- │   • só a 1ª O.S. da atividade. A 2ª O.S. nunca entrou na conta da    │
-- │     planilha: as quatro O.S. 181 (blindagem) de segunda posição      │
-- │     ficaram fora, embora a aba DADOS diga "62 + 181 = 55";           │
-- │   • o login é o do TOA na linha da atividade.                        │
-- │ Outras regras testadas e recusadas: só concluída (62/72), código de  │
-- │ baixa de sucesso (53/72), todas as O.S. (66/72), técnico responsável │
-- │ no lugar do login (70/72).                                           │
-- │                                                                      │
-- │ A célula do Z562599 em 02/11 está digitada à mão como 5 na aba       │
-- │ principal (a fórmula dá 4); o banco dá 5.                            │
-- │                                                                      │
-- │ Só este mês para trás até 01/11: setembro e outubro vieram da carga  │
-- │ do ngestor, sem login nem bucket do TOA (D-282). A função não        │
-- │ inventa: mês sem dado do TOA volta vazio.                            │
-- │                                                                      │
-- │ A ESCALA (F, FE, FALTA, ATES.) é declarada por quem opera, dia a     │
-- │ dia, em `vt_escala`. Como na planilha, o valor do dia ganha da       │
-- │ marca: dia com VT mostra o número.                                   │
-- └──────────────────────────────────────────────────────────────────────┘

-- ── os pontos por tipo de O.S. (a aba DADOS) ─────────────────────────────
create table if not exists vt_ponto (
  empresa_id      uuid not null references empresa(id),
  tipo_os_codigo  integer not null,
  pontos          numeric not null check (pontos >= 0),
  primary key (empresa_id, tipo_os_codigo)
);
alter table vt_ponto enable row level security;
drop policy if exists vt_ponto_leitura on vt_ponto;
create policy vt_ponto_leitura on vt_ponto for select to authenticated
  using (empresa_id = (select minha_empresa()));
revoke all on vt_ponto from anon;
grant select on vt_ponto to authenticated;

-- Os tipos sozinhos da aba DADOS. As combinações dela ("48 + 129 = 70")
-- são a soma destes; a 181 sai de "62 + 181 = 55" (55 − 35 = 20).
insert into vt_ponto (empresa_id, tipo_os_codigo, pontos)
select e.id, x.cod, x.pts
  from empresa e
 cross join (values
   (10, 35), (48, 35), (50, 35), (61, 15), (62, 35), (67, 35), (103, 0), (114, 60),
   (115, 130), (129, 35), (131, 35), (144, 60), (158, 35), (161, 35), (168, 35),
   (181, 20), (188, 35), (204, 35), (206, 20), (212, 0), (221, 5), (225, 30),
   (226, 140), (261, 30), (307, 35), (324, 35)
 ) as x(cod, pts)
on conflict (empresa_id, tipo_os_codigo) do nothing;

-- ── as réguas (parâmetros, para a operação mudar sem migration) ──────────
insert into parametro (empresa_id, chave, valor, descricao)
select e.id, p.chave, p.valor, p.descricao
  from empresa e
 cross join (values
   ('vt_pontos_por_vt', '35'::jsonb, 'VT por equipe: quantos pontos valem uma VT (a planilha divide por 35)'),
   ('vt_meta_media',    '5.7'::jsonb, 'VT por equipe: média por dia para o técnico contar na SOMA 1'),
   ('vt_dias_equipe',   '21'::jsonb, 'VT por equipe: dias que fazem uma equipe no mês (a planilha divide por 21)')
 ) as p(chave, valor, descricao)
on conflict (empresa_id, chave) do nothing;

-- ── a escala declarada: F, FE, FALTA, ATES. ──────────────────────────────
create table if not exists vt_escala (
  empresa_id  uuid not null references empresa(id),
  base_id     uuid not null references base(id),
  login       text not null,
  dia         date not null,
  codigo      text not null check (codigo in ('F', 'FE', 'FALTA', 'ATES.')),
  criado_por  uuid references auth.users(id),
  criado_em   timestamptz not null default now(),
  primary key (base_id, login, dia)
);
alter table vt_escala enable row level security;
drop policy if exists vt_escala_leitura on vt_escala;
create policy vt_escala_leitura on vt_escala for select to authenticated
  using (empresa_id = (select minha_empresa())
         and base_id in (select bases_visiveis()));
-- Sem policy de escrita: só a RPC abaixo grava, com o autor carimbado.
revoke all on vt_escala from anon;
grant select on vt_escala to authenticated;

-- Marca (ou tira, com p_codigo nulo) a escala de um login num dia, na
-- cidade ativa. Quem marca é a gestão — a mesma que lê o indicador.
create or replace function marcar_escala_vt(p_login text, p_dia date, p_codigo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base uuid;
begin
  if not (select eh_gestao()) then
    raise exception 'Só a gestão marca a escala do VT.' using errcode = '42501';
  end if;
  if p_codigo is not null and p_codigo not in ('F', 'FE', 'FALTA', 'ATES.') then
    raise exception 'Escala "%" não existe — use F, FE, FALTA ou ATES.', p_codigo;
  end if;
  select b into v_base from bases_visiveis() b limit 1;
  if v_base is null then
    raise exception 'Escolha a cidade no topo antes de marcar a escala.';
  end if;

  if p_codigo is null then
    delete from vt_escala where base_id = v_base and login = upper(btrim(p_login)) and dia = p_dia;
  else
    insert into vt_escala (empresa_id, base_id, login, dia, codigo, criado_por)
    values (minha_empresa(), v_base, upper(btrim(p_login)), p_dia, p_codigo, auth.uid())
    on conflict (base_id, login, dia) do update
       set codigo = excluded.codigo, criado_por = excluded.criado_por, criado_em = now();
  end if;
end;
$$;
revoke all on function marcar_escala_vt(text, date, text) from public, anon;
grant execute on function marcar_escala_vt(text, date, text) to authenticated;

-- ── o mês, login a login ─────────────────────────────────────────────────
-- Devolve o valor de cada dia (em VT, já dividido) e a escala marcada. As
-- contas da planilha (DIAS, MÉDIA, SE, SOMA 1/0, equipes) a tela faz sobre
-- isto — são somas das linhas, e assim a tela e o número batem sempre.
create or replace function vt_por_equipe_mes(p_mes date)
returns table (
  login text, nome text, equipe text,
  por_dia jsonb,      -- [{dia, vt, atividades}]
  escala jsonb,       -- [{dia, codigo}]
  sem_ponto integer   -- atividades cuja 1ª O.S. não está em vt_ponto (contam 0)
)
language sql
stable
security definer
set search_path = public
as $$
  with lim as materialized (
    select date_trunc('month', p_mes)::date as ini,
           (date_trunc('month', p_mes) + interval '1 month - 1 day')::date as fim,
           coalesce((select (valor #>> '{}')::numeric from parametro
                      where empresa_id = minha_empresa() and chave = 'vt_pontos_por_vt'), 35) as div
  ),
  ativ as materialized (
    select upper(coalesce(nullif(btrim(v.dados_origem->>'Login do Técnico'), ''), t.matricula)) as login,
           v.data_agendada as dia,
           v.base_id,
           v.tecnico_responsavel_id as tec,
           (select tos.codigo
              from ordem_servico o join tipo_os tos on tos.id = o.tipo_os_id
             where o.visita_id = v.id
             order by o.sequencia limit 1) as tipo1
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      cross join lim
     where v.data_agendada between lim.ini and lim.fim
       and v.excluido_em is null
       and v.finalizado_toa
       and v.toa_bucket ilike '%\_VT'
       and v.empresa_id = (select minha_empresa())
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
  ),
  com_ponto as (
    select a.login, a.dia, a.base_id, a.tec, a.tipo1, p.pontos
      from ativ a
      left join vt_ponto p on p.empresa_id = (select minha_empresa()) and p.tipo_os_codigo = a.tipo1
     where a.tipo1 is not null and a.login is not null
  ),
  por_dia as (
    select c.login, c.dia,
           round(sum(coalesce(c.pontos, 0)) / (select div from lim), 4) as vt,
           count(*)::int as atividades,
           count(*) filter (where c.pontos is null)::int as sem_ponto
      from com_ponto c group by c.login, c.dia
  ),
  esc as (
    select e.login, e.dia, e.codigo
      from vt_escala e cross join lim
     where e.dia between lim.ini and lim.fim
       and e.empresa_id = (select minha_empresa())
       and e.base_id in (select bases_visiveis())
  ),
  logins as (
    select distinct login from por_dia
    union
    select distinct login from esc
  ),
  -- O nome é o do técnico dono do login na cidade; sem ele, o de quem
  -- estava responsável pela atividade.
  quem as (
    select l.login,
           coalesce(
             (select t.nome from tecnico t
               where upper(t.matricula) = l.login and t.base_id in (select bases_visiveis())
               order by (t.situacao = 'ATIVO') desc limit 1),
             (select t.nome from com_ponto c join tecnico t on t.id = c.tec
               where c.login = l.login order by c.dia desc limit 1)) as nome,
           coalesce(
             (select e.codigo from tecnico t join equipe e on e.id = t.equipe_id
               where upper(t.matricula) = l.login and t.base_id in (select bases_visiveis())
               order by (t.situacao = 'ATIVO') desc limit 1),
             (select e.codigo from com_ponto c join tecnico t on t.id = c.tec
                join equipe e on e.id = t.equipe_id
               where c.login = l.login order by c.dia desc limit 1)) as equipe
      from logins l
  )
  select q.login, q.nome, q.equipe,
         coalesce((select jsonb_agg(jsonb_build_object('dia', d.dia, 'vt', d.vt, 'atividades', d.atividades)
                                    order by d.dia)
                     from por_dia d where d.login = q.login), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('dia', e.dia, 'codigo', e.codigo) order by e.dia)
                     from esc e where e.login = q.login), '[]'::jsonb),
         coalesce((select sum(d.sem_ponto) from por_dia d where d.login = q.login), 0)::int
    from quem q
   order by q.nome nulls last, q.login;
$$;
revoke all on function vt_por_equipe_mes(date) from public, anon;
grant execute on function vt_por_equipe_mes(date) to authenticated;

notify pgrst, 'reload schema';
