-- ============================================================================
-- 092 · A meta se configura na Administração, e trocar a meta não apaga o mês
-- ============================================================================
-- > "a meta precisa ser configuravel na tela do administrador - as metas
-- >  para o time da adesão é 120 pts mês" — Emanuel, 27/09
--
-- A meta JÁ era configurável — em "Meta técnica", escondida dentro de
-- "Editar tabela", amarrada à tabela de faixas. Ao olhar de perto para
-- abrir a porta na Administração, dois defeitos em `definir_meta_comissao`
-- (037):
--
-- ┌─ 1. trocar a meta APAGAVA a meta do mês anterior ─────────────────┐
-- │ O comentário dizia: "Meta não se sobrescreve: a antiga fecha e a  │
-- │ nova começa hoje. Sem isso, mudar a meta em outubro reescreveria  │
-- │ a comissão de setembro." Mas a antiga era fechada com             │
-- │ `ativo = false`, e TODA leitura filtra `ativo`                    │
-- │ (`produtividade_periodo`, `meta_da_skill`, a tela). Mudar a meta  │
-- │ em outubro deixava setembro SEM meta nenhuma — o contrário do     │
-- │ prometido. A vigência (`vigencia_fim`) já fecha o período; `ativo`│
-- │ fica para desligar uma meta errada, não para encerrar uma certa.  │
-- └───────────────────────────────────────────────────────────────────┘
-- ┌─ 2. `current_date` é UTC ─────────────────────────────────────────┐
-- │ Em Manaus o dia vira às 20h: a meta gravada à noite nascia        │
-- │ "amanhã" (traps.md). Agora `hoje_local()`.                        │
-- └───────────────────────────────────────────────────────────────────┘
--
-- Limite conhecido, não resolvido aqui: se a meta mudar NO MEIO do mês,
-- as duas vigências cobrem o mês. `meta_da_skill` (091) fica com a mais
-- nova; `produtividade_periodo` pega uma delas sem ordem. Enquanto a
-- troca for na virada do mês, não aparece.
-- ============================================================================

create or replace function definir_meta_comissao(p_skill text, p_meta numeric)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v_hoje date := hoje_local();
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
  if not exists (select 1 from skill where nome = p_skill and empresa_id = minha_empresa()) then
    raise exception 'Skill % nao existe.', p_skill using errcode = 'P0002';
  end if;

  -- A antiga FECHA (vigencia_fim) e continua valendo para o período dela:
  -- `ativo` continua true. Ver a caixa 1 no cabeçalho.
  update meta_tecnico
     set vigencia_fim = v_hoje - 1
   where skill = p_skill and ativo and vigencia_fim is null
     and empresa_id = minha_empresa()
     and vigencia_inicio < v_hoje;
  -- Trocada duas vezes no mesmo dia: a de hoje é corrigida, não empilhada.
  delete from meta_tecnico
   where skill = p_skill and ativo and vigencia_fim is null
     and empresa_id = minha_empresa()
     and vigencia_inicio = v_hoje;

  insert into meta_tecnico (empresa_id, skill, meta_pontos, vigencia_inicio, criado_por)
  values (minha_empresa(), p_skill, p_meta, v_hoje, auth.uid());

  return jsonb_build_object('skill', p_skill, 'meta', p_meta, 'desde', v_hoje);
end;
$fn$;
revoke all on function definir_meta_comissao(text, numeric) from public, anon;
grant execute on function definir_meta_comissao(text, numeric) to authenticated;

-- As metas da empresa, uma linha por skill — a aba da Administração.
-- Skill SEM meta aparece com meta NULA: é o trabalho que falta, e a tela
-- escreve "sem meta", nunca "0" (D-117).
create or replace function metas_das_skills()
returns table (skill text, skill_ativa boolean, meta numeric, desde date,
               criado_por text, faixas bigint, tecnicos bigint)
language sql stable security definer set search_path to 'public' as $fn$
  select s.nome, s.ativo,
         m.meta_pontos, m.vigencia_inicio,
         (select coalesce(nullif(p.apelido, ''), p.nome) from perfil p where p.id = m.criado_por),
         (select count(*) from faixa_comissao f
           where f.skill = s.nome and f.ativo and f.empresa_id = minha_empresa()),
         (select count(*) from tecnico t
           where t.skill = s.nome and t.empresa_id = minha_empresa() and t.situacao = 'ATIVO')
    from skill s
    left join lateral (
      select mt.meta_pontos, mt.vigencia_inicio, mt.criado_por from meta_tecnico mt
       where mt.skill = s.nome and mt.ativo and mt.empresa_id = minha_empresa()
         and mt.vigencia_inicio <= hoje_local()
         and (mt.vigencia_fim is null or mt.vigencia_fim >= hoje_local())
       order by mt.vigencia_inicio desc limit 1) m on true
   where eh_gestao() and s.empresa_id = minha_empresa()
   order by s.ativo desc, s.ordem;
$fn$;
revoke all on function metas_das_skills() from public, anon;
grant execute on function metas_das_skills() to authenticated;

notify pgrst, 'reload schema';
