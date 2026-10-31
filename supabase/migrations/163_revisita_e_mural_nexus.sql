-- ┌─ 163 · a revisita na janela do LOG, e o Mural Nexus ───────────────┐
-- │                                                                    │
-- │ A. REVISITA                                                        │
-- │ > "é interessante saber se o contrato já passou pela gente. É      │
-- │ >  importante saber o código de baixa anterior, equipe anterior,   │
-- │ >  data anterior [e o técnico anterior] para ter um controle mais  │
-- │ >  eficaz de revisita" — Emanuel, 31/10                            │
-- │                                                                    │
-- │ O LOG da janela é o "Contador de log" da CLARO: conta a agenda     │
-- │ inteira dela, inclusive o que nunca passou por aqui. A pergunta    │
-- │ nova é a NOSSA: o contrato já esteve na nossa agenda, com quem, e  │
-- │ como fechou?                                                       │
-- │                                                                    │
-- │ A regra de revisita, nas respostas do Emanuel (31/10):             │
-- │   · a visita anterior do contrato tem de estar CONCLUÍDA           │
-- │     (reagendado, cancelado e improdutivo não geram revisita);      │
-- │   · a nova vem em até 30 DIAS depois dela;                         │
-- │   · e o par de grupos é um destes:                                 │
-- │       qualquer grupo        → VISITA TECNICA ("VT da VT", e o      │
-- │                               serviço que virou VT depois);        │
-- │       ADESAO, MIGRACAO GPON, REINSTALACAO, MUDANCA DE ENDERECO     │
-- │                             → RETORNO DE CREDENCIADA;              │
-- │       RETORNO DE CREDENCIADA → RETORNO DE CREDENCIADA.             │
-- │   SERVICO→SERVICO (109 pares) e ADESAO→ADESAO (84) NÃO contam —    │
-- │   perguntado e respondido.                                          │
-- │                                                                    │
-- │ "Anterior" = a visita CONCLUÍDA mais recente do contrato antes     │
-- │ desta; sem nenhuma concluída, a mais recente de qualquer situação  │
-- │ (para a tela dizer "passou, mas não concluiu"). Sem nenhuma: NULO, │
-- │ e a tela escreve "nunca passou por aqui" — que só vale desde que a │
-- │ cidade começou a ser importada (Manaus 17/10, São Luís 29/10).     │
-- │                                                                    │
-- │ INVOKER de propósito: a anterior é lida pelo RLS de quem pergunta. │
-- │ Toda a gestão vê a cidade inteira (158), então na prática é a      │
-- │ cidade; o que o RLS esconde, esta função também não conta.         │
-- │                                                                    │
-- │ B. MURAL NEXUS                                                     │
-- │ > "crie um canal de comunicação dentro do site (...) um slide      │
-- │ >  passando uma imagem e embaixo vai ter descrições (...) somente  │
-- │ >  o admin poderá enviar conteúdos (...) todo o restante do time   │
-- │ >  poderá visualizar" — Emanuel, 31/10                             │
-- │                                                                    │
-- │ Tabela `mural_post` + bucket privado `mural`. Lê quem é da         │
-- │ empresa; escreve só ADMIN — no banco (policy), não na tela. O autor│
-- │ é carimbado pelo servidor (gatilho), nunca mandado pelo cliente.   │
-- └────────────────────────────────────────────────────────────────────┘

-- ── A. revisita ────────────────────────────────────────────────────────

-- A busca da anterior é por contrato; `visita.contrato` não tinha índice
-- (a busca por número de Serviços também usa, 162).
create index if not exists visita_empresa_contrato_ix
  on visita (empresa_id, contrato) where contrato is not null;

create or replace function public.revisita_dos_contratos(p_visitas uuid[])
returns table(
  visita_id uuid,
  anterior_id uuid, anterior_data date, anterior_grupo text, anterior_situacao text,
  anterior_equipe text, anterior_tecnico text,
  anterior_baixa_codigo integer, anterior_baixa_descricao text,
  dias integer, revisita boolean
)
language sql
stable security invoker
set search_path to 'public'
as $function$
  select v.id,
         a.id, a.data_agendada, ga.nome, a.situacao,
         e.codigo, t.nome,
         cb.codigo, cb.descricao,
         v.data_agendada - a.data_agendada,
         coalesce(
           a.situacao = 'CONCLUIDA'
           and v.data_agendada - a.data_agendada between 0 and 30
           and (
             gv.nome = 'VISITA TECNICA'
             or (gv.nome = 'RETORNO DE CREDENCIADA'
                 and ga.nome in ('ADESAO', 'MIGRACAO GPON', 'REINSTALACAO',
                                 'MUDANCA DE ENDERECO', 'RETORNO DE CREDENCIADA'))
           ), false)
    from visita v
    left join tipo_servico gv on gv.id = v.tipo_servico_id
    left join lateral (
      select x.* from visita x
       where x.empresa_id = v.empresa_id and x.contrato = v.contrato
         and x.id <> v.id and x.excluido_em is null
         and (x.data_agendada < v.data_agendada
              or (x.data_agendada = v.data_agendada and x.criado_em < v.criado_em))
       -- a concluída mais recente; sem concluída, a mais recente de todas
       order by (x.situacao = 'CONCLUIDA') desc, x.data_agendada desc, x.criado_em desc
       limit 1
    ) a on true
    left join tipo_servico ga on ga.id = a.tipo_servico_id
    left join equipe e        on e.id = a.equipe_id
    left join tecnico t       on t.id = a.tecnico_responsavel_id
    -- A baixa da OPERADORA na menor sequência (a que a CLARO reconhece,
    -- D-042, como na 033); sem ela, a da AFLINE.
    left join lateral (
      select coalesce(o.codigo_baixa_id, o.codigo_baixa_afline_id) as id
        from ordem_servico o
       where o.visita_id = a.id
         and (o.codigo_baixa_id is not null or o.codigo_baixa_afline_id is not null)
       order by (o.codigo_baixa_id is null), o.sequencia
       limit 1
    ) ob on true
    left join codigo_baixa cb on cb.id = ob.id
   where v.id = any(p_visitas)
     and v.contrato is not null;
$function$;

revoke all on function public.revisita_dos_contratos(uuid[]) from public, anon;
grant execute on function public.revisita_dos_contratos(uuid[]) to authenticated, service_role;

-- ── B. Mural Nexus ─────────────────────────────────────────────────────

create table if not exists mural_post (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresa(id) default minha_empresa(),
  titulo        text not null check (length(btrim(titulo)) between 1 and 120),
  texto         text check (texto is null or length(texto) <= 2000),
  imagem_path   text not null,
  ordem         integer not null default 0,
  ativo         boolean not null default true,
  criado_por    uuid references perfil(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists mural_post_empresa_ix on mural_post (empresa_id, ativo, ordem);

-- O autor e a hora são do servidor (D-061): o cliente não escolhe.
create or replace function public.mural_post_carimbo()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em  := now();
    new.empresa_id := minha_empresa();
  else
    new.criado_por := old.criado_por;
    new.criado_em  := old.criado_em;
    new.empresa_id := old.empresa_id;
  end if;
  new.atualizado_em := now();
  return new;
end;
$function$;
revoke all on function public.mural_post_carimbo() from public, anon;

drop trigger if exists mural_post_carimbo on mural_post;
create trigger mural_post_carimbo before insert or update on mural_post
  for each row execute function mural_post_carimbo();

alter table mural_post enable row level security;

create policy mural_post_ler on mural_post for select to authenticated
  using (empresa_id = (select minha_empresa()));
create policy mural_post_publicar on mural_post for insert to authenticated
  with check ((select tem_papel('ADMIN')) and empresa_id = (select minha_empresa()));
create policy mural_post_editar on mural_post for update to authenticated
  using ((select tem_papel('ADMIN')) and empresa_id = (select minha_empresa()))
  with check ((select tem_papel('ADMIN')) and empresa_id = (select minha_empresa()));
create policy mural_post_tirar on mural_post for delete to authenticated
  using ((select tem_papel('ADMIN')) and empresa_id = (select minha_empresa()));

-- O bucket: privado, só imagem, até 5 MB. O caminho começa pela empresa
-- (`<empresa_id>/<arquivo>`), e a policy compara TEXTO com texto — sem
-- cast para uuid, que num nome fora do formato derruba a policy inteira
-- em silêncio (D-116).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mural', 'mural', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy mural_ver on storage.objects for select to authenticated
  using (bucket_id = 'mural'
         and split_part(name, '/', 1) = (select minha_empresa())::text);
create policy mural_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'mural' and (select tem_papel('ADMIN'))
              and split_part(name, '/', 1) = (select minha_empresa())::text);
create policy mural_trocar on storage.objects for update to authenticated
  using (bucket_id = 'mural' and (select tem_papel('ADMIN'))
         and split_part(name, '/', 1) = (select minha_empresa())::text)
  with check (bucket_id = 'mural' and (select tem_papel('ADMIN'))
              and split_part(name, '/', 1) = (select minha_empresa())::text);
create policy mural_remover on storage.objects for delete to authenticated
  using (bucket_id = 'mural' and (select tem_papel('ADMIN'))
         and split_part(name, '/', 1) = (select minha_empresa())::text);

notify pgrst, 'reload schema';
