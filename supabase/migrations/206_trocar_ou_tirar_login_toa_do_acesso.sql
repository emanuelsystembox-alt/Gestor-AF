-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 206 — Trocar ou tirar o login TOA de um acesso, numa porta só (D-301)│
-- │                                                                      │
-- │ "eu quero da o pedro outro login pra ele usar como técnico porém     │
-- │  sistema não ta deixando editar (...) eu salvo outro login ele acaba │
-- │  puxando o antigo, a mesma coisa também eu tiro de um técnico pra    │
-- │  ele ficar sem e não apaga" — Emanuel, 04/11.                        │
-- │                                                                      │
-- │ Os dois defeitos do Editar (EditarUsuarioModal):                     │
-- │  1. TROCAR: a tela chamava `cadastrar_tecnico_avulso` ANTES de        │
-- │     `vincular_tecnico_ao_usuario`. O primeiro faz upsert pela        │
-- │     matrícula e regrava NOME e EQUIPE — então, com um login que é de │
-- │     outra pessoa, ele renomeou o técnico DELA; o segundo recusava    │
-- │     ("já vinculado ao acesso de ...") e o acesso ficava no login     │
-- │     antigo. Em 04/11, 15:45: Z476988, do Thiago Menezes de Souza,    │
-- │     virou "pedro campos de oliveira" na equipe SUP-PEDRO. Nenhum     │
-- │     contrato mudou de equipe (os 6 de hoje estavam em SEM-LOGIN).    │
-- │  2. TIRAR: com o campo vazio a tela não chamava nada (`if (login)`). │
-- │     Não existia função para soltar o técnico de um acesso.           │
-- │                                                                      │
-- │ `definir_login_toa_do_usuario` confere o dono ANTES de gravar, faz o │
-- │ upsert e o vínculo na mesma transação, e com login vazio solta.      │
-- │ Supervisor em campo (D-300): a chave é desligada e religada em volta │
-- │ da troca, para o roteamento seguir o login novo e o velho parar.     │
-- │ O roteamento de um login (`equipe_login_toa`) é do LOGIN, não da     │
-- │ pessoa: tirar o login de um acesso não desliga a rota dele.          │
-- │                                                                      │
-- │ E o passado tem dono: "o espelhamento da rota é so pra hoje, não é   │
-- │ para mudar os donos das baixas de dias anteriores" (Emanuel, 04/11). │
-- │  · O `tecnico` aqui É o login do TOA. Passar Z476988 do Thiago ao    │
-- │    Pedro no MESMO registro poria o nome do Pedro nas 10 baixas que o │
-- │    Thiago fez com ele antes de hoje. Então, se o registro tem        │
-- │    contrato de dia anterior com OUTRO nome, ele é APOSENTADO         │
-- │    (matrícula vira "Z476988-ATE-031126", DESLIGADO, fica com o       │
-- │    histórico) e nasce um registro novo para quem recebe. Só os       │
-- │    contratos de HOJE em diante passam para o novo.                   │
-- │  · `cadastrar_login_da_equipe` passa a valer de hoje (antes: desde a │
-- │    primeira visita do login, levando o histórico para a equipe).     │
-- │  · `cadastrar_tecnico_avulso` religa só contrato de hoje em diante.  │
-- └──────────────────────────────────────────────────────────────────────┘

-- ── as duas funções do roteamento, regeradas do BANCO ──
CREATE OR REPLACE FUNCTION public.cadastrar_login_da_equipe(p_equipe uuid, p_login text, p_desde date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cod text; v_base uuid; v_desde date; n int;
begin
  if not (select eh_gestor()) then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  if not tem_permissao('equipes.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar equipe e tecnico".'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_login,'')),'') is null then
    raise exception 'Informe o login.' using errcode = '23514';
  end if;

  select codigo, base_id into v_cod, v_base from equipe
   where id = p_equipe and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis());
  if v_cod is null then
    raise exception 'Equipe nao encontrada.' using errcode = 'P0002';
  end if;
  if v_cod = 'SEM-LOGIN' then
    raise exception 'A equipe abrigo nao recebe cadastro de login.'
      using errcode = '23514';
  end if;

  -- 206 (D-301): vale de HOJE em diante, salvo quem pedir outra data.
  -- "o espelhamento da rota é so pra hoje, não é para mudar os donos das
  -- baixas de dias anteriores" (Emanuel, 04/11). Até aqui valia desde a
  -- primeira visita do login e levava o histórico junto.
  v_desde := coalesce(p_desde, hoje_local());

  -- Um login nao pode estar aberto em duas equipes: fecha o anterior.
  update equipe_login_toa set fim = greatest(v_desde - 1, inicio)
   where norm_txt(login_toa) = norm_txt(p_login) and fim is null
     and equipe_id <> p_equipe;
  update equipe set login_toa = null
   where base_id = v_base and norm_txt(login_toa) = norm_txt(p_login)
     and id <> p_equipe;

  update equipe set login_toa = btrim(p_login) where id = p_equipe;

  insert into equipe_login_toa (equipe_id, login_toa, inicio, criado_por)
  select p_equipe, btrim(p_login), v_desde, auth.uid()
   where not exists (select 1 from equipe_login_toa
                      where equipe_id = p_equipe
                        and norm_txt(login_toa) = norm_txt(p_login)
                        and fim is null);

  -- E leva os contratos daquele login para a equipe, com evento.
  insert into visita_evento (visita_id, tipo, de, para, origem,
                             usuario_id, login, observacao)
  select v.id, 'TRANSFERENCIA',
         jsonb_build_object('equipe', (select codigo from equipe where id = v.equipe_id)),
         jsonb_build_object('equipe', v_cod),
         'WEB', auth.uid(), btrim(p_login),
         'Login cadastrado na equipe'
    from visita v
   where v.base_id = v_base and v.excluido_em is null
     and norm_txt(v.dados_origem->>'Login do Técnico') = norm_txt(p_login)
     and v.data_agendada >= v_desde
     and v.rota_fixada_em is null
     and v.equipe_id is distinct from p_equipe;

  update visita v set equipe_id = p_equipe
   where v.base_id = v_base and v.excluido_em is null
     and norm_txt(v.dados_origem->>'Login do Técnico') = norm_txt(p_login)
     and v.data_agendada >= v_desde
     and v.rota_fixada_em is null
     and v.equipe_id is distinct from p_equipe;
  get diagnostics n = row_count;

  return jsonb_build_object('equipe', v_cod, 'login', btrim(p_login),
                            'desde', v_desde, 'contratos_movidos', n);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cadastrar_tecnico_avulso(p_matricula text, p_nome text, p_equipe_id uuid DEFAULT NULL::uuid, p_base_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp uuid; v_base uuid; v_base_eq uuid; v_tec uuid; n int;
begin
  if not ((select eh_gestor()) or (eh_gestao() and (tem_permissao('equipes.editar') or tem_permissao('admin.usuarios')))) then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  v_emp := minha_empresa();

  if p_equipe_id is not null then
    select base_id into v_base_eq from equipe
     where id = p_equipe_id and empresa_id = v_emp;
    if v_base_eq is null then
      raise exception 'Equipe nao encontrada nesta empresa.' using errcode = 'P0002';
    end if;
    if p_base_id is not null and p_base_id <> v_base_eq then
      raise exception
        'A operacao escolhida nao e a da equipe. Escolha uma equipe da mesma operacao.'
        using errcode = '23514';
    end if;
    v_base := v_base_eq;

  elsif p_base_id is not null then
    select id into v_base from base
     where id = p_base_id and empresa_id = v_emp and id in (select bases_visiveis());
    if v_base is null then
      raise exception 'Operacao nao encontrada ou fora do seu acesso.' using errcode = 'P0002';
    end if;

  else
    select id into v_base from base
     where empresa_id = v_emp and id in (select bases_visiveis()) limit 1;
  end if;

  insert into tecnico (empresa_id, base_id, matricula, nome, equipe_id)
  values (v_emp, v_base, upper(btrim(p_matricula)),
          coalesce(nullif(btrim(p_nome), ''), upper(btrim(p_matricula))), p_equipe_id)
  on conflict (base_id, matricula) do update
    set nome = excluded.nome,
        equipe_id = coalesce(excluded.equipe_id, tecnico.equipe_id)
  returning id into v_tec;

  update visita v
     set tecnico_responsavel_id = v_tec,
         equipe_id = coalesce(p_equipe_id, v.equipe_id)
   where v.base_id = v_base
     and v.rota_fixada_em is null
     and v.tecnico_responsavel_id is null
     and norm_txt(v.dados_origem ->> 'Login do Técnico') = norm_txt(p_matricula)
     -- 206 (D-301): só o dia de hoje em diante; o passado tem dono
     and v.data_agendada >= hoje_local();
  get diagnostics n = row_count;

  return jsonb_build_object(
    'tecnico_id', v_tec, 'visitas_religadas', n,
    'base', (select nome from base where id = v_base));
end;
$function$;


create or replace function public.definir_login_toa_do_usuario(
  p_usuario uuid, p_login text, p_equipe_id uuid default null, p_base_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_login text := upper(nullif(btrim(coalesce(p_login, '')), ''));
  v_nome text; v_base uuid; v_atual text; v_dono uuid; v_dono_nome text;
  v_em_campo boolean; v_tec uuid; n int;
  v_velho uuid; v_velho_nome text; v_velho_hist uuid; v_aposentado boolean := false;
begin
  if not (eh_gestao() and tem_permissao('admin.usuarios')) then
    raise exception 'Seu perfil de acesso nao inclui "Gerenciar usuarios".' using errcode = '42501';
  end if;

  select p.nome, p.base_id, t.matricula into v_nome, v_base, v_atual
    from perfil p left join tecnico t on t.id = p.tecnico_id
   where p.id = p_usuario and p.empresa_id = minha_empresa();
  if not found then
    raise exception 'Usuario nao encontrado nesta empresa.' using errcode = 'P0002';
  end if;

  -- o supervisor em campo (D-300): a chave volta depois da troca
  v_em_campo := exists (select 1 from usuario_papel where usuario_id = p_usuario and papel = 'TECNICO')
            and exists (select 1 from usuario_papel where usuario_id = p_usuario and papel = 'SUPERVISOR')
            and exists (select 1 from tecnico t join equipe e on e.id = t.equipe_id
                         where t.usuario_id = p_usuario and e.supervisor_id = p_usuario);

  -- ── TIRAR ──
  if v_login is null then
    if v_em_campo then perform supervisor_em_campo(p_usuario, false); end if;
    update tecnico set usuario_id = null where usuario_id = p_usuario;
    update perfil set tecnico_id = null where id = p_usuario;
    return jsonb_build_object('acao', 'tirado', 'login_anterior', v_atual);
  end if;

  if v_login = upper(coalesce(v_atual, '')) then
    return jsonb_build_object('acao', 'igual', 'login', v_login);
  end if;

  -- ── TROCAR: o dono do login novo, ANTES de gravar qualquer coisa ──
  v_base := coalesce((select base_id from equipe where id = p_equipe_id and empresa_id = minha_empresa()),
                     p_base_id, v_base);
  select t.usuario_id into v_dono from tecnico t
   where t.empresa_id = minha_empresa() and t.base_id = v_base
     and norm_txt(t.matricula) = norm_txt(v_login);
  if v_dono is not null and v_dono <> p_usuario then
    select nome into v_dono_nome from perfil where id = v_dono;
    raise exception 'O login % e do acesso de %. Tire o login dele primeiro (Editar % › apague o Login TOA › Salvar).',
      v_login, coalesce(v_dono_nome, 'outra pessoa'), coalesce(v_dono_nome, 'dele')
      using errcode = '23505';
  end if;

  if v_em_campo then perform supervisor_em_campo(p_usuario, false); end if;

  select t.id, t.nome into v_velho, v_velho_nome from tecnico t
   where t.empresa_id = minha_empresa() and t.base_id = v_base
     and norm_txt(t.matricula) = norm_txt(v_login);

  -- O passado tem dono: registro com contrato de dia anterior e OUTRO nome
  -- é aposentado com o histórico, e quem recebe ganha registro novo.
  if v_velho is not null and norm_txt(v_velho_nome) <> norm_txt(v_nome)
     and exists (select 1 from visita v where v.tecnico_responsavel_id = v_velho
                  and v.data_agendada < hoje_local()) then
    update tecnico
       set matricula = matricula || '-ATE-' || to_char(hoje_local() - 1, 'DDMMYY'),
           usuario_id = null, situacao = 'DESLIGADO', situacao_em = now(), situacao_por = auth.uid()
     where id = v_velho;
    v_aposentado := true;
    v_velho_hist := v_velho;
    v_velho := null;
  end if;

  -- o acesso responde por um técnico só: solta o anterior
  update tecnico set usuario_id = null where usuario_id = p_usuario and id is distinct from v_velho;

  if v_velho is null then
    insert into tecnico (empresa_id, base_id, matricula, nome, equipe_id, usuario_id)
    values (minha_empresa(), v_base, v_login, v_nome, p_equipe_id, p_usuario)
    returning id into v_tec;
  else
    update tecnico set nome = v_nome, equipe_id = coalesce(p_equipe_id, equipe_id),
                       usuario_id = p_usuario, situacao = 'ATIVO'
     where id = v_velho;
    v_tec := v_velho;
  end if;
  update perfil set tecnico_id = v_tec where id = p_usuario;

  -- Só HOJE em diante muda de dono: os contratos de hoje do registro
  -- aposentado, e os do login que ainda estão sem técnico.
  update visita v set tecnico_responsavel_id = v_tec
   where v.base_id = v_base and v.excluido_em is null and v.data_agendada >= hoje_local()
     and (v.tecnico_responsavel_id = v_velho_hist
          or (v.tecnico_responsavel_id is null
              and norm_txt(v.dados_origem ->> 'Login do Técnico') = norm_txt(v_login)));
  get diagnostics n = row_count;

  if v_em_campo then perform supervisor_em_campo(p_usuario, true); end if;

  return jsonb_build_object('acao', 'trocado', 'login', v_login, 'login_anterior', v_atual,
                            'em_campo', v_em_campo, 'aposentado', v_aposentado,
                            'contratos_de_hoje', n);
end;
$function$;

revoke all on function public.definir_login_toa_do_usuario(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.definir_login_toa_do_usuario(uuid, text, uuid, uuid) to authenticated;

-- ── O estrago de 04/11, 15:45 ──────────────────────────────────────────
-- O técnico Z476988 (ligado ao acesso do Thiago) volta ao nome dele e à
-- equipe 105: 12 dos 18 contratos dele são da 105, o roteamento do login
-- foi 105 até 03/11, e a lista mostrava o supervisor PEDRO CAMPOS (o da
-- 105). Só se ainda estiver como o defeito deixou.
update public.tecnico t
   set nome = p.nome,
       equipe_id = (select id from public.equipe where base_id = t.base_id and codigo = '105')
  from public.perfil p
 where t.id = 'a35de400-ade5-40ed-988e-d8f663c60731'
   and p.id = t.usuario_id
   and t.nome = 'pedro campos de oliveira';

select t.matricula, t.nome, e.codigo from public.tecnico t left join public.equipe e on e.id = t.equipe_id
 where t.id = 'a35de400-ade5-40ed-988e-d8f663c60731';
