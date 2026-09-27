-- ============================================================================
-- 089 · O estoque ganha os menus que faltavam (e a frota diz onde o carro dorme)
-- ============================================================================
--
-- > "estou achando bem simples o nosso, tipo poucas opções" · "o técnico
-- >  envia, o outro aceita, e o time central do almox precisa aprovar" ·
-- > "quantos carros alugados temos, e carros próprios, quantos levam carro
-- >  pra casa e quantos não"  — Emanuel, 26/09
--
-- Comparado menu a menu com o Alfa Gestor da AFLINE (D-165). Faltavam:
--   A · frota: onde o carro DORME (casa ou base)
--   B · catálogo com tipo, valor, C.A. do EPI — e a carga dos 420 itens
--       ativos do concorrente vem na 089b
--   C · transferência PEDIDA PELO TÉCNICO: origem envia → destino aceita
--       no celular → almoxarifado aprova. Só na aprovação a posse muda.
--   D · baixa de miscelânea por contrato (o que foi gasto no serviço)
--   E · auditoria: contar e ajustar o saldo, com motivo
--   F · cargas por técnico (o "Equipes / Alocações" deles)
--   G · histórico do serial e movimentações do período
--   H · Kardex da miscelânea (saldo anterior, movimento, saldo atual)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- A · Frota: onde o carro dorme
-- ---------------------------------------------------------------------------
-- "CASA/FROTA PRÓPRIA" no concorrente é propriedade × pernoite num campo
-- só. Aqui são dois, para responder as duas perguntas do Emanuel.
alter table veiculo add column if not exists pernoite text
  check (pernoite in ('CASA', 'BASE'));

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
                         propriedade, pernoite, rastreador, situacao, situacao_por,
                         hodometro_cadastro, observacao, criado_por)
    values (v_emp, nullif(p_dados->>'base_id','')::uuid, v_placa,
            nullif(btrim(p_dados->>'apelido'),''), nullif(btrim(p_dados->>'modelo'),''),
            nullif(p_dados->>'tipo',''), nullif(p_dados->>'ano','')::int,
            nullif(btrim(p_dados->>'chassi'),''), nullif(btrim(p_dados->>'renavam'),''),
            nullif(p_dados->>'propriedade',''), nullif(p_dados->>'pernoite',''),
            nullif(btrim(p_dados->>'rastreador'),''),
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
      propriedade = nullif(p_dados->>'propriedade',''), pernoite = nullif(p_dados->>'pernoite',''),
      rastreador = nullif(btrim(p_dados->>'rastreador'),''),
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

drop function if exists frota_painel();
create function frota_painel()
returns table (id uuid, placa text, apelido text, modelo text, tipo text, ano int,
               propriedade text, pernoite text, rastreador text, situacao text,
               situacao_em timestamptz, base_id uuid, arquivado_em timestamptz,
               arquivado_motivo text, condutor_id uuid, condutor_nome text,
               condutor_desde timestamptz, hodometro_atual int, ultimo_abastecimento date,
               manutencao_aberta boolean)
language sql stable security definer set search_path to 'public' as $fn$
  select v.id, v.placa, v.apelido, v.modelo, v.tipo, v.ano, v.propriedade, v.pernoite,
         v.rastreador, v.situacao, v.situacao_em, v.base_id, v.arquivado_em, v.arquivado_motivo,
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


-- ---------------------------------------------------------------------------
-- B · O catálogo de miscelânea ganha tipo, valor e C.A.
-- ---------------------------------------------------------------------------
-- Os tipos são os do concorrente, com nome nosso: FERRAMENTA (SEG. TRAB -
-- FERRAMENTAS), EPI (SEG. TRAB - EPI E EPC), MATERIAL (EMIS — material de
-- instalação que vai para a casa do cliente) e ACESSORIO.
alter table item_miscelanea
  add column if not exists tipo text check (tipo in ('MATERIAL', 'FERRAMENTA', 'EPI', 'ACESSORIO')),
  add column if not exists valor numeric(12,2) check (valor >= 0),
  -- Certificado de Aprovação do EPI (o concorrente guarda no campo código).
  add column if not exists ca text,
  -- Pode ser consumido no contrato ("is_permission_baixa" lá).
  add column if not exists consumivel boolean not null default false,
  -- Id no sistema anterior: reimportar não duplica.
  add column if not exists origem_id int;
create unique index if not exists item_miscelanea_origem_uk
  on item_miscelanea (empresa_id, origem_id) where origem_id is not null;
-- A coluna nasceu NOT NULL (078). Sem isto, a carga da 089b morre no
-- primeiro item sem código SAP — foi o que aconteceu na primeira tentativa.
alter table item_miscelanea alter column codigo drop not null;

-- Código deixa de ser obrigatório: ferramenta e EPI não têm código SAP
-- (lá vinham "0000", "-", ou a marca no lugar do código).
drop function if exists salvar_item_miscelanea(uuid, text, text, text, boolean);
create function salvar_item_miscelanea(p_id uuid, p_dados jsonb)
returns uuid
language plpgsql security definer set search_path to 'public' as $fn$
declare v_id uuid;
begin
  perform almox_pode_mexer();
  if btrim(coalesce(p_dados->>'nome','')) = '' then
    raise exception 'Nome e obrigatorio.' using errcode = '23514';
  end if;
  if p_id is null then
    insert into item_miscelanea (empresa_id, codigo, nome, unidade, ativo, tipo, valor, ca,
                                 consumivel, criado_por)
    values (minha_empresa(), nullif(upper(btrim(coalesce(p_dados->>'codigo',''))),''),
            btrim(p_dados->>'nome'),
            upper(coalesce(nullif(btrim(p_dados->>'unidade'),''),'UN')),
            coalesce((p_dados->>'ativo')::boolean, true),
            nullif(p_dados->>'tipo',''), nullif(p_dados->>'valor','')::numeric,
            nullif(btrim(coalesce(p_dados->>'ca','')),''),
            coalesce((p_dados->>'consumivel')::boolean, false), auth.uid())
    returning id into v_id;
  else
    update item_miscelanea
       set codigo = nullif(upper(btrim(coalesce(p_dados->>'codigo',''))),''),
           nome = btrim(p_dados->>'nome'),
           unidade = upper(coalesce(nullif(btrim(p_dados->>'unidade'),''),'UN')),
           ativo = coalesce((p_dados->>'ativo')::boolean, true),
           tipo = nullif(p_dados->>'tipo',''),
           valor = nullif(p_dados->>'valor','')::numeric,
           ca = nullif(btrim(coalesce(p_dados->>'ca','')),''),
           consumivel = coalesce((p_dados->>'consumivel')::boolean, false)
     where id = p_id and empresa_id = minha_empresa()
    returning id into v_id;
    if v_id is null then raise exception 'Item nao encontrado.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$fn$;
revoke all on function salvar_item_miscelanea(uuid, jsonb) from public, anon;
grant execute on function salvar_item_miscelanea(uuid, jsonb) to authenticated;

-- O saldo passa a trazer tipo, valor e C.A. `returns table` mudou: DROP.
drop function if exists miscelanea_saldos();
create function miscelanea_saldos()
returns table (item_id uuid, codigo text, nome text, unidade text, tipo text, valor numeric,
               ca text, consumivel boolean, no_almoxarifado numeric, com_tecnicos numeric,
               por_tecnico jsonb)
language sql stable security definer set search_path to 'public' as $fn$
  with permitido as (
    select eh_gestor() or tem_permissao('almoxarifado.ver') as ok
  ),
  mov as materialized (
    select m.* from miscelanea_movimento m, permitido p
     where p.ok and m.empresa_id = minha_empresa()
  )
  select i.id, i.codigo, i.nome, i.unidade, i.tipo, i.valor, i.ca, i.consumivel,
         coalesce((select sum(quantidade) from mov
                    where item_id = i.id and tecnico_id is null), 0),
         coalesce((select sum(quantidade) from mov
                    where item_id = i.id and tecnico_id is not null), 0),
         coalesce((select jsonb_agg(jsonb_build_object(
                            'tecnico_id', x.tecnico_id, 'tecnico', t.nome,
                            'matricula', t.matricula, 'qtd', x.q) order by x.q desc)
                     from (select tecnico_id, sum(quantidade) as q from mov
                            where item_id = i.id and tecnico_id is not null
                            group by tecnico_id having sum(quantidade) <> 0) x
                     join tecnico t on t.id = x.tecnico_id), '[]'::jsonb)
    from item_miscelanea i, permitido p
   where p.ok and i.empresa_id = minha_empresa() and i.ativo
   order by i.tipo nulls last, i.nome;
$fn$;
revoke all on function miscelanea_saldos() from public, anon;
grant execute on function miscelanea_saldos() to authenticated;


-- ---------------------------------------------------------------------------
-- C · Transferência pedida pelo técnico
-- ---------------------------------------------------------------------------
-- > "o técnico envia, o outro aceita, e o time central do almox precisa
-- >  aprovar"  — Emanuel
--
-- Três mãos, cada uma com o seu registro:
--   origem   → `solicitar_transferencia` (o documento nasce dele)
--   destino  → `confirmar_romaneio` grava o ACEITE (aparelho ou senha)
--   almox    → `confirmar_romaneio` APROVA; só aí posse e saldo se movem
-- Transferência aberta pelo almoxarifado continua como era (087): o
-- aceite do destino já move, porque o almoxarifado é quem montou.
alter table romaneio
  add column if not exists solicitado_por_tecnico boolean not null default false,
  add column if not exists aceito_em timestamptz,
  add column if not exists aceito_por uuid,
  add column if not exists aceito_metodo text check (aceito_metodo in ('APARELHO', 'SENHA'));

alter table miscelanea_movimento
  add column if not exists visita_id uuid references visita(id);
alter table miscelanea_movimento drop constraint if exists miscelanea_movimento_tipo_check;
alter table miscelanea_movimento add constraint miscelanea_movimento_tipo_check
  check (tipo in ('ENTRADA', 'ENTREGA', 'DEVOLUCAO', 'AJUSTE', 'TRANSFERENCIA', 'CONSUMO'));

-- Os colegas para quem ele pode mandar. O técnico só lê a própria equipe
-- na tabela `tecnico` (RLS); aqui ele vê nome e matrícula dos ativos da
-- empresa, e nada mais.
create or replace function tecnicos_para_transferir()
returns table (id uuid, nome text, matricula text)
language sql stable security definer set search_path to 'public' as $fn$
  select t.id, t.nome, t.matricula from tecnico t
   where t.empresa_id = minha_empresa() and t.situacao = 'ATIVO'
     and t.id is distinct from meu_tecnico_id()
     and (meu_tecnico_id() is not null or tem_permissao('almoxarifado.ver'))
   order by t.nome;
$fn$;
revoke all on function tecnicos_para_transferir() from public, anon;
grant execute on function tecnicos_para_transferir() to authenticated;

-- A miscelânea que está com ele (para escolher o que transferir).
create or replace function minha_miscelanea()
returns table (item_id uuid, codigo text, nome text, unidade text, tipo text, saldo numeric)
language sql stable security definer set search_path to 'public' as $fn$
  with meu as materialized (select meu_tecnico_id() as tecnico)
  select i.id, i.codigo, i.nome, i.unidade, i.tipo, sum(m.quantidade)
    from miscelanea_movimento m join item_miscelanea i on i.id = m.item_id, meu
   where m.tecnico_id = meu.tecnico and m.empresa_id = minha_empresa()
   group by i.id
  having sum(m.quantidade) > 0
   order by i.nome;
$fn$;
revoke all on function minha_miscelanea() from public, anon;
grant execute on function minha_miscelanea() to authenticated;

create or replace function solicitar_transferencia(p_destino uuid, p_seriais text[],
                                                   p_itens jsonb, p_observacao text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare v_origem uuid := meu_tecnico_id(); v_emp uuid := minha_empresa();
        v_id uuid; v_num int; v_serial text; v_e equipamento%rowtype; v_it jsonb;
        v_qtd numeric; v_saldo numeric; v_venc jsonb; v_n int := 0;
begin
  if v_origem is null then
    raise exception 'So o tecnico pede transferencia da propria carga.' using errcode = '42501';
  end if;
  if p_destino is null or p_destino = v_origem
     or not exists (select 1 from tecnico where id = p_destino and empresa_id = v_emp
                     and situacao = 'ATIVO') then
    raise exception 'Escolha um tecnico ativo, diferente de voce.' using errcode = '23514';
  end if;
  -- O prazo da carga vale para quem recebe (087-A), venha de onde vier.
  v_venc := carga_vencida_de(p_destino);
  if (v_venc->>'vencidos')::int > 0 then
    raise exception 'O colega nao pode receber: tem % peca(s) na carga ha mais de % dias.',
      v_venc->>'vencidos', v_venc->>'limite' using errcode = '23514';
  end if;
  if coalesce(array_length(p_seriais, 1), 0) = 0
     and coalesce(jsonb_array_length(p_itens), 0) = 0 then
    raise exception 'Escolha ao menos uma peca ou um material.' using errcode = '23514';
  end if;

  select coalesce(max(numero), 0) + 1 into v_num from romaneio where empresa_id = v_emp;
  insert into romaneio (empresa_id, numero, tipo, tecnico_id, tecnico_origem_id,
                        solicitado_por_tecnico, observacao, criado_por)
  values (v_emp, v_num, 'TRANSFERENCIA', p_destino, v_origem, true,
          nullif(btrim(coalesce(p_observacao,'')),''), auth.uid())
  returning id into v_id;

  foreach v_serial in array coalesce(p_seriais, '{}') loop
    v_serial := upper(regexp_replace(coalesce(v_serial, ''), '\s', '', 'g'));
    continue when v_serial = '';
    select * into v_e from equipamento where empresa_id = v_emp and serial = v_serial;
    if not found or v_e.posse is distinct from 'COM_TECNICO'
       or v_e.posse_tecnico_id is distinct from v_origem then
      raise exception 'A peca % nao esta na sua carga.', v_serial using errcode = '23514';
    end if;
    if exists (select 1 from romaneio_item ri join romaneio r on r.id = ri.romaneio_id
                where ri.equipamento_id = v_e.id and r.situacao = 'ABERTO' and r.id <> v_id) then
      raise exception 'A peca % ja esta em outro romaneio aberto.', v_serial using errcode = '23505';
    end if;
    insert into romaneio_item (romaneio_id, equipamento_id, quantidade, criado_por)
    values (v_id, v_e.id, 1, auth.uid()) on conflict do nothing;
    v_n := v_n + 1;
  end loop;

  for v_it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_qtd := nullif(v_it->>'quantidade','')::numeric;
    continue when v_qtd is null or v_qtd <= 0;
    select coalesce(sum(quantidade), 0) into v_saldo from miscelanea_movimento
     where item_id = (v_it->>'item_id')::uuid and tecnico_id = v_origem and empresa_id = v_emp;
    if v_saldo < v_qtd then
      raise exception 'Voce tem % de %, nao da para mandar %.', v_saldo,
        (select nome from item_miscelanea where id = (v_it->>'item_id')::uuid), v_qtd
        using errcode = '23514';
    end if;
    insert into romaneio_item (romaneio_id, item_id, quantidade, criado_por)
    values (v_id, (v_it->>'item_id')::uuid, v_qtd, auth.uid());
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Nada valido para transferir.' using errcode = '23514';
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'lancamentos', v_n);
end;
$fn$;
revoke all on function solicitar_transferencia(uuid, text[], jsonb, text) from public, anon;
grant execute on function solicitar_transferencia(uuid, text[], jsonb, text) to authenticated;

-- Escrita a partir da versão VIVA (087), com o ramo da transferência pedida.
create or replace function confirmar_romaneio(p_romaneio uuid, p_metodo text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_r romaneio%rowtype; v_destino text; v_tec uuid; v_origem uuid;
  v_pecas int := 0; v_itens int := 0; v_saldo numeric; v_i record;
  v_meu uuid; v_pelo_tecnico boolean; v_metodo text;
begin
  select * into v_r from romaneio where id = p_romaneio and empresa_id = minha_empresa();
  if not found then raise exception 'Romaneio nao encontrado.' using errcode='P0002'; end if;
  if v_r.situacao <> 'ABERTO' then
    raise exception 'Romaneio % ja esta %.', v_r.numero, lower(v_r.situacao)
      using errcode = '23514';
  end if;

  v_meu := meu_tecnico_id();
  v_pelo_tecnico := v_meu is not distinct from v_r.tecnico_id;

  if v_pelo_tecnico and (p_metodo is null or p_metodo not in ('APARELHO', 'SENHA')) then
    raise exception 'O aceite do tecnico precisa dizer como foi feito: APARELHO ou SENHA.'
      using errcode = '23514';
  end if;

  -- 089-C: a transferência pedida pelo técnico tem dois passos.
  if v_r.solicitado_por_tecnico then
    if v_pelo_tecnico then
      if v_r.aceito_em is not null then
        raise exception 'Voce ja aceitou. Falta o almoxarifado aprovar.' using errcode = '23514';
      end if;
      update romaneio set aceito_em = now(), aceito_por = auth.uid(), aceito_metodo = p_metodo
       where id = p_romaneio;
      return jsonb_build_object('numero', v_r.numero, 'tipo', v_r.tipo,
                                'aguardando_aprovacao', true, 'metodo', p_metodo);
    end if;
    perform almox_pode_mexer();
    if v_r.aceito_em is null then
      raise exception 'O tecnico de destino ainda nao aceitou. A aprovacao vem depois do aceite.'
        using errcode = '23514';
    end if;
    -- O método que fica no documento é o do ACEITE de quem recebeu.
    v_metodo := v_r.aceito_metodo;
  elsif v_pelo_tecnico then
    v_metodo := p_metodo;
  else
    perform almox_pode_mexer();
    v_metodo := 'BALCAO';
  end if;

  if not exists (select 1 from romaneio_item where romaneio_id = p_romaneio) then
    raise exception 'Romaneio vazio nao se confirma.' using errcode = '23514';
  end if;

  if v_r.tipo = 'ENTREGA' then
    v_destino := 'COM_TECNICO'; v_tec := v_r.tecnico_id; v_origem := null;
  elsif v_r.tipo = 'TRANSFERENCIA' then
    v_destino := 'COM_TECNICO'; v_tec := v_r.tecnico_id; v_origem := v_r.tecnico_origem_id;
  else
    v_destino := 'NO_ALMOXARIFADO'; v_tec := null; v_origem := v_r.tecnico_id;
  end if;

  for v_i in select ri.item_id, ri.quantidade from romaneio_item ri
              where ri.romaneio_id = p_romaneio and ri.item_id is not null loop
    select coalesce(sum(quantidade), 0) into v_saldo from miscelanea_movimento
     where item_id = v_i.item_id and tecnico_id is not distinct from v_origem
       and empresa_id = v_r.empresa_id;
    if v_saldo < v_i.quantidade then
      raise exception 'Saldo insuficiente de % %: tem %, pediu %.',
        (select nome from item_miscelanea where id = v_i.item_id),
        case when v_origem is null then 'no almoxarifado' else 'com o tecnico de origem' end,
        v_saldo, v_i.quantidade using errcode = '23514';
    end if;
    insert into miscelanea_movimento (empresa_id, item_id, tecnico_id, quantidade,
                                      tipo, romaneio_id, criado_por)
    values
      (v_r.empresa_id, v_i.item_id, v_origem, -v_i.quantidade, v_r.tipo, p_romaneio, auth.uid()),
      (v_r.empresa_id, v_i.item_id, v_tec,     v_i.quantidade, v_r.tipo, p_romaneio, auth.uid());
    v_itens := v_itens + 1;
  end loop;

  if exists (
    select 1 from romaneio_item ri join equipamento e on e.id = ri.equipamento_id
     where ri.romaneio_id = p_romaneio
       and not ( (v_r.tipo = 'ENTREGA' and (e.posse is null or e.posse = 'NO_ALMOXARIFADO'))
              or (v_r.tipo <> 'ENTREGA' and e.posse = 'COM_TECNICO'
                  and e.posse_tecnico_id is not distinct from v_origem) )
  ) then
    raise exception 'Uma ou mais pecas ja nao estao onde o romaneio diz que saem (o campo pode ter instalado). Tire-as e confirme de novo.'
      using errcode = '23514';
  end if;

  update equipamento e
     set posse = v_destino, posse_tecnico_id = v_tec, posse_em = now(), posse_por = auth.uid(),
         posse_motivo = 'romaneio ' || v_r.numero,
         condicao = case when v_r.tipo = 'DEVOLUCAO' then v_r.condicao_destino else e.condicao end,
         atualizado_em = now()
    from romaneio_item ri
   where ri.romaneio_id = p_romaneio and ri.equipamento_id = e.id;
  get diagnostics v_pecas = row_count;

  update romaneio set situacao = 'CONFIRMADO', confirmado_em = now(),
                      confirmado_por = auth.uid(), confirmado_metodo = v_metodo
   where id = p_romaneio;

  return jsonb_build_object('numero', v_r.numero, 'tipo', v_r.tipo,
                            'pecas', v_pecas, 'itens', v_itens,
                            'posse', v_destino, 'metodo', v_metodo,
                            'aprovado_pelo_almoxarifado', v_r.solicitado_por_tecnico,
                            'confirmado_pelo_tecnico', v_pelo_tecnico);
end;
$fn$;

-- Cancelar: almoxarifado sempre; na transferência pedida, também a
-- origem (desistiu) e o destino (recusou) — com motivo.
create or replace function cancelar_romaneio(p_romaneio uuid, p_motivo text)
returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare v_r romaneio%rowtype; v_meu uuid := meu_tecnico_id();
begin
  select * into v_r from romaneio where id = p_romaneio and empresa_id = minha_empresa();
  if not found then raise exception 'Romaneio nao encontrado.' using errcode='P0002'; end if;
  if not (v_r.solicitado_por_tecnico and v_meu is not null
          and v_meu in (v_r.tecnico_origem_id, v_r.tecnico_id)) then
    perform almox_pode_mexer();
  end if;
  if v_r.situacao = 'CONFIRMADO' then
    raise exception 'Romaneio confirmado nao se cancela. Faca o documento inverso.'
      using errcode = '23514';
  end if;
  if v_r.situacao = 'CANCELADO' then return; end if;
  if btrim(coalesce(p_motivo,'')) = '' then
    raise exception 'Cancelamento exige motivo.' using errcode = '23514';
  end if;
  update romaneio set situacao = 'CANCELADO', cancelado_em = now(),
                      cancelado_por = auth.uid(), cancelado_motivo = btrim(p_motivo)
   where id = p_romaneio;
end;
$fn$;

drop function if exists meus_romaneios();
create function meus_romaneios()
returns table (id uuid, numero int, tipo text, situacao text,
               observacao text, criado_em timestamptz,
               confirmado_em timestamptz, confirmado_metodo text,
               eu_recebo boolean, outro_tecnico text, condicao_destino text,
               solicitado_por_tecnico boolean, aceito_em timestamptz,
               cancelado_motivo text, pecas jsonb, itens jsonb)
language sql stable security definer set search_path to 'public' as $fn$
  with meu as materialized (select meu_tecnico_id() as tecnico)
  select r.id, r.numero, r.tipo, r.situacao, r.observacao, r.criado_em,
         r.confirmado_em, r.confirmado_metodo,
         r.tecnico_id = m.tecnico,
         case when r.tipo = 'TRANSFERENCIA' then
           (select t.nome from tecnico t
             where t.id = case when r.tecnico_id = m.tecnico
                               then r.tecnico_origem_id else r.tecnico_id end)
         end,
         r.condicao_destino, r.solicitado_por_tecnico, r.aceito_em, r.cancelado_motivo,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'serial', e.serial, 'tipo', e.tipo, 'modelo', e.modelo)
                     order by e.serial)
                     from romaneio_item ri join equipamento e on e.id = ri.equipamento_id
                    where ri.romaneio_id = r.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'nome', i.nome, 'codigo', i.codigo,
                     'unidade', i.unidade, 'qtd', ri.quantidade) order by i.nome)
                     from romaneio_item ri join item_miscelanea i on i.id = ri.item_id
                    where ri.romaneio_id = r.id), '[]'::jsonb)
    from romaneio r, meu m
   where (r.tecnico_id = m.tecnico or r.tecnico_origem_id = m.tecnico)
     and r.empresa_id = minha_empresa()
     and (r.situacao = 'ABERTO'
          or r.confirmado_em > now() - interval '7 days'
          or r.cancelado_em > now() - interval '7 days')
   order by (r.situacao = 'ABERTO' and r.tecnico_id = m.tecnico and r.aceito_em is null) desc,
            r.numero desc
   limit 30;
$fn$;
revoke all on function meus_romaneios() from public, anon;
grant execute on function meus_romaneios() to authenticated;


-- ---------------------------------------------------------------------------
-- D · Baixa de miscelânea por contrato
-- ---------------------------------------------------------------------------
-- No concorrente: "Baixar miscelâneas baseado no contrato/serviço
-- concluído" — escolhe o contrato, os itens e as quantidades. O material
-- sai do saldo DO TÉCNICO (não do almoxarifado) e fica amarrado ao
-- contrato. Saldo que não existe é conta errada: recusa (D-154).

-- O almoxarifado acha o contrato sem ler dado de assinante (LGPD): só o
-- que identifica o serviço e a equipe.
create or replace function contrato_para_baixa(p_contrato text)
returns table (visita_id uuid, contrato text, data date, situacao text, servico text,
               equipe text, tecnicos jsonb)
language sql stable security definer set search_path to 'public' as $fn$
  select v.id, v.contrato, v.data_agendada, v.situacao, ts.nome,
         e.codigo || ' - ' || coalesce(e.nome, ''),
         coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome) order by t.nome)
                     from tecnico t where t.equipe_id = v.equipe_id and t.situacao = 'ATIVO'), '[]')
    from visita v
    left join tipo_servico ts on ts.id = v.tipo_servico_id
    left join equipe e on e.id = v.equipe_id
   where v.empresa_id = minha_empresa()
     and btrim(coalesce(p_contrato, '')) <> ''
     and (v.contrato = btrim(p_contrato) or v.wo_numero = btrim(p_contrato))
     and (tem_permissao('almoxarifado.editar') or tem_permissao('almoxarifado.ver'))
   order by v.data_agendada desc
   limit 20;
$fn$;
revoke all on function contrato_para_baixa(text) from public, anon;
grant execute on function contrato_para_baixa(text) to authenticated;

create or replace function baixar_miscelanea(p_visita uuid, p_tecnico uuid, p_itens jsonb,
                                             p_observacao text default null)
returns int
language plpgsql security definer set search_path to 'public' as $fn$
declare v_emp uuid := minha_empresa(); v_it jsonb; v_qtd numeric; v_saldo numeric;
        v_item uuid; v_n int := 0;
begin
  perform almox_pode_mexer();
  if not exists (select 1 from visita where id = p_visita and empresa_id = v_emp) then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from tecnico where id = p_tecnico and empresa_id = v_emp) then
    raise exception 'Tecnico nao encontrado.' using errcode = 'P0002';
  end if;
  for v_it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_qtd := nullif(v_it->>'quantidade','')::numeric;
    v_item := (v_it->>'item_id')::uuid;
    continue when v_qtd is null or v_qtd <= 0;
    select coalesce(sum(quantidade), 0) into v_saldo from miscelanea_movimento
     where item_id = v_item and tecnico_id = p_tecnico and empresa_id = v_emp;
    if v_saldo < v_qtd then
      raise exception 'O tecnico tem % de %, nao da para baixar %.', v_saldo,
        (select nome from item_miscelanea where id = v_item), v_qtd using errcode = '23514';
    end if;
    insert into miscelanea_movimento (empresa_id, item_id, tecnico_id, quantidade, tipo,
                                      visita_id, motivo, criado_por)
    values (v_emp, v_item, p_tecnico, -v_qtd, 'CONSUMO', p_visita,
            nullif(btrim(coalesce(p_observacao,'')),''), auth.uid());
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Nenhum item com quantidade.' using errcode = '23514'; end if;
  return v_n;
end;
$fn$;
revoke all on function baixar_miscelanea(uuid, uuid, jsonb, text) from public, anon;
grant execute on function baixar_miscelanea(uuid, uuid, jsonb, text) to authenticated;


-- ---------------------------------------------------------------------------
-- E · Auditoria: contou, ajusta — com motivo
-- ---------------------------------------------------------------------------
-- No concorrente: "Zerar/Limpar ou informar um novo saldo". Aqui o saldo
-- NÃO é sobrescrito (é soma, D-154): entra um lançamento AJUSTE com a
-- diferença, e quem conferir vê de onde veio.
create or replace function ajustar_saldo_miscelanea(p_item uuid, p_tecnico uuid,
                                                    p_contado numeric, p_motivo text)
returns numeric
language plpgsql security definer set search_path to 'public' as $fn$
declare v_emp uuid := minha_empresa(); v_atual numeric; v_dif numeric;
begin
  perform almox_pode_mexer();
  if p_contado is null or p_contado < 0 then
    raise exception 'A contagem e um numero de zero para cima.' using errcode = '23514';
  end if;
  if btrim(coalesce(p_motivo,'')) = '' then
    raise exception 'Ajuste exige motivo (inventario, perda, achado...).' using errcode = '23514';
  end if;
  if not exists (select 1 from item_miscelanea where id = p_item and empresa_id = v_emp) then
    raise exception 'Item nao encontrado.' using errcode = 'P0002';
  end if;
  select coalesce(sum(quantidade), 0) into v_atual from miscelanea_movimento
   where item_id = p_item and tecnico_id is not distinct from p_tecnico and empresa_id = v_emp;
  v_dif := p_contado - v_atual;
  if v_dif = 0 then return 0; end if;
  insert into miscelanea_movimento (empresa_id, item_id, tecnico_id, quantidade, tipo, motivo, criado_por)
  values (v_emp, p_item, p_tecnico, v_dif, 'AJUSTE',
          format('auditoria: contado %s, sistema dizia %s — %s', p_contado, v_atual, btrim(p_motivo)),
          auth.uid());
  return v_dif;
end;
$fn$;
revoke all on function ajustar_saldo_miscelanea(uuid, uuid, numeric, text) from public, anon;
grant execute on function ajustar_saldo_miscelanea(uuid, uuid, numeric, text) to authenticated;


-- ---------------------------------------------------------------------------
-- F · Cargas por técnico — o "Equipes / Alocações" do concorrente
-- ---------------------------------------------------------------------------
create or replace function estoque_cargas()
returns table (tecnico_id uuid, tecnico text, matricula text, equipe text,
               seriais int, inicializadas int, retiradas int, com_defeito int, sem_condicao int,
               mais_antiga_dias int, itens_misc int, qtd_misc numeric)
language sql stable security definer set search_path to 'public' as $fn$
  with eq as materialized (
    select e.posse_tecnico_id tid, e.condicao,
           hoje_local() - (e.posse_em at time zone 'America/Manaus')::date dias
      from equipamento e
     where e.empresa_id = minha_empresa() and e.posse = 'COM_TECNICO'
  ), mi as materialized (
    select m.tecnico_id tid, m.item_id, sum(m.quantidade) q
      from miscelanea_movimento m
     where m.empresa_id = minha_empresa() and m.tecnico_id is not null
     group by 1, 2 having sum(m.quantidade) > 0
  ), quem as (
    select tid from eq union select tid from mi
  )
  select t.id, t.nome, t.matricula,
         (select e.codigo || ' - ' || coalesce(e.nome,'') from equipe e where e.id = t.equipe_id),
         (select count(*) from eq where eq.tid = t.id)::int,
         (select count(*) from eq where eq.tid = t.id and eq.condicao = 'INICIALIZADO')::int,
         (select count(*) from eq where eq.tid = t.id and eq.condicao = 'RETIRADO')::int,
         (select count(*) from eq where eq.tid = t.id and eq.condicao = 'COM_DEFEITO')::int,
         (select count(*) from eq where eq.tid = t.id and eq.condicao is null)::int,
         (select max(dias) from eq where eq.tid = t.id)::int,
         (select count(*) from mi where mi.tid = t.id)::int,
         coalesce((select sum(q) from mi where mi.tid = t.id), 0)
    from quem join tecnico t on t.id = quem.tid
   where (select tem_permissao('almoxarifado.ver'))
   order by t.nome;
$fn$;
revoke all on function estoque_cargas() from public, anon;
grant execute on function estoque_cargas() to authenticated;


-- ---------------------------------------------------------------------------
-- G · Histórico do serial e movimentações do período
-- ---------------------------------------------------------------------------
-- O "Pesquisar Serial" do concorrente mostra a vida da peça. Aqui ela
-- junta as quatro fontes que já existiam separadas: a carga do Atlas, as
-- declarações de estado (085), os romaneios e o que o campo lançou (079).
create or replace function estoque_historico_serial(p_serial text)
returns table (quando timestamptz, tipo text, descricao text, quem text)
language sql stable security definer set search_path to 'public' as $fn$
  with e as materialized (
    select * from equipamento
     where empresa_id = minha_empresa()
       and serial = upper(regexp_replace(coalesce(p_serial,''), '\s', '', 'g'))
       and (select tem_permissao('almoxarifado.ver'))
  )
  select e.criado_em, 'CARGA',
         format('entrou pela carga do Atlas (%s)', coalesce(e.estado_atlas, 'sem estado')), null::text
    from e
  union all
  select ev.criado_em, 'ESTADO',
         format('estado AFLINE: %s → %s (Atlas: %s) — %s',
                coalesce(ev.de, 'nenhum'), coalesce(ev.para, 'desfeito'),
                coalesce(ev.estado_atlas, '—'), coalesce(ev.motivo, '')),
         (select p.nome from perfil p where p.id = ev.criado_por)
    from equipamento_estado_evento ev join e on e.id = ev.equipamento_id
  union all
  select coalesce(r.confirmado_em, r.cancelado_em, r.criado_em), 'ROMANEIO',
         format('%s %s — %s%s%s',
                lower(r.tipo), r.numero,
                case r.tipo when 'ENTREGA' then 'para ' || tr.nome
                            when 'DEVOLUCAO' then 'de ' || tr.nome || ' para o almoxarifado'
                            else 'de ' || coalesce(tro.nome, '?') || ' para ' || tr.nome end,
                case r.situacao when 'CONFIRMADO' then
                       ' · confirmado' || case r.confirmado_metodo
                         when 'BALCAO' then ' no balcão'
                         when 'APARELHO' then ' pelo técnico no celular'
                         when 'SENHA' then ' pelo técnico com senha' else '' end
                     when 'CANCELADO' then ' · cancelado: ' || coalesce(r.cancelado_motivo, '')
                     else ' · aberto' end,
                case when r.condicao_destino is not null then ' · volta como ' || lower(r.condicao_destino) else '' end),
         (select p.nome from perfil p where p.id = coalesce(r.confirmado_por, r.criado_por))
    from romaneio_item ri join e on e.id = ri.equipamento_id
    join romaneio r on r.id = ri.romaneio_id
    left join tecnico tr on tr.id = r.tecnico_id
    left join tecnico tro on tro.id = r.tecnico_origem_id
  union all
  select m.criado_em, 'CAMPO',
         format('%s no contrato %s', lower(m.operacao),
                coalesce((select v.contrato from visita v where v.id = m.visita_id), '?')),
         coalesce(m.login, (select t.nome from tecnico t where t.id = m.tecnico_id))
    from equipamento_movimento m join e on m.serial = e.serial
   where exists (select 1 from visita v where v.id = m.visita_id and v.empresa_id = minha_empresa())
  order by 1 desc;
$fn$;
revoke all on function estoque_historico_serial(text) from public, anon;
grant execute on function estoque_historico_serial(text) to authenticated;

create or replace function estoque_movimentacoes(p_de date, p_ate date)
returns table (quando timestamptz, tipo text, documento text, serial text, item text,
               quantidade numeric, de text, para text, quem text)
language sql stable security definer set search_path to 'public' as $fn$
  with r as materialized (
    select r.* from romaneio r
     where r.empresa_id = minha_empresa() and r.situacao = 'CONFIRMADO'
       and (r.confirmado_em at time zone 'America/Manaus')::date between p_de and p_ate
       and (select tem_permissao('almoxarifado.ver'))
  )
  select r.confirmado_em, r.tipo, 'romaneio ' || r.numero,
         e.serial, i.nome, ri.quantidade,
         case r.tipo when 'ENTREGA' then 'almoxarifado'
                     when 'DEVOLUCAO' then tr.nome else tro.nome end,
         case r.tipo when 'DEVOLUCAO' then 'almoxarifado' else tr.nome end,
         (select p.nome from perfil p where p.id = r.confirmado_por)
    from r join romaneio_item ri on ri.romaneio_id = r.id
    left join equipamento e on e.id = ri.equipamento_id
    left join item_miscelanea i on i.id = ri.item_id
    left join tecnico tr on tr.id = r.tecnico_id
    left join tecnico tro on tro.id = r.tecnico_origem_id
  union all
  select m.criado_em, m.tipo,
         case when m.visita_id is not null
              then 'contrato ' || coalesce((select v.contrato from visita v where v.id = m.visita_id), '?')
              else coalesce(m.motivo, '') end,
         null, i.nome, m.quantidade,
         case when m.quantidade < 0 then coalesce(t.nome, 'almoxarifado') end,
         case when m.quantidade > 0 then coalesce(t.nome, 'almoxarifado') end,
         (select p.nome from perfil p where p.id = m.criado_por)
    from miscelanea_movimento m join item_miscelanea i on i.id = m.item_id
    left join tecnico t on t.id = m.tecnico_id
   where m.empresa_id = minha_empresa() and m.tipo in ('ENTRADA', 'AJUSTE', 'CONSUMO')
     and (m.criado_em at time zone 'America/Manaus')::date between p_de and p_ate
     and (select tem_permissao('almoxarifado.ver'))
  union all
  select m.criado_em, 'CAMPO_' || m.operacao,
         'contrato ' || coalesce(v.contrato, '?'), m.serial, null, 1,
         case when m.operacao = 'RETIRADO' then 'cliente' else t.nome end,
         case when m.operacao = 'RETIRADO' then t.nome else 'cliente' end,
         coalesce(m.login, t.nome)
    from equipamento_movimento m join visita v on v.id = m.visita_id
    left join tecnico t on t.id = m.tecnico_id
   where v.empresa_id = minha_empresa()
     and (m.criado_em at time zone 'America/Manaus')::date between p_de and p_ate
     and exists (select 1 from equipamento e where e.empresa_id = v.empresa_id and e.serial = m.serial)
     and (select tem_permissao('almoxarifado.ver'))
  order by 1 desc;
$fn$;
revoke all on function estoque_movimentacoes(date, date) from public, anon;
grant execute on function estoque_movimentacoes(date, date) to authenticated;


-- ---------------------------------------------------------------------------
-- H · Kardex da miscelânea
-- ---------------------------------------------------------------------------
-- Um item, num lugar (o almoxarifado quando p_tecnico é nulo, ou a mão de
-- um técnico): cada lançamento com o saldo antes e depois — a pergunta
-- "por que o saldo está assim?" respondida linha a linha.
create or replace function miscelanea_kardex(p_item uuid, p_tecnico uuid, p_de date, p_ate date)
returns table (quando timestamptz, tipo text, documento text, outro_lado text,
               saldo_anterior numeric, quantidade numeric, saldo_atual numeric,
               motivo text, quem text)
language sql stable security definer set search_path to 'public' as $fn$
  with mov as materialized (
    select m.*,
           sum(m.quantidade) over (order by m.criado_em, m.id rows unbounded preceding) as corrido
      from miscelanea_movimento m
     where m.empresa_id = minha_empresa() and m.item_id = p_item
       and m.tecnico_id is not distinct from p_tecnico
       and (select tem_permissao('almoxarifado.ver'))
  )
  select m.criado_em, m.tipo,
         case when m.romaneio_id is not null
                then 'romaneio ' || (select r.numero from romaneio r where r.id = m.romaneio_id)
              when m.visita_id is not null
                then 'contrato ' || coalesce((select v.contrato from visita v where v.id = m.visita_id), '?')
              else '' end,
         -- A outra perna do romaneio: para onde foi / de onde veio.
         (select coalesce(t.nome, 'almoxarifado') from miscelanea_movimento o
            left join tecnico t on t.id = o.tecnico_id
           where o.romaneio_id = m.romaneio_id and o.item_id = m.item_id and o.id <> m.id
             and sign(o.quantidade) <> sign(m.quantidade) limit 1),
         m.corrido - m.quantidade, m.quantidade, m.corrido, m.motivo,
         (select p.nome from perfil p where p.id = m.criado_por)
    from mov m
   where (m.criado_em at time zone 'America/Manaus')::date between p_de and p_ate
   order by m.criado_em desc, m.id desc;
$fn$;
revoke all on function miscelanea_kardex(uuid, uuid, date, date) from public, anon;
grant execute on function miscelanea_kardex(uuid, uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
