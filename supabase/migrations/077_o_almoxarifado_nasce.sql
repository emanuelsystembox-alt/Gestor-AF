-- ============================================================
-- 077 · O almoxarifado nasce: a carga do Atlas vira posição
--
-- > "imagina você ser o chefe do almoxarifado e precisa controlar
-- >  miscelâneas e equipamentos, tudo isso precisa estar registrado em
-- >  nosso sistema […] pense no almoxarifado como um módulo" — Emanuel
--
-- FASE 1, escolhida por ele entre três: **importar a carga e mostrar a
-- posição**. Sem movimentação ainda — entrega e devolutiva ao técnico
-- (romaneio) e miscelânea por saldo vêm depois, e o desenho abaixo já
-- deixa lugar para as duas.
--
-- ┌─ O QUE O DADO REAL DISSE ────────────────────────────────────────┐
-- │ `CARGA AFLINE.xlsx`: 15.603 equipamentos, TODOS no local          │
-- │ "ADUARTE ALBUQUERQUE ME", operação MANAUS, classificação          │
-- │ COMODATO. Número de série único em 15.603 de 15.603 — é a chave   │
-- │ natural, e é por ela que a importação reconhece o que já existe.  │
-- │                                                                   │
-- │ Estado (do Atlas, 9 valores):                                     │
-- │     PERDA                 7.629   48,9%                           │
-- │     INICIALIZADO          5.070   32,5%                           │
-- │     SUSPEITO              1.033    6,6%                           │
-- │     TRANSITO REVERSA        742    4,8%                           │
-- │     SUCATA                  676    4,3%                           │
-- │     ANALISE DE INVENTARIO   415    2,7%                           │
-- │     GARE / COM DEFEITO / INUTILIZADO  38   0,2%                   │
-- │                                                                   │
-- │ Tipo: EMTA, SMART CARD, DECODER DIGITAL, TELEFONICO, ROTEADOR     │
-- │ WI-FI, CABLE MODEM, DECODER DIGITAL DAC, HARD DISK.               │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ DOIS EIXOS, E ELES DIVERGEM — escolha do Emanuel ───────────────┐
-- │ É a mesma gramática das DUAS BAIXAS (D-042):                      │
-- │                                                                   │
-- │   `estado_atlas`  o que a CLARO diz. Vem da planilha e NÃO se     │
-- │                   edita aqui. PERDA é afirmação dela.             │
-- │   `posse`         onde a peça está para NÓS: no almoxarifado, com │
-- │                   o técnico, com o assinante, em trânsito,        │
-- │                   devolvida. Isso é nosso, e ninguém mais sabe.   │
-- │                                                                   │
-- │ A diferença entre os dois é o produto do módulo: 7.629 peças que  │
-- │ a CLARO chama de PERDA e que talvez estejam na prateleira.        │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ A IMPORTAÇÃO NÃO INVENTA POSSE ─────────────────────────────────┐
-- │ O Atlas sabe que a peça é responsabilidade da AFLINE. Ele NÃO     │
-- │ sabe se ela está na prateleira ou na van do técnico. Então a      │
-- │ importação deixa `posse` NULA — desconhecida — em vez de carimbar │
-- │ "no almoxarifado" em 15.603 peças. Zero e desconhecido não são a  │
-- │ mesma coisa (D-117), e aqui a diferença é o inventário inteiro.   │
-- │                                                                   │
-- │ A única posse que a planilha AFIRMA é a do assinante: quando o    │
-- │ Atlas diz `Tipo Local = ASSINANTE` (formato da consulta), a peça  │
-- │ está com o cliente, e isso é dado, não dedução.                   │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ dois formatos de planilha, como no TOA (D-091) ─────────────────┐
-- │ `CARGA AFLINE` e `CONSULTA ATLAS` têm cabeçalhos diferentes e     │
-- │ datas em formatos diferentes ("18/06/2021 14:50:27" e             │
-- │ "9/12/26 17:19" — este AMBÍGUO entre 9/dez e 12/set). Quem        │
-- │ normaliza é o leitor no front (`lib/estoque.ts`); aqui chega um   │
-- │ formato só. E `dados_origem` guarda a linha crua inteira: o que   │
-- │ não soubermos ler hoje não se perde.                              │
-- └───────────────────────────────────────────────────────────────────┘
-- ============================================================

-- ------------------------------------------------------------
-- A · Onde a peça está, para NÓS
-- ------------------------------------------------------------
create table if not exists estoque_posse (
  codigo      text primary key,
  rotulo      text not null,
  cor         text,
  ordem       smallint not null default 99,
  -- Posse em que a peça está com alguém de fora da nossa mão: serve
  -- para a tela separar "o que eu tenho" de "o que eu emprestei".
  fora        boolean not null default false,
  ativo       boolean not null default true
);

insert into estoque_posse (codigo, rotulo, cor, ordem, fora) values
  ('NO_ALMOXARIFADO', 'No almoxarifado', '#16a34a', 1, false),
  ('COM_TECNICO',     'Com o técnico',   '#3b82f6', 2, true),
  ('COM_ASSINANTE',   'Com o assinante', '#8b5cf6', 3, true),
  ('EM_TRANSITO',     'Em trânsito',     '#f59e0b', 4, true),
  ('DEVOLVIDO_CLARO', 'Devolvido à CLARO', '#64748b', 5, true)
on conflict (codigo) do nothing;

comment on table estoque_posse is
  'Onde a peca esta para a AFLINE. NULO em equipamento.posse significa '
  'DESCONHECIDA -- a importacao do Atlas nao afirma posse (D-152).';

-- ------------------------------------------------------------
-- B · Cada importação da carga
-- ------------------------------------------------------------
create table if not exists estoque_importacao (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid references empresa(id),
  arquivo      text,
  formato      text,          -- CARGA | CONSULTA
  linhas       int not null default 0,
  criados      int not null default 0,
  atualizados  int not null default 0,
  ignorados    int not null default 0,
  criado_em    timestamptz not null default now(),
  criado_por   uuid references perfil(id)
);

-- ------------------------------------------------------------
-- C · O equipamento serializado
-- ------------------------------------------------------------
create table if not exists equipamento (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresa(id),
  -- Chave natural. Normalizado como o campo normaliza (055-F): sem
  -- espaco e em caixa alta, porque leitor de codigo de barras e dedo em
  -- tela pequena variam e o aparelho nao.
  serial         text not null,
  enderecavel    text,
  tipo           text,
  modelo         text,
  item_jde       text,
  material_sap   text,
  operacao       text,
  -- ---- o que a CLARO diz (nao se edita aqui) ----
  estado_atlas   text,
  local_atlas    text,
  tipo_local_atlas text,
  responsavel_atlas text,
  contrato_atlas text,
  classificacao  text,
  empresa_material text,
  reusos         int,
  atlas_em       timestamptz,
  -- ---- o que NOS dizemos ----
  posse          text references estoque_posse(codigo),
  posse_tecnico_id uuid references tecnico(id),
  posse_em       timestamptz,
  posse_por      uuid references perfil(id),
  posse_motivo   text,
  -- ---- procedencia ----
  dados_origem   jsonb,
  importacao_id  uuid references estoque_importacao(id),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create unique index if not exists equipamento_serial_uk
  on equipamento (empresa_id, serial);
create index if not exists equipamento_estado_ix on equipamento (empresa_id, estado_atlas);
create index if not exists equipamento_posse_ix  on equipamento (empresa_id, posse);
create index if not exists equipamento_tipo_ix   on equipamento (empresa_id, tipo);
-- Busca por PREFIXO de serial, que e como se digita numero de serie e
-- como o leitor de codigo de barras entrega. Trigrama (`pg_trgm`) daria
-- busca no meio da palavra, mas a extensao nao esta instalada e 15.603
-- linhas nao justificam instalar uma: `like 'ABC%'` usa o indice unico
-- acima, e para o resto a varredura e barata. Se o estoque crescer uma
-- ordem de grandeza, e aqui que se olha.
create index if not exists equipamento_modelo_ix on equipamento (empresa_id, modelo);

comment on column equipamento.posse is
  'NULO = nao sabemos onde esta. A importacao do Atlas NAO preenche: ela '
  'sabe de quem e a responsabilidade, nao onde a peca esta (D-152).';
comment on column equipamento.estado_atlas is
  'O que a CLARO afirma. Nao se edita aqui -- e a baixa da operadora do '
  'estoque (mesma gramatica de D-042).';

-- ------------------------------------------------------------
-- D · RLS
-- ------------------------------------------------------------
alter table estoque_posse      enable row level security;
alter table estoque_importacao enable row level security;
alter table equipamento        enable row level security;

drop policy if exists estoque_posse_leitura on estoque_posse;
create policy estoque_posse_leitura on estoque_posse for select
  to authenticated using (true);

drop policy if exists estoque_importacao_leitura on estoque_importacao;
create policy estoque_importacao_leitura on estoque_importacao for select
  to authenticated using (empresa_id = (select minha_empresa()));

-- `(select ...)` e obrigatorio: funcao solta na policy e chamada POR
-- LINHA, e aqui sao 15.603 linhas (D-118).
drop policy if exists equipamento_leitura on equipamento;
create policy equipamento_leitura on equipamento for select
  to authenticated using (
    empresa_id = (select minha_empresa())
    and (select tem_permissao('almoxarifado.ver'))
  );

-- Escrita so por RPC: nao ha policy de insert/update/delete de propósito.
-- Quem grava e `importar_estoque`, que e SECURITY DEFINER e confere
-- papel e permissao dentro.

-- ------------------------------------------------------------
-- E · As permissões do módulo
-- ------------------------------------------------------------
update permissao
   set rotulo = 'Ver o estoque',
       descricao = 'Enxergar a posicao do almoxarifado',
       disponivel = true
 where chave = 'almoxarifado.ver';

insert into permissao (chave, modulo, rotulo, descricao, ordem, disponivel) values
  ('almoxarifado.importar', 'ALMOXARIFADO', 'Importar a carga',
   'Subir a planilha do Atlas e atualizar a posicao', 2, true),
  ('almoxarifado.editar', 'ALMOXARIFADO', 'Declarar a posse',
   'Dizer onde a peca esta: almoxarifado, tecnico, transito', 3, true)
on conflict (chave) do update
   set modulo = excluded.modulo, rotulo = excluded.rotulo,
       descricao = excluded.descricao, ordem = excluded.ordem,
       disponivel = excluded.disponivel;

-- O perfil "Almoxarife" existia com ZERO permissoes. Agora ele tem as do
-- modulo dele -- e so as dele: almoxarife nao baixa contrato.
insert into perfil_acesso_permissao (perfil_acesso_id, permissao_chave)
select pa.id, p.chave
  from perfil_acesso pa
  cross join (values ('almoxarifado.ver'), ('almoxarifado.importar'),
                     ('almoxarifado.editar')) as p(chave)
 where pa.nome in ('Almoxarife', 'Administrador')
on conflict do nothing;

-- ------------------------------------------------------------
-- F · A importação
-- ------------------------------------------------------------
-- Idempotente pelo SERIAL, que e unico em 15.603 de 15.603. Reimportar a
-- mesma planilha atualiza e nao duplica.
--
-- NAO toca em `posse`: a planilha nao sabe onde a peca esta fisicamente,
-- e sobrescrever a declaracao de quem conferiu a prateleira com um nulo
-- do Atlas seria apagar trabalho de gente.
create or replace function importar_estoque(
  p_arquivo text, p_formato text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_emp uuid; v_imp uuid; v_l jsonb; v_serial text;
  v_criados int := 0; v_atualizados int := 0; v_ignorados int := 0;
  v_existe boolean;
begin
  if not (eh_gestor() or tem_papel('ALMOXARIFE')) then
    raise exception 'Sem permissao para importar estoque.' using errcode = '42501';
  end if;
  if not tem_permissao('almoxarifado.importar') then
    raise exception 'Seu perfil de acesso nao inclui "Importar a carga".'
      using errcode = '42501';
  end if;

  v_emp := minha_empresa();
  insert into estoque_importacao (empresa_id, arquivo, formato, linhas, criado_por)
  values (v_emp, p_arquivo, p_formato, jsonb_array_length(p_linhas), auth.uid())
  returning id into v_imp;

  for v_l in select * from jsonb_array_elements(p_linhas) loop
    -- Mesma normalizacao do campo (055-F): sem espaco, caixa alta.
    v_serial := upper(regexp_replace(coalesce(v_l->>'serial',''), '\s', '', 'g'));
    if length(v_serial) < 4 then
      v_ignorados := v_ignorados + 1;
      continue;
    end if;

    select true into v_existe from equipamento
     where empresa_id = v_emp and serial = v_serial;

    insert into equipamento (
      empresa_id, serial, enderecavel, tipo, modelo, item_jde, material_sap,
      operacao, estado_atlas, local_atlas, tipo_local_atlas, responsavel_atlas,
      contrato_atlas, classificacao, empresa_material, reusos, atlas_em,
      posse, dados_origem, importacao_id)
    values (
      v_emp, v_serial,
      nullif(btrim(coalesce(v_l->>'enderecavel','')),''),
      nullif(btrim(coalesce(v_l->>'tipo','')),''),
      nullif(btrim(coalesce(v_l->>'modelo','')),''),
      nullif(btrim(coalesce(v_l->>'item_jde','')),''),
      nullif(btrim(coalesce(v_l->>'material_sap','')),''),
      nullif(btrim(coalesce(v_l->>'operacao','')),''),
      nullif(btrim(coalesce(v_l->>'estado_atlas','')),''),
      nullif(btrim(coalesce(v_l->>'local_atlas','')),''),
      nullif(btrim(coalesce(v_l->>'tipo_local_atlas','')),''),
      nullif(btrim(coalesce(v_l->>'responsavel_atlas','')),''),
      nullif(btrim(coalesce(v_l->>'contrato_atlas','')),''),
      nullif(btrim(coalesce(v_l->>'classificacao','')),''),
      nullif(btrim(coalesce(v_l->>'empresa_material','')),''),
      nullif(v_l->>'reusos','')::int,
      nullif(v_l->>'atlas_em','')::timestamptz,
      -- A UNICA posse que a planilha afirma.
      case when upper(coalesce(v_l->>'tipo_local_atlas','')) = 'ASSINANTE'
           then 'COM_ASSINANTE' end,
      v_l, v_imp)
    on conflict (empresa_id, serial) do update set
      enderecavel       = coalesce(excluded.enderecavel, equipamento.enderecavel),
      tipo              = coalesce(excluded.tipo, equipamento.tipo),
      modelo            = coalesce(excluded.modelo, equipamento.modelo),
      item_jde          = coalesce(excluded.item_jde, equipamento.item_jde),
      material_sap      = coalesce(excluded.material_sap, equipamento.material_sap),
      operacao          = coalesce(excluded.operacao, equipamento.operacao),
      estado_atlas      = coalesce(excluded.estado_atlas, equipamento.estado_atlas),
      local_atlas       = coalesce(excluded.local_atlas, equipamento.local_atlas),
      tipo_local_atlas  = coalesce(excluded.tipo_local_atlas, equipamento.tipo_local_atlas),
      responsavel_atlas = coalesce(excluded.responsavel_atlas, equipamento.responsavel_atlas),
      contrato_atlas    = coalesce(excluded.contrato_atlas, equipamento.contrato_atlas),
      classificacao     = coalesce(excluded.classificacao, equipamento.classificacao),
      empresa_material  = coalesce(excluded.empresa_material, equipamento.empresa_material),
      reusos            = coalesce(excluded.reusos, equipamento.reusos),
      atlas_em          = coalesce(excluded.atlas_em, equipamento.atlas_em),
      -- `posse` FICA COMO ESTAVA. So sobe quando a planilha AFIRMA o
      -- assinante -- e ai ela sabe mais do que nos.
      posse             = case
                            when upper(coalesce(excluded.tipo_local_atlas,'')) = 'ASSINANTE'
                            then 'COM_ASSINANTE' else equipamento.posse end,
      dados_origem      = excluded.dados_origem,
      importacao_id     = excluded.importacao_id,
      atualizado_em     = now();

    if v_existe then v_atualizados := v_atualizados + 1;
    else v_criados := v_criados + 1; end if;
    v_existe := null;
  end loop;

  update estoque_importacao
     set criados = v_criados, atualizados = v_atualizados, ignorados = v_ignorados
   where id = v_imp;

  return jsonb_build_object('importacao', v_imp, 'linhas', jsonb_array_length(p_linhas),
                            'criados', v_criados, 'atualizados', v_atualizados,
                            'ignorados', v_ignorados);
end;
$fn$;

revoke all on function importar_estoque(text, text, jsonb) from public, anon;
grant execute on function importar_estoque(text, text, jsonb) to authenticated;

-- ------------------------------------------------------------
-- G · A posição
-- ------------------------------------------------------------
-- Agregado no SERVIDOR: 15.603 linhas nao descem para o navegador so
-- para virar seis numeros.
create or replace function estoque_posicao()
returns jsonb language sql stable security definer set search_path to 'public' as $fn$
  with permitido as (
    select eh_gestor() or tem_permissao('almoxarifado.ver') as ok
  ),
  base as (
    select e.* from equipamento e, permitido p
     where p.ok and e.empresa_id = minha_empresa()
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'sem_posse', (select count(*) from base where posse is null),
    'por_estado', coalesce((
      select jsonb_agg(jsonb_build_object('estado', x.estado, 'qtd', x.n)
                       order by x.n desc)
        from (select coalesce(estado_atlas, '(sem estado)') as estado,
                     count(*) as n from base group by 1) x), '[]'::jsonb),
    'por_tipo', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', x.tipo, 'qtd', x.n)
                       order by x.n desc)
        from (select coalesce(tipo, '(sem tipo)') as tipo,
                     count(*) as n from base group by 1) x), '[]'::jsonb),
    'por_posse', coalesce((
      select jsonb_agg(jsonb_build_object('posse', x.posse, 'qtd', x.n)
                       order by x.n desc)
        from (select posse, count(*) as n from base group by 1) x), '[]'::jsonb),
    'por_modelo', coalesce((
      select jsonb_agg(jsonb_build_object('modelo', x.modelo, 'tipo', x.tipo,
                                          'qtd', x.n) order by x.n desc)
        from (select coalesce(modelo,'(sem modelo)') as modelo,
                     coalesce(tipo,'(sem tipo)') as tipo, count(*) as n
                from base group by 1, 2 order by n desc limit 25) x), '[]'::jsonb),
    'ultima_importacao', (
      select jsonb_build_object('em', i.criado_em, 'arquivo', i.arquivo,
                                'linhas', i.linhas, 'criados', i.criados,
                                'atualizados', i.atualizados)
        from estoque_importacao i
       where i.empresa_id = minha_empresa()
       order by i.criado_em desc limit 1)
  );
$fn$;

revoke all on function estoque_posicao() from public, anon;
grant execute on function estoque_posicao() to authenticated;

notify pgrst, 'reload schema';
