-- 030 · Histórico com autor, e cadastro manual de contrato/O.S.
--
-- ┌─ O QUE ESTAVA FALTANDO ──────────────────────────────────────────┐
-- │ O sistema atual mostra, no contrato, um HISTÓRICO em que cada    │
-- │ linha diz **quem** fez: "Entrada - In Box · VERA LUCIA",         │
-- │ "Em deslocamento · 007 - EQUIPE". A gente já tinha a tabela      │
-- │ (`visita_evento`) e já tinha a aba. O que não tinha era o autor: │
-- │                                                                  │
-- │   IMPORTADA      551 eventos ·   0 com usuario_id                │
-- │   CONFLITO_TOA     2 eventos ·   0 com usuario_id                │
-- │                                                                  │
-- │ E não havia UM evento por mudança de situação — só o de criação. │
-- │ Sem isso o histórico conta o começo da história e mais nada.     │
-- └──────────────────────────────────────────────────────────────────┘
--
-- Três frentes aqui:
--   A) `visita_evento` ganha `login` e `importacao_id`, e a importação
--      passa a carimbar autor + arquivo + uma linha por mudança de
--      situação (é a linha que aparece como "quem jogou no pendente",
--      com o login do técnico que veio na planilha).
--   B) Cadastro manual: contrato que não está no TOA entra pela tela,
--      com número de O.S. gerado pelo sistema.
--   C) `reverter_situacao`: voltar contrato. O sistema da CLARO não
--      volta; o nosso volta — mas deixando rastro de quem voltou.

-- ============================================================
-- A · HISTÓRICO COM AUTOR
-- ============================================================

alter table visita_evento
  add column if not exists login         text,
  add column if not exists importacao_id uuid references importacao(id);

comment on column visita_evento.login is
  'Login que causou o evento: o e-mail de quem operou a tela, ou o '
  '"Login do Técnico" que veio na planilha do TOA. É o que a coluna '
  '"Login" do sistema atual mostra.';

-- Quem cadastrou o contrato à mão (o TOA não tem autor).
alter table visita
  add column if not exists criado_por uuid references perfil(id);

-- A O.S. também tem procedência: veio do TOA ou foi digitada.
-- É a coluna "Origem" do relatório do sistema atual.
alter table ordem_servico
  add column if not exists origem    text not null default 'TOA'
                                     check (origem in ('TOA','MANUAL')),
  add column if not exists descricao text,
  add column if not exists criado_por uuid references perfil(id);

comment on column ordem_servico.descricao is
  'O texto que a operação lê ("ADESAO - INSTALACAO DE ASSINATURA"). '
  'Para O.S. do TOA vem de tipo_os; para O.S. manual, é digitado.';

-- ---------- Importação: carimba autor, arquivo e mudança de situação ----------
create or replace function importar_toa_interno(
  p_importacao_id uuid, p_simular boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  r record; d jsonb;
  v_base uuid; v_id uuid; v_atividade text; v_bloqueada boolean;
  v_tecnico uuid; v_equipe uuid; v_atual text;
  v_usuario uuid; v_arquivo text; v_login text; v_nova text;
  j int; v_num_os text; v_cod integer;
  n_criadas int := 0; n_atualiz int := 0; n_ignor int := 0;
  n_erro int := 0; n_conflito int := 0; n_os int := 0;
  resumo jsonb;
begin
  perform set_config('app.origem', 'IMPORTACAO', true);

  -- O autor da importação vem do cabeçalho. Sem isto o histórico
  -- inteiro nasce anônimo — foi o defeito que esta migration corrige.
  select base_id, usuario_id, arquivo_nome
    into v_base, v_usuario, v_arquivo
    from importacao where id = p_importacao_id;
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

      if v_atividade is null then
        n_ignor := n_ignor + 1;
        update importacao_linha set resultado = 'IGNORADA',
          mensagem = 'Sem ID da Atividade' where id = r.id;
        continue;
      end if;

      -- O login do técnico é o que o sistema atual mostra na coluna
      -- "Login" do histórico. Guardamos como veio.
      v_login := j_txt(d, 'Login do Técnico');

      v_tecnico := null; v_equipe := null;
      select t.id, t.equipe_id into v_tecnico, v_equipe
      from tecnico t
      where t.base_id = v_base
        and norm_txt(t.matricula) = norm_txt(v_login)
      limit 1;

      v_id := null; v_bloqueada := null; v_atual := null;
      select v.id, v.bloqueado_em is not null, v.situacao
        into v_id, v_bloqueada, v_atual
      from visita v
      where v.base_id = v_base and v.toa_atividade_id = v_atividade;

      v_nova := situacao_do_toa(j_txt(d, 'Status da Atividade'));

      if v_id is null then
        insert into visita (
          base_id, toa_atividade_id, origem, wo_numero, contrato,
          tipo_atividade_id, area_id, segmentacao_id, categoria_id,
          node, workzone_key,
          logradouro, complemento, bairro, cidade, uf, cep,
          lat, lng, codigo_ibge,
          data_agendada, janela_inicio, janela_fim,
          equipe_id, tecnico_responsavel_id,
          situacao, situacao_em, inicio, fim, tempo_deslocamento,
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
          j_num(d,'Coordenada Y'), j_num(d,'Coordenada X'),
          j_txt(d,'Código IBGE'),
          coalesce(j_data(d,'Data'), current_date),
          j_hora(d,'Intervalo de Tempo',1), j_hora(d,'Intervalo de Tempo',2),
          v_equipe, v_tecnico,
          v_nova, now(),
          j_ts(d,'Data','Início'), j_ts(d,'Data','Fim'),
          j_interv(d,'Tempo de Deslocamento'),
          p_importacao_id, d
        ) returning id into v_id;

        n_criadas := n_criadas + 1;
        update importacao_linha set resultado = 'CRIADA', visita_id = v_id
          where id = r.id;

        insert into visita_evento (visita_id, tipo, para, origem,
                                   usuario_id, login, importacao_id, observacao)
        values (v_id, 'IMPORTADA',
                jsonb_build_object('atividade', v_atividade, 'situacao', v_nova),
                'IMPORTACAO', v_usuario, v_login, p_importacao_id, v_arquivo);

      else
        if v_bloqueada then
          -- D-006: campo tocou. So dado cadastral.
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

          if v_nova is distinct from v_atual then
            n_conflito := n_conflito + 1;
            insert into visita_evento (visita_id, tipo, de, para, origem,
                                       usuario_id, login, importacao_id)
            values (v_id, 'CONFLITO_TOA',
              jsonb_build_object('toa', j_txt(d,'Status da Atividade')),
              jsonb_build_object('nosso', v_atual),
              'IMPORTACAO', v_usuario, v_login, p_importacao_id);
            update importacao_linha set resultado = 'CONFLITO',
              mensagem = 'TOA diverge do registrado em campo', visita_id = v_id
              where id = r.id;
          else
            update importacao_linha set resultado = 'ATUALIZADA', visita_id = v_id
              where id = r.id;
          end if;

        else
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
            situacao      = v_nova,
            situacao_em   = now(),
            inicio        = coalesce(j_ts(d,'Data','Início'), inicio),
            fim           = coalesce(j_ts(d,'Data','Fim'), fim),
            tempo_deslocamento = coalesce(j_interv(d,'Tempo de Deslocamento'), tempo_deslocamento),
            dados_origem  = d
          where id = v_id;

          -- UMA LINHA POR MUDANÇA DE SITUAÇÃO.
          -- É isto que faz a aba Histórico contar a história inteira em
          -- vez de só o nascimento do contrato. Só grava quando muda —
          -- a mesma planilha reimportada não polui a trilha.
          if v_nova is distinct from v_atual then
            insert into visita_evento (visita_id, tipo, de, para, origem,
                                       usuario_id, login, importacao_id,
                                       equipe_id, tecnico_id)
            values (v_id, 'SITUACAO',
                    jsonb_build_object('situacao', v_atual),
                    jsonb_build_object('situacao', v_nova),
                    'IMPORTACAO', v_usuario, v_login, p_importacao_id,
                    v_equipe, v_tecnico);
          end if;

          update importacao_linha set resultado = 'ATUALIZADA', visita_id = v_id
            where id = r.id;
        end if;

        n_atualiz := n_atualiz + 1;
      end if;

      for j in 1..10 loop
        v_num_os := j_txt(d, 'Número da O.S ' || j);
        continue when v_num_os is null;
        v_cod := extrai_codigo(j_txt(d, 'Cód de Baixa ' || j));

        insert into ordem_servico (
          visita_id, sequencia, numero_os, ponto, tipo_os_id,
          status_operadora, codigo_baixa_id, produto, origem, descricao
        ) values (
          v_id, j, v_num_os, j_txt(d, 'Ponto ' || j),
          (select id from tipo_os
             where codigo = extrai_codigo(j_txt(d, 'Tipo O.S ' || j))),
          case norm_txt(j_txt(d, 'Status da O.S ' || j))
            when 'EXECUTADA' then 'EXECUTADA'
            when 'NAO EXECUTADA' then 'NAO_EXECUTADA'
            else null end,
          (select id from codigo_baixa where codigo = v_cod),
          j_txt(d, 'Produto'), 'TOA',
          (select descricao from tipo_os
             where codigo = extrai_codigo(j_txt(d, 'Tipo O.S ' || j)))
        )
        on conflict (visita_id, sequencia) do update set
          numero_os        = excluded.numero_os,
          ponto            = excluded.ponto,
          tipo_os_id       = excluded.tipo_os_id,
          status_operadora = coalesce(ordem_servico.status_operadora, excluded.status_operadora),
          codigo_baixa_id  = coalesce(ordem_servico.codigo_baixa_id, excluded.codigo_baixa_id),
          descricao        = coalesce(ordem_servico.descricao, excluded.descricao);

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
    'simulacao', p_simular);

  perform set_config('app.origem', '', true);

  if p_simular then
    raise exception using errcode = 'P0001',
      message = 'PREVIA:' || resumo::text;
  end if;

  update importacao set
    status = 'APLICADA', aplicado_em = now(),
    qtd_criadas = n_criadas, qtd_atualizadas = n_atualiz,
    qtd_ignoradas = n_ignor, qtd_erro = n_erro, qtd_conflito = n_conflito
  where id = p_importacao_id;

  return resumo;
end;
$function$;

-- CREATE OR REPLACE preserva a ACL, mas conferir é barato (CLAUDE.md).
revoke all on function importar_toa_interno(uuid, boolean) from public, anon;

-- ---------- Recompõe o autor do que já está lá ----------
-- Não dá para inventar quem importou os dois primeiros arquivos (o
-- cabeçalho nasceu sem usuario_id). Os outros oito têm, e a ligação é
-- direta pela visita.
update visita_evento e
   set usuario_id    = i.usuario_id,
       importacao_id = v.importacao_id,
       observacao    = coalesce(e.observacao, i.arquivo_nome)
  from visita v join importacao i on i.id = v.importacao_id
 where e.visita_id = v.id
   and e.tipo in ('IMPORTADA','CONFLITO_TOA')
   and e.usuario_id is null
   and i.usuario_id is not null;

-- O login do técnico já estava guardado, só não estava no evento: a
-- linha crua do TOA fica em `visita.dados_origem` desde a 004. 407 dos
-- 551 eventos recuperam o login por aqui.
update visita_evento e
   set login = v.dados_origem->>'Login do Técnico'
  from visita v
 where e.visita_id = v.id
   and e.login is null
   and e.tipo in ('IMPORTADA','CONFLITO_TOA')
   and nullif(btrim(v.dados_origem->>'Login do Técnico'), '') is not null;

-- A descrição da O.S. que já está no banco sai de tipo_os.
update ordem_servico o set descricao = t.descricao
  from tipo_os t where o.tipo_os_id = t.id and o.descricao is null;

-- ============================================================
-- B · CADASTRO MANUAL
-- ============================================================
--
-- ┌─ NÚMERO DE O.S. GERADO ──────────────────────────────────────────┐
-- │ A CLARO usa 10 dígitos (2607830497). Um número nosso no mesmo    │
-- │ formato colidiria com o dela no dia em que o contrato entrasse   │
-- │ no TOA, e ninguém saberia qual é qual.                           │
-- │                                                                  │
-- │ Por isso o prefixo: **AF-00000001**. É legível, ordena, e diz na │
-- │ cara que aquela O.S. nasceu aqui e não na operadora.             │
-- │                                                                  │
-- │ ⚠ Formato escolhido por nós, não observado no dado. Emanuel      │
-- │   confirma ou troca — trocar é uma linha nesta função.           │
-- └──────────────────────────────────────────────────────────────────┘

create sequence if not exists seq_os_manual start 1;

create or replace function proximo_numero_os()
returns text language sql volatile set search_path to 'public' as $fn$
  select 'AF-' || lpad(nextval('seq_os_manual')::text, 8, '0');
$fn$;

revoke all on function proximo_numero_os() from public, anon;

-- Cria um contrato que não veio do TOA.
--
-- Recebe tudo num jsonb para a tela não depender da ordem dos
-- parâmetros, e devolve o id criado mais os números gerados.
--
-- `ordens` é um array: [{tipo_os_id: '...', numero_os: null, descricao: '...'}]
-- numero_os nulo ou vazio => o sistema gera.
create or replace function criar_visita_manual(p_dados jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_base uuid; v_visita uuid; v_equipe uuid; v_seq int := 0;
  v_num text; o jsonb; v_nums text[] := '{}';
  v_data date; v_contrato text;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')) then
    raise exception 'Sem permissao para cadastrar contrato.' using errcode = '42501';
  end if;
  if not tem_permissao('servicos.cadastrar') then
    raise exception 'Seu perfil de acesso nao inclui "Cadastrar contrato".'
      using errcode = '42501';
  end if;

  v_contrato := nullif(btrim(p_dados->>'contrato'), '');
  if v_contrato is null then
    raise exception 'Informe o numero do contrato.' using errcode = '23514';
  end if;

  v_data := coalesce(nullif(p_dados->>'data_agendada','')::date, current_date);
  v_equipe := nullif(p_dados->>'equipe_id','')::uuid;

  -- A base sai da equipe escolhida; sem equipe, a única que o usuário vê.
  v_base := coalesce(
    (select base_id from equipe where id = v_equipe),
    (select b from bases_visiveis() b limit 1));
  if v_base is null then
    raise exception 'Nao consegui determinar a base deste contrato.'
      using errcode = 'P0002';
  end if;

  insert into visita (
    base_id, origem, contrato, wo_numero, cliente_nome, tipo_pessoa,
    telefones, tipo_residencia,
    logradouro, complemento, bairro, cidade, uf, cep, node,
    lat, lng, area_id, tipo_servico_id, tipo_atividade_id,
    data_agendada, janela_inicio, janela_fim,
    equipe_id, situacao, situacao_em, observacao, criado_por
  ) values (
    v_base, 'MANUAL', v_contrato,
    nullif(btrim(p_dados->>'wo_numero'), ''),
    nullif(btrim(p_dados->>'cliente_nome'), ''),
    nullif(p_dados->>'tipo_pessoa', ''),
    case when p_dados ? 'telefones'
         then array(select jsonb_array_elements_text(p_dados->'telefones'))
         else null end,
    nullif(p_dados->>'tipo_residencia', ''),
    nullif(btrim(p_dados->>'logradouro'), ''),
    nullif(btrim(p_dados->>'complemento'), ''),
    nullif(btrim(p_dados->>'bairro'), ''),
    nullif(btrim(p_dados->>'cidade'), ''),
    left(nullif(btrim(p_dados->>'uf'), ''), 2),
    nullif(btrim(p_dados->>'cep'), ''),
    nullif(btrim(p_dados->>'node'), ''),
    nullif(p_dados->>'lat','')::numeric, nullif(p_dados->>'lng','')::numeric,
    nullif(p_dados->>'area_id','')::uuid,
    nullif(p_dados->>'tipo_servico_id','')::uuid,
    nullif(p_dados->>'tipo_atividade_id','')::uuid,
    v_data,
    nullif(p_dados->>'janela_inicio','')::time,
    nullif(p_dados->>'janela_fim','')::time,
    v_equipe,
    case when v_equipe is null then 'ENTRADA' else 'ATRIBUIDA' end,
    now(),
    nullif(btrim(p_dados->>'observacao'), ''),
    auth.uid()
  ) returning id into v_visita;

  for o in select * from jsonb_array_elements(coalesce(p_dados->'ordens','[]'::jsonb))
  loop
    v_seq := v_seq + 1;
    if v_seq > 10 then
      raise exception 'Uma visita comporta no maximo 10 O.S. (D-001).'
        using errcode = '23514';
    end if;
    v_num := nullif(btrim(o->>'numero_os'), '');
    if v_num is null then v_num := proximo_numero_os(); end if;

    insert into ordem_servico (
      visita_id, sequencia, numero_os, tipo_os_id, descricao,
      produto, observacao, origem, criado_por
    ) values (
      v_visita, v_seq, v_num,
      nullif(o->>'tipo_os_id','')::uuid,
      coalesce(nullif(btrim(o->>'descricao'), ''),
               (select descricao from tipo_os where id = nullif(o->>'tipo_os_id','')::uuid)),
      nullif(btrim(o->>'produto'), ''),
      nullif(btrim(o->>'observacao'), ''),
      'MANUAL', auth.uid()
    );
    v_nums := v_nums || v_num;
  end loop;

  insert into visita_evento (visita_id, tipo, para, origem, usuario_id, login,
                             equipe_id, observacao)
  values (v_visita, 'CADASTRO_MANUAL',
          jsonb_build_object('contrato', v_contrato, 'ordens', to_jsonb(v_nums)),
          'WEB', auth.uid(), (select email from perfil where id = auth.uid()),
          v_equipe, nullif(btrim(p_dados->>'observacao'), ''));

  return jsonb_build_object('visita_id', v_visita, 'ordens', to_jsonb(v_nums));
end;
$fn$;

revoke all on function criar_visita_manual(jsonb) from public, anon;
grant execute on function criar_visita_manual(jsonb) to authenticated;

-- Edita os dados cadastrais de um contrato (cliente e endereço).
--
-- Vale para contrato manual E para contrato do TOA: é justamente o que
-- o sistema atual não deixa fazer. Só campos cadastrais — situação e
-- baixa têm caminho próprio, com trilha própria.
create or replace function atualizar_visita_manual(p_visita uuid, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v_antes jsonb; v_depois jsonb; v_mudou int;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')) then
    raise exception 'Sem permissao para editar contrato.' using errcode = '42501';
  end if;
  if not tem_permissao('servicos.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar contrato".'
      using errcode = '42501';
  end if;

  select to_jsonb(v) - 'dados_origem' into v_antes from visita v
   where v.id = p_visita and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  if v_antes is null then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  update visita set
    contrato        = coalesce(nullif(btrim(p_dados->>'contrato'), ''), contrato),
    wo_numero       = coalesce(nullif(btrim(p_dados->>'wo_numero'), ''), wo_numero),
    cliente_nome    = coalesce(nullif(btrim(p_dados->>'cliente_nome'), ''), cliente_nome),
    tipo_pessoa     = coalesce(nullif(p_dados->>'tipo_pessoa', ''), tipo_pessoa),
    tipo_residencia = coalesce(nullif(p_dados->>'tipo_residencia', ''), tipo_residencia),
    telefones       = case when p_dados ? 'telefones'
                      then array(select jsonb_array_elements_text(p_dados->'telefones'))
                      else telefones end,
    logradouro      = coalesce(nullif(btrim(p_dados->>'logradouro'), ''), logradouro),
    complemento     = coalesce(nullif(btrim(p_dados->>'complemento'), ''), complemento),
    bairro          = coalesce(nullif(btrim(p_dados->>'bairro'), ''), bairro),
    cidade          = coalesce(nullif(btrim(p_dados->>'cidade'), ''), cidade),
    uf              = coalesce(left(nullif(btrim(p_dados->>'uf'), ''),2), uf),
    cep             = coalesce(nullif(btrim(p_dados->>'cep'), ''), cep),
    node            = coalesce(nullif(btrim(p_dados->>'node'), ''), node),
    lat             = coalesce(nullif(p_dados->>'lat','')::numeric, lat),
    lng             = coalesce(nullif(p_dados->>'lng','')::numeric, lng),
    area_id         = coalesce(nullif(p_dados->>'area_id','')::uuid, area_id),
    tipo_servico_id = coalesce(nullif(p_dados->>'tipo_servico_id','')::uuid, tipo_servico_id),
    data_agendada   = coalesce(nullif(p_dados->>'data_agendada','')::date, data_agendada),
    janela_inicio   = coalesce(nullif(p_dados->>'janela_inicio','')::time, janela_inicio),
    janela_fim      = coalesce(nullif(p_dados->>'janela_fim','')::time, janela_fim),
    observacao      = coalesce(nullif(btrim(p_dados->>'observacao'), ''), observacao)
  where id = p_visita;

  select to_jsonb(v) - 'dados_origem' into v_depois from visita v where v.id = p_visita;

  -- Guardamos só o que mudou: a trilha fica legível em vez de repetir
  -- a linha inteira duas vezes.
  with dif as (
    select k from jsonb_object_keys(v_depois) k
     where v_antes->k is distinct from v_depois->k
       and k not in ('atualizado_em','situacao_em')
  )
  insert into visita_evento (visita_id, tipo, de, para, origem, usuario_id, login)
  select p_visita, 'EDICAO_CADASTRO',
         (select jsonb_object_agg(k, v_antes->k)  from dif),
         (select jsonb_object_agg(k, v_depois->k) from dif),
         'WEB', auth.uid(), (select email from perfil where id = auth.uid())
   where exists (select 1 from dif);

  get diagnostics v_mudou = row_count;
  return jsonb_build_object('atualizado', true, 'campos_alterados', v_mudou);
end;
$fn$;

revoke all on function atualizar_visita_manual(uuid, jsonb) from public, anon;
grant execute on function atualizar_visita_manual(uuid, jsonb) to authenticated;

-- Acrescenta uma O.S. a um contrato já existente.
create or replace function adicionar_os(p_visita uuid, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v_seq int; v_num text; v_os uuid;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')) then
    raise exception 'Sem permissao para cadastrar O.S.' using errcode = '42501';
  end if;
  if not tem_permissao('servicos.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar contrato".'
      using errcode = '42501';
  end if;

  perform 1 from visita where id = p_visita and empresa_id = minha_empresa()
    and base_id in (select bases_visiveis());
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  select coalesce(max(sequencia), 0) + 1 into v_seq
    from ordem_servico where visita_id = p_visita;
  if v_seq > 10 then
    raise exception 'Uma visita comporta no maximo 10 O.S. (D-001).'
      using errcode = '23514';
  end if;

  v_num := coalesce(nullif(btrim(p_dados->>'numero_os'), ''), proximo_numero_os());

  insert into ordem_servico (visita_id, sequencia, numero_os, tipo_os_id,
                             descricao, produto, observacao, origem, criado_por)
  values (p_visita, v_seq, v_num, nullif(p_dados->>'tipo_os_id','')::uuid,
          coalesce(nullif(btrim(p_dados->>'descricao'), ''),
                   (select descricao from tipo_os
                     where id = nullif(p_dados->>'tipo_os_id','')::uuid)),
          nullif(btrim(p_dados->>'produto'), ''),
          nullif(btrim(p_dados->>'observacao'), ''),
          'MANUAL', auth.uid())
  returning id into v_os;

  insert into visita_evento (visita_id, os_id, tipo, para, origem, usuario_id, login)
  values (p_visita, v_os, 'OS_ADICIONADA',
          jsonb_build_object('numero_os', v_num, 'sequencia', v_seq),
          'WEB', auth.uid(), (select email from perfil where id = auth.uid()));

  return jsonb_build_object('os_id', v_os, 'numero_os', v_num, 'sequencia', v_seq);
end;
$fn$;

revoke all on function adicionar_os(uuid, jsonb) from public, anon;
grant execute on function adicionar_os(uuid, jsonb) to authenticated;

-- Remove uma O.S. — só as que nasceram aqui e ainda não têm baixa.
-- Apagar O.S. do TOA seria mentir para a operadora na próxima
-- importação: ela voltaria na hora, sem a nossa baixa.
create or replace function remover_os(p_os uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v record;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao para remover O.S.' using errcode = '42501';
  end if;
  if not tem_permissao('servicos.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar contrato".'
      using errcode = '42501';
  end if;

  select o.id, o.visita_id, o.numero_os, o.origem, o.codigo_baixa_id,
         o.codigo_baixa_afline_id
    into v from ordem_servico o join visita vi on vi.id = o.visita_id
   where o.id = p_os and vi.empresa_id = minha_empresa()
     and vi.base_id in (select bases_visiveis());
  if not found then
    raise exception 'O.S. nao encontrada.' using errcode = 'P0002';
  end if;
  if v.origem <> 'MANUAL' then
    raise exception 'Esta O.S. veio do TOA e nao pode ser removida; a importacao a recriaria. Use a baixa para encerra-la.'
      using errcode = '42501';
  end if;
  if v.codigo_baixa_id is not null or v.codigo_baixa_afline_id is not null then
    raise exception 'Esta O.S. ja tem baixa. Remover apagaria o resultado.'
      using errcode = '42501';
  end if;

  insert into visita_evento (visita_id, tipo, de, origem, usuario_id, login, observacao)
  values (v.visita_id, 'OS_REMOVIDA',
          jsonb_build_object('numero_os', v.numero_os),
          'WEB', auth.uid(), (select email from perfil where id = auth.uid()),
          nullif(btrim(p_motivo), ''));

  delete from ordem_servico where id = p_os;
  return jsonb_build_object('removida', true, 'numero_os', v.numero_os);
end;
$fn$;

revoke all on function remover_os(uuid, text) from public, anon;
grant execute on function remover_os(uuid, text) to authenticated;

-- ============================================================
-- C · VOLTAR CONTRATO
-- ============================================================
-- O sistema da CLARO não volta situação. O nosso volta — essa é uma das
-- razões de existir deste projeto. Mas volta com nome, hora e motivo.

create or replace function reverter_situacao(
  p_visita uuid, p_situacao text, p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v_atual text;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao para voltar contrato.' using errcode = '42501';
  end if;
  if not tem_permissao('servicos.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar contrato".'
      using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo de voltar o contrato.' using errcode = '23514';
  end if;

  select situacao into v_atual from visita
   where id = p_visita and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis());
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;
  if v_atual = p_situacao then
    return jsonb_build_object('mudou', false);
  end if;

  update visita set situacao = p_situacao, situacao_em = now()
   where id = p_visita;

  insert into visita_evento (visita_id, tipo, de, para, origem,
                             usuario_id, login, observacao)
  values (p_visita, 'REVERSAO',
          jsonb_build_object('situacao', v_atual),
          jsonb_build_object('situacao', p_situacao),
          'WEB', auth.uid(), (select email from perfil where id = auth.uid()),
          btrim(p_motivo));

  return jsonb_build_object('mudou', true, 'de', v_atual, 'para', p_situacao);
end;
$fn$;

revoke all on function reverter_situacao(uuid, text, text) from public, anon;
grant execute on function reverter_situacao(uuid, text, text) to authenticated;
