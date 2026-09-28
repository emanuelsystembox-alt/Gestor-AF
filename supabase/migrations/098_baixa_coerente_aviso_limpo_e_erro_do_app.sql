-- ============================================================================
-- 098 · A baixa manual coerente, o aviso sem o nome do arquivo e o erro do app
-- ============================================================================
-- Pedidos do Emanuel (27/09):
--
-- > "não precisa mostrar de onde vem a atividade, técnico não sabe, por
-- >  exemplo: MAN-AFLINE_27 e etc."
--
-- > "o sistema não deve aceitar baixar a o.s do contrato e ir para entrada,
-- >  ou seja, so pode ter opção de inserir o codigo de baixa se for para
-- >  concluido, cancelado, reagendado […] os codigos de baixa do cancelado,
-- >  reagendado, concluido, deve separar, eles não servem para a mesma
-- >  coisa, eu não posso baixar com 409 - cancelado […] se eu for querer
-- >  baixar manual […] talvez se estiver assim no toa ok?"
--
-- > "tem que fazer um debug no app […] vamos mapear"
--
-- ┌─ o defeito que a tela mostrou ────────────────────────────────────┐
-- │ O contrato 226470184 estava CONCLUÍDO. O controlador lançou o 409 │
-- │ nas duas O.S. escolhendo "Na entrada" — e `baixar_visita` aceitou: │
-- │ só `exige_todas_baixadas` olhava a situação, e ela só se importa   │
-- │ com situação terminal. Resultado: um contrato encerrado voltou     │
-- │ para a entrada SEM MOTIVO (o "Voltar", D-030, pede motivo), com    │
-- │ código de instalação efetuada. Duas mentiras numa chamada.         │
-- └─────────────────────────────────────────────────────────────────────┘
--
-- ┌─ o que é regra e onde vale ───────────────────────────────────────┐
-- │ A BAIXA MANUAL (web, `baixar_visita`):                             │
-- │  · código de baixa só entra com situação final CONCLUÍDA,          │
-- │    CANCELADA ou REAGENDAMENTO — e ela é obrigatória;               │
-- │  · todo código da AFLINE no contrato tem de ter como destino ESSA  │
-- │    situação (`codigo_baixa.situacao_destino`, D-097). 409 não      │
-- │    cancela; código de cancelamento não conclui.                     │
-- │ A MUDANÇA DE STATUS PELA WEB (`registrar_etapa` fora do campo)     │
-- │  para uma situação terminal passa pela mesma conferência.          │
-- │ O TOA NÃO: o que a operadora baixou é leitura (D-042), e a baixa   │
-- │  automática aplica o destino do próprio código — "se estiver assim │
-- │  no toa ok".                                                         │
-- │ O CAMPO não mudou nesta migration: o técnico baixa O.S. por O.S.   │
-- │  e encerra depois. Aplicar a mesma conferência ao encerramento do  │
-- │  campo é pergunta aberta ao Emanuel (D-172).                        │
-- └─────────────────────────────────────────────────────────────────────┘
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A · o aviso de contrato novo não carrega o nome do arquivo
-- ---------------------------------------------------------------------------
-- A observação do evento IMPORTADA é o nome da planilha — dado de quem
-- importou, não do técnico. O aviso NOVO passa a nascer sem detalhe; o
-- evento continua guardando o arquivo (é o rastro da importação).
create or replace function public.aviso_do_evento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

-- Os avisos NOVO que já existem: o detalhe deles é sempre o arquivo.
update aviso set detalhe = null where tipo = 'NOVO' and detalhe is not null;

-- ---------------------------------------------------------------------------
-- B · o código de baixa tem de ser da situação final
-- ---------------------------------------------------------------------------
create or replace function public.confere_destino_das_baixas(p_visita uuid, p_situacao text)
 returns void
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare v_lista text;
begin
  if p_situacao is null or not (p_situacao = any (situacoes_terminais())) then
    return;
  end if;
  -- Só a baixa da AFLINE: a do TOA é leitura (D-042) e pode divergir.
  select string_agg(format('%s (%s · %s, que é de %s)', o.numero_os, c.codigo,
                           c.descricao, lower(coalesce(c.situacao_destino, 'destino nenhum'))),
                    '; ' order by o.sequencia)
    into v_lista
    from ordem_servico o
    join codigo_baixa c on c.id = o.codigo_baixa_afline_id
   where o.visita_id = p_visita
     and c.situacao_destino is distinct from p_situacao;
  if v_lista is not null then
    raise exception 'Codigo de baixa nao combina com %: %. Escolha codigos de %.',
      lower(p_situacao), v_lista, lower(p_situacao)
      using errcode = '23514';
  end if;
end;
$function$;

revoke all on function public.confere_destino_das_baixas(uuid, text) from public, anon;
grant execute on function public.confere_destino_das_baixas(uuid, text) to authenticated;

create or replace function public.baixar_visita(p_visita uuid, p_itens jsonb, p_situacao text default null::text, p_lat numeric default null::numeric, p_lng numeric default null::numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare it jsonb; n int := 0;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para baixar.' using errcode = '42501';
  end if;

  perform 1 from visita v
   where v.id = p_visita and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  -- 098: código de baixa só com situação final terminal — e ela é
  -- obrigatória. "Baixar e ir para a entrada" era aceito e tirava um
  -- contrato encerrado do encerramento sem motivo.
  if jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) > 0
     and (p_situacao is null or not (p_situacao = any (situacoes_terminais()))) then
    raise exception 'Codigo de baixa so entra com Concluida, Cancelada ou Reagendamento.'
      using errcode = '23514';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb))
  loop
    perform baixar_os(
      (it->>'os_id')::uuid,
      (it->>'codigo')::integer,
      nullif(it->>'sub_falha_id','')::uuid,
      nullif(btrim(coalesce(it->>'observacao','')),''),
      null, p_lat, p_lng);
    n := n + 1;
  end loop;

  if p_situacao is not null then
    perform exige_todas_baixadas(p_visita, p_situacao);
    -- 098: e todo código tem de ser DESTA situação (409 não cancela).
    perform confere_destino_das_baixas(p_visita, p_situacao);

    update visita set situacao = p_situacao, situacao_em = now()
     where id = p_visita;

    insert into visita_evento (visita_id, tipo, para, origem, usuario_id, login,
                               tecnico_id, observacao, lat, lng)
    values (p_visita, 'SITUACAO',
            jsonb_build_object('situacao', p_situacao),
            case when tem_papel('TECNICO') and not eh_gestor()
                 then 'MOBILE' else 'TELA' end,
            auth.uid(),
            coalesce((select matricula from tecnico where id = meu_tecnico_id()),
                     (select email from perfil where id = auth.uid())),
            meu_tecnico_id(),
            format('Baixa de %s O.S.', n), p_lat, p_lng);
  end if;

  return jsonb_build_object('ok', true, 'baixadas', n, 'situacao', p_situacao);
end;
$function$;

-- A mudança de status pela WEB para uma situação terminal confere o mesmo.
-- O campo fica como estava (ver cabeçalho).
create or replace function public.registrar_etapa(p_visita uuid, p_situacao text, p_observacao text default null::text, p_lat numeric default null::numeric, p_lng numeric default null::numeric, p_precisao numeric default null::numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_atual text; v_equipe uuid; v_tecnico uuid; v_campo boolean;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para registrar etapa.' using errcode = '42501';
  end if;

  v_campo := tem_papel('TECNICO') and not eh_gestor()
             and not (tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'));

  select situacao, equipe_id into v_atual, v_equipe
    from visita
   where id = p_visita and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis());
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  if not eh_gestor() and (v_equipe is null
      or v_equipe not in (select equipes_visiveis())) then
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

  perform exige_todas_baixadas(p_visita, p_situacao);
  if not v_campo then
    perform confere_destino_das_baixas(p_visita, p_situacao);
  end if;

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

-- ---------------------------------------------------------------------------
-- C · o erro do aplicativo, para mapear o que fecha o app
-- ---------------------------------------------------------------------------
-- O APK fechou ("Gestor AF Campo fechou porque este app tem um bug") e
-- ninguém tinha como saber ONDE. No APK, um erro de JavaScript não
-- tratado derruba o app inteiro, sem tela vermelha. O app passa a
-- mandar para cá: o erro que ele pegou (tela ou JS), e — no próximo
-- início — o passo em que estava quando FECHOU (erro nativo não chega ao
-- JavaScript; o rastro do passo sim).
create table if not exists public.erro_app (
  id          bigint generated always as identity primary key,
  empresa_id  uuid not null references empresa(id),
  usuario_id  uuid not null,
  tecnico_id  uuid references tecnico(id),
  tipo        text not null check (tipo in ('TELA', 'JS', 'FECHOU')),
  mensagem    text not null,
  pilha       text,
  contexto    jsonb,
  versao      text,
  aparelho    text,
  criado_em   timestamptz not null default now()
);
create index if not exists erro_app_empresa_em on public.erro_app (empresa_id, criado_em desc);

alter table public.erro_app enable row level security;

-- Só a gestão lê. Ninguém grava direto: a porta é a função (autor
-- carimbado pelo servidor, D-061).
drop policy if exists erro_app_leitura on public.erro_app;
create policy erro_app_leitura on public.erro_app for select to authenticated
  using (empresa_id = (select minha_empresa()) and (select eh_gestor()));

create or replace function public.registrar_erro_app(
  p_tipo text, p_mensagem text, p_pilha text default null,
  p_contexto jsonb default null, p_versao text default null, p_aparelho text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Sem login.' using errcode = '42501';
  end if;
  -- Teto por usuário: um laço de erro não pode encher o banco (plano Free).
  if (select count(*) from erro_app
       where usuario_id = auth.uid() and criado_em > now() - interval '1 hour') >= 30 then
    return;
  end if;
  insert into erro_app (empresa_id, usuario_id, tecnico_id, tipo, mensagem, pilha,
                        contexto, versao, aparelho)
  values (minha_empresa(), auth.uid(), meu_tecnico_id(),
          case when p_tipo in ('TELA', 'JS', 'FECHOU') then p_tipo else 'JS' end,
          left(coalesce(nullif(btrim(p_mensagem), ''), '(sem mensagem)'), 2000),
          left(p_pilha, 8000), p_contexto, left(p_versao, 40), left(p_aparelho, 120));
end;
$function$;

revoke all on function public.registrar_erro_app(text, text, text, jsonb, text, text) from public, anon;
grant execute on function public.registrar_erro_app(text, text, text, jsonb, text, text) to authenticated;

-- Expurgo junto com o rastro, na mesma madrugada e pelo mesmo prazo
-- (`rastro_retencao_dias`, 90): traz o aparelho e o login do técnico.
create or replace function public.expurgar_rastro()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; n1 int := 0; n2 int := 0; n3 int := 0; n4 int := 0; k int;
begin
  for r in select e.id, coalesce((select (p.valor #>> '{}')::int from parametro p
                                   where p.empresa_id = e.id and p.chave = 'rastro_retencao_dias'), 90) as dias
             from empresa e loop
    delete from rastro_ponto where empresa_id = r.id and capturado_em < now() - make_interval(days => r.dias);
    get diagnostics k = row_count; n1 := n1 + k;
    delete from gps_alerta where empresa_id = r.id and em < now() - make_interval(days => r.dias);
    get diagnostics k = row_count; n2 := n2 + k;
    delete from cerca_evento where empresa_id = r.id and em < now() - make_interval(days => r.dias);
    get diagnostics k = row_count; n3 := n3 + k;
    delete from erro_app where empresa_id = r.id and criado_em < now() - make_interval(days => r.dias);
    get diagnostics k = row_count; n4 := n4 + k;
  end loop;
  return jsonb_build_object('rastro_ponto', n1, 'gps_alerta', n2, 'cerca_evento', n3, 'erro_app', n4);
end;
$function$;
revoke all on function public.expurgar_rastro() from public, anon, authenticated;

notify pgrst, 'reload schema';
