-- ┌─ 127 · quem enviou a foto ou o vídeo errado pode apagar de verdade ──┐
-- │ > "se ele enviou um vídeo errado também precisa dar a chance para  │
-- │ >  ele apagar o vídeo ou a foto do contrato" · "Quero que o técnico│
-- │ >  apague de verdade a foto ou vídeo errado, sem guardar o arquivo"│
-- │ >  — Emanuel, 24/10                                                 │
-- │                                                                    │
-- │ MUDA A REGRA DA 055 ("evidência é prova: não se apaga; a saída     │
-- │ certa seria ocultar com motivo"). Ocultar foi oferecido e RECUSADO │
-- │ pelo Emanuel: o arquivo sai do bucket, a linha sai da tabela.      │
-- │                                                                    │
-- │ O que continua de pé:                                              │
-- │  · só QUEM ENVIOU apaga (evidencia.usuario_id = auth.uid());       │
-- │  · o campo só no contrato DE HOJE (trava 3 da 055, a mesma do      │
-- │    anexo); quem é controlador apaga o que ele mesmo enviou;        │
-- │  · o HISTÓRICO do contrato guarda que houve uma foto/vídeo apagado,│
-- │    por quem e quando — sem o arquivo nem o caminho. Sumir sem      │
-- │    rastro nenhum deixaria a auditoria sem saber que existiu.       │
-- │                                                                    │
-- │ Por que em DOIS passos (Storage e depois RPC): o Supabase proíbe   │
-- │ apagar `storage.objects` pelo SQL (gatilho protect_delete) — o     │
-- │ arquivo só sai pela API do Storage, que obedece a policy. Ordem:   │
-- │  1. o app apaga o ARQUIVO (policy `evidencia_arquivo_apagar`);     │
-- │  2. o app chama `apagar_evidencia`, que RECUSA enquanto o arquivo  │
-- │     existir — então nunca sobra arquivo sem linha guardado.        │
-- │ Se a rede cair entre os dois, a linha fica e o botão continua lá:  │
-- │ tocar de novo termina (apagar arquivo que já saiu não dá erro).    │
-- │                                                                    │
-- │ A função da policy NUNCA lança (traps: policy que estoura vira     │
-- │ negação em cima de tudo, D-116) — devolve falso.                   │
-- └────────────────────────────────────────────────────────────────────┘

create or replace function public.pode_apagar_evidencia_arquivo(p_path text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_ok boolean;
begin
  select true into v_ok
    from evidencia ev
    join visita v on v.id = ev.visita_id
   where ev.arquivo_path = p_path
     and ev.usuario_id = auth.uid()
     and v.excluido_em is null
     and v.empresa_id = minha_empresa()
     and (v.data_agendada = hoje_local()
          or eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'))
   limit 1;
  return coalesce(v_ok, false);
exception when others then
  return false;
end;
$function$;

revoke all on function public.pode_apagar_evidencia_arquivo(text) from public, anon;
grant execute on function public.pode_apagar_evidencia_arquivo(text) to authenticated, service_role;

drop policy if exists evidencia_arquivo_apagar on storage.objects;
create policy evidencia_arquivo_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'evidencia' and public.pode_apagar_evidencia_arquivo(name));

create or replace function public.apagar_evidencia(p_evidencia uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare ev evidencia%rowtype; v_tecnico uuid; v_login text; v_campo boolean;
begin
  select * into ev from evidencia where id = p_evidencia;
  if not found then
    raise exception 'Esta foto ou video ja nao existe.' using errcode = 'P0002';
  end if;

  -- As travas do anexo: contrato visível, da equipe e, para o campo, de hoje.
  perform pode_anexar_na_visita(ev.visita_id);

  if ev.usuario_id is distinct from auth.uid() then
    raise exception 'Voce so apaga a foto ou o video que voce enviou.' using errcode = '42501';
  end if;

  -- O arquivo tem de ter saído ANTES (passo 1, pela API do Storage).
  if exists (select 1 from storage.objects
              where bucket_id = 'evidencia' and name = ev.arquivo_path) then
    raise exception 'O arquivo ainda esta guardado. Tente apagar de novo.' using errcode = '55000';
  end if;

  v_campo := tem_papel('TECNICO') and not eh_gestor()
             and not (tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'));
  v_tecnico := meu_tecnico_id();
  v_login := coalesce((select matricula from tecnico where id = v_tecnico),
                      (select email from perfil where id = auth.uid()));

  delete from evidencia where id = ev.id;

  -- O rastro de que existiu: tipo e quando, sem caminho nem arquivo.
  insert into visita_evento (visita_id, os_id, tipo, para, origem, usuario_id,
                             login, tecnico_id, observacao)
  values (ev.visita_id, ev.os_id, 'EVIDENCIA_APAGADA',
          jsonb_build_object('midia', ev.midia, 'tipo', ev.tipo,
                             'enviada_em', ev.criado_em),
          case when v_campo then 'MOBILE' else 'WEB' end,
          auth.uid(), v_login, v_tecnico,
          case when ev.midia = 'VIDEO' then 'Video apagado por quem enviou'
               else 'Foto apagada por quem enviou' end);

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.apagar_evidencia(uuid) from public, anon;
grant execute on function public.apagar_evidencia(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ── testar_campo: 2 cenários novos (27 no total) ───────────────────────
-- REPLACE sobre a função viva, depois de "CONTROLADOR anexa em contrato de
-- ONTEM" (âncora conferida: 1 vez). Resultado em 24/10: 27/27; policies 26/26.
do $$
declare d text; d2 text;
  a3 text := $a$    return query select 'CONTROLADOR anexa em contrato de ONTEM'::text,
                        'permitido'::text, ('BARRADO: ' || sqlerrm)::text, false;
  end;
$a$;
  b3 text := $b$
  -- 127: só QUEM ENVIOU apaga a foto/vídeo (o arquivo já saiu pelo Storage;
  -- aqui os caminhos de teste nunca tiveram arquivo).
  begin
    perform registrar_evidencia(v_hoje, v_hoje::text || '/ctrl-hoje.jpg');
    s := (select id::text from evidencia
           where visita_id = v_hoje and arquivo_path = v_hoje::text || '/ctrl-hoje.jpg');
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_tec::text, 'role', 'authenticated')::text, true);
    perform apagar_evidencia(s::uuid);
    return query select 'TECNICO apaga foto que OUTRO enviou'::text, 'barrado'::text,
                        '*** PASSOU ***'::text, false;
  exception when others then
    return query select 'TECNICO apaga foto que OUTRO enviou'::text, 'barrado'::text,
                        (case when sqlerrm like '%so apaga%' then 'barrado' else 'ERRO: ' || sqlerrm end)::text,
                        sqlerrm like '%so apaga%';
  end;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tec::text, 'role', 'authenticated')::text, true);
  begin
    perform apagar_evidencia((select id from evidencia
                               where visita_id = v_hoje and arquivo_path = v_hoje::text || '/teste.jpg'));
    select count(*) into n from evidencia
     where visita_id = v_hoje and arquivo_path = v_hoje::text || '/teste.jpg';
    s := (select count(*)::text from visita_evento
           where visita_id = v_hoje and tipo = 'EVIDENCIA_APAGADA');
    return query select 'TECNICO apaga a foto que ELE enviou (hoje)'::text, 'apagada, 1 no historico'::text,
                        (case when n = 0 and s = '1' then 'apagada, 1 no historico'
                              else n || ' linha(s), ' || s || ' evento(s)' end)::text,
                        n = 0 and s = '1';
  exception when others then
    return query select 'TECNICO apaga a foto que ELE enviou (hoje)'::text, 'apagada, 1 no historico'::text,
                        ('BARRADO: ' || sqlerrm)::text, false;
  end;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ctrl::text, 'role', 'authenticated')::text, true);
$b$;
begin
  d := pg_get_functiondef('testar_campo'::regproc);
  if position(b3 in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1 then
    raise exception 'ancora 3 aparece % vezes', (length(d) - length(replace(d, a3, ''))) / length(a3);
  end if;
  d2 := replace(d, a3, a3 || b3);
  d2 := replace(d2, $f$'editar_equipamento','material_do_toa']$f$,
                    $g$'editar_equipamento','material_do_toa',
      'apagar_evidencia','pode_apagar_evidencia_arquivo']$g$);
  execute d2;
end $$;
