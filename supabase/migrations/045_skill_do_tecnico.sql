-- 045 · A skill do técnico: ADESÃO, MANUTENÇÃO, DESCONEXÃO
--
-- ┌─ O QUE O EMANUEL PEDIU ──────────────────────────────────────────┐
-- │ "Falo do cadastro do técnico, que precisa ser nessa parte. Precisa │
-- │  ter skill, se é ADESÃO, MANUTENÇÃO, DESCONEXÃO. Não precisa      │
-- │  mudar nada, somente dados a mais na tela de cadastro, como RG e  │
-- │  nascimento e skill, que está faltando."                          │
-- └───────────────────────────────────────────────────────────────────┘
--
-- RG e nascimento não custaram migration: `perfil.rg` e
-- `perfil.data_nascimento` já existiam e a Edge Function já os aceitava
-- — só a tela não mandava.
--
-- A skill custou, porque **`tecnico.skill` não é um rótulo: é a chave
-- do dinheiro.** É por ela que o técnico acha `meta_tecnico` e
-- `faixa_comissao` (D-077). Hoje todos os 104 valem `SINGLE MASTER` —
-- valor que EU pus na 037 como default, não que veio do TOA (a
-- "Habilidade de Trabalho" da planilha é outra coisa: "Instalação(1/100),
-- Escada(1/100)…").
--
-- Gravar ADESÃO num técnico sem antes existir faixa de ADESÃO faz o "a
-- receber" dele virar R$ 0 **em silêncio**. Perguntado, o Emanuel
-- decidiu: as três substituem o SINGLE MASTER, **e cada uma tem meta e
-- faixas próprias**, que ele vai levantar.
--
-- Por isso esta migration NÃO converte ninguém. Quem está em SINGLE
-- MASTER fica, com a meta e as faixas que já funcionam, até haver faixa
-- da skill nova para ir. O que ela faz é dar o domínio, o caminho para
-- gravar, e — na tela — o aviso de que a skill escolhida ainda não tem
-- tabela de comissão.

-- ============================================================
-- A · O domínio
-- ============================================================
-- Tabela, não `check`: skill nova é decisão de operação, e ninguém
-- deveria precisar de migration para acrescentar uma.
create table if not exists skill (
  id         uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresa(id),
  nome       text not null,
  ativo      boolean not null default true,
  ordem      int not null default 0,
  criado_em  timestamptz not null default now(),
  unique (empresa_id, nome)
);

alter table skill enable row level security;

drop policy if exists skill_leitura on skill;
create policy skill_leitura on skill for select to authenticated
  using (empresa_id = minha_empresa());

drop policy if exists skill_escrita on skill;
create policy skill_escrita on skill for all to authenticated
  using (empresa_id = minha_empresa() and eh_gestor()
         and tem_permissao('equipes.editar'))
  with check (empresa_id = minha_empresa() and eh_gestor()
              and tem_permissao('equipes.editar'));

insert into skill (empresa_id, nome, ordem, ativo)
select e.id, x.nome, x.ordem, x.ativo
  from empresa e
  cross join (values ('ADESÃO', 1, true),
                     ('MANUTENÇÃO', 2, true),
                     ('DESCONEXÃO', 3, true),
                     -- fica na lista porque 104 técnicos ainda são ela e
                     -- as faixas que funcionam são dela. Inativa: não se
                     -- escolhe mais no cadastro.
                     ('SINGLE MASTER', 9, false)) as x(nome, ordem, ativo)
 where not exists (select 1 from skill s
                    where s.empresa_id = e.id and s.nome = x.nome);

-- ============================================================
-- B · Como se grava
-- ============================================================
-- Pelo login do TOA, que é a matrícula: é o que a tela de acesso tem em
-- mãos (D-087) e o que quem opera sabe de cor. E devolve se aquela
-- skill JÁ TEM meta e faixa — quem cadastra precisa saber na hora que
-- acabou de deixar o técnico fora da tabela de comissão.
create or replace function definir_skill_tecnico(p_login_toa text, p_skill text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v record; v_meta numeric; v_faixas int;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  if not (tem_permissao('equipes.editar') or tem_permissao('admin.usuarios')) then
    raise exception 'Seu perfil de acesso nao inclui "Editar equipe e tecnico".'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_login_toa,'')),'') is null then
    raise exception 'Informe o login do TOA.' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_skill,'')),'') is null then
    raise exception 'Informe a skill.' using errcode = '23514';
  end if;

  perform 1 from skill
   where empresa_id = minha_empresa() and nome = btrim(p_skill);
  if not found then
    raise exception 'Skill "%" nao existe no cadastro.', btrim(p_skill)
      using errcode = 'P0002';
  end if;

  select t.id, t.nome, t.matricula, t.skill into v
    from tecnico t
   where t.base_id in (select bases_visiveis())
     and norm_txt(t.matricula) = norm_txt(p_login_toa)
   limit 1;
  if v.id is null then
    raise exception
      'Nao existe tecnico com o login %. Importe a planilha de equipes antes, ou confira o login.',
      btrim(p_login_toa) using errcode = 'P0002';
  end if;

  update tecnico set skill = btrim(p_skill) where id = v.id;

  select m.meta_pontos into v_meta from meta_tecnico m
   where m.skill = btrim(p_skill) and m.ativo
   order by m.vigencia_inicio desc limit 1;
  select count(*) into v_faixas from faixa_comissao f
   where f.skill = btrim(p_skill) and f.ativo;

  return jsonb_build_object(
    'tecnico', v.nome, 'matricula', v.matricula,
    'de', v.skill, 'para', btrim(p_skill),
    'meta', v_meta, 'faixas', v_faixas);
end;
$fn$;

revoke all on function definir_skill_tecnico(text, text) from public, anon;
grant execute on function definir_skill_tecnico(text, text) to authenticated;

notify pgrst, 'reload schema';
