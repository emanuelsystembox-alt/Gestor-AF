-- ┌─ 119 · o bucket do contrato, para filtrar ──────────────────────────┐
-- │ > "é bom ter um filtro de bucket (...) é bom o usuario também ter   │
-- │ >  possibildiade de selecionar mais de um bucket" — Emanuel, 20/10  │
-- │                                                                    │
-- │ O bucket só existia na IMPORTAÇÃO (`importacao.bucket`, 103) — o   │
-- │ contrato não sabia de qual pasta do TOA veio. Agora sabe:          │
-- │ `visita.toa_bucket` = o bucket da ÚLTIMA importação que trouxe o   │
-- │ contrato. Carimbado na reconciliação (a 2ª chamada, D-181), no     │
-- │ mesmo UPDATE que já recalcula o TEC1 das visitas desta importação  │
-- │ — nenhuma linha a mais escrita, e nada a mais na 1ª chamada, que   │
-- │ já anda perto dos 8 s do `authenticated`.                          │
-- │                                                                    │
-- │ Por que não `visita.importacao_id`: ele só marca quem CRIOU o      │
-- │ contrato (traps.md). O conjunto certo é `importacao_linha`.        │
-- │ Contrato manual (AF-…) não tem bucket: fica nulo, "sem bucket".    │
-- └────────────────────────────────────────────────────────────────────┘

alter table visita add column if not exists toa_bucket text;

comment on column visita.toa_bucket is
  'Bucket do TOA da ultima importacao que trouxe o contrato (119). Nulo = manual / sem bucket.';

-- ── o que já existe: a última importação (com bucket) que viu cada contrato ──
-- Sem o gatilho que carimba `atualizado_em`: preencher a coluna não é
-- mudança no contrato, e "atualizado agora" em 1.112 contratos mentiria.
alter table visita disable trigger trg_visita_bloqueio;

update visita v
   set toa_bucket = x.bucket
  from (
    select distinct on (l.visita_id) l.visita_id, i.bucket
      from importacao_linha l
      join importacao i on i.id = l.importacao_id
     where l.visita_id is not null and i.bucket is not null
     order by l.visita_id, i.criado_em desc
  ) x
 where v.id = x.visita_id;

alter table visita enable trigger trg_visita_bloqueio;

-- ── daqui para frente: a reconciliação carimba ──
-- Igual à versão do banco (lida com pg_get_functiondef, não do arquivo —
-- traps.md), com o toa_bucket no último UPDATE.
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
  v_bucket  text;
  n_recurso int := 0;
  n_tipo    int := 0;
  n_ligado  int := 0;
  n_jornada int := 0;
  n_tec1    int := 0;
begin
  -- 104b: era executavel por qualquer authenticated, sem conferir nada.
  if auth.uid() is not null and not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('ROBO')) then
    raise exception 'Sem permissao para reconciliar importacao.' using errcode = '42501';
  end if;
  if auth.uid() is not null and not exists (
       select 1 from importacao i
        where i.id = p_importacao_id and i.base_id in (select bases_visiveis())) then
    raise exception 'Importacao fora da cidade ativa.' using errcode = '42501';
  end if;

  select i.base_id, coalesce(i.data_atuacao, hoje_local()), i.bucket
    into v_base, v_dia, v_bucket
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

  -- 109: tecnologia e migracao, lidas da linha do TOA (D-188). Antes do
  -- TEC1: o grupo da a tolerancia.
  update visita v
     set tecnologia = tecnologia_da_visita(v.id),
         tipo_servico_id = coalesce(grupo_da_visita(v.id), v.tipo_servico_id)
   where v.id in (select l.visita_id from importacao_linha l
                   where l.importacao_id = p_importacao_id
                     and l.visita_id is not null);

  -- 082: as visitas que ESTA importacao tocou. `importacao_linha.visita_id`
  -- e o conjunto exato; `visita.importacao_id` so marca quem CRIOU.
  update ordem_servico o set tec1 = tec1_da_os(o.id)
   where o.visita_id in (select l.visita_id from importacao_linha l
                          where l.importacao_id = p_importacao_id
                            and l.visita_id is not null);
  get diagnostics n_tec1 = row_count;

  -- 119: o bucket vai no mesmo UPDATE do TEC1 — nenhuma linha a mais.
  update visita v set tec1 = tec1_da_visita(v.id),
                      toa_bucket = coalesce(v_bucket, v.toa_bucket)
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

notify pgrst, 'reload schema';
