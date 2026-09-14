-- ============================================================
-- 066 · A rota fixada do contrato: o TOA não desfaz o que a pessoa fez
--
-- > "caso aquele contrato específico que está na linha do técnico
-- >  específico do relatório, quando eu quiser mandar para outro técnico
-- >  o contrato não deve retornar quando importado de novo […] quero
-- >  tipo desativar a ligação daquele contrato em questão" — Emanuel
--
-- Hoje o controlador transfere o contrato para outra equipe e a
-- importação seguinte **desfaz**. Não é bug obscuro, está escrito:
--
--     equipe_id = coalesce(v_equipe, equipe_id),
--     tecnico_responsavel_id = coalesce(v_tecnico, tecnico_responsavel_id),
--
-- `v_equipe` quase nunca é nulo (na falta de vínculo ele cai no abrigo),
-- então o `coalesce` sempre sobrescreve. O trabalho de despacho da
-- véspera evapora na importação da manhã, sem aviso.
--
-- ┌─ o que fixar significa, e o que NÃO significa ───────────────────┐
-- │ FIXA: equipe e técnico responsável. A importação passa a pular    │
-- │       essas duas colunas naquele contrato.                        │
-- │                                                                   │
-- │ NÃO FIXA: situação, janela, endereço, O.S., baixa. O sistema      │
-- │       continua sendo espelho do TOA para tudo isso — e é o que o  │
-- │       Emanuel pediu na mesma mensagem: "os status devem mudar a   │
-- │       cada importação, quando houve alteração no relatório".      │
-- │       Fixar a rota não pode virar congelar o contrato.            │
-- └───────────────────────────────────────────────────────────────────┘
--
-- **Transferir passa a fixar sozinho.** Quem transfere está dizendo
-- "este contrato é daquela equipe" — deixar isso desprotegido é o
-- defeito. Quem quiser devolver o contrato ao roteamento automático
-- desliga a fixação na tela.
--
-- Já existia meia solução: `bloqueado_em` (D-006), que protege o
-- TRABALHO DO CAMPO — e, de fato, o ramo bloqueado da importação já não
-- mexe em equipe. Mas ele nasce do técnico tocar no contrato, não de o
-- controlador decidir. São duas perguntas diferentes:
--   bloqueado_em    = "o campo já mexeu aqui"
--   rota_fixada_em  = "a rota deste contrato foi decidida por gente"
-- ============================================================

alter table visita add column if not exists rota_fixada_em    timestamptz;
alter table visita add column if not exists rota_fixada_por   uuid references perfil(id);
alter table visita add column if not exists rota_fixada_motivo text;

comment on column visita.rota_fixada_em is
  'Quando a equipe/tecnico deste contrato foram decididos por uma '
  'pessoa. Enquanto nao for nulo, a importacao do TOA NAO mexe nessas '
  'duas colunas -- o resto (situacao, janela, endereco, O.S.) continua '
  'espelhando o TOA normalmente. Ver 066.';

create index if not exists visita_rota_fixada_idx
  on visita (rota_fixada_em) where rota_fixada_em is not null;

-- ------------------------------------------------------------
-- 1. A importação respeita a fixação
-- ------------------------------------------------------------
-- Cirurgia com âncora, e não reescrita: `importar_toa_interno` tem
-- ~300 linhas e todas as outras regras dela continuam valendo. O bloco
-- ABORTA se a âncora não existir — replace() que não acha nada não
-- reclama, e uma migration que "passa" sem mudar nada é pior que uma
-- que falha.
do $$
declare src text; novo text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'importar_toa_interno';

  if src is null then
    raise exception 'importar_toa_interno nao encontrada';
  end if;
  if position('equipe_id     = coalesce(v_equipe, equipe_id),' in src) = 0
     or position('tecnico_responsavel_id = coalesce(v_tecnico, tecnico_responsavel_id),' in src) = 0
  then
    raise exception 'As ancoras da 066 nao existem mais em importar_toa_interno. '
      'Alguem mudou a funcao: confira antes de aplicar.';
  end if;

  novo := replace(src,
    'equipe_id     = coalesce(v_equipe, equipe_id),',
    'equipe_id     = case when rota_fixada_em is not null then equipe_id'
      || E'\n                                 else coalesce(v_equipe, equipe_id) end,');
  novo := replace(novo,
    'tecnico_responsavel_id = coalesce(v_tecnico, tecnico_responsavel_id),',
    'tecnico_responsavel_id = case when rota_fixada_em is not null'
      || E'\n                                          then tecnico_responsavel_id'
      || E'\n                                          else coalesce(v_tecnico, tecnico_responsavel_id) end,');

  execute novo;
end $$;

-- ------------------------------------------------------------
-- 2. Quem transfere, fixa
-- ------------------------------------------------------------
create or replace function public.transferir_visita(
  p_visita uuid, p_equipe uuid, p_motivo text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ant uuid; v_cod_ant text; v_cod_novo text;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao para transferir.' using errcode = '42501';
  end if;

  select equipe_id into v_ant from visita
   where id = p_visita and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis());
  if not found then raise exception 'Visita nao encontrada.'; end if;

  if v_ant is not distinct from p_equipe then
    return jsonb_build_object('mudou', false);
  end if;

  select codigo into v_cod_ant  from equipe where id = v_ant;
  select codigo into v_cod_novo from equipe where id = p_equipe;

  -- o evento tem de guardar a equipe ANTIGA: e ela que estava responsavel
  insert into visita_evento (visita_id, usuario_id, equipe_id, tipo,
                             de, para, observacao, origem)
  values (p_visita, auth.uid(), v_ant, 'TRANSFERENCIA',
          jsonb_build_object('equipe', v_cod_ant),
          jsonb_build_object('equipe', v_cod_novo),
          p_motivo, 'WEB');

  -- 066: transferir FIXA. Sem isto a proxima importacao devolve o
  -- contrato para a equipe do login, e o despacho de ontem some.
  update visita set
      equipe_id = p_equipe,
      tecnico_responsavel_id = null,
      rota_fixada_em = now(),
      rota_fixada_por = auth.uid(),
      rota_fixada_motivo = coalesce(nullif(btrim(p_motivo), ''), 'transferido pelo controle')
   where id = p_visita;

  return jsonb_build_object('mudou', true, 'de', v_cod_ant, 'para', v_cod_novo,
                            'rota_fixada', true);
end;
$function$;

-- ------------------------------------------------------------
-- 3. A chave da fixação, por contrato
-- ------------------------------------------------------------
create or replace function public.fixar_rota_da_visita(
  p_visita uuid, p_fixar boolean, p_motivo text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ja timestamptz; v_cod text;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;

  select v.rota_fixada_em, e.codigo into v_ja, v_cod
    from visita v left join equipe e on e.id = v.equipe_id
   where v.id = p_visita and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  if p_fixar then
    update visita set
        rota_fixada_em = coalesce(rota_fixada_em, now()),
        rota_fixada_por = coalesce(rota_fixada_por, auth.uid()),
        rota_fixada_motivo = coalesce(nullif(btrim(p_motivo), ''), rota_fixada_motivo,
                                      'fixado na tela')
     where id = p_visita;
  else
    update visita set
        rota_fixada_em = null, rota_fixada_por = null, rota_fixada_motivo = null
     where id = p_visita;
  end if;

  -- Fica na trilha: `visita_evento` e o funil por onde toda mudanca
  -- passa, e e de la que o campo recebe aviso.
  insert into visita_evento (visita_id, usuario_id, tipo, de, para,
                             observacao, origem)
  values (p_visita, auth.uid(), 'ROTA_FIXADA',
          jsonb_build_object('fixada', v_ja is not null),
          jsonb_build_object('fixada', p_fixar, 'equipe', v_cod),
          nullif(btrim(p_motivo), ''), 'WEB');

  return jsonb_build_object('fixada', p_fixar, 'equipe', v_cod);
end;
$function$;

-- ------------------------------------------------------------
-- 4. As varreduras em lote param na porta do contrato fixado
-- ------------------------------------------------------------
-- `cadastrar_login_da_equipe` move os contratos de um login inteiro, e
-- `cadastrar_tecnico_avulso` religa os orfaos. Nenhuma das duas pode
-- passar por cima de uma decisao tomada contrato a contrato -- e o
-- filtro entra no WHERE, nao num gatilho silencioso: assim a contagem
-- que elas devolvem continua verdadeira.
do $$
declare src text; novo text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cadastrar_login_da_equipe';
  if position('and v.equipe_id is distinct from p_equipe;' in src) = 0 then
    raise exception 'ancora de cadastrar_login_da_equipe nao encontrada';
  end if;
  novo := replace(src,
    'and v.equipe_id is distinct from p_equipe;',
    'and v.rota_fixada_em is null'
      || E'\n     and v.equipe_id is distinct from p_equipe;');
  execute novo;

  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cadastrar_tecnico_avulso';
  if position('and v.tecnico_responsavel_id is null' in src) = 0 then
    raise exception 'ancora de cadastrar_tecnico_avulso nao encontrada';
  end if;
  novo := replace(src,
    'and v.tecnico_responsavel_id is null',
    'and v.rota_fixada_em is null'
      || E'\n     and v.tecnico_responsavel_id is null');
  execute novo;
end $$;

revoke all on function public.fixar_rota_da_visita(uuid, boolean, text) from public, anon;
grant execute on function public.fixar_rota_da_visita(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
