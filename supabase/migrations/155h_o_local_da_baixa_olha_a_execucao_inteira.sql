-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 155h · O local da baixa do TOA olha a EXECUÇÃO, não um instante  ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "quando o tecnico baixar no TOA e o usuario importar em nosso
-- >  sistema o contrato, nos temos que pegar a melhor geolocalizacao do
-- >  tecnico naquele momento para saber se ele esta baixando dentro da
-- >  residencia ou nao (...) quando baixar um contrato, a gente deve
-- >  consultar essa geo para saber se estava la proximo ou o horario
-- >  executado (...) tem que ser a melhor regra possivel"
-- >  -- Emanuel, 29/10
--
-- ┌─ o que ja existia, e onde falhava ───────────────────────────────┐
-- │ A regra ja tratava o caso dele (baixa no TOA, importada depois):  │
-- │ pegava UM ponto do rastro -- o mais perto da HORA da baixa, numa  │
-- │ janela de +-10 min -- e media a distancia ate o cliente.          │
-- │                                                                    │
-- │ Dois defeitos:                                                     │
-- │  1. Um instante so. Parado, o app manda ponto a cada 5 min; com o │
-- │     celular sem sinal ou o app em segundo plano, os +-10 min em   │
-- │     volta da baixa ficam vazios -- e o contrato vira "sem         │
-- │     registro" mesmo com o tecnico rastreado a execucao inteira.   │
-- │     Medido em 29/10 nos 9 contratos com rastro: em 2 a regra      │
-- │     antiga nao achou ponto nenhum, e havia ponto na execucao.     │
-- │  2. Mais perto no TEMPO nao e o mais confiavel. O tecnico baixa no │
-- │     TOA muitas vezes ja no carro, a uma quadra -- o ponto da hora │
-- │     da baixa pode estar fora do raio com ele tendo passado 40 min │
-- │     dentro da casa.                                                │
-- │                                                                    │
-- │ A pergunta certa e "ele ESTEVE no endereco enquanto executava?".  │
-- │ Agora a janela e a execucao inteira (inicio - 10 min ate fim +    │
-- │ 10 min), e vale o ponto MAIS PERTO do cliente, entre os de        │
-- │ precisao ate 100 m -- o mesmo corte que o km do monitoramento ja  │
-- │ usa. Ate 200 m (menor OU IGUAL) = esteve la (155j).               │
-- └────────────────────────────────────────────────────────────────────┘
--
-- O QUE NAO MUDA:
--   · Baixa dada pelo APP continua usando a coordenada do proprio
--     registro (a mais longe, D-170) -- ali o GPS e o do momento exato.
--   · Sem ponto na execucao = NULO, "sem registro". Nunca "dentro".
--   · Endereco sem coordenada do TOA = NULO tambem.
--
-- O QUE PASSA A FICAR DE FORA: cancelado pela central. O TOA marca
-- `finalizado_toa`, mas `inicio`/`fim` ali sao a janela reservada, nao
-- execucao (D-227) -- ninguem foi, e medir "local da baixa" nisso e
-- inventar uma ida. So entra o que alguem abriu: CONCLUIDO ou NAO
-- CONCLUIDO no "Status da Atividade".
--
-- A ASSINATURA E A MESMA (sino e telas seguem funcionando), com os
-- campos significando:
--   em / lat / lng / distancia_m -> o ponto mais perto do cliente na execucao
--   registros                    -> quantos pontos houve na execucao
--   registros_fora               -> quantos deles estavam fora do raio
--   minutos_do_ponto             -> distancia, em minutos, ate a hora da baixa

create or replace function local_da_baixa(p_visitas uuid[])
returns table(visita_id uuid, em timestamp with time zone, tipo text, login text, lat double precision, lng double precision, precisao_m numeric, cliente_lat double precision, cliente_lng double precision, distancia_m integer, raio_m integer, fora_do_raio boolean, registros integer, registros_fora integer, fonte text, minutos_do_ponto integer)
language sql stable set search_path to 'public' as $function$
  with raio as materialized (
    select coalesce((select (valor #>> '{}')::integer from parametro
                      where empresa_id = (select minha_empresa())
                        and chave = 'raio_baixa_m'), 200) as m,
           coalesce((select (valor #>> '{}')::integer from parametro
                      where empresa_id = (select minha_empresa())
                        and chave = 'rastro_baixa_tolerancia_min'), 10) as tol,
           coalesce((select (valor #>> '{}')::integer from parametro
                      where empresa_id = (select minha_empresa())
                        and chave = 'rastro_precisao_max_m'), 100) as prec
  ),
  ev as materialized (
    select e.visita_id, e.criado_em, e.tipo, e.login,
           e.lat::double precision as lat, e.lng::double precision as lng, e.precisao_m,
           v.lat::double precision as clat, v.lng::double precision as clng,
           distancia_m(e.lat::double precision, e.lng::double precision,
                       v.lat::double precision, v.lng::double precision) as dist
      from visita_evento e
      join visita v on v.id = e.visita_id
     where e.visita_id = any (p_visitas)
       and e.origem = 'MOBILE'
       and e.lat is not null and e.lng is not null
       and (e.tipo = 'BAIXA'
            or (e.tipo = 'SITUACAO' and e.para->>'situacao' = any (situacoes_terminais())))
  ),
  app as materialized (
    select distinct on (ev.visita_id)
           ev.visita_id, ev.criado_em as em, ev.tipo, ev.login, ev.lat, ev.lng, ev.precisao_m,
           ev.clat, ev.clng, ev.dist, r.m as raio,
           (count(*) over w)::integer as registros,
           (count(*) filter (where ev.dist > r.m) over w)::integer as registros_fora,
           'APP'::text as fonte, null::integer as minutos
      from ev cross join raio r
    window w as (partition by ev.visita_id)
     order by ev.visita_id, ev.dist desc nulls last, ev.criado_em desc
  ),
  -- 155h: a EXECUCAO, nao um instante.
  janela as materialized (
    select v.id, v.tecnico_responsavel_id as tec, v.fim, t.matricula,
           v.lat::double precision as clat, v.lng::double precision as clng,
           coalesce(v.inicio, v.fim) - make_interval(mins => r.tol) as de,
           v.fim + make_interval(mins => r.tol) as ate,
           r.m as raio, r.prec
      from visita v
      cross join raio r
      join tecnico t on t.id = v.tecnico_responsavel_id
     where v.id = any (p_visitas)
       and v.fim is not null
       -- D-103: `fim` vem preenchido ate em atividade so INICIADA.
       and v.finalizado_toa
       and v.situacao = any (situacoes_terminais())
       -- 155h / D-227: so o que alguem ABRIU. Cancelado pela central tem
       -- inicio e fim, e e a janela reservada, nao uma ida.
       and norm_txt(coalesce(v.dados_origem->>'Status da Atividade',''))
             in ('CONCLUIDO', 'NAO CONCLUIDO')
       and not exists (select 1 from app a where a.visita_id = v.id)
  ),
  pts as materialized (
    select j.id as visita_id, rp.capturado_em, rp.lat, rp.lng, rp.precisao_m,
           distancia_m(rp.lat, rp.lng, j.clat, j.clng) as dist,
           j.raio, j.fim, j.matricula, j.clat, j.clng
      from janela j
      join rastro_ponto rp
        on rp.tecnico_id = j.tec
       and rp.capturado_em between j.de and j.ate
       and not rp.simulado
       and coalesce(rp.precisao_m, 0) <= j.prec
  ),
  rastro as materialized (
    select distinct on (p.visita_id)
           p.visita_id, p.capturado_em as em, 'RASTRO_TOA'::text as tipo,
           p.matricula as login, p.lat, p.lng, p.precisao_m::numeric,
           p.clat, p.clng, p.dist, p.raio,
           (count(*) over w)::integer as registros,
           (count(*) filter (where p.dist > p.raio) over w)::integer as registros_fora,
           'RASTRO'::text as fonte,
           round(abs(extract(epoch from (p.capturado_em - p.fim)) / 60))::integer as minutos
      from pts p
    window w as (partition by p.visita_id)
     -- O mais PERTO do cliente; no empate, o mais perto da hora da baixa.
     order by p.visita_id, p.dist asc nulls last,
              abs(extract(epoch from (p.capturado_em - p.fim)))
  ),
  tudo as (select * from app union all select * from rastro)
  select t.visita_id, t.em, t.tipo, t.login, t.lat, t.lng, t.precisao_m,
         t.clat, t.clng, t.dist, t.raio,
         case when t.dist is null then null else t.dist > t.raio end,
         t.registros, t.registros_fora, t.fonte, t.minutos
    from tudo t;
$function$;

comment on function local_da_baixa(uuid[]) is
  'Onde o tecnico estava na baixa (096/135/155h). Baixa pelo app: a coordenada do registro. Baixa no TOA: o ponto do rastro MAIS PERTO do cliente durante a execucao (inicio-10min a fim+10min, precisao <= 100 m). Sem ponto = nulo, nunca dentro.';

insert into parametro (empresa_id, chave, valor, descricao)
select e.id, 'rastro_precisao_max_m', '100'::jsonb,
       'Precisao maxima (m) de um ponto do rastro para valer como prova de local da baixa (155h). O mesmo corte do km do monitoramento.'
  from empresa e
on conflict (empresa_id, chave) do nothing;

revoke all on function local_da_baixa(uuid[]) from public, anon;
grant execute on function local_da_baixa(uuid[]) to authenticated;

notify pgrst, 'reload schema';
