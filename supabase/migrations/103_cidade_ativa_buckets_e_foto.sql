-- ┌─ 103 · a cidade ativa, os buckets do TOA e a foto do técnico ──────┐
-- │ > "é bom ter um filtro de bucket da cidade ok quando importar tem  │
-- │ >  que ter um filtro para esses nomes [...] caso o gestor que      │
-- │ >  tiver o acesso de mais de uma cidade trocar de operação ok? o   │
-- │ >  sistema precisa saber dividir os bucket de quais cidades são    │
-- │ >  para não misturar, nem todo mundo vai conseguir navegar em      │
-- │ >  outras cidades" — Emanuel, 17/10                                │
-- │                                                                    │
-- │ Respostas dele (17/10), entre as opções oferecidas:                │
-- │   bucket      → cadastro na tela, por cidade                       │
-- │   outra cidade→ a importação RECUSA e explica                      │
-- │   quem troca  → ADMIN vê todas; o resto, só as marcadas            │
-- │   foto        → no cadastro (ADMIN) e no app, ranking, monitor     │
-- │                                                                    │
-- │ Ver D-180.                                                         │
-- └────────────────────────────────────────────────────────────────────┘

-- ════════════════════════════════════════════════════════════════════
-- A · A cidade ativa
-- ════════════════════════════════════════════════════════════════════
-- ┌─ por que no BANCO, e não um filtro em cada tela ───────────────────┐
-- │ São 13 policies e 31 funções que já perguntam `bases_visiveis()`.  │
-- │ Um filtro de tela teria de ser escrito em cada consulta de cada    │
-- │ tela — e a primeira que esquecesse mostraria duas cidades juntas,  │
-- │ que é exatamente o que não pode. Respondendo "a cidade ativa" ali, │
-- │ o RLS separa tudo de uma vez, inclusive o que ainda não existe.    │
-- │                                                                    │
-- │ O custo: a escolha é por PESSOA, não por aba. Duas abas abertas em │
-- │ cidades diferentes passam a mostrar a última escolhida.            │
-- └────────────────────────────────────────────────────────────────────┘

alter table perfil add column if not exists base_ativa uuid references base(id);
comment on column perfil.base_ativa is
  'A cidade que a pessoa escolheu no topo da tela (103). Só vale se estiver '
  'entre as bases_permitidas(); senão vale perfil.base_id. Ver D-180.';

-- O que a pessoa PODE ver. Era o corpo do bases_visiveis(), com uma troca:
-- a "todas as cidades" passa a ser do ADMIN, e não de quem tem escopo
-- GLOBAL — o COP tinha GLOBAL e agora vê só as cidades marcadas para ele
-- ("ADMIN todas; resto marcadas", Emanuel, 17/10).
create or replace function public.bases_permitidas()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select b.id from base b
   where b.empresa_id = minha_empresa() and tem_papel('ADMIN')
  union
  select p.base_id from perfil p
   where p.id = auth.uid() and p.base_id is not null
  union
  select ub.base_id from usuario_base ub
    join base b on b.id = ub.base_id
   where ub.usuario_id = auth.uid() and b.empresa_id = minha_empresa();
$function$;

-- O que a pessoa VÊ AGORA: só a cidade ativa. Sem escolha válida, a
-- cidade do próprio perfil; sem nenhuma das duas, tudo o que pode ver.
create or replace function public.bases_visiveis()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with permitidas as materialized (
    select bases_permitidas() as id
  ),
  escolha as (
    select coalesce(
      (select p.base_ativa from perfil p
        where p.id = auth.uid() and p.base_ativa in (select id from permitidas)),
      (select p.base_id from perfil p
        where p.id = auth.uid() and p.base_id in (select id from permitidas))
    ) as id
  )
  select pr.id from permitidas pr
   where (select id from escolha) is null
      or pr.id = (select id from escolha);
$function$;

-- As cidades do seletor do topo.
create or replace function public.minhas_cidades()
 returns table(id uuid, codigo text, nome text, regiao text, ativa boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with vis as materialized (select bases_visiveis() as id)
  select b.id, b.codigo, b.nome, b.regiao,
         (select count(*) from vis) = 1 and b.id in (select id from vis)
    from base b
   where b.id in (select bases_permitidas()) and b.ativo
   order by b.nome;
$function$;

create or replace function public.trocar_cidade(p_base uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Sem sessao.' using errcode = '42501';
  end if;
  if p_base is null or p_base not in (select bases_permitidas()) then
    raise exception 'Voce nao tem acesso a esta cidade. Quem libera e o ADMIN, no cadastro.'
      using errcode = '42501';
  end if;
  update perfil set base_ativa = p_base where id = auth.uid();
end;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- B · Os buckets do TOA, por cidade
-- ════════════════════════════════════════════════════════════════════
-- ┌─ o bucket está no NOME DO ARQUIVO, e só lá ────────────────────────┐
-- │ Conferido em 11 buckets / 31 arquivos do TOA (17/10): nenhuma das  │
-- │ 120 colunas traz o bucket. Ele vem em "Atividades-<BUCKET>_DD_MM_  │
-- │ AA.xlsx". A coluna Cidade e a Área de Trabalho dizem a cidade, mas │
-- │ vêm VAZIAS nas linhas de jornada (109 de 340 em Manaus, 17/10).    │
-- │                                                                    │
-- │ Os códigos do TOA não são os nossos: BLM × BEL, GUR × GRP, ITZ ×   │
-- │ IMP. Por isso é cadastro, e não regra de prefixo.                  │
-- └────────────────────────────────────────────────────────────────────┘

create table if not exists toa_bucket (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresa(id),
  base_id uuid not null references base(id),
  nome text not null check (nome = upper(btrim(nome)) and nome ~ '^[A-Z0-9][A-Z0-9_-]*$'),
  ativo boolean not null default true,
  origem text not null default 'CADASTRO' check (origem in ('CADASTRO', 'ARQUIVOS_DO_TOA')),
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  -- Um bucket é de UMA cidade. É isto que impede a mistura.
  unique (empresa_id, nome)
);
comment on table toa_bucket is
  'Os buckets (grupos de recurso) do TOA de cada cidade. A importação recusa '
  'arquivo de bucket de outra cidade ou não cadastrado (103, D-180).';
comment on column toa_bucket.origem is
  'ARQUIVOS_DO_TOA = semeado na 103 a partir dos arquivos reais (bucket do nome '
  'x coluna Cidade), com a aprovação do Emanuel; CADASTRO = digitado na tela.';

alter table toa_bucket enable row level security;
create policy toa_bucket_leitura on toa_bucket for select to authenticated
  using (empresa_id = (select minha_empresa()) and base_id in (select bases_visiveis()));
-- Sem policy de escrita: só pelas RPCs abaixo, que conferem ADMIN.

alter table importacao add column if not exists bucket text;
comment on column importacao.bucket is
  'O bucket lido do nome do arquivo na hora de importar (103).';

-- O bucket a partir do nome do arquivo. Aceita a cópia "(1)" do navegador.
create or replace function public.bucket_do_arquivo(p_arquivo text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select upper((regexp_match(btrim(coalesce(p_arquivo, '')),
    '^Atividades-(.+?)_[0-9]{2}_[0-9]{2}_[0-9]{2}(?:\s*\([0-9]+\))?\.(?:xlsx|xls|csv)$', 'i'))[1]);
$function$;

-- Semente: só o que os ARQUIVOS provaram (bucket do nome x coluna Cidade
-- x prefixo da área, 31 arquivos nos Downloads do Emanuel, 17/10).
-- ARN-AFLINE ficou de fora de propósito: as linhas dele dizem ARAGUAINA e
-- ARACAJU — Aracaju não é cidade cadastrada, e escolher seria palpite.
insert into toa_bucket (empresa_id, base_id, nome, origem, criado_por)
select b.empresa_id, b.id, s.nome, 'ARQUIVOS_DO_TOA', null
  from (values
    ('MAN', 'MAN-AFLINE'), ('MAN', 'MAN-AFLINE_01_VT'),
    ('BEL', 'BLM-AFLINE'), ('BEL', 'BLM-AFLINE_02_VT'), ('BEL', 'BLM-AFLINE_03_VT'),
    ('BSB', 'BSB-AFLINE'), ('BSB', 'BSB-AFLINE_13_VT'),
    ('GRP', 'GUR-AFLINE'),
    ('SLS', 'SLS-AFLINE_02'), ('SLS', 'SLS-AFLINE_02_VT')
  ) as s(base, nome)
  join base b on b.codigo = s.base
on conflict (empresa_id, nome) do nothing;

-- Cadastrar (ou reativar) um bucket na cidade ativa. Só ADMIN.
create or replace function public.salvar_bucket(p_base uuid, p_nome text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_nome text := upper(btrim(coalesce(p_nome, ''))); v_emp uuid; v record;
begin
  if not tem_papel('ADMIN') then
    raise exception 'So o ADMIN cadastra bucket.' using errcode = '42501';
  end if;
  select empresa_id into v_emp from base
   where id = p_base and empresa_id = minha_empresa() and id in (select bases_visiveis());
  if v_emp is null then
    raise exception 'Cidade fora do seu acesso (troque a cidade no topo).' using errcode = '42501';
  end if;
  if v_nome !~ '^[A-Z0-9][A-Z0-9_-]*$' then
    raise exception 'Nome de bucket invalido: use o nome como o TOA mostra (ex.: MAN-AFLINE_01_VT).';
  end if;

  select t.id, t.base_id, b.nome as cidade into v
    from toa_bucket t join base b on b.id = t.base_id
   where t.empresa_id = v_emp and t.nome = v_nome;
  if found then
    if v.base_id <> p_base then
      raise exception 'O bucket % ja e de %. Um bucket e de uma cidade so.', v_nome, v.cidade;
    end if;
    update toa_bucket set ativo = true where id = v.id;
    return v.id;
  end if;

  insert into toa_bucket (empresa_id, base_id, nome) values (v_emp, p_base, v_nome)
  returning id into v.id;
  return v.id;
end;
$function$;

-- Desligar (ou religar). Não se apaga: a importação antiga aponta o nome.
create or replace function public.ativar_bucket(p_id uuid, p_ativo boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not tem_papel('ADMIN') then
    raise exception 'So o ADMIN altera bucket.' using errcode = '42501';
  end if;
  update toa_bucket set ativo = coalesce(p_ativo, false)
   where id = p_id and empresa_id = minha_empresa() and base_id in (select bases_visiveis());
  if not found then raise exception 'Bucket nao encontrado nesta cidade.'; end if;
end;
$function$;

-- De que cidade é um arquivo — para a tela explicar ANTES de subir as
-- linhas, e oferecer a troca quando a pessoa tem acesso à outra cidade.
create or replace function public.cidade_do_arquivo(p_arquivo text)
 returns table(bucket text, base_id uuid, cidade text, acessa boolean, ativo boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select x.bucket, t.base_id, b.nome, t.base_id in (select bases_permitidas()), t.ativo
    from (select bucket_do_arquivo(p_arquivo) as bucket) x
    left join toa_bucket t on t.nome = x.bucket and t.empresa_id = minha_empresa()
    left join base b on b.id = t.base_id;
$function$;

-- A importação passa a conferir o bucket. Barreira no banco: a tela só
-- antecipa o recado.
create or replace function public.importar_toa(p_importacao_id uuid, p_simular boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r jsonb;
  v_arquivo text; v_base uuid; v_emp uuid; v_bucket text; v_dono record; v_cidade text;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao para importar planilha.'
      using errcode = '42501';
  end if;

  -- 103: o arquivo tem de ser de um bucket DESTA cidade (D-180).
  select i.arquivo_nome, i.base_id, b.empresa_id, b.nome
    into v_arquivo, v_base, v_emp, v_cidade
    from importacao i join base b on b.id = i.base_id
   where i.id = p_importacao_id;
  v_bucket := bucket_do_arquivo(v_arquivo);
  if v_bucket is null then
    raise exception 'Nao reconheci o bucket no nome do arquivo "%". Use o arquivo com o nome que o TOA gera: Atividades-<BUCKET>_DD_MM_AA.xlsx.', v_arquivo;
  end if;
  select t.base_id, t.ativo, b.nome as cidade into v_dono
    from toa_bucket t join base b on b.id = t.base_id
   where t.empresa_id = v_emp and t.nome = v_bucket;
  if not found then
    raise exception 'O bucket % nao esta cadastrado em nenhuma cidade. O ADMIN cadastra em Configuracoes > Buckets do TOA.', v_bucket;
  end if;
  if not v_dono.ativo then
    raise exception 'O bucket % esta desligado em %. O ADMIN religa em Configuracoes > Buckets do TOA.', v_bucket, v_dono.cidade;
  end if;
  if v_dono.base_id <> v_base then
    raise exception 'Este arquivo e do bucket % (%), e a importacao e para %. Troque a cidade no topo da tela.',
      v_bucket, v_dono.cidade, v_cidade;
  end if;
  update importacao set bucket = v_bucket where id = p_importacao_id;

  r := importar_toa_interno(p_importacao_id, p_simular);

  return r
      || jsonb_build_object('reincidencias', detectar_reincidencia())
      || jsonb_build_object('reconciliacao', reconciliar_importacao(p_importacao_id));
end;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- C · A foto de perfil
-- ════════════════════════════════════════════════════════════════════
-- ┌─ por que bucket privado, e quem vê ────────────────────────────────┐
-- │ Foto de rosto é dado pessoal do empregado (LGPD). Vê quem já vê a  │
-- │ pessoa: ela mesma, o ADMIN, e quem enxerga a cidade dela — o que   │
-- │ inclui o técnico no ranking da própria cidade, que já mostra nome  │
-- │ e pontos (D-167). Quem envia é só o ADMIN (Emanuel, 17/10: "no     │
-- │ cadastro"); o técnico não troca a própria foto.                    │
-- │                                                                    │
-- │ Diferente da evidência, foto de perfil SE TROCA: o ADMIN atualiza  │
-- │ e remove. Não é prova de nada.                                     │
-- └────────────────────────────────────────────────────────────────────┘

alter table perfil add column if not exists foto_path text;
comment on column perfil.foto_path is
  'Caminho no bucket foto_perfil, sempre <usuario_id>/<arquivo>. Só o ADMIN '
  'grava (perfil_protege_campos). Ver D-180.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('foto_perfil', 'foto_perfil', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- O dono da foto pelo caminho. CASE garante a ordem: nome que não começa
-- com uuid devolve NULL em vez de estourar o cast e derrubar a policy
-- inteira em silêncio (a armadilha do visita_do_path, D-116).
create or replace function public.usuario_do_path(p_nome text)
 returns uuid
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
    when p_nome ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    then substring(p_nome, 1, 36)::uuid
  end;
$function$;

create or replace function public.pode_ver_foto(p_usuario uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p_usuario is not null and (
    p_usuario = auth.uid()
    or exists (
      select 1 from perfil p
       where p.id = p_usuario and p.empresa_id = minha_empresa()
         and (tem_papel('ADMIN')
              or p.base_id in (select bases_visiveis())
              or exists (select 1 from tecnico t
                          where t.usuario_id = p_usuario
                            and t.base_id in (select bases_visiveis())))));
$function$;

create policy foto_perfil_ver on storage.objects for select to authenticated
  using (bucket_id = 'foto_perfil' and pode_ver_foto(usuario_do_path(name)));
create policy foto_perfil_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'foto_perfil' and (select tem_papel('ADMIN'))
              and usuario_do_path(name) is not null);
create policy foto_perfil_trocar on storage.objects for update to authenticated
  using (bucket_id = 'foto_perfil' and (select tem_papel('ADMIN')))
  with check (bucket_id = 'foto_perfil' and (select tem_papel('ADMIN'))
              and usuario_do_path(name) is not null);
create policy foto_perfil_remover on storage.objects for delete to authenticated
  using (bucket_id = 'foto_perfil' and (select tem_papel('ADMIN')));

-- O caminho da foto de cada técnico — para o ranking do app e o
-- monitoramento, que conhecem o técnico, não o perfil (o técnico só lê o
-- próprio perfil, então não acharia a foto dos colegas sozinho).
create or replace function public.fotos_dos_tecnicos(p_tecnicos uuid[])
 returns table(tecnico_id uuid, foto_path text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select t.id, p.foto_path
    from tecnico t join perfil p on p.id = t.usuario_id
   where t.id = any(p_tecnicos)
     and t.empresa_id = minha_empresa()
     and t.base_id in (select bases_visiveis())
     and p.foto_path is not null;
$function$;

-- A foto entra na lista do que só o ADMIN altera (versão viva da 101).
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
  or new.data_contratacao is distinct from old.data_contratacao
  -- 103: a foto é posta pelo ADMIN, no cadastro (D-180).
  or new.foto_path        is distinct from old.foto_path then
    raise exception
      'Empresa, base, situacao, cargo, perfil de acesso, e-mail, data de contratacao e foto so o ADMIN altera.'
      using errcode = '42501';
  end if;

  -- 103: a cidade ativa a pessoa escolhe, mas só entre as que pode ver.
  -- (Quem lê já ignora escolha inválida; isto só evita gravar lixo.)
  if new.base_ativa is distinct from old.base_ativa
     and new.base_ativa is not null
     and new.base_ativa not in (select bases_permitidas()) then
    raise exception 'Voce nao tem acesso a esta cidade.' using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- ACL — toda função nova nasce aberta ao anon (security.md)
-- ════════════════════════════════════════════════════════════════════
revoke all on function public.bases_permitidas()              from public, anon;
revoke all on function public.bases_visiveis()                from public, anon;
revoke all on function public.minhas_cidades()                from public, anon;
revoke all on function public.trocar_cidade(uuid)             from public, anon;
revoke all on function public.bucket_do_arquivo(text)         from public, anon;
revoke all on function public.salvar_bucket(uuid, text)       from public, anon;
revoke all on function public.ativar_bucket(uuid, boolean)    from public, anon;
revoke all on function public.cidade_do_arquivo(text)         from public, anon;
revoke all on function public.importar_toa(uuid, boolean)     from public, anon;
revoke all on function public.usuario_do_path(text)           from public, anon;
revoke all on function public.pode_ver_foto(uuid)             from public, anon;
revoke all on function public.fotos_dos_tecnicos(uuid[])      from public, anon;
revoke all on function public.perfil_protege_campos()         from public, anon;

grant execute on function public.bases_permitidas()           to authenticated;
grant execute on function public.bases_visiveis()             to authenticated;
grant execute on function public.minhas_cidades()             to authenticated;
grant execute on function public.trocar_cidade(uuid)          to authenticated;
grant execute on function public.bucket_do_arquivo(text)      to authenticated;
grant execute on function public.salvar_bucket(uuid, text)    to authenticated;
grant execute on function public.ativar_bucket(uuid, boolean) to authenticated;
grant execute on function public.cidade_do_arquivo(text)      to authenticated;
grant execute on function public.importar_toa(uuid, boolean)  to authenticated;
grant execute on function public.usuario_do_path(text)        to authenticated;
grant execute on function public.pode_ver_foto(uuid)          to authenticated;
grant execute on function public.fotos_dos_tecnicos(uuid[])   to authenticated;

grant select on toa_bucket to authenticated;

notify pgrst, 'reload schema';

-- ┌─ 103b · a bateria ganha dois cenários (19 cenários) ───────────────┐
-- │ Enxertados na versão VIVA (pg_get_functiondef), como na 101.       │
-- └────────────────────────────────────────────────────────────────────┘
do $$
declare
  d text := pg_get_functiondef('public.testar_policies'::regproc);
  marca text := E'  begin\n    perform definir_papeis(v_tec, array[''ADMIN'']);';
  bloco text := E'  -- 103: cidade que nao e dele, e a propria foto.\n'
             || E'  begin\n'
             || E'    perform trocar_cidade((select b.id from base b where b.id not in (select bases_permitidas()) limit 1));\n'
             || E'    return query select ''TECNICO troca para cidade que nao e dele''::text,''barrado''::text,''*** PASSOU ***''::text,false;\n'
             || E'  exception when others then\n'
             || E'    return query select ''TECNICO troca para cidade que nao e dele''::text,''barrado''::text,''barrado''::text,true;\n'
             || E'  end;\n\n'
             || E'  begin\n'
             || E'    update perfil set foto_path = v_tec::text || ''/teste.jpg'' where id=v_tec;\n'
             || E'    return query select ''TECNICO troca a propria foto''::text,''barrado''::text,''*** PASSOU ***''::text,false;\n'
             || E'  exception when others then\n'
             || E'    return query select ''TECNICO troca a propria foto''::text,''barrado''::text,''barrado''::text,true;\n'
             || E'  end;\n\n';
begin
  if position('cidade que nao e dele' in d) > 0 then return; end if;
  if position(marca in d) = 0 then
    raise exception 'testar_policies mudou: nao achei onde enxertar os cenarios da 103';
  end if;
  execute replace(d, marca, bloco || marca);
end $$;

-- 103c · o autor do bucket aponta o perfil, para a tela dizer QUEM
-- cadastrou (o embed do PostgREST precisa da FK).
alter table toa_bucket
  add constraint toa_bucket_criado_por_fkey foreign key (criado_por) references perfil(id);
notify pgrst, 'reload schema';
