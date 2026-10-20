-- ┌─ 117 · a varredura do TOA: nome do cliente, equipamento e miscelânea ─┐
-- │ > "agora eu quero o sistema de sincronismo de equipamentos, e         │
-- │ >  miscelanias que tem no TOA e nome do cliente (...) importar para   │
-- │ >  os contratos conforme o codigo do contrato" — Emanuel, 19/10       │
-- │ > "não quero burla o sistema, so quero trazer os dados que a minha    │
-- │ >  senha ja acessa" — Emanuel, 19/10                                  │
-- │                                                                       │
-- │ A planilha de Atividades não traz nada disso (cliente_nome vazio em   │
-- │ 701 de 701). Os dados estão na tela da atividade no TOA. A extensão   │
-- │ VARRE pelas telas do próprio TOA — bloco no Console de Alocação →     │
-- │ Detalhes (nome) → Equipamento (lista) — e lê o texto da página. Não   │
-- │ copia ficha de segurança nem pede por fora da aplicação (ver          │
-- │ docs/11-EXTENSAO-TOA.md, "caminho FECHADO").                          │
-- │                                                                       │
-- │ Decisões do Emanuel (19/10):                                          │
-- │  · SÓ REGISTRA no contrato — não mexe em saldo nem posse (a regra de  │
-- │    sempre: posse só se move por romaneio ou pelo campo);              │
-- │  · traz Instalado, Desinstalado (retirado), miscelânea (o item sem    │
-- │    serial, com quantidade) e o nome; "Recurso" (carga do técnico) NÃO;│
-- │  · roda no botão "Varrer o TOA agora" ou a cada 30 min / 1 hora.      │
-- │                                                                       │
-- │ O que o TOA diz é afirmação do TOA: cada leitura SUBSTITUI a anterior │
-- │ daquele contrato (não é razão, é retrato). Ver D-192.                 │
-- └───────────────────────────────────────────────────────────────────────┘

create table if not exists visita_equipamento_toa (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresa(id),
  visita_id          uuid not null references visita(id) on delete cascade,
  -- as seções da "Lista de equipamento" do TOA (Recurso fica de fora)
  secao              text not null check (secao in ('CLIENTE', 'INSTALADO', 'DESINSTALADO')),
  toa_item_id        text,
  tipo               text,
  modelo             text,
  serial             text,
  acao               text,
  serial_substituido text,
  ponto              text,
  local_ponto        text,
  quantidade         numeric,
  -- miscelânea = item sem serial (cabo, fonte, conector), com quantidade
  miscelanea         boolean generated always as (nullif(btrim(coalesce(serial, '')), '') is null) stored,
  lido_em            timestamptz not null default now(),
  lido_por           uuid references perfil(id) default auth.uid()
);
create index if not exists visita_equipamento_toa_visita_idx on visita_equipamento_toa (visita_id);
alter table visita_equipamento_toa enable row level security;

-- Vê quem vê o contrato: o RLS de `visita` responde, sem segunda cópia da
-- regra de escopo (o mesmo desenho do bucket de evidência).
drop policy if exists visita_equipamento_toa_leitura on visita_equipamento_toa;
create policy visita_equipamento_toa_leitura on visita_equipamento_toa for select to authenticated
  using (exists (select 1 from visita v where v.id = visita_equipamento_toa.visita_id));

alter table visita
  add column if not exists toa_varrido_em timestamptz;
comment on column visita.toa_varrido_em is
  'Última vez que a varredura leu o equipamento desta atividade na tela do TOA (117, D-192).';

alter table sincronismo
  add column if not exists varredura_intervalo_min smallint check (varredura_intervalo_min in (30, 60)),
  add column if not exists varredura_em   timestamptz,
  add column if not exists varredura_info text;
comment on column sincronismo.varredura_intervalo_min is
  'Varredura sozinha a cada 30 ou 60 min; nulo = só no botão (117).';

-- ─── quem configura: a mesma porta do sincronismo ───────────────────────
create or replace function public.configurar_varredura(p_base uuid, p_intervalo smallint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao para configurar a varredura.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_visiveis()) then
    raise exception 'Esta cidade nao e a cidade ativa da sua tela.' using errcode = '42501';
  end if;
  if p_intervalo is not null and p_intervalo not in (30, 60) then
    raise exception 'Intervalo invalido: 30 ou 60 minutos, ou so no botao.';
  end if;
  insert into sincronismo (base_id, empresa_id)
  select b.id, b.empresa_id from base b where b.id = p_base
  on conflict (base_id) do nothing;
  update sincronismo set varredura_intervalo_min = p_intervalo where base_id = p_base;
end;
$function$;

-- ─── o que falta varrer hoje ────────────────────────────────────────────
-- Nome: uma vez por contrato. Equipamento: quando o TOA encerrou e ainda
-- não foi lido (antes de encerrar a lista está incompleta).
create or replace function public.varredura_pendentes(p_base uuid)
 returns table(aid text, contrato text, precisa_nome boolean, precisa_equipamento boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('ROBO')) then
    raise exception 'Sem permissao para varrer.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_visiveis()) then
    raise exception 'Esta cidade nao e a cidade ativa da sua tela.' using errcode = '42501';
  end if;
  return query
  select v.toa_atividade_id, v.contrato,
         nullif(btrim(coalesce(v.cliente_nome, '')), '') is null,
         coalesce(v.finalizado_toa, false) and v.toa_varrido_em is null
    from visita v
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
   where v.base_id = p_base
     and v.data_agendada = hoje_local()
     and v.excluido_em is null
     and v.toa_atividade_id is not null
     and coalesce(ta.natureza, '') <> 'JORNADA'
     and (nullif(btrim(coalesce(v.cliente_nome, '')), '') is null
          or (coalesce(v.finalizado_toa, false) and v.toa_varrido_em is null))
   order by v.fim nulls last, v.janela_inicio nulls last;
end;
$function$;

-- ─── grava o que a varredura leu de UMA atividade ───────────────────────
create or replace function public.registrar_varredura(
  p_base uuid, p_aid text, p_nome text, p_leu_equipamento boolean, p_itens jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id uuid; v_emp uuid; n int := 0;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('ROBO')) then
    raise exception 'Sem permissao para varrer.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_visiveis()) then
    raise exception 'Esta cidade nao e a cidade ativa da sua tela.' using errcode = '42501';
  end if;
  -- A atividade do TOA é única por dia (095): o aid de hoje é um contrato.
  select v.id, v.empresa_id into v_id, v_emp from visita v
   where v.base_id = p_base and v.toa_atividade_id = btrim(p_aid)
     and v.data_agendada = hoje_local() and v.excluido_em is null;
  if v_id is null then
    return jsonb_build_object('achou', false);
  end if;

  if nullif(btrim(coalesce(p_nome, '')), '') is not null then
    update visita set cliente_nome = left(btrim(p_nome), 200) where id = v_id;
  end if;

  if coalesce(p_leu_equipamento, false) then
    -- Retrato, não razão: a leitura nova substitui a anterior.
    delete from visita_equipamento_toa where visita_id = v_id;
    insert into visita_equipamento_toa (empresa_id, visita_id, secao, toa_item_id, tipo, modelo,
           serial, acao, serial_substituido, ponto, local_ponto, quantidade, lido_por)
    select v_emp, v_id, upper(i ->> 'secao'),
           nullif(left(btrim(i ->> 'toa_item_id'), 40), ''), nullif(left(btrim(i ->> 'tipo'), 80), ''),
           nullif(left(btrim(i ->> 'modelo'), 160), ''), nullif(left(btrim(i ->> 'serial'), 60), ''),
           nullif(left(btrim(i ->> 'acao'), 20), ''), nullif(left(btrim(i ->> 'serial_substituido'), 60), ''),
           nullif(left(btrim(i ->> 'ponto'), 40), ''), nullif(left(btrim(i ->> 'local_ponto'), 80), ''),
           case when btrim(coalesce(i ->> 'quantidade', '')) ~ '^[0-9]+([.,][0-9]+)?$'
                then replace(btrim(i ->> 'quantidade'), ',', '.')::numeric end,
           auth.uid()
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) i
     where upper(i ->> 'secao') in ('CLIENTE', 'INSTALADO', 'DESINSTALADO');
    get diagnostics n = row_count;
    update visita set toa_varrido_em = now() where id = v_id;
  end if;

  return jsonb_build_object('achou', true, 'itens', n);
end;
$function$;

-- ─── estado e fim de uma varredura (o PC que sincroniza) ────────────────
create or replace function public.varredura_estado(p_base uuid, p_terminou text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s sincronismo;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('ROBO')) then
    raise exception 'Sem permissao para varrer.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_visiveis()) then
    raise exception 'Esta cidade nao e a cidade ativa da sua tela.' using errcode = '42501';
  end if;
  if p_terminou is not null then
    update sincronismo set varredura_em = now(), varredura_info = left(p_terminou, 300)
     where base_id = p_base;
  end if;
  select * into s from sincronismo where base_id = p_base;
  return jsonb_build_object(
    'intervalo_min', s.varredura_intervalo_min,
    'ultima', s.varredura_em, 'info', s.varredura_info,
    -- vencida: tem intervalo e a última foi há um intervalo ou mais
    'vencida', s.varredura_intervalo_min is not null
               and (s.varredura_em is null
                    or now() - s.varredura_em >= make_interval(mins => s.varredura_intervalo_min)));
end;
$function$;

revoke all on function public.configurar_varredura(uuid, smallint) from public, anon;
revoke all on function public.varredura_pendentes(uuid) from public, anon;
revoke all on function public.registrar_varredura(uuid, text, text, boolean, jsonb) from public, anon;
revoke all on function public.varredura_estado(uuid, text) from public, anon;
grant execute on function public.configurar_varredura(uuid, smallint) to authenticated;
grant execute on function public.varredura_pendentes(uuid) to authenticated;
grant execute on function public.registrar_varredura(uuid, text, text, boolean, jsonb) to authenticated;
grant execute on function public.varredura_estado(uuid, text) to authenticated;

notify pgrst, 'reload schema';
