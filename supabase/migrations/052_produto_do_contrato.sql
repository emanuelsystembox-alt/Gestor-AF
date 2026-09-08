-- 052 · O produto pendente — o que vai ser feito no cliente
--
-- ┌─ O QUE O EMANUEL PEDIU ──────────────────────────────────────────┐
-- │ "Na aba equipes e serviço quero visualizar o produto pendente da  │
-- │  O.S. Ela fica no analítico do TOA, no meio de um monte de texto. │
-- │  Ela mostra o que vai ser feito no cliente."                       │
-- └───────────────────────────────────────────────────────────────────┘
--
-- O "monte de texto" é a coluna **Produto**, que chega a 1.309
-- caracteres numa célula só. Os itens vêm COLADOS, sem separador entre
-- eles:
--
--   34655828|ACESSO VIRTUA PON|pendente34655829|FIBRA 600MEGA…|pendente
--   ^id      ^nome              ^situacao^^ ja e o id do proximo item
--
-- Dá para ler porque a situação é sempre uma palavra em minúsculas e o
-- id seguinte começa com dígito. Na planilha de 08/09: 240 linhas,
-- **1.858 itens**, duas situações — `pendente` (695) e `instalado`
-- (1.163). No banco inteiro deu 5.488 itens, 1.933 pendentes.
--
-- ⚠ O id do item **NÃO é o número da O.S.** — tem 8 dígitos, a O.S. tem
--   10, e em 240 linhas conferidas nenhum bateu. É o identificador do
--   item na assinatura. Por isso o produto amarra no CONTRATO (visita),
--   não na O.S. Dizer "produto da O.S. tal" seria inventar um vínculo
--   que o dado não tem.

create table if not exists visita_produto (
  id         bigserial primary key,
  visita_id  uuid not null references visita(id) on delete cascade,
  item_id    text not null,
  nome       text not null,
  situacao   text not null,
  ordem      int  not null,
  unique (visita_id, ordem)
);

create index if not exists visita_produto_visita_ix on visita_produto (visita_id);
create index if not exists visita_produto_pendente_ix
  on visita_produto (visita_id) where situacao = 'pendente';

alter table visita_produto enable row level security;

-- Segue a visibilidade da visita: quem enxerga o contrato enxerga o que
-- vai ser feito nele.
drop policy if exists visita_produto_leitura on visita_produto;
create policy visita_produto_leitura on visita_produto for select to authenticated
  using (exists (select 1 from visita v
                  where v.id = visita_produto.visita_id
                    and v.empresa_id = minha_empresa()
                    and v.base_id in (select bases_visiveis())
                    and (eh_gestor() or v.equipe_id in (select equipes_visiveis())
                         or v.tecnico_responsavel_id = meu_tecnico_id())));

-- Ninguém escreve pela tela: isto é leitura do TOA, reescrita a cada
-- importação.

-- ============================================================
-- O resumo na própria visita
-- ============================================================
-- A tabela guarda item a item, com o id, porque é o dado cru. Mas a
-- tela precisa do resumo, e embutir 5.488 linhas em cada consulta de
-- contrato seria caro para mostrar meia dúzia de etiquetas.
--
-- Um contrato chegou a **33 pendentes** — porque o mesmo produto se
-- repete em vários itens da assinatura (3 pontos, 3 "NETFLIX INCLUSO").
-- O array preserva a repetição; a tela agrupa e mostra "×3", que é o
-- que se lê de longe.
alter table visita add column if not exists produtos_pendentes text[];

comment on column visita.produtos_pendentes is
  'Nomes dos produtos com situacao "pendente" no analitico do TOA (052).';

create or replace function extrair_produtos(p_visita uuid)
returns int language plpgsql security definer set search_path to 'public' as $fn$
declare v_texto text; n int := 0;
begin
  select dados_origem->>'Produto' into v_texto from visita where id = p_visita;

  delete from visita_produto where visita_id = p_visita;

  if coalesce(btrim(v_texto), '') = '' then
    update visita set produtos_pendentes = null where id = p_visita;
    return 0;
  end if;

  insert into visita_produto (visita_id, item_id, nome, situacao, ordem)
  select p_visita, m[1], btrim(m[2]), lower(m[3]), row_number() over ()
    from regexp_matches(v_texto, '(\d+)\|([^|]+?)\|([a-z]+)', 'g') as m;
  get diagnostics n = row_count;

  update visita v
     set produtos_pendentes = (
       select array_agg(p.nome order by p.ordem)
         from visita_produto p
        where p.visita_id = p_visita and p.situacao = 'pendente')
   where v.id = p_visita;

  return n;
end;
$fn$;

revoke all on function extrair_produtos(uuid) from public, anon;
grant execute on function extrair_produtos(uuid) to authenticated;

-- Backfill do que já está importado.
do $$
declare r record; n int := 0;
begin
  for r in select id from visita
            where dados_origem ? 'Produto' and excluido_em is null loop
    n := n + extrair_produtos(r.id);
  end loop;
  raise notice '052: % itens de produto extraidos.', n;
end $$;

-- E a cada importação, junto do TEC1.
do $$
declare src text; novo text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'importar_toa_interno';

  novo := replace(src,
    '      update visita set tec1 = tec1_da_visita(v_id),',
    '      perform extrair_produtos(v_id);' || chr(10) ||
    '      update visita set tec1 = tec1_da_visita(v_id),');
  if novo = src then
    raise exception 'Nao achei a linha do tec1 no importador.';
  end if;
  execute novo;
end $$;

revoke all on function importar_toa_interno(uuid, boolean) from public, anon;

notify pgrst, 'reload schema';
