-- ┌─ 104 · a importação do dia inteiro sem estourar os 8 s ────────────┐
-- │ > "fui importar de forma comum e deu erro" — Emanuel, 17/10        │
-- │ >  ("canceling statement due to statement timeout")                │
-- │                                                                    │
-- │ O papel `authenticated` tem statement_timeout de 8 s. A rota de    │
-- │ Manaus de 17/10 (340 linhas, 337 contratos novos, 452 O.S.) levava │
-- │ 4,2 a 6,0 s medida como authenticated — e no clique, com rede e    │
-- │ cache frio, passou dos 8 s e voltou tudo.                          │
-- │                                                                    │
-- │ Medido com pg_stat_xact_user_functions (17/10): norm_txt chamada   │
-- │ 258.260 vezes (1,7 s). Quase tudo vinha de três lugares que        │
-- │ normalizavam o MESMO texto de novo a cada linha comparada:         │
-- │                                                                    │
-- │  1. reconciliar_importacao, na jornada: para achar o técnico,      │
-- │     chamava login_do_recurso() DE NOVO para cada técnico do        │
-- │     subselect — 3.056 chamadas para 102 visitas;                   │
-- │  2. login_do_recurso: varre toa_recurso normalizando cada linha    │
-- │     (51 recursos aprendidos nesta mesma importação);               │
-- │  3. equipe_do_login: idem, em equipe_login_toa.                    │
-- │                                                                    │
-- │ NÃO foi a 103: bases_visiveis() não é chamada nenhuma vez na       │
-- │ importação (mesma contagem). A diferença 5,6 s × 4,5 s entre a     │
-- │ versão nova e a antiga dela era oscilação.                         │
-- │                                                                    │
-- │ O conserto não muda resultado nenhum: o login sai UMA vez por      │
-- │ visita (offset 0 impede o planejador de copiar a expressão de      │
-- │ volta), o tipo de atividade é normalizado uma vez por tipo, e as   │
-- │ três buscas por texto normalizado ganham índice de expressão       │
-- │ (norm_txt é IMMUTABLE). Conferido por md5 das visitas e das O.S.   │
-- │ antes e depois. Ver D-181.                                         │
-- └────────────────────────────────────────────────────────────────────┘

create index if not exists tecnico_base_matricula_norm_idx
  on tecnico (base_id, norm_txt(matricula));
create index if not exists toa_recurso_base_recurso_norm_idx
  on toa_recurso (base_id, norm_txt(recurso_id));
create index if not exists equipe_login_toa_login_norm_idx
  on equipe_login_toa (norm_txt(login_toa));

-- A versão viva (pg_get_functiondef, 17/10), com dois trechos reescritos.
create or replace function public.reconciliar_importacao(p_importacao_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_base    uuid;
  v_empresa uuid;
  v_dia     date;
  n_recurso int := 0;
  n_tipo    int := 0;
  n_ligado  int := 0;
  n_jornada int := 0;
  n_tec1    int := 0;
begin
  select i.base_id, coalesce(i.data_atuacao, hoje_local())
    into v_base, v_dia
    from importacao i where i.id = p_importacao_id;
  if v_base is null then
    return jsonb_build_object('erro', 'importacao sem base');
  end if;
  select b.empresa_id into v_empresa from base b where b.id = v_base;

  with candidatos as (
    select nullif(btrim(l.dados->>'ID do Recurso'), '')     as recurso,
           nullif(btrim(l.dados->>'Login do Técnico'), '')  as login,
           v_dia                                            as dia
      from importacao_linha l
     where l.importacao_id = p_importacao_id
  ),
  validos as (
    select recurso, login, min(dia) as de, max(dia) as ate, count(*) as qtd
      from candidatos
     where recurso is not null and login is not null
     group by 1, 2
  ),
  vencedor as (
    select distinct on (recurso) recurso, login, de, ate, qtd
      from validos order by recurso, qtd desc, login
  )
  insert into toa_recurso (base_id, recurso_id, login_toa,
                           primeira_vez, ultima_vez, vezes, empresa_id)
  select v_base, x.recurso, x.login, x.de, x.ate, x.qtd, v_empresa
    from vencedor x
  on conflict (base_id, recurso_id) do update
    set login_toa    = excluded.login_toa,
        ultima_vez   = greatest(toa_recurso.ultima_vez, excluded.ultima_vez),
        primeira_vez = least(toa_recurso.primeira_vez, excluded.primeira_vez),
        vezes        = toa_recurso.vezes + excluded.vezes;
  get diagnostics n_recurso = row_count;

  with novos as (
    select distinct btrim(l.dados->>'Tipo de Atividade__2') as nome
      from importacao_linha l
     where l.importacao_id = p_importacao_id
       and nullif(btrim(coalesce(l.dados->>'Tipo de Atividade__2','')),'') is not null
  )
  insert into tipo_atividade (nome, natureza, ativo, conferir, empresa_id)
  select x.nome, 'PRODUTIVA', true, true, v_empresa
    from novos x
   where not exists (select 1 from tipo_atividade t
                      where norm_txt(t.nome) = norm_txt(x.nome))
  on conflict (nome) do nothing;
  get diagnostics n_tipo = row_count;

  -- 104: cada tipo e cada visita normalizados UMA vez, não um par a par.
  with tipos as materialized (
    select t.id, norm_txt(t.nome) as chave from tipo_atividade t
  ),
  alvo as materialized (
    select v.id, norm_txt(v.dados_origem->>'Tipo de Atividade__2') as chave
      from visita v
     where v.tipo_atividade_id is null
       and v.base_id = v_base
       and v.excluido_em is null
       and nullif(btrim(coalesce(v.dados_origem->>'Tipo de Atividade__2','')),'') is not null
  )
  update visita v
     set tipo_atividade_id = t.id
    from alvo a join tipos t on t.chave = a.chave
   where v.id = a.id;
  get diagnostics n_ligado = row_count;

  -- 104: o login do recurso sai UMA vez por visita. Antes, o subselect do
  -- técnico chamava login_do_recurso() de novo para cada técnico da base.
  -- `offset 0` é a cerca: sem ela o planejador achata o lateral e copia a
  -- chamada de volta para cada lugar onde `r.login` aparece.
  update visita v
     set equipe_id = coalesce(v.equipe_id,
                              equipe_do_contrato(v.base_id, x.login, v.data_agendada)),
         tecnico_responsavel_id = coalesce(v.tecnico_responsavel_id, x.tecnico),
         atualizado_em = now()
    from (
      select vi.id, r.login,
             (select t.id from tecnico t
               where t.base_id = vi.base_id
                 and norm_txt(t.matricula) = r.login_norm
               limit 1) as tecnico
        from visita vi
        cross join lateral (
          select l.login, norm_txt(l.login) as login_norm
            from (select login_do_recurso(vi.base_id, vi.dados_origem->>'ID do Recurso') as login
                  offset 0) l
          offset 0
        ) r
       where vi.base_id = v_base
         and vi.excluido_em is null
         and vi.rota_fixada_em is null
         and nullif(btrim(coalesce(vi.dados_origem->>'Login do Técnico','')),'') is null
         and (vi.equipe_id is null or vi.tecnico_responsavel_id is null)
    ) x
   where v.id = x.id
     and x.login is not null;
  get diagnostics n_jornada = row_count;

  -- 082: as visitas que ESTA importacao tocou. `importacao_linha.visita_id`
  -- e o conjunto exato; `visita.importacao_id` so marca quem CRIOU.
  update ordem_servico o set tec1 = tec1_da_os(o.id)
   where o.visita_id in (select l.visita_id from importacao_linha l
                          where l.importacao_id = p_importacao_id
                            and l.visita_id is not null);
  get diagnostics n_tec1 = row_count;

  update visita v set tec1 = tec1_da_visita(v.id)
   where v.id in (select l.visita_id from importacao_linha l
                   where l.importacao_id = p_importacao_id
                     and l.visita_id is not null);

  return jsonb_build_object(
    'recursos_aprendidos', n_recurso,
    'tipos_criados', n_tipo,
    'visitas_ligadas_ao_tipo', n_ligado,
    'jornada_atribuida', n_jornada,
    'tec1_de_os', n_tec1);
end;
$function$;

revoke all on function public.reconciliar_importacao(uuid) from public, anon;

analyze tecnico;
analyze toa_recurso;
analyze equipe_login_toa;

-- ┌─ 104b · a reconciliação vira a SEGUNDA chamada, com os seus 8 s ───┐
-- │ Mesmo enxuta, a importação de 340 linhas é 4–6 s numa chamada só,  │
-- │ e Manaus já teve 470 visitas num dia. Separada, cada parte tem o   │
-- │ seu orçamento: importar_toa cria e atualiza os contratos (~3 s);  │
-- │ a tela chama reconciliar_importacao logo depois (~1 s) — jornada  │
-- │ sem login, tipo de atividade e TEC1. Se a segunda falhar, os      │
-- │ contratos já entraram e ela pode rodar de novo (é idempotente).   │
-- │                                                                    │
-- │ DEFEITO ACHADO NO CAMINHO: reconciliar_importacao era executável   │
-- │ por qualquer `authenticated` e não conferia papel nenhum — um      │
-- │ técnico podia chamá-la. Agora confere o mesmo que importar_toa.    │
-- └────────────────────────────────────────────────────────────────────┘
do $$
declare d text;
begin
  -- importar_toa: a reconciliação sai daqui (vai para a tela).
  d := pg_get_functiondef('public.importar_toa'::regproc);
  if position('reconciliar_importacao(p_importacao_id)' in d) = 0 then
    raise exception 'importar_toa mudou: nao achei a chamada da reconciliacao';
  end if;
  d := replace(d,
    E'  return r\n      || jsonb_build_object(''reincidencias'', detectar_reincidencia())\n      || jsonb_build_object(''reconciliacao'', reconciliar_importacao(p_importacao_id));',
    E'  -- 104b: a reconciliacao e a segunda chamada da tela (orcamento proprio).\n  return r\n      || jsonb_build_object(''reincidencias'', detectar_reincidencia())\n      || jsonb_build_object(''reconciliar'', true);');
  if position('reconciliar_importacao(p_importacao_id)' in d) > 0 then
    raise exception 'importar_toa: a troca do retorno nao pegou';
  end if;
  execute d;

  -- reconciliar_importacao: a mesma permissao da importacao.
  d := pg_get_functiondef('public.reconciliar_importacao'::regproc);
  d := replace(d,
    E'begin\n  select i.base_id, coalesce(i.data_atuacao, hoje_local())',
    E'begin\n  -- 104b: era executavel por qualquer authenticated, sem conferir nada.\n  if auth.uid() is not null and not (eh_gestor() or tem_papel(''CONTROLADOR'')) then\n    raise exception ''Sem permissao para reconciliar importacao.'' using errcode = ''42501'';\n  end if;\n  if auth.uid() is not null and not exists (\n       select 1 from importacao i\n        where i.id = p_importacao_id and i.base_id in (select bases_visiveis())) then\n    raise exception ''Importacao fora da cidade ativa.'' using errcode = ''42501'';\n  end if;\n\n  select i.base_id, coalesce(i.data_atuacao, hoje_local())');
  if position('Sem permissao para reconciliar' in d) = 0 then
    raise exception 'reconciliar_importacao: a checagem nao entrou';
  end if;
  execute d;
end $$;

revoke all on function public.importar_toa(uuid, boolean)     from public, anon;
revoke all on function public.reconciliar_importacao(uuid)    from public, anon;
grant execute on function public.importar_toa(uuid, boolean)  to authenticated;
grant execute on function public.reconciliar_importacao(uuid) to authenticated;
