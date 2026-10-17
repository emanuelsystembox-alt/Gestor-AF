-- ============================================================================
-- 100 · A cidade nasce de uma planilha (D-176)
-- ============================================================================
-- > "preciso que em nosso sistema tenha uma planilha de importação onde
-- >  podemos importar de uma única vez os dados que precisamos para povoar
-- >  o sistema, preciso que a planilha excel seja padrão ou seja, já defina
-- >  o que o usuário pode cadastrar, quero fazer isso em uma cidade […]
-- >  atualize nosso sistema para ter o download da planilha padrão, e para
-- >  importar dados depois que o usuário preencher" — Emanuel, 14/10
--
-- Escolhas do Emanuel (14/10): quatro abas — Áreas, Equipes, Pessoas e
-- Veículos; a cidade já existe como Operação; a senha de cada acesso é
-- gerada pelo servidor e devolvida UMA vez, numa planilha de resultado.
--
-- ┌─ o que esta função faz, e o que ela NÃO faz ─────────────────────┐
-- │ FAZ, numa transação, na ordem em que um depende do outro:         │
-- │   Áreas → Equipes → Técnicos (aba Pessoas, quem tem login TOA) →  │
-- │   rotear o login para a equipe → skill → Veículos → condutor.     │
-- │ NÃO cria acesso (login/senha): isso exige a service_role e mora   │
-- │   na função `admin-usuarios`, a MESMA da tela de hoje. A tela a   │
-- │   chama pessoa a pessoa DEPOIS desta função, e liga o acesso ao   │
-- │   técnico e ao supervisor com as funções que já existem.          │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ a prévia é a importação de verdade, desfeita ───────────────────┐
-- │ `p_simular = true` roda TUDO — inclusive as restrições do banco e │
-- │ as funções reaproveitadas — e no fim levanta uma exceção que      │
-- │ desfaz a transação. As variáveis do plpgsql não são transacionais:│
-- │ o relatório sobrevive ao desfazer. A prévia diz exatamente o que  │
-- │ a importação vai dizer, porque é o mesmo código.                   │
-- └───────────────────────────────────────────────────────────────────┘
--
-- Reimportar a mesma planilha ATUALIZA, não duplica: as chaves são as
-- do banco — área por código, equipe por (cidade, código), técnico por
-- (cidade, login TOA), veículo por placa. Célula vazia NÃO apaga o que já
-- está gravado (vazio é "não sei", não "nada" — regra 6).
--
-- Reaproveita, em vez de copiar regra: `cadastrar_tecnico_avulso`
-- (cria/move o técnico e religa os contratos dele), `cadastrar_login_da_
-- equipe` (roteia o login, com evento), `salvar_veiculo` e
-- `definir_condutor`. A importação antiga de equipes (`importar_equipes`)
-- grava sempre na base MAN (D-141); esta usa a cidade escolhida.
-- ============================================================================

create or replace function importar_cadastro_cidade(p_base uuid, p_dados jsonb,
                                                    p_simular boolean default true)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_emp uuid := minha_empresa();
  v_base_nome text;
  v_rel jsonb := '[]'::jsonb;
  r jsonb;
  v_id uuid; v_outra uuid; v_area uuid; v_eq uuid; v_tec uuid;
  v_cod text; v_txt text; v_login text; v_email text; v_placa text;
  v_acao text; v_aviso text; v_acesso text; v_usuario uuid;
  v_emails text[] := '{}'; v_logins text[] := '{}'; v_placas text[] := '{}';
  v_sup_pessoas text[] := '{}';
  v_x jsonb; v_veic jsonb;
begin
  -- Só ADMIN: a mesma barreira de quem cria acesso (admin-usuarios). Um
  -- lote que cadastra técnico e não consegue criar o login dele seria
  -- meia importação.
  if not tem_papel('ADMIN') then
    raise exception 'Somente ADMIN importa o cadastro de uma cidade.' using errcode = '42501';
  end if;
  select nome into v_base_nome from base
   where id = p_base and empresa_id = v_emp and ativo and id in (select bases_visiveis());
  if v_base_nome is null then
    raise exception 'Operacao (cidade) nao encontrada ou fora do seu acesso.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_dados) is distinct from 'object' then
    raise exception 'Dados da planilha em formato invalido.' using errcode = '22023';
  end if;

  -- Os supervisores que a própria planilha traz (aba Pessoas, perfil
  -- Supervisor): servem para avisar quando uma equipe aponta para um
  -- supervisor que não está em lugar nenhum.
  select coalesce(array_agg(norm_txt(x->>'nome')), '{}') into v_sup_pessoas
    from jsonb_array_elements(coalesce(p_dados->'pessoas', '[]')) x
   where x->>'papel' = 'SUPERVISOR';

  begin  -- ===== o bloco que a prévia desfaz =====

  -- ---------------------------------------------------------------- Áreas
  for r in select * from jsonb_array_elements(coalesce(p_dados->'areas', '[]')) loop
    v_cod := upper(nullif(btrim(r->>'codigo'), ''));
    begin
      if v_cod is null then
        raise exception 'Codigo da area vazio.' using errcode = '23514';
      end if;
      select id, base_id into v_id, v_outra from area_trabalho where codigo = v_cod;
      -- O código de área é único no sistema INTEIRO (não por cidade).
      if v_id is not null and v_outra is distinct from p_base then
        raise exception 'A area % ja existe em outra cidade. Use o prefixo da cidade no codigo (ex.: %-AREA01).',
          v_cod, (select codigo from base where id = p_base) using errcode = '23505';
      end if;
      insert into area_trabalho (codigo, nome, apelido, ativo, empresa_id, base_id)
      values (v_cod, nullif(btrim(r->>'nome'), ''), upper(nullif(btrim(r->>'apelido'), '')),
              true, v_emp, p_base)
      on conflict (codigo) do update
         set nome = coalesce(excluded.nome, area_trabalho.nome),
             apelido = coalesce(excluded.apelido, area_trabalho.apelido),
             ativo = true;
      v_rel := v_rel || jsonb_build_object('aba', 'Áreas', 'linha', r->'linha', 'chave', v_cod,
                                           'acao', case when v_id is null then 'NOVO' else 'ATUALIZA' end);
    exception when others then
      v_rel := v_rel || jsonb_build_object('aba', 'Áreas', 'linha', r->'linha', 'chave', v_cod,
                                           'acao', 'ERRO', 'msg', sqlerrm);
    end;
  end loop;

  -- -------------------------------------------------------------- Equipes
  for r in select * from jsonb_array_elements(coalesce(p_dados->'equipes', '[]')) loop
    v_cod := nullif(btrim(r->>'codigo'), '');
    -- 062: "45" e "045" são a mesma equipe de campo.
    if v_cod ~ '^[0-9]+$' then v_cod := lpad(v_cod, 3, '0'); end if;
    v_aviso := null;
    begin
      if v_cod is null then
        raise exception 'Codigo da equipe vazio.' using errcode = '23514';
      end if;
      if upper(v_cod) = 'SEM-LOGIN' then
        raise exception 'SEM-LOGIN e a equipe abrigo do sistema; use outro codigo.' using errcode = '23514';
      end if;
      if nullif(btrim(r->>'nome'), '') is null then
        raise exception 'Nome da equipe vazio.' using errcode = '23514';
      end if;
      v_area := null;
      v_txt := upper(nullif(btrim(r->>'area'), ''));
      if v_txt is not null then
        select id into v_area from area_trabalho
         where (codigo = v_txt or apelido = v_txt) and (base_id = p_base or base_id is null)
         order by (base_id = p_base) desc nulls last limit 1;
        if v_area is null then
          raise exception 'Area % nao existe nesta cidade. Cadastre na aba Areas.', v_txt using errcode = 'P0002';
        end if;
      end if;
      v_txt := nullif(btrim(r->>'supervisor'), '');
      if v_txt is not null and not norm_txt(v_txt) = any (v_sup_pessoas)
         and not exists (select 1 from perfil pf join usuario_papel up on up.usuario_id = pf.id
                          where pf.empresa_id = v_emp and up.papel = 'SUPERVISOR'
                            and norm_txt(pf.nome) = norm_txt(v_txt)) then
        v_aviso := 'Supervisor "' || v_txt || '" nao esta na aba Pessoas (perfil Supervisor) nem no sistema: a equipe guarda o nome, sem vinculo.';
      end if;

      select id into v_id from equipe where base_id = p_base and codigo = v_cod;
      insert into equipe (empresa_id, base_id, codigo, nome, area_id, supervisor_nome, ativo)
      values (v_emp, p_base, v_cod, btrim(r->>'nome'), v_area, v_txt, true)
      on conflict (base_id, codigo) do update
         set nome = excluded.nome,
             area_id = coalesce(excluded.area_id, equipe.area_id),
             supervisor_nome = coalesce(excluded.supervisor_nome, equipe.supervisor_nome),
             ativo = true;
      v_rel := v_rel || jsonb_build_object('aba', 'Equipes', 'linha', r->'linha', 'chave', v_cod,
                                           'acao', case when v_id is null then 'NOVO' else 'ATUALIZA' end,
                                           'aviso', v_aviso);
    exception when others then
      v_rel := v_rel || jsonb_build_object('aba', 'Equipes', 'linha', r->'linha', 'chave', v_cod,
                                           'acao', 'ERRO', 'msg', sqlerrm);
    end;
  end loop;

  -- -------------------------------------------------------------- Pessoas
  for r in select * from jsonb_array_elements(coalesce(p_dados->'pessoas', '[]')) loop
    v_login := upper(nullif(btrim(r->>'login_toa'), ''));
    v_email := lower(nullif(btrim(r->>'email'), ''));
    v_aviso := null; v_acesso := null; v_usuario := null; v_acao := null;
    begin
      if nullif(btrim(r->>'nome'), '') is null then
        raise exception 'Nome vazio.' using errcode = '23514';
      end if;

      -- o ACESSO (quem cria é a tela, depois): só se diz o que vai acontecer
      if v_email is not null then
        if v_email = any (v_emails) then
          raise exception 'E-mail % repetido na planilha.', v_email using errcode = '23505';
        end if;
        v_emails := v_emails || v_email;
        select id into v_usuario from perfil where lower(email) = v_email;
        if v_usuario is not null then
          if not exists (select 1 from perfil where id = v_usuario and empresa_id = v_emp) then
            raise exception 'O e-mail % ja e usado por outra empresa.', v_email using errcode = '23505';
          end if;
          v_acesso := 'JA_EXISTE';
        elsif coalesce(r->>'criar_acesso', 'SIM') = 'NAO' then
          v_acesso := 'NAO';
        else
          v_acesso := 'CRIAR';
        end if;
      else
        v_acesso := 'SEM_EMAIL';
      end if;

      -- o TÉCNICO: só quem tem login TOA
      if v_login is not null then
        if v_login = any (v_logins) then
          raise exception 'Login TOA % repetido na planilha.', v_login using errcode = '23505';
        end if;
        v_logins := v_logins || v_login;

        v_eq := null;
        v_cod := nullif(btrim(r->>'equipe'), '');
        if v_cod ~ '^[0-9]+$' then v_cod := lpad(v_cod, 3, '0'); end if;
        if v_cod is not null then
          select id into v_eq from equipe where base_id = p_base and codigo = v_cod;
          if v_eq is null then
            raise exception 'Equipe % nao existe nesta cidade. Cadastre na aba Equipes.', v_cod using errcode = 'P0002';
          end if;
        end if;

        v_txt := nullif(btrim(r->>'skill'), '');
        if v_txt is not null and not exists (select 1 from skill where empresa_id = v_emp and nome = v_txt and ativo) then
          raise exception 'Skill "%" nao existe no cadastro.', v_txt using errcode = 'P0002';
        end if;

        -- Um técnico tem UM acesso (vincular_tecnico_ao_usuario recusaria
        -- depois, com a conta já criada).
        select usuario_id into v_outra from tecnico where base_id = p_base and matricula = v_login;
        if v_outra is not null and v_outra is distinct from v_usuario then
          raise exception 'O tecnico % ja esta ligado ao acesso de %.', v_login,
            coalesce((select nome from perfil where id = v_outra), 'outra pessoa') using errcode = '23505';
        end if;
        if exists (select 1 from tecnico where matricula = v_login and base_id <> p_base and empresa_id = v_emp) then
          v_aviso := 'O login ' || v_login || ' tambem existe em outra cidade.';
        end if;

        v_acao := case when exists (select 1 from tecnico where base_id = p_base and matricula = v_login)
                       then 'ATUALIZA' else 'NOVO' end;
        v_x := cadastrar_tecnico_avulso(v_login, btrim(r->>'nome'), v_eq, case when v_eq is null then p_base end);
        v_tec := (v_x->>'tecnico_id')::uuid;

        if v_txt is not null then
          update tecnico set skill = v_txt where id = v_tec;
          if not exists (select 1 from faixa_comissao f where f.skill = v_txt and f.ativo) then
            v_aviso := concat_ws(' ', v_aviso, 'A skill ' || v_txt || ' ainda nao tem faixa de comissao: a receber fica R$ 0 ate cadastrar.');
          end if;
        end if;

        -- Rotear o login para a equipe (padrão SIM, como na tela). É o
        -- cadastro DECLARADO por quem importa — autor carimbado (D-088).
        if v_eq is not null and coalesce(r->>'rotear', 'SIM') <> 'NAO' then
          v_x := cadastrar_login_da_equipe(v_eq, v_login);
          if coalesce((v_x->>'contratos_movidos')::int, 0) > 0 then
            v_aviso := concat_ws(' ', v_aviso, (v_x->>'contratos_movidos') || ' contrato(s) ja importado(s) vao para a equipe ' || v_cod || '.');
          end if;
        end if;
      else
        if nullif(btrim(r->>'equipe'), '') is not null or nullif(btrim(r->>'skill'), '') is not null then
          v_aviso := 'Equipe e skill precisam do login TOA: ignoradas nesta linha.';
        end if;
        v_acao := 'SEM_TECNICO';
      end if;

      if v_acesso = 'JA_EXISTE' then
        v_aviso := concat_ws(' ', v_aviso, 'Este e-mail ja tem acesso: o acesso nao e alterado.');
      end if;

      v_rel := v_rel || jsonb_build_object('aba', 'Pessoas', 'linha', r->'linha',
                                           'chave', coalesce(v_login, v_email, btrim(r->>'nome')),
                                           'acao', v_acao, 'acesso', v_acesso,
                                           'usuario_id', v_usuario, 'aviso', v_aviso);
    exception when others then
      v_rel := v_rel || jsonb_build_object('aba', 'Pessoas', 'linha', r->'linha',
                                           'chave', coalesce(v_login, v_email, btrim(r->>'nome')),
                                           'acao', 'ERRO', 'acesso', v_acesso, 'msg', sqlerrm);
    end;
  end loop;

  -- ------------------------------------------------------------- Veículos
  for r in select * from jsonb_array_elements(coalesce(p_dados->'veiculos', '[]')) loop
    v_placa := norm_placa(r->>'placa');
    v_aviso := null;
    begin
      if v_placa is null or length(v_placa) < 7 then
        raise exception 'Placa invalida: %.', coalesce(r->>'placa', '(vazia)') using errcode = '23514';
      end if;
      if v_placa = any (v_placas) then
        raise exception 'Placa % repetida na planilha.', v_placa using errcode = '23505';
      end if;
      v_placas := v_placas || v_placa;

      select id, to_jsonb(v) into v_id, v_veic from veiculo v
       where v.empresa_id = v_emp and v.placa = v_placa;
      if v_id is not null and (v_veic->>'arquivado_em') is not null then
        raise exception 'O veiculo % esta arquivado. Reative pela Frota antes.', v_placa using errcode = '23514';
      end if;

      -- Célula vazia não apaga o que está gravado: o que existe, por cima
      -- o que a planilha trouxe preenchido.
      v_x := coalesce(v_veic, '{}'::jsonb)
             || jsonb_strip_nulls(jsonb_build_object(
                  'placa', v_placa, 'base_id', p_base,
                  'apelido', nullif(btrim(r->>'apelido'), ''), 'modelo', nullif(btrim(r->>'modelo'), ''),
                  'tipo', nullif(r->>'tipo', ''), 'ano', nullif(r->>'ano', ''),
                  'chassi', nullif(btrim(r->>'chassi'), ''), 'renavam', nullif(btrim(r->>'renavam'), ''),
                  'propriedade', nullif(r->>'propriedade', ''), 'pernoite', nullif(r->>'pernoite', ''),
                  'rastreador', nullif(btrim(r->>'rastreador'), ''),
                  'hodometro_cadastro', nullif(r->>'hodometro', ''),
                  'observacao', nullif(btrim(r->>'observacao'), '')));
      v_id := salvar_veiculo(v_id, v_x);

      v_login := upper(nullif(btrim(r->>'condutor'), ''));
      if v_login is not null then
        select id into v_tec from tecnico where base_id = p_base and matricula = v_login;
        if v_tec is null then
          raise exception 'Condutor % nao e tecnico desta cidade. Cadastre na aba Pessoas (com login TOA).', v_login
            using errcode = 'P0002';
        end if;
        perform definir_condutor(v_id, v_tec);
      end if;

      v_rel := v_rel || jsonb_build_object('aba', 'Veículos', 'linha', r->'linha', 'chave', v_placa,
                                           'acao', case when v_veic is null then 'NOVO' else 'ATUALIZA' end,
                                           'aviso', v_aviso);
    exception when others then
      v_rel := v_rel || jsonb_build_object('aba', 'Veículos', 'linha', r->'linha', 'chave', v_placa,
                                           'acao', 'ERRO', 'msg', sqlerrm);
    end;
  end loop;

  if p_simular then
    raise exception '__PREVIA_DESFEITA__' using errcode = 'P0001';
  end if;

  exception when sqlstate 'P0001' then
    if sqlerrm <> '__PREVIA_DESFEITA__' then raise; end if;
  end;  -- ===== fim do bloco =====

  return jsonb_build_object(
    'simulado', p_simular,
    'cidade', v_base_nome,
    'linhas', v_rel,
    'erros', (select count(*) from jsonb_array_elements(v_rel) x where x->>'acao' = 'ERRO'));
end;
$fn$;
revoke all on function importar_cadastro_cidade(uuid, jsonb, boolean) from public, anon;
grant execute on function importar_cadastro_cidade(uuid, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
