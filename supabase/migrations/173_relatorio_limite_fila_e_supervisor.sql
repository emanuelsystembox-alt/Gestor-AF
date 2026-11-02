-- ┌─ 173 · Relatórios: 3 meses, fila dos grandes e o supervisor oficial (D-260) ┐
-- │ > "vamos limitar o usuário até 3 meses (...) nem ADM pode puxar acima      │
-- │ >  disso, somente o login admin@afline.com.br (...) quando fizerem uma     │
-- │ >  solicitação de 3 meses (...) fila de processamento em massa, enquanto   │
-- │ >  os outros fazem download do próprio dia sem ter muito impacto"         │
-- │ > "o campo supervisor que deve ser lido é quando abre o nome do supervisor │
-- │ >  e cadastra as equipes, lá que é o filtro do supervisor oficial"        │
-- │ >  — Emanuel, 02/11                                                        │
-- │                                                                             │
-- │ A. Período de no máximo 3 meses (de + 3 meses >= até), para TODOS — o      │
-- │    ADMIN inclusive. Única exceção: o login admin@afline.com.br.            │
-- │ B. Pedido GRANDE (mais de 31 dias, ou mais de 5.000 contratos contados    │
-- │    antes) entra numa FILA: um grande por vez na empresa; os outros esperam │
-- │    a vez, vendo a posição. Pedido pequeno (o dia, a semana) não entra na   │
-- │    fila. Quem espera manda sinal a cada poucos segundos                    │
-- │    (`vez_do_download`); grande sem sinal há 90 s largou a vez (fechou a    │
-- │    tela) e sai da conta — a fila nunca trava.                              │
-- │ C. Supervisor na miscelânea pela precedência da D-134: o que alguém        │
-- │    DECLAROU no técnico (a tela do supervisor) → o login ligado à equipe →  │
-- │    o texto da planilha. São Luís tem 13 de 14 técnicos com supervisor      │
-- │    declarado e 0 equipes com o texto; Manaus, o contrário — e o relatório │
-- │    só lia o texto.                                                          │
-- └─────────────────────────────────────────────────────────────────────────────┘

-- ─── B. a tabela ganha a fila ───────────────────────────────────────────
alter table public.relatorio_download add column if not exists pesado boolean not null default false;
alter table public.relatorio_download add column if not exists visto_em timestamptz not null default now();
alter table public.relatorio_download drop constraint if exists relatorio_download_status_check;
alter table public.relatorio_download add constraint relatorio_download_status_check
  check (status in ('NA_FILA', 'GERANDO', 'CONCLUIDO', 'ERRO', 'CANCELADO'));

-- ─── A + B. iniciar: confere o período e decide se vai para a fila ───────
drop function if exists public.iniciar_download_relatorio(text, text, date, date, uuid[], jsonb, text);
create or replace function public.iniciar_download_relatorio(
  p_tipo text, p_formato text, p_de date, p_ate date, p_cidades uuid[],
  p_filtros jsonb default null, p_arquivo text default null, p_contratos integer default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid; v_tipo text := upper(btrim(coalesce(p_tipo, ''))); v_nomes text;
  v_pesado boolean; v_status text;
  -- a única exceção ao limite de 3 meses (Emanuel, 02/11)
  v_livre boolean := exists (select 1 from perfil where id = auth.uid()
                                                      and lower(email) = 'admin@afline.com.br');
begin
  if not tem_permissao('relatorios.ver') then
    raise exception 'Seu perfil nao inclui Relatorios.' using errcode = '42501';
  end if;
  if v_tipo = 'HUMOR' and not tem_permissao('campo.humor') then
    raise exception 'O humor das equipes exige a permissao do Humor.' using errcode = '42501';
  end if;
  if p_cidades is null or cardinality(p_cidades) = 0 then
    raise exception 'Escolha ao menos uma cidade.';
  end if;
  if exists (select 1 from unnest(p_cidades) c where c not in (select bases_permitidas())) then
    raise exception 'Uma das cidades esta fora do seu acesso.' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_de > p_ate then
    raise exception 'Periodo invalido.';
  end if;
  if not v_livre and p_ate > (p_de + interval '3 months')::date then
    raise exception 'O periodo maximo e de 3 meses.' using errcode = '23514';
  end if;

  v_pesado := (p_ate - p_de) > 31 or coalesce(p_contratos, 0) > 5000;
  v_status := case when v_pesado then 'NA_FILA' else 'GERANDO' end;

  select string_agg(b.nome, ', ' order by b.nome) into v_nomes from base b where b.id = any(p_cidades);
  insert into relatorio_download (empresa_id, usuario_id, tipo, formato, de, ate, cidades,
                                  cidades_nomes, filtros, arquivo, pesado, status)
  values ((select minha_empresa()), auth.uid(), v_tipo, upper(btrim(coalesce(p_formato, ''))),
          p_de, p_ate, p_cidades, v_nomes, p_filtros, left(p_arquivo, 200), v_pesado, v_status)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', v_status, 'pesado', v_pesado);
end;
$function$;

-- ─── B. a vez: um grande por vez na empresa ─────────────────────────────
create or replace function public.vez_do_download(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_emp uuid := (select minha_empresa()); r relatorio_download; v_pos integer;
begin
  -- o sinal de vida de quem espera (ou gera)
  update relatorio_download set visto_em = now()
   where id = p_id and usuario_id = auth.uid() and status in ('NA_FILA', 'GERANDO')
  returning * into r;
  if r.id is null then
    return jsonb_build_object('vez', false, 'status', 'FIM');
  end if;
  if not r.pesado then
    return jsonb_build_object('vez', true, 'status', r.status, 'posicao', 0);
  end if;

  -- grande sem sinal há 90 s largou a vez: sai da fila, com o motivo
  update relatorio_download
     set status = 'CANCELADO', concluido_em = now(),
         mensagem = 'Largado: a tela foi fechada antes de terminar.'
   where empresa_id = v_emp and pesado and status in ('NA_FILA', 'GERANDO')
     and visto_em < now() - interval '90 seconds';

  select x.pos into v_pos from (
    select d.id, row_number() over (order by d.iniciado_em, d.id) as pos
      from relatorio_download d
     where d.empresa_id = v_emp and d.pesado and d.status in ('NA_FILA', 'GERANDO')
  ) x where x.id = p_id;

  if v_pos = 1 and r.status = 'NA_FILA' then
    update relatorio_download set status = 'GERANDO' where id = p_id;
    r.status := 'GERANDO';
  end if;
  return jsonb_build_object('vez', v_pos = 1, 'status', r.status, 'posicao', v_pos);
end;
$function$;

-- concluir aceita também quem desistiu ainda na fila
create or replace function public.concluir_download_relatorio(
  p_id uuid, p_status text, p_linhas integer default null, p_colunas integer default null,
  p_mensagem text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if upper(coalesce(p_status, '')) not in ('CONCLUIDO', 'ERRO', 'CANCELADO') then
    raise exception 'Status invalido.';
  end if;
  update relatorio_download
     set status = upper(p_status), linhas = p_linhas, colunas = p_colunas,
         mensagem = left(p_mensagem, 500), concluido_em = now()
   where id = p_id and usuario_id = auth.uid() and status in ('NA_FILA', 'GERANDO');
end;
$function$;

revoke all on function public.iniciar_download_relatorio(text, text, date, date, uuid[], jsonb, text, integer) from public, anon;
revoke all on function public.vez_do_download(uuid) from public, anon;
grant execute on function public.iniciar_download_relatorio(text, text, date, date, uuid[], jsonb, text, integer) to authenticated;
grant execute on function public.vez_do_download(uuid) to authenticated;

-- ─── C. o supervisor oficial na miscelânea ──────────────────────────────
create or replace function public.relatorio_miscelanea(p_de date, p_ate date)
 returns table(visita_id uuid, data_agendada date, cidade text, equipe text, equipe_nome text, supervisor text, tecnico text, matricula text, wo text, contrato text, atividade_toa text, grupo_servico text, situacao text, fonte text, movimento text, tecnologia text, codigo text, item text, unidade text, quantidade numeric, em timestamp with time zone, por text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with vis as materialized (
    select v.* from visita v
     where v.empresa_id = (select minha_empresa())
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_legiveis()))
       and v.excluido_em is null
       and v.data_agendada between p_de and p_ate
  ),
  itens as (
    -- O que o TOA mostra. O código SAP é o começo do nome
    -- ("22062579_FONTE…" → 22062579), como no material_do_toa (125).
    select t.id, t.visita_id, 'TOA'::text as fonte,
           case t.secao when 'DESINSTALADO' then 'RETIRADO' else 'INSTALADO' end as movimento,
           t.tipo as tecnologia,
           coalesce(i.codigo, nullif(split_part(t.modelo, '_', 1), t.modelo)) as codigo,
           coalesce(i.nome, t.modelo) as item, i.unidade,
           t.quantidade, t.lido_em as em, null::text as por
      from visita_equipamento_toa t
      join vis on vis.id = t.visita_id
      left join item_miscelanea i
             on i.empresa_id = t.empresa_id and i.codigo = split_part(t.modelo, '_', 1)
     where t.miscelanea
    union all
    -- O que o técnico baixou pelo aplicativo. CONSUMO sai negativo do
    -- saldo dele; no relatório é a quantidade gasta, positiva.
    select m.id, m.visita_id, 'TÉCNICO', 'INSTALADO', null,
           i.codigo, i.nome, i.unidade,
           -m.quantidade, m.criado_em, p.nome
      from miscelanea_movimento m
      join vis on vis.id = m.visita_id
      join item_miscelanea i on i.id = m.item_id
      left join perfil p on p.id = m.criado_por
     where m.tipo = 'CONSUMO'
  )
  select v.id, v.data_agendada, b.nome,
         e.codigo, e.nome,
         -- 173 (D-260): a precedência da D-134
         coalesce(ps.nome, pe.nome, e.supervisor_nome),
         tc.nome, tc.matricula,
         v.wo_numero, v.contrato, ta.nome, ts.nome, v.situacao,
         x.fonte, x.movimento, x.tecnologia,
         x.codigo, x.item, x.unidade, x.quantidade,
         x.em, x.por
    from itens x
    join vis v on v.id = x.visita_id
    left join base b           on b.id = v.base_id
    left join equipe e         on e.id = v.equipe_id
    left join perfil pe        on pe.id = e.supervisor_id
    left join tecnico tc       on tc.id = v.tecnico_responsavel_id
    left join perfil ps        on ps.id = tc.supervisor_id
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
    left join tipo_servico ts  on ts.id = v.tipo_servico_id
   -- Ordem total, para a tela poder paginar sem pular nem repetir linha.
   order by v.data_agendada, e.codigo nulls last, v.contrato nulls last, v.id,
            x.fonte, x.movimento, x.item, x.em, x.id;
$function$;

notify pgrst, 'reload schema';
