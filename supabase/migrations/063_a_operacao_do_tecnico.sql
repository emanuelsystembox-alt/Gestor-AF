-- ============================================================
-- 063 · A operação do técnico — qual cidade ele atende
--
-- > "Temos que ter agora o nome da operação que o técnico atua qual a
-- >  cidade […] isso tem que estar também na tela de cadastro […] é
-- >  importante saber de qual cidade ele atua." — Emanuel
--
-- A "operação" já existia: é a `base` (praça). As 18 linhas batem com o
-- anexo — Manaus - AM, Belém - PA, Brasília - DF, São Luís - MA… O que
-- faltava era a TELA perguntar. `tecnico.base_id` é NOT NULL, então
-- todo técnico sempre teve uma; só que ninguém escolhia, e
-- `cadastrar_tecnico_avulso` pegava `bases_visiveis() limit 1` — um
-- palpite silencioso, exatamente o que a D-088 proíbe.
--
-- Duas coisas aqui:
--
-- 1. A REGIÃO, que o anexo mostra como primeira coluna.
-- 2. A base como PARÂMETRO de `cadastrar_tecnico_avulso`.
--
-- ┌─ sobre a REGIÃO, e o que eu NÃO sei ─────────────────────────────┐
-- │ A região do anexo NÃO é a do IBGE. Pelo IBGE, TO é Norte e MA é   │
-- │ Nordeste; no anexo, Palmas/Araguaína/Gurupi/Paraíso (TO) são      │
-- │ CENTRO-OESTE e São Luís/Imperatriz/Caxias/Timon (MA) são NORTE.   │
-- │ É agrupamento comercial da operação, não geografia.               │
-- │                                                                   │
-- │ Então a regra saiu do DADO REAL — do próprio anexo, por UF:       │
-- │     AM, PA, MA → NORTE        DF, TO → CENTRO-OESTE               │
-- │                                                                   │
-- │ RO (Cacoal, Ji-Paraná, Vilhena) e PI (Teresina) NÃO aparecem no   │
-- │ anexo. Ficam com região NULA e a tela escreve "sem região         │
-- │ definida" — zero e desconhecido não são a mesma coisa (D-117).    │
-- │ Quando o Emanuel disser de que região são, é um update de duas    │
-- │ linhas.                                                           │
-- └───────────────────────────────────────────────────────────────────┘
-- ============================================================

alter table base add column if not exists regiao text;

comment on column base.regiao is
  'Regiao COMERCIAL da operacao (NORTE, CENTRO-OESTE), derivada do '
  'relatorio do Emanuel por UF. Nao e a regiao do IBGE: TO conta como '
  'CENTRO-OESTE e MA como NORTE. Nula = ainda nao definida (RO, PI).';

update base set regiao = 'NORTE'        where uf in ('AM', 'PA', 'MA') and regiao is null;
update base set regiao = 'CENTRO-OESTE' where uf in ('DF', 'TO')       and regiao is null;

-- ------------------------------------------------------------
-- `cadastrar_tecnico_avulso` passa a aceitar a OPERAÇÃO
-- ------------------------------------------------------------
-- A antiga é DERRUBADA em vez de conviver com a nova: duas assinaturas,
-- uma de 3 e outra de 4 parâmetros com default, deixam a chamada de 3
-- argumentos nomeados AMBÍGUA para o PostgREST — as duas casam. Já
-- mordeu neste banco com `baixar_os` (ver agent_docs/traps.md).
--
-- Os chamadores de 3 argumentos nomeados (Equipes → "Cadastrar" do
-- técnico órfão) continuam funcionando: só existe uma função, e o
-- quarto parâmetro tem default.
drop function if exists public.cadastrar_tecnico_avulso(text, text, uuid);

create function public.cadastrar_tecnico_avulso(
  p_matricula text,
  p_nome text,
  p_equipe_id uuid default null,
  p_base_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_emp uuid; v_base uuid; v_base_eq uuid; v_tec uuid; n int;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  v_emp := minha_empresa();

  -- A base da EQUIPE manda: equipe mora numa praça, e técnico de uma
  -- praça em equipe de outra é um cadastro que ninguem consegue ler.
  if p_equipe_id is not null then
    select base_id into v_base_eq from equipe
     where id = p_equipe_id and empresa_id = v_emp;
    if v_base_eq is null then
      raise exception 'Equipe nao encontrada nesta empresa.' using errcode = 'P0002';
    end if;
    if p_base_id is not null and p_base_id <> v_base_eq then
      raise exception
        'A operacao escolhida nao e a da equipe. Escolha uma equipe da mesma operacao.'
        using errcode = '23514';
    end if;
    v_base := v_base_eq;

  elsif p_base_id is not null then
    -- Operação dita pela tela: tem de ser da empresa e visível para
    -- quem cadastra. `bases_visiveis()` é a mesma porta do resto do RLS.
    select id into v_base from base
     where id = p_base_id and empresa_id = v_emp and id in (select bases_visiveis());
    if v_base is null then
      raise exception 'Operacao nao encontrada ou fora do seu acesso.' using errcode = 'P0002';
    end if;

  else
    -- Ninguém disse a operação e não há equipe para deduzir. Continua
    -- caindo na primeira base visível — mas isso agora é o caminho de
    -- exceção, não o normal: a tela de cadastro pergunta.
    select id into v_base from base
     where empresa_id = v_emp and id in (select bases_visiveis()) limit 1;
  end if;

  insert into tecnico (empresa_id, base_id, matricula, nome, equipe_id)
  values (v_emp, v_base, upper(btrim(p_matricula)),
          coalesce(nullif(btrim(p_nome), ''), upper(btrim(p_matricula))), p_equipe_id)
  on conflict (base_id, matricula) do update
    set nome = excluded.nome,
        equipe_id = coalesce(excluded.equipe_id, tecnico.equipe_id)
  returning id into v_tec;

  update visita v
     set tecnico_responsavel_id = v_tec,
         equipe_id = coalesce(p_equipe_id, v.equipe_id)
   where v.base_id = v_base
     and v.tecnico_responsavel_id is null
     and norm_txt(v.dados_origem ->> 'Login do Técnico') = norm_txt(p_matricula);
  get diagnostics n = row_count;

  return jsonb_build_object(
    'tecnico_id', v_tec, 'visitas_religadas', n,
    'base', (select nome from base where id = v_base));
end;
$function$;

-- Funcao criada DO ZERO nasce com a ACL aberta ao anon (o Supabase
-- concede EXECUTE a todo mundo no schema public). Ver security.md — foi
-- assim que a 059 escapou e precisou da 061.
revoke all on function public.cadastrar_tecnico_avulso(text, text, uuid, uuid)
  from public, anon;
grant execute on function public.cadastrar_tecnico_avulso(text, text, uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
