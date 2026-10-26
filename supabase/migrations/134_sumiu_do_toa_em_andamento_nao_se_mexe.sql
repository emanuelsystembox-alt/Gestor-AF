-- ┌─ 134 · o que sumiu do TOA EM ANDAMENTO não se mexe: acusa ──────────┐
-- │ > "quando um contrato estiver em deslocamento (...) e depois há uma │
-- │ >  nova importação e esse contrato some da planilha, nós não        │
-- │ >  devemos mexer nesse status. Alguém precisa ir lá ver o que       │
-- │ >  aconteceu (...) significa que aconteceu alguma manipulação no    │
-- │ >  TOA (...) precisa ser corrigido manualmente pelo técnico ou pelo │
-- │ >  controlador" — Emanuel, 25/10                                    │
-- │                                                                     │
-- │ O QUE JÁ ERA VERDADE: a 116 (D-191) só desatribui contrato NA       │
-- │ ENTRADA e que o campo não tocou — *"so pode desatribuir contratos   │
-- │ que tiverem em entrada, em outro status não pode"* (Emanuel, 19/10).│
-- │ Contrato em deslocamento ou em execução que sumia JÁ não era        │
-- │ mexido. O que faltava era o sistema DIZER que isso aconteceu: ele   │
-- │ ficava parado na tela, com a hora velha, e ninguém sabia que a      │
-- │ planilha tinha deixado de trazê-lo.                                 │
-- │                                                                     │
-- │ O QUE MUDA: a importação marca `visita.sumiu_do_toa_em`, escreve no │
-- │ histórico (CONFLITO_TOA — o rótulo que já existe para divergência   │
-- │ com o TOA), avisa o TÉCNICO no sino e acende um SINAL na central do │
-- │ controle. Nenhuma situação muda, nenhuma baixa é dada: o sistema    │
-- │ não sabe o que aconteceu no TOA, e fingir que sabe é pior que       │
-- │ pedir que alguém olhe (regra 6).                                    │
-- │                                                                     │
-- │ A marca sai sozinha quando o contrato VOLTA à planilha, ou quando   │
-- │ alguém encerra o contrato (a correção manual que foi pedida) —      │
-- │ `limpar_sumiu_do_toa`, chamado pelo gatilho de situação.            │
-- │                                                                     │
-- │ "Em andamento" = ATRIBUIDA, EM_DESLOCAMENTO, EM_EXECUCAO e          │
-- │ COM_IMPEDIMENTO: tudo que está em aberto menos Na entrada, que é o  │
-- │ caso da 116. Terminal (concluída, cancelada, reagendada) some da    │
-- │ planilha o tempo todo e isso é normal — não acusa.                  │
-- └─────────────────────────────────────────────────────────────────────┘

alter table visita
  add column if not exists sumiu_do_toa_em timestamptz,
  add column if not exists sumiu_do_toa_importacao uuid references importacao(id);

comment on column visita.sumiu_do_toa_em is
  'Estava EM ANDAMENTO e nao veio na importacao nova do mesmo bucket e dia (134). Nada foi mexido: pede correcao manual.';

create index if not exists visita_sumiu_toa_ix
  on visita (empresa_id, data_agendada) where sumiu_do_toa_em is not null;

-- ── lista fechada em CHECK pega tipo novo (traps.md) ─────────────────
alter table aviso drop constraint if exists aviso_tipo_check;
alter table aviso add constraint aviso_tipo_check check (tipo in (
  'NOVO', 'SITUACAO', 'REABERTO', 'CANCELADO_OPERADORA', 'CHEGOU', 'SAIU',
  'MATERIAL', 'DOIS_ATIVOS', 'SUMIU_TOA'));

alter table sinal drop constraint if exists sinal_tipo_check;
alter table sinal add constraint sinal_tipo_check check (tipo in (
  'AJUDA', 'TEC1', 'RITMO', 'QUEBROU', 'MATERIAL', 'ABASTECIMENTO', 'CERCA',
  'GPS', 'DOIS_ATIVOS', 'SUMIU_TOA'));

-- ── a marca sai quando alguém corrige o contrato ─────────────────────
create or replace function public.limpar_sumiu_do_toa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Correção manual = alguém mudou a situação por fora da importação.
  -- A importação que traz o contrato de volta limpa no próprio laço.
  if new.sumiu_do_toa_em is not null
     and new.situacao is distinct from old.situacao
     and coalesce(current_setting('app.origem', true), '') <> 'IMPORTACAO' then
    new.sumiu_do_toa_em := null;
    new.sumiu_do_toa_importacao := null;
  end if;
  return new;
end;
$function$;

revoke all on function public.limpar_sumiu_do_toa() from public, anon;

drop trigger if exists visita_limpa_sumiu_toa on visita;
create trigger visita_limpa_sumiu_toa
  before update of situacao on visita
  for each row execute function limpar_sumiu_do_toa();

-- ── a importação: desatribui Na entrada, ACUSA o que está em andamento ──
create or replace function public.desatribuir_ausentes(p_importacao_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_imp  importacao;
  v_dia  date;
  v_800  uuid;
  v_eu   uuid := auth.uid();
  n_des  int := 0;
  n_dev  int := 0;
  n_sum  int := 0;
  n_vol  int := 0;
  r      record;
  c_obs_des constant text := 'Saiu da sua rota no TOA: desatribuído automaticamente (cód. 800).';
  c_obs_dev constant text := 'Voltou para a rota no TOA: de volta Na entrada.';
  -- 134: em andamento, nada é mexido — o recado é para gente olhar.
  c_obs_sum constant text :=
    'Sumiu da planilha do TOA enquanto estava em andamento. Nada foi alterado: confira no TOA e corrija à mão.';
  c_obs_vol constant text := 'Voltou a aparecer na planilha do TOA.';
begin
  -- A mesma porta de quem importa (inclui o ROBO opcional, 113).
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('ROBO')) then
    raise exception 'Sem permissao para importar.' using errcode = '42501';
  end if;

  select * into v_imp from importacao where id = p_importacao_id;
  if not found or v_imp.base_id not in (select bases_visiveis()) then
    raise exception 'Importacao fora da cidade ativa.' using errcode = '42501';
  end if;
  -- Só uma importação que ENTROU fala por um bucket inteiro.
  if v_imp.status <> 'APLICADA' or v_imp.bucket is null then
    return jsonb_build_object('desatribuidos', 0, 'devolvidos', 0,
                              'sumiram', 0, 'voltaram', 0,
                              'motivo', 'importacao nao aplicada ou sem bucket');
  end if;
  v_dia := coalesce(v_imp.data_atuacao, hoje_local());

  select id into v_800 from codigo_baixa
   where codigo = 800 and (empresa_id is null or empresa_id = v_imp.empresa_id)
   order by empresa_id nulls last limit 1;
  if v_800 is null then
    raise exception 'O codigo de baixa 800 (Desatribuido) nao esta cadastrado.';
  end if;

  perform set_config('app.origem', 'IMPORTACAO', true);

  -- ── 1. VOLTOU: estava desatribuído e apareceu de novo nesta planilha ──
  for r in
    select v.id, v.situacao from visita v
     where v.desatribuido_em is not null and v.excluido_em is null
       and v.id in (select l.visita_id from importacao_linha l
                     where l.importacao_id = p_importacao_id and l.visita_id is not null)
  loop
    -- Tira só o 800 que NÓS pusemos; baixa AFLINE dada por gente fica.
    update ordem_servico
       set codigo_baixa_afline_id = null, baixa_em = null, baixa_por = null, baixa_observacao = null
     where visita_id = r.id and codigo_baixa_afline_id = v_800
       and baixa_observacao = c_obs_des;

    if r.situacao = 'CANCELADA' then
      insert into visita_evento (visita_id, tipo, de, para, origem, observacao, importacao_id)
      values (r.id, 'SITUACAO', jsonb_build_object('situacao', 'CANCELADA'),
              jsonb_build_object('situacao', 'ENTRADA'), 'IMPORTACAO', c_obs_dev, p_importacao_id);
      update visita set situacao = 'ENTRADA', situacao_em = now(),
                        desatribuido_em = null, desatribuido_por_importacao = null
       where id = r.id;
    else
      -- O TOA já mandou outra situação pelo código: vale a dele.
      update visita set desatribuido_em = null, desatribuido_por_importacao = null where id = r.id;
    end if;
    n_dev := n_dev + 1;
  end loop;

  -- ── 1b. 134: estava acusado de ter sumido e voltou à planilha ────────
  for r in
    select v.id from visita v
     where v.sumiu_do_toa_em is not null and v.excluido_em is null
       and v.id in (select l.visita_id from importacao_linha l
                     where l.importacao_id = p_importacao_id and l.visita_id is not null)
  loop
    update visita set sumiu_do_toa_em = null, sumiu_do_toa_importacao = null where id = r.id;
    insert into visita_evento (visita_id, tipo, origem, observacao, importacao_id)
    values (r.id, 'CONFLITO_TOA', 'IMPORTACAO', c_obs_vol, p_importacao_id);
    n_vol := n_vol + 1;
  end loop;

  -- ── 2. SUMIU: Na entrada, do mesmo bucket, e não está nesta planilha ──
  for r in
    with presentes as materialized (
      select l.visita_id, nullif(btrim(l.dados ->> 'ID da Atividade'), '') as atividade
        from importacao_linha l where l.importacao_id = p_importacao_id
    )
    select v.id from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      cross join lateral (
        select i.bucket from importacao_linha l join importacao i on i.id = l.importacao_id
         where l.visita_id = v.id and i.status = 'APLICADA'
         order by i.criado_em desc limit 1) ult
     where v.base_id = v_imp.base_id
       and v.data_agendada = v_dia
       and v.excluido_em is null
       and v.situacao = 'ENTRADA'
       and v.bloqueado_em is null
       and v.desatribuido_em is null
       and v.toa_atividade_id is not null
       and coalesce(ta.natureza, '') <> 'JORNADA'
       and ult.bucket = v_imp.bucket
       and not exists (select 1 from presentes p where p.visita_id = v.id)
       and not exists (select 1 from presentes p where p.atividade = v.toa_atividade_id)
  loop
    update ordem_servico
       set codigo_baixa_afline_id = v_800, baixa_em = now(), baixa_por = v_eu,
           baixa_observacao = c_obs_des
     where visita_id = r.id and codigo_baixa_afline_id is null;

    insert into visita_evento (visita_id, tipo, de, para, origem, observacao, importacao_id)
    values (r.id, 'SITUACAO', jsonb_build_object('situacao', 'ENTRADA'),
            jsonb_build_object('situacao', 'CANCELADA'), 'IMPORTACAO', c_obs_des, p_importacao_id);
    update visita set situacao = 'CANCELADA', situacao_em = now(),
                      desatribuido_em = now(), desatribuido_por_importacao = p_importacao_id
     where id = r.id;
    n_des := n_des + 1;
  end loop;

  -- ── 3. 134: EM ANDAMENTO e sumiu — não se mexe, acusa ────────────────
  for r in
    with presentes as materialized (
      select l.visita_id, nullif(btrim(l.dados ->> 'ID da Atividade'), '') as atividade
        from importacao_linha l where l.importacao_id = p_importacao_id
    )
    select v.id, v.equipe_id, v.contrato, v.tecnico_responsavel_id, v.situacao,
           coalesce(ts.nome, ta.nome, 'Contrato') as servico
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join tipo_servico ts on ts.id = v.tipo_servico_id
      cross join lateral (
        select i.bucket from importacao_linha l join importacao i on i.id = l.importacao_id
         where l.visita_id = v.id and i.status = 'APLICADA'
         order by i.criado_em desc limit 1) ult
     where v.base_id = v_imp.base_id
       and v.data_agendada = v_dia
       and v.excluido_em is null
       and v.situacao in ('ATRIBUIDA', 'EM_DESLOCAMENTO', 'EM_EXECUCAO', 'COM_IMPEDIMENTO')
       and v.sumiu_do_toa_em is null
       and v.toa_atividade_id is not null
       and coalesce(ta.natureza, '') <> 'JORNADA'
       and ult.bucket = v_imp.bucket
       and not exists (select 1 from presentes p where p.visita_id = v.id)
       and not exists (select 1 from presentes p where p.atividade = v.toa_atividade_id)
  loop
    update visita set sumiu_do_toa_em = now(), sumiu_do_toa_importacao = p_importacao_id
     where id = r.id;

    insert into visita_evento (visita_id, tipo, origem, observacao, importacao_id)
    values (r.id, 'CONFLITO_TOA', 'IMPORTACAO', c_obs_sum, p_importacao_id);

    -- O técnico é avisado no sino: ele é quem sabe o que fez no TOA.
    if r.equipe_id is not null then
      insert into aviso (empresa_id, equipe_id, visita_id, tipo, titulo, detalhe,
                         contrato, servico, situacao_para)
      values (v_imp.empresa_id, r.equipe_id, r.id, 'SUMIU_TOA',
              'Contrato sumiu da planilha do TOA',
              c_obs_sum, r.contrato, r.servico, r.situacao);
    end if;
    n_sum := n_sum + 1;
  end loop;

  perform set_config('app.origem', '', true);
  return jsonb_build_object('desatribuidos', n_des, 'devolvidos', n_dev,
                            'sumiram', n_sum, 'voltaram', n_vol);
end;
$function$;

revoke all on function public.desatribuir_ausentes(uuid) from public, anon;
grant execute on function public.desatribuir_ausentes(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ── o sinal na central ───────────────────────────────────────────────
-- `sinais_do_dia` ganhou o bloco do SUMIU_TOA (lido de
-- `visita.sumiu_do_toa_em`, como o TEC1 é lido de `visita.tec1`), a
-- vigência pela marca e 'SUMIU_TOA' na lista de tipos que a gestão vê.
-- A função é longa e foi recriada a partir da versão DO BANCO
-- (traps.md: o arquivo pode estar atrasado em relação à função viva).
-- Ver o corpo aplicado em `pg_get_functiondef('sinais_do_dia')`.
