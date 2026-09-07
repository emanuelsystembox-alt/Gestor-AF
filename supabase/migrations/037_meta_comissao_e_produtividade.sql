-- 037 · Meta, comissão do técnico e a tela de produtividade
--
-- ┌─ DE ONDE VEIO O MODELO ──────────────────────────────────────────┐
-- │ Da tela "Pontuação Por Técnico" do sistema atual:                 │
-- │   META SINGLE MASTER 120.00 · META ALCANÇADA 9.93                 │
-- │   DIAS TRABALHADOS 4 · MÉDIA DIA 2.48 · PREVISÃO 59.58            │
-- │ mais a tabela de faixas (Pontuação Inicial → Final → Fator), com  │
-- │ 15 linhas de 120→129 (fator 2) até 300→400 (fator 12).            │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ⚠ `fator` está modelado; **o valor em reais NÃO**. A tela dele mostra
--   "A receber R$ 0,00" porque 9.93 está abaixo da primeira faixa, e de
--   um zero não se deduz o que o fator multiplica. Enquanto o Emanuel
--   não disser, não existe coluna de dinheiro aqui — número de dinheiro
--   chutado é pior que número de dinheiro ausente.

alter table tecnico add column if not exists skill text;
comment on column tecnico.skill is
  'SINGLE MASTER etc. Decide qual meta e qual tabela de faixa valem.';

create table if not exists meta_tecnico (
  id              uuid primary key default uuid_generate_v4(),
  empresa_id      uuid references empresa(id),
  skill           text not null,
  meta_pontos     numeric(12,2) not null check (meta_pontos > 0),
  vigencia_inicio date not null default current_date,
  vigencia_fim    date,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  criado_por      uuid references perfil(id)
);
create index if not exists meta_tecnico_skill_ix on meta_tecnico (skill, vigencia_inicio desc);

create table if not exists faixa_comissao (
  id          uuid primary key default uuid_generate_v4(),
  empresa_id  uuid references empresa(id),
  skill       text not null,
  pontos_de   numeric(12,2) not null,
  pontos_ate  numeric(12,2) not null,
  fator       numeric(12,4) not null,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references perfil(id),
  check (pontos_ate >= pontos_de)
);
create index if not exists faixa_comissao_ix on faixa_comissao (skill, pontos_de);

alter table meta_tecnico   enable row level security;
alter table faixa_comissao enable row level security;

-- Todo mundo LÊ (o técnico precisa ver a própria meta); só quem tem a
-- permissão ESCREVE, e a escrita passa por RPC (D-055).
drop policy if exists meta_leitura on meta_tecnico;
create policy meta_leitura on meta_tecnico for select
  using (empresa_id is null or empresa_id = minha_empresa());

drop policy if exists faixa_leitura on faixa_comissao;
create policy faixa_leitura on faixa_comissao for select
  using (empresa_id is null or empresa_id = minha_empresa());

insert into permissao (chave, modulo, rotulo)
values ('comissao.editar', 'CONFIGURACOES', 'Editar meta e comissao do tecnico')
on conflict (chave) do nothing;

-- Semente: os valores da tela dele. Se mudar lá, muda aqui pela tela.
insert into meta_tecnico (empresa_id, skill, meta_pontos, vigencia_inicio)
select e.id, 'SINGLE MASTER', 120.00, date_trunc('month', current_date)::date
  from empresa e
 where not exists (select 1 from meta_tecnico m
                    where m.skill = 'SINGLE MASTER' and m.ativo);

insert into faixa_comissao (empresa_id, skill, pontos_de, pontos_ate, fator)
select e.id, 'SINGLE MASTER', f.de, f.ate, f.fator
  from empresa e,
       (values
         (120.00, 129.00,  2.00), (130.00, 139.00,  2.25),
         (140.00, 149.00,  2.50), (150.00, 159.00,  4.00),
         (160.00, 169.00,  5.00), (170.00, 179.00,  5.40),
         (180.00, 189.00,  5.60), (190.00, 199.00,  5.80),
         (200.00, 219.00,  7.00), (220.00, 229.00,  8.00),
         (230.00, 239.00,  9.00), (240.00, 259.00,  9.50),
         (260.00, 279.00, 10.00), (280.00, 299.00, 11.00),
         (300.00, 400.00, 12.00)
       ) as f(de, ate, fator)
 where not exists (select 1 from faixa_comissao c
                    where c.skill = 'SINGLE MASTER' and c.ativo);

update tecnico set skill = 'SINGLE MASTER' where skill is null;

-- ============================================================
-- Edição da tabela — só quem tem a permissão
-- ============================================================
create or replace function definir_meta_comissao(p_skill text, p_meta numeric)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
begin
  if not eh_gestor() then
    raise exception 'Sem permissao para mexer na meta.' using errcode = '42501';
  end if;
  if not tem_permissao('comissao.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar meta e comissao do tecnico".'
      using errcode = '42501';
  end if;
  if coalesce(p_meta, 0) <= 0 then
    raise exception 'A meta tem de ser maior que zero.' using errcode = '23514';
  end if;

  -- Meta não se sobrescreve: a antiga fecha e a nova começa hoje. Sem
  -- isso, mudar a meta em outubro reescreveria a comissão de setembro.
  update meta_tecnico
     set vigencia_fim = current_date - 1, ativo = false
   where skill = p_skill and ativo and vigencia_fim is null;

  insert into meta_tecnico (empresa_id, skill, meta_pontos, vigencia_inicio, criado_por)
  values (minha_empresa(), p_skill, p_meta, current_date, auth.uid());

  return jsonb_build_object('skill', p_skill, 'meta', p_meta, 'desde', current_date);
end;
$fn$;

revoke all on function definir_meta_comissao(text, numeric) from public, anon;
grant execute on function definir_meta_comissao(text, numeric) to authenticated;

-- `p_faixas` = [{"de":120,"ate":129,"fator":2}, ...]
create or replace function definir_faixas_comissao(p_skill text, p_faixas jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare f jsonb; n int := 0; anterior numeric := null;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao para mexer na comissao.' using errcode = '42501';
  end if;
  if not tem_permissao('comissao.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar meta e comissao do tecnico".'
      using errcode = '42501';
  end if;

  -- Faixa sobreposta faz a mesma pontuação valer dois fatores, e a
  -- consulta escolhe um por acaso. Confere antes de gravar.
  for f in select * from jsonb_array_elements(p_faixas)
           order by ((value->>'de')::numeric)
  loop
    if (f->>'ate')::numeric < (f->>'de')::numeric then
      raise exception 'Faixa invertida: % ate %', f->>'de', f->>'ate'
        using errcode = '23514';
    end if;
    if anterior is not null and (f->>'de')::numeric <= anterior then
      raise exception 'Faixa sobreposta em %: comeca antes de a anterior terminar (%)',
        f->>'de', anterior using errcode = '23514';
    end if;
    anterior := (f->>'ate')::numeric;
    n := n + 1;
  end loop;

  update faixa_comissao set ativo = false where skill = p_skill and ativo;

  insert into faixa_comissao (empresa_id, skill, pontos_de, pontos_ate, fator, criado_por)
  select minha_empresa(), p_skill,
         (x->>'de')::numeric, (x->>'ate')::numeric, (x->>'fator')::numeric, auth.uid()
    from jsonb_array_elements(p_faixas) x;

  return jsonb_build_object('skill', p_skill, 'faixas', n);
end;
$fn$;

revoke all on function definir_faixas_comissao(text, jsonb) from public, anon;
grant execute on function definir_faixas_comissao(text, jsonb) to authenticated;

-- ============================================================
-- produtividade_periodo — a tela inteira numa consulta
-- ============================================================
--
-- ┌─ POR QUE DEFINER, E POR QUE `as materialized` ───────────────────┐
-- │ A primeira versão era INVOKER e morria de duas mortes:            │
-- │                                                                   │
-- │ 1. `pontos_por_periodo` numa CTE referenciada uma vez é INLINE    │
-- │    pelo planejador — e passa a ser reexecutada por linha do join. │
-- │    `as materialized` obriga a rodar uma vez e guardar.            │
-- │                                                                   │
-- │ 2. Como INVOKER, o RLS da `visita` reavaliava `minha_empresa()`,  │
-- │    `bases_visiveis()` e `equipes_visiveis()` a cada linha.        │
-- │                                                                   │
-- │ Media 402ms como owner e ESTOURAVA o statement timeout como       │
-- │ `authenticated` — o teste que passa como dono e falha como        │
-- │ usuário é o mesmo engano do D-054, agora em desempenho.           │
-- │                                                                   │
-- │ DEFINER ignora o RLS, então o escopo é conferido à mão aqui       │
-- │ dentro, uma vez. Conferido: TECNICO sem equipe vinculada e        │
-- │ CONTROLADOR sem carteira recebem ZERO linhas. 844ms na tela.      │
-- └───────────────────────────────────────────────────────────────────┘
--
-- **Só conta contrato CONCLUÍDO.** Contrato em execução não virou
-- dinheiro, e contá-lo faz a comissão oscilar para baixo quando cai.
-- Jornada não entra em produtividade (CLAUDE.md).
--
-- O corpo vigente está aplicado no banco (037f). Ver pg_get_functiondef.
