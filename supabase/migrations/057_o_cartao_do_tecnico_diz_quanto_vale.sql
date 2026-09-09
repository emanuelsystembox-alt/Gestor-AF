-- 057 · O cartão do técnico diz quanto vale, e onde é
--
-- > *"faltou mais informações na tela dele — número do contrato, pts do
-- >  contrato, node"* — Emanuel, 09/09, depois de rodar o aplicativo
--
-- `agenda_do_campo` (055-I) entregava o dia mas não dizia **quanto cada
-- contrato vale**. O técnico via a meta do mês na mesma tela e não
-- conseguia ligar uma coisa na outra: ele sabia que faltavam 40 pontos e
-- não sabia se os quatro contratos da agenda dele davam 4 ou 12.
--
-- ┌─ POR QUE `pontos_claro` E NÃO OUTRO NÚMERO ──────────────────────┐
-- │ É exatamente o mesmo que `produtividade_periodo` soma para dizer  │
-- │ "Minha produção no mês" (037). Dois números diferentes na mesma   │
-- │ tela, um por contrato e outro no total, seriam lidos como erro —  │
-- │ e com razão.                                                       │
-- │                                                                    │
-- │ `pontos_equipe` continua fora: não está em arquivo nenhum e        │
-- │ depende do Emanuel levantar as Regras de Comissionamento.          │
-- └────────────────────────────────────────────────────────────────────┘
--
-- ┌─ E POR QUE VAI JUNTO UM `pontos_achou` ──────────────────────────┐
-- │ Hoje, 09/09: 239 das 364 visitas do dia acham regra. **125 não.** │
-- │ Sem esse booleano, a tela mostraria "0,00 pts" nas 125 — e zero   │
-- │ é uma afirmação: "este serviço não vale nada". A verdade é outra: │
-- │ "ainda não sabemos quanto vale". O técnico que vê zero reclama do │
-- │ pagamento; o que vê "sem regra" avisa o controlador.              │
-- └────────────────────────────────────────────────────────────────────┘
--
-- `node` é o nó da rede da CLARO. O técnico usa para saber em que
-- pedaço da planta está e para abrir chamado com a operadora — o
-- aplicativo do concorrente mostra, e a coluna já vinha do TOA sem
-- ninguém ler (249 das 364 de hoje têm).
--
-- Ver D-117.

-- Acrescentar coluna ao `returns table` muda o tipo de retorno, e
-- `create or replace` recusa: "cannot change return type of existing
-- function". Tem de derrubar. E função derrubada e recriada NASCE com a
-- ACL aberta de novo (CLAUDE.md) — por isso o revoke logo abaixo não é
-- decoração.
drop function if exists agenda_do_campo(date);

create function agenda_do_campo(p_data date default null)
returns table (
  visita_id      uuid,
  contrato       text,
  wo_numero      text,
  cliente_nome   text,
  logradouro     text,
  complemento    text,
  bairro         text,
  cep            text,
  node           text,
  telefones      text[],
  lat            numeric,
  lng            numeric,
  janela_inicio  time,
  janela_fim     time,
  situacao       text,
  data_agendada  date,
  servico        text,
  os_total       int,
  os_baixadas    int,
  evidencias     int,
  equipamentos   int,
  pontos         numeric,
  pontos_achou   boolean
)
language sql stable security definer set search_path to 'public' as $fn$
  -- `as materialized` em toda CTE de função de conjunto: sem isso o
  -- planner faz *inline* e reexecuta a função por linha do join. Foi o
  -- que estourou o timeout de `produtividade_periodo` (D-081).
  with dia as materialized (
    select coalesce(p_data, hoje_local()) as d
  ),
  escopo as materialized (
    select minha_empresa() as empresa, eh_gestor() as gestor
  ),
  bases as materialized (select b from bases_visiveis() b),
  equipes_ok as materialized (select e from equipes_visiveis() e),
  minhas as materialized (
    select v.id, v.contrato, v.wo_numero, v.cliente_nome, v.logradouro,
           v.complemento, v.bairro, v.cep, v.node, v.telefones, v.lat, v.lng,
           v.janela_inicio, v.janela_fim, v.situacao, v.data_agendada,
           coalesce(ts.nome, ta.nome, 'Visita') as servico
      from visita v
      cross join escopo s
      left join tipo_servico   ts on ts.id = v.tipo_servico_id
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.excluido_em is null
       and v.data_agendada = (select d from dia)
       and v.empresa_id = s.empresa
       and v.base_id in (select b from bases)
       and (s.gestor or v.equipe_id in (select e from equipes_ok))
       and coalesce(ta.natureza, 'PRODUTIVA') = 'PRODUTIVA'
  ),
  -- A pontuação SÓ das visitas que a pessoa enxerga.
  --
  -- A primeira versão usava `pontos_por_periodo(dia, dia)`, que calcula
  -- o dia inteiro: 364 visitas para o técnico usar 4. Medido como
  -- `authenticated` (D-081: como dono mente), deu **474 ms**. Com o
  -- lateral sobre `minhas`, **31 ms** — e o ADMIN, que enxerga 250,
  -- fica em 173 ms.
  pts as materialized (
    select m.id as visita_id, p.pontos_claro, p.achou
      from minhas m cross join lateral pontos_da_visita(m.id) p
  ),
  contagem as materialized (
    select o.visita_id,
           count(*)::int as total,
           count(*) filter (where o.codigo_baixa_afline_id is not null)::int as baixadas
      from ordem_servico o
     where o.visita_id in (select id from minhas)
     group by o.visita_id
  ),
  evid as materialized (
    select e.visita_id, count(*)::int as n from evidencia e
     where e.visita_id in (select id from minhas) group by e.visita_id
  ),
  equip as materialized (
    select m.visita_id, count(*)::int as n from equipamento_movimento m
     where m.visita_id in (select id from minhas) group by m.visita_id
  )
  select m.id, m.contrato, m.wo_numero, m.cliente_nome, m.logradouro,
         m.complemento, m.bairro, m.cep, m.node, m.telefones, m.lat, m.lng,
         m.janela_inicio, m.janela_fim, m.situacao, m.data_agendada, m.servico,
         coalesce(c.total, 0), coalesce(c.baixadas, 0),
         coalesce(ev.n, 0), coalesce(eq.n, 0),
         -- Sem regra devolve NULL, nunca 0: quem lê a coluna precisa
         -- conseguir separar "não vale nada" de "não sabemos ainda".
         case when p.achou then p.pontos_claro end,
         coalesce(p.achou, false)
    from minhas m
    left join pts      p  on p.visita_id  = m.id
    left join contagem c  on c.visita_id  = m.id
    left join evid     ev on ev.visita_id = m.id
    left join equip    eq on eq.visita_id = m.id
   order by m.janela_inicio nulls last, m.contrato;
$fn$;

revoke all on function agenda_do_campo(date) from public, anon;
grant execute on function agenda_do_campo(date) to authenticated;

comment on function agenda_do_campo(date) is
  'A agenda do técnico em uma viagem só, com quanto cada contrato vale. Jornada (Na Base, Refeição) não entra: natureza PRODUTIVA apenas. `pontos` é NULL quando não há regra — não confundir com zero.';

notify pgrst, 'reload schema';
