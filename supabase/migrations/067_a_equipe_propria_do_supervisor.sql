-- ============================================================
-- 067 · A equipe própria do supervisor
--
-- > "o supervisor pode ir pra campo quando necessário, porém para o
-- >  supervisor repita o nome dele no número da equipe, para que seja
-- >  possível passar rota pra ele quando necessário." — Emanuel
--
-- Escolhido por ele entre três opções: equipe própria, identificada
-- pelo NOME e não por número.
--
--     EQUIPE                          CONTRATOS
--     001 - EQUIPE                          13
--     002 - EQUIPE                          11
--     SUPERVISOR - JORGE SUSSUARANA          3   ← rota do supervisor
--
-- O código é `SUP-JORGE`, derivado do nome. **Não é numérico de
-- propósito**: o padrão de três dígitos (D-125) é das equipes de campo,
-- e a graça desta é ser reconhecível de longe na lista e no relatório.
-- `equipeRotulo()` já trata código não numérico devolvendo o nome, então
-- a tela mostra "SUPERVISOR - JORGE SUSSUARANA" sem nenhuma exceção
-- escrita nela.
--
-- **Idempotente**: chamar de novo devolve a mesma equipe com
-- `ja_existia: true`. A tela chama a cada salvamento do supervisor, e
-- salvar duas vezes não pode criar duas equipes.
--
-- O nome sai de `equipe.supervisor_nome` das equipes que ele JÁ
-- supervisiona — ou seja, exige o vínculo da D-132 primeiro. Sem ele
-- não há nome, e inventar um seria inventar quem a pessoa é.
--
-- ┌─ um erro meu, pego no teste ─────────────────────────────────────┐
-- │ A primeira versão gerava `SUP-SUP` para todo mundo: eu supus que  │
-- │ `norm_txt` minusculizava, e ele MAIUSCULIZA — então o `^supervisor│
-- │ ` da expressão nunca casava. Consertado com `lower()` antes.      │
-- │ Nenhuma equipe real chegou a ser criada com o código errado: o    │
-- │ teste rodou em transação desfeita.                                │
-- └───────────────────────────────────────────────────────────────────┘
--
-- CONFERIDO como `authenticated`, em transação desfeita:
--
--     criada=SUP-JORGE | 2a chamada ja_existia=true
--     na tela=SUPERVISOR - JORGE SUSSUARANA
-- ============================================================

create or replace function public.criar_equipe_do_supervisor(p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nome text; v_base uuid; v_cod text; v_raiz text; v_id uuid; i int := 1;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  if not tem_permissao('equipes.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar equipe e tecnico".'
      using errcode = '42501';
  end if;

  select e.supervisor_nome, e.base_id into v_nome, v_base
    from equipe e
   where e.supervisor_id = p_usuario and e.empresa_id = minha_empresa()
     and e.base_id in (select bases_visiveis())
   group by e.supervisor_nome, e.base_id
   order by count(*) desc
   limit 1;

  if v_nome is null then
    raise exception 'Diga primeiro de qual supervisor da planilha este acesso e.'
      using errcode = 'P0002';
  end if;

  select id, codigo into v_id, v_cod from equipe
   where base_id = v_base and supervisor_id = p_usuario
     and codigo like 'SUP-%' limit 1;
  if v_id is not null then
    return jsonb_build_object('equipe_id', v_id, 'codigo', v_cod,
                              'nome', v_nome, 'ja_existia', true);
  end if;

  -- "SUPERVISOR - JORGE SUSSUARANA" -> SUP-JORGE. `lower()` antes de
  -- tudo porque norm_txt devolve MAIUSCULO.
  v_raiz := upper(regexp_replace(
              regexp_replace(lower(norm_txt(v_nome)), '^supervisor[^a-z0-9]*', ''),
              '[^a-z0-9]+.*$', ''));
  if v_raiz = '' then v_raiz := 'SUP'; end if;
  v_cod := 'SUP-' || v_raiz;

  -- Dois supervisores com o mesmo primeiro nome nao podem colidir.
  while exists (select 1 from equipe where base_id = v_base and codigo = v_cod) loop
    i := i + 1;
    v_cod := 'SUP-' || v_raiz || i::text;
  end loop;

  insert into equipe (empresa_id, base_id, codigo, nome,
                      supervisor_nome, supervisor_id, ativo)
  values (minha_empresa(), v_base, v_cod, v_nome, v_nome, p_usuario, true)
  returning id into v_id;

  return jsonb_build_object('equipe_id', v_id, 'codigo', v_cod,
                            'nome', v_nome, 'ja_existia', false);
end;
$function$;

revoke all on function public.criar_equipe_do_supervisor(uuid) from public, anon;
grant execute on function public.criar_equipe_do_supervisor(uuid) to authenticated;

notify pgrst, 'reload schema';
