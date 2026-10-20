-- ┌─ 116 · o que sumiu da planilha do TOA é desatribuído (cód. 800) ───┐
-- │ > "se a primeira vez que o contrato foi importado, e depois quando │
-- │ >  importarem de novo e o contrato não apareceu no relatorio, o    │
-- │ >  sistema deve baixar automaticamente o contrato para desatribuido│
-- │ >  cod baixa 800, agora na prixima importação se ele aparecer de   │
-- │ >  novo no relatorio, vamos devolver em entrada para o técnico que │
-- │ >  esta o contrato" — Emanuel, 19/10                               │
-- │ > "so pode desatribuir contratos que tiverem em entrada, em outro  │
-- │ >  status não pode ok" — Emanuel, 19/10                            │
-- │                                                                    │
-- │ Respostas do Emanuel (19/10): só o que o campo não mexeu, e só Na  │
-- │ entrada; ao voltar, vai para quem o TOA mostra AGORA (a importação │
-- │ já roteia pelo login); avisa o técnico; SEM trava de quantidade    │
-- │ ("desatribuir mesmo assim").                                       │
-- │                                                                    │
-- │ Como:                                                              │
-- │  · `desatribuir_ausentes(importação)` — a TERCEIRA chamada da      │
-- │    importação, depois de importar_toa e reconciliar (cada uma com  │
-- │    os seus 8 s, D-181). Serve à importação manual e ao sincronismo.│
-- │  · SUMIU = do mesmo dia de atuação e da mesma cidade, veio do TOA, │
-- │    a ÚLTIMA importação que o viu é do MESMO bucket, e o ID da      │
-- │    Atividade não está em nenhuma linha desta importação (nem nas   │
-- │    que deram erro — linha com erro não é contrato que sumiu).      │
-- │    Jornada não conta. Só ENTRADA e sem `bloqueado_em`.             │
-- │  · Desatribuir = 800 na baixa da AFLINE (a da operadora vem do TOA │
-- │    e não se edita, D-042) em toda O.S. sem baixa AFLINE, situação  │
-- │    CANCELADA, evento + aviso ao técnico. Marca `desatribuido_em`.  │
-- │  · VOLTOU = marcado e de novo numa linha desta importação: tira o  │
-- │    800 que NÓS pusemos e, se continua CANCELADA, volta para        │
-- │    ENTRADA (se o próprio TOA já mandou outra situação pelo código, │
-- │    vale a do TOA).                                                 │
-- │  · Tudo como `app.origem = IMPORTACAO`: mudança feita pelo         │
-- │    importador não trava o contrato como "mexido pelo campo".       │
-- │ Ver D-191.                                                         │
-- └────────────────────────────────────────────────────────────────────┘

alter table visita
  add column if not exists desatribuido_em timestamptz,
  add column if not exists desatribuido_por_importacao uuid references importacao(id);

comment on column visita.desatribuido_em is
  'Sumiu da planilha do TOA e foi desatribuído sozinho (cód. 800). Nulo de novo quando volta (116, D-191).';

-- "A última importação que viu este contrato" — antes, só havia índice
-- por importação.
create index if not exists importacao_linha_visita_idx
  on importacao_linha (visita_id) where visita_id is not null;

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
  r      record;
  c_obs_des constant text := 'Saiu da sua rota no TOA: desatribuído automaticamente (cód. 800).';
  c_obs_dev constant text := 'Voltou para a rota no TOA: de volta Na entrada.';
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

  perform set_config('app.origem', '', true);
  return jsonb_build_object('desatribuidos', n_des, 'devolvidos', n_dev);
end;
$function$;

revoke all on function public.desatribuir_ausentes(uuid) from public, anon;
grant execute on function public.desatribuir_ausentes(uuid) to authenticated;

notify pgrst, 'reload schema';
