-- ┌─ 112 · o perfil de acesso do robô ─────────────────────────────────┐
-- │ Em Administração › Novo usuário, o PERFIL DE ACESSO escolhido dá   │
-- │ o papel (a Edge Function `admin-usuarios` lê `perfil_acesso.papel`)│
-- │ e a cidade de quem cria. Sem um perfil com papel ROBO, criar o     │
-- │ "Robô de sincronismo" seriam dois passos — criar sem papel e       │
-- │ depois trocar —, e no meio o login existe sem enxergar nada.       │
-- │                                                                    │
-- │ Permissões: só ver e executar importação. Ver D-189.               │
-- └────────────────────────────────────────────────────────────────────┘

insert into perfil_acesso (empresa_id, nome, descricao, papel, ordem, ativo)
select e.id, 'Robo de sincronismo',
       'So importa a planilha do TOA, sozinho, pela tela Sincronismo. Nao ve nem mexe em contrato.',
       'ROBO', 8, true
  from empresa e
 where not exists (select 1 from perfil_acesso pa
                    where pa.empresa_id = e.id and pa.papel = 'ROBO');

insert into perfil_acesso_permissao (perfil_acesso_id, permissao_chave)
select pa.id, k
  from perfil_acesso pa
  cross join unnest(array['importacao.ver', 'importacao.executar']) k
 where pa.papel = 'ROBO'
on conflict do nothing;
