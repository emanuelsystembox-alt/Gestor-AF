-- ============================================================================
-- 088 · A frota nasce
-- ============================================================================
--
-- > "agora copie o módulo frota deles, ou faça até melhor"  — Emanuel, 26/09
-- > "no nosso caso vamos usar o nome do técnico como condutor […] nada de
-- >  equipe pra não ter duplicada"  — Emanuel, 26/09
--
-- Lido no Alfa Gestor da AFLINE em 26/09, só leitura (D-164):
--
--   veículos ativos                   154   (12 páginas de "origem")
--   abastecimentos na semana          195   (id já passa de 26.800)
--     · aprovado                      185   ← o "abastecido" quase nunca fecha
--     · abastecido                      4
--     · valor                         fixo: R$ 150 / R$ 200 (vale de posto)
--     · odômetro preenchido      191 de 195, e SOBE: dá consumo real
--   manutenções, em um ano             11   quase todas sem valor
--   portaria (saída/entrada)      abandonada desde out/2023
--   "Uso e Consumo" deles         mede km PELA PORTARIA → 0% da frota,
--                                 consumo "—" ao lado de R$ 108.972 no mês
--   km_por_litro                  10,00 em 154 de 154 (padrão nunca mexido)
--   tipo do veículo               vazio em 153 de 154
--   "origem"                      mistura DE QUEM É (própria, alugada,
--                                 locadora) com ONDE ESTÁ (oficina,
--                                 lanterneiro, férias, vendido, DETRAN)
--   condutor                      o LOGIN DA EQUIPE ("109 - EQUIPE")
--
-- O que muda aqui, por causa disso:
--   · propriedade e situação são DOIS campos;
--   · vendido/devolvido é ARQUIVAR com motivo — some da lista ativa;
--   · o condutor é o TÉCNICO (pedido do Emanuel), com histórico de período;
--   · o consumo sai do odômetro dos ABASTECIMENTOS, que já é preenchido;
--   · exceções aparecem sozinhas (odômetro que volta, km que não anda);
--   · nada de km/l de referência inventado: sem dado, a tela diz que não sabe.
--
-- Portaria e checklist NÃO entram: o dado diz que ninguém usa.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- A · Permissões — a fundação já existia
-- ---------------------------------------------------------------------------
-- O papel FROTA está no enum e `frota.ver` estava marcada "Modulo ainda nao
-- construido" (disponivel = false). Mesmo caminho do almoxarifado (077).
update permissao
   set rotulo = 'Ver a frota', descricao = 'Enxergar veiculos, abastecimentos e manutencoes',
       disponivel = true
 where chave = 'frota.ver';

insert into permissao (chave, modulo, rotulo, descricao, ordem, disponivel) values
  ('frota.editar', 'FROTA', 'Lançar na frota',
   'Cadastrar veiculo, condutor, abastecimento e manutencao; aprovar abastecimento', 2, true)
on conflict (chave) do update
   set modulo = excluded.modulo, rotulo = excluded.rotulo,
       descricao = excluded.descricao, ordem = excluded.ordem,
       disponivel = excluded.disponivel;

-- Perfil "Frota" para o papel que já existia sem perfil. Só as chaves do
-- módulo: quem cuida de carro não baixa contrato.
insert into perfil_acesso (empresa_id, nome, descricao, papel, ordem)
select e.id, 'Frota', 'Cuida dos veiculos: cadastro, condutor, abastecimento e manutencao',
       'FROTA', 7
  from empresa e
 where not exists (select 1 from perfil_acesso pa
                    where pa.empresa_id = e.id and pa.nome = 'Frota');

insert into perfil_acesso_permissao (perfil_acesso_id, permissao_chave)
select pa.id, p.chave
  from perfil_acesso pa
  cross join (values ('frota.ver'), ('frota.editar')) as p(chave)
 where pa.nome in ('Frota', 'Administrador')
on conflict do nothing;

create or replace function frota_pode_mexer()
returns void
language plpgsql stable security definer set search_path to 'public' as $fn$
begin
  if not (eh_gestor() or tem_papel('FROTA')) then
    raise exception 'Sem permissao na frota.' using errcode = '42501';
  end if;
  if not tem_permissao('frota.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Lançar na frota".' using errcode = '42501';
  end if;
end;
$fn$;
revoke all on function frota_pode_mexer() from public, anon;
grant execute on function frota_pode_mexer() to authenticated;


-- ---------------------------------------------------------------------------
-- B · O veículo
-- ---------------------------------------------------------------------------
create table if not exists veiculo (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresa(id),
  -- A "garagem" do concorrente é uma só (AFLINE-MAO): é a praça.
  base_id       uuid references base(id),
  placa         text not null,
  apelido       text,
  modelo        text,
  tipo          text check (tipo in ('CARRO', 'MOTO', 'CAMINHONETE', 'VAN', 'CAMINHAO', 'OUTRO')),
  ano           int  check (ano between 1950 and 2100),
  chassi        text,
  renavam       text,
  -- DE QUEM É. As três que o concorrente tem e que são propriedade de fato.
  -- "Moto própria/alugada" lá é tipo × propriedade colados; aqui são dois
  -- campos. Nula = ninguém disse.
  propriedade   text check (propriedade in ('PROPRIA', 'LOCADORA', 'TECNICO')),
  rastreador    text,
  -- ONDE ESTÁ. Os quatro status do concorrente, com o nome dele.
  situacao      text not null default 'NA_GARAGEM'
                check (situacao in ('ATIVO', 'NA_GARAGEM', 'FORA_DA_GARAGEM', 'EM_MANUTENCAO')),
  situacao_em   timestamptz not null default now(),
  situacao_por  uuid,
  -- Odômetro no cadastro. O ATUAL é o maior entre este, os abastecimentos
  -- e as manutenções — calculado, nunca guardado (traps.md: cache mente).
  hodometro_cadastro int check (hodometro_cadastro >= 0),
  observacao    text,
  -- Vendido, devolvido à locadora, sinistrado: sai da frota ativa com
  -- motivo. No concorrente 15 carros "VENDIDO SILAS - 92 9…" continuam na
  -- lista ativa, como "origem".
  arquivado_em     timestamptz,
  arquivado_motivo text,
  arquivado_por    uuid,
  criado_em     timestamptz not null default now(),
  criado_por    uuid,
  unique (empresa_id, placa)
);
alter table veiculo enable row level security;

-- Quem dirigiu, e quando. O condutor é o TÉCNICO (Emanuel, 26/09): o
-- concorrente grava o login da equipe, e a dupla vira um nome só.
create table if not exists veiculo_condutor (
  id          uuid primary key default gen_random_uuid(),
  veiculo_id  uuid not null references veiculo(id),
  tecnico_id  uuid not null references tecnico(id),
  desde       timestamptz not null default now(),
  ate         timestamptz,
  criado_por  uuid,
  encerrado_por uuid,
  check (ate is null or ate >= desde)
);
create unique index if not exists veiculo_condutor_um_atual
  on veiculo_condutor (veiculo_id) where ate is null;
create index if not exists veiculo_condutor_tecnico on veiculo_condutor (tecnico_id);
alter table veiculo_condutor enable row level security;

-- O histórico do veículo: situação, arquivamento, cadastro. Prova, não se apaga.
create table if not exists veiculo_evento (
  id          bigint generated always as identity primary key,
  veiculo_id  uuid not null references veiculo(id),
  tipo        text not null,
  de          jsonb,
  para        jsonb,
  motivo      text,
  criado_em   timestamptz not null default now(),
  criado_por  uuid
);
create index if not exists veiculo_evento_veiculo on veiculo_evento (veiculo_id, criado_em desc);
alter table veiculo_evento enable row level security;


-- ---------------------------------------------------------------------------
-- C · Abastecimento
-- ---------------------------------------------------------------------------
create table if not exists abastecimento (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresa(id),
  veiculo_id   uuid not null references veiculo(id),
  -- Quem estava com o carro. Vem do condutor atual se não for dito.
  tecnico_id   uuid references tecnico(id),
  data         date not null,
  combustivel  text not null
               check (combustivel in ('GASOLINA_COMUM', 'GASOLINA_ADITIVADA', 'ETANOL', 'DIESEL', 'GNV')),
  valor        numeric(10,2) not null check (valor > 0),
  valor_litro  numeric(10,3) not null check (valor_litro > 0),
  litros       numeric(10,3) not null check (litros > 0),
  -- Nulo = não informado, e vira exceção "sem odômetro". Nunca zero.
  hodometro    int check (hodometro > 0),
  posto        text,
  observacao   text,
  -- O fluxo do concorrente, com os nomes dele.
  situacao     text not null default 'APROVADO'
               check (situacao in ('EM_ABERTO', 'APROVADO', 'ABASTECIDO', 'CANCELADO')),
  criado_em    timestamptz not null default now(),
  criado_por   uuid,
  aprovado_em  timestamptz, aprovado_por uuid,
  abastecido_em timestamptz, abastecido_por uuid,
  cancelado_em timestamptz, cancelado_por uuid, cancelado_motivo text
);
create index if not exists abastecimento_veiculo_data on abastecimento (veiculo_id, data, criado_em);
create index if not exists abastecimento_empresa_data on abastecimento (empresa_id, data);
alter table abastecimento enable row level security;


-- ---------------------------------------------------------------------------
-- D · Manutenção
-- ---------------------------------------------------------------------------
create table if not exists manutencao (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresa(id),
  veiculo_id   uuid not null references veiculo(id),
  tipo         text not null check (tipo in ('PREVENTIVA', 'CORRETIVA')),
  data         date not null,
  fornecedor   text,
  hodometro    int check (hodometro > 0),
  situacao     text not null default 'ABERTA'
               check (situacao in ('ABERTA', 'CONCLUIDA', 'CANCELADA')),
  observacao   text,
  criado_em    timestamptz not null default now(),
  criado_por   uuid,
  situacao_em  timestamptz, situacao_por uuid, cancelado_motivo text
);
create index if not exists manutencao_veiculo on manutencao (veiculo_id, data desc);
alter table manutencao enable row level security;

-- Os serviços da manutenção. O total é SOMA, nunca coluna (D-154).
-- Valor nulo = não informado (o concorrente tem 8 de 11 assim); zero é
-- "saiu de graça" (D-117).
create table if not exists manutencao_item (
  id            uuid primary key default gen_random_uuid(),
  manutencao_id uuid not null references manutencao(id) on delete cascade,
  descricao     text not null,
  valor         numeric(10,2) check (valor >= 0)
);
alter table manutencao_item enable row level security;


-- ---------------------------------------------------------------------------
-- E · Leitura: quem tem frota.ver. Escrita: só pelas funções abaixo.
-- ---------------------------------------------------------------------------
drop policy if exists veiculo_leitura on veiculo;
create policy veiculo_leitura on veiculo for select using (
  empresa_id = (select minha_empresa()) and (select tem_permissao('frota.ver')));

drop policy if exists veiculo_condutor_leitura on veiculo_condutor;
create policy veiculo_condutor_leitura on veiculo_condutor for select using (
  veiculo_id in (select id from veiculo));

drop policy if exists veiculo_evento_leitura on veiculo_evento;
create policy veiculo_evento_leitura on veiculo_evento for select using (
  veiculo_id in (select id from veiculo));

drop policy if exists abastecimento_leitura on abastecimento;
create policy abastecimento_leitura on abastecimento for select using (
  empresa_id = (select minha_empresa()) and (select tem_permissao('frota.ver')));

drop policy if exists manutencao_leitura on manutencao;
create policy manutencao_leitura on manutencao for select using (
  empresa_id = (select minha_empresa()) and (select tem_permissao('frota.ver')));

drop policy if exists manutencao_item_leitura on manutencao_item;
create policy manutencao_item_leitura on manutencao_item for select using (
  manutencao_id in (select id from manutencao));


-- ---------------------------------------------------------------------------
-- F · Escrita
-- ---------------------------------------------------------------------------
-- Placa sem espaço nem hífen, em maiúsculas: "phh-5776" e "PHH5776" são o
-- mesmo carro, e a chave única precisa enxergar isso.
create or replace function norm_placa(p text)
returns text language sql immutable set search_path to 'public' as $fn$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '');
$fn$;
revoke all on function norm_placa(text) from public, anon;
grant execute on function norm_placa(text) to authenticated;

-- Cria (p_id nulo) ou atualiza o cadastro. Situação e condutor têm porta
-- própria, porque cada mudança deles é um evento com autor.
create or replace function salvar_veiculo(p_id uuid, p_dados jsonb)
returns uuid
language plpgsql security definer set search_path to 'public' as $fn$
declare v_id uuid; v_emp uuid := minha_empresa(); v_placa text; v_antes jsonb;
begin
  perform frota_pode_mexer();
  v_placa := norm_placa(p_dados->>'placa');
  if v_placa is null or length(v_placa) < 7 then
    raise exception 'Placa invalida: %.', coalesce(p_dados->>'placa', '(vazia)') using errcode = '23514';
  end if;

  if p_id is null then
    insert into veiculo (empresa_id, base_id, placa, apelido, modelo, tipo, ano, chassi, renavam,
                         propriedade, rastreador, situacao, situacao_por, hodometro_cadastro,
                         observacao, criado_por)
    values (v_emp, nullif(p_dados->>'base_id','')::uuid, v_placa,
            nullif(btrim(p_dados->>'apelido'),''), nullif(btrim(p_dados->>'modelo'),''),
            nullif(p_dados->>'tipo',''), nullif(p_dados->>'ano','')::int,
            nullif(btrim(p_dados->>'chassi'),''), nullif(btrim(p_dados->>'renavam'),''),
            nullif(p_dados->>'propriedade',''), nullif(btrim(p_dados->>'rastreador'),''),
            coalesce(nullif(p_dados->>'situacao',''), 'NA_GARAGEM'), auth.uid(),
            nullif(p_dados->>'hodometro_cadastro','')::int,
            nullif(btrim(p_dados->>'observacao'),''), auth.uid())
    returning id into v_id;
    insert into veiculo_evento (veiculo_id, tipo, para, criado_por)
    values (v_id, 'CADASTRO', jsonb_build_object('placa', v_placa), auth.uid());
  else
    select to_jsonb(v) into v_antes from veiculo v where v.id = p_id and v.empresa_id = v_emp;
    if v_antes is null then raise exception 'Veiculo nao encontrado.' using errcode = 'P0002'; end if;
    update veiculo set
      base_id = nullif(p_dados->>'base_id','')::uuid, placa = v_placa,
      apelido = nullif(btrim(p_dados->>'apelido'),''), modelo = nullif(btrim(p_dados->>'modelo'),''),
      tipo = nullif(p_dados->>'tipo',''), ano = nullif(p_dados->>'ano','')::int,
      chassi = nullif(btrim(p_dados->>'chassi'),''), renavam = nullif(btrim(p_dados->>'renavam'),''),
      propriedade = nullif(p_dados->>'propriedade',''), rastreador = nullif(btrim(p_dados->>'rastreador'),''),
      hodometro_cadastro = nullif(p_dados->>'hodometro_cadastro','')::int,
      observacao = nullif(btrim(p_dados->>'observacao'),'')
    where id = p_id;
    v_id := p_id;
    insert into veiculo_evento (veiculo_id, tipo, de, para, criado_por)
    values (v_id, 'CADASTRO', v_antes - 'criado_em' - 'situacao_em',
            (select to_jsonb(v) - 'criado_em' - 'situacao_em' from veiculo v where v.id = v_id),
            auth.uid());
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Ja existe um veiculo com a placa %.', v_placa using errcode = '23505';
end;
$fn$;
revoke all on function salvar_veiculo(uuid, jsonb) from public, anon;
grant execute on function salvar_veiculo(uuid, jsonb) to authenticated;

create or replace function definir_situacao_veiculo(p_veiculo uuid, p_situacao text, p_motivo text default null)
returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare v veiculo%rowtype;
begin
  perform frota_pode_mexer();
  select * into v from veiculo where id = p_veiculo and empresa_id = minha_empresa();
  if not found then raise exception 'Veiculo nao encontrado.' using errcode = 'P0002'; end if;
  if v.arquivado_em is not null then
    raise exception 'Veiculo arquivado. Reative antes de mudar a situacao.' using errcode = '23514';
  end if;
  if v.situacao = p_situacao then return; end if;
  update veiculo set situacao = p_situacao, situacao_em = now(), situacao_por = auth.uid()
   where id = p_veiculo;
  insert into veiculo_evento (veiculo_id, tipo, de, para, motivo, criado_por)
  values (p_veiculo, 'SITUACAO', to_jsonb(v.situacao), to_jsonb(p_situacao),
          nullif(btrim(coalesce(p_motivo,'')),''), auth.uid());
end;
$fn$;
revoke all on function definir_situacao_veiculo(uuid, text, text) from public, anon;
grant execute on function definir_situacao_veiculo(uuid, text, text) to authenticated;

-- Arquivar exige motivo; reativar (p_arquivar = false) também deixa rastro.
create or replace function arquivar_veiculo(p_veiculo uuid, p_arquivar boolean, p_motivo text)
returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare v veiculo%rowtype;
begin
  perform frota_pode_mexer();
  select * into v from veiculo where id = p_veiculo and empresa_id = minha_empresa();
  if not found then raise exception 'Veiculo nao encontrado.' using errcode = 'P0002'; end if;
  if btrim(coalesce(p_motivo,'')) = '' then
    raise exception 'Diga o motivo (vendido, devolvido a locadora, sinistro...).' using errcode = '23514';
  end if;
  if p_arquivar then
    if v.arquivado_em is not null then return; end if;
    -- Carro que saiu da frota não tem condutor.
    update veiculo_condutor set ate = now(), encerrado_por = auth.uid()
     where veiculo_id = p_veiculo and ate is null;
    update veiculo set arquivado_em = now(), arquivado_motivo = btrim(p_motivo),
                       arquivado_por = auth.uid()
     where id = p_veiculo;
  else
    if v.arquivado_em is null then return; end if;
    update veiculo set arquivado_em = null, arquivado_motivo = null, arquivado_por = null
     where id = p_veiculo;
  end if;
  insert into veiculo_evento (veiculo_id, tipo, para, motivo, criado_por)
  values (p_veiculo, case when p_arquivar then 'ARQUIVADO' else 'REATIVADO' end,
          null, btrim(p_motivo), auth.uid());
end;
$fn$;
revoke all on function arquivar_veiculo(uuid, boolean, text) from public, anon;
grant execute on function arquivar_veiculo(uuid, boolean, text) to authenticated;

-- Troca o condutor: encerra o período atual e abre o novo. p_tecnico nulo
-- = o carro fica sem condutor. O mesmo técnico em dois carros ao mesmo
-- tempo NÃO é recusado — regra que ninguém combinou —, a tela avisa.
create or replace function definir_condutor(p_veiculo uuid, p_tecnico uuid)
returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare v veiculo%rowtype; v_atual uuid;
begin
  perform frota_pode_mexer();
  select * into v from veiculo where id = p_veiculo and empresa_id = minha_empresa();
  if not found then raise exception 'Veiculo nao encontrado.' using errcode = 'P0002'; end if;
  if v.arquivado_em is not null then
    raise exception 'Veiculo arquivado nao recebe condutor.' using errcode = '23514';
  end if;
  if p_tecnico is not null and not exists (
       select 1 from tecnico where id = p_tecnico and empresa_id = v.empresa_id) then
    raise exception 'Tecnico nao encontrado.' using errcode = 'P0002';
  end if;

  select tecnico_id into v_atual from veiculo_condutor where veiculo_id = p_veiculo and ate is null;
  if v_atual is not distinct from p_tecnico then return; end if;

  update veiculo_condutor set ate = now(), encerrado_por = auth.uid()
   where veiculo_id = p_veiculo and ate is null;
  if p_tecnico is not null then
    insert into veiculo_condutor (veiculo_id, tecnico_id, criado_por)
    values (p_veiculo, p_tecnico, auth.uid());
  end if;
  insert into veiculo_evento (veiculo_id, tipo, de, para, criado_por)
  values (p_veiculo, 'CONDUTOR', to_jsonb(v_atual), to_jsonb(p_tecnico), auth.uid());
end;
$fn$;
revoke all on function definir_condutor(uuid, uuid) from public, anon;
grant execute on function definir_condutor(uuid, uuid) to authenticated;

-- Lança um abastecimento. Litros: se não vier, valor ÷ preço (é o que o
-- concorrente faz — o vale é em reais). Condutor: se não vier, o atual.
create or replace function lancar_abastecimento(p_dados jsonb)
returns uuid
language plpgsql security definer set search_path to 'public' as $fn$
declare v veiculo%rowtype; v_id uuid; v_valor numeric; v_preco numeric; v_litros numeric;
        v_tec uuid; v_sit text;
begin
  perform frota_pode_mexer();
  select * into v from veiculo where id = (p_dados->>'veiculo_id')::uuid and empresa_id = minha_empresa();
  if not found then raise exception 'Veiculo nao encontrado.' using errcode = 'P0002'; end if;
  if v.arquivado_em is not null then
    raise exception 'Veiculo arquivado nao abastece.' using errcode = '23514';
  end if;

  v_valor := nullif(p_dados->>'valor','')::numeric;
  v_preco := nullif(p_dados->>'valor_litro','')::numeric;
  v_litros := coalesce(nullif(p_dados->>'litros','')::numeric,
                       case when v_preco > 0 then round(v_valor / v_preco, 3) end);
  v_tec := coalesce(nullif(p_dados->>'tecnico_id','')::uuid,
                    (select tecnico_id from veiculo_condutor where veiculo_id = v.id and ate is null));
  v_sit := coalesce(nullif(p_dados->>'situacao',''), 'APROVADO');
  if v_sit not in ('EM_ABERTO', 'APROVADO', 'ABASTECIDO') then
    raise exception 'Abastecimento nasce em aberto, aprovado ou abastecido.' using errcode = '23514';
  end if;

  insert into abastecimento (empresa_id, veiculo_id, tecnico_id, data, combustivel, valor,
                             valor_litro, litros, hodometro, posto, observacao, situacao,
                             criado_por, aprovado_em, aprovado_por, abastecido_em, abastecido_por)
  values (v.empresa_id, v.id, v_tec, coalesce(nullif(p_dados->>'data','')::date, hoje_local()),
          coalesce(nullif(p_dados->>'combustivel',''), 'GASOLINA_COMUM'),
          v_valor, v_preco, v_litros, nullif(p_dados->>'hodometro','')::int,
          nullif(btrim(p_dados->>'posto'),''), nullif(btrim(p_dados->>'observacao'),''),
          v_sit, auth.uid(),
          case when v_sit in ('APROVADO','ABASTECIDO') then now() end,
          case when v_sit in ('APROVADO','ABASTECIDO') then auth.uid() end,
          case when v_sit = 'ABASTECIDO' then now() end,
          case when v_sit = 'ABASTECIDO' then auth.uid() end)
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function lancar_abastecimento(jsonb) from public, anon;
grant execute on function lancar_abastecimento(jsonb) to authenticated;

-- Avança o fluxo. Cancelado não volta; cancelar exige motivo. Ao marcar
-- ABASTECIDO dá para informar o odômetro que faltou.
create or replace function mudar_abastecimento(p_id uuid, p_situacao text,
                                               p_motivo text default null,
                                               p_hodometro int default null)
returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare a abastecimento%rowtype;
begin
  perform frota_pode_mexer();
  select * into a from abastecimento where id = p_id and empresa_id = minha_empresa();
  if not found then raise exception 'Abastecimento nao encontrado.' using errcode = 'P0002'; end if;
  if a.situacao = 'CANCELADO' then
    raise exception 'Abastecimento cancelado nao muda. Lance outro.' using errcode = '23514';
  end if;
  if p_situacao = 'CANCELADO' then
    if btrim(coalesce(p_motivo,'')) = '' then
      raise exception 'Cancelar exige motivo.' using errcode = '23514';
    end if;
    update abastecimento set situacao = 'CANCELADO', cancelado_em = now(),
           cancelado_por = auth.uid(), cancelado_motivo = btrim(p_motivo)
     where id = p_id;
  elsif p_situacao = 'APROVADO' and a.situacao = 'EM_ABERTO' then
    update abastecimento set situacao = 'APROVADO', aprovado_em = now(), aprovado_por = auth.uid()
     where id = p_id;
  elsif p_situacao = 'ABASTECIDO' and a.situacao in ('EM_ABERTO', 'APROVADO') then
    update abastecimento set situacao = 'ABASTECIDO', abastecido_em = now(), abastecido_por = auth.uid(),
           aprovado_em = coalesce(aprovado_em, now()), aprovado_por = coalesce(aprovado_por, auth.uid()),
           hodometro = coalesce(p_hodometro, hodometro)
     where id = p_id;
  else
    raise exception 'De % nao se vai para %.', a.situacao, p_situacao using errcode = '23514';
  end if;
end;
$fn$;
revoke all on function mudar_abastecimento(uuid, text, text, int) from public, anon;
grant execute on function mudar_abastecimento(uuid, text, text, int) to authenticated;

-- Manutenção com os serviços num documento só. p_id nulo cria; senão
-- substitui os itens (só enquanto ABERTA).
create or replace function salvar_manutencao(p_id uuid, p_dados jsonb, p_itens jsonb)
returns uuid
language plpgsql security definer set search_path to 'public' as $fn$
declare v veiculo%rowtype; v_id uuid; m manutencao%rowtype; it jsonb;
begin
  perform frota_pode_mexer();
  select * into v from veiculo where id = (p_dados->>'veiculo_id')::uuid and empresa_id = minha_empresa();
  if not found then raise exception 'Veiculo nao encontrado.' using errcode = 'P0002'; end if;

  if p_id is null then
    insert into manutencao (empresa_id, veiculo_id, tipo, data, fornecedor, hodometro, observacao, criado_por)
    values (v.empresa_id, v.id, p_dados->>'tipo',
            coalesce(nullif(p_dados->>'data','')::date, hoje_local()),
            nullif(btrim(p_dados->>'fornecedor'),''), nullif(p_dados->>'hodometro','')::int,
            nullif(btrim(p_dados->>'observacao'),''), auth.uid())
    returning id into v_id;
  else
    select * into m from manutencao where id = p_id and empresa_id = v.empresa_id;
    if not found then raise exception 'Manutencao nao encontrada.' using errcode = 'P0002'; end if;
    if m.situacao <> 'ABERTA' then
      raise exception 'Manutencao % nao se edita.', lower(m.situacao) using errcode = '23514';
    end if;
    update manutencao set veiculo_id = v.id, tipo = p_dados->>'tipo',
           data = coalesce(nullif(p_dados->>'data','')::date, data),
           fornecedor = nullif(btrim(p_dados->>'fornecedor'),''),
           hodometro = nullif(p_dados->>'hodometro','')::int,
           observacao = nullif(btrim(p_dados->>'observacao'),'')
     where id = p_id;
    delete from manutencao_item where manutencao_id = p_id;
    v_id := p_id;
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    continue when btrim(coalesce(it->>'descricao','')) = '';
    insert into manutencao_item (manutencao_id, descricao, valor)
    values (v_id, btrim(it->>'descricao'), nullif(it->>'valor','')::numeric);
  end loop;
  return v_id;
end;
$fn$;
revoke all on function salvar_manutencao(uuid, jsonb, jsonb) from public, anon;
grant execute on function salvar_manutencao(uuid, jsonb, jsonb) to authenticated;

create or replace function mudar_manutencao(p_id uuid, p_situacao text, p_motivo text default null)
returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare m manutencao%rowtype;
begin
  perform frota_pode_mexer();
  select * into m from manutencao where id = p_id and empresa_id = minha_empresa();
  if not found then raise exception 'Manutencao nao encontrada.' using errcode = 'P0002'; end if;
  if m.situacao <> 'ABERTA' then
    raise exception 'Manutencao ja esta %.', lower(m.situacao) using errcode = '23514';
  end if;
  if p_situacao not in ('CONCLUIDA', 'CANCELADA') then
    raise exception 'Manutencao aberta vai para concluida ou cancelada.' using errcode = '23514';
  end if;
  if p_situacao = 'CANCELADA' and btrim(coalesce(p_motivo,'')) = '' then
    raise exception 'Cancelar exige motivo.' using errcode = '23514';
  end if;
  update manutencao set situacao = p_situacao, situacao_em = now(), situacao_por = auth.uid(),
         cancelado_motivo = case when p_situacao = 'CANCELADA' then btrim(p_motivo) end
   where id = p_id;
end;
$fn$;
revoke all on function mudar_manutencao(uuid, text, text) from public, anon;
grant execute on function mudar_manutencao(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- G · O que o concorrente não entrega: consumo real e exceções
-- ---------------------------------------------------------------------------
-- ┌─ como o km é medido ──────────────────────────────────────────────────┐
-- │ Pelo odômetro dos abastecimentos que CONTAM (aprovado ou abastecido — │
-- │ o mesmo critério do "abastecido e aprovado" do concorrente).          │
-- │                                                                       │
-- │ Uma leitura é VÁLIDA se tem odômetro e ele não é menor que o maior já │
-- │ lido antes. O intervalo vai de leitura válida a leitura válida, e o   │
-- │ combustível dele é TUDO o que entrou no meio — inclusive abastecimento│
-- │ sem odômetro e o de odômetro errado. Assim um dígito trocado vira     │
-- │ exceção sozinho, e não contamina a conta seguinte.                    │
-- │                                                                       │
-- │ ⚠ A primeira versão comparava cada um com o ANTERIOR (lag): o         │
-- │   odômetro que voltou 697 km devolvia os 697 no intervalo seguinte, e │
-- │   o km/l do carro de teste saiu 13,6 em vez de 7,1. Pego no teste com │
-- │   a sequência real do PHY3690, antes de ir para a tela.               │
-- │                                                                       │
-- │ Medido na AFLINE em 26/09, três carros num mês: 9,8 · 7,7 · 9,1 km/l. │
-- │ O concorrente mostra 10,00 fixo para todos.                           │
-- └───────────────────────────────────────────────────────────────────────┘
create or replace function frota_intervalos(p_de date, p_ate date)
returns table (veiculo_id uuid, abastecimento_id uuid, data date, tecnico_id uuid,
               hodometro int, hodometro_anterior int, km int, litros_anterior numeric,
               km_por_litro numeric)
language sql stable security definer set search_path to 'public' as $fn$
  with base as materialized (
    select a.id, a.veiculo_id, a.data, a.tecnico_id, a.hodometro, a.litros, a.criado_em
      from abastecimento a
     where a.empresa_id = minha_empresa()
       and a.situacao in ('APROVADO', 'ABASTECIDO')
       -- Um trecho antes do período, para o primeiro abastecimento dele
       -- ter com quem comparar.
       and a.data between p_de - 45 and p_ate
  ), o as (
    select b.*,
           max(b.hodometro) over (partition by b.veiculo_id
                                  order by b.data, b.hodometro nulls last, b.criado_em
                                  rows between unbounded preceding and 1 preceding) as max_ant
      from base b
  ), v as (
    select o.*, (o.hodometro is not null
                 and (o.max_ant is null or o.hodometro >= o.max_ant)) as valido
      from o
  ), g as (
    -- Cada leitura válida abre um grupo; o que vem depois dela (sem
    -- odômetro, ou com odômetro errado) cai no grupo dela.
    select v.*, count(*) filter (where v.valido)
                  over (partition by v.veiculo_id
                        order by v.data, v.hodometro nulls last, v.criado_em
                        rows unbounded preceding) as grupo
      from v
  ), lit as (
    select g.veiculo_id, g.grupo, sum(g.litros) as litros from g where g.grupo > 0 group by 1, 2
  ), vv as (
    select g.*, lag(g.hodometro) over (partition by g.veiculo_id order by g.grupo) as h_ant
      from g where g.valido
  ), intervalo as (
    select vv.veiculo_id, vv.id, vv.data, vv.tecnico_id, vv.hodometro, vv.h_ant,
           vv.hodometro - vv.h_ant as km, l.litros
      from vv left join lit l on l.veiculo_id = vv.veiculo_id and l.grupo = vv.grupo - 1
     where vv.h_ant is not null
    union all
    -- O odômetro que VOLTOU: comparado com o maior já lido, km negativo.
    select g.veiculo_id, g.id, g.data, g.tecnico_id, g.hodometro, g.max_ant,
           g.hodometro - g.max_ant, null
      from g where g.hodometro is not null and not g.valido
  )
  select i.veiculo_id, i.id, i.data, i.tecnico_id, i.hodometro, i.h_ant, i.km, i.litros,
         case when i.litros > 0 and i.km >= 0 then round(i.km / i.litros, 2) end
    from intervalo i
   where i.data between p_de and p_ate
     and (select tem_permissao('frota.ver'));
$fn$;
revoke all on function frota_intervalos(date, date) from public, anon;
grant execute on function frota_intervalos(date, date) to authenticated;

-- Por veículo, no período: litros, valor, km medido, km/l e custo por km.
-- km/l = soma do km ÷ soma dos litros ANTERIORES dos intervalos válidos
-- (média ponderada, não média de médias). Sem intervalo válido: NULO.
create or replace function frota_consumo(p_de date, p_ate date)
returns table (veiculo_id uuid, abastecimentos int, litros numeric, valor numeric,
               km int, km_por_litro numeric, custo_por_km numeric, sem_hodometro int)
language sql stable security definer set search_path to 'public' as $fn$
  with a as materialized (
    select ab.veiculo_id, count(*)::int n, sum(ab.litros) litros, sum(ab.valor) valor,
           count(*) filter (where ab.hodometro is null)::int sem_h
      from abastecimento ab
     where ab.empresa_id = minha_empresa()
       and ab.situacao in ('APROVADO', 'ABASTECIDO')
       and ab.data between p_de and p_ate
     group by ab.veiculo_id
  ), i as (
    select veiculo_id, sum(km) filter (where km >= 0)::int km,
           sum(litros_anterior) filter (where km >= 0) l
      from frota_intervalos(p_de, p_ate) group by veiculo_id
  )
  select a.veiculo_id, a.n, a.litros, a.valor, i.km,
         case when i.l > 0 and i.km > 0 then round(i.km / i.l, 2) end,
         case when i.km > 0 then round(a.valor / i.km, 3) end,
         a.sem_h
    from a left join i on i.veiculo_id = a.veiculo_id
   where (select tem_permissao('frota.ver'));
$fn$;
revoke all on function frota_consumo(date, date) from public, anon;
grant execute on function frota_consumo(date, date) to authenticated;

-- ┌─ exceções: A CONFERIR, nunca bloqueio ────────────────────────────────┐
-- │ ODOMETRO_VOLTOU  — o odômetro é menor que o do abastecimento anterior. │
-- │                    Fisicamente impossível: digitação ou carro errado. │
-- │ SEM_HODOMETRO    — lançado sem odômetro: some da conta de consumo.    │
-- │ KM_BAIXO         — o intervalo rendeu menos de 1/3 do km/l MEDIANO do │
-- │                    PRÓPRIO carro nos últimos 90 dias (com pelo menos  │
-- │                    3 intervalos para ter mediana). Ex. real: 27 L com │
-- │                    2 km entre um e outro (PHY3690, 04/09).            │
-- │                                                                       │
-- │ O corte de 1/3 é NOSSO, não da AFLINE: mede contra o próprio carro,   │
-- │ não contra um número de fábrica. Ajustável aqui. Nada disso impede    │
-- │ lançar — só aparece para alguém olhar (D-164).                        │
-- └───────────────────────────────────────────────────────────────────────┘
create or replace function frota_excecoes(p_de date, p_ate date)
returns table (abastecimento_id uuid, veiculo_id uuid, data date, tecnico_id uuid,
               tipo text, detalhe text)
language sql stable security definer set search_path to 'public' as $fn$
  with mediana as materialized (
    select veiculo_id,
           percentile_cont(0.5) within group (order by km_por_litro) med,
           count(*) n
      from frota_intervalos(p_ate - 90, p_ate)
     where km_por_litro > 0
     group by veiculo_id
  ), iv as materialized (
    select * from frota_intervalos(p_de, p_ate)
  )
  select iv.abastecimento_id, iv.veiculo_id, iv.data, iv.tecnico_id, 'ODOMETRO_VOLTOU',
         format('odômetro %s depois de %s', iv.hodometro, iv.hodometro_anterior)
    from iv where iv.km < 0
  union all
  select iv.abastecimento_id, iv.veiculo_id, iv.data, iv.tecnico_id, 'KM_BAIXO',
         format('%s km com %s L (%s km/l; o normal deste carro é %s)',
                iv.km, round(iv.litros_anterior, 1), coalesce(iv.km_por_litro, 0),
                round(m.med::numeric, 1))
    from iv join mediana m on m.veiculo_id = iv.veiculo_id
   where m.n >= 3 and iv.km >= 0 and iv.km_por_litro < m.med / 3
  union all
  select a.id, a.veiculo_id, a.data, a.tecnico_id, 'SEM_HODOMETRO', 'lançado sem odômetro'
    from abastecimento a
   where a.empresa_id = minha_empresa()
     and a.situacao in ('APROVADO', 'ABASTECIDO')
     and a.data between p_de and p_ate and a.hodometro is null
     and (select tem_permissao('frota.ver'));
$fn$;
revoke all on function frota_excecoes(date, date) from public, anon;
grant execute on function frota_excecoes(date, date) to authenticated;

-- A lista de veículos com o que a tela precisa: condutor atual, odômetro
-- atual (o maior conhecido) e a última movimentação.
create or replace function frota_painel()
returns table (id uuid, placa text, apelido text, modelo text, tipo text, ano int,
               propriedade text, rastreador text, situacao text, situacao_em timestamptz,
               base_id uuid, arquivado_em timestamptz, arquivado_motivo text,
               condutor_id uuid, condutor_nome text, condutor_desde timestamptz,
               hodometro_atual int, ultimo_abastecimento date, manutencao_aberta boolean)
language sql stable security definer set search_path to 'public' as $fn$
  select v.id, v.placa, v.apelido, v.modelo, v.tipo, v.ano, v.propriedade, v.rastreador,
         v.situacao, v.situacao_em, v.base_id, v.arquivado_em, v.arquivado_motivo,
         c.tecnico_id, t.nome, c.desde,
         greatest(v.hodometro_cadastro,
                  (select max(a.hodometro) from abastecimento a
                    where a.veiculo_id = v.id and a.situacao <> 'CANCELADO'),
                  (select max(m.hodometro) from manutencao m
                    where m.veiculo_id = v.id and m.situacao <> 'CANCELADA')),
         (select max(a.data) from abastecimento a
           where a.veiculo_id = v.id and a.situacao <> 'CANCELADO'),
         exists (select 1 from manutencao m where m.veiculo_id = v.id and m.situacao = 'ABERTA')
    from veiculo v
    left join veiculo_condutor c on c.veiculo_id = v.id and c.ate is null
    left join tecnico t on t.id = c.tecnico_id
   where v.empresa_id = minha_empresa()
     and (select tem_permissao('frota.ver'))
   order by v.arquivado_em nulls first, coalesce(v.apelido, v.placa);
$fn$;
revoke all on function frota_painel() from public, anon;
grant execute on function frota_painel() to authenticated;

notify pgrst, 'reload schema';
