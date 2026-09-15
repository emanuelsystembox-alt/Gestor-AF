-- ============================================================
-- 078 · A jornada acha o dono, e o catálogo não perde tipo
--
-- > "refeição, na base, é bom entrar no banco, pra gente saber de fato
-- >  por que o técnico está parado [...] porém não pode contar como um
-- >  contrato que soma na produtividade [...] e os status devem subir
-- >  tanto na visão da equipe como na rota do dia" — Emanuel, 15/09
--
-- ┌─ o que JÁ estava certo, e não mexo ───────────────────────────────┐
-- │ Jornada já entra: `Na Base` e `Refeicao` estão no catálogo com    │
-- │ `natureza = 'JORNADA'`, e toda conta de produtividade já as        │
-- │ exclui. Suspensa já não entra (051). O que faltava era ATRIBUIÇÃO. │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ o defeito: o TOA não manda o login na jornada ───────────────────┐
-- │ Medido na planilha de 15/09 e no banco: as 6 linhas de jornada     │
-- │ (3 `Na Base` + 3 `Refeicao`) vêm com "Login do Técnico" VAZIO —    │
-- │ e a `Refeicao` vem também sem "Concluiu Atividade". Sem login,     │
-- │ `equipe_do_contrato` devolve nulo (e está certo: D-070 conta o     │
-- │ estrago de `norm_txt(NULL)` rotear jornada para uma equipe         │
-- │ qualquer). Resultado: 6 de 29 atividades sem equipe e sem técnico, │
-- │ invisíveis em Equipes e na Rota.                                   │
-- │                                                                    │
-- │ Mas o TOA MANDA o "ID do Recurso" em TODAS as linhas — conferido:  │
-- │ 29 de 29. E as linhas produtivas do mesmo técnico trazem login E   │
-- │ recurso juntos:                                                    │
-- │                                                                    │
-- │      35996 → Z384041      50399 → Z515564      32950 → Z359048     │
-- │                                                                    │
-- │ Cada recurso casa com EXATAMENTE um login. Isso não é dedução      │
-- │ nossa: é um de/para que a própria fonte emite, no mesmo arquivo.   │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ por que isto NÃO fere o D-088 ───────────────────────────────────┐
-- │ O D-088 proíbe deduzir a EQUIPE a partir da matrícula: "a          │
-- │ matrícula diz de quem é o login; não diz de qual equipe ele é —    │
-- │ são perguntas diferentes".                                         │
-- │                                                                    │
-- │ Aqui a corrente é outra, e para em cadastro:                       │
-- │                                                                    │
-- │   ID do Recurso ──(o TOA diz)──▶ login ──(o CADASTRO diz)──▶ equipe│
-- │                                                                    │
-- │ O primeiro elo é a fonte falando; o segundo continua sendo         │
-- │ `equipe_do_contrato`, intocada — login não cadastrado cai no       │
-- │ abrigo "Sem login definido", igual a contrato. Nenhum privilégio   │
-- │ novo, nenhuma equipe deduzida.                                     │
-- │                                                                    │
-- │ O D-088 dizia "Sem login (jornada) → não vai para lugar nenhum".   │
-- │ Passa a ser: "sem login E sem recurso conhecido". Ver D-149.       │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ o segundo defeito: o catálogo perdia tipo ───────────────────────┐
-- │ 9 das 29 linhas (31%) entraram com `tipo_atividade_id` NULO, porque│
-- │ seis tipos não estavam no catálogo: Desconexao Opcao, Desconexao   │
-- │ Inad, Troca de Equipamento Streaming, Refazer Instalacao, Retirada │
-- │ Equipamento, Retirar Ponto. Sem tipo não há `natureza`, e todo     │
-- │ lugar que lê `coalesce(ta.natureza,'PRODUTIVA')` estava assumindo  │
-- │ produtiva NO ESCURO — e o nome do serviço sumia da tela.           │
-- │                                                                    │
-- │ A 070 já fez isto para a ÁREA DE TRABALHO. Mesmo remédio, mesma    │
-- │ forma: o catálogo aprende com a planilha, que é a fonte.           │
-- │                                                                    │
-- │ Escolha do Emanuel entre três: tipo novo entra como PRODUTIVA e    │
-- │ fica MARCADO (`conferir`) até alguém confirmar. Nenhuma atividade  │
-- │ se perde; e o que foi adivinhado fica escrito na tela, em vez de   │
-- │ virar um `coalesce` calado. Se um dia vier jornada nova (um        │
-- │ "Treinamento"), ela entra contando como produção até ser           │
-- │ reclassificada — por isso a marca existe.                          │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ por que uma PASSADA DEPOIS, e não mexer no importador ───────────┐
-- │ `importar_toa_interno` tem 17.870 caracteres. Reescrevê-la inteira │
-- │ para enfiar duas regras no meio é arriscar o que funciona por      │
-- │ causa do que falta. A reconciliação vira função própria, chamada   │
-- │ pela `importar_toa` logo depois — mesma transação, então ou entra  │
-- │ tudo ou não entra nada.                                            │
-- │                                                                    │
-- │ E ela roda DEPOIS da inserção de propósito: numa importação a      │
-- │ linha de Refeição pode vir ANTES da linha produtiva que ensina o   │
-- │ login daquele recurso. Resolver linha a linha erraria a primeira.  │
-- └───────────────────────────────────────────────────────────────────┘
-- ============================================================

-- ------------------------------------------------------------------
-- A. O tipo que a importação criou sozinha fica MARCADO
-- ------------------------------------------------------------------
alter table tipo_atividade
  add column if not exists conferir boolean not null default false;

comment on column tipo_atividade.conferir is
  'Criado pela importação com natureza ADIVINHADA (PRODUTIVA). '
  'Fica marcado até alguém confirmar em Configurações. Ver D-149.';


-- ------------------------------------------------------------------
-- B. O de/para que o TOA emite: recurso → login
-- ------------------------------------------------------------------
create table if not exists toa_recurso (
  id          uuid primary key default gen_random_uuid(),
  base_id     uuid not null references base(id) on delete cascade,
  recurso_id  text not null,
  login_toa   text not null,
  primeira_vez date not null,
  ultima_vez   date not null,
  vezes        integer not null default 1,
  criado_em   timestamptz not null default now(),
  empresa_id  uuid references empresa(id),
  unique (base_id, recurso_id)
);

comment on table toa_recurso is
  'O de/para "ID do Recurso" → "Login do Técnico" que o TOA emite nas '
  'próprias linhas produtivas. NÃO é cadastro nosso e NÃO decide equipe: '
  'serve só para descobrir de quem é a linha de jornada, que o TOA manda '
  'sem login. A equipe continua saindo de `equipe_do_contrato`. Ver D-149.';

alter table toa_recurso enable row level security;

-- Leitura para a empresa; escrita só ADMIN. A importação é
-- SECURITY DEFINER e não depende destas policies.
-- `(select f())` resolve uma vez por consulta, não por linha (D-118).
drop policy if exists toa_recurso_leitura on toa_recurso;
create policy toa_recurso_leitura on toa_recurso for select
  using (empresa_id is null or empresa_id = (select minha_empresa()));

drop policy if exists toa_recurso_admin on toa_recurso;
create policy toa_recurso_admin on toa_recurso for all
  using (empresa_id = (select minha_empresa()) and (select tem_papel('ADMIN')))
  with check (empresa_id = (select minha_empresa()) and (select tem_papel('ADMIN')));

grant select on toa_recurso to authenticated;
revoke all on toa_recurso from anon;


-- ------------------------------------------------------------------
-- C. De quem é este recurso?
-- ------------------------------------------------------------------
create or replace function public.login_do_recurso(p_base uuid, p_recurso text)
returns text
language sql
stable
set search_path to 'public'
as $function$
  -- nullif+btrim antes de comparar: `norm_txt(NULL)` devolve STRING
  -- VAZIA, e recurso nulo casaria com o primeiro de recurso vazio --
  -- exatamente o defeito que o D-070 conta.
  select case
    when nullif(btrim(coalesce(p_recurso, '')), '') is null then null
    else (select r.login_toa from toa_recurso r
           where r.base_id = p_base
             and norm_txt(r.recurso_id) = norm_txt(p_recurso)
           limit 1)
  end;
$function$;

revoke all on function public.login_do_recurso(uuid, text) from public, anon;
grant execute on function public.login_do_recurso(uuid, text) to authenticated;


-- ------------------------------------------------------------------
-- D. A reconciliação: roda depois da importação, na mesma transação
-- ------------------------------------------------------------------
create or replace function public.reconciliar_importacao(p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_base    uuid;
  v_empresa uuid;
  n_recurso int := 0;
  n_tipo    int := 0;
  n_ligado  int := 0;
  n_jornada int := 0;
begin
  select i.base_id into v_base from importacao i where i.id = p_importacao_id;
  if v_base is null then
    return jsonb_build_object('erro', 'importacao sem base');
  end if;
  select b.empresa_id into v_empresa from base b where b.id = v_base;

  -- 1. APRENDE recurso → login, das linhas que trazem os dois.
  --    `distinct on` com `count` decrescente: se um recurso aparecer
  --    com dois logins no mesmo arquivo, vence o mais frequente e o
  --    fato fica registrado em `vezes` -- em vez de a linha sorteada
  --    pela ordem de leitura decidir.
  with candidatos as (
    select nullif(btrim(l.dados->>'ID do Recurso'), '')     as recurso,
           nullif(btrim(l.dados->>'Login do Técnico'), '')  as login,
           coalesce(j_data(l.dados, 'Data'), current_date)  as dia
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

  -- 2. O CATÁLOGO APRENDE o tipo de atividade que não conhecia.
  --    PRODUTIVA e `conferir` -- a natureza é adivinhada, e adivinhação
  --    que não se declara vira fato falso (D-149).
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

  -- 3. LIGA as visitas que entraram sem tipo (as desta importação e as
  --    que ficaram para trás -- o tipo agora existe).
  update visita v
     set tipo_atividade_id = t.id
    from tipo_atividade t
   where v.tipo_atividade_id is null
     and v.base_id = v_base
     and v.excluido_em is null
     and nullif(btrim(coalesce(v.dados_origem->>'Tipo de Atividade__2','')),'') is not null
     and norm_txt(t.nome) = norm_txt(v.dados_origem->>'Tipo de Atividade__2');
  get diagnostics n_ligado = row_count;

  -- 4. A JORNADA ACHA O DONO.
  --    Só onde o login veio vazio: linha com login segue o caminho de
  --    sempre, e este passo não pode sobrescrever o que o importador
  --    já decidiu. `rota_fixada_em` é respeitada (066): rota decidida
  --    por gente não é remanejada por importação.
  update visita v
     set equipe_id = coalesce(v.equipe_id,
                              equipe_do_contrato(v.base_id, x.login, v.data_agendada)),
         tecnico_responsavel_id = coalesce(v.tecnico_responsavel_id, x.tecnico),
         atualizado_em = now()
    from (
      select vi.id,
             login_do_recurso(vi.base_id, vi.dados_origem->>'ID do Recurso') as login,
             (select t.id from tecnico t
               where t.base_id = vi.base_id
                 and norm_txt(t.matricula) =
                     norm_txt(login_do_recurso(vi.base_id,
                                               vi.dados_origem->>'ID do Recurso'))
               limit 1) as tecnico
        from visita vi
       where vi.base_id = v_base
         and vi.excluido_em is null
         and vi.rota_fixada_em is null
         and nullif(btrim(coalesce(vi.dados_origem->>'Login do Técnico','')),'') is null
         and (vi.equipe_id is null or vi.tecnico_responsavel_id is null)
    ) x
   where v.id = x.id
     and x.login is not null;
  get diagnostics n_jornada = row_count;

  return jsonb_build_object(
    'recursos_aprendidos', n_recurso,
    'tipos_criados', n_tipo,
    'visitas_ligadas_ao_tipo', n_ligado,
    'jornada_atribuida', n_jornada);
end;
$function$;

revoke all on function public.reconciliar_importacao(uuid) from public, anon;
grant execute on function public.reconciliar_importacao(uuid) to authenticated;


-- ------------------------------------------------------------------
-- E. A importação passa a chamar a reconciliação
-- ------------------------------------------------------------------
create or replace function public.importar_toa(p_importacao_id uuid,
                                               p_simular boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r jsonb;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao para importar planilha.'
      using errcode = '42501';
  end if;

  r := importar_toa_interno(p_importacao_id, p_simular);

  -- Só chega aqui quando não é simulação: a prévia sai por exception.
  -- 078: o catálogo aprende e a jornada acha o dono, na mesma transação.
  return r
      || jsonb_build_object('reincidencias', detectar_reincidencia())
      || jsonb_build_object('reconciliacao', reconciliar_importacao(p_importacao_id));
end;
$function$;

revoke all on function public.importar_toa(uuid, boolean) from public, anon;
grant execute on function public.importar_toa(uuid, boolean) to authenticated;


-- ------------------------------------------------------------------
-- F. O que já está no banco também se conserta
-- ------------------------------------------------------------------
do $$
-- `n` sozinho colide com a coluna `n` das CTEs abaixo: o plpgsql
-- resolve `count(*) as n` como a VARIAVEL e estoura "column reference n
-- is ambiguous". Mesma familia da colisao de alias que o traps.md conta.
declare v_base uuid; v_empresa uuid; v_linhas int;
begin
  for v_base, v_empresa in select b.id, b.empresa_id from base b loop

    -- aprende de TODAS as visitas já importadas desta base
    with validos as (
      select nullif(btrim(v.dados_origem->>'ID do Recurso'), '')    as recurso,
             nullif(btrim(v.dados_origem->>'Login do Técnico'), '') as login,
             min(v.data_agendada) as de, max(v.data_agendada) as ate, count(*) as qtd
        from visita v
       where v.base_id = v_base and v.excluido_em is null
       group by 1, 2
    ),
    vencedor as (
      select distinct on (recurso) recurso, login, de, ate, qtd
        from validos where recurso is not null and login is not null
       order by recurso, qtd desc, login
    )
    insert into toa_recurso (base_id, recurso_id, login_toa,
                             primeira_vez, ultima_vez, vezes, empresa_id)
    select v_base, x.recurso, x.login, x.de, x.ate, x.qtd, v_empresa
      from vencedor x
    on conflict (base_id, recurso_id) do nothing;

    -- cria o tipo que faltava, marcado para conferir
    insert into tipo_atividade (nome, natureza, ativo, conferir, empresa_id)
    select distinct btrim(v.dados_origem->>'Tipo de Atividade__2'), 'PRODUTIVA',
           true, true, v_empresa
      from visita v
     where v.base_id = v_base and v.excluido_em is null
       and v.tipo_atividade_id is null
       and nullif(btrim(coalesce(v.dados_origem->>'Tipo de Atividade__2','')),'') is not null
       and not exists (
         select 1 from tipo_atividade t
          where norm_txt(t.nome) = norm_txt(v.dados_origem->>'Tipo de Atividade__2'))
    on conflict (nome) do nothing;

    update visita v
       set tipo_atividade_id = t.id
      from tipo_atividade t
     where v.tipo_atividade_id is null
       and v.base_id = v_base and v.excluido_em is null
       and nullif(btrim(coalesce(v.dados_origem->>'Tipo de Atividade__2','')),'') is not null
       and norm_txt(t.nome) = norm_txt(v.dados_origem->>'Tipo de Atividade__2');

    -- a jornada que já estava sem dono
    update visita v
       set equipe_id = coalesce(v.equipe_id,
                                equipe_do_contrato(v.base_id, x.login, v.data_agendada)),
           tecnico_responsavel_id = coalesce(v.tecnico_responsavel_id, x.tecnico)
      from (
        select vi.id,
               login_do_recurso(vi.base_id, vi.dados_origem->>'ID do Recurso') as login,
               (select t.id from tecnico t
                 where t.base_id = vi.base_id
                   and norm_txt(t.matricula) =
                       norm_txt(login_do_recurso(vi.base_id,
                                                 vi.dados_origem->>'ID do Recurso'))
                 limit 1) as tecnico
          from visita vi
         where vi.base_id = v_base and vi.excluido_em is null
           and vi.rota_fixada_em is null
           and nullif(btrim(coalesce(vi.dados_origem->>'Login do Técnico','')),'') is null
           and (vi.equipe_id is null or vi.tecnico_responsavel_id is null)
      ) x
     where v.id = x.id and x.login is not null;
    get diagnostics v_linhas = row_count;
    raise notice 'base %: % jornada(s) atribuida(s)', v_base, v_linhas;

  end loop;
end $$;

notify pgrst, 'reload schema';
