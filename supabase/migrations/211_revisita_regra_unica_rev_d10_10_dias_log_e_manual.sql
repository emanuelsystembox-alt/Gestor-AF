-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 211 — Revisita numa regra só, REV D-10 em 10 dias, marcadores LOG 1–6 │
-- │       e o contrato manual com equipe nasce Na entrada (D-313 a D-315) │
-- │                                                                      │
-- │ 1. O VAI-E-VOLTA passa a ser a revisita (D-313):                     │
-- │ "Revisita 30 dias, e Revisita 10 dias, ambas devem olhar Retorno do  │
-- │  Retorno, Visita da Visita, e grupo instalação para Retorno, ou para │
-- │  visita (...) para considerar uma revisita precisa entrar nesse      │
-- │  critério que é o símbolo vai e volta, só pode aparecer esse         │
-- │  critério, e para subir o marcador de REV D-10 tem que entrar na     │
-- │  regra e ser 10 dias" — Emanuel, 05/11. Perguntado se Retorno→VT e   │
-- │  Serviço→VT deixavam de contar: "pode manter esses também como       │
-- │  revisita". Logo a regra é a de `revisita_dos_contratos` (D-245):    │
-- │  anterior CONCLUÍDA, até 30 dias, qualquer → VT; Retorno ← Retorno,  │
-- │  Adesão, Migração GPON, Reinstalação, Mudança de endereço.           │
-- │  O sinal da 174 (VT da VT em QUALQUER situação; a mesma O.S. de      │
-- │  instalação não concluída) sai: era uma segunda regra para a mesma   │
-- │  palavra, e as duas divergiam na tela.                               │
-- │                                                                      │
-- │ 2. REV D-10 = a mesma revisita, com a anterior até 10 dias antes     │
-- │    (era 30 dias e só VT←VT / Retorno←Retorno ou instalação).         │
-- │    Continua fora Auditar e cancelado pela central; tirado à mão não  │
-- │    volta (194).                                                      │
-- │                                                                      │
-- │ 3. Marcadores LOG 1 a LOG 6, manuais (D-314): "Os marcadores devemos │
-- │    subir marcador de: LOG 1 ... LOG 6, caso queiram subir ok."       │
-- │                                                                      │
-- │ 4. Contrato manual (D-315): "esse status atribuído (...) era pra ser │
-- │    somente quando fosse criado manual e o contrato estivesse sem     │
-- │    dono, fora isso, se um contrato Manual fosse criado e passado     │
-- │    para uma equipe (...) tem que estar em entrada mesmo." Era o      │
-- │    contrário: com equipe nascia Atribuída. Os manuais de hoje em     │
-- │    diante que estão Atribuída com equipe voltam Na entrada.          │
-- └──────────────────────────────────────────────────────────────────────┘

-- 1 ─────────────────────────────────────────────────────────────────────
create or replace function public.sinais_das_visitas(p_visitas uuid[])
 returns table(visita_id uuid, edificacao text, revisita boolean, revisita_motivo text,
               anterior_data date, anterior_situacao text, anterior_grupo text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with alvo as materialized (
    select v.id, ts.nome as grupo,
           edificacao_de(v.tipo_residencia, v.complemento, v.logradouro) as ed
      from visita v
      left join tipo_servico ts on ts.id = v.tipo_servico_id
     where v.id = any(p_visitas)
       and v.empresa_id = (select minha_empresa())
       and v.base_id in (select bases_permitidas())
       and v.excluido_em is null
  ),
  ids as materialized (select array_agg(id) as a from alvo),
  -- a regra da revisita mora em revisita_dos_contratos (D-245, D-313)
  rev as materialized (
    select r.* from ids, revisita_dos_contratos(ids.a) r where r.revisita
  )
  select a.id,
         case when a.ed in ('APTO', 'LOJA') then 'PREDIO'
              when a.ed in ('CASA', 'BECO') then 'CASA' end,
         r.visita_id is not null,
         case when r.visita_id is null then null
              when a.grupo = 'VISITA TECNICA' and r.anterior_grupo = 'VISITA TECNICA' then 'VT_DA_VT'
              when a.grupo = 'RETORNO DE CREDENCIADA' and r.anterior_grupo = 'RETORNO DE CREDENCIADA'
                then 'RETORNO_DO_RETORNO'
              else 'DE_OUTRO_GRUPO' end,
         r.anterior_data, r.anterior_situacao, r.anterior_grupo
    from alvo a
    left join rev r on r.visita_id = a.id;
$function$;

revoke all on function public.sinais_das_visitas(uuid[]) from public, anon;
grant execute on function public.sinais_das_visitas(uuid[]) to authenticated;

-- 2 ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aplicar_rev_d10(p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           -- 211 (D-313): a revisita da regra única, com a anterior até 10 dias
           r.revisita
           and r.dias between 0 and 10
           -- Auditar: o 800 do próprio sistema (D-191)
           and v.desatribuido_em is null
           and not exists (select 1 from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                            where o.visita_id = v.id and cb.codigo = 800)
           -- cancelado pela central no TOA
           and not (v.situacao = 'CANCELADA'
                    and (cancelado_pela_central(v.dados_origem ->> 'Status da Atividade',
                                               v.dados_origem ->> 'Motivo de Fechamento Externo') or v.cancelado_central_em is not null)),
           false),
         'Automático: ' || coalesce(r.anterior_grupo, '?') || ' de '
           || to_char(r.anterior_data, 'DD/MM/YYYY') || ', ' || coalesce(r.dias, 0) || ' dia(s) antes'
           || coalesce(', equipe ' || r.anterior_equipe, '')
    from visita v
    left join tipo_servico gv on gv.id = v.tipo_servico_id
    left join revisita_dos_contratos(v_ids) r on r.visita_id = v.id
   where v.id = any (v_ids);

  -- 194: desmarcado à mão neste contrato → não volta (outro dia é outra visita)
  insert into visita_marcador (visita_id, indicador_id, observacao)
  select x.visita_id, iq.id, x.obs
    from _rev_d10 x
    join indicador_qualidade iq on iq.empresa_id = x.empresa_id and iq.nome = 'REV D-10' and iq.ativo
   where x.marca
     and not exists (select 1 from rev_d10_recusado rr where rr.visita_id = x.visita_id)
  on conflict (visita_id, indicador_id) do nothing;
  get diagnostics n_pos = row_count;

  -- tira só o que ELE pôs e deixou de valer — sem contar como recusa (194)
  perform set_config('app.origem', 'REV_D10', true);
  delete from visita_marcador vm
   using _rev_d10 x, indicador_qualidade iq
   where vm.visita_id = x.visita_id and not x.marca
     and iq.id = vm.indicador_id and iq.nome = 'REV D-10'
     and vm.observacao like 'Automático:%';
  get diagnostics n_tir = row_count;
  perform set_config('app.origem', '', true);

  return jsonb_build_object('postos', n_pos, 'tirados', n_tir);
end;
$function$;

revoke all on function public.aplicar_rev_d10(date, date) from public, anon;
grant execute on function public.aplicar_rev_d10(date, date) to authenticated;

-- 3 ─────────────────────────────────────────────────────────────────────
insert into public.indicador_qualidade (empresa_id, nome, meta, peso, ordem, ativo)
select e.id, 'LOG ' || x.n, 100, 1,
       coalesce((select max(ordem) from public.indicador_qualidade where empresa_id = e.id), 0) + x.n, true
  from public.empresa e
 cross join generate_series(1, 6) as x(n)
 where not exists (select 1 from public.indicador_qualidade iq
                    where iq.empresa_id = e.id and iq.nome = 'LOG ' || x.n);

-- 4 ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.criar_visita_manual(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_base uuid; v_visita uuid; v_equipe uuid; v_seq int := 0;
  v_num text; o jsonb; v_nums text[] := '{}';
  v_data date; v_contrato text;
begin
  if not ((select eh_gestor()) or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')) then
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
    -- 211 (D-315): com equipe nasce Na entrada; Atribuída só sem dono
    case when v_equipe is null then 'ATRIBUIDA' else 'ENTRADA' end,
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
$function$;

revoke all on function public.criar_visita_manual(jsonb) from public, anon;
grant execute on function public.criar_visita_manual(jsonb) to authenticated;

-- os manuais de hoje em diante que estão Atribuída com equipe voltam Na entrada
insert into public.visita_evento (visita_id, tipo, de, para, origem, observacao)
select v.id, 'SITUACAO', jsonb_build_object('situacao', 'ATRIBUIDA'),
       jsonb_build_object('situacao', 'ENTRADA'), 'WEB',
       'Contrato manual com equipe fica Na entrada (D-315).'
  from public.visita v
 where v.situacao = 'ATRIBUIDA' and v.origem = 'MANUAL' and v.equipe_id is not null
   and v.data_agendada >= public.hoje_local() and v.excluido_em is null;

update public.visita set situacao = 'ENTRADA', situacao_em = now()
 where situacao = 'ATRIBUIDA' and origem = 'MANUAL' and equipe_id is not null
   and data_agendada >= public.hoje_local() and excluido_em is null;

-- o REV D-10 de hoje e de amanhã já na regra nova (tira o automático que não vale mais)
select public.aplicar_rev_d10();

notify pgrst, 'reload schema';
