-- ┌─ 126 · o técnico corrige o equipamento que lançou ──────────────────┐
-- │ > "uma vez que ele selecionou que não quer adicionar o melhor       │
-- │ >  contato do assinante, ele pode voltar atrás depois (...) a mesma │
-- │ >  coisa para equipamento - ele pode editar também, porém           │
-- │ >  miscelânea uma vez importada do sistema não pode mais editar"    │
-- │ >  — Emanuel, 24/10                                                 │
-- │                                                                    │
-- │ Melhor contato: o banco JÁ aceitava responder de novo             │
-- │ (`informar_contato_cliente` faz upsert); faltava o botão. Nada aqui.│
-- │                                                                    │
-- │ Equipamento: lançar move a POSSE da peça (gatilho da 079: instalou │
-- │ → com o assinante; retirou → com o técnico). Corrigir o serial sem │
-- │ desfazer isso deixaria a peça errada "com o assinante" para sempre.│
-- │ Só que o banco não guardava como a peça estava ANTES — só um texto │
-- │ no posse_motivo. Então:                                            │
-- │  · o movimento passa a guardar a posse anterior (gatilho BEFORE);  │
-- │  · `editar_equipamento` desfaz a posse do serial antigo — só se a  │
-- │    peça ainda está como ESTE lançamento deixou (ninguém mexeu      │
-- │    depois, nem romaneio) e o "antes" foi guardado — e relança.     │
-- │    Se não dá para desfazer, não inventa: diz no histórico.         │
-- │  · tipo/modelo sem trocar serial nem operação: só corrige o texto. │
-- │                                                                    │
-- │ As travas são as do anexo (pode_anexar_na_visita, trava 3 da 055): │
-- │ o campo só no contrato DE HOJE. E o técnico corrige só o que ELE   │
-- │ lançou; controlador corrige qualquer um da equipe que enxerga.     │
-- │ Quem carimba o autor da correção é o servidor (D-061).             │
-- │                                                                    │
-- │ Miscelânea: nada muda — o campo já não edita lançamento de         │
-- │ miscelânea, e o que veio do TOA é leitura (D-192).                 │
-- │                                                                    │
-- │ Medido em 24/10: 1 equipamento_movimento no banco inteiro (teste). │
-- │ O "antes" vale daqui para frente; aquele 1 fica sem, e a correção  │
-- │ dele não mexe na posse (diz isso no histórico).                    │
-- └────────────────────────────────────────────────────────────────────┘

alter table equipamento_movimento
  add column if not exists antes_registrado boolean not null default false,
  add column if not exists posse_antes text,
  add column if not exists posse_tecnico_antes uuid,
  add column if not exists condicao_antes text;

comment on column equipamento_movimento.antes_registrado is
  'O gatilho guardou a posse da peça antes deste lançamento (126). False = lançado antes da 126: a correção não sabe para onde devolver.';

-- ── o "antes", guardado na hora do lançamento ─────────────────────────
create or replace function public.posse_antes_do_movimento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_e equipamento%rowtype;
begin
  new.antes_registrado := true;
  select e.* into v_e from equipamento e
    join visita v on v.id = new.visita_id and v.empresa_id = e.empresa_id
   where e.serial = new.serial;
  if found then
    new.posse_antes := v_e.posse;
    new.posse_tecnico_antes := v_e.posse_tecnico_id;
    new.condicao_antes := v_e.condicao;
  end if;
  return new;
end;
$function$;

revoke all on function public.posse_antes_do_movimento() from public, anon, authenticated;

drop trigger if exists trg_posse_antes on equipamento_movimento;
create trigger trg_posse_antes before insert on equipamento_movimento
  for each row execute function posse_antes_do_movimento();

-- ── a correção ─────────────────────────────────────────────────────────
create or replace function public.editar_equipamento(
  p_movimento uuid, p_operacao text, p_serial text,
  p_tipo text default null, p_modelo text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m equipamento_movimento%rowtype;
  v_serial text; v_tipo text; v_modelo text;
  v_tecnico uuid; v_login text; v_origem text; v_campo boolean;
  v_contrato text; v_e equipamento%rowtype;
  v_posse text; v_novo uuid;
begin
  select * into m from equipamento_movimento where id = p_movimento;
  if not found then
    raise exception 'Lancamento nao encontrado.' using errcode = 'P0002';
  end if;

  -- As travas do anexo: contrato visível, da equipe e, para o campo, de hoje.
  perform pode_anexar_na_visita(m.visita_id);

  v_campo := tem_papel('TECNICO') and not eh_gestor()
             and not (tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'));
  v_tecnico := meu_tecnico_id();
  if v_campo and m.tecnico_id is distinct from v_tecnico then
    raise exception 'Voce so corrige o equipamento que voce lancou.' using errcode = '42501';
  end if;

  if p_operacao not in ('INSTALADO','RETIRADO') then
    raise exception 'Operacao deve ser INSTALADO ou RETIRADO.' using errcode = '23514';
  end if;
  v_serial := upper(regexp_replace(coalesce(p_serial,''), '\s', '', 'g'));
  if length(v_serial) < 4 then
    raise exception 'Serial invalido.' using errcode = '23514';
  end if;
  v_tipo := nullif(btrim(coalesce(p_tipo,'')),'');
  v_modelo := nullif(btrim(coalesce(p_modelo,'')),'');

  v_login := coalesce((select matricula from tecnico where id = v_tecnico),
                      (select email from perfil where id = auth.uid()));
  v_origem := case when v_campo then 'MOBILE' else 'WEB' end;

  -- 1. Só o texto: serial e operação iguais — a posse não muda.
  if v_serial = m.serial and p_operacao = m.operacao then
    update equipamento_movimento set tipo = v_tipo, modelo = v_modelo where id = m.id;
    insert into visita_evento (visita_id, os_id, tipo, para, origem, usuario_id,
                               login, tecnico_id, observacao)
    values (m.visita_id, m.os_id, 'EQUIPAMENTO',
            jsonb_build_object('corrigido', true, 'operacao', m.operacao, 'serial', m.serial,
                               'tipo', v_tipo, 'modelo', v_modelo),
            v_origem, auth.uid(), v_login, v_tecnico,
            'Equipamento corrigido: tipo/modelo');
    return m.id;
  end if;

  if exists (select 1 from equipamento_movimento
              where visita_id = m.visita_id and serial = v_serial
                and operacao = p_operacao and id <> m.id) then
    raise exception 'Este serial ja esta lancado neste contrato.' using errcode = '23505';
  end if;

  -- 2. Desfaz a posse do lançamento errado — só se a peça ainda está como
  --    ESTE lançamento deixou. O gatilho da 079 escreve 'campo: <op> no
  --    contrato <c>' e carimba posse_em = now() na mesma transação.
  select contrato into v_contrato from visita where id = m.visita_id;
  select e.* into v_e from equipamento e
    join visita v on v.id = m.visita_id and v.empresa_id = e.empresa_id
   where e.serial = m.serial;
  if not found then
    v_posse := 'peca fora do cadastro: posse nao mexida';
  elsif not m.antes_registrado then
    v_posse := 'lancamento anterior a 126: posse do serial antigo nao desfeita, conferir';
  elsif v_e.posse_em < m.criado_em
        or v_e.posse_motivo not like 'campo: ' || lower(m.operacao) || ' no contrato '
                                     || coalesce(v_contrato, '?') || '%' then
    v_posse := 'a peca ja mudou depois do lancamento: posse do serial antigo nao desfeita';
  else
    update equipamento
       set posse = m.posse_antes, posse_tecnico_id = m.posse_tecnico_antes,
           condicao = m.condicao_antes, posse_em = now(), posse_por = auth.uid(),
           posse_motivo = 'campo: lancamento corrigido no contrato '
                          || coalesce(v_contrato, '?') || ' (volta ao estado anterior)',
           atualizado_em = now()
     where id = v_e.id;
    v_posse := 'posse do serial antigo desfeita';
  end if;

  -- 3. Relança com o certo: os gatilhos guardam o novo "antes" e movem a posse.
  delete from equipamento_movimento where id = m.id;
  insert into equipamento_movimento (visita_id, os_id, operacao, serial, tipo, modelo,
                                     tecnico_id, usuario_id, login, origem, observacao)
  values (m.visita_id, m.os_id, p_operacao, v_serial, v_tipo, v_modelo,
          v_tecnico, auth.uid(), v_login, v_origem, m.observacao)
  returning id into v_novo;

  insert into visita_evento (visita_id, os_id, tipo, para, origem, usuario_id,
                             login, tecnico_id, observacao)
  values (m.visita_id, m.os_id, 'EQUIPAMENTO',
          jsonb_build_object('corrigido', true,
                             'de', jsonb_build_object('operacao', m.operacao, 'serial', m.serial),
                             'operacao', p_operacao, 'serial', v_serial,
                             'tipo', v_tipo, 'modelo', v_modelo),
          v_origem, auth.uid(), v_login, v_tecnico,
          'Equipamento corrigido: ' || m.serial || ' -> ' || v_serial || ' (' || v_posse || ')');

  return v_novo;
end;
$function$;

revoke all on function public.editar_equipamento(uuid, text, text, text, text) from public, anon;
grant execute on function public.editar_equipamento(uuid, text, text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ── testar_campo: 2 cenários novos (25 no total) ───────────────────────
-- Aplicado como REPLACE sobre a função viva (pg_get_functiondef), para não
-- reescrever 16 KB à mão. Âncoras conferidas: cada uma aparece 1 vez.
--  · depois de "Serial normaliza": TECNICO corrige o serial que lancou
--    (ABC123 -> ABC124);
--  · depois de passar ao controlador: TECNICO corrige equipamento lancado
--    por outro → barrado ("so corrige");
--  · editar_equipamento e material_do_toa entram na conferência do anon.
-- Resultado em 24/10: testar_campo 25/25, testar_policies 26/26.
do $$
declare d text; d2 text;
  a1 text := $a$    return query select 'Serial normaliza (espaco e caixa)'::text, '1'::text,
                        ('BARRADO: ' || sqlerrm)::text, false;
  end;
$a$;
  b1 text := $b$
  -- 126: o técnico corrige o serial que ELE lançou (a posse do errado volta).
  begin
    perform editar_equipamento((select id from equipamento_movimento
                                 where visita_id = v_hoje and serial = 'ABC123'),
                               'INSTALADO', 'abc 124', 'EMTA', 'X1');
    select count(*) into n from equipamento_movimento
     where visita_id = v_hoje and serial in ('ABC123', 'ABC124');
    s := (select string_agg(serial, ',') from equipamento_movimento where visita_id = v_hoje);
    return query select 'TECNICO corrige o serial que lancou'::text, 'ABC124'::text,
                        coalesce(s, '-'), s = 'ABC124';
  exception when others then
    return query select 'TECNICO corrige o serial que lancou'::text, 'ABC124'::text,
                        ('BARRADO: ' || sqlerrm)::text, false;
  end;
$b$;
  a2 text := $c$  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ctrl::text, 'role', 'authenticated')::text, true);
$c$;
  b2 text := $e$
  -- 126: o técnico não corrige o que OUTRO lançou (aqui, o controlador).
  begin
    s := registrar_equipamento(v_hoje, 'RETIRADO', 'CTRL0001')::text;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_tec::text, 'role', 'authenticated')::text, true);
    perform editar_equipamento(s::uuid, 'RETIRADO', 'CTRL0002');
    return query select 'TECNICO corrige equipamento lancado por outro'::text, 'barrado'::text,
                        '*** PASSOU ***'::text, false;
  exception when others then
    return query select 'TECNICO corrige equipamento lancado por outro'::text, 'barrado'::text,
                        (case when sqlerrm like '%so corrige%' then 'barrado' else 'ERRO: ' || sqlerrm end)::text,
                        sqlerrm like '%so corrige%';
  end;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ctrl::text, 'role', 'authenticated')::text, true);
$e$;
begin
  d := pg_get_functiondef('testar_campo'::regproc);
  if position(b1 in d) > 0 then return; end if;   -- já aplicado
  if position(a1 in d) = 0 then raise exception 'ancora 1 nao achada'; end if;
  if (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'ancora 2 aparece % vezes', (length(d) - length(replace(d, a2, ''))) / length(a2);
  end if;
  d2 := replace(d, a1, a1 || b1);
  d2 := replace(d2, a2, a2 || b2);
  d2 := replace(d2, $f$'agenda_do_campo','hoje_local','visita_do_path']$f$,
                    $g$'agenda_do_campo','hoje_local','visita_do_path',
      'editar_equipamento','material_do_toa']$g$);
  if d2 = d then raise exception 'nada mudou'; end if;
  execute d2;
end $$;
