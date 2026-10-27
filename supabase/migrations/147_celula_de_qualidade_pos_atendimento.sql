-- 147 · A celula de QUALIDADE: falar com o assinante depois do atendimento
--
-- > "preciso que no painel lateral tenha um menu chamado qualidade. Essa
-- >  celula visa falar com os clientes atendidos e depois perguntar se foi
-- >  normalizado, se o tecnico tratou bem o assinante, se o cliente esta
-- >  com algum problema (...) inclusive que nota o assinante deu para o
-- >  tecnico (...) conforme ele vai fechando o dia ali, falando com todos
-- >  os assinantes, o ideal e sair um grafico de problemas normalizado,
-- >  nao normalizado" -- Emanuel, 26/10
--
-- ## O fato que mudou o desenho: NAO EXISTE TELEFONE NO SISTEMA
--
-- Medido antes de escrever: `visita.telefones` esta vazio em 0 de 3.467
-- visitas (o export do TOA nao traz a coluna), e `contato_cliente`
-- (D-170) tem 3 linhas no banco inteiro, NENHUMA com numero. Dos 226
-- concluidos do dia, zero tinham por onde ligar.
--
-- Decisao do Emanuel, perguntado com esse numero na mao: a QUALIDADE
-- DIGITA o telefone (pega no sistema da CLARO) e o sistema guarda. A
-- celula funciona desde o primeiro dia e a base de contato cresce
-- sozinha. O numero fica no contrato, nunca no Git (LGPD).
--
-- ## As quatro escolhas dele (26/10)
--
-- 1. FILA = tudo onde o tecnico FOI: exclui cancelado pela central e
--    desatribuido, pela mesma razao da D-225 -- ninguem esteve la, nao ha
--    o que perguntar. Reagendamento ENTRA: quem ficou sem atendimento e
--    onde costuma morar a reclamacao.
-- 2. 4 PERGUNTAS, nesta ordem (proposta aprovada):
--    · funcionou?  SIM / PARCIAL / NAO   <- o eixo normalizado
--    · nota do tecnico, 1 a 5
--    · se identificou e tratou com respeito?  SIM / NAO
--    · ficou alguma pendencia?  (texto livre)
--    Quatro e o teto: pesquisa por telefone perde o assinante depois de
--    ~2 min, e questionario longo derruba a taxa de resposta -- o time
--    fecharia menos contratos por dia, que e o oposto do pedido.
-- 3. NOTA 1 a 5 (e nao 0-10): rapido de responder no telefone e a media
--    por tecnico entra direto no ranking que a casa ja usa.
-- 4. EDUCACAO separada de COMPETENCIA: "tratou bem" e pergunta propria e
--    nao um item da nota, porque sao problemas diferentes, com donos
--    diferentes -- um e treinamento, o outro e conduta.
--
-- ## Zero e desconhecido nao sao a mesma coisa (regra 6)
--
-- `situacao` separa PENDENTE (ninguem ligou ainda) de NAO_ATENDE,
-- NUMERO_ERRADO, RECUSOU e SEM_CONTATO. Contrato nao falado NUNCA conta
-- como "nao normalizado": ele conta como NAO FALADO, a parte. Dizer que
-- 200 contratos estao com problema porque ninguem ligou seria mentira
-- com cara de indicador.

-- ====================================================================
-- 1 · permissoes e perfil
-- ====================================================================
insert into permissao (chave, modulo, rotulo, descricao, ordem, disponivel) values
  ('qualidade.ver', 'QUALIDADE', 'Ver a célula de qualidade',
   'A fila do dia, as respostas dos assinantes e o painel de normalizado / não normalizado.', 1, true),
  ('qualidade.registrar', 'QUALIDADE', 'Registrar pesquisa de qualidade',
   'Falar com o assinante e lançar as respostas, a nota do técnico e o telefone usado.', 2, true)
on conflict (chave) do nothing;

-- O perfil nasce com o papel COP: entra no controle e enxerga os
-- contratos das cidades dele, que e exatamente o alcance da celula.
insert into perfil_acesso (empresa_id, nome, descricao, papel, ordem, ativo)
select c.empresa_id, 'Qualidade',
       'Fala com o assinante depois do atendimento e registra a pesquisa',
       'COP', c.ordem, true
  from perfil_acesso c
 where c.nome = 'COP'
   and not exists (select 1 from perfil_acesso q
                    where q.empresa_id = c.empresa_id and q.nome = 'Qualidade');

-- Qualidade ve os servicos (precisa achar o contrato) mas NAO baixa,
-- nao transfere e nao exclui: a celula pergunta, nao opera.
insert into perfil_acesso_permissao (perfil_acesso_id, permissao_chave)
select pa.id, k.chave
  from perfil_acesso pa
  join (values ('Qualidade', 'servicos.ver'),
               ('Qualidade', 'qualidade.ver'),
               ('Qualidade', 'qualidade.registrar'),
               ('Administrador', 'qualidade.ver'),
               ('Administrador', 'qualidade.registrar'),
               ('COP', 'qualidade.ver'),
               ('Coordenador', 'qualidade.ver')
       ) as k(perfil, chave) on k.perfil = pa.nome
 where exists (select 1 from permissao p where p.chave = k.chave)
on conflict do nothing;

-- ====================================================================
-- 2 · a tabela
-- ====================================================================
create table if not exists pesquisa_qualidade (
  id           uuid primary key default gen_random_uuid(),
  visita_id    uuid not null references visita(id) on delete cascade,
  empresa_id   uuid not null references empresa(id),
  base_id      uuid references base(id),

  -- Como terminou a tentativa de falar. PENDENTE e o estado inicial:
  -- "ninguem ligou ainda" nao e "cliente sem problema".
  situacao     text not null default 'PENDENTE'
               check (situacao in ('PENDENTE','FALADO','NAO_ATENDE',
                                   'NUMERO_ERRADO','RECUSOU','SEM_CONTATO')),
  canal        text check (canal in ('LIGACAO','WHATSAPP')),
  -- LGPD: dado pessoal de assinante. Mora aqui, nunca em planilha no Git.
  telefone     text,

  -- As quatro perguntas.
  funcionou    text check (funcionou in ('SIM','PARCIAL','NAO')),
  nota_tecnico smallint check (nota_tecnico between 1 and 5),
  tratou_bem   boolean,
  pendencia    text,

  tentativas   smallint not null default 0,
  -- Quem carimba o autor e o servidor (D-061). A tela nunca manda isto.
  usuario_id   uuid references auth.users(id),
  falado_em    timestamptz,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- Uma pesquisa por contrato: a celula fecha o dia contrato a contrato.
  constraint pesquisa_qualidade_visita_unica unique (visita_id),
  -- FALADO sem as respostas e meia verdade; respostas sem FALADO e pior.
  constraint pesquisa_qualidade_falado_responde
    check (situacao <> 'FALADO' or (funcionou is not null and nota_tecnico is not null))
);

create index if not exists ix_pesquisa_qualidade_visita on pesquisa_qualidade(visita_id);
create index if not exists ix_pesquisa_qualidade_sit    on pesquisa_qualidade(empresa_id, situacao);

alter table pesquisa_qualidade enable row level security;

-- Escopo: a empresa, as cidades que a pessoa ve, e a permissao fina.
-- `(select ...)` em volta das funcoes de escopo: uma chamada por
-- CONSULTA e nao por linha (D-118).
drop policy if exists pesquisa_qualidade_ler on pesquisa_qualidade;
create policy pesquisa_qualidade_ler on pesquisa_qualidade for select
  using (empresa_id = (select minha_empresa())
         and (base_id is null or base_id in (select bases_visiveis()))
         and (select tem_permissao('qualidade.ver')));

-- Escrita so pelas RPCs (SECURITY DEFINER), que carimbam o autor e
-- conferem a permissao fina. Sem policy de insert/update/delete.

comment on table pesquisa_qualidade is
  '147: a pesquisa pos-atendimento da celula de Qualidade. Uma por contrato. '
  'LGPD: `telefone` e dado pessoal de assinante. Ver D-228.';

-- ====================================================================
-- 3 · a fila do dia
-- ====================================================================
create or replace function public.qualidade_fila(p_de date, p_ate date)
returns table(
  visita_id uuid, contrato text, cliente_nome text, endereco text,
  bairro text, grupo text, situacao_contrato text, data_agendada date,
  equipe text, tecnico text, tecnico_id uuid, encerrou timestamptz,
  tem_improdutiva boolean,
  pq_id uuid, situacao text, canal text, telefone text, funcionou text,
  nota_tecnico smallint, tratou_bem boolean, pendencia text,
  tentativas smallint, falado_em timestamptz, quem text)
language sql stable security definer
set search_path to 'public'
as $function$
  /*
   * 147: a fila e "tudo onde o tecnico FOI" (Emanuel, 26/10). Cancelado
   * pela central e desatribuido ficam de fora pela mesma razao da D-225:
   * ninguem esteve la, e perguntar ao assinante como foi o atendimento
   * que nao houve e constrangimento, nao qualidade.
   *
   * Reagendamento ENTRA: quem ficou sem atendimento e justamente onde
   * costuma morar a reclamacao.
   */
  select v.id, v.contrato, v.cliente_nome,
         concat_ws(', ', v.logradouro, v.complemento) as endereco,
         v.bairro, coalesce(ts.nome, ta.nome) as grupo,
         v.situacao, v.data_agendada,
         e.codigo, tc.nome, tc.id, v.fim,
         exists (select 1 from ordem_servico o
                  join codigo_baixa cb on cb.id = o.codigo_baixa_id
                 where o.visita_id = v.id and cb.natureza = 'IMPRODUTIVA'),
         q.id, coalesce(q.situacao, 'PENDENTE'), q.canal,
         coalesce(q.telefone, cc.telefone),
         q.funcionou, q.nota_tecnico, q.tratou_bem, q.pendencia,
         coalesce(q.tentativas, 0::smallint), q.falado_em, p.nome
    from visita v
    join tipo_atividade ta on ta.id = v.tipo_atividade_id
    left join tipo_servico ts on ts.id = v.tipo_servico_id
    left join equipe e on e.id = v.equipe_id
    left join tecnico tc on tc.id = v.tecnico_responsavel_id
    left join pesquisa_qualidade q on q.visita_id = v.id
    left join perfil p on p.id = q.usuario_id
    -- O "melhor contato" do campo (D-170) entra como SUGESTAO quando
    -- existir; hoje nao existe nenhum, mas o dia em que existir a tela
    -- ja aproveita sem mudar nada.
    left join lateral (
      select cc.telefone from contato_cliente cc
       where cc.visita_id = v.id and cc.informou limit 1
    ) cc on true
   where v.data_agendada between p_de and p_ate
     and v.excluido_em is null
     and v.contrato is not null
     and ta.natureza = 'PRODUTIVA'
     and v.situacao in ('CONCLUIDA','CANCELADA','REAGENDAMENTO')
     -- ninguem foi: fora da fila (D-225)
     and not (v.situacao = 'CANCELADA' and (
          norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO'
          or exists (select 1 from ordem_servico o
                      join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                     where o.visita_id = v.id and cb.codigo = 800)))
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis())
     and (select tem_permissao('qualidade.ver'))
   order by (coalesce(q.situacao,'PENDENTE') = 'PENDENTE') desc, v.fim desc nulls last;
$function$;

revoke all on function public.qualidade_fila(date, date) from public, anon;
grant execute on function public.qualidade_fila(date, date) to authenticated, service_role;

-- ====================================================================
-- 4 · registrar a pesquisa
-- ====================================================================
create or replace function public.registrar_qualidade(
  p_visita_id uuid,
  p_situacao text,
  p_canal text default null,
  p_telefone text default null,
  p_funcionou text default null,
  p_nota smallint default null,
  p_tratou_bem boolean default null,
  p_pendencia text default null)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_emp uuid; v_base uuid; v_id uuid; v_antes text;
begin
  if not tem_permissao('qualidade.registrar') then
    raise exception 'Sem permissao para registrar pesquisa de qualidade'
      using errcode = '42501';
  end if;

  -- O contrato tem de estar no alcance de quem registra: SECURITY
  -- DEFINER ignora o RLS, entao o escopo e conferido AQUI (security.md).
  select v.empresa_id, v.base_id into v_emp, v_base
    from visita v
   where v.id = p_visita_id
     and v.excluido_em is null
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  if v_emp is null then
    raise exception 'Contrato nao encontrado ou fora do seu alcance'
      using errcode = 'P0002';
  end if;

  if p_situacao = 'FALADO' and (p_funcionou is null or p_nota is null) then
    raise exception 'Para marcar FALADO e preciso responder se funcionou e a nota do tecnico'
      using errcode = '23514';
  end if;

  select q.situacao into v_antes from pesquisa_qualidade q where q.visita_id = p_visita_id;

  insert into pesquisa_qualidade as q
         (visita_id, empresa_id, base_id, situacao, canal, telefone,
          funcionou, nota_tecnico, tratou_bem, pendencia, usuario_id,
          tentativas, falado_em)
  values (p_visita_id, v_emp, v_base, p_situacao, p_canal, nullif(btrim(p_telefone),''),
          p_funcionou, p_nota, p_tratou_bem, nullif(btrim(p_pendencia),''),
          -- D-061: quem carimba o autor e o SERVIDOR. A tela nunca manda.
          auth.uid(),
          case when p_situacao = 'PENDENTE' then 0 else 1 end,
          case when p_situacao = 'FALADO' then now() end)
  on conflict (visita_id) do update
     set situacao = excluded.situacao,
         canal    = coalesce(excluded.canal, q.canal),
         -- telefone digitado nao se perde quando a ligacao nao completa
         telefone = coalesce(excluded.telefone, q.telefone),
         funcionou = excluded.funcionou,
         nota_tecnico = excluded.nota_tecnico,
         tratou_bem = excluded.tratou_bem,
         pendencia = excluded.pendencia,
         usuario_id = auth.uid(),
         -- cada tentativa que nao foi PENDENTE conta: o time precisa
         -- saber quantas vezes ja ligou antes de desistir
         tentativas = q.tentativas + case when excluded.situacao = 'PENDENTE' then 0 else 1 end,
         falado_em = case when excluded.situacao = 'FALADO' then now() else q.falado_em end,
         atualizado_em = now()
  returning q.id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.registrar_qualidade(uuid, text, text, text, text, smallint, boolean, text)
  from public, anon;
grant execute on function public.registrar_qualidade(uuid, text, text, text, text, smallint, boolean, text)
  to authenticated, service_role;

-- ====================================================================
-- 5 · o painel: normalizado / nao normalizado
-- ====================================================================
create or replace function public.qualidade_resumo(p_de date, p_ate date)
returns table(
  na_fila integer, falados integer, pendentes integer, sem_sucesso integer,
  normalizado integer, parcial integer, nao_normalizado integer,
  pct_normalizado numeric, nota_media numeric, com_nota integer,
  tratou_bem integer, tratou_mal integer, com_pendencia integer)
language sql stable security definer
set search_path to 'public'
as $function$
  /*
   * 147: "nao falado" NUNCA entra em nao normalizado (regra 6). O
   * percentual de normalizacao tem como denominador os FALADOS -- dizer
   * que 200 contratos estao com problema porque ninguem ligou seria
   * mentira com cara de indicador.
   */
  with f as (select * from qualidade_fila(p_de, p_ate))
  select count(*)::int,
         count(*) filter (where situacao = 'FALADO')::int,
         count(*) filter (where situacao = 'PENDENTE')::int,
         count(*) filter (where situacao in ('NAO_ATENDE','NUMERO_ERRADO','RECUSOU','SEM_CONTATO'))::int,
         count(*) filter (where funcionou = 'SIM')::int,
         count(*) filter (where funcionou = 'PARCIAL')::int,
         count(*) filter (where funcionou = 'NAO')::int,
         case when count(*) filter (where funcionou is not null) > 0
              then round(100.0 * count(*) filter (where funcionou = 'SIM')
                         / count(*) filter (where funcionou is not null), 1) end,
         round(avg(nota_tecnico) filter (where nota_tecnico is not null), 2),
         count(*) filter (where nota_tecnico is not null)::int,
         count(*) filter (where tratou_bem is true)::int,
         count(*) filter (where tratou_bem is false)::int,
         count(*) filter (where pendencia is not null and btrim(pendencia) <> '')::int
    from f;
$function$;

revoke all on function public.qualidade_resumo(date, date) from public, anon;
grant execute on function public.qualidade_resumo(date, date) to authenticated, service_role;

comment on function public.qualidade_fila(date, date) is
  '147: a fila da celula de Qualidade -- tudo onde o tecnico FOI no periodo. '
  'Cancelado pela central e desatribuido ficam de fora (D-225). Ver D-228.';

notify pgrst, 'reload schema';
