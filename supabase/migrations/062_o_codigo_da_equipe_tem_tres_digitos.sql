-- ============================================================
-- 062 · O código da equipe tem três dígitos, sempre
--
-- > "eu vi que nós mostramos equipe tanto como 01 ou 45, e 001 -
-- >  EQUIPE, ou 045 - EQUIPE. O padrão que eu quero é esse:
-- >  '001 - EQUIPE'" — Emanuel
--
-- Na TELA isso é `equipeRotulo()` (app/src/lib/formato.ts). Aqui é o
-- outro lado do mesmo problema, e o pior dos dois:
--
-- `importar_equipes` tira o código de `split_part(nome, '-', 1)`. A
-- planilha que escrever "45 - EQUIPE" cria a equipe de código `45`; a
-- que escrever "045 - EQUIPE" cria a de código `045`. E como a chave é
-- `unique (base_id, codigo)`, as duas convivem como **equipes
-- diferentes** — mesma equipe de campo, dois cadastros, contrato
-- dividido entre eles e produtividade pela metade em cada um.
--
-- O zero à esquerda deixa de ser enfeite e vira identidade. Então o
-- código numérico é normalizado na ENTRADA, que é onde ainda dá para
-- evitar o estrago.
--
-- Código que não é número — a equipe abrigo `SEM-LOGIN` — passa
-- intacto.
--
-- CONFERIDO ANTES: as 107 equipes de hoje já estão todas em três
-- dígitos (`select count(*) from equipe where codigo !~ '^[0-9]{3}$'`
-- devolve só as 18 linhas de `SEM-LOGIN`, uma por base). Por isso esta
-- migration NÃO reescreve dado existente: não há o que reescrever, e
-- um `update` que renumera código de equipe sem ninguém precisar é
-- risco sem ganho.
-- ============================================================

create or replace function public.importar_equipes(p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r jsonb; v_emp uuid; v_base uuid; v_area uuid; v_eq uuid;
  cod text; nome_eq text; login text; nome_tec text; sup text; area_txt text;
  n_eq int := 0; n_tec int := 0; n_erro int := 0; n_ign int := 0;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao para importar cadastro.' using errcode = '42501';
  end if;
  v_emp := minha_empresa();
  select id into v_base from base where empresa_id = v_emp and codigo = 'MAN';

  for r in select * from jsonb_array_elements(p_linhas) loop
    begin
      login    := nullif(btrim(r ->> 'LOGIN'), '');
      nome_tec := nullif(btrim(r ->> 'NOME DO TÉCNICO'), '');
      nome_eq  := nullif(btrim(r ->> 'EQUIPE'), '');
      sup      := nullif(btrim(r ->> 'SUPERVISOR'), '');
      area_txt := nullif(btrim(r ->> 'ÁREA'), '');
      if login is null or nome_eq is null then n_ign := n_ign + 1; continue; end if;

      cod := btrim(split_part(nome_eq, '-', 1));
      if cod = '' then cod := nome_eq; end if;

      -- ┌─ 062 ────────────────────────────────────────────────────┐
      -- │ A UNICA linha nova desta migration. "45" e "045" sao a    │
      -- │ mesma equipe de campo; sem isto viram dois cadastros, e   │
      -- │ nada no sistema depois consegue dizer que eram uma so.    │
      -- └───────────────────────────────────────────────────────────┘
      if cod ~ '^[0-9]+$' then cod := lpad(cod, 3, '0'); end if;

      select id into v_area from area_trabalho
      where (base_id = v_base or base_id is null)
        and (apelido = upper(area_txt) or codigo = upper(area_txt)) limit 1;

      insert into equipe (empresa_id, base_id, codigo, nome, area_id, supervisor_nome)
      values (v_emp, v_base, cod, nome_eq, v_area, sup)
      on conflict (base_id, codigo) do update
        set nome = excluded.nome,
            area_id = coalesce(excluded.area_id, equipe.area_id),
            supervisor_nome = coalesce(excluded.supervisor_nome, equipe.supervisor_nome)
      returning id into v_eq;
      if v_eq is null then
        select id into v_eq from equipe where base_id = v_base and codigo = cod;
      end if;
      n_eq := n_eq + 1;

      insert into tecnico (empresa_id, base_id, matricula, nome, equipe_id)
      values (v_emp, v_base, upper(login), coalesce(nome_tec, upper(login)), v_eq)
      on conflict (base_id, matricula) do update
        set nome = excluded.nome, equipe_id = excluded.equipe_id;
      n_tec := n_tec + 1;
    exception when others then n_erro := n_erro + 1;
    end;
  end loop;

  return jsonb_build_object(
    'equipes', (select count(*) from equipe where empresa_id = v_emp),
    'tecnicos', (select count(*) from tecnico where empresa_id = v_emp),
    'linhas_equipe', n_eq, 'linhas_tecnico', n_tec,
    'ignoradas', n_ign, 'erros', n_erro);
end;
$function$;

-- `create or replace` preserva a ACL, mas conferir custa nada e a
-- armadilha ja mordeu duas vezes neste repositorio (059 → 061).
revoke all on function public.importar_equipes(jsonb) from public, anon;
grant execute on function public.importar_equipes(jsonb) to authenticated;

notify pgrst, 'reload schema';
