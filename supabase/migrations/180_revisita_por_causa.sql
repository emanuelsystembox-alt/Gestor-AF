-- ┌─ 180 · revisita por causa: modelo, técnico, área e bairro ──────────┐
-- │                                                                    │
-- │ O QUE RESOLVE                                                      │
-- │   Pacote de inteligência operacional (D-262): a revisita (D-245)   │
-- │   já se conta por contrato, no dia e no card do técnico (D-246).   │
-- │   Faltava a pergunta de CAUSA — "o decoder X volta em VT em 30     │
-- │   dias três vezes mais?", "qual técnico volta mais?", "qual área?" │
-- │                                                                    │
-- │ A REGRA NÃO É ESCRITA DE NOVO                                      │
-- │   Quem diz o que é revisita é `revisita_dos_contratos(uuid[])`     │
-- │   (163). Aqui só se pergunta a ela, em LOTE (uma chamada com o     │
-- │   array, nunca por linha — D-248), e se agrupa a resposta pela     │
-- │   visita ANTERIOR, que é o trabalho que voltou (D-246).            │
-- │                                                                    │
-- │ A TAXA TEM DENOMINADOR                                             │
-- │   serviços = visitas CONCLUÍDAS da cidade no período (a anterior   │
-- │              da 163 tem de ser concluída), sem jornada;            │
-- │   revisitas = desses, os que são a ANTERIOR de alguma revisita     │
-- │              (a revisita pode cair até 30 dias depois do período). │
-- │   "De 100 serviços com o modelo X, 12 voltaram." Serviço que não   │
-- │   fechou os 30 dias ainda pode voltar: a resposta diz até que dia  │
-- │   a janela está completa, e a tela avisa.                          │
-- │                                                                    │
-- │ AMOSTRA PEQUENA NÃO É "O PIOR"                                     │
-- │   Linha com menos de `p_min_amostra` serviços (padrão 20) vem      │
-- │   marcada e vai para o fim da ordem: 1 de 3 = 33% não ranqueia     │
-- │   acima de 30 de 300 = 10%.                                        │
-- │                                                                    │
-- │ O MODELO — de onde vem, e quanto falta (medido em 02/11, Manaus,   │
-- │ 90 dias, 2.760 concluídas):                                        │
-- │   · a planilha de Atividades do TOA não traz equipamento nenhum;   │
-- │   · `equipamento_movimento` (lançado pelo campo) tem 1 linha no    │
-- │     banco inteiro; `equipamento` (Atlas) tem 33;                   │
-- │   · `visita_produto` é o PRODUTO vendido (ACESSO VIRTUA, COMODATO),│
-- │     não o aparelho;                                                │
-- │   · `visita_equipamento_toa` (a varredura, D-250) é a única fonte  │
-- │     com modelo — e só 546 das 2.760 (19,8%) foram lidas. Na seção  │
-- │     INSTALADO o TOA quase nunca manda o modelo (9 de 363 visitas): │
-- │     vem o TIPO ("3 - EMTA") e o serial. A seção CLIENTE (o que já  │
-- │     estava no assinante) tem modelo em 1.574 de 1.599 linhas.      │
-- │   Por isso o recorte é "o equipamento que FICOU no cliente depois  │
-- │   da visita anterior": INSTALADO + CLIENTE − o serial que saiu     │
-- │   (DESINSTALADO, 231 de 259 retirados estão também em CLIENTE).    │
-- │   Sem modelo, o tipo vem com "modelo não informado"; visita que a  │
-- │   varredura não leu é "não lido do TOA"; lida e sem aparelho é     │
-- │   "sem equipamento no TOA". Nenhuma some (regra 6).                │
-- │                                                                    │
-- │ ESCOPO                                                             │
-- │   SECURITY DEFINER (a 163 é INVOKER e aqui roda sem RLS), então o  │
-- │   corte é feito aqui, na forma de sempre: gestão, cidade ativa e   │
-- │   `(select ve_cidade_inteira()) or equipe_id in (select            │
-- │   equipes_visiveis())` — tudo em `(select f())` (D-118, D-248). A  │
-- │   revisita (a visita nova) também é procurada só na cidade ativa.  │
-- └────────────────────────────────────────────────────────────────────┘

create or replace function public.revisita_por_causa(
  p_de date,
  p_ate date,
  p_grupo text default null,        -- grupo de serviço da visita ANTERIOR (nulo = todos)
  p_min_amostra integer default 20  -- abaixo disso a linha é "amostra pequena"
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_emp uuid := minha_empresa();
  v_hoje date := hoje_local();
  v_min integer := greatest(coalesce(p_min_amostra, 20), 1);
  v_res jsonb;
begin
  if not eh_gestao() then
    raise exception 'A revisita por causa é da gestão.' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;
  -- Guarda técnica, não regra de negócio: 92 dias (os 3 meses dos
  -- relatórios, D-260) cabem com folga no statement_timeout de 8 s.
  if p_ate - p_de > 92 then
    raise exception 'Período de até 3 meses.' using errcode = '22023';
  end if;

  with
  -- A base: as concluídas do período, na cidade ativa e no escopo de quem pergunta.
  todos0 as materialized (
    select v.id, v.contrato, v.data_agendada, g.nome as grupo,
           v.tecnico_responsavel_id as tecnico_id, v.area_id,
           nullif(norm_txt(v.bairro), '') as bairro,
           v.toa_varrido_em is not null as lido
      from visita v
      left join tipo_servico g    on g.id = v.tipo_servico_id
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.empresa_id = v_emp
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
       and v.excluido_em is null
       and v.contrato is not null
       and v.situacao = 'CONCLUIDA'
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       and v.data_agendada between p_de and p_ate
  ),
  -- As candidatas a revisita: o mesmo contrato, na cidade ativa, do início
  -- do período até 30 dias depois do fim.
  cand as materialized (
    select coalesce(array_agg(x.id), '{}') as ids
      from visita x
     where x.empresa_id = v_emp
       and x.base_id in (select bases_visiveis())
       and x.excluido_em is null
       and x.contrato in (select b.contrato from todos0 b)
       and x.data_agendada between p_de and p_ate + 30
  ),
  -- Uma chamada só à 163, com o array inteiro (o lateral tem uma linha).
  rev as materialized (
    select r.visita_id, r.anterior_id, r.dias
      from cand c
      cross join lateral revisita_dos_contratos(c.ids) r
     where r.revisita
       and r.anterior_id in (select b.id from todos0 b)
  ),
  todos as materialized (
    select b.*, exists (select 1 from rev where rev.anterior_id = b.id) as voltou
      from todos0 b
  ),
  base as materialized (
    select * from todos where p_grupo is null or grupo is not distinct from p_grupo
  ),
  -- O que FICOU no cliente depois da visita: instalado + o que já estava,
  -- menos o serial retirado. Uma linha por (visita, tipo, modelo).
  eq as materialized (
    select distinct t.visita_id,
           coalesce(nullif(btrim(regexp_replace(t.tipo, '^\s*\d+\s*-\s*', '')), ''),
                    'TIPO NÃO INFORMADO') as tipo,
           nullif(btrim(t.modelo), '') as modelo
      from visita_equipamento_toa t
     where t.visita_id in (select id from base)
       and not t.miscelanea
       and (t.secao = 'INSTALADO'
            or (t.secao = 'CLIENTE'
                and not exists (
                  select 1 from visita_equipamento_toa d
                   where d.visita_id = t.visita_id and d.secao = 'DESINSTALADO'
                     and upper(btrim(d.serial)) = upper(btrim(t.serial)))))
  ),
  -- Toda visita da base tem pelo menos uma chave de modelo — nenhuma some.
  chave_modelo as materialized (
    select b.id, b.voltou,
           coalesce(e.tipo, '') as tipo,
           case
             when e.visita_id is not null then coalesce(e.modelo, 'modelo não informado')
             when b.lido or exists (select 1 from visita_equipamento_toa t where t.visita_id = b.id)
               then 'SEM EQUIPAMENTO NO TOA'
             else 'NÃO LIDO DO TOA'
           end as modelo,
           e.visita_id is not null as conhecido
      from base b
      left join eq e on e.visita_id = b.id
  ),
  geral as (
    select count(*) as servicos, count(*) filter (where voltou) as revisitas from base
  ),
  -- Uma linha por recorte, com a taxa e a marca de amostra pequena.
  linhas as (
    select 'modelo' as recorte, tipo || ' · ' || modelo as chave, modelo as rotulo, tipo as detalhe,
           count(distinct id) as servicos, count(distinct id) filter (where voltou) as revisitas
      from chave_modelo group by tipo, modelo
    union all
    select 'tecnico', coalesce(b.tecnico_id::text, '-'), coalesce(t.nome, 'sem técnico'),
           coalesce(t.skill, ''),
           count(*), count(*) filter (where b.voltou)
      from base b left join tecnico t on t.id = b.tecnico_id
     group by b.tecnico_id, t.nome, t.skill
    union all
    select 'area', coalesce(b.area_id::text, '-'),
           coalesce(nullif(a.apelido, ''), a.codigo, 'sem área'), coalesce(a.codigo, ''),
           count(*), count(*) filter (where b.voltou)
      from base b left join area_trabalho a on a.id = b.area_id
     group by b.area_id, a.apelido, a.codigo
    union all
    select 'bairro', coalesce(b.bairro, '-'), coalesce(b.bairro, 'sem bairro'), '',
           count(*), count(*) filter (where b.voltou)
      from base b group by b.bairro
  )
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate, 'grupo', p_grupo, 'min_amostra', v_min,
    -- Serviço depois deste dia ainda não fechou os 30 dias: a taxa pode subir.
    'completo_ate', v_hoje - 30,
    'geral', (select jsonb_build_object(
        'servicos', g.servicos, 'revisitas', g.revisitas,
        'taxa', case when g.servicos = 0 then null
                     else round(100.0 * g.revisitas / g.servicos, 1) end)
      from geral g),
    'cobertura', (select jsonb_build_object(
        'servicos', count(*),
        'lidos', count(*) filter (where c.lido),
        'com_modelo', count(*) filter (where c.com_modelo))
      from (select b.id,
                   bool_or(m.modelo <> 'NÃO LIDO DO TOA') as lido,
                   bool_or(m.conhecido and m.modelo <> 'modelo não informado') as com_modelo
              from base b join chave_modelo m on m.id = b.id
             group by b.id) c),
    'grupos', (select coalesce(jsonb_agg(jsonb_build_object(
        'grupo', x.grupo, 'servicos', x.n, 'revisitas', x.r) order by x.n desc), '[]')
      from (select grupo, count(*) n, count(*) filter (where voltou) r
              from todos group by grupo) x),
    'linhas', (select coalesce(jsonb_agg(jsonb_build_object(
        'recorte', l.recorte, 'chave', l.chave, 'rotulo', l.rotulo, 'detalhe', l.detalhe,
        'servicos', l.servicos, 'revisitas', l.revisitas,
        'taxa', round(100.0 * l.revisitas / l.servicos, 1),
        'vezes', case when g.revisitas = 0 then null
                      else round((l.revisitas::numeric / l.servicos)
                                 / (g.revisitas::numeric / g.servicos), 2) end,
        'amostra_pequena', l.servicos < v_min)
        order by l.recorte, (l.servicos < v_min), l.revisitas::numeric / l.servicos desc,
                 l.servicos desc, l.rotulo), '[]')
      from linhas l cross join geral g),
    -- As revisitas, para a tela abrir a lista ao clicar numa linha.
    'contratos', (select coalesce(jsonb_agg(jsonb_build_object(
        'anterior_id', b.id, 'contrato', b.contrato, 'anterior_data', b.data_agendada,
        'anterior_grupo', b.grupo,
        'tecnico', coalesce(b.tecnico_id::text, '-'), 'tecnico_nome', t.nome,
        'area', coalesce(b.area_id::text, '-'), 'bairro', coalesce(b.bairro, '-'),
        'modelos', (select jsonb_agg(distinct m.tipo || ' · ' || m.modelo)
                      from chave_modelo m where m.id = b.id),
        'visita_id', r.visita_id, 'data', n.data_agendada, 'grupo', gn.nome,
        'dias', r.dias)
        order by b.data_agendada, b.contrato, n.data_agendada), '[]')
      from rev r
      join base b on b.id = r.anterior_id
      join visita n on n.id = r.visita_id
      left join tipo_servico gn on gn.id = n.tipo_servico_id
      left join tecnico t on t.id = b.tecnico_id)
  ) into v_res;

  return v_res;
end;
$function$;

revoke all on function public.revisita_por_causa(date, date, text, integer) from public, anon;
grant execute on function public.revisita_por_causa(date, date, text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
