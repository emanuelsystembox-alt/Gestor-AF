-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 193 — Marcador REV D-10 automático                                    │
-- │                                                                      │
-- │ "subir marcador automático de REV D-10, ele considerar uma revisita  │
-- │  30 dias quando for uma VT da VT, ou um Retorno do Retorno, ou grupo │
-- │  de o.s de instalação para retorno (...) o sistema deve desconsiderar│
-- │  quando o contrato estiver em auditar (...) e quando for identificado│
-- │  no toa que o contrato foi cancelado pela central" — Emanuel, 03/11. │
-- │ Perguntado: "VT para VT e Retorno para Retorno, e grupo de           │
-- │ instalação para Retorno" (não "qualquer → VT" do card de Revisita);  │
-- │ "só de hoje em diante" (o histórico do ngestor fica sem).            │
-- │                                                                      │
-- │ A visita anterior é a de `revisita_dos_contratos` (D-245: a concluída│
-- │ mais recente do mesmo contrato) — não se escreve a busca de novo. O  │
-- │ que muda é o PAR de grupos:                                          │
-- │   VISITA TECNICA          ← VISITA TECNICA                           │
-- │   RETORNO DE CREDENCIADA  ← RETORNO DE CREDENCIADA, ADESAO, MIGRACAO │
-- │                             GPON, REINSTALACAO, MUDANCA DE ENDERECO  │
-- │ com a anterior CONCLUÍDA, até 30 dias antes.                         │
-- │                                                                      │
-- │ Fora: o contrato em AUDITAR (800 do sistema, D-191) e o CANCELADO    │
-- │ PELA CENTRAL (situação Cancelada + "cancelado" no TOA). Se cair num  │
-- │ deles depois de marcado, o marcador automático sai.                  │
-- │                                                                      │
-- │ O automático leva observação "Automático: …" — é por ela que o       │
-- │ sistema distingue o que ELE pôs (e pode tirar) do que alguém marcou à│
-- │ mão (a tela grava sem autor nem observação): o manual nunca é tocado.│
-- │ Roda pelo relógio a cada 5 min (como os sinais, 175), sobre os       │
-- │ contratos de hoje e de amanhã.                                       │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.aplicar_rev_d10(p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_de  date := coalesce(p_de, hoje_local());
  v_ate date := coalesce(p_ate, hoje_local() + 1);
  v_ids uuid[];
  n_pos int := 0;
  n_tir int := 0;
begin
  -- só o relógio (sem usuário) ou a gestão chamam
  if auth.uid() is not null and not (select eh_gestao()) then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  -- "só de hoje em diante" (Emanuel, 03/11)
  v_de := greatest(v_de, hoje_local());

  select array_agg(v.id) into v_ids
    from visita v
   where v.data_agendada between v_de and v_ate
     and v.excluido_em is null and v.contrato is not null;
  if v_ids is null then
    return jsonb_build_object('postos', 0, 'tirados', 0);
  end if;

  create temp table if not exists _rev_d10 (visita_id uuid primary key, empresa_id uuid,
                                            marca boolean, obs text) on commit drop;
  truncate _rev_d10;
  insert into _rev_d10
  select v.id, v.empresa_id,
         coalesce(
           r.anterior_situacao = 'CONCLUIDA'
           and r.dias between 0 and 30
           and ((gv.nome = 'VISITA TECNICA' and r.anterior_grupo = 'VISITA TECNICA')
                or (gv.nome = 'RETORNO DE CREDENCIADA'
                    and r.anterior_grupo in ('RETORNO DE CREDENCIADA', 'ADESAO', 'MIGRACAO GPON',
                                             'REINSTALACAO', 'MUDANCA DE ENDERECO')))
           -- Auditar: o 800 do próprio sistema (D-191)
           and v.desatribuido_em is null
           and not exists (select 1 from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                            where o.visita_id = v.id and cb.codigo = 800)
           -- cancelado pela central no TOA
           and not (v.situacao = 'CANCELADA'
                    and norm_txt(coalesce(v.dados_origem ->> 'Status da Atividade', '')) = 'CANCELADO'),
           false),
         'Automático: ' || coalesce(r.anterior_grupo, '?') || ' de '
           || to_char(r.anterior_data, 'DD/MM/YYYY') || ', ' || coalesce(r.dias, 0) || ' dia(s) antes'
           || coalesce(', equipe ' || r.anterior_equipe, '')
    from visita v
    left join tipo_servico gv on gv.id = v.tipo_servico_id
    left join revisita_dos_contratos(v_ids) r on r.visita_id = v.id
   where v.id = any (v_ids);

  insert into visita_marcador (visita_id, indicador_id, observacao)
  select x.visita_id, iq.id, x.obs
    from _rev_d10 x
    join indicador_qualidade iq on iq.empresa_id = x.empresa_id and iq.nome = 'REV D-10' and iq.ativo
   where x.marca
  on conflict (visita_id, indicador_id) do nothing;
  get diagnostics n_pos = row_count;

  -- tira só o que ELE pôs e deixou de valer (Auditar, cancelado pela central…)
  delete from visita_marcador vm
   using _rev_d10 x, indicador_qualidade iq
   where vm.visita_id = x.visita_id and not x.marca
     and iq.id = vm.indicador_id and iq.nome = 'REV D-10'
     and vm.observacao like 'Automático:%';
  get diagnostics n_tir = row_count;

  return jsonb_build_object('postos', n_pos, 'tirados', n_tir);
end;
$function$;

revoke all on function public.aplicar_rev_d10(date, date) from public, anon;
grant execute on function public.aplicar_rev_d10(date, date) to authenticated;

-- o relógio: a cada 5 min, no horário dos sinais (UTC 10–23 = 06–19 em Manaus)
select cron.unschedule('rev-d10') where exists (select 1 from cron.job where jobname = 'rev-d10');
select cron.schedule('rev-d10', '*/5 10-23 * * *', 'select public.aplicar_rev_d10()');

notify pgrst, 'reload schema';
