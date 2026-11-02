-- ┌─ 172 · o histórico de downloads dos Relatórios (D-259) ─────────────┐
-- │ > "quero tirar a prévia por contratos, e colocar o status dos       │
-- │ >  download, login que fez o download, igual o da importação"      │
-- │ >  — Emanuel, 02/11                                                 │
-- │                                                                      │
-- │ Uma linha por download: tipo, formato, período, cidades, quantas    │
-- │ linhas e colunas, quem, início, fim e status. Nasce GERANDO quando  │
-- │ a pessoa clica em Baixar e termina CONCLUIDO, ERRO ou CANCELADO.    │
-- │ Quem fecha a aba no meio deixa GERANDO: a tela mostra               │
-- │ "interrompido" depois de 30 min — nunca "concluído" (regra 6).       │
-- │                                                                      │
-- │ Perguntado, o Emanuel escolheu: quem abre Relatórios vê os          │
-- │ downloads das cidades que ACESSA (de qualquer pessoa), como a       │
-- │ importação. Escrita só pelas duas funções; o autor é o servidor     │
-- │ (D-061). Humor exige `campo.humor` (a mesma da tela, 146).          │
-- └──────────────────────────────────────────────────────────────────────┘

create table if not exists public.relatorio_download (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresa(id),
  usuario_id    uuid not null references perfil(id),
  tipo          text not null check (tipo in ('CONTRATO', 'OS', 'MISCELANEA', 'HUMOR')),
  formato       text not null check (formato in ('XLSX', 'CSV')),
  de            date not null,
  ate           date not null,
  cidades       uuid[] not null,
  cidades_nomes text,
  filtros       jsonb,
  arquivo       text,
  linhas        integer,
  colunas       integer,
  status        text not null default 'GERANDO'
                check (status in ('GERANDO', 'CONCLUIDO', 'ERRO', 'CANCELADO')),
  mensagem      text,
  iniciado_em   timestamptz not null default now(),
  concluido_em  timestamptz,
  check (de <= ate)
);
create index if not exists relatorio_download_recentes_idx
  on public.relatorio_download (empresa_id, iniciado_em desc);

alter table public.relatorio_download enable row level security;
drop policy if exists relatorio_download_leitura on public.relatorio_download;
create policy relatorio_download_leitura on public.relatorio_download
  for select to authenticated
  using (empresa_id = (select minha_empresa())
         and (select tem_permissao('relatorios.ver'))
         and cidades && (select coalesce(array_agg(b), '{}') from bases_permitidas() b));
revoke all on public.relatorio_download from anon, public;
grant select on public.relatorio_download to authenticated;

create or replace function public.iniciar_download_relatorio(
  p_tipo text, p_formato text, p_de date, p_ate date, p_cidades uuid[],
  p_filtros jsonb default null, p_arquivo text default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id uuid; v_tipo text := upper(btrim(coalesce(p_tipo, ''))); v_nomes text;
begin
  if not tem_permissao('relatorios.ver') then
    raise exception 'Seu perfil nao inclui Relatorios.' using errcode = '42501';
  end if;
  if v_tipo = 'HUMOR' and not tem_permissao('campo.humor') then
    raise exception 'O humor das equipes exige a permissao do Humor.' using errcode = '42501';
  end if;
  if p_cidades is null or cardinality(p_cidades) = 0 then
    raise exception 'Escolha ao menos uma cidade.';
  end if;
  if exists (select 1 from unnest(p_cidades) c where c not in (select bases_permitidas())) then
    raise exception 'Uma das cidades esta fora do seu acesso.' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_de > p_ate then
    raise exception 'Periodo invalido.';
  end if;
  select string_agg(b.nome, ', ' order by b.nome) into v_nomes from base b where b.id = any(p_cidades);
  insert into relatorio_download (empresa_id, usuario_id, tipo, formato, de, ate, cidades,
                                  cidades_nomes, filtros, arquivo)
  values ((select minha_empresa()), auth.uid(), v_tipo, upper(btrim(coalesce(p_formato, ''))),
          p_de, p_ate, p_cidades, v_nomes, p_filtros, left(p_arquivo, 200))
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.concluir_download_relatorio(
  p_id uuid, p_status text, p_linhas integer default null, p_colunas integer default null,
  p_mensagem text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if upper(coalesce(p_status, '')) not in ('CONCLUIDO', 'ERRO', 'CANCELADO') then
    raise exception 'Status invalido.';
  end if;
  -- so quem comecou termina, e so o que ainda esta gerando
  update relatorio_download
     set status = upper(p_status), linhas = p_linhas, colunas = p_colunas,
         mensagem = left(p_mensagem, 500), concluido_em = now()
   where id = p_id and usuario_id = auth.uid() and status = 'GERANDO';
end;
$function$;

revoke all on function public.iniciar_download_relatorio(text, text, date, date, uuid[], jsonb, text) from public, anon;
revoke all on function public.concluir_download_relatorio(uuid, text, integer, integer, text) from public, anon;
grant execute on function public.iniciar_download_relatorio(text, text, date, date, uuid[], jsonb, text) to authenticated;
grant execute on function public.concluir_download_relatorio(uuid, text, integer, integer, text) to authenticated;

notify pgrst, 'reload schema';
