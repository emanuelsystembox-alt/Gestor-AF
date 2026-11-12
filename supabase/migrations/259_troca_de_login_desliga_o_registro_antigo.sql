-- 259 · Trocar o login TOA do acesso desliga o registro antigo da pessoa (D-373)
--
-- > "por que tem dois logins? o correto é esse marcado no cadastro do nosso sistema"
-- > ... "pode fazer" — Emanuel, 12/11
--
-- A matrícula do técnico É o login do TOA, então login novo = registro de técnico novo.
-- `definir_login_toa_do_usuario` (206, D-301) soltava o registro anterior do acesso
-- (`usuario_id = null`) mas o deixava ATIVO: a mesma pessoa aparecia duas vezes nas listas
-- (supervisor, transferência). Foi o ELIECER (Z124567 em 03/11 → Z702775 em 09/11, pela
-- tela) e o Marcos de São Luís (Z000000 → Z013453 → Z124521). Os três foram desligados à
-- mão em 12/11.
--
-- Agora o registro que o acesso deixa vira DESLIGADO na mesma troca. Não apaga nada e não
-- move contrato: o histórico continua no registro antigo (D-090, D-301). Quem voltar a um
-- login antigo tem o registro dele reativado pelo ramo que já existia. "Tirar o login"
-- (sem login novo) não desliga ninguém: a pessoa pode continuar no TOA sem acesso.
--
-- Função lida do BANCO (pg_get_functiondef), não do arquivo da 206.

CREATE OR REPLACE FUNCTION public.definir_login_toa_do_usuario(p_usuario uuid, p_login text, p_equipe_id uuid DEFAULT NULL::uuid, p_base_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_login text := upper(nullif(btrim(coalesce(p_login, '')), ''));
  v_nome text; v_base uuid; v_atual text; v_dono uuid; v_dono_nome text;
  v_em_campo boolean; v_tec uuid; n int;
  v_velho uuid; v_velho_nome text; v_velho_hist uuid; v_aposentado boolean := false;
  v_desligados int := 0;
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

  -- o acesso responde por um técnico só: solta o anterior.
  -- 259 (D-373): e o DESLIGA — é a mesma pessoa com o login antigo. Ativo, ele aparecia
  -- em dobro nas listas (ELIECER Z124567 + Z702775). Fica o histórico; reativa pela tela,
  -- ou sozinho se a pessoa voltar a esse login (o ramo `v_velho` abaixo põe ATIVO).
  update tecnico
     set usuario_id = null,
         situacao = 'DESLIGADO', situacao_em = now(), situacao_por = auth.uid()
   where usuario_id = p_usuario and id is distinct from v_velho and situacao <> 'DESLIGADO';
  get diagnostics v_desligados = row_count;
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
                            'desligado_anterior', v_desligados,
                            'contratos_de_hoje', n);
end;
$function$;

notify pgrst, 'reload schema';
