-- 026 · Reatendimento, dupla baixa e exclusão de contrato
--
-- Tudo aqui saiu do relatório mensal do ngestor
-- (`ANALISE GESTOR - MENSAL/_14-07-2026_23-22.xlsx`, 17.987 linhas),
-- não de suposição.

-- ┌─ D-041 · O MESMO CONTRATO É ATENDIDO MAIS DE UMA VEZ ────────────┐
-- │                                                                  │
-- │ Medido no relatório de julho:                                    │
-- │   · 17.987 linhas, 17.987 `ID` distintos — o ID é do ATENDIMENTO │
-- │   · 2.656 contratos aparecem com mais de um ID (18%)             │
-- │   ·   536 contrato+dia com mais de um ID                         │
-- │   · 2.036 O.S. aparecem em mais de um ID                         │
-- │                                                                  │
-- │ Exemplo real, contrato 226622995 em 01/07:                       │
-- │   ID 1272333  WO 230133181  Reagendamento  101 Endereco Nao Loc. │
-- │   ID 1272703  WO 230264018  Concluido      409 Instalacao Efet.  │
-- │                                                                  │
-- │ Quebrou de manhã, o cliente reagendou, foi de novo à tarde. São  │
-- │ DOIS atendimentos, dois deslocamentos, duas baixas — e o TOA     │
-- │ emite WO nova para o segundo.                                    │
-- │                                                                  │
-- │ Nosso modelo já acerta: `visita.toa_atividade_id` é o ID do      │
-- │ atendimento. O que estava errado era UM ÍNDICE: `numero_os` era  │
-- │ único no banco inteiro, como se uma O.S. vivesse numa visita só. │
-- │ Por isso 8 visitas do 05/09 entraram SEM as O.S. — o erro que o  │
-- │ log de importação revelou.                                       │
-- └──────────────────────────────────────────────────────────────────┘

drop index if exists ordem_servico_numero_os_idx;
create index if not exists ordem_servico_numero_os_idx on ordem_servico (numero_os);

comment on index ordem_servico_numero_os_idx is
  'NAO e unico de proposito: a mesma O.S. reaparece em outro atendimento '
  'quando o contrato e reagendado (D-041). Unicidade real e (visita_id, sequencia).';

-- ┌─ D-042 · SÃO DOIS CÓDIGOS DE BAIXA, E ELES DIVERGEM ─────────────┐
-- │ O relatório traz as duas colunas lado a lado:                    │
-- │   `Cod. Baixa Operadora` (TOA)  e  `Código De Baixa` (ngestor)   │
-- │                                                                  │
-- │ 13.021 linhas têm as duas. E divergem com frequência:            │
-- │   TOA  -1 → 800 Desatribuido        (549)                        │
-- │   TOA 425 → 409 Instalacao Efetuada  (83)                        │
-- │   TOA 312 → 106 Cliente Ausente      (93)                        │
-- │                                                                  │
-- │ Não é erro dos dois lados: a operadora fecha de um jeito e a     │
-- │ credenciada classifica de outro. Guardar só um perde metade da   │
-- │ história — e é a nossa que manda no comissionamento.             │
-- │                                                                  │
-- │ `codigo_baixa_id` continua sendo o da OPERADORA (é o que o       │
-- │ importador preenche há 25 migrations; renomear agora mexeria em  │
-- │ importador, view e quatro telas de uma vez). A nossa entra em    │
-- │ `codigo_baixa_afline_id`, ao lado da sub-falha.                  │
-- └──────────────────────────────────────────────────────────────────┘

alter table ordem_servico
  add column if not exists codigo_baixa_afline_id uuid references codigo_baixa(id),
  add column if not exists sub_falha_id           uuid references sub_falha(id),
  add column if not exists baixa_em               timestamptz,
  add column if not exists baixa_por              uuid references perfil(id),
  add column if not exists baixa_observacao       text;

comment on column ordem_servico.codigo_baixa_id is
  'Codigo de baixa da OPERADORA (TOA). Vem da importacao, nao se edita a mao.';
comment on column ordem_servico.codigo_baixa_afline_id is
  'Codigo de baixa da AFLINE, dado na baixa pelo campo ou pelo COP (D-042).';
comment on column ordem_servico.sub_falha_id is
  'Detalha o PORQUE do codigo de baixa da AFLINE. Conjunto vigente em empresa.conjunto_sub_falha.';

create index if not exists ordem_servico_baixa_afline_ix
  on ordem_servico (codigo_baixa_afline_id) where codigo_baixa_afline_id is not null;

-- ┌─ D-043 · EXCLUIR CONTRATO É ARQUIVAR, NÃO APAGAR ────────────────┐
-- │ Contrato excluído sai das listas e dos relatórios, mas continua  │
-- │ no banco com quem excluiu, quando e por quê.                     │
-- │                                                                  │
-- │ Apagar de verdade levaria junto: as O.S., o histórico, os        │
-- │ marcadores, a linha da importação que o originou e — quando a    │
-- │ pontuação existir — a base de um mês já faturado. E a visita     │
-- │ voltaria na próxima importação do TOA, sem histórico.            │
-- │                                                                  │
-- │ Com o carimbo, a reimportação do TOA reencontra a visita e ela   │
-- │ pode ser restaurada com um clique.                               │
-- └──────────────────────────────────────────────────────────────────┘

alter table visita
  add column if not exists excluido_em     timestamptz,
  add column if not exists excluido_por    uuid references perfil(id),
  add column if not exists motivo_exclusao text;

create index if not exists visita_nao_excluida_ix
  on visita (base_id, data_agendada) where excluido_em is null;

create or replace function excluir_visita(p_visita uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_ja timestamptz;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao para excluir contrato.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da exclusao.' using errcode = '23514';
  end if;

  select excluido_em into v_ja from visita where id = p_visita;
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;
  if v_ja is not null then
    return jsonb_build_object('ja_estava_excluido', true);
  end if;

  update visita
     set excluido_em = now(), excluido_por = auth.uid(), motivo_exclusao = btrim(p_motivo)
   where id = p_visita;

  insert into visita_evento (visita_id, tipo, para, origem, usuario_id)
  values (p_visita, 'EXCLUIDA',
          jsonb_build_object('motivo', btrim(p_motivo)), 'TELA', auth.uid());

  return jsonb_build_object('excluido', true, 'em', now());
end;
$fn$;

create or replace function restaurar_visita(p_visita uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;

  update visita set excluido_em = null, excluido_por = null, motivo_exclusao = null
   where id = p_visita;

  insert into visita_evento (visita_id, tipo, para, origem, usuario_id)
  values (p_visita, 'RESTAURADA', '{}'::jsonb, 'TELA', auth.uid());

  return jsonb_build_object('restaurado', true);
end;
$fn$;

-- ---------- baixa da AFLINE, com sub-falha ----------
-- Uma função só, porque baixa é ato: grava código, sub-falha, observação,
-- autor e hora de uma vez, e registra no histórico. Deixar a tela fazer
-- cinco updates soltos é como se perde a autoria de uma avaliação.
create or replace function baixar_os(
  p_os          uuid,
  p_codigo      integer,
  p_sub_falha   uuid   default null,
  p_observacao  text   default null,
  p_situacao    text   default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_visita uuid; v_cod uuid; v_conj text;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para baixar.' using errcode = '42501';
  end if;

  select o.visita_id into v_visita from ordem_servico o where o.id = p_os;
  if v_visita is null then
    raise exception 'O.S. nao encontrada.' using errcode = 'P0002';
  end if;

  select id into v_cod from codigo_baixa where codigo = p_codigo;
  if v_cod is null then
    raise exception 'Codigo de baixa % nao existe.', p_codigo using errcode = '23503';
  end if;

  -- A sub-falha tem que pertencer ao codigo e ao conjunto vigente.
  if p_sub_falha is not null then
    select conjunto_sub_falha into v_conj from empresa limit 1;
    if not exists (select 1 from sub_falha s
                    where s.id = p_sub_falha and s.codigo = p_codigo
                      and (v_conj is null or s.conjunto = v_conj)) then
      raise exception 'Sub-falha nao pertence ao codigo % no conjunto vigente.', p_codigo
        using errcode = '23514';
    end if;
  end if;

  update ordem_servico
     set codigo_baixa_afline_id = v_cod,
         sub_falha_id           = p_sub_falha,
         baixa_observacao       = nullif(btrim(coalesce(p_observacao, '')), ''),
         baixa_em               = now(),
         baixa_por              = auth.uid()
   where id = p_os;

  if p_situacao is not null then
    update visita set situacao = p_situacao, situacao_em = now() where id = v_visita;
  end if;

  insert into visita_evento
    (visita_id, os_id, tipo, para, origem, usuario_id, codigo_baixa_id, sub_falha_id, observacao)
  values (v_visita, p_os, 'BAIXA',
          jsonb_build_object('codigo', p_codigo, 'situacao', p_situacao),
          'TELA', auth.uid(), v_cod, p_sub_falha,
          nullif(btrim(coalesce(p_observacao, '')), ''));

  return jsonb_build_object('ok', true, 'os', p_os, 'codigo', p_codigo);
end;
$fn$;

revoke all on function excluir_visita(uuid, text)                    from public, anon;
revoke all on function restaurar_visita(uuid)                        from public, anon;
revoke all on function baixar_os(uuid, integer, uuid, text, text)    from public, anon;
grant execute on function excluir_visita(uuid, text)                 to authenticated;
grant execute on function restaurar_visita(uuid)                     to authenticated;
grant execute on function baixar_os(uuid, integer, uuid, text, text) to authenticated;

-- `painel_equipes` passa a ignorar contrato excluído (mesmo corpo da 024,
-- com `and vi.excluido_em is null` na CTE `v`). Aplicado como 026b.
