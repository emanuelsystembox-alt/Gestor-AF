-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 205 — O supervisor EM CAMPO tem as travas e as chaves do técnico     │
-- │       (D-300)                                                        │
-- │                                                                      │
-- │ "As travas de GPS da baixa não valem para ele (...) habilita por     │
-- │  favor" — Emanuel, 04/11, sobre o Pedro Campos.                      │
-- │                                                                      │
-- │ A 204 dava o papel TECNICO achando que isso bastava: o arquivo da    │
-- │ 055 diz "campo = TECNICO e não gestor". O banco diz outra coisa — as │
-- │ 8 funções das travas tiram também CONTROLADOR e SUPERVISOR (o        │
-- │ controlador que é técnico não perde os poderes, business-rules).     │
-- │ Pego no teste: com a chave ligada, o v_campo continuava falso.       │
-- │ (Mais uma vez a armadilha "o arquivo atrasado em relação ao banco".) │
-- │                                                                      │
-- │ Agora o supervisor sai da exceção SÓ quando está em campo:           │
-- │ `supervisor_esta_em_campo()` = papel TECNICO + o técnico do login    │
-- │ na equipe PRÓPRIA dele (supervisor_id = ele). É o que a chave liga.  │
-- │ Controlador e coordenador continuam fora das travas como antes.      │
-- │ Medido em 04/11: ninguém tinha TECNICO junto com SUPERVISOR,         │
-- │ CONTROLADOR ou COORDENADOR — nada muda para quem não ligar a chave.  │
-- │                                                                      │
-- │ E as CHAVES: o perfil "Supervisor" não tem `servicos.baixar` nem     │
-- │ `servicos.anexar` — ele não baixaria nem pelo app. A chave concede  │
-- │ as duas no login dele (`usuario_permissao`, autor = quem ligou) e    │
-- │ desligar tira. As 8 funções foram regeradas do BANCO               │
-- │ (pg_get_functiondef), trocando só a expressão; o resto é igual.      │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.supervisor_esta_em_campo()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tem_papel('TECNICO') and exists (
    select 1 from tecnico t join equipe e on e.id = t.equipe_id
     where t.usuario_id = auth.uid() and e.supervisor_id = auth.uid());
$function$;
revoke all on function public.supervisor_esta_em_campo() from public, anon;
grant execute on function public.supervisor_esta_em_campo() to authenticated;

-- apagar_evidencia: 1 troca(s)
CREATE OR REPLACE FUNCTION public.apagar_evidencia(p_evidencia uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ev evidencia%rowtype; v_tecnico uuid; v_login text; v_campo boolean;
begin
  select * into ev from evidencia where id = p_evidencia;
  if not found then
    raise exception 'Esta foto ou video ja nao existe.' using errcode = 'P0002';
  end if;

  perform pode_anexar_na_visita(ev.visita_id);

  if ev.usuario_id is distinct from auth.uid() then
    raise exception 'Voce so apaga a foto ou o video que voce enviou.' using errcode = '42501';
  end if;

  if exists (select 1 from storage.objects
              where bucket_id = 'evidencia' and name = ev.arquivo_path) then
    raise exception 'O arquivo ainda esta guardado. Tente apagar de novo.' using errcode = '55000';
  end if;

  v_campo := tem_papel('TECNICO') and not (select eh_gestor())
             and not (tem_papel('CONTROLADOR') or (tem_papel('SUPERVISOR') and not (select supervisor_esta_em_campo())));
  v_tecnico := meu_tecnico_id();
  v_login := coalesce((select matricula from tecnico where id = v_tecnico),
                      (select email from perfil where id = auth.uid()));

  delete from evidencia where id = ev.id;

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

-- baixar_os: 1 troca(s)
CREATE OR REPLACE FUNCTION public.baixar_os(p_os uuid, p_codigo integer, p_sub_falha uuid DEFAULT NULL::uuid, p_observacao text DEFAULT NULL::text, p_situacao text DEFAULT NULL::text, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_precisao numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_visita uuid; v_cod uuid; v_conj text; v_tecnico uuid;
        v_ja uuid; v_campo boolean;
begin
  if not ((select eh_gestor()) or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para baixar.' using errcode = '42501';
  end if;
  if not tem_permissao('servicos.baixar') then
    raise exception 'Seu perfil de acesso nao inclui "Baixar servico".'
      using errcode = '42501';
  end if;

  v_campo := tem_papel('TECNICO') and not (select eh_gestor())
             and not (tem_papel('CONTROLADOR') or (tem_papel('SUPERVISOR') and not (select supervisor_esta_em_campo())));

  select o.visita_id, o.codigo_baixa_afline_id into v_visita, v_ja
    from ordem_servico o where o.id = p_os;
  if v_visita is null then
    raise exception 'O.S. nao encontrada.' using errcode = 'P0002';
  end if;

  if not (select eh_gestor()) and not exists (
       select 1 from visita v where v.id = v_visita
        and v.empresa_id = minha_empresa()
        and v.base_id in (select bases_visiveis())
        and v.equipe_id in (select equipes_legiveis())) then
    raise exception 'Esta O.S. nao e da sua equipe.' using errcode = '42501';
  end if;

  if v_campo then
    if p_lat is null or p_lng is null then
      raise exception 'Ligue a localizacao do celular para dar baixa.'
        using errcode = '42501';
    end if;
    if gps_bloqueado(meu_tecnico_id()) then
      raise exception 'O GPS do celular esta informando uma localizacao simulada. Desative o app de localizacao simulada para continuar.'
        using errcode = '42501';
    end if;
    if v_ja is not null then
      raise exception 'Esta O.S. ja foi baixada. Peca ao controlador para corrigir.'
        using errcode = '42501';
    end if;
  end if;

  select id into v_cod from codigo_baixa where codigo = p_codigo;
  if v_cod is null then
    raise exception 'Codigo de baixa % nao existe.', p_codigo using errcode = '23503';
  end if;

  if p_sub_falha is not null then
    select conjunto_sub_falha into v_conj from empresa limit 1;
    if not exists (select 1 from sub_falha s
                    where s.id = p_sub_falha and s.codigo = p_codigo
                      and (v_conj is null or s.conjunto = v_conj)) then
      raise exception 'Sub-falha nao pertence ao codigo % no conjunto vigente.', p_codigo
        using errcode = '23514';
    end if;
  end if;

  v_tecnico := meu_tecnico_id();

  update ordem_servico
     set codigo_baixa_afline_id = v_cod, sub_falha_id = p_sub_falha,
         baixa_observacao = nullif(btrim(coalesce(p_observacao,'')),''),
         baixa_em = now(), baixa_por = auth.uid()
   where id = p_os;

  if p_situacao is not null then
    update visita set situacao = p_situacao, situacao_em = now() where id = v_visita;
  end if;

  insert into visita_evento
    (visita_id, os_id, tipo, para, origem, usuario_id, login, tecnico_id,
     codigo_baixa_id, sub_falha_id, observacao, lat, lng, precisao_m)
  values (v_visita, p_os, 'BAIXA',
          jsonb_build_object('codigo', p_codigo, 'situacao', p_situacao),
          case when v_campo then 'MOBILE' else 'TELA' end,
          auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico, v_cod, p_sub_falha,
          nullif(btrim(coalesce(p_observacao,'')),''),
          p_lat, p_lng, p_precisao);

  return jsonb_build_object('ok', true, 'os', p_os, 'codigo', p_codigo);
end;
$function$;

-- definir_sub_falha: 1 troca(s)
CREATE OR REPLACE FUNCTION public.definir_sub_falha(p_os uuid, p_sub_falha uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_visita uuid; v_cod_toa int; v_tem_afline boolean; v_antes uuid;
  v_conj text; v_nome_antes text; v_nome text; v_tecnico uuid; v_campo boolean;
begin
  select o.visita_id, cb.codigo, o.codigo_baixa_afline_id is not null, o.sub_falha_id
    into v_visita, v_cod_toa, v_tem_afline, v_antes
    from ordem_servico o
    left join codigo_baixa cb on cb.id = o.codigo_baixa_id
   where o.id = p_os;
  if v_visita is null then
    raise exception 'O.S. nao encontrada.' using errcode = 'P0002';
  end if;
  perform pode_anexar_na_visita(v_visita, false);

  if v_cod_toa is null then
    raise exception 'Esta O.S. ainda nao tem codigo de baixa do TOA.' using errcode = '23514';
  end if;
  if v_tem_afline then
    raise exception 'Esta O.S. foi baixada pela AFLINE: a sub-falha e a da baixa.' using errcode = '23514';
  end if;

  if p_sub_falha is not null then
    select conjunto_sub_falha into v_conj from empresa where id = minha_empresa();
    select s.nome into v_nome from sub_falha s
     where s.id = p_sub_falha and s.codigo = v_cod_toa and s.ativo
       and (v_conj is null or s.conjunto = v_conj);
    if v_nome is null then
      raise exception 'Esta sub-falha nao e do codigo % do TOA.', v_cod_toa using errcode = '23514';
    end if;
  end if;

  if p_sub_falha is not distinct from v_antes then
    return jsonb_build_object('ok', true, 'os', p_os, 'mudou', false);
  end if;
  select nome into v_nome_antes from sub_falha where id = v_antes;

  v_campo := tem_papel('TECNICO') and not (select eh_gestor())
             and not (tem_papel('CONTROLADOR') or (tem_papel('SUPERVISOR') and not (select supervisor_esta_em_campo())));
  v_tecnico := meu_tecnico_id();

  update ordem_servico set sub_falha_id = p_sub_falha where id = p_os;

  insert into visita_evento (visita_id, os_id, tipo, de, para, origem, usuario_id, login,
                             tecnico_id, sub_falha_id, observacao)
  values (v_visita, p_os, 'SUB_FALHA',
          jsonb_build_object('sub_falha', v_nome_antes), jsonb_build_object('sub_falha', v_nome),
          case when v_campo then 'MOBILE' else 'TELA' end, auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico, p_sub_falha, coalesce(v_nome, '(sub-falha apagada)'));

  return jsonb_build_object('ok', true, 'os', p_os, 'mudou', true);
end;
$function$;

-- editar_equipamento: 1 troca(s)
CREATE OR REPLACE FUNCTION public.editar_equipamento(p_movimento uuid, p_operacao text, p_serial text, p_tipo text DEFAULT NULL::text, p_modelo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  perform pode_anexar_na_visita(m.visita_id);

  v_campo := tem_papel('TECNICO') and not (select eh_gestor())
             and not (tem_papel('CONTROLADOR') or (tem_papel('SUPERVISOR') and not (select supervisor_esta_em_campo())));
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

-- informar_contato_cliente: 1 troca(s)
CREATE OR REPLACE FUNCTION public.informar_contato_cliente(p_visita uuid, p_telefone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sit text; v_empresa uuid; v_tel text; v_tecnico uuid; v_campo boolean;
begin
  perform pode_anexar_na_visita(p_visita);

  select situacao, empresa_id into v_sit, v_empresa from visita where id = p_visita;
  if v_sit is distinct from 'CONCLUIDA' then
    raise exception 'O melhor contato so e informado em contrato concluido.'
      using errcode = '23514';
  end if;

  v_tel := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
  if v_tel is not null and v_tel !~ '^[1-9][1-9][0-9]{8,9}$' then
    raise exception 'Telefone invalido: use DDD + numero, como (92) 99999-9999.'
      using errcode = '23514';
  end if;

  v_campo := tem_papel('TECNICO') and not (select eh_gestor())
             and not (tem_papel('CONTROLADOR') or (tem_papel('SUPERVISOR') and not (select supervisor_esta_em_campo())));
  v_tecnico := meu_tecnico_id();

  insert into contato_cliente as c (visita_id, empresa_id, telefone, tecnico_id,
                                    usuario_id, login, origem)
  values (p_visita, v_empresa, v_tel, v_tecnico, auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          case when v_campo then 'MOBILE' else 'WEB' end)
  on conflict (visita_id) do update
     set telefone = excluded.telefone, tecnico_id = excluded.tecnico_id,
         usuario_id = excluded.usuario_id, login = excluded.login,
         origem = excluded.origem, atualizado_em = now();

  insert into visita_evento (visita_id, tipo, para, origem, usuario_id, login,
                             tecnico_id, observacao)
  values (p_visita, 'CONTATO', jsonb_build_object('informou', v_tel is not null),
          case when v_campo then 'MOBILE' else 'WEB' end, auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico,
          case when v_tel is null then 'Melhor contato do cliente: NAO informado'
               else 'Melhor contato do cliente: informado' end);

  return jsonb_build_object('ok', true, 'informou', v_tel is not null);
end;
$function$;

-- observar_baixa: 1 troca(s)
CREATE OR REPLACE FUNCTION public.observar_baixa(p_os uuid, p_observacao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_visita uuid; v_baixada uuid; v_antes text; v_nova text;
  v_tecnico uuid; v_campo boolean;
begin
  select o.visita_id, o.codigo_baixa_afline_id, o.baixa_observacao
    into v_visita, v_baixada, v_antes
    from ordem_servico o where o.id = p_os;
  if v_visita is null then
    raise exception 'O.S. nao encontrada.' using errcode = 'P0002';
  end if;

  -- Escopo, permissão "Anexar" e o dia do campo: a regra do anexo, sem cópia.
  perform pode_anexar_na_visita(v_visita, false);

  if v_baixada is null then
    raise exception 'Esta O.S. ainda nao foi baixada: escreva a observacao na baixa.'
      using errcode = '23514';
  end if;

  v_nova := nullif(btrim(coalesce(p_observacao, '')), '');
  if v_nova is not distinct from v_antes then
    return jsonb_build_object('ok', true, 'os', p_os, 'mudou', false);
  end if;

  v_campo := tem_papel('TECNICO') and not (select eh_gestor())
             and not (tem_papel('CONTROLADOR') or (tem_papel('SUPERVISOR') and not (select supervisor_esta_em_campo())));
  v_tecnico := meu_tecnico_id();

  update ordem_servico set baixa_observacao = v_nova where id = p_os;

  insert into visita_evento
    (visita_id, os_id, tipo, de, para, origem, usuario_id, login, tecnico_id, observacao)
  values (v_visita, p_os, 'OBSERVACAO_BAIXA',
          jsonb_build_object('observacao', v_antes),
          jsonb_build_object('observacao', v_nova),
          case when v_campo then 'MOBILE' else 'TELA' end,
          auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico, coalesce(v_nova, '(observacao apagada)'));

  return jsonb_build_object('ok', true, 'os', p_os, 'mudou', true);
end;
$function$;

-- pode_anexar_na_visita: 1 troca(s)
CREATE OR REPLACE FUNCTION public.pode_anexar_na_visita(p_visita uuid, p_evidencia boolean DEFAULT false)
 RETURNS date
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_data date; v_equipe uuid; v_prazo int;
begin
  if not ((select eh_gestor()) or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para anexar.' using errcode = '42501';
  end if;
  if not tem_permissao('servicos.anexar') then
    raise exception 'Seu perfil de acesso nao inclui "Anexar".'
      using errcode = '42501';
  end if;

  select data_agendada, equipe_id into v_data, v_equipe
    from visita
   where id = p_visita and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis())
     and excluido_em is null;
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  if not (select eh_gestor()) and (v_equipe is null
      or v_equipe not in (select equipes_legiveis())) then
    raise exception 'Este contrato nao e da sua equipe.' using errcode = '42501';
  end if;

  -- 136: so a EVIDENCIA ganhou prazo. Equipamento, miscelanea e contato
  -- continuam no dia -- mexer neles depois mudaria o que foi declarado
  -- na hora do servico.
  v_prazo := case when coalesce(p_evidencia, false)
                  then coalesce((select (valor #>> '{}')::int from parametro
                                  where empresa_id = minha_empresa()
                                    and chave = 'evidencia_prazo_dias'), 1)
                  else 0 end;

  if tem_papel('TECNICO') and not (select eh_gestor())
     and not (tem_papel('CONTROLADOR') or (tem_papel('SUPERVISOR') and not (select supervisor_esta_em_campo())))
     and (v_data > hoje_local() or v_data < hoje_local() - v_prazo) then
    if v_prazo > 0 then
      raise exception 'Contrato de % — o prazo para anexar evidencia era ate %. Fale com o controlador.',
        to_char(v_data, 'DD/MM'), to_char(v_data + v_prazo, 'DD/MM')
        using errcode = '42501';
    else
      raise exception 'Contrato de % — o campo so anexa no dia. Fale com o controlador.',
        to_char(v_data, 'DD/MM')
        using errcode = '42501';
    end if;
  end if;

  return v_data;
end;
$function$;

-- registrar_etapa: 1 troca(s)
CREATE OR REPLACE FUNCTION public.registrar_etapa(p_visita uuid, p_situacao text, p_observacao text DEFAULT NULL::text, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_precisao numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_atual text; v_equipe uuid; v_tecnico uuid; v_campo boolean;
begin
  if not ((select eh_gestor()) or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para registrar etapa.' using errcode = '42501';
  end if;

  v_campo := tem_papel('TECNICO') and not (select eh_gestor())
             and not (tem_papel('CONTROLADOR') or (tem_papel('SUPERVISOR') and not (select supervisor_esta_em_campo())));

  select situacao, equipe_id into v_atual, v_equipe
    from visita
   where id = p_visita and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis());
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  if not (select eh_gestor()) and (v_equipe is null
      or v_equipe not in (select equipes_legiveis())) then
    raise exception 'Este contrato nao e da sua equipe.' using errcode = '42501';
  end if;

  if v_campo then
    if gps_bloqueado(meu_tecnico_id()) then
      raise exception 'O GPS do celular esta informando uma localizacao simulada. Desative o app de localizacao simulada para continuar.'
        using errcode = '42501';
    end if;
    if v_atual = any (situacoes_terminais()) then
      raise exception 'Contrato ja encerrado. Peca ao controlador para voltar.'
        using errcode = '42501';
    end if;
    if p_situacao = any (situacoes_terminais())
       and (p_lat is null or p_lng is null) then
      raise exception 'Ligue a localizacao do celular para encerrar a visita.'
        using errcode = '42501';
    end if;
  end if;

  -- 099: encerrado voltando a aberto é `reverter_situacao` — controlador,
  -- com motivo (D-030). Por aqui, para ninguém.
  if v_atual = any (situacoes_terminais())
     and not (p_situacao = any (situacoes_terminais())) then
    raise exception 'Contrato encerrado so volta pelo controlador, com motivo (Mudar status).'
      using errcode = '42501';
  end if;

  perform exige_todas_baixadas(p_visita, p_situacao);
  -- 099: vale para o campo também — "Finalizar" é CONCLUIDA.
  perform confere_destino_das_baixas(p_visita, p_situacao);

  v_tecnico := meu_tecnico_id();

  update visita set
    situacao    = p_situacao,
    situacao_em = now(),
    inicio      = case when p_situacao = 'EM_EXECUCAO' and inicio is null
                       then now() else inicio end,
    fim         = case when p_situacao = 'CONCLUIDA' then now() else fim end,
    tecnico_responsavel_id = coalesce(tecnico_responsavel_id, v_tecnico)
  where id = p_visita;

  insert into visita_evento (visita_id, tipo, de, para, origem,
                             usuario_id, login, tecnico_id, equipe_id,
                             observacao, lat, lng, precisao_m)
  values (p_visita, 'SITUACAO',
          jsonb_build_object('situacao', v_atual),
          jsonb_build_object('situacao', p_situacao),
          case when v_campo then 'MOBILE' else 'WEB' end,
          auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico, v_equipe,
          nullif(btrim(coalesce(p_observacao, '')), ''),
          p_lat, p_lng, p_precisao);

  return jsonb_build_object('de', v_atual, 'para', p_situacao);
end;
$function$;

-- a chave, agora só para SUPERVISOR e com as permissões do técnico
create or replace function public.supervisor_em_campo(p_usuario uuid, p_ligar boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tec uuid; v_mat text; v_base uuid; v_eq uuid; v_eq_nome text; v_rota uuid; r jsonb;
begin
  if not (select tem_papel('ADMIN')) then
    raise exception 'So o ADMIN liga o supervisor em campo (a chave da o papel TECNICO).'
      using errcode = '42501';
  end if;
  if not exists (select 1 from usuario_papel
                  where usuario_id = p_usuario and papel = 'SUPERVISOR') then
    raise exception 'Esta pessoa nao e supervisor.' using errcode = '23514';
  end if;

  select t.id, upper(btrim(t.matricula)), t.base_id into v_tec, v_mat, v_base
    from perfil p join tecnico t on t.id = p.tecnico_id
   where p.id = p_usuario and p.empresa_id = minha_empresa()
     and t.base_id in (select bases_visiveis());
  if v_tec is null then
    raise exception 'O login dele nao tem tecnico (login TOA) na cidade ativa. Cadastre o login TOA em Editar primeiro.'
      using errcode = 'P0002';
  end if;

  -- o vínculo aberto do login, se houver
  select h.equipe_id into v_rota from equipe_login_toa h
    join equipe e on e.id = h.equipe_id
   where norm_txt(h.login_toa) = norm_txt(v_mat) and h.fim is null and e.base_id = v_base
   limit 1;

  if p_ligar then
    r := criar_equipe_do_supervisor(p_usuario);
    v_eq := (r->>'equipe_id')::uuid;
    v_eq_nome := r->>'nome';

    update tecnico set equipe_id = v_eq, usuario_id = p_usuario where id = v_tec;

    if v_rota is distinct from v_eq then
      if v_rota is not null then perform desligar_login_da_equipe(v_mat); end if;
      perform cadastrar_login_da_equipe(v_eq, v_mat);
    end if;

    insert into usuario_papel (usuario_id, papel, escopo, base_id)
    values (p_usuario, 'TECNICO', escopo_padrao('TECNICO'), v_base)
    on conflict (usuario_id, papel) do nothing;

    -- 205: as chaves do técnico que o perfil Supervisor não tem
    insert into usuario_permissao (usuario_id, permissao_chave, concedida, definido_por)
    select p_usuario, k, true, auth.uid()
      from unnest(array['servicos.baixar', 'servicos.anexar']) k
    on conflict (usuario_id, permissao_chave) do update
      set concedida = true, definido_por = auth.uid(), definido_em = now();

    return jsonb_build_object('em_campo', true, 'equipe', v_eq_nome, 'login', v_mat);
  else
    if v_rota is not null then perform desligar_login_da_equipe(v_mat); end if;
    delete from usuario_papel where usuario_id = p_usuario and papel = 'TECNICO';
    delete from usuario_permissao
     where usuario_id = p_usuario and permissao_chave in ('servicos.baixar', 'servicos.anexar');
    update tecnico set equipe_id = null where id = v_tec;
    return jsonb_build_object('em_campo', false, 'login', v_mat);
  end if;
end;
$function$;

revoke all on function public.supervisor_em_campo(uuid, boolean) from public, anon;
grant execute on function public.supervisor_em_campo(uuid, boolean) to authenticated;
