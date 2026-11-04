-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 207 — Responder no contrato sem mudar o status (D-302)                │
-- │                                                                      │
-- │ "tem que da a opção para o cop responder no mesmo status (...) eles  │
-- │  não estavam usando por que o cop não conseguia enviar para o mesmo  │
-- │  status ai ele acaba indo para o chat abaixo, porém o chat seria     │
-- │  para outro assunto que não fosse o contrato" — Emanuel, 04/11.      │
-- │                                                                      │
-- │ A resposta só existia como observação de uma MUDANÇA de status       │
-- │ (`registrar_etapa`); o select da tela tirava o status atual, e o     │
-- │ gatilho de avisos ignora SITUACAO com "de" = "para". Responder a um  │
-- │ ticket de suporte sem tirá-lo do ticket não tinha porta — e o COP ia │
-- │ para o chat, que fica fora do histórico do contrato.                 │
-- │                                                                      │
-- │ `responder_no_contrato` grava o evento RESPOSTA_COP (de/para = o     │
-- │ status de agora, para o histórico dizer "no mesmo status"), sem      │
-- │ tocar em `visita` — não carimba `bloqueado_em` nem `situacao_em`, o  │
-- │ relógio do serviço não reinicia. `aviso_do_evento` manda ao técnico  │
-- │ como OBSERVACAO ("Resposta do COP no contrato"). Mesma porta e o     │
-- │ mesmo escopo de `registrar_etapa` pela web; o campo não usa.         │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.responder_no_contrato(p_visita uuid, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_atual text; v_equipe uuid; v_txt text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  if not ((select eh_gestor()) or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')) then
    raise exception 'Sem permissao para responder no contrato.' using errcode = '42501';
  end if;
  if v_txt is null then
    raise exception 'Escreva a resposta.' using errcode = '23514';
  end if;
  if length(v_txt) > 500 then
    raise exception 'Resposta longa demais (maximo 500 caracteres).' using errcode = '23514';
  end if;

  select situacao, equipe_id into v_atual, v_equipe
    from visita
   where id = p_visita and empresa_id = minha_empresa() and excluido_em is null
     and base_id in (select bases_visiveis());
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;
  if not (select eh_gestor()) and (v_equipe is null
      or v_equipe not in (select equipes_legiveis())) then
    raise exception 'Este contrato nao e da sua equipe.' using errcode = '42501';
  end if;

  insert into visita_evento (visita_id, tipo, de, para, origem, usuario_id, login, equipe_id, observacao)
  values (p_visita, 'RESPOSTA_COP',
          jsonb_build_object('situacao', v_atual), jsonb_build_object('situacao', v_atual),
          'WEB', auth.uid(), (select email from perfil where id = auth.uid()), v_equipe, v_txt);

  return jsonb_build_object('situacao', v_atual);
end;
$function$;

revoke all on function public.responder_no_contrato(uuid, text) from public, anon;
grant execute on function public.responder_no_contrato(uuid, text) to authenticated;

-- o gatilho de avisos, regerado do BANCO com o ramo novo
CREATE OR REPLACE FUNCTION public.aviso_do_evento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v visita%rowtype;
  v_equipe_nova uuid;
  v_servico text;
  v_tipo text;
  v_titulo text;
  v_detalhe text;
  v_de text; v_para text;
begin
  begin
    select * into v from visita where id = new.visita_id;
    if not found or v.excluido_em is not null then return new; end if;
    if new.origem = 'MOBILE' then return new; end if;

    select coalesce(ts.nome, ta.nome, 'Visita') into v_servico
      from visita vv
      left join tipo_servico   ts on ts.id = vv.tipo_servico_id
      left join tipo_atividade ta on ta.id = vv.tipo_atividade_id
     where vv.id = new.visita_id;

    v_de   := new.de->>'situacao';
    v_para := new.para->>'situacao';
    v_detalhe := new.observacao;

    if new.tipo = 'IMPORTADA' then
      if v.equipe_id is null then return new; end if;
      v_tipo := 'NOVO'; v_titulo := 'Contrato novo na sua agenda';
      -- 098: a observação da importação é o nome do arquivo. O técnico
      -- não sabe o que é, e não precisa saber.
      v_detalhe := null;

    elsif new.tipo = 'OBSERVACAO_COP' then
      -- 156e: a nota do COP para o tecnico ("cliente so as 14h").
      -- Apagar a nota nao avisa: sumir um recado nao pede acao de ninguem.
      if new.observacao = '(observacao apagada)' then return new; end if;
      v_tipo := 'OBSERVACAO';
      v_titulo := 'Observação do COP';

    elsif new.tipo = 'RESPOSTA_COP' then
      -- 207 (D-302): a resposta do COP no contrato, sem mudar o status.
      v_tipo := 'OBSERVACAO';
      v_titulo := 'Resposta do COP no contrato';
      v_de := null; v_para := null;

    elsif new.tipo = 'REVERSAO' then
      v_tipo := 'REABERTO';
      v_titulo := 'O controlador reabriu este contrato';

    elsif new.tipo = 'TRANSFERENCIA' then
      select id into v_equipe_nova from equipe
       where codigo = new.para->>'equipe' and empresa_id = v.empresa_id;

      if new.equipe_id is not null then
        insert into aviso (empresa_id, equipe_id, visita_id, evento_id, tipo,
                           titulo, detalhe, contrato, servico, autor_login)
        values (v.empresa_id, new.equipe_id, v.id, new.id, 'SAIU',
                'Contrato saiu da sua agenda', new.observacao,
                v.contrato, v_servico, new.login);
      end if;
      if v_equipe_nova is not null then
        insert into aviso (empresa_id, equipe_id, visita_id, evento_id, tipo,
                           titulo, detalhe, contrato, servico, autor_login)
        values (v.empresa_id, v_equipe_nova, v.id, new.id, 'CHEGOU',
                'Contrato transferido para a sua equipe', new.observacao,
                v.contrato, v_servico, new.login);
      end if;
      return new;

    elsif new.tipo = 'SITUACAO' then
      if v_para is null or v_de is not distinct from v_para then
        return new;
      end if;
      if v_para = 'CANCELADA' and new.origem = 'IMPORTACAO' then
        v_tipo := 'CANCELADO_OPERADORA';
        v_titulo := 'A operadora cancelou — não vá';
      else
        v_tipo := 'SITUACAO';
        v_titulo := 'O status mudou';
      end if;

    else
      return new;
    end if;

    if v.equipe_id is null then return new; end if;

    insert into aviso (empresa_id, equipe_id, visita_id, evento_id, tipo,
                       titulo, detalhe, situacao_de, situacao_para,
                       contrato, servico, autor_login)
    values (v.empresa_id, v.equipe_id, v.id, new.id, v_tipo,
            v_titulo, v_detalhe, v_de, v_para,
            v.contrato, v_servico, new.login);

  exception when others then
    raise warning 'aviso_do_evento falhou no evento %: %', new.id, sqlerrm;
  end;

  return new;
end;
$function$;
