-- 148 · Qualidade: o DESFECHO de nove estados, e a fila com filtros
--
-- > "precisa melhorar nessa central de qualidade (...) a nossa nao tem
-- >  filtro, ta bem simples. E as palavras parece meio amadoras (...)
-- >  precisa usar palavras mais tecnicas e mais bonitas"
-- >  -- Emanuel, 26/10, com a central dele na tela
--
-- A 147 tinha DUAS perguntas para o mesmo fato: "situacao do contato" e
-- "funcionou?". A central dele resolve com UM campo de nove estados, e
-- esta certa: o desfecho de uma ligacao e um so, e separar em dois deixa
-- combinacao impossivel representavel.
--
-- AS CONTAS SAIRAM DA TELA DELE, conferidas na aritmetica antes de
-- escrever:  441 + 44 + 1 + 11 + 3 = 500  e  441/500 = 88,2% = a
-- Conformidade dele. Logo REDE EXTERNA fica FORA do denominador -- e
-- planta da CLARO, nao execucao da AFLINE ("19 rede externa (fora da
-- conta)", diz o card dele).  E 876 - 288 - 56 = 532 = 60,7% = o
-- Contato: contatado e todo mundo com quem se FALOU, inclusive quem
-- recusou responder.
--
-- A NOTA CONTINUA DE 1 A 5: oferecida a troca para 0-10 (que e o que a
-- central dele usa e o que permite o card "NPS interno"), ele preferiu
-- manter. Entao NAO existe card de NPS aqui -- NPS e definido em 0-10, e
-- chamar de NPS uma conta feita em 1-5 seria dar nome errado a um
-- numero. No lugar entra SATISFACAO = % de notas 4 e 5.
--
-- A tabela tinha ZERO linhas, entao a reestruturacao sai de graca.
-- `drop function` antes de recriar: `create or replace` nao muda o tipo
-- de retorno (traps.md), e foi exatamente o que estourou na 1a tentativa.
--
-- Ver D-229.

insert into parametro (empresa_id, chave, valor, descricao)
select e.id, 'qualidade_meta_diaria', '70'::jsonb,
       'Quantos clientes cada analista da Qualidade deve falar por dia (148). '
       'Nasce em 70, igual a central que o Emanuel ja opera.'
  from empresa e
 where not exists (select 1 from parametro p
                    where p.empresa_id = e.id and p.chave = 'qualidade_meta_diaria');

drop function if exists public.qualidade_resumo(date, date);
drop function if exists public.qualidade_fila(date, date);
drop function if exists public.registrar_qualidade(uuid, text, text, text, text, smallint, boolean, text);
drop table if exists pesquisa_qualidade cascade;

create table pesquisa_qualidade (
  id           uuid primary key default gen_random_uuid(),
  visita_id    uuid not null references visita(id) on delete cascade,
  empresa_id   uuid not null references empresa(id),
  base_id      uuid references base(id),

  /*
   * O DESFECHO da ligacao -- um so, e nunca dois campos para o mesmo
   * fato. A ausencia de LINHA e que significa PENDENTE: contrato sem
   * pesquisa nao e "desfecho vazio", e trabalho que ainda nao foi feito.
   *
   * Os cinco primeiros sao CONCLUSIVOS (houve veredito tecnico sobre o
   * servico); REDE EXTERNA e conclusivo mas fica fora da conformidade;
   * os tres ultimos sao "nao deu para apurar".
   */
  desfecho     text not null check (desfecho in (
                 'NORMALIZADO', 'SERVICO_FALHA', 'PROBLEMA_CRITICO',
                 'SEM_ATIVO', 'DESEJA_CANCELAMENTO',
                 'REDE_EXTERNA',
                 'NAO_QUIS_RESPONDER', 'NAO_ATENDEU', 'SEM_NUMERO')),

  canal        text check (canal in ('LIGACAO','WHATSAPP')),
  -- LGPD: dado pessoal de assinante. Mora aqui, nunca em planilha no Git.
  telefone     text,

  nota_tecnico smallint check (nota_tecnico between 1 and 5),
  tratou_bem   boolean,
  observacao   text,

  tentativas   smallint not null default 1,
  -- Quem carimba o autor e o servidor (D-061). A tela nunca manda isto.
  usuario_id   uuid references auth.users(id),
  registrado_em timestamptz not null default now(),
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint pesquisa_qualidade_visita_unica unique (visita_id)
);

create index ix_pq_visita   on pesquisa_qualidade(visita_id);
create index ix_pq_desfecho on pesquisa_qualidade(empresa_id, desfecho);
-- A producao por analista le por autor e por dia: o indice e esse.
create index ix_pq_analista on pesquisa_qualidade(usuario_id, registrado_em);

alter table pesquisa_qualidade enable row level security;

create policy pesquisa_qualidade_ler on pesquisa_qualidade for select
  using (empresa_id = (select minha_empresa())
         and (base_id is null or base_id in (select bases_visiveis()))
         and (select tem_permissao('qualidade.ver')));

comment on table pesquisa_qualidade is
  '148: a pesquisa pos-atendimento da Qualidade. Uma por contrato, um DESFECHO '
  'de nove estados. LGPD: `telefone` e dado pessoal de assinante. Ver D-229.';

-- Quem e "contatado": falou-se com alguem.
create or replace function public.qualidade_contatado(p_desfecho text)
returns boolean language sql immutable as $$
  select p_desfecho is not null and p_desfecho not in ('NAO_ATENDEU','SEM_NUMERO');
$$;

-- Quem entra na CONFORMIDADE: houve veredito tecnico sobre o servico.
-- Rede externa fica de fora -- e planta da CLARO, nao execucao nossa.
create or replace function public.qualidade_conclusivo(p_desfecho text)
returns boolean language sql immutable as $$
  select p_desfecho in ('NORMALIZADO','SERVICO_FALHA','PROBLEMA_CRITICO',
                        'SEM_ATIVO','DESEJA_CANCELAMENTO');
$$;

revoke all on function public.qualidade_contatado(text)  from public, anon;
revoke all on function public.qualidade_conclusivo(text) from public, anon;
grant execute on function public.qualidade_contatado(text)  to authenticated, service_role;
grant execute on function public.qualidade_conclusivo(text) to authenticated, service_role;

-- ====================================================================
-- a fila, com o que os cinco filtros da tela precisam
--
-- NOTA (148b, aplicada em seguida): `base.nome` JA traz a UF
-- ("Manaus - AM"). A primeira versao fazia concat_ws(' - ', nome, uf) e
-- a coluna Operacao saia "Manaus - AM - AM". Abaixo ja esta corrigido.
-- ====================================================================
create function public.qualidade_fila(p_de date, p_ate date)
returns table(
  visita_id uuid, contrato text, cliente_nome text, endereco text,
  bairro text, grupo text, situacao_contrato text, status_toa text,
  data_agendada date, operacao text, equipe text, area text,
  tecnico text, tecnico_id uuid, encerrou timestamptz,
  janela text, baixa_codigo integer, baixa_descricao text,
  baixa_natureza text, contador_log integer, tem_improdutiva boolean,
  desfecho text, canal text, telefone text, nota_tecnico smallint,
  tratou_bem boolean, observacao text, tentativas smallint,
  registrado_em timestamptz, analista text)
language sql stable security definer
set search_path to 'public'
as $function$
  /*
   * 148: a fila traz tudo o que os cinco filtros precisam -- tipo de
   * servico, situacao, codigo de baixa, janela e LOG -- numa consulta
   * so. Filtrar no cliente e deliberado: sao ~300 linhas no dia, e cada
   * troca de filtro sem ida ao servidor deixa a tela instantanea para
   * quem passa o dia inteiro nela.
   *
   * A fila continua sendo "tudo onde o tecnico FOI" (D-228).
   */
  select v.id, v.contrato, v.cliente_nome,
         concat_ws(', ', v.logradouro, v.complemento),
         v.bairro, coalesce(ts.nome, ta.nome),
         v.situacao,
         nullif(btrim(coalesce(v.dados_origem->>'Status da Atividade','')),''),
         v.data_agendada,
         b.nome,
         e.codigo, a.apelido,
         tc.nome, tc.id, v.fim,
         case when v.janela_inicio is null then null
              else to_char(v.janela_inicio,'HH24:MI') || ' - '
                   || coalesce(to_char(v.janela_fim,'HH24:MI'),'?') end,
         bx.codigo, bx.descricao, bx.natureza,
         nullif(btrim(coalesce(v.dados_origem->>'Contador de log','')),'')::int,
         exists (select 1 from ordem_servico o
                  join codigo_baixa cb on cb.id = o.codigo_baixa_id
                 where o.visita_id = v.id and cb.natureza = 'IMPRODUTIVA'),
         q.desfecho, q.canal, coalesce(q.telefone, cc.telefone),
         q.nota_tecnico, q.tratou_bem, q.observacao,
         coalesce(q.tentativas, 0::smallint), q.registrado_em, p.nome
    from visita v
    join tipo_atividade ta on ta.id = v.tipo_atividade_id
    left join tipo_servico ts on ts.id = v.tipo_servico_id
    left join base b on b.id = v.base_id
    left join equipe e on e.id = v.equipe_id
    left join area_trabalho a on a.id = v.area_id
    left join tecnico tc on tc.id = v.tecnico_responsavel_id
    left join pesquisa_qualidade q on q.visita_id = v.id
    left join perfil p on p.id = q.usuario_id
    -- a baixa da O.S. de menor sequencia que tenha uma: e a que a CLARO
    -- reconhece, a mesma escolha da reincidencia (033)
    left join lateral (
      select cb.codigo, cb.descricao, cb.natureza
        from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_id
       where o.visita_id = v.id order by o.sequencia limit 1
    ) bx on true
    left join lateral (
      select cc.telefone from contato_cliente cc
       where cc.visita_id = v.id and cc.informou limit 1
    ) cc on true
   where v.data_agendada between p_de and p_ate
     and v.excluido_em is null
     and v.contrato is not null
     and ta.natureza = 'PRODUTIVA'
     and v.situacao in ('CONCLUIDA','CANCELADA','REAGENDAMENTO')
     and not (v.situacao = 'CANCELADA' and (
          norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO'
          or exists (select 1 from ordem_servico o
                      join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                     where o.visita_id = v.id and cb.codigo = 800)))
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis())
     and (select tem_permissao('qualidade.ver'))
   order by (q.desfecho is null) desc, v.fim desc nulls last;
$function$;

revoke all on function public.qualidade_fila(date, date) from public, anon;
grant execute on function public.qualidade_fila(date, date) to authenticated, service_role;

-- ====================================================================
-- registrar
-- ====================================================================
create function public.registrar_qualidade(
  p_visita_id uuid,
  p_desfecho text,
  p_canal text default null,
  p_telefone text default null,
  p_nota smallint default null,
  p_tratou_bem boolean default null,
  p_observacao text default null)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_emp uuid; v_base uuid; v_id uuid;
begin
  if not tem_permissao('qualidade.registrar') then
    raise exception 'Sem permissao para registrar pesquisa de qualidade'
      using errcode = '42501';
  end if;

  -- SECURITY DEFINER ignora o RLS: o escopo se confere AQUI (security.md).
  select v.empresa_id, v.base_id into v_emp, v_base
    from visita v
   where v.id = p_visita_id and v.excluido_em is null
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  if v_emp is null then
    raise exception 'Contrato nao encontrado ou fora do seu alcance'
      using errcode = 'P0002';
  end if;

  insert into pesquisa_qualidade as q
         (visita_id, empresa_id, base_id, desfecho, canal, telefone,
          nota_tecnico, tratou_bem, observacao, usuario_id, tentativas,
          registrado_em)
  values (p_visita_id, v_emp, v_base, p_desfecho, p_canal,
          nullif(btrim(p_telefone),''), p_nota, p_tratou_bem,
          nullif(btrim(p_observacao),''),
          auth.uid(), 1, now())
  on conflict (visita_id) do update
     set desfecho = excluded.desfecho,
         canal    = coalesce(excluded.canal, q.canal),
         -- telefone digitado nao se perde quando a ligacao nao completa
         telefone = coalesce(excluded.telefone, q.telefone),
         nota_tecnico = excluded.nota_tecnico,
         tratou_bem   = excluded.tratou_bem,
         observacao   = excluded.observacao,
         usuario_id   = auth.uid(),
         tentativas   = q.tentativas + 1,
         registrado_em = now(),
         atualizado_em = now()
  returning q.id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.registrar_qualidade(uuid, text, text, text, smallint, boolean, text)
  from public, anon;
grant execute on function public.registrar_qualidade(uuid, text, text, text, smallint, boolean, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
