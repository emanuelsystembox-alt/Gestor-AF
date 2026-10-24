-- ┌─ 129 · "você tem 2 contratos em andamento" — no sino, sem mexer em nada ┐
-- │ > "tem que deixar apenas 1 contrato com status, não existe 2 (...)    │
-- │ >  ou então sinalizar o técnico no app que ele tem 2 contratos em rota│
-- │ >  e que ele precisa baixar" — Emanuel, 24/10. Escolha: AVISAR; nada  │
-- │ >  muda sozinho.                                                      │
-- │                                                                       │
-- │ A trava "um status ativo por técnico" (095) barra o campo, o          │
-- │ controlador e todo mundo — menos a IMPORTAÇÃO, que pode trazer dois   │
-- │ (o TOA manda). Até aqui isso acontecia calado. Agora, quando a        │
-- │ importação deixa o técnico (ou a equipe, sem técnico) com 2 contratos │
-- │ em deslocamento/execução no mesmo dia:                                │
-- │  · o técnico recebe um AVISO (tipo DOIS_ATIVOS) no sino do app;       │
-- │  · a central recebe um SINAL (tipo DOIS_ATIVOS), vigente enquanto     │
-- │    continuar com 2.                                                   │
-- │ Uma vez por conjunto de contratos (chave), não a cada importação.     │
-- │ A conta é a MESMA da trava (095): fora jornada e o que o TOA fechou e │
-- │ ninguém tocou. Não derruba a importação: erro aqui vira warning.      │
-- └───────────────────────────────────────────────────────────────────────┘

alter table aviso drop constraint if exists aviso_tipo_check;
alter table aviso add constraint aviso_tipo_check check (tipo = any (array[
  'NOVO','SITUACAO','REABERTO','CANCELADO_OPERADORA','CHEGOU','SAIU','MATERIAL','DOIS_ATIVOS']));

alter table sinal drop constraint if exists sinal_tipo_check;
alter table sinal add constraint sinal_tipo_check check (tipo = any (array[
  'AJUDA','TEC1','RITMO','QUEBROU','MATERIAL','ABASTECIMENTO','CERCA','GPS','DOIS_ATIVOS']));

-- Os OUTROS contratos em andamento do mesmo técnico (ou equipe sem técnico)
-- no dia, com o mesmo critério da trava 095. Nulo = nenhum.
create or replace function public.outros_ativos(p_visita uuid)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select string_agg(coalesce(v.contrato, '(sem número)'), ', ' order by v.contrato)
    from visita n
    join visita v on v.id <> n.id and v.excluido_em is null
                 and v.data_agendada = n.data_agendada
                 and v.situacao in ('EM_DESLOCAMENTO', 'EM_EXECUCAO')
                 and not (coalesce(v.finalizado_toa, false) and v.bloqueado_em is null)
                 and (case when n.tecnico_responsavel_id is not null
                           then v.tecnico_responsavel_id = n.tecnico_responsavel_id
                           else v.tecnico_responsavel_id is null and v.equipe_id = n.equipe_id end)
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
   where n.id = p_visita
     and n.situacao in ('EM_DESLOCAMENTO', 'EM_EXECUCAO')
     and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
   having count(*) > 0;
$function$;

revoke all on function public.outros_ativos(uuid) from public, anon;
grant execute on function public.outros_ativos(uuid) to authenticated, service_role;

create or replace function public.avisa_dois_ativos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_outros text; v_chave text; v_sinal bigint; v_servico text; v_n int;
begin
  begin
    -- Fora da importação a trava 095 já impede o segundo ativo.
    if coalesce(current_setting('app.origem', true), '') <> 'IMPORTACAO' then return null; end if;
    if new.excluido_em is not null then return null; end if;
    if exists (select 1 from tipo_atividade ta
                where ta.id = new.tipo_atividade_id and ta.natureza = 'JORNADA') then
      return null;
    end if;
    if not (coalesce(new.finalizado_toa, false) is false or new.bloqueado_em is not null) then
      return null;  -- o TOA fechou e ninguém tocou: não conta (095)
    end if;

    v_outros := outros_ativos(new.id);
    if v_outros is null then return null; end if;
    v_n := 1 + array_length(string_to_array(v_outros, ', '), 1);

    v_chave := 'DOIS:' || coalesce(new.tecnico_responsavel_id, new.equipe_id)::text || ':'
               || new.data_agendada || ':'
               || (select string_agg(x, ',' order by x)
                     from unnest(string_to_array(v_outros || ', ' || coalesce(new.contrato, '?'), ', ')) x);

    select coalesce(ts.nome, ta.nome, 'Visita') into v_servico
      from visita vv
      left join tipo_servico ts on ts.id = vv.tipo_servico_id
      left join tipo_atividade ta on ta.id = vv.tipo_atividade_id
     where vv.id = new.id;

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    values (new.empresa_id, v_chave, new.data_agendada, 'DOIS_ATIVOS',
            v_n || ' contratos em andamento: ' || coalesce((select nome from tecnico where id = new.tecnico_responsavel_id),
                                                     'equipe ' || coalesce((select codigo from equipe where id = new.equipe_id), '?')),
            'Contratos ' || coalesce(new.contrato, '?') || ' e ' || v_outros || ' em rota/execução ao mesmo tempo (veio do TOA).',
            new.id, new.tecnico_responsavel_id, new.equipe_id)
    on conflict (empresa_id, chave) do nothing
    returning id into v_sinal;

    -- Só avisa o técnico na PRIMEIRA vez deste conjunto.
    if v_sinal is not null and new.equipe_id is not null then
      insert into aviso (empresa_id, equipe_id, visita_id, tipo, titulo, detalhe, contrato, servico)
      values (new.empresa_id, new.equipe_id, new.id, 'DOIS_ATIVOS',
              'Você tem ' || v_n || ' contratos em andamento',
              'O ' || coalesce(new.contrato, 'contrato') || ' e o ' || v_outros
                || ' estão em rota/execução ao mesmo tempo. Baixe ou mude até ficar um só.',
              new.contrato, v_servico);
    end if;
  exception when others then
    raise warning 'avisa_dois_ativos falhou na visita %: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$;

revoke all on function public.avisa_dois_ativos() from public, anon, authenticated;

drop trigger if exists trg_visita_avisa_dois_ativos on visita;
create trigger trg_visita_avisa_dois_ativos
  after insert or update of situacao on visita
  for each row when (new.situacao in ('EM_DESLOCAMENTO', 'EM_EXECUCAO'))
  execute function avisa_dois_ativos();

-- A central: o sinal aparece para quem vê a equipe, e é vigente enquanto
-- o contrato continuar com outro em andamento. REPLACE na função viva.
do $$
declare d text; d2 text; n int;
  a1 text := $x$when s.tipo in ('AJUDA','TEC1','RITMO','QUEBROU','CERCA','GPS')$x$;
  b1 text := $x$when s.tipo in ('AJUDA','TEC1','RITMO','QUEBROU','CERCA','GPS','DOIS_ATIVOS')$x$;
  a2 text := $x$'vigente', s.chave = any(v_vigentes),$x$;
  b2 text := $x$'vigente', s.chave = any(v_vigentes)
                       or (s.tipo = 'DOIS_ATIVOS' and outros_ativos(s.visita_id) is not null),$x$;
begin
  d := pg_get_functiondef('sinais_do_dia'::regproc);
  if position('DOIS_ATIVOS' in d) > 0 then return; end if;
  foreach d2 in array array[a1, a2] loop
    n := (length(d) - length(replace(d, d2, ''))) / length(d2);
    if n <> 1 then raise exception 'ancora aparece % vezes: %', n, d2; end if;
  end loop;
  execute replace(replace(d, a1, b1), a2, b2);
end $$;

notify pgrst, 'reload schema';
