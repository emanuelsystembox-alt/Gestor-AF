-- 175 · Os sinais nascem pelo relógio, não só quando alguém abre o site
--
-- O QUE RESOLVE
--   Até aqui um sinal (abaixo do ritmo, janela acabando, TEC1 perdido…) só
--   nascia quando alguém da gestão estava com o site aberto: é a tela que chama
--   `sinais_do_dia` a cada minuto. Ninguém olhando = nenhum sinal, e o
--   `criado_em` do sinal dizia a hora em que alguém ABRIU a tela, não a hora em
--   que o problema começou. O resumo das 18h (176) e a fila de TEC1 em risco
--   precisam dessa hora verdadeira.
--
--   "Técnico fora do ritmo da meta às 12h, 15h e 18h. O cálculo já existe
--    (D-167); falta ele chamar quem precisa agir" — pacote aprovado pelo
--    Emanuel em 02/11.
--
-- COMO
--   `sinais_pelo_relogio()` roda pelo pg_cron a cada 5 min e, cidade por
--   cidade com contrato hoje, chama a MESMA `sinais_do_dia()` que o sino
--   chama — como o ADMIN da empresa a chamaria com aquela cidade ativa
--   (cabeçalho `x-afline-cidade`, D-251). Não há segunda cópia da regra de
--   sinal para divergir da primeira.
--
--   O ADMIN escolhido é o mais antigo ativo da empresa. Ele não ganha nada com
--   isso: só a mão que segura a chamada. A única coisa que depende do usuário
--   em `sinais_do_dia` é a dispensa (que é lida, não escrita).
--
-- MEDIDO (02/11, como authenticated): Manaus 139 ms, São Luís 83 ms.
--
-- SEGURANÇA
--   A função assume um usuário: só o pg_cron a chama. Fechada a public, anon e
--   authenticated.

create or replace function public.sinais_pelo_relogio()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select b.id as base_id, a.usuario_id
      from base b
      cross join lateral (
        select up.usuario_id
          from usuario_papel up
          join perfil p on p.id = up.usuario_id
         where up.papel = 'ADMIN' and p.empresa_id = b.empresa_id and p.ativo
         order by p.criado_em
         limit 1) a
     where b.ativo
       and exists (select 1 from visita v
                    where v.base_id = b.id and v.data_agendada = hoje_local()
                      and v.excluido_em is null)
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.usuario_id, 'role', 'authenticated')::text, true);
    perform set_config('request.headers',
      json_build_object('x-afline-cidade', r.base_id)::text, true);
    -- 106: o cache de bases_visiveis tem o cabeçalho na chave, mas limpar
    -- aqui não custa e protege de quem mexer na chave depois.
    perform set_config('app.bases_visiveis', '', true);
    begin
      perform sinais_do_dia();
      n := n + 1;
    exception when others then
      -- Uma cidade com defeito não cala as outras.
      raise warning 'sinais_pelo_relogio, cidade %: %', r.base_id, sqlerrm;
    end;
  end loop;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  perform set_config('app.bases_visiveis', '', true);
  return n;
end;
$$;

revoke all on function public.sinais_pelo_relogio() from public, anon, authenticated;

-- 06:00 às 20:55 em Manaus (10h–00h UTC): a jornada inteira, com folga.
select cron.schedule('sinais-pelo-relogio', '*/5 10-23 * * *',
                     'select public.sinais_pelo_relogio()');
