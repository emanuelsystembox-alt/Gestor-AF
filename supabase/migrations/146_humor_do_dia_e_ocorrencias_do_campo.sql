-- 146 · O humor do dia e as ocorrências do campo (D-226)
--
-- > "toda vez que o técnico logar depois das 6 horas da manhã, todos os
-- > dias o sistema deve mostrar uma pesquisa de como o técnico se sente
-- > naquele dia […] O técnico não poderá pular esta etapa […] precisa ter
-- > uma parte no aplicativo que sinalize […] que ele perdeu um ferramental,
-- > que ele está trabalhando com um ferramental com problema […] o carro
-- > […] com problema na bomba de combustível, o carro está esquentando
-- > […] como o técnico está se sentindo, somente os coordenadores. E o que
-- > está faltando para o técnico, coordenadores e supervisores."
-- > — Emanuel, 26/10
--
-- Perguntado antes de escrever (26/10):
--   · as 5 opções: Feliz, Indiferente, Desanimado, Triste, ESTRESSADO;
--   · quem vê: duas permissões novas + um perfil de acesso "Coordenador"
--     (não existia papel nem perfil; o cargo tinha 0 pessoas);
--   · o canal de ferramental AMPLIA o "Sinalizar" da 091 (não é outro);
--   · a lista de problemas de veículo: a proposta, aprovada como está.
--
-- ┌─ o que esta migration faz ─────────────────────────────────────────┐
-- │ 1. permissões campo.humor e campo.ocorrencias; perfil Coordenador  │
-- │    (as duas), Supervisor (+ ocorrências), Administrador (as duas). │
-- │ 2. humor_diario: uma resposta por técnico por dia (hoje_local()).  │
-- │    Só quem tem campo.humor lê — e só das cidades que vê.           │
-- │ 3. sinalizacao_material ganha ASSUNTO (FERRAMENTAL/VEICULO), dois  │
-- │    motivos novos (PERDIDO, DESGASTADO) e o problema do carro.      │
-- │ 4. quem responde: almoxarifado (só ferramental, como era) ou quem  │
-- │    tem campo.ocorrencias (tudo, nas cidades que vê).               │
-- └────────────────────────────────────────────────────────────────────┘

-- ---------------------------------------------------------------------------
-- 1. Permissões e o perfil Coordenador
-- ---------------------------------------------------------------------------
insert into permissao (chave, modulo, rotulo, descricao, ordem, disponivel) values
  ('campo.humor', 'CAMPO', 'Ver o humor das equipes',
   'Como cada técnico disse que se sente no dia (pesquisa obrigatória do aplicativo).', 1, true),
  ('campo.ocorrencias', 'CAMPO', 'Ver e responder ocorrências do campo',
   'Ferramental perdido, velho ou com defeito, e problema no carro, avisados pelo técnico.', 2, true)
on conflict (chave) do nothing;

-- Coordenador nasce com o papel SUPERVISOR (é o papel de gestão mais
-- próximo: entra no controle e vê as equipes) + as duas chaves novas.
insert into perfil_acesso (empresa_id, nome, descricao, papel, ordem, ativo)
select s.empresa_id, 'Coordenador',
       'Coordena supervisores e equipes: vê o humor e as ocorrências do campo',
       'SUPERVISOR', s.ordem, true
  from perfil_acesso s
 where s.nome = 'Supervisor'
   and not exists (select 1 from perfil_acesso c
                    where c.empresa_id = s.empresa_id and c.nome = 'Coordenador');

insert into perfil_acesso_permissao (perfil_acesso_id, permissao_chave)
select c.id, pap.permissao_chave
  from perfil_acesso c
  join perfil_acesso s on s.empresa_id = c.empresa_id and s.nome = 'Supervisor'
  join perfil_acesso_permissao pap on pap.perfil_acesso_id = s.id
 where c.nome = 'Coordenador'
on conflict do nothing;

insert into perfil_acesso_permissao (perfil_acesso_id, permissao_chave)
select pa.id, k.chave
  from perfil_acesso pa
  join (values ('Coordenador', 'campo.humor'), ('Coordenador', 'campo.ocorrencias'),
               ('Administrador', 'campo.humor'), ('Administrador', 'campo.ocorrencias'),
               ('Supervisor', 'campo.ocorrencias')) k(perfil, chave)
    on k.perfil = pa.nome
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. O humor do dia
-- ---------------------------------------------------------------------------
-- Uma linha por técnico por DIA LOCAL (hoje_local(), nunca current_date:
-- em Manaus o dia UTC vira às 20h). A primeira resposta vale; não se edita
-- — é o retrato da manhã, não um campo para acertar depois.
create table if not exists humor_diario (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresa(id),
  tecnico_id    uuid not null references tecnico(id),
  dia           date not null,
  humor         text not null
                check (humor in ('FELIZ', 'INDIFERENTE', 'DESANIMADO', 'TRISTE', 'ESTRESSADO')),
  -- a hora em que o técnico tocou (pode ter subido depois, sem sinal)
  respondido_em timestamptz not null,
  criado_em     timestamptz not null default now(),
  criado_por    uuid not null,
  unique (tecnico_id, dia)
);
create index if not exists humor_diario_dia_idx on humor_diario (empresa_id, dia);
alter table humor_diario enable row level security;

-- Sem policy de escrita: só a RPC grava (o autor é o servidor, D-061).
drop policy if exists humor_leitura on humor_diario;
create policy humor_leitura on humor_diario for select to authenticated using (
  empresa_id = (select minha_empresa())
  and (tecnico_id = (select meu_tecnico_id())
       or ((select tem_permissao('campo.humor'))
           and tecnico_id in (select t.id from tecnico t
                               where t.base_id in (select bases_visiveis()))))
);

-- p_dia existe por causa da fila sem sinal: a resposta das 7h que só sobe
-- às 21h é do dia em que foi dada. Aceita hoje ou ontem; mais que isso é
-- relógio errado, e vale hoje.
create or replace function registrar_humor(p_humor text, p_dia date default null,
                                           p_respondido_em timestamptz default null)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare v_tec uuid := meu_tecnico_id(); v_dia date;
begin
  if v_tec is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  if p_humor not in ('FELIZ', 'INDIFERENTE', 'DESANIMADO', 'TRISTE', 'ESTRESSADO') then
    raise exception 'Resposta invalida.' using errcode = '23514';
  end if;
  v_dia := case when p_dia between hoje_local() - 1 and hoje_local() then p_dia
                else hoje_local() end;
  insert into humor_diario (empresa_id, tecnico_id, dia, humor, respondido_em, criado_por)
  values (minha_empresa(), v_tec, v_dia, p_humor,
          case when p_respondido_em between now() - interval '2 days' and now()
               then p_respondido_em else now() end,
          auth.uid())
  on conflict (tecnico_id, dia) do nothing;
end;
$fn$;
revoke all on function registrar_humor(text, date, timestamptz) from public, anon;
grant execute on function registrar_humor(text, date, timestamptz) to authenticated;

-- O app pergunta "já respondi hoje?" — nulo é "ainda não".
create or replace function humor_de_hoje()
returns text language sql stable security definer set search_path to 'public' as $fn$
  select humor from humor_diario
   where tecnico_id = meu_tecnico_id() and dia = hoje_local();
$fn$;
revoke all on function humor_de_hoje() from public, anon;
grant execute on function humor_de_hoje() to authenticated;

-- O painel da coordenação. "Sem resposta" só para quem ESTAVA ESCALADO no
-- dia (a equipe dele tinha visita) — técnico de folga que não respondeu não
-- é "sem resposta", e contar como tal inflaria a falta (D-117: zero e
-- desconhecido não são a mesma coisa).
create or replace function humor_das_equipes(p_de date, p_ate date)
returns table (dia date, tecnico_id uuid, tecnico text, equipe text, base text,
               humor text, respondido_em timestamptz)
language plpgsql stable security definer set search_path to 'public' as $fn$
begin
  if not tem_permissao('campo.humor') then
    raise exception 'Seu perfil de acesso nao inclui "Ver o humor das equipes".'
      using errcode = '42501';
  end if;
  if p_ate - p_de > 92 then
    raise exception 'Periodo maximo: 93 dias.' using errcode = '22023';
  end if;
  return query
  with tecs as materialized (
    select t.id, t.nome, t.equipe_id, t.base_id
      from tecnico t
     where t.empresa_id = minha_empresa()
       and t.base_id in (select bases_visiveis())
  ), respostas as (
    select h.dia, h.tecnico_id, h.humor, h.respondido_em
      from humor_diario h
     where h.empresa_id = minha_empresa() and h.dia between p_de and p_ate
       and h.tecnico_id in (select id from tecs)
  ), escalados as (
    select distinct v.data_agendada as dia, t.id as tecnico_id
      from visita v
      join tecs t on t.equipe_id = v.equipe_id
      join tecnico tt on tt.id = t.id
     where v.data_agendada between p_de and p_ate
       and tt.situacao = 'ATIVO' and tt.usuario_id is not null
  )
  select x.dia, x.tecnico_id, t.nome, e.codigo, b.nome, r.humor, r.respondido_em
    from (select r2.dia, r2.tecnico_id from respostas r2
          union
          select es.dia, es.tecnico_id from escalados es) x
    join tecs t on t.id = x.tecnico_id
    left join respostas r on r.dia = x.dia and r.tecnico_id = x.tecnico_id
    left join equipe e on e.id = t.equipe_id
    left join base b on b.id = t.base_id
   order by x.dia desc, t.nome;
end;
$fn$;
revoke all on function humor_das_equipes(date, date) from public, anon;
grant execute on function humor_das_equipes(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ocorrências: o "Sinalizar" da 091, ampliado
-- ---------------------------------------------------------------------------
-- A lista de problemas do carro é CADASTRO (por empresa), não CHECK: a
-- frota acrescenta sem migration. "Outro" exige descrição.
create table if not exists problema_veiculo (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references empresa(id),
  codigo           text not null,
  rotulo           text not null,
  ordem            smallint not null default 0,
  exige_descricao  boolean not null default false,
  ativo            boolean not null default true,
  unique (empresa_id, codigo)
);
alter table problema_veiculo enable row level security;
drop policy if exists problema_veiculo_leitura on problema_veiculo;
create policy problema_veiculo_leitura on problema_veiculo for select to authenticated
  using (empresa_id = (select minha_empresa()));

insert into problema_veiculo (empresa_id, codigo, rotulo, ordem, exige_descricao)
select e.id, p.codigo, p.rotulo, p.ordem, p.exige
  from empresa e
 cross join (values
   ('MOTOR_ESQUENTANDO', 'Motor esquentando',            1, false),
   ('COMBUSTIVEL',       'Bomba / falha de combustível', 2, false),
   ('FREIO',             'Freio',                        3, false),
   ('PNEU',              'Pneu ou estepe',               4, false),
   ('BATERIA',           'Bateria / não pega',           5, false),
   ('ELETRICA',          'Luzes ou parte elétrica',      6, false),
   ('SUSPENSAO',         'Barulho / suspensão',          7, false),
   ('OLEO',              'Óleo ou vazamento',            8, false),
   ('AR',                'Ar-condicionado',              9, false),
   ('AVARIA',            'Batida ou avaria',            10, false),
   ('DOCUMENTO',         'Documento / licenciamento',   11, false),
   ('OUTRO',             'Outro',                       99, true)
 ) p(codigo, rotulo, ordem, exige)
on conflict (empresa_id, codigo) do nothing;

alter table sinalizacao_material
  add column if not exists assunto text not null default 'FERRAMENTAL'
    check (assunto in ('FERRAMENTAL', 'VEICULO')),
  add column if not exists problema_id uuid references problema_veiculo(id),
  add column if not exists veiculo_id uuid references veiculo(id);

-- Lista fechada em CHECK pega tipo novo (traps.md): amplia aqui mesmo.
alter table sinalizacao_material drop constraint if exists sinalizacao_material_tipo_check;
alter table sinalizacao_material add constraint sinalizacao_material_tipo_check
  check (tipo in ('FALTANDO', 'PERDIDO', 'DEFEITO', 'DESGASTADO', 'VEICULO'));

-- O assunto e o tipo andam juntos: veículo tem problema; ferramental não.
alter table sinalizacao_material drop constraint if exists sinalizacao_assunto_coerente;
alter table sinalizacao_material add constraint sinalizacao_assunto_coerente check (
  (assunto = 'VEICULO' and tipo = 'VEICULO' and problema_id is not null)
  or (assunto = 'FERRAMENTAL' and tipo <> 'VEICULO' and problema_id is null and veiculo_id is null));

alter table sinalizacao_material drop constraint if exists sinalizacao_diz_o_que;
alter table sinalizacao_material add constraint sinalizacao_diz_o_que check (
  item_id is not null or problema_id is not null
  or nullif(btrim(coalesce(serial, '')), '') is not null
  or nullif(btrim(coalesce(descricao, '')), '') is not null);

-- Quem lê: o próprio técnico; o almoxarifado, só o ferramental (como era);
-- quem tem campo.ocorrencias, tudo — das cidades que vê.
drop policy if exists sinalizacao_leitura on sinalizacao_material;
create policy sinalizacao_leitura on sinalizacao_material for select to authenticated using (
  empresa_id = (select minha_empresa())
  and (tecnico_id = (select meu_tecnico_id())
       or (assunto = 'FERRAMENTAL' and (select tem_permissao('almoxarifado.ver')))
       or ((select tem_permissao('campo.ocorrencias'))
           and tecnico_id in (select t.id from tecnico t
                               where t.base_id in (select bases_visiveis()))))
);

-- sinalizar_material segue sendo o ferramental: recusa VEICULO, que tem
-- porta própria (o carro é o do nome dele, não escolhido pelo cliente).
create or replace function sinalizar_material(p_tipo text, p_item_id uuid,
                                              p_serial text, p_descricao text)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_tec uuid := meu_tecnico_id(); v_id uuid;
begin
  if v_tec is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  if p_tipo not in ('FALTANDO', 'PERDIDO', 'DEFEITO', 'DESGASTADO') then
    raise exception 'Motivo invalido para ferramental.' using errcode = '23514';
  end if;
  if p_item_id is not null and not exists (
       select 1 from item_miscelanea where id = p_item_id and empresa_id = minha_empresa()) then
    raise exception 'Item nao encontrado.' using errcode = 'P0002';
  end if;
  insert into sinalizacao_material (empresa_id, tecnico_id, tipo, item_id, serial,
                                    descricao, criado_por)
  values (minha_empresa(), v_tec, p_tipo, p_item_id,
          nullif(upper(btrim(coalesce(p_serial, ''))), ''),
          nullif(btrim(coalesce(p_descricao, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function sinalizar_material(text, uuid, text, text) from public, anon;
grant execute on function sinalizar_material(text, uuid, text, text) to authenticated;

-- O problema do carro. O carro é o que está no NOME dele (condutor atual,
-- como no abastecimento — 091-6b). Sem carro no nome a ocorrência entra
-- assim mesmo, com veiculo_id nulo: a tela diz "sem carro no cadastro",
-- e o defeito do carro não fica sem registro por falta de cadastro.
create or replace function sinalizar_veiculo(p_problema_id uuid, p_descricao text)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_tec uuid := meu_tecnico_id(); v_id uuid; p problema_veiculo%rowtype; v_veic uuid;
begin
  if v_tec is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  select * into p from problema_veiculo
   where id = p_problema_id and empresa_id = minha_empresa() and ativo;
  if not found then raise exception 'Problema nao encontrado.' using errcode = 'P0002'; end if;
  if p.exige_descricao and nullif(btrim(coalesce(p_descricao, '')), '') is null then
    raise exception 'Descreva o problema.' using errcode = '23514';
  end if;
  select c.veiculo_id into v_veic
    from veiculo_condutor c join veiculo v on v.id = c.veiculo_id
   where c.tecnico_id = v_tec and c.ate is null and v.arquivado_em is null
   order by c.desde desc limit 1;
  insert into sinalizacao_material (empresa_id, tecnico_id, assunto, tipo, problema_id,
                                    veiculo_id, descricao, criado_por)
  values (minha_empresa(), v_tec, 'VEICULO', 'VEICULO', p.id, v_veic,
          nullif(btrim(coalesce(p_descricao, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function sinalizar_veiculo(uuid, text) from public, anon;
grant execute on function sinalizar_veiculo(uuid, text) to authenticated;

-- Colunas novas no retorno: create or replace não aceita (traps.md).
-- Recriada do zero nasce com a ACL aberta: revoke logo abaixo.
drop function if exists minhas_sinalizacoes();
create function minhas_sinalizacoes()
returns table (id uuid, assunto text, tipo text, item text, serial text, problema text,
               placa text, descricao text, situacao text, criado_em timestamptz,
               resolvido_em timestamptz, resposta text)
language sql stable security definer set search_path to 'public' as $fn$
  select s.id, s.assunto, s.tipo, i.nome, s.serial, p.rotulo, v.placa, s.descricao,
         s.situacao, s.criado_em, s.resolvido_em, s.resposta
    from sinalizacao_material s
    left join item_miscelanea i on i.id = s.item_id
    left join problema_veiculo p on p.id = s.problema_id
    left join veiculo v on v.id = s.veiculo_id
   where s.tecnico_id = meu_tecnico_id()
   order by s.criado_em desc limit 50;
$fn$;
revoke all on function minhas_sinalizacoes() from public, anon;
grant execute on function minhas_sinalizacoes() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Quem responde
-- ---------------------------------------------------------------------------
create or replace function resolver_sinalizacao(p_id uuid, p_situacao text, p_resposta text)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare s sinalizacao_material%rowtype; v_eq uuid; v_o_que text; v_pode boolean;
begin
  if p_situacao not in ('ATENDIDA', 'RECUSADA') then
    raise exception 'A resposta e ATENDIDA ou RECUSADA.' using errcode = '23514';
  end if;
  if p_situacao = 'RECUSADA' and nullif(btrim(coalesce(p_resposta, '')), '') is null then
    raise exception 'Recusar exige dizer o motivo ao tecnico.' using errcode = '23514';
  end if;
  select * into s from sinalizacao_material
   where id = p_id and empresa_id = minha_empresa() for update;
  if not found then raise exception 'Sinalizacao nao encontrada.' using errcode = 'P0002'; end if;

  -- O almoxarifado responde o ferramental, como na 091; a coordenação e a
  -- supervisão (campo.ocorrencias) respondem tudo das cidades que veem.
  v_pode := (tem_permissao('campo.ocorrencias')
             and exists (select 1 from tecnico t where t.id = s.tecnico_id
                           and t.base_id in (select bases_visiveis())))
         or (s.assunto = 'FERRAMENTAL' and (eh_gestor() or tem_papel('ALMOXARIFE'))
             and tem_permissao('almoxarifado.editar'));
  if not v_pode then
    raise exception 'Sem permissao para responder esta ocorrencia.' using errcode = '42501';
  end if;
  if s.situacao <> 'ABERTA' then
    raise exception 'Esta sinalizacao ja foi respondida.' using errcode = '23514';
  end if;

  update sinalizacao_material
     set situacao = p_situacao, resposta = nullif(btrim(coalesce(p_resposta, '')), ''),
         resolvido_em = now(), resolvido_por = auth.uid()
   where id = p_id;

  select equipe_id into v_eq from tecnico where id = s.tecnico_id;
  if s.assunto = 'VEICULO' then
    select concat_ws(' · ', p.rotulo, v.placa) into v_o_que
      from problema_veiculo p left join veiculo v on v.id = s.veiculo_id
     where p.id = s.problema_id;
  else
    select coalesce(i.nome, s.serial, s.descricao) into v_o_que
      from (select 1) x left join item_miscelanea i on i.id = s.item_id;
  end if;
  if v_eq is not null then
    insert into aviso (empresa_id, equipe_id, tipo, titulo, detalhe, autor_login)
    values (s.empresa_id, v_eq, 'MATERIAL',
            case p_situacao when 'ATENDIDA' then 'Sua ocorrência foi atendida'
                            else 'Sua ocorrência foi recusada' end,
            concat_ws(' — ', v_o_que, nullif(btrim(coalesce(p_resposta, '')), '')),
            (select coalesce(nullif(apelido, ''), nome) from perfil where id = auth.uid()));
  end if;
end;
$fn$;
revoke all on function resolver_sinalizacao(uuid, text, text) from public, anon;
grant execute on function resolver_sinalizacao(uuid, text, text) to authenticated;

-- A central do almoxarifado conta só o FERRAMENTAL: o carro não é com ele.
-- Troca de UM trecho na função viva (traps.md: o arquivo pode estar atrás
-- do banco) — e recusa se o trecho não estiver lá exatamente uma vez.
do $$
declare d text := pg_get_functiondef('central_do_controle'::regproc);
        de text := $t$where s.empresa_id = minha_empresa() and s.situacao = 'ABERTA';$t$;
        para text := $t$where s.empresa_id = minha_empresa() and s.situacao = 'ABERTA'
       and s.assunto = 'FERRAMENTAL';$t$;
begin
  if (length(d) - length(replace(d, de, ''))) / length(de) <> 1 then
    raise exception 'central_do_controle mudou: o trecho do material nao esta la uma vez so';
  end if;
  execute replace(d, de, para);
end $$;

notify pgrst, 'reload schema';
