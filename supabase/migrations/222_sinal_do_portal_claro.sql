-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 222 — O sinal do contrato, lido do Portal Técnico da Claro (D-330)    │
-- │                                                                      │
-- │ "quero mostrar em cada contrato, se os niveis estão regular ou       │
-- │  irregulares, antes e depois da visita (...) e trazer o status de    │
-- │  pendente, que no caso ele não validou sinal" — Emanuel, 06/11.      │
-- │                                                                      │
-- │ O Portal Gestor da Claro (Timeline de falhas) mede o equipamento do  │
-- │ cliente duas vezes: o DIAGNÓSTICO INICIAL (antes) e a VALIDAÇÃO      │
-- │ (depois). A extensão lê a API dele com o login da Claro aberto no    │
-- │ Chrome — só leitura, nunca o "new-measurement", que dispara medição  │
-- │ nova no cliente — e grava aqui, um registro por contrato.            │
-- │                                                                      │
-- │ A classificação é a DA CLARO (texto e cor que o portal manda). Não   │
-- │ há faixa de dBm nossa: inventar uma seria regra de negócio sem dono. │
-- │                                                                      │
-- │ O cruzamento, conferido em 06/11 (10 de 10 O.S. achadas):            │
-- │   operatorCode|workOrderCode = visita.wo_numero ("00121|232231699")  │
-- │   osNumber                   = ordem_servico.numero_os               │
-- │ A WO é a chave: a mesma O.S. aparece em visitas de dias diferentes   │
-- │ (D-169), e o dia do portal escolhe a visita daquele dia.             │
-- │                                                                      │
-- │ Decisões do Emanuel (06/11): só MOSTRAR (sem aviso, sem trava);      │
-- │ validação irregular pode ser rede, não é ofensa automática; lê junto │
-- │ com a rota; contrato com situação diferente da do portal recebe o    │
-- │ nível assim mesmo.                                                   │
-- │                                                                      │
-- │ LGPD: nome e endereço do assinante que o portal manda NÃO entram —   │
-- │ já vêm do TOA. Só medição, modelo e MAC do equipamento.              │
-- └──────────────────────────────────────────────────────────────────────┘

-- 96 mil visitas e nenhum índice na WO: cada item seria uma varredura.
create index if not exists visita_wo_numero_dia_idx on visita (wo_numero, data_agendada);

create table if not exists sinal_claro (
  visita_id           uuid primary key references visita(id) on delete cascade,
  empresa_id          uuid not null references empresa(id),
  base_id             uuid not null references base(id),
  portal_id           bigint not null,          -- id da O.S. no portal (o /equipment usa este)
  os_numero           text,
  wo_codigo           text,
  dia                 date not null,            -- o dia que o portal foi lido
  -- antes e depois, como o portal escreve: texto + cor (green/red/yellow) + código
  inicial_tipo        smallint,
  inicial_texto       text,
  inicial_cor         text,
  validacao_tipo      smallint,
  validacao_texto     text,
  validacao_cor       text,
  pnm_texto           text,                     -- "D. Inicial PNM": Offline, Sem Falha, Erro na Coleta…
  status_os_texto     text,                     -- a situação da O.S. NO PORTAL (Finalizada, Cancelada…)
  atendimento_tipo    text,                     -- "Rede externa" / "Não" / "-"
  tecnologia          text,                     -- DOCSIS / GPON
  tecnico_login       text,
  status_portal       jsonb,                    -- os passos da O.S. no portal, com a hora
  -- os equipamentos medidos. NULO = ainda não lidos (não é "sem equipamento")
  equipamentos        jsonb,
  equipamentos_lidos_em timestamptz,
  portal_atualizado_em timestamptz,             -- "updatedAt" do portal
  lido_em             timestamptz not null default now(),
  lido_por            uuid references auth.users(id)
);

create index if not exists sinal_claro_base_dia_idx on sinal_claro (base_id, dia);

alter table sinal_claro enable row level security;

-- Vê quem vê o contrato: a mesma forma da evidência, sem segunda cópia da regra.
drop policy if exists sinal_claro_leitura on sinal_claro;
create policy sinal_claro_leitura on sinal_claro for select to authenticated
  using (exists (select 1 from visita v where v.id = sinal_claro.visita_id));
-- Sem policy de escrita: só a RPC abaixo grava.

revoke all on sinal_claro from anon;
grant select on sinal_claro to authenticated;

-- ── a gravação ──────────────────────────────────────────────────────────
-- Recebe a lista do portal de UM dia, como a API devolve (`content`), com
-- `equipamentos` acrescentado pela extensão quando ela leu o /equipment.
-- Item sem `equipamentos` mantém o que já estava gravado.
create or replace function registrar_sinal_claro(p_dia date, p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i jsonb;
  v_vis uuid; v_emp uuid; v_base uuid;
  v_wo text; v_eq jsonb;
  n_ok int := 0; n_sem int := 0; n_eq int := 0;
  sem text[] := '{}';
begin
  -- quem pode rodar a extensão (o mesmo de registrar_varredura)
  if not ((eh_gestao() or tem_papel('ROBO')) and tem_permissao('importacao.executar')) then
    raise exception 'Sem permissao para gravar o sinal do portal.' using errcode = '42501';
  end if;
  if p_dia is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'Dia e lista sao obrigatorios.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_itens) > 200 then
    raise exception 'No maximo 200 itens por chamada.' using errcode = '22023';
  end if;

  for i in select * from jsonb_array_elements(p_itens) loop
    v_vis := null;
    v_wo := case when btrim(coalesce(i->>'workOrderCode', '')) ~ '^\d+$'
                  and btrim(coalesce(i->>'operatorCode', '')) ~ '^\d+$'
                 then lpad(btrim(i->>'operatorCode'), 5, '0') || '|' || btrim(i->>'workOrderCode') end;

    -- 1º a WO no dia; 2º a O.S. no dia. Só nas cidades que a pessoa acessa.
    if v_wo is not null then
      select v.id, v.empresa_id, v.base_id into v_vis, v_emp, v_base
        from visita v
       where v.wo_numero = v_wo and v.data_agendada = p_dia and v.excluido_em is null
         and v.empresa_id = (select minha_empresa())
         and v.base_id in (select bases_permitidas())
       order by v.criado_em desc limit 1;
    end if;
    if v_vis is null and btrim(coalesce(i->>'osNumber', '')) <> '' then
      select v.id, v.empresa_id, v.base_id into v_vis, v_emp, v_base
        from ordem_servico o join visita v on v.id = o.visita_id
       where o.numero_os = btrim(i->>'osNumber') and v.data_agendada = p_dia and v.excluido_em is null
         and v.empresa_id = (select minha_empresa())
         and v.base_id in (select bases_permitidas())
       order by v.criado_em desc limit 1;
    end if;

    if v_vis is null then
      n_sem := n_sem + 1;
      sem := sem || coalesce(nullif(btrim(i->>'osNumber'), ''), v_wo, '?');
      continue;
    end if;

    -- só o que a tela usa, com nome nosso; os canais ficam como o portal manda
    v_eq := null;
    if jsonb_typeof(i->'equipamentos') = 'array' then
      select coalesce(jsonb_agg(jsonb_build_object(
               'etapa',       e->'stage'->>'text',
               'etapa_tipo',  e->'stage'->'type',
               'tipo',        e->'type'->>'text',
               'status',      e->>'status',
               'modelo',      left(e->>'model', 60),
               'mac',         left(e->>'mac', 40),
               'tecnologia',  e->>'technologyType',
               'coletado_em', e->>'collectedDate',
               'upstreams',   coalesce(e->'upstreams', '[]'::jsonb),
               'downstreams', coalesce(e->'downstreams', '[]'::jsonb),
               'ofdm',        coalesce(e->'ofdm', '[]'::jsonb),
               'ofdma',       coalesce(e->'ofdma', '[]'::jsonb))), '[]'::jsonb)
        into v_eq
        from jsonb_array_elements(i->'equipamentos') e;
      n_eq := n_eq + 1;
    end if;

    insert into sinal_claro as s (
      visita_id, empresa_id, base_id, portal_id, os_numero, wo_codigo, dia,
      inicial_tipo, inicial_texto, inicial_cor, validacao_tipo, validacao_texto, validacao_cor,
      pnm_texto, status_os_texto, atendimento_tipo, tecnologia, tecnico_login, status_portal,
      equipamentos, equipamentos_lidos_em, portal_atualizado_em, lido_em, lido_por)
    values (
      v_vis, v_emp, v_base, (i->>'id')::bigint, left(i->>'osNumber', 20), left(i->>'workOrderCode', 20), p_dia,
      case when i->'initialDiagnosis'->>'type' ~ '^\d+$' then (i->'initialDiagnosis'->>'type')::smallint end,
      left(i->'initialDiagnosis'->>'text', 60), left(i->'initialDiagnosis'->>'color', 20),
      case when i->'validationDiagnosis'->>'type' ~ '^\d+$' then (i->'validationDiagnosis'->>'type')::smallint end,
      left(i->'validationDiagnosis'->>'text', 60), left(i->'validationDiagnosis'->>'color', 20),
      left(i->'pnmDiagnosis'->>'text', 60), left(i->'osStatus'->>'text', 40),
      left(i->>'attendingType', 40), left(i->>'technologyType', 20), left(i->>'technicianLogin', 20),
      case when jsonb_typeof(i->'workOrderStatus') = 'array' then i->'workOrderStatus' end,
      v_eq, case when v_eq is not null then now() end,
      case when btrim(coalesce(i->>'updatedAt', '')) <> '' then (i->>'updatedAt')::timestamptz end,
      now(), auth.uid())
    on conflict (visita_id) do update set
      portal_id = excluded.portal_id, os_numero = excluded.os_numero, wo_codigo = excluded.wo_codigo,
      dia = excluded.dia,
      inicial_tipo = excluded.inicial_tipo, inicial_texto = excluded.inicial_texto, inicial_cor = excluded.inicial_cor,
      validacao_tipo = excluded.validacao_tipo, validacao_texto = excluded.validacao_texto,
      validacao_cor = excluded.validacao_cor,
      pnm_texto = excluded.pnm_texto, status_os_texto = excluded.status_os_texto,
      atendimento_tipo = excluded.atendimento_tipo, tecnologia = excluded.tecnologia,
      tecnico_login = excluded.tecnico_login, status_portal = excluded.status_portal,
      equipamentos = coalesce(excluded.equipamentos, s.equipamentos),
      equipamentos_lidos_em = coalesce(excluded.equipamentos_lidos_em, s.equipamentos_lidos_em),
      portal_atualizado_em = excluded.portal_atualizado_em,
      lido_em = now(), lido_por = auth.uid();
    n_ok := n_ok + 1;
  end loop;

  return jsonb_build_object('gravados', n_ok, 'sem_contrato', n_sem, 'equipamentos', n_eq,
                            'sem_contrato_os', to_jsonb(sem));
end;
$$;

revoke all on function registrar_sinal_claro(date, jsonb) from public, anon;
grant execute on function registrar_sinal_claro(date, jsonb) to authenticated;

notify pgrst, 'reload schema';
