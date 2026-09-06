-- 032 · A etapa do técnico, carimbada pelo servidor
--
-- ┌─ DOIS PROBLEMAS, A MESMA RAIZ ───────────────────────────────────┐
-- │ 1. A tela do campo dava UPDATE na visita e INSERT no evento por   │
-- │    conta própria, mandando `usuario_id` do cliente. Autor que vem │
-- │    do cliente não é prova de nada — e o histórico existe          │
-- │    justamente para ser prova.                                     │
-- │                                                                   │
-- │ 2. `evento_leitura` era `eh_gestor() or tem_papel('CONTROLADOR')`.│
-- │    O TÉCNICO não conseguia ler o histórico do contrato que ele    │
-- │    mesmo estava executando. O SUPERVISOR também não.              │
-- └───────────────────────────────────────────────────────────────────┘

-- ============================================================
-- A · Quem pode ler e escrever no histórico
-- ============================================================
-- A regra certa é a mais simples: você lê o histórico do que já
-- consegue ver. O subselect em `visita` passa pelo RLS da visita, então
-- ele não abre nada novo — só para de esconder o que a pessoa já tinha
-- direito de ver.
drop policy if exists evento_leitura on visita_evento;
create policy evento_leitura on visita_evento for select
  using (visita_id in (select id from visita));

-- E ninguém escreve evento no nome de outro.
drop policy if exists evento_insercao on visita_evento;
create policy evento_insercao on visita_evento for insert
  with check (
    visita_id in (select id from visita)
    and (usuario_id is null or usuario_id = auth.uid())
  );

-- ============================================================
-- B · registrar_etapa
-- ============================================================
-- SECURITY DEFINER ignora o RLS (CLAUDE.md), então o escopo da equipe
-- é conferido à mão aqui dentro. `login` sai da matrícula do técnico —
-- que é o login dele no TOA — e cai no e-mail para quem opera a tela.
create or replace function registrar_etapa(
  p_visita     uuid,
  p_situacao   text,
  p_observacao text default null,
  p_lat        numeric default null,
  p_lng        numeric default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v_atual text; v_equipe uuid; v_tecnico uuid;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para registrar etapa.' using errcode = '42501';
  end if;

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

  -- O técnico não reabre o que já fechou; para isso existe
  -- `reverter_situacao`, que é do controlador e pede motivo (030).
  if tem_papel('TECNICO') and not eh_gestor()
     and v_atual in ('CONCLUIDA','CANCELADA') then
    raise exception 'Contrato ja encerrado. Peca ao controlador para voltar.'
      using errcode = '42501';
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
                             observacao, lat, lng)
  values (p_visita, 'SITUACAO',
          jsonb_build_object('situacao', v_atual),
          jsonb_build_object('situacao', p_situacao),
          case when tem_papel('TECNICO') then 'MOBILE' else 'WEB' end,
          auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico, v_equipe,
          nullif(btrim(coalesce(p_observacao, '')), ''),
          p_lat, p_lng);

  return jsonb_build_object('de', v_atual, 'para', p_situacao);
end;
$fn$;

revoke all on function registrar_etapa(uuid, text, text, numeric, numeric) from public, anon;
grant execute on function registrar_etapa(uuid, text, text, numeric, numeric) to authenticated;

-- ============================================================
-- C · baixar_os também diz quem
-- ============================================================
-- Duas mudanças: o `login` no evento, e a conferência de escopo que
-- faltava — a função é DEFINER, então sem ela um técnico baixava a
-- O.S. de qualquer equipe.
create or replace function baixar_os(
  p_os uuid, p_codigo integer, p_sub_falha uuid default null,
  p_observacao text default null, p_situacao text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_visita uuid; v_cod uuid; v_conj text; v_tecnico uuid;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para baixar.' using errcode = '42501';
  end if;
  if not tem_permissao('servicos.baixar') then
    raise exception 'Seu perfil de acesso nao inclui "Baixar servico".'
      using errcode = '42501';
  end if;

  select o.visita_id into v_visita from ordem_servico o where o.id = p_os;
  if v_visita is null then
    raise exception 'O.S. nao encontrada.' using errcode = 'P0002';
  end if;

  if not eh_gestor() and not exists (
       select 1 from visita v where v.id = v_visita
        and v.empresa_id = minha_empresa()
        and v.base_id in (select bases_visiveis())
        and v.equipe_id in (select equipes_visiveis())) then
    raise exception 'Esta O.S. nao e da sua equipe.' using errcode = '42501';
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
     codigo_baixa_id, sub_falha_id, observacao)
  values (v_visita, p_os, 'BAIXA',
          jsonb_build_object('codigo', p_codigo, 'situacao', p_situacao),
          case when tem_papel('TECNICO') and not eh_gestor() then 'MOBILE' else 'TELA' end,
          auth.uid(),
          coalesce((select matricula from tecnico where id = v_tecnico),
                   (select email from perfil where id = auth.uid())),
          v_tecnico, v_cod, p_sub_falha,
          nullif(btrim(coalesce(p_observacao,'')),''));

  return jsonb_build_object('ok', true, 'os', p_os, 'codigo', p_codigo);
end;
$function$;

revoke all on function baixar_os(uuid, integer, uuid, text, text) from public, anon;
grant execute on function baixar_os(uuid, integer, uuid, text, text) to authenticated;

-- Conferido depois de aplicar: anon não executa nenhuma das duas, e
-- `select * from testar_policies();` passa 16 de 16.
