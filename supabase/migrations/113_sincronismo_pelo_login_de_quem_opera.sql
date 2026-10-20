-- ┌─ 113 · o sincronismo roda com o login de quem opera ───────────────┐
-- │ > "não vejo nessecidade disso, pra mim qual quer um que configurar │
-- │ >  sua maquina, vai conseguir importar com seu login entende?      │
-- │ >  precisa corrigir isso." — Emanuel, 19/10, sobre o usuário       │
-- │ >  "Robô de sincronismo" da 110–112.                               │
-- │                                                                    │
-- │ Quem pode importar à mão (gestão e controlador) pode sincronizar   │
-- │ pelo próprio computador, com o próprio login. A importação entra   │
-- │ em nome de quem sincronizou. O papel ROBO continua valendo, mas    │
-- │ deixou de ser obrigatório.                                         │
-- │                                                                    │
-- │ O risco novo: dois computadores sincronizando ao mesmo tempo       │
-- │ importariam tudo em dobro. Por isso a VEZ é do servidor:           │
-- │  · um computador por cidade (`sincronismo.executor_id`);           │
-- │  · quem pulsa enquanto outro está vivo (pulso há menos de 3 min)   │
-- │    recebe "Fulano está sincronizando" e NÃO roda nada;             │
-- │  · se o dono da vez some por 3 min, o próximo que pulsar assume —  │
-- │    é o que deixa um segundo PC servir de reserva;                  │
-- │  · ASSUMIR toma a vez na mão; SOLTAR devolve.                      │
-- │ Ver D-189 (revisão de 19/10).                                      │
-- └────────────────────────────────────────────────────────────────────┘

-- A assinatura muda (p_modo). Duas versões com default deixariam a chamada
-- ambígua para o PostgREST (traps.md): a antiga sai.
drop function if exists public.sincronismo_pulso(uuid, text, text);

create or replace function public.sincronismo_pulso(
  p_base uuid, p_info text default null, p_toa_sessao text default null,
  p_modo text default 'PULSO')
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  s sincronismo;
  v_eu   uuid := auth.uid();
  v_hoje date := hoje_local();
  v_modo text := upper(coalesce(p_modo, 'PULSO'));
begin
  -- A mesma porta de quem importa à mão, mais o ROBO (opcional desde a 113).
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('ROBO')) then
    raise exception 'Sem permissao para sincronizar.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_visiveis()) then
    raise exception 'Esta cidade nao e a cidade ativa da sua tela.' using errcode = '42501';
  end if;
  if v_modo not in ('PULSO', 'ASSUMIR', 'SOLTAR') then
    raise exception 'Modo invalido.';
  end if;
  if p_toa_sessao is not null and p_toa_sessao not in ('OK', 'CAIU') then
    raise exception 'Estado de sessao invalido.';
  end if;

  insert into sincronismo (base_id, empresa_id)
  select b.id, b.empresa_id from base b where b.id = p_base
  on conflict (base_id) do nothing;

  -- Trava a linha: dois PCs pulsando no mesmo instante não ficam os dois
  -- com a vez.
  select * into s from sincronismo where base_id = p_base for update;

  if v_modo = 'SOLTAR' then
    if s.executor_id = v_eu then
      update sincronismo set executor_id = null, executor_visto_em = null, executor_info = null
       where base_id = p_base;
    end if;
    return jsonb_build_object('soltou', true);
  end if;

  -- A vez é de outro, e ele está vivo: este computador espera.
  if s.executor_id is not null and s.executor_id <> v_eu
     and s.executor_visto_em > now() - interval '3 minutes'
     and v_modo <> 'ASSUMIR' then
    return jsonb_build_object(
      'ligado', s.ligado, 'intervalo_min', s.intervalo_min, 'hoje', v_hoje, 'agora', now(),
      'outro', jsonb_build_object('nome', (select p.nome from perfil p where p.id = s.executor_id),
                                  'visto_em', s.executor_visto_em),
      'buckets', '[]'::jsonb);
  end if;

  update sincronismo
     set executor_id = v_eu, executor_visto_em = now(),
         executor_info = left(p_info, 300),
         toa_sessao = coalesce(p_toa_sessao, toa_sessao),
         toa_sessao_em = case when p_toa_sessao is null then toa_sessao_em else now() end
   where base_id = p_base
  returning * into s;

  return jsonb_build_object(
    'ligado', s.ligado, 'intervalo_min', s.intervalo_min, 'hoje', v_hoje, 'agora', now(),
    'outro', null,
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'nome', t.nome, 'numero_toa', t.numero_toa,
               -- vencido: a última tentativa foi há um intervalo ou mais
               -- (30 s de folga para o pulso de 60 s não escorregar um minuto
               -- por rodada)
               'vencido', u.em is null
                          or now() - u.em >= make_interval(mins => s.intervalo_min) - interval '30 seconds',
               -- a impressão da última importação DE HOJE: arquivo igual não
               -- reimporta — a menos que faça 1 hora, para código cadastrado
               -- depois (D-185) e reconciliação acabarem valendo.
               'impressao', case when imp.em > now() - interval '60 minutes' then imp.impressao end
             ) order by t.nome)
        from toa_bucket t
        left join lateral (
          select max(r.terminada_em) as em from sincronismo_rodada r
           where r.bucket_id = t.id and r.dia = v_hoje) u on true
        left join lateral (
          select r.impressao, r.terminada_em as em from sincronismo_rodada r
           where r.bucket_id = t.id and r.dia = v_hoje and r.resultado = 'IMPORTADA'
           order by r.terminada_em desc limit 1) imp on true
       where t.base_id = p_base and t.ativo and t.sincronizar and t.numero_toa is not null
    ), '[]'::jsonb));
end;
$function$;

revoke all on function public.sincronismo_pulso(uuid, text, text, text) from public, anon;
grant execute on function public.sincronismo_pulso(uuid, text, text, text) to authenticated;

-- A rodada: a mesma porta. Continua exigindo que a importação seja de
-- quem registra (`usuario_id = auth.uid()`).
do $do$
declare
  v_def text; v_n int;
  v_de   constant text := 'if not tem_papel(''ROBO'') then
    raise exception ''So o usuario do robo de sincronismo registra rodada.'' using errcode = ''42501'';';
  v_para constant text := 'if not (eh_gestor() or tem_papel(''CONTROLADOR'') or tem_papel(''ROBO'')) then
    raise exception ''Sem permissao para sincronizar.'' using errcode = ''42501'';';
begin
  v_def := pg_get_functiondef('public.sincronismo_registrar_rodada(uuid,uuid,date,timestamptz,text,text,uuid,text,integer)'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_n <> 1 then raise exception 'registrar_rodada: esperava 1 trecho, achei %', v_n; end if;
  execute replace(v_def, v_de, v_para);
end
$do$;

-- A bateria: o controlador agora PODE pulsar — o cenário "CONTROLADOR se
-- passa pelo robo" deixou de ser verdade. Quem não pode é o supervisor
-- (não importa à mão). O cenário muda de dono; o total segue 26.
do $do$
declare
  v_def text;
  v_ctrl constant text := '  begin
    perform sincronismo_pulso(v_base, ''teste'', null);
    return query select ''CONTROLADOR se passa pelo robo''::text,''barrado''::text,''*** PASSOU ***''::text,false;
  exception when others then
    return query select ''CONTROLADOR se passa pelo robo''::text,''barrado''::text,''barrado''::text,true;
  end;

';
  v_ancora constant text := '  -- ============ ROBO (111) ============';
  v_sup constant text := '  -- 113: sincronizar e a porta de quem importa; o supervisor nao importa.
  begin
    perform sincronismo_pulso(v_base, ''teste'', null);
    return query select ''SUPERVISOR sincroniza pelo computador dele''::text,''barrado''::text,''*** PASSOU ***''::text,false;
  exception when others then
    return query select ''SUPERVISOR sincroniza pelo computador dele''::text,''barrado''::text,''barrado''::text,true;
  end;

';
begin
  v_def := pg_get_functiondef('public.testar_policies()'::regprocedure);
  if position(v_ctrl in v_def) = 0 then raise exception 'testar_policies: bloco do CONTROLADOR nao encontrado'; end if;
  if position(v_ancora in v_def) = 0 then raise exception 'testar_policies: ancora ROBO nao encontrada'; end if;
  v_def := replace(v_def, v_ctrl, '');
  v_def := replace(v_def, v_ancora, v_sup || v_ancora);
  execute v_def;
end
$do$;

-- O perfil "Robo de sincronismo" (112) fica, como opção: quem quiser um PC
-- dedicado sem login de pessoa ainda pode. A descrição deixa isso claro.
update perfil_acesso
   set descricao = 'Opcional: um login so para um PC dedicado ao sincronismo. So importa; nao ve nem mexe em contrato.'
 where papel = 'ROBO';

notify pgrst, 'reload schema';
