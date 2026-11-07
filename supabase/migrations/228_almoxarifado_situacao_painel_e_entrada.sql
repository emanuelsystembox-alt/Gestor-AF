-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 228 — Almoxarifado: a SITUAÇÃO da peça, o painel com filtro de tipo e │
-- │ modelo, a ENTRADA de material e o bipe pelo MAC (D-339)              │
-- │                                                                      │
-- │ "acho que podemos copiar a parte de pagar o técnico, devoluções,     │
-- │  entrada de material (...) movimentações, temos que fazer parecido,  │
-- │  o nosso ta muito simples ainda (...) deve ter filtro do tipo de     │
-- │  equipamento e modelo também" — Emanuel, 07/11.                      │
-- │                                                                      │
-- │ SITUAÇÃO: o concorrente mostra a peça numa situação só ("Com Técnico │
-- │ - Inicializado", "Em Estoque - Retirada"…). Aqui ela é CALCULADA na  │
-- │ leitura a partir do que já guardamos — posse + condição (D-160: três │
-- │ eixos, três donos; não se mistura no banco). Peça num romaneio       │
-- │ ABERTO = "Aguardando aceite" (o aceite digital do concorrente).      │
-- │ Condição vazia conta como INICIALIZADO: a entrega não declara        │
-- │ condição, e o padrão do concorrente na saída é "Com Técnico -        │
-- │ Inicializado [Padrão]". Sem posse declarada continua "sem posse" —   │
-- │ é o trabalho que falta (D-152), com o estado do Atlas ao lado.       │
-- │                                                                      │
-- │ ENTRADA: o documento que põe no estoque (posse NO_ALMOXARIFADO) a    │
-- │ peça que está na carga do Atlas sem posse, em trânsito ou devolvida  │
-- │ à CLARO. Diz a condição (sem padrão, como a devolutiva) e carimba    │
-- │ quem recebeu. Peça com o técnico volta pela DEVOLUÇÃO; peça que não  │
-- │ está na carga do Atlas é recusada — a entrada não inventa peça.      │
-- │                                                                      │
-- │ MAC: a planilha do ngestor veio pelo MAC (1.725 de 1.997, 07/11) e o │
-- │ Atlas guarda o MAC no "Endereçável". O bipe procura pelo serial e,   │
-- │ sem achar, pelo endereçável — recusa se casar com mais de uma peça.  │
-- └──────────────────────────────────────────────────────────────────────┘

-- ── o endereçável normalizado (MAC sem separador) ──────────────────────
create or replace function chave_enderecavel(p text) returns text
language sql immutable set search_path = public as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')), '')
$$;
create index if not exists equipamento_enderecavel_ix on equipamento (base_id, chave_enderecavel(enderecavel));

-- ── a situação ─────────────────────────────────────────────────────────
create or replace function situacao_estoque(p_posse text, p_condicao text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_posse is null then 'SEM_POSSE'
    when p_posse = 'NO_ALMOXARIFADO' then
      case p_condicao when 'RETIRADO' then 'ESTOQUE_RETIRADO'
                      when 'COM_DEFEITO' then 'ESTOQUE_DEFEITO'
                      else 'ESTOQUE_INICIALIZADO' end
    when p_posse = 'COM_TECNICO' then
      case p_condicao when 'RETIRADO' then 'TECNICO_RETIRADO'
                      when 'COM_DEFEITO' then 'TECNICO_DEFEITO'
                      else 'TECNICO_INICIALIZADO' end
    when p_posse = 'COM_ASSINANTE' then 'NO_CONTRATO'
    else p_posse end
$$;

create or replace function rotulo_situacao_estoque(p text) returns text
language sql immutable set search_path = public as $$
  select case p
    when 'ESTOQUE_INICIALIZADO' then 'Em estoque · inicializado'
    when 'ESTOQUE_RETIRADO'     then 'Em estoque · retirado'
    when 'ESTOQUE_DEFEITO'      then 'Em estoque · com defeito'
    when 'TECNICO_INICIALIZADO' then 'Com técnico · inicializado'
    when 'TECNICO_RETIRADO'     then 'Com técnico · retirado'
    when 'TECNICO_DEFEITO'      then 'Com técnico · com defeito'
    when 'AGUARDANDO_ACEITE'    then 'Aguardando aceite'
    when 'NO_CONTRATO'          then 'No contrato (assinante)'
    when 'EM_TRANSITO'          then 'Em trânsito'
    when 'DEVOLVIDO_CLARO'      then 'Devolvido à CLARO'
    when 'SEM_POSSE'            then 'Sem posse declarada'
    else p end
$$;

revoke all on function chave_enderecavel(text) from public, anon;
revoke all on function situacao_estoque(text, text) from public, anon;
revoke all on function rotulo_situacao_estoque(text) from public, anon;
grant execute on function chave_enderecavel(text) to authenticated, service_role;
grant execute on function situacao_estoque(text, text) to authenticated, service_role;
grant execute on function rotulo_situacao_estoque(text) to authenticated, service_role;

-- ── a peça com a situação, para a lista (o RLS de equipamento vale: invoker) ─
create or replace view estoque_peca with (security_invoker = true) as
select e.id, e.base_id, e.serial, e.enderecavel, e.tipo, e.modelo,
       e.estado_atlas, e.estado_afline, coalesce(e.estado_afline, e.estado_atlas) as estado,
       e.estado_afline_em, e.estado_afline_motivo,
       e.posse, e.condicao, e.posse_tecnico_id, e.posse_em, e.local_atlas, e.atlas_em,
       case when exists (select 1 from romaneio_item ri join romaneio r on r.id = ri.romaneio_id
                          where ri.equipamento_id = e.id and r.situacao = 'ABERTO')
            then 'AGUARDANDO_ACEITE'
            else situacao_estoque(e.posse, e.condicao) end as situacao,
       (select t.nome from tecnico t where t.id = e.posse_tecnico_id) as tecnico_nome
  from equipamento e;

revoke all on estoque_peca from anon;
grant select on estoque_peca to authenticated;

-- ── o painel, com filtro de tipo e modelo ──────────────────────────────
create or replace function estoque_painel(p_tipos text[] default null, p_modelos text[] default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  with ok as (
    select ((select eh_gestor()) or (select tem_permissao('almoxarifado.ver'))) as ok
  ),
  todas as materialized (
    select e.id, coalesce(e.tipo, '(sem tipo)') as tipo, coalesce(e.modelo, '(sem modelo)') as modelo,
           e.posse, e.condicao, coalesce(e.estado_afline, e.estado_atlas, '(sem estado)') as estado
      from equipamento e, ok
     where ok.ok and e.empresa_id = (select minha_empresa()) and e.base_id in (select bases_visiveis())
  ),
  aberto as materialized (
    select distinct ri.equipamento_id as id
      from romaneio_item ri join romaneio r on r.id = ri.romaneio_id
     where r.situacao = 'ABERTO' and ri.equipamento_id is not null
       and r.base_id in (select bases_visiveis())
  ),
  base as materialized (
    select t.*, case when a.id is not null then 'AGUARDANDO_ACEITE'
                     else situacao_estoque(t.posse, t.condicao) end as situacao
      from todas t left join aberto a on a.id = t.id
     where (coalesce(cardinality(p_tipos), 0) = 0 or t.tipo = any(p_tipos))
       and (coalesce(cardinality(p_modelos), 0) = 0 or t.modelo = any(p_modelos))
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'por_situacao', coalesce((select jsonb_agg(jsonb_build_object(
        'situacao', s, 'rotulo', rotulo_situacao_estoque(s), 'qtd', n) order by n desc)
        from (select situacao s, count(*) n from base group by 1) x), '[]'::jsonb),
    'por_estado', coalesce((select jsonb_agg(jsonb_build_object('estado', estado, 'qtd', n) order by n desc)
        from (select estado, count(*) n from base group by 1) x), '[]'::jsonb),
    'sem_posse_por_estado', coalesce((select jsonb_agg(jsonb_build_object('estado', estado, 'qtd', n) order by n desc)
        from (select estado, count(*) n from base where situacao = 'SEM_POSSE' group by 1) x), '[]'::jsonb),
    'por_tipo', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'qtd', n) order by n desc)
        from (select tipo, count(*) n from base group by 1) x), '[]'::jsonb),
    'por_modelo', coalesce((select jsonb_agg(jsonb_build_object('modelo', modelo, 'tipo', tipo, 'qtd', n) order by n desc)
        from (select modelo, tipo, count(*) n from base group by 1, 2 order by 3 desc limit 30) x), '[]'::jsonb),
    -- as opções do filtro: tipo sobre tudo; modelo sobre os tipos escolhidos
    'opcoes_tipo', coalesce((select jsonb_agg(jsonb_build_object('valor', tipo, 'qtd', n) order by tipo)
        from (select tipo, count(*) n from todas group by 1) x), '[]'::jsonb),
    'opcoes_modelo', coalesce((select jsonb_agg(jsonb_build_object('valor', modelo, 'qtd', n) order by modelo)
        from (select modelo, count(*) n from todas
               where coalesce(cardinality(p_tipos), 0) = 0 or tipo = any(p_tipos) group by 1) x), '[]'::jsonb),
    'ultima_importacao', (
      select jsonb_build_object('em', i.criado_em, 'arquivo', i.arquivo, 'linhas', i.linhas,
                                'criados', i.criados, 'atualizados', i.atualizados)
        from estoque_importacao i
       where i.empresa_id = (select minha_empresa()) and i.base_id in (select bases_visiveis())
       order by i.criado_em desc limit 1)
  );
$$;

revoke all on function estoque_painel(text[], text[]) from public, anon;
grant execute on function estoque_painel(text[], text[]) to authenticated, service_role;

-- ── a entrada de material ──────────────────────────────────────────────
create table if not exists estoque_entrada (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id),
  base_id     uuid not null references base(id),
  numero      int not null,
  condicao    text not null check (condicao in ('INICIALIZADO', 'RETIRADO', 'COM_DEFEITO')),
  observacao  text,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references auth.users(id),
  unique (empresa_id, numero)
);
create table if not exists estoque_entrada_item (
  id             uuid primary key default gen_random_uuid(),
  entrada_id     uuid not null references estoque_entrada(id) on delete cascade,
  equipamento_id uuid not null references equipamento(id),
  serial         text not null,
  posse_antes    text,
  condicao_antes text,
  criado_em      timestamptz not null default now(),
  unique (entrada_id, equipamento_id)
);
create index if not exists estoque_entrada_item_equip_ix on estoque_entrada_item (equipamento_id);

alter table estoque_entrada enable row level security;
alter table estoque_entrada_item enable row level security;
drop policy if exists estoque_entrada_leitura on estoque_entrada;
create policy estoque_entrada_leitura on estoque_entrada for select to authenticated using (
  empresa_id = (select minha_empresa()) and (select tem_permissao('almoxarifado.ver'))
  and base_id in (select bases_visiveis()));
drop policy if exists estoque_entrada_item_leitura on estoque_entrada_item;
create policy estoque_entrada_item_leitura on estoque_entrada_item for select to authenticated using (
  entrada_id in (select x.id from estoque_entrada x));
revoke all on estoque_entrada, estoque_entrada_item from anon;
grant select on estoque_entrada, estoque_entrada_item to authenticated;

create or replace function registrar_entrada(p_seriais text[], p_condicao text, p_observacao text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := minha_empresa(); v_base uuid := base_ativa_unica();
  v_id uuid; v_num int; v_s text; v_e equipamento%rowtype; v_n int;
  v_ok int := 0; v_rec int := 0; v_linhas jsonb := '[]'; v_vistos text[] := '{}';
  v_cond text := upper(btrim(coalesce(p_condicao, '')));
begin
  perform almox_pode_mexer();
  if v_base is null then
    raise exception 'Escolha a cidade no topo da tela antes da entrada.' using errcode = '23514';
  end if;
  if v_cond not in ('INICIALIZADO', 'RETIRADO', 'COM_DEFEITO') then
    raise exception 'A entrada diz em que condicao as pecas chegam: inicializado, retirado ou com defeito.'
      using errcode = '23514';
  end if;
  if coalesce(array_length(p_seriais, 1), 0) = 0 then
    raise exception 'Nenhum serial.' using errcode = '22023';
  end if;
  if array_length(p_seriais, 1) > 500 then
    raise exception 'No maximo 500 seriais por vez (vieram %).', array_length(p_seriais, 1) using errcode = '22023';
  end if;

  select coalesce(max(numero), 0) + 1 into v_num from estoque_entrada where empresa_id = v_emp;
  insert into estoque_entrada (empresa_id, base_id, numero, condicao, observacao, criado_por)
  values (v_emp, v_base, v_num, v_cond, nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid())
  returning id into v_id;

  foreach v_s in array p_seriais loop
    v_s := upper(regexp_replace(coalesce(v_s, ''), '\s', '', 'g'));
    continue when v_s = '';
    if v_s = any(v_vistos) then
      v_linhas := v_linhas || jsonb_build_object('serial', v_s, 'ok', false, 'erro', 'Repetido na lista.');
      v_rec := v_rec + 1; continue;
    end if;
    v_vistos := v_vistos || v_s;

    select * into v_e from equipamento where empresa_id = v_emp and base_id = v_base and serial = v_s;
    if not found then
      select count(*) into v_n from equipamento where base_id = v_base and chave_enderecavel(enderecavel) = v_s;
      if v_n = 1 then
        select * into v_e from equipamento where base_id = v_base and chave_enderecavel(enderecavel) = v_s;
      end if;
    end if;
    if v_e.id is null then
      v_linhas := v_linhas || jsonb_build_object('serial', v_s, 'ok', false, 'erro',
        case when v_n > 1 then 'O MAC casa com mais de uma peca: bipe o numero de serie.'
             else 'Nao esta na carga do Atlas desta cidade.' end);
      v_rec := v_rec + 1; v_n := 0; continue;
    end if;

    if v_e.posse = 'NO_ALMOXARIFADO' then
      v_linhas := v_linhas || jsonb_build_object('serial', v_e.serial, 'ok', false, 'erro', 'Ja esta no estoque.');
      v_rec := v_rec + 1;
    elsif v_e.posse = 'COM_TECNICO' then
      v_linhas := v_linhas || jsonb_build_object('serial', v_e.serial, 'ok', false,
        'erro', 'Esta com o tecnico ' || coalesce((select nome from tecnico where id = v_e.posse_tecnico_id), '?')
                || ': use a Devolucao.');
      v_rec := v_rec + 1;
    elsif v_e.posse = 'COM_ASSINANTE' then
      v_linhas := v_linhas || jsonb_build_object('serial', v_e.serial, 'ok', false,
        'erro', 'Esta no contrato do assinante: volta pelo tecnico que retirou (Devolucao).');
      v_rec := v_rec + 1;
    elsif exists (select 1 from romaneio_item ri join romaneio r on r.id = ri.romaneio_id
                   where ri.equipamento_id = v_e.id and r.situacao = 'ABERTO') then
      v_linhas := v_linhas || jsonb_build_object('serial', v_e.serial, 'ok', false, 'erro', 'Esta num romaneio aberto.');
      v_rec := v_rec + 1;
    else
      insert into estoque_entrada_item (entrada_id, equipamento_id, serial, posse_antes, condicao_antes)
      values (v_id, v_e.id, v_e.serial, v_e.posse, v_e.condicao);
      update equipamento
         set posse = 'NO_ALMOXARIFADO', posse_tecnico_id = null, condicao = v_cond,
             posse_em = now(), posse_por = auth.uid(),
             posse_motivo = 'entrada ' || v_num || ' (antes: ' || coalesce(v_e.posse, 'sem posse declarada') || ')',
             atualizado_em = now()
       where id = v_e.id;
      v_linhas := v_linhas || jsonb_build_object('serial', v_e.serial, 'ok', true,
        'alerta', case when coalesce(v_e.estado_afline, v_e.estado_atlas) in ('PERDA','SUCATA','INUTILIZADO','COM DEFEITO')
                       then coalesce(v_e.estado_afline, v_e.estado_atlas) end);
      v_ok := v_ok + 1;
    end if;
    v_e := null; v_n := 0;
  end loop;

  if v_ok = 0 then
    delete from estoque_entrada where id = v_id;   -- documento vazio não fica
    v_num := null;
  end if;
  return jsonb_build_object('numero', v_num, 'lancadas', v_ok, 'recusadas', v_rec, 'linhas', v_linhas);
end $$;

revoke all on function registrar_entrada(text[], text, text) from public, anon;
grant execute on function registrar_entrada(text[], text, text) to authenticated, service_role;

-- ── o bipe do romaneio também pelo MAC (versão viva + o MAC) ──────────────
CREATE OR REPLACE FUNCTION public.romaneio_por_serial(p_romaneio uuid, p_serial text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_r romaneio%rowtype; v_e equipamento%rowtype; v_serial text; v_outro int;
  v_efetivo text; v_venc jsonb; v_n int;
begin
  perform almox_pode_mexer();
  select * into v_r from romaneio where id = p_romaneio and empresa_id = minha_empresa() and base_id in (select bases_permitidas());
  if not found then raise exception 'Romaneio nao encontrado.' using errcode='P0002'; end if;
  if v_r.situacao <> 'ABERTO' then
    raise exception 'Romaneio % ja esta %.', v_r.numero, lower(v_r.situacao)
      using errcode = '23514';
  end if;

  v_serial := upper(regexp_replace(coalesce(p_serial,''), '\s', '', 'g'));
  select * into v_e from equipamento
   where empresa_id = v_r.empresa_id and base_id = v_r.base_id and serial = v_serial;
  -- 228 (D-339): sem achar pelo serial, procura pelo MAC (o "Endereçável" do Atlas)
  if not found then
    select count(*) into v_n from equipamento
     where base_id = v_r.base_id and chave_enderecavel(enderecavel) = v_serial;
    if v_n > 1 then
      raise exception 'O MAC % casa com mais de uma peca: bipe o numero de serie.', v_serial using errcode = '23505';
    end if;
    select * into v_e from equipamento
     where base_id = v_r.base_id and chave_enderecavel(enderecavel) = v_serial;
  end if;
  if not found then
    raise exception 'Serial % nao esta na carga. Importe a carga do Atlas ou confira o numero.',
      v_serial using errcode = 'P0002';
  end if;

  select count(*) into v_outro from romaneio_item ri
    join romaneio r on r.id = ri.romaneio_id
   where ri.equipamento_id = v_e.id and r.situacao = 'ABERTO' and r.id <> p_romaneio;
  if v_outro > 0 then
    raise exception 'A peca % ja esta em outro romaneio aberto.', v_serial
      using errcode = '23505';
  end if;

  if v_r.tipo = 'ENTREGA' and v_e.posse is not null
     and v_e.posse <> 'NO_ALMOXARIFADO' then
    raise exception 'A peca % nao esta no almoxarifado (esta como %).',
      v_serial, v_e.posse using errcode = '23514';
  end if;
  if v_r.tipo = 'DEVOLUCAO'
     and (v_e.posse is distinct from 'COM_TECNICO'
          or v_e.posse_tecnico_id is distinct from v_r.tecnico_id) then
    raise exception 'A peca % nao esta com este tecnico.', v_serial
      using errcode = '23514';
  end if;
  if v_r.tipo = 'TRANSFERENCIA'
     and (v_e.posse is distinct from 'COM_TECNICO'
          or v_e.posse_tecnico_id is distinct from v_r.tecnico_origem_id) then
    raise exception 'A peca % nao esta com o tecnico de origem.', v_serial
      using errcode = '23514';
  end if;

  if v_r.tipo in ('ENTREGA', 'TRANSFERENCIA') then
    v_venc := carga_vencida_de(v_r.tecnico_id);
    if (v_venc->>'vencidos')::int > 0 then
      raise exception 'O tecnico nao pode receber: tem % peca(s) na carga ha mais de % dias sem instalar nem devolver.',
        v_venc->>'vencidos', v_venc->>'limite' using errcode = '23514';
    end if;
  end if;

  insert into romaneio_item (romaneio_id, equipamento_id, quantidade, criado_por)
  values (p_romaneio, v_e.id, 1, auth.uid())
  on conflict do nothing;

  v_efetivo := coalesce(v_e.estado_afline, v_e.estado_atlas);
  return jsonb_build_object('serial', v_e.serial, 'tipo', v_e.tipo,
                            'modelo', v_e.modelo, 'estado_atlas', v_e.estado_atlas,
                            'estado_afline', v_e.estado_afline,
                            'condicao', v_e.condicao,
                            'alerta', case when v_efetivo in
                                        ('PERDA','SUCATA','INUTILIZADO','COM DEFEITO')
                                      then v_efetivo end);
end;
$function$;

notify pgrst, 'reload schema';
