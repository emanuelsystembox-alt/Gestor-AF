-- ┌─ 101 · a data de contratação, para saber o tempo de casa ──────────┐
-- │ > "nessa tela não é obrigatorio é bom cadastrar data de            │
-- │ >  contratação, para saber quanto tempo o técnico tem de casa"     │
-- │ >  — Emanuel, 17/10                                                │
-- │                                                                    │
-- │ Mora em `perfil`, ao lado do nascimento, do CPF e da matrícula do  │
-- │ ponto: é dado da PESSOA (do empregado), não do login do TOA — o    │
-- │ técnico troca de equipe e de login, a data em que entrou na        │
-- │ AFLINE não muda.                                                   │
-- │                                                                    │
-- │ Opcional. Vazio é "não informado", e a tela diz isso — não "0 dias │
-- │ de casa" (zero e desconhecido não são a mesma coisa).              │
-- │                                                                    │
-- │ O tempo de casa NÃO é guardado: é calculado na leitura, a partir   │
-- │ de `hoje_local()`. Guardar seria um número que envelhece calado.   │
-- │                                                                    │
-- │ Só o ADMIN altera. A policy `perfil_autoedicao` deixa a pessoa     │
-- │ editar o próprio perfil, e RLS não restringe coluna (D-050): sem   │
-- │ o gatilho, o técnico poderia mudar a própria data de contratação.  │
-- └────────────────────────────────────────────────────────────────────┘

alter table perfil
  add column if not exists data_contratacao date;

alter table perfil
  add constraint perfil_contratacao_plausivel
  check (data_contratacao is null
         or (data_contratacao > date '1950-01-01'
             and data_contratacao < date '2100-01-01'));

comment on column perfil.data_contratacao is
  'Data em que a pessoa foi contratada pela AFLINE. Opcional; o tempo de casa '
  'é calculado na leitura (D-178). Só o ADMIN altera (perfil_protege_campos).';

-- A versão viva da função (lida com pg_get_functiondef), com a coluna
-- nova na lista do que só o ADMIN altera. `create or replace` preserva a
-- ACL.
create or replace function public.perfil_protege_campos()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  new.atualizado_em := now();

  -- Sem auth.uid() = conexao de servico (migration, service_role, o
  -- proprio postgres). Essa ja pode tudo pela porta da frente; travar
  -- aqui so quebraria manutencao, sem fechar buraco nenhum.
  if auth.uid() is null or tem_papel('ADMIN') then
    return new;
  end if;

  if new.empresa_id       is distinct from old.empresa_id
  or new.base_id          is distinct from old.base_id
  or new.ativo            is distinct from old.ativo
  or new.perfil_acesso_id is distinct from old.perfil_acesso_id
  or new.cargo_id         is distinct from old.cargo_id
  or new.tecnico_id       is distinct from old.tecnico_id
  or new.email            is distinct from old.email
  -- 101: a data de contratação é registro da empresa, não da pessoa.
  or new.data_contratacao is distinct from old.data_contratacao then
    raise exception
      'Empresa, base, situacao, cargo, perfil de acesso, e-mail e data de contratacao so o ADMIN altera.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function public.perfil_protege_campos() from public, anon;

notify pgrst, 'reload schema';

-- ┌─ a bateria ganha o cenário (17 cenários) ──────────────────────────┐
-- │ Enxertado na versão VIVA da função (pg_get_functiondef), não       │
-- │ reescrito a partir de arquivo: o arquivo pode estar atrasado em    │
-- │ relação ao banco (traps.md, D-160). Recusa se não achar o ponto.   │
-- └────────────────────────────────────────────────────────────────────┘
do $$
declare
  d text := pg_get_functiondef('public.testar_policies'::regproc);
  marca text := E'  begin\n    perform definir_papeis(v_tec, array[''ADMIN'']);';
  bloco text := E'  -- 101: a data de contratacao e registro da empresa. A policy de\n'
             || E'  -- autoedicao libera a linha inteira; quem barra e o gatilho.\n'
             || E'  begin\n'
             || E'    update perfil set data_contratacao = date ''2000-01-01'' where id=v_tec;\n'
             || E'    return query select ''TECNICO muda propria data de contratacao''::text,''barrado''::text,''*** PASSOU ***''::text,false;\n'
             || E'  exception when others then\n'
             || E'    return query select ''TECNICO muda propria data de contratacao''::text,''barrado''::text,''barrado''::text,true;\n'
             || E'  end;\n\n';
begin
  if position('data de contratacao' in d) > 0 then return; end if;
  if position(marca in d) = 0 then
    raise exception 'testar_policies mudou: nao achei onde enxertar o cenario da 101';
  end if;
  execute replace(d, marca, bloco || marca);
end $$;
