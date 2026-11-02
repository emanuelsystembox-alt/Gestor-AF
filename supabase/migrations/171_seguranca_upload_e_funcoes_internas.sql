-- ┌─ 171 · auditoria de segurança de 02/11: dois reforços no banco (D-258) ┐
-- │ > "agora atua na parte de segurança de nosso sistema, tanto app      │
-- │ >  como site, vamos fechar as brechas e reforçar" — Emanuel, 02/11   │
-- │                                                                       │
-- │ A. SUBIR arquivo de evidência passa a exigir o mesmo que REGISTRAR.  │
-- │    A policy `evidencia_arquivo_enviar` (055-C) só pedia que o        │
-- │    contrato fosse visível; as travas do campo (permissão "Anexar",   │
-- │    "o campo só anexa no dia") moravam só em `registrar_evidencia`.   │
-- │    Um técnico (ou um login roubado) podia subir até 50 MB por        │
-- │    arquivo, sem limite de quantidade, em contrato antigo, sem linha  │
-- │    — arquivo que só a limpeza acha, ocupando o disco da VPS (o mesmo │
-- │    disco do banco e do n8n). Agora a policy chama                    │
-- │    `pode_anexar_na_visita(…, true)`, a MESMA regra do registro: o    │
-- │    que sobe é exatamente o que poderia ser registrado. A função      │
-- │    recusa com erro (vira negação da policy) e devolve a data quando  │
-- │    pode — por isso `is not null`.                                    │
-- │                                                                       │
-- │ B. Funções internas deixam de ser chamáveis pela API. As 8 de        │
-- │    gatilho (o Postgres não as deixa rodar fora do gatilho, então era │
-- │    higiene) e `extrair_produtos`, que só a importação chama          │
-- │    (`importar_toa_interno`, como dona) — pela API, qualquer logado   │
-- │    reprocessava os produtos de qualquer contrato de qualquer         │
-- │    empresa (inofensivo hoje: recalcula do próprio dado, mas não é    │
-- │    porta que precise existir). Gatilho não confere EXECUTE ao        │
-- │    disparar: tirar o grant não muda nada no funcionamento.           │
-- └───────────────────────────────────────────────────────────────────────┘

-- ─── A ─────────────────────────────────────────────────────────────────
drop policy if exists evidencia_arquivo_enviar on storage.objects;
create policy evidencia_arquivo_enviar on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidencia'
    and visita_do_path(name) in (select visita.id from visita)
    and pode_anexar_na_visita(visita_do_path(name), true) is not null
  );

-- ─── B ─────────────────────────────────────────────────────────────────
revoke execute on function public.detectar_reincidencia()       from public, anon, authenticated;
revoke execute on function public.equipe_nao_se_apaga()         from public, anon, authenticated;
revoke execute on function public.guarda_observacao_cop()       from public, anon, authenticated;
revoke execute on function public.limpar_sumiu_do_toa()         from public, anon, authenticated;
revoke execute on function public.posse_do_movimento_do_campo() from public, anon, authenticated;
revoke execute on function public.sinal_carimba_base()          from public, anon, authenticated;
revoke execute on function public.tecnico_nao_se_apaga()        from public, anon, authenticated;
revoke execute on function public.um_status_ativo_por_tecnico() from public, anon, authenticated;
revoke execute on function public.extrair_produtos(uuid)        from public, anon, authenticated;

-- ─── C ─────────────────────────────────────────────────────────────────
-- Quem gerencia usuários (não-ADMIN) trocava o `tecnico_id` de OUTRO login
-- sem conferência: amarrava um login a um técnico de outra cidade (ou de
-- outro login) e, pelo app, o login passava a ver os contratos dele e agir
-- como ele. Agora o técnico tem de ser desta empresa, de uma cidade que o
-- gestor acessa, e não pode estar ligado a outro perfil. Mesma regra que a
-- `admin-usuarios` passou a conferir na criação (D-258).
create or replace function public.perfil_protege_campos()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  new.atualizado_em := now();
  -- 106: base ou cidade ativa mudou -> recalcular bases_visiveis().
  if new.base_id is distinct from old.base_id
  or new.base_ativa is distinct from old.base_ativa then
    perform set_config('app.bases_visiveis', '', true);
  end if;
  -- Sem auth.uid() = conexao de servico.
  if auth.uid() is null or tem_papel('ADMIN') then
    return new;
  end if;
  -- 159: quem gerencia usuarios mexe no cadastro de OUTRO login que pode
  -- gerir -- menos empresa e e-mail, e sem entregar Administracao.
  if new.id <> auth.uid() and pode_gerir_usuario(old.id) then
    if new.empresa_id is distinct from old.empresa_id
    or new.email      is distinct from old.email then
      raise exception 'Empresa e e-mail so o ADMIN altera.' using errcode = '42501';
    end if;
    if new.base_id is distinct from old.base_id
       and (new.base_id is null or new.base_id not in (select bases_permitidas())) then
      raise exception 'Escolha uma das cidades que voce acessa.' using errcode = '42501';
    end if;
    if new.perfil_acesso_id is distinct from old.perfil_acesso_id
       and new.perfil_acesso_id is not null
       and perfil_acesso_administra(new.perfil_acesso_id) then
      raise exception 'Este perfil de acesso da poder de Administracao: so o ADMIN atribui.'
        using errcode = '42501';
    end if;
    -- 171 (D-258): o tecnico ligado ao login
    if new.tecnico_id is distinct from old.tecnico_id and new.tecnico_id is not null then
      if not exists (select 1 from tecnico t
                      where t.id = new.tecnico_id and t.empresa_id = old.empresa_id
                        and t.base_id in (select bases_permitidas())) then
        raise exception 'Este tecnico nao e de uma cidade que voce acessa.' using errcode = '42501';
      end if;
      if exists (select 1 from perfil p where p.tecnico_id = new.tecnico_id and p.id <> new.id) then
        raise exception 'Este tecnico ja esta ligado a outro login.' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  if new.empresa_id       is distinct from old.empresa_id
  or new.base_id          is distinct from old.base_id
  or new.ativo            is distinct from old.ativo
  or new.perfil_acesso_id is distinct from old.perfil_acesso_id
  or new.cargo_id         is distinct from old.cargo_id
  or new.tecnico_id       is distinct from old.tecnico_id
  or new.email            is distinct from old.email
  or new.data_contratacao is distinct from old.data_contratacao
  or new.foto_path        is distinct from old.foto_path then
    raise exception
      'Empresa, base, situacao, cargo, perfil de acesso, e-mail, data de contratacao e foto so quem gerencia usuarios altera.'
      using errcode = '42501';
  end if;
  -- 103: a cidade ativa a pessoa escolhe, mas so entre as que pode ver.
  if new.base_ativa is distinct from old.base_ativa
     and new.base_ativa is not null
     and new.base_ativa not in (select bases_permitidas()) then
    raise exception 'Voce nao tem acesso a esta cidade.' using errcode = '42501';
  end if;
  return new;
end;
$function$;
