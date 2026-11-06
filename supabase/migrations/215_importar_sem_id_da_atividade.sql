-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 215 — Planilha do TOA sem "ID da Atividade": contrato NOVO entra     │
-- │       com uma chave provisória, e a planilha com o ID a troca        │
-- │                                                                      │
-- │ "o outro arquivo que você informa que não tem ID quando é importado, │
-- │  tem que dar um jeito de usar ele (...) talvez o sistema criar a ID  │
-- │  para o novo contrato que não tivesse (...) e depois quando eu       │
-- │  importar com o padrão de sempre ele não duplicar e saber que o      │
-- │  contrato existe" — Emanuel, 05/11.                                  │
-- │                                                                      │
-- │ O DEFEITO (medido em 05/11): das 07:10 às 08:09, 11 importações      │
-- │ manuais da planilha sem ID (São Luís e Manaus, 35 a 269 linhas)      │
-- │ deram "Criadas 0 · Atualizadas 0 · Ignoradas N" — era a primeira     │
-- │ importação do dia, nenhum contrato existia, e a 187 só COMPLETAVA o  │
-- │ ID de contrato que já existia ("contrato novo so entra pela planilha │
-- │ com o ID"). Para o time: "não importa, dá erro". Reproduzido numa    │
-- │ transação desfeita com Atividades-MAN-AFLINE_01_VT_03_11_26 (3):     │
-- │ 55 de 55 linhas IGNORADA.                                            │
-- │                                                                      │
-- │ A CHAVE: 'SEMID-WO-' || "Número da WO", em visita.toa_atividade_id.  │
-- │  · Não colide com o TOA: os IDs dele são números (2.119 de 2.121; os │
-- │    outros 2 são números negativos).                                  │
-- │  · É estável: a mesma WO no mesmo dia e cidade dá a mesma chave, e o │
-- │    índice único (base, atividade, dia) — D-169 — continua valendo.   │
-- │  · A WO aponta UMA atividade por dia e cidade (medido de novo em     │
-- │    05/11: 0 WOs com dois IDs no mesmo dia; a 187 já tinha medido).   │
-- │                                                                      │
-- │ A ORDEM, antes do laço (tudo na LINHA, porque a reconciliação e      │
-- │ `desatribuir_ausentes` leem a linha — 187):                          │
-- │  1. TROCA: linha COM o ID real cuja WO tem contrato provisório no    │
-- │     dia, e nenhum contrato com esse ID → o provisório recebe o ID    │
-- │     (evento EDICAO_CADASTRO, sem aviso). Daí o laço o acha pelo ID   │
-- │     e ATUALIZA — não duplica.                                        │
-- │  2. COMPLETA (187, igual): linha sem ID cuja WO tem UM contrato no   │
-- │     dia → o ID dele (real ou provisório).                            │
-- │  3. CRIA A CHAVE: linha sem ID cuja WO não tem contrato nenhum no    │
-- │     dia, aparece uma vez só entre as linhas sem ID e não vem com ID  │
-- │     em outra linha do arquivo → 'SEMID-WO-<wo>'.                     │
-- │ O que sobra sem ID fica de fora com o porquê (WO repetida, WO com    │
-- │ mais de um contrato, WO com ID noutra linha, sem WO).                │
-- │                                                                      │
-- │ O que NÃO muda: jornada (Na Base, Refeição) não tem WO e continua de │
-- │ fora da planilha sem ID; `desatribuir_ausentes` (210) não foi        │
-- │ tocada — o contrato provisório é achado pela visita_id da linha,     │
-- │ como qualquer outro. `varredura_pendentes` deixa a chave provisória  │
-- │ de fora: não há atividade no TOA com esse número para a extensão     │
-- │ pedir (D-250); depois da troca, o contrato volta à varredura.        │
-- │                                                                      │
-- │ Corpos copiados das funções VIVAS (pg_get_functiondef, 05/11):       │
-- │ importar_toa_interno já tinha a 189 e a 198, que o arquivo 187 não   │
-- │ tem.                                                                 │
-- └──────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION public.importar_toa_interno(p_importacao_id uuid, p_simular boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record; d jsonb;
  v_base uuid; v_id uuid; v_atividade text; v_bloqueada boolean;
  v_tecnico uuid; v_equipe uuid; v_atual text; v_data date;
  v_usuario uuid; v_arquivo text; v_login text; v_nova text;
  j int; v_num_os text; v_cod integer;
  v_baixa_auto boolean := false; v_sit_baixa text; v_sit_agora text;
  v_auto_aqui boolean;  -- 128: a baixa automática vale para ESTE contrato?
  v_desatrib boolean;   -- 184: encerrado pelo 800 do próprio sistema (D-191)?
  v_terminais text[] := situacoes_terminais();  -- 184: uma vez, não por linha
  v_segura boolean;     -- 189: cancelado no TOA depois de andar -- segura em execução
  c_obs_segura constant text :=
    'Cancelado no TOA depois de iniciado: fica em execução até você dar a baixa.';
  -- 090: o dia de atuação, escolhido por quem importa
  v_dia date; v_dia_antes date; v_dia_planilha date;
  n_criadas int := 0; n_atualiz int := 0; n_ignor int := 0;
  n_erro int := 0; n_conflito int := 0; n_os int := 0; n_susp int := 0;
  resumo jsonb;
  n_pela_wo int := 0;   -- 187: linhas cujo ID veio da WO do dia
  n_provis  int := 0;   -- 215: linhas que ganharam a chave provisória
  n_trocado int := 0;   -- 215: contratos provisórios que receberam o ID real
  c_prov constant text := 'SEMID-WO-';  -- 215: o prefixo da chave provisória
begin
  perform set_config('app.origem', 'IMPORTACAO', true);

  -- Baixa automatica: o sistema aplica sozinho a situacao que o
  -- codigo do TOA significa. Nasce desligada; quem liga e o ADMIN,
  -- em Configuracoes.
  select coalesce(p.valor = 'true'::jsonb, false) into v_baixa_auto
    from importacao i
    join base b on b.id = i.base_id
    join parametro p on p.empresa_id = b.empresa_id and p.chave = 'baixa_automatica'
   where i.id = p_importacao_id;

  select base_id, usuario_id, arquivo_nome, data_atuacao
    into v_base, v_usuario, v_arquivo, v_dia
    from importacao where id = p_importacao_id;
  if v_base is null then
    raise exception 'Importacao % nao encontrada', p_importacao_id;
  end if;
  -- 090: sem escolha gravada, e HOJE em Manaus -- nunca a data da planilha.
  v_dia := coalesce(v_dia, hoje_local());

  -- ┌─ 187: planilha SEM a coluna "ID da Atividade" ──────────────────┐
  -- │ O TOA deixa cada um montar as colunas da exportação, e em 03/11 │
  -- │ veio um arquivo do MAN-AFLINE_01_VT sem o ID — todas as linhas  │
  -- │ caíam em "Sem ID da Atividade". O ID se acha pela WO: no MESMO  │
  -- │ dia de atuação e na MESMA cidade a WO aponta uma atividade só   │
  -- │ (medido no histórico inteiro: 0 casos de WO com dois IDs no dia).│
  -- │                                                                  │
  -- │ Só se COMPLETA o que já existe: WO sem contrato no dia continua │
  -- │ sem ID e fica de fora, com o porquê. Inventar uma chave criaria │
  -- │ o contrato em dobro quando a planilha certa chegasse (D-004).   │
  -- │ O ID vai para a LINHA, não só para a variável: a reconciliação  │
  -- │ (`desatribuir_ausentes`) lê a linha — sem ele, a rota inteira   │
  -- │ pareceria ter sumido do TOA.                                     │
  -- └──────────────────────────────────────────────────────────────────┘

  -- ┌─ 215 · 1. TROCA: a planilha com o ID acha o contrato provisório ─┐
  -- │ Antes da 187 e antes do laço: o contrato que entrou pela planilha │
  -- │ sem ID ('SEMID-WO-<wo>') recebe o ID real quando a linha da mesma │
  -- │ WO chega com ele. O laço então o acha pelo ID e ATUALIZA — sem    │
  -- │ isto, criaria um segundo contrato da mesma WO no mesmo dia.       │
  -- │ Só troca o que é inequívoco: a WO com UM ID no arquivo, o ID com  │
  -- │ UMA WO, e nenhum contrato do dia já com esse ID.                  │
  -- │                                                                   │
  -- │ A SUSPENSA não conta: o TOA suspende a atividade e abre outra com │
  -- │ a MESMA WO. Medido em 05/11 no histórico inteiro (867 importa-    │
  -- │ ções): 1.149 vezes uma WO com dois IDs no mesmo arquivo, e em     │
  -- │ TODAS só um deles não estava suspenso. Contando a suspensa, a WO  │
  -- │ pareceria ambígua e o provisório viraria contrato em dobro.       │
  -- └───────────────────────────────────────────────────────────────────┘
  with com_id as (
    select btrim(l.dados ->> 'Número da WO') as wo,
           min(btrim(l.dados ->> 'ID da Atividade')) as atividade
      from importacao_linha l
     where l.importacao_id = p_importacao_id
       and nullif(btrim(coalesce(l.dados ->> 'ID da Atividade', '')), '') is not null
       and btrim(l.dados ->> 'ID da Atividade') not like c_prov || '%'
       and nullif(btrim(coalesce(l.dados ->> 'Número da WO', '')), '') is not null
       and norm_txt(coalesce(l.dados ->> 'Status da Atividade', '')) <> 'SUSPENSO'
     group by 1
    having count(distinct btrim(l.dados ->> 'ID da Atividade')) = 1
  ), unico as (
    select c.wo, c.atividade from com_id c
     where (select count(*) from com_id c2 where c2.atividade = c.atividade) = 1
  ), troca as (
    update visita v
       set toa_atividade_id = u.atividade
      from unico u
     where v.base_id = v_base and v.data_agendada = v_dia
       and v.toa_atividade_id = c_prov || u.wo
       and not exists (select 1 from visita x
                        where x.base_id = v_base and x.data_agendada = v_dia
                          and x.toa_atividade_id = u.atividade)
    returning v.id, u.wo, u.atividade, v.equipe_id, v.tecnico_responsavel_id
  )
  insert into visita_evento (visita_id, tipo, de, para, origem, usuario_id,
                             importacao_id, observacao, equipe_id, tecnico_id)
  select t.id, 'EDICAO_CADASTRO',
         jsonb_build_object('toa_atividade_id', c_prov || t.wo),
         jsonb_build_object('toa_atividade_id', t.atividade),
         'IMPORTACAO', v_usuario, p_importacao_id,
         'A chave provisória (planilha sem ID) virou o ID da Atividade do TOA',
         t.equipe_id, t.tecnico_responsavel_id
    from troca t;
  get diagnostics n_trocado = row_count;

  with achado as (
    select l.id, min(v.toa_atividade_id) as atividade
      from importacao_linha l
      join visita v on v.base_id = v_base and v.data_agendada = v_dia
                   and v.wo_numero = btrim(l.dados ->> 'Número da WO')
                   and v.toa_atividade_id is not null
     where l.importacao_id = p_importacao_id
       and nullif(btrim(coalesce(l.dados ->> 'ID da Atividade', '')), '') is null
       and nullif(btrim(coalesce(l.dados ->> 'Número da WO', '')), '') is not null
     group by l.id
    having count(distinct v.toa_atividade_id) = 1
  )
  update importacao_linha l
     set dados = l.dados || jsonb_build_object('ID da Atividade', a.atividade)
    from achado a
   where l.id = a.id;
  get diagnostics n_pela_wo = row_count;

  -- ┌─ 215 · 3. CRIA A CHAVE: WO sem contrato no dia ───────────────────┐
  -- │ Sobrou sem ID depois da 187 = a WO não tem contrato neste dia (ou │
  -- │ tem mais de um). Sem contrato nenhum, a linha ganha a chave       │
  -- │ provisória e o laço cria o contrato com ela. Fica de fora, com o  │
  -- │ porquê na linha, o que não dá para chavear sem adivinhar:         │
  -- │  · a WO se repete entre as linhas sem ID (as duas virariam uma);  │
  -- │  · a mesma WO vem com o ID noutra linha do arquivo (o laço cria   │
  -- │    pelo ID; a chave daria o mesmo contrato duas vezes);           │
  -- │  · já há contrato do dia com a WO (dois, ou um sem ID do TOA).    │
  -- │ A suspensa fica fora da conta (ver o passo 1) e sem chave: o laço │
  -- │ a recusa como suspensa, com ou sem ID.                            │
  -- └───────────────────────────────────────────────────────────────────┘
  with sem as materialized (
    select l.id, btrim(l.dados ->> 'Número da WO') as wo
      from importacao_linha l
     where l.importacao_id = p_importacao_id
       and nullif(btrim(coalesce(l.dados ->> 'ID da Atividade', '')), '') is null
       and nullif(btrim(coalesce(l.dados ->> 'Número da WO', '')), '') is not null
       and norm_txt(coalesce(l.dados ->> 'Status da Atividade', '')) <> 'SUSPENSO'
  ), wo_com_id as materialized (
    select distinct btrim(l.dados ->> 'Número da WO') as wo
      from importacao_linha l
     where l.importacao_id = p_importacao_id
       and nullif(btrim(coalesce(l.dados ->> 'ID da Atividade', '')), '') is not null
       and nullif(btrim(coalesce(l.dados ->> 'Número da WO', '')), '') is not null
       and norm_txt(coalesce(l.dados ->> 'Status da Atividade', '')) <> 'SUSPENSO'
  ), wo_do_dia as materialized (
    select distinct v.wo_numero as wo from visita v
     where v.base_id = v_base and v.data_agendada = v_dia and v.wo_numero is not null
  ), motivo as (
    select s.id, s.wo,
           case
             when (select count(*) from sem s2 where s2.wo = s.wo) > 1 then
               'Sem ID da Atividade, e a WO se repete nesta planilha: use a planilha com o ID'
             when s.wo in (select wo from wo_com_id) then
               'Sem ID da Atividade, e a mesma WO vem com o ID em outra linha desta planilha'
             when s.wo in (select wo from wo_do_dia) then
               'Sem ID da Atividade, e a WO tem mais de um contrato neste dia (ou um sem ID do TOA): confira'
           end as msg
      from sem s
  ), de_fora as (
    update importacao_linha l set mensagem = m.msg
      from motivo m where l.id = m.id and m.msg is not null
    returning l.id
  )
  update importacao_linha l
     set dados = l.dados || jsonb_build_object('ID da Atividade', c_prov || m.wo)
    from motivo m
   where l.id = m.id and m.msg is null;
  get diagnostics n_provis = row_count;

  for r in
    select id, numero_linha, dados from importacao_linha
    where importacao_id = p_importacao_id order by numero_linha
  loop
    begin
      d := r.dados;
      v_atividade := j_txt(d, 'ID da Atividade');

      -- Suspensa e tentativa abortada: sem baixa, sem O.S.
      -- executada, sem trabalho feito. Nao entra (051).
      -- 215: antes do "sem ID" -- a suspensa da planilha sem ID fica sem
      -- chave de proposito (passo 3) e e contada como suspensa.
      if norm_txt(coalesce(j_txt(d, 'Status da Atividade'),'')) = 'SUSPENSO' then
        n_susp := n_susp + 1;
        update importacao_linha set resultado = 'IGNORADA',
          mensagem = 'Atividade suspensa -- nao aconteceu' where id = r.id;
        continue;
      end if;

      if v_atividade is null then
        n_ignor := n_ignor + 1;
        -- 215: o porquê, quando há WO, já foi escrito na linha (passo 3)
        update importacao_linha set resultado = 'IGNORADA',
          mensagem = coalesce(mensagem, case
            when j_txt(d, 'Número da WO') is not null
              then 'Sem ID da Atividade, e a WO nao deu para chavear'
            else 'Sem ID da Atividade e sem WO' end)
          where id = r.id;
        continue;
      end if;

      v_login := j_txt(d, 'Login do Técnico');
      -- 090: o dia e o da importacao. A "Data" da planilha so vai para
      -- a trilha (evento), e continua inteira em dados_origem.
      v_data  := v_dia;
      v_dia_planilha := j_data(d, 'Data');

      -- QUEM MANDA E O CADASTRO. `equipe_do_login` consulta, nesta
      -- ordem: o historico de login da equipe na data, o login corrente
      -- da equipe, e so por ultimo a matricula do tecnico. Antes daqui
      -- a importacao usava SO o ultimo criterio, e por isso ignorava o
      -- que o usuario tinha cadastrado.
      v_equipe  := equipe_do_contrato(v_base, v_login, v_data);
      -- ┌─ 070: a AREA DE TRABALHO entra no catalogo ─────────────┐
      -- │ A planilha traz "ARN-AREA01". O catalogo so tinha MA1..  │
      -- │ MA5 (Manaus), entao o `select` nao achava e a coluna     │
      -- │ ficava NULA -- perdendo um dado que estava no arquivo.   │
      -- │ Agora o catalogo aprende com a planilha, que e a fonte.  │
      -- └─────────────────────────────────────────────────────────┘
      if nullif(btrim(coalesce(j_txt(d, 'Área de Trabalho'), '')), '') is not null then
        insert into area_trabalho (codigo, apelido, base_id, empresa_id)
        values (btrim(j_txt(d, 'Área de Trabalho')),
                btrim(j_txt(d, 'Área de Trabalho')),
                v_base, (select empresa_id from base where id = v_base))
        on conflict (codigo) do nothing;
      end if;


      v_tecnico := null;
      select t.id into v_tecnico
      from tecnico t
      where t.base_id = v_base
        and norm_txt(t.matricula) = norm_txt(v_login)
      limit 1;

      v_id := null; v_bloqueada := null; v_atual := null; v_dia_antes := null;
      v_desatrib := null;
      select v.id, v.bloqueado_em is not null, v.situacao, v.data_agendada,
             v.desatribuido_em is not null
        into v_id, v_bloqueada, v_atual, v_dia_antes, v_desatrib
      from visita v
      -- 095: a atividade do TOA e unica POR DIA. O mesmo arquivo importado
      -- em outro dia gera contratos NOVOS nesse dia, sem puxar o historico.
      where v.base_id = v_base and v.toa_atividade_id = v_atividade
        and v.data_agendada = v_dia;

      v_nova := situacao_do_toa(j_txt(d, 'Status da Atividade'));

      -- 128: a baixa automática vale para o contrato que o campo NÃO BAIXOU
      -- (Emanuel, 24/10). Tocado pelo campo só protege quem deu baixa da
      -- AFLINE em alguma O.S. (D-006).
      v_auto_aqui := v_baixa_auto and (not coalesce(v_bloqueada, false)
        or not exists (select 1 from ordem_servico o
                        where o.visita_id = v_id and o.codigo_baixa_afline_id is not null));
      -- 128: sem o vai-e-volta. Com TODAS as O.S. já com código, a baixa
      -- automática no fim SEMPRE leva à situação do código, qualquer que
      -- seja o status do TOA ("concluído", ou "iniciado" de quem reabriu a
      -- atividade — traps.md). Então grava essa situação desde a primeira
      -- escrita: mesmo resultado, sem 2 eventos e 2 avisos por importação.
      if v_id is not null and v_auto_aqui then
        v_nova := coalesce(situacao_da_baixa(v_id), v_nova);
      end if;

      -- 184: encerrado não reabre (Emanuel, 03/11). Só o CÓDIGO muda um
      -- encerrado, e só para outro encerrado: a baixa automática, quando
      -- vale para este contrato. O status do TOA ("concluído" = EM_EXECUCAO
      -- em situacao_do_toa) passava por cima da Concluída que o campo deu.
      -- O Desatribuído do próprio sistema volta quando reaparece (D-191).
      if v_id is not null and v_atual = any(v_terminais)
         and not coalesce(v_desatrib, false) then
        v_nova := case when v_auto_aqui
                       then coalesce(situacao_da_baixa(v_id), v_atual)
                       else v_atual end;
      end if;

      -- ┌─ 189: o TOA não encerra o que já ANDOU (Emanuel, 03/11) ─────────┐
      -- │ "se teve status o sistema leva o contrato até em execução,       │
      -- │  depois disso o técnico precisa baixar manual (...) quando não   │
      -- │  há movimentação de status, o sistema pode puxar o contrato      │
      -- │  direto pra cancelado". O técnico às vezes pede ao cliente que   │
      -- │  cancele; o contrato sai da linha dele no TOA e virava Cancelada │
      -- │  sozinho. Agora: CANCELADO no TOA + o contrato já esteve em      │
      -- │  deslocamento/execução (pela importação ou pela mão de alguém)   │
      -- │  → fica em Em execução, sem baixa automática, até a baixa do     │
      -- │  técnico. Sem movimento, cancela como sempre. Concluído com      │
      -- │  código continua fechando sozinho (perguntado: "Só cancelado e   │
      -- │  sumiu"). Encerrado não reabre (184) — por isso só fora dele.    │
      -- └──────────────────────────────────────────────────────────────────┘
      v_segura := false;
      -- 198: "cancelado" no TOA OU "Cancelado no Sistema NETSMS" (que vem
      -- com "não concluído") = cancelado pela central. Movimento é o que
      -- ACONTECEU (TOA em rota/iniciado numa importação, ou mão de alguém) —
      -- não a conversão de "não concluído" em Em execução (D-289).
      if cancelado_pela_central(j_txt(d, 'Status da Atividade'), j_txt(d, 'Motivo de Fechamento Externo'))
         and (v_id is null or not (v_atual = any(v_terminais))) then
        v_auto_aqui := false;
        if v_id is not null and teve_movimento(v_id) then
          v_segura := true;
          -- o Ticket de suporte (COM_IMPEDIMENTO) é pedido do técnico: fica
          v_nova := case when v_atual in ('EM_EXECUCAO', 'COM_IMPEDIMENTO')
                         then v_atual else 'EM_EXECUCAO' end;
        else
          -- sem movimento: direto para Cancelado pela central (Emanuel, 03/11)
          v_nova := 'CANCELADA';
        end if;
      end if;

      -- 189: o status que alguém pôs à mão (bloqueado_em) não VOLTA pela
      -- importação — "Vale o do técnico" (Emanuel, 03/11). O TOA ainda em
      -- rota/pendente não desfaz o "cheguei". Avançar pode, até Em execução;
      -- encerrar continua sendo pelo código ou pela baixa.
      if v_id is not null and coalesce(v_bloqueada, false)
         and not (v_atual = any(v_terminais)) and not (v_nova = any(v_terminais))
         and (case v_nova when 'ATRIBUIDA' then 1 when 'EM_DESLOCAMENTO' then 2
                          when 'EM_EXECUCAO' then 3 when 'COM_IMPEDIMENTO' then 3 else 0 end)
             <= (case v_atual when 'ATRIBUIDA' then 1 when 'EM_DESLOCAMENTO' then 2
                              when 'EM_EXECUCAO' then 3 when 'COM_IMPEDIMENTO' then 3 else 0 end) then
        v_nova := v_atual;
      end if;

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
          v_data,
          j_hora(d,'Intervalo de Tempo',1), j_hora(d,'Intervalo de Tempo',2),
          v_equipe, v_tecnico,
          v_nova, now(),
          j_ts_no_dia(d, v_dia, 'Início'), j_ts_no_dia(d, v_dia, 'Fim'),
          j_interv(d,'Tempo de Deslocamento'),
          p_importacao_id, d
        ) returning id into v_id;

        n_criadas := n_criadas + 1;
        update importacao_linha set resultado = 'CRIADA', visita_id = v_id
          where id = r.id;

        insert into visita_evento (visita_id, tipo, para, origem,
                                   usuario_id, login, importacao_id, observacao,
                                   equipe_id, tecnico_id)
        values (v_id, 'IMPORTADA',
                jsonb_build_object('atividade', v_atividade, 'situacao', v_nova,
                                   'dia', v_dia)
                || case when v_dia_planilha is distinct from v_dia
                        then jsonb_build_object('data_planilha', v_dia_planilha)
                        else '{}'::jsonb end
                -- 215: entrou pela planilha sem ID, com a chave provisória
                || case when v_atividade like c_prov || '%'
                        then jsonb_build_object('chave_provisoria', true)
                        else '{}'::jsonb end,
                'IMPORTACAO', v_usuario, v_login, p_importacao_id, v_arquivo,
                v_equipe, v_tecnico);

      else
        -- 095: nao ha mais "mudar de dia" -- a busca ja e pelo dia (acima).

        if v_bloqueada then
          -- D-006 continua protegendo o TRABALHO do campo (baixa, foto,
          -- observacao). O STATUS, nao: o sistema e espelho do TOA, e
          -- status que nao espelha nao serve para despachar. O conflito
          -- continua sendo gravado, entao nada se perde da trilha.
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
            -- 071: a AREA tambem na ATUALIZACAO. Ela so era gravada no
            -- INSERT, entao visita importada antes de a area existir no
            -- catalogo ficava sem area PARA SEMPRE -- reimportar nao
            -- consertava. `coalesce` para nunca apagar o que ja havia.
            area_id = coalesce((select id from area_trabalho
                                 where norm_txt(codigo) = norm_txt(j_txt(d, 'Área de Trabalho'))),
                               area_id),
            segmentacao_id = coalesce((select id from segmentacao
               where norm_txt(nome) = norm_txt(j_txt(d,'Segmentação'))), segmentacao_id),
            data_agendada  = v_dia,
            janela_inicio  = coalesce(j_hora(d,'Intervalo de Tempo',1), janela_inicio),
            janela_fim     = coalesce(j_hora(d,'Intervalo de Tempo',2), janela_fim),
            situacao       = v_nova,
            situacao_em    = case when v_nova is distinct from v_atual
                                  then now() else situacao_em end,
            -- 128: a hora e a linha do TOA também no contrato tocado pelo
            -- campo — são do TOA, não trabalho do campo (D-006 protege a baixa).
            inicio = coalesce(j_ts_no_dia(d, v_dia, 'Início'), inicio),
            fim    = coalesce(j_ts_no_dia(d, v_dia, 'Fim'), fim),
            tempo_deslocamento = coalesce(j_interv(d,'Tempo de Deslocamento'), tempo_deslocamento),
            dados_origem = d
          where id = v_id;

          if v_nova is distinct from v_atual and not v_segura then  -- 189: o aviso é o de baixo
            n_conflito := n_conflito + 1;
            insert into visita_evento (visita_id, tipo, de, para, origem,
                                       usuario_id, login, importacao_id,
                                       equipe_id, tecnico_id, observacao)
            values (v_id, 'CONFLITO_TOA',
              jsonb_build_object('situacao', v_atual),
              jsonb_build_object('situacao', v_nova,
                                 'toa', j_txt(d,'Status da Atividade')),
              'IMPORTACAO', v_usuario, v_login, p_importacao_id,
              v_equipe, v_tecnico,
              'O TOA sobrepos a situacao registrada em campo');
            update importacao_linha set resultado = 'CONFLITO',
              mensagem = 'TOA sobrepos a situacao do campo', visita_id = v_id
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
            data_agendada = v_dia,
            janela_inicio = coalesce(j_hora(d,'Intervalo de Tempo',1), janela_inicio),
            janela_fim    = coalesce(j_hora(d,'Intervalo de Tempo',2), janela_fim),
            -- 071: a AREA tambem na ATUALIZACAO. Ela so era gravada no
            -- INSERT, entao visita importada antes de a area existir no
            -- catalogo ficava sem area PARA SEMPRE -- reimportar nao
            -- consertava. `coalesce` para nunca apagar o que ja havia.
            area_id = coalesce((select id from area_trabalho
                                 where norm_txt(codigo) = norm_txt(j_txt(d, 'Área de Trabalho'))),
                               area_id),
            equipe_id     = case when rota_fixada_em is not null then equipe_id
                                 else coalesce(v_equipe, equipe_id) end,
            tecnico_responsavel_id = case when rota_fixada_em is not null
                                          then tecnico_responsavel_id
                                          else coalesce(v_tecnico, tecnico_responsavel_id) end,
            situacao      = v_nova,
            situacao_em   = now(),
            -- 090: a hora da planilha, no dia de atuacao. Mudando o dia,
            -- o inicio antigo mudaria junto -- por isso nao e coalesce
            -- com a data velha quando o dia muda.
            inicio        = coalesce(j_ts_no_dia(d, v_dia, 'Início'),
                                     case when v_dia_antes is not distinct from v_dia
                                          then inicio end),
            fim           = coalesce(j_ts_no_dia(d, v_dia, 'Fim'),
                                     case when v_dia_antes is not distinct from v_dia
                                          then fim end),
            tempo_deslocamento = coalesce(j_interv(d,'Tempo de Deslocamento'), tempo_deslocamento),
            dados_origem  = d
          where id = v_id;

          if v_nova is distinct from v_atual and not v_segura then  -- 189: o aviso é o de baixo
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

        -- 189: o técnico fica sabendo UMA vez (a importação roda a cada 15 min)
        if v_segura and not exists (select 1 from visita_evento e
                                     where e.visita_id = v_id and e.tipo = 'CONFLITO_TOA'
                                       and e.observacao = c_obs_segura) then
          insert into visita_evento (visita_id, tipo, de, para, origem,
                                     usuario_id, login, importacao_id,
                                     equipe_id, tecnico_id, observacao)
          values (v_id, 'CONFLITO_TOA',
                  jsonb_build_object('situacao', v_atual),
                  jsonb_build_object('situacao', v_nova, 'toa', j_txt(d, 'Status da Atividade')),
                  'IMPORTACAO', v_usuario, v_login, p_importacao_id,
                  v_equipe, v_tecnico, c_obs_segura);
          insert into aviso (empresa_id, equipe_id, visita_id, tipo, titulo, detalhe,
                             contrato, servico, situacao_de, situacao_para)
          select v.empresa_id, v.equipe_id, v.id, 'CANCELADO_OPERADORA',
                 'Cancelado no TOA — dê a baixa', c_obs_segura, v.contrato,
                 coalesce(ts.nome, ta.nome, 'Contrato'), v_atual, v_nova
            from visita v
            left join tipo_servico ts on ts.id = v.tipo_servico_id
            left join tipo_atividade ta on ta.id = v.tipo_atividade_id
           where v.id = v_id and v.equipe_id is not null;
        end if;
      end if;

      for j in 1..10 loop
        v_num_os := j_txt(d, 'Número da O.S ' || j);
        continue when v_num_os is null;
                -- ┌─ 070: o TIPO DA O.S. entra no catalogo ───────────────┐
        -- │ "87 - RETIRAR EMTA": o numero e o codigo, o resto e o  │
        -- │ nome. Sem o tipo no catalogo a O.S. aparecia como "—"  │
        -- │ na tela, com o nome ali, no arquivo, sem ser lido.     │
        -- │                                                       │
        -- │ So entra quando ha DESCRICAO de verdade: se a celula   │
        -- │ trouxer so o numero, nada e inventado -- fica nulo, e  │
        -- │ a tela continua dizendo que nao sabe.                  │
        -- └───────────────────────────────────────────────────────┘
        if extrai_codigo(j_txt(d, 'Tipo O.S ' || j)) is not null then
          insert into tipo_os (codigo, descricao, empresa_id)
          select extrai_codigo(j_txt(d, 'Tipo O.S ' || j)),
                 btrim(regexp_replace(j_txt(d, 'Tipo O.S ' || j),
                                      '^[[:space:]]*[0-9]+[[:space:]]*-[[:space:]]*', '')),
                 (select empresa_id from base where id = v_base)
           where btrim(regexp_replace(j_txt(d, 'Tipo O.S ' || j),
                        '^[[:space:]]*[0-9]+[[:space:]]*-[[:space:]]*', '')) <> ''
             and btrim(regexp_replace(j_txt(d, 'Tipo O.S ' || j),
                        '^[[:space:]]*[0-9]+[[:space:]]*-[[:space:]]*', ''))
                 <> btrim(j_txt(d, 'Tipo O.S ' || j))
          on conflict (codigo) do nothing;
        end if;

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
          -- O codigo da OPERADORA e espelho: se o TOA mudou, o nosso muda.
          -- A baixa da AFLINE (`codigo_baixa_afline_id`) nao e tocada.
          status_operadora = coalesce(excluded.status_operadora, ordem_servico.status_operadora),
          codigo_baixa_id  = coalesce(excluded.codigo_baixa_id, ordem_servico.codigo_baixa_id),
          descricao        = coalesce(ordem_servico.descricao, excluded.descricao);

        n_os := n_os + 1;
      end loop;

      -- TEC1: aderencia a janela (047). Medicao, nao decisao --
      -- por isso roda sempre, independente da baixa automatica.
      perform extrair_produtos(v_id);
      update visita set tec1 = tec1_da_visita(v_id),
             finalizado_toa = norm_txt(coalesce(j_txt(d, 'Status da Atividade'),''))
                              in ('CONCLUIDO','NAO CONCLUIDO')
       where id = v_id;

      -- A situacao sai do CODIGO, nao do status: EXECUTADA virou
      -- Reagendamento 1.075 vezes e Cancelado 657 no analitico do
      -- ngestor. So aplica quando TODAS as O.S. da visita tem codigo
      -- com destino declarado -- meia baixa nao e baixa. Contrato
      -- tocado pelo campo (bloqueado_em) nao e sobrescrito, e a
      -- mudanca deixa evento: situacao que muda sozinha sem registro
      -- e a que ninguem consegue explicar depois.
      if v_auto_aqui then  -- 128 (antes: not v_bloqueada)
        v_sit_baixa := situacao_da_baixa(v_id);
        select situacao into v_sit_agora from visita where id = v_id;
        if v_sit_baixa is not null and v_sit_baixa is distinct from v_sit_agora then
          insert into visita_evento (visita_id, tipo, de, para, origem, observacao,
                                     importacao_id)
          values (v_id, 'SITUACAO',
                  jsonb_build_object('situacao', v_sit_agora),
                  jsonb_build_object('situacao', v_sit_baixa),
                  'IMPORTACAO', 'Baixa automatica pelo codigo de baixa do TOA',
                  p_importacao_id);
          update visita set situacao = v_sit_baixa, situacao_em = now()
           where id = v_id;
        end if;
      end if;

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
    'suspensas', n_susp,
    'id_pela_wo', n_pela_wo,
    'provisorias', n_provis,     -- 215
    'id_trocado', n_trocado,     -- 215
    'dia', v_dia,
    'simulacao', p_simular);

  perform set_config('app.origem', '', true);

  if p_simular then
    raise exception using errcode = 'P0001',
      message = 'PREVIA:' || resumo::text;
  end if;

  update importacao set
    status = 'APLICADA', aplicado_em = now(),
    data_atuacao = v_dia,
    qtd_criadas = n_criadas, qtd_atualizadas = n_atualiz,
    qtd_ignoradas = n_ignor, qtd_erro = n_erro, qtd_conflito = n_conflito
  where id = p_importacao_id;

  return resumo;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.varredura_pendentes(p_base uuid, p_buckets text[] DEFAULT NULL::text[], p_o_que text DEFAULT 'TUDO'::text)
 RETURNS TABLE(aid text, contrato text, precisa_nome boolean, precisa_equipamento boolean, bucket text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_o_que text := upper(coalesce(nullif(btrim(p_o_que), ''), 'TUDO'));
  v_todos boolean := p_buckets is null or cardinality(p_buckets) = 0;
begin
  if not ((select eh_gestor()) or tem_papel('CONTROLADOR') or tem_papel('ROBO')) then
    raise exception 'Sem permissao para varrer.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_visiveis()) then
    raise exception 'Esta cidade nao e a cidade ativa da sua tela.' using errcode = '42501';
  end if;
  if v_o_que not in ('TUDO', 'NOME', 'EQUIPAMENTO') then
    raise exception 'O que varrer: TUDO, NOME ou EQUIPAMENTO (veio %).', p_o_que;
  end if;
  return query
  with c as (
    select v.toa_atividade_id as aid, v.contrato, v.toa_bucket as bucket, v.fim, v.janela_inicio,
           nullif(btrim(coalesce(v.cliente_nome, '')), '') is null as sem_nome,
           coalesce(v.finalizado_toa, false) and v.toa_varrido_em is null as sem_lista
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.base_id = p_base
       and v.data_agendada = hoje_local()
       and v.excluido_em is null
       and v.toa_atividade_id is not null
       -- 215: a chave provisória (planilha sem ID) não é atividade do TOA
       and v.toa_atividade_id not like 'SEMID-WO-%'
       and coalesce(ta.natureza, '') <> 'JORNADA'
       and (v_todos or v.toa_bucket = any (p_buckets))
  )
  select c.aid, c.contrato,
         c.sem_nome and v_o_que <> 'EQUIPAMENTO',
         c.sem_lista and v_o_que <> 'NOME',
         c.bucket
    from c
   where (v_o_que in ('TUDO', 'NOME') and c.sem_nome)
      or (v_o_que in ('TUDO', 'EQUIPAMENTO') and c.sem_lista)
   -- um bucket de cada vez (120); a extensão põe o bucket ABERTO no Console primeiro
   order by c.bucket nulls last, c.fim nulls last, c.janela_inicio nulls last;
end;
$function$

;

-- create or replace preserva a ACL; reafirmada para quem ler o arquivo
-- (importar_toa_interno só é chamada por importar_toa, que confere o papel).
revoke all on function public.importar_toa_interno(uuid, boolean) from public, anon, authenticated;
revoke all on function public.varredura_pendentes(uuid, text[], text) from public, anon;
grant execute on function public.varredura_pendentes(uuid, text[], text) to authenticated;

notify pgrst, 'reload schema';
