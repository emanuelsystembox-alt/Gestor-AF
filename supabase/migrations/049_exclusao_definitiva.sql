-- 049 · Excluir de vez — DELETE, não marca
--
-- ┌─ O QUE O EMANUEL PEDIU ──────────────────────────────────────────┐
-- │ "Eles precisam sair do banco de vez ok."                          │
-- └───────────────────────────────────────────────────────────────────┘
--
-- Até aqui a exclusão era lógica: `excluido_em` preenchido, contrato
-- fora da tela, linha no banco. Agora é DELETE.
--
-- Vai junto por CASCADE: ordem_servico, visita_evento, visita_marcador,
-- evidencia, equipamento_movimento e a reincidencia da própria visita.
-- `reincidencia.visita_anterior_id` NÃO tem cascade — vira nulo, senão
-- o DELETE quebraria na primeira visita que já serviu de "anterior".
--
-- ⚠ CONSEQUÊNCIA QUE NÃO DÁ PARA ESCONDER: o importador procura a
--   visita por `toa_atividade_id` e não filtra excluídas. Com exclusão
--   lógica, reimportar o mesmo arquivo encontrava a linha e a mantinha
--   excluída. Apagada de vez, **ela volta como nova na próxima
--   importação do mesmo arquivo**. Por isso o registro guarda o
--   `toa_atividade_id`: se a operação quiser que o importador respeite
--   a exclusão, a lista já existe.
--
-- O registro NÃO guarda nome, telefone nem endereço — é dado pessoal
-- (LGPD), e "sair do banco" tem de valer para ele também. Guarda o
-- suficiente para responder "quem apagou o contrato X, quando e por
-- quê", que é a pergunta que aparece depois.
create table if not exists exclusao_definitiva (
  id               bigserial primary key,
  empresa_id       uuid references empresa(id),
  base_id          uuid references base(id),
  visita_id        uuid not null,
  toa_atividade_id text,
  contrato         text,
  wo_numero        text,
  data_agendada    date,
  situacao         text,
  equipe_codigo    text,
  ordens           int,
  motivo           text not null,
  excluido_por     uuid references perfil(id),
  excluido_em      timestamptz not null default now()
);

alter table exclusao_definitiva enable row level security;

drop policy if exists exclusao_definitiva_leitura on exclusao_definitiva;
create policy exclusao_definitiva_leitura on exclusao_definitiva
  for select to authenticated
  using (empresa_id = minha_empresa() and eh_gestor());

-- Ninguém escreve direto: só a função abaixo, que é SECURITY DEFINER.
-- Registro de auditoria que a própria tela pode editar não é auditoria.

create or replace function excluir_visitas_definitivo(p_visitas uuid[], p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare n_reg int := 0; n_del int := 0;
begin
  -- Mais restrito que a exclusão lógica de propósito: aquilo se desfaz,
  -- isto não. Gestor marca; só ADMIN apaga.
  if not tem_papel('ADMIN') then
    raise exception 'Somente ADMIN apaga contrato do banco. Exclusao definitiva nao se desfaz.'
      using errcode = '42501';
  end if;
  if not tem_permissao('servicos.excluir') then
    raise exception 'Seu perfil de acesso nao inclui "Excluir contrato".'
      using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da exclusao.' using errcode = '23514';
  end if;
  if p_visitas is null or array_length(p_visitas, 1) is null then
    raise exception 'Nenhum contrato selecionado.' using errcode = '23514';
  end if;
  if array_length(p_visitas, 1) > 500 then
    raise exception 'Selecao de % contratos e grande demais para uma acao so (limite 500).',
      array_length(p_visitas, 1) using errcode = '23514';
  end if;

  -- 1. registra ANTES de apagar: depois do delete não há o que ler
  insert into exclusao_definitiva (
    empresa_id, base_id, visita_id, toa_atividade_id, contrato, wo_numero,
    data_agendada, situacao, equipe_codigo, ordens, motivo, excluido_por)
  select v.empresa_id, v.base_id, v.id, v.toa_atividade_id, v.contrato, v.wo_numero,
         v.data_agendada, v.situacao, e.codigo,
         (select count(*) from ordem_servico o where o.visita_id = v.id),
         btrim(p_motivo), auth.uid()
    from visita v
    left join equipe e on e.id = v.equipe_id
   where v.id = any(p_visitas)
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  get diagnostics n_reg = row_count;

  if n_reg = 0 then
    raise exception 'Nenhum dos contratos selecionados esta visivel para voce.'
      using errcode = 'P0002';
  end if;

  -- 2. a reincidência que aponta para ela como ANTERIOR perde o elo,
  --    em vez de impedir o delete
  update reincidencia set visita_anterior_id = null
   where visita_anterior_id = any(p_visitas);

  -- 3. e agora sai de verdade (o resto vai por CASCADE)
  delete from visita v
   where v.id = any(p_visitas)
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  get diagnostics n_del = row_count;

  return jsonb_build_object('apagados', n_del, 'registrados', n_reg);
end;
$fn$;

revoke all on function excluir_visitas_definitivo(uuid[], text) from public, anon;
grant execute on function excluir_visitas_definitivo(uuid[], text) to authenticated;

notify pgrst, 'reload schema';
