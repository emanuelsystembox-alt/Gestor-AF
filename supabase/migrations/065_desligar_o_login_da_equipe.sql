-- ============================================================
-- 065 · Desligar o login da equipe
--
-- > "eu acho que é bom essa função ficar fora do editar ao lado do
-- >  técnico, ligar router e desligar router, uma chave ao lado melhor
-- >  por isso não achei" — Emanuel
--
-- O roteamento do login virou uma CHAVE na lista de usuários (D-130).
-- Chave que só liga não é chave — e desligar não existia: `cadastrar_
-- login_da_equipe` sabia amarrar e sabia MUDAR de equipe (fecha o
-- vínculo anterior), mas não sabia soltar.
--
-- ┌─ o que "desligar" faz, e o que NÃO faz ──────────────────────────┐
-- │ FAZ: encerra o vínculo, então a partir de hoje a importação volta │
-- │      a mandar o contrato daquele login para "Sem login definido". │
-- │                                                                   │
-- │ NÃO FAZ: mover de volta o que já foi roteado. O contrato de       │
-- │      ontem foi para a equipe porque naquele dia o vínculo valia — │
-- │      e, depois de roteado, ele pode ter sido despachado,          │
-- │      transferido à mão, baixado. Puxar tudo de volta para o       │
-- │      abrigo apagaria trabalho real para "consertar" um cadastro.  │
-- │      Quem precisa mover contrato tem `transferir_visita`, que     │
-- │      pede motivo e registra evento.                               │
-- └───────────────────────────────────────────────────────────────────┘
--
-- `equipe_login_toa` é uma tabela de PERÍODO (inicio/fim), então
-- encerrar é `fim = ontem`: os dias em que o vínculo valeu continuam
-- valendo, e a leitura histórica de qualquer data passada não muda.
--
-- O caso degenerado é o vínculo que começou HOJE (ou depois): ele nunca
-- cobriu um dia fechado, e encerrá-lo com `fim = ontem` deixaria uma
-- linha com `fim < inicio` — um período que nunca existiu, guardado
-- para sempre. Esse a gente REMOVE.
--
-- `hoje_local()`, nunca `current_date`: em Manaus o dia vira às 20h, e
-- o `current_date` do servidor desligaria o roteamento quatro horas
-- antes da meia-noite de quem opera.
-- ============================================================

create or replace function public.desligar_login_da_equipe(p_login text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_inicio date; v_base uuid; v_cod text; v_acao text; n int;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  if not tem_permissao('equipes.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar equipe e tecnico".'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_login, '')), '') is null then
    raise exception 'Informe o login.' using errcode = '23514';
  end if;

  -- O vínculo aberto daquele login, dentro do que quem chama enxerga.
  select h.id, h.inicio, e.base_id, e.codigo
    into v_id, v_inicio, v_base, v_cod
    from equipe_login_toa h
    join equipe e on e.id = h.equipe_id
   where norm_txt(h.login_toa) = norm_txt(p_login)
     and h.fim is null
     and e.empresa_id = minha_empresa()
     and e.base_id in (select bases_visiveis())
   order by h.inicio desc
   limit 1;

  if v_id is null then
    raise exception 'Este login nao esta amarrado a nenhuma equipe.'
      using errcode = 'P0002';
  end if;

  if v_inicio >= hoje_local() then
    -- Nunca cobriu um dia fechado: some, em vez de virar um periodo
    -- invertido guardado para sempre.
    delete from equipe_login_toa where id = v_id;
    v_acao := 'removido';
  else
    update equipe_login_toa set fim = hoje_local() - 1 where id = v_id;
    v_acao := 'encerrado';
  end if;

  -- O login corrente da equipe tambem sai: e o outro lugar que
  -- `equipe_do_login` consulta.
  update equipe set login_toa = null
   where base_id = v_base and norm_txt(login_toa) = norm_txt(p_login);

  -- Quantos contratos FICAM onde estao. Nao movemos nenhum -- o numero
  -- existe para a tela poder dizer isso em vez de deixar a pessoa
  -- descobrir sozinha.
  select count(*) into n
    from visita v
   where v.base_id = v_base and v.excluido_em is null
     and norm_txt(v.dados_origem ->> 'Login do Técnico') = norm_txt(p_login);

  return jsonb_build_object(
    'acao', v_acao, 'equipe', v_cod, 'login', btrim(p_login),
    'ate', case when v_acao = 'encerrado' then (hoje_local() - 1)::text else null end,
    'contratos_mantidos', n);
end;
$function$;

revoke all on function public.desligar_login_da_equipe(text) from public, anon;
grant execute on function public.desligar_login_da_equipe(text) to authenticated;

notify pgrst, 'reload schema';
