-- ============================================================
-- 006 - Importador da planilha do TOA
--
-- D-004: sobe varias vezes ao dia -> UPSERT, nunca append.
-- D-006: se a visita ja foi tocada pelo campo, o TOA so pode
--        alterar os campos cadastrais.
--
-- Chave de deduplicacao: 'ID da Atividade' (TOA).
--
-- ATENCAO - colunas com nome repetido na planilha:
--   indice 19 'Tipo de Atividade'  = categoria ('Normal')
--   indice 20 'Tipo de Atividade'  = tipo real ('Instalacao')
--   indice 10 'Janela de Servico'  / indice 11 'Janela de Servico'
-- O front-end DEVE desduplicar os cabecalhos por posicao, gerando
-- 'Tipo de Atividade' e 'Tipo de Atividade__2'. Se ele mandar por
-- nome, a segunda sobrescreve a primeira em silencio.
-- ============================================================

-- ---------- helpers ----------

-- texto do jsonb, vazio vira null
create or replace function j_txt(d jsonb, k text) returns text
language sql immutable as $fn$
  select nullif(btrim(coalesce(d ->> k, '')), '');
$fn$;

-- '04/09/26' -> date. Invalido devolve null em vez de estourar.
create or replace function j_data(d jsonb, k text) returns date
language plpgsql immutable as $fn$
declare v text := j_txt(d, k);
begin
  if v is null then return null; end if;
  return to_date(v, 'DD/MM/YY');
exception when others then return null;
end;
$fn$;

-- '08:00' ou '08:00 - 12:00' -> time (a ponta pedida)
create or replace function j_hora(d jsonb, k text, ponta int default 1)
returns time language plpgsql immutable as $fn$
declare v text := j_txt(d, k); p text[];
begin
  if v is null then return null; end if;
  p := regexp_split_to_array(v, '\s*-\s*');
  if array_length(p,1) < ponta then return null; end if;
  return (btrim(p[ponta]))::time;
exception when others then return null;
end;
$fn$;

create or replace function j_num(d jsonb, k text) returns numeric
language plpgsql immutable as $fn$
declare v text := j_txt(d, k);
begin
  if v is null then return null; end if;
  return replace(v, ',', '.')::numeric;
exception when others then return null;
end;
$fn$;

-- 'NNN - DESCRICAO' -> NNN   (serve para Tipo O.S e Cod de Baixa)
create or replace function extrai_codigo(v text) returns integer
language plpgsql immutable as $fn$
declare m text;
begin
  if v is null then return null; end if;
  m := substring(btrim(v) from '^(\d+)');
  if m is null then return null; end if;
  return m::integer;
exception when others then return null;
end;
$fn$;

-- status da atividade no TOA -> nossa situacao
create or replace function situacao_do_toa(v text) returns text
language sql immutable as $fn$
  select case norm_txt(v)
    when 'CONCLUIDO'     then 'CONCLUIDA'
    when 'INICIADO'      then 'EM_EXECUCAO'
    when 'EM ROTA'       then 'EM_DESLOCAMENTO'
    when 'CANCELADO'     then 'CANCELADA'
    when 'PENDENTE'      then 'ENTRADA'
    when 'NAO CONCLUIDO' then 'COM_IMPEDIMENTO'
    when 'SUSPENSO'      then 'COM_IMPEDIMENTO'
    else 'ENTRADA'
  end;
$fn$;

-- ============================================================
-- Importador
-- p_simular = true  -> processa, devolve o resumo e desfaz tudo.
--                      E a previa, sem duplicar codigo.
-- ============================================================

create or replace function importar_toa(
  p_importacao_id uuid,
  p_simular boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  r            record;
  d            jsonb;
  v_base       uuid;
  v_id         uuid;
  v_atividade  text;
  v_bloqueada  boolean;
  v_tecnico    uuid;
  v_equipe     uuid;
  v_situacao   text;
  j            int;
  v_num_os     text;
  v_cod        integer;
  n_criadas    int := 0;
  n_atualiz    int := 0;
  n_ignor      int := 0;
  n_erro       int := 0;
  n_conflito   int := 0;
  n_os         int := 0;
  resumo       jsonb;
begin
  select base_id into v_base from importacao where id = p_importacao_id;
  if v_base is null then
    raise exception 'Importacao % nao encontrada', p_importacao_id;
  end if;

  for r in
    select id, numero_linha, dados from importacao_linha
    where importacao_id = p_importacao_id order by numero_linha
  loop
    begin
      d := r.dados;
      v_atividade := j_txt(d, 'ID da Atividade');

      -- Sem ID de atividade nao ha como deduplicar. Nao entra.
      if v_atividade is null then
        n_ignor := n_ignor + 1;
        update importacao_linha set resultado = 'IGNORADA',
          mensagem = 'Sem ID da Atividade' where id = r.id;
        continue;
      end if;

      -- tecnico pela matricula ('Login do Tecnico'), equipe vem dele
      v_tecnico := null; v_equipe := null;
      select t.id, t.equipe_id into v_tecnico, v_equipe
      from tecnico t
      where t.base_id = v_base
        and norm_txt(t.matricula) = norm_txt(j_txt(d, 'Login do Técnico'))
      limit 1;

      select v.id, v.bloqueado_em is not null
        into v_id, v_bloqueada
      from visita v
      where v.base_id = v_base and v.toa_atividade_id = v_atividade;

      -- ---------------- INSERT ----------------
      if v_id is null then
        v_situacao := situacao_do_toa(j_txt(d, 'Status da Atividade'));

        insert into visita (
          base_id, toa_atividade_id, origem, wo_numero, contrato,
          tipo_atividade_id, area_id, segmentacao_id, categoria_id,
          node, workzone_key,
          logradouro, complemento, bairro, cidade, uf, cep,
          lat, lng, codigo_ibge,
          data_agendada, janela_inicio, janela_fim,
          equipe_id, tecnico_responsavel_id,
          situacao, situacao_em, inicio, fim,
          importacao_id, dados_origem
        ) values (
          v_base, v_atividade, 'TOA',
          j_txt(d,'Número da WO'), j_txt(d,'Contrato'),
          (select id from tipo_atividade
             where norm_txt(nome) = norm_txt(j_txt(d,'Tipo de Atividade__2'))),
          (select id from area_trabalho
             where norm_txt(codigo) = norm_txt(j_txt(d,'Área de Trabalho'))),
          (select id from segmentacao
             where norm_txt(nome) = norm_txt(j_txt(d,'Segmentação'))),
          (select id from categoria_capacidade
             where norm_txt(nome) = norm_txt(j_txt(d,'Categorias da Capacidade'))),
          j_txt(d,'Node'), j_txt(d,'Workzone key'),
          j_txt(d,'Endereço'), j_txt(d,'Complemento Endereço'),
          j_txt(d,'Bairro'), j_txt(d,'Cidade'), left(j_txt(d,'UF'),2),
          j_txt(d,'CEP/Código Postal'),
          j_num(d,'Coordenada Y'),   -- Y = latitude
          j_num(d,'Coordenada X'),   -- X = longitude
          j_txt(d,'Código IBGE'),
          coalesce(j_data(d,'Data'), current_date),
          j_hora(d,'Intervalo de Tempo',1), j_hora(d,'Intervalo de Tempo',2),
          v_equipe, v_tecnico,
          v_situacao, now(),
          j_hora(d,'Início',1), j_hora(d,'Fim',1),
          p_importacao_id, d
        ) returning id into v_id;

        n_criadas := n_criadas + 1;
        update importacao_linha
          set resultado = 'CRIADA', visita_id = v_id where id = r.id;

        insert into visita_evento (visita_id, tipo, para, origem)
        values (v_id, 'IMPORTADA',
                jsonb_build_object('atividade', v_atividade), 'IMPORTACAO');

      -- ---------------- UPDATE ----------------
      else
        if v_bloqueada then
          -- D-006: so campo cadastral. Status, baixa, foto, material
          -- e observacao pertencem ao campo a partir daqui.
          update visita set
            wo_numero   = coalesce(j_txt(d,'Número da WO'), wo_numero),
            contrato    = coalesce(j_txt(d,'Contrato'), contrato),
            logradouro  = coalesce(j_txt(d,'Endereço'), logradouro),
            complemento = coalesce(j_txt(d,'Complemento Endereço'), complemento),
            bairro      = coalesce(j_txt(d,'Bairro'), bairro),
            cidade      = coalesce(j_txt(d,'Cidade'), cidade),
            cep         = coalesce(j_txt(d,'CEP/Código Postal'), cep),
            lat         = coalesce(j_num(d,'Coordenada Y'), lat),
            lng         = coalesce(j_num(d,'Coordenada X'), lng),
            segmentacao_id = coalesce((select id from segmentacao
               where norm_txt(nome) = norm_txt(j_txt(d,'Segmentação'))), segmentacao_id),
            data_agendada  = coalesce(j_data(d,'Data'), data_agendada),
            janela_inicio  = coalesce(j_hora(d,'Intervalo de Tempo',1), janela_inicio),
            janela_fim     = coalesce(j_hora(d,'Intervalo de Tempo',2), janela_fim)
          where id = v_id;

          -- O TOA discorda do que o campo registrou? Vira alerta,
          -- nao sobrescrita. Isto e material de cobranca junto a CLARO.
          if situacao_do_toa(j_txt(d,'Status da Atividade')) <>
             (select situacao from visita where id = v_id) then
            n_conflito := n_conflito + 1;
            insert into visita_evento (visita_id, tipo, de, para, origem)
            values (v_id, 'CONFLITO_TOA',
              jsonb_build_object('toa', j_txt(d,'Status da Atividade')),
              jsonb_build_object('nosso',
                (select situacao from visita where id = v_id)),
              'IMPORTACAO');
            update importacao_linha set resultado = 'CONFLITO',
              mensagem = 'TOA diverge do registrado em campo',
              visita_id = v_id where id = r.id;
          else
            update importacao_linha set resultado = 'ATUALIZADA',
              visita_id = v_id where id = r.id;
          end if;

        else
          -- Ainda nao tocada pelo campo: o TOA manda em tudo.
          update visita set
            wo_numero   = coalesce(j_txt(d,'Número da WO'), wo_numero),
            contrato    = coalesce(j_txt(d,'Contrato'), contrato),
            logradouro  = coalesce(j_txt(d,'Endereço'), logradouro),
            complemento = coalesce(j_txt(d,'Complemento Endereço'), complemento),
            bairro      = coalesce(j_txt(d,'Bairro'), bairro),
            cidade      = coalesce(j_txt(d,'Cidade'), cidade),
            cep         = coalesce(j_txt(d,'CEP/Código Postal'), cep),
            lat         = coalesce(j_num(d,'Coordenada Y'), lat),
            lng         = coalesce(j_num(d,'Coordenada X'), lng),
            data_agendada = coalesce(j_data(d,'Data'), data_agendada),
            janela_inicio = coalesce(j_hora(d,'Intervalo de Tempo',1), janela_inicio),
            janela_fim    = coalesce(j_hora(d,'Intervalo de Tempo',2), janela_fim),
            equipe_id     = coalesce(v_equipe, equipe_id),
            tecnico_responsavel_id = coalesce(v_tecnico, tecnico_responsavel_id),
            situacao      = situacao_do_toa(j_txt(d,'Status da Atividade')),
            situacao_em   = now(),
            dados_origem  = d
          where id = v_id;

          update importacao_linha set resultado = 'ATUALIZADA',
            visita_id = v_id where id = r.id;
        end if;

        n_atualiz := n_atualiz + 1;
      end if;

      -- ---------------- as 1..10 O.S. da visita ----------------
      -- D-001: a visita carrega varias O.S. Nao achatar.
      for j in 1..10 loop
        v_num_os := j_txt(d, 'Número da O.S ' || j);
        exit when v_num_os is null and j > 1
              and j_txt(d, 'Número da O.S ' || (j+1)) is null;
        continue when v_num_os is null;

        v_cod := extrai_codigo(j_txt(d, 'Cód de Baixa ' || j));

        insert into ordem_servico (
          visita_id, sequencia, numero_os, ponto, tipo_os_id,
          status_operadora, codigo_baixa_id, produto
        ) values (
          v_id, j, v_num_os, j_txt(d, 'Ponto ' || j),
          (select id from tipo_os
             where codigo = extrai_codigo(j_txt(d, 'Tipo O.S ' || j))),
          case norm_txt(j_txt(d, 'Status da O.S ' || j))
            when 'EXECUTADA' then 'EXECUTADA'
            when 'NAO EXECUTADA' then 'NAO_EXECUTADA'
            else null end,
          (select id from codigo_baixa where codigo = v_cod),
          j_txt(d, 'Produto')
        )
        on conflict (visita_id, sequencia) do update set
          numero_os        = excluded.numero_os,
          ponto            = excluded.ponto,
          tipo_os_id       = excluded.tipo_os_id,
          -- baixa vinda do campo nao e sobrescrita pelo TOA
          status_operadora = coalesce(ordem_servico.status_operadora, excluded.status_operadora),
          codigo_baixa_id  = coalesce(ordem_servico.codigo_baixa_id, excluded.codigo_baixa_id);

        n_os := n_os + 1;
      end loop;

    exception when others then
      n_erro := n_erro + 1;
      update importacao_linha set resultado = 'ERRO', mensagem = SQLERRM
      where id = r.id;
    end;
  end loop;

  resumo := jsonb_build_object(
    'criadas', n_criadas, 'atualizadas', n_atualiz,
    'ignoradas', n_ignor, 'erros', n_erro,
    'conflitos', n_conflito, 'ordens_servico', n_os,
    'simulacao', p_simular
  );

  if p_simular then
    -- desfaz tudo: a previa nao deixa rastro
    raise exception using
      errcode = 'P0001',
      message = 'PREVIA:' || resumo::text;
  end if;

  update importacao set
    status = 'APLICADA', aplicado_em = now(),
    qtd_criadas = n_criadas, qtd_atualizadas = n_atualiz,
    qtd_ignoradas = n_ignor, qtd_erro = n_erro, qtd_conflito = n_conflito
  where id = p_importacao_id;

  return resumo;
end;
$fn$;

-- Previa sem efeito colateral: roda o mesmo codigo e desfaz.
create or replace function previa_toa(p_importacao_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare msg text;
begin
  perform importar_toa(p_importacao_id, true);
  return '{}'::jsonb;
exception when sqlstate 'P0001' then
  get stacked diagnostics msg = MESSAGE_TEXT;
  if left(msg, 7) = 'PREVIA:' then
    return substring(msg from 8)::jsonb;
  end if;
  raise;
end;
$fn$;

revoke execute on function importar_toa(uuid, boolean) from anon;
revoke execute on function previa_toa(uuid) from anon;

comment on function importar_toa is
  'Importa a planilha do TOA. D-004 upsert por ID da Atividade; '
  'D-006 visita bloqueada so aceita campo cadastral; '
  'D-001 gera as 1..10 O.S. da visita.';
