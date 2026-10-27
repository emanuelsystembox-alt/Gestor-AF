-- ATENCAO: a 151b (logo abaixo, no fim deste arquivo) TROCOU o criterio:
-- a frente passou a sair da SKILL do tecnico, nao do grupo predominante
-- da rota. O texto original fica como registro do que foi aplicado
-- primeiro e do porque da troca. Ver D-231.
--
-- 151 · Quantas equipes rodam VT e quantas rodam ADESAO hoje
--
-- > "seria bom tambem mostrar aqui quantidade de tecnico de VT rodando
-- >  hoje e tecnico de adesao, contar as equipes que estao com rota mais
-- >  de 1 contrato em linha" -- Emanuel, 26/10, apontando o item Equipes
--
-- "EM ROTA" = equipe com MAIS DE UM contrato produtivo no dia, como ele
-- pediu. Uma visita solta nao e rota.
--
-- A FRENTE SAI DO QUE A EQUIPE ESTA FAZENDO HOJE, nao do cadastro: a
-- escala muda todo dia, e `tecnico.skill` e cadastro que envelhece. A
-- regra e o grupo de servico PREDOMINANTE da rota.
--
-- Medido em 26/10 antes de escrever: 54 equipes com contrato, TODAS com
-- 2 ou mais. 17 predominam VISITA TECNICA, 30 ADESAO, e apenas DUAS
-- fazem as duas coisas no mesmo dia -- ou seja, o predominante quase
-- nunca e desempate, e sim o retrato fiel da frente. As 7 restantes nao
-- fazem nem VT nem adesao (servico, migracao GPON, mudanca de
-- endereco): entram em OUTRAS, e nao sao empurradas para um dos dois.
--
-- Empate de verdade (mesma quantidade de VT e de adesao, as duas > 0)
-- cai em OUTRAS tambem: inventar um criterio de desempate seria o
-- sistema decidindo no lugar de quem opera (D-088).
--
-- Cancelado pela central, desatribuido e jornada ficam FORA, como em
-- toda contagem de volume (D-225).
--
-- Ver D-230.

create or replace function public.equipes_em_rota()
returns table(frente text, equipes integer, contratos integer)
language sql stable security definer
set search_path to 'public'
as $function$
  with eq as (
    select v.equipe_id,
           count(*)::int as n,
           count(*) filter (where norm_txt(coalesce(ts.nome,'')) = 'VISITA TECNICA')::int as vt,
           count(*) filter (where norm_txt(coalesce(ts.nome,'')) = 'ADESAO')::int as ad
      from visita v
      join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join tipo_servico ts on ts.id = v.tipo_servico_id
     where v.data_agendada = hoje_local()
       and v.excluido_em is null
       and v.contrato is not null
       and v.equipe_id is not null
       and ta.natureza = 'PRODUTIVA'
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
       and not (v.situacao = 'CANCELADA' and (
            norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO'
            or exists (select 1 from ordem_servico o
                        join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                       where o.visita_id = v.id and cb.codigo = 800)))
     group by v.equipe_id
    having count(*) > 1          -- "mais de 1 contrato em linha"
  )
  select case when eq.vt > eq.ad then 'VT'
              when eq.ad > eq.vt then 'ADESAO'
              else 'OUTRAS' end,
         count(*)::int,
         sum(eq.n)::int
    from eq
   group by 1;
$function$;

revoke all on function public.equipes_em_rota() from public, anon;
grant execute on function public.equipes_em_rota() to authenticated, service_role;

comment on function public.equipes_em_rota() is
  '151: equipes com MAIS DE UM contrato no dia, repartidas pela frente '
  'PREDOMINANTE da rota (VT / ADESAO / OUTRAS). A frente sai do que a equipe '
  'faz hoje, nao do cadastro de skill. Ver D-230.';

notify pgrst, 'reload schema';

-- ====================================================================
-- 151b · A frente sai da SKILL do tecnico, nao do grupo da rota
-- ====================================================================
--
-- > "depois de separar adesao e VT, entender da onde tirou 7 outras pra
-- >  corrigir tambem" -- Emanuel, 26/10
--
-- Sete equipes cairam em OUTRAS acima. Fui ver de onde vinham:
--
--   017 RENATA GUIMARAES ARAUJO       6  GPON + REINSTALACAO + SERVICO
--   066 JOSIAS COSTA DOS SANTOS       5  MIGRACAO GPON
--   001 CRISTIANO ALVES BARBOSA       5  GPON + RETORNO DE CREDENCIADA
--   027 RODRIGO MACEDO DA SILVA       4  MIGRACAO GPON
--   024 THIAGO LUIZ FERREIRA DA SILVA 4  MIGRACAO GPON
--   028 HERISSON OLIVEIRA BRANDAO     4  MIGRACAO GPON
--   022 ANDRE SANTOS FERREIRA         2  MIGRACAO GPON
--
-- SEIS DAS SETE sao MIGRACAO GPON pura, e as SETE tem tecnico cadastrado
-- como ADESAO. Nao e que nao tenham frente -- A PERGUNTA ESTAVA ERRADA.
-- "Tecnico de VT" e "tecnico de adesao" e o que a pessoa E; migracao
-- GPON, servico e reinstalacao sao trabalho que um tecnico de adesao
-- tambem faz numa terca-feira.
--
-- E a resposta ja estava declarada: `tecnico.skill`, que por sinal e a
-- chave do dinheiro -- e por ela que o tecnico acha `meta_tecnico` e
-- `faixa_comissao` (D-094). Derivar da rota era recalcular o que ja
-- estava declarado, e recalcular errado.
--
-- Medido depois da troca: 43 ADESAO, 11 MANUTENCAO, ZERO outras -- as 54
-- equipes em rota, todas com tecnico ativo. Passa a bater com a coluna
-- Segmento de Administracao (152), que le a mesma skill.
--
-- OUTRAS continua no retorno com outro sentido: equipe em rota SEM
-- tecnico ativo. Zero hoje, mas "nao sei" nao se escreve como adesao.

create or replace function public.equipes_em_rota()
returns table(frente text, equipes integer, contratos integer)
language sql stable security definer
set search_path to 'public'
as $function$
  with eq as (
    select v.equipe_id, count(*)::int as n
      from visita v
      join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.data_agendada = hoje_local()
       and v.excluido_em is null
       and v.contrato is not null
       and v.equipe_id is not null
       and ta.natureza = 'PRODUTIVA'
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
       -- ninguem foi: fora do volume (D-225)
       and not (v.situacao = 'CANCELADA' and (
            norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO'
            or exists (select 1 from ordem_servico o
                        join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                       where o.visita_id = v.id and cb.codigo = 800)))
     group by v.equipe_id
    having count(*) > 1          -- "mais de 1 contrato em linha"
  )
  select case norm_txt(coalesce(sk.skill, ''))
           when 'ADESAO'     then 'ADESAO'
           when 'MANUTENCAO' then 'VT'
           else 'OUTRAS'            -- equipe em rota sem tecnico ativo
         end,
         count(*)::int,
         sum(eq.n)::int
    from eq
    -- O tecnico ATIVO da equipe. Mais de um na mesma equipe e raro aqui
    -- (a dupla costuma ter um login so); o primeiro pelo nome decide, e
    -- e deterministico entre um refresh e outro.
    left join lateral (
      select tc.skill from tecnico tc
       where tc.equipe_id = eq.equipe_id and tc.situacao = 'ATIVO'
       order by tc.nome limit 1
    ) sk on true
   group by 1;
$function$;

comment on function public.equipes_em_rota() is
  '151b: equipes com MAIS DE UM contrato no dia, repartidas pela SKILL do '
  'tecnico (ADESAO / MANUTENCAO), que e o que "tecnico de adesao" e "tecnico '
  'de VT" querem dizer -- e a mesma chave da meta e da comissao (D-094). '
  'OUTRAS so para equipe em rota sem tecnico ativo. Ver D-231.';

notify pgrst, 'reload schema';
