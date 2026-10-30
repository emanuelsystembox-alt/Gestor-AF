-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 155d · O RITMO deixa de ser ponto e passa a ser CONTRATO/JANELA  ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "o tecnico de instalacao, ele precisa executar pelo menos 5
-- >  contratos no dia, seja concluido, reagendado ou cancelado, menos
-- >  os cancelados pela central e os auditados (...) o sistema deve
-- >  sinalizar quando o tecnico 10 horas ou 11 horas so fez 1 (...) e
-- >  na VT o calculo e diferente: 3 visitas tecnicas de manha, 1 de 11
-- >  as 14 e mais 3 de 14 as 17. Entao acho um parametro que para cada
-- >  hora, se a equipe nao estiver executando esse padrao, o alerta
-- >  seja acionado"  -- Emanuel, 29/10
--
-- Quantidades confirmadas por ele em 29/10, quando a conta dita nao
-- fechava (3+1+2 da 6, e ele tinha dito 5): ADESAO 5 no dia (2/1/2),
-- MANUTENCAO (VT) 7 no dia (3/1/3). Tudo em PARAMETRO: as janelas e as
-- quantidades mudam sem migration -- inclusive para 3/1/2 se o alerta
-- da manha soar tarde demais na pratica.
--
-- ┌─ o relogio: por que nao `concluida_em` direto ───────────────────┐
-- │ `concluida_em` cai em `situacao_em` quando o TOA nao fechou -- e  │
-- │ `situacao_em` e o now() da IMPORTACAO (D-224), igual para a       │
-- │ planilha inteira. Um ritmo medido nele acusaria o time todo no    │
-- │ mesmo minuto.                                                      │
-- │                                                                    │
-- │ Entao a hora so vale quando o TOA fechou (`finalizado_toa` + fim) │
-- │ ou quando GENTE mexeu (`bloqueado_em`). Medido em 29/10 no dia    │
-- │ inteiro: 282 de 282 concluidas e 23 de 23 reagendadas tem fim do  │
-- │ TOA; das 87 canceladas, 75 nao tem -- e 74 dessas sao justamente  │
-- │ cancelado pela central e desatribuido, que NAO entram na conta.   │
-- │ Sobra 1 contrato do dia sem hora confiavel, e ele vai em          │
-- │ `sem_hora` em vez de entrar como se tivesse acontecido agora.     │
-- └────────────────────────────────────────────────────────────────────┘
--
-- ALERTA SO QUANDO FALTA UM CONTRATO INTEIRO (`esperado >= 1`): as
-- 09:00 o esperado da adesao e 0,5, e ninguem executa meio contrato.
-- As 11:00 ele e 1,5 e quem fez 1 acende -- que e o caso que ele deu.
--
-- CUSTO, que e real: os cortes passaram de 3 (12/15/18) para 10 (9h as
-- 18h), e cada corte x tecnico abaixo vira um sinal. Medido em 29/10
-- rodando a funcao nova sobre o dia inteiro: 328 linhas de "abaixo"
-- somando os dez cortes (10, 35, 42, 30, 38, 35, 28, 36, 41, 33). A
-- tela dele no mesmo dia, com a regra velha, mostrava 93 no historico.
-- Tirar horas de `ritmo_cortes` reduz isso sem tocar em codigo.

insert into parametro (empresa_id, chave, valor, descricao)
select e.id, p.chave, p.valor, p.descricao
  from empresa e
  cross join (values
    ('ritmo_janelas',
     '{"ADESÃO":[{"de":"08:00","ate":"12:00","qtd":2},{"de":"12:00","ate":"15:00","qtd":1},{"de":"15:00","ate":"18:00","qtd":2}],
       "MANUTENÇÃO":[{"de":"08:00","ate":"11:00","qtd":3},{"de":"11:00","ate":"14:00","qtd":1},{"de":"14:00","ate":"17:00","qtd":3}]}'::jsonb,
     'Quantos contratos executados cada skill precisa fechar em cada janela do dia (155d). ADESAO 5 no dia, MANUTENCAO/VT 7. Emanuel, 29/10.')
  ) as p(chave, valor, descricao)
on conflict (empresa_id, chave) do nothing;

-- "para cada hora": os cortes passam a ser de hora em hora.
update parametro set valor = '[9,10,11,12,13,14,15,16,17,18]'::jsonb,
       descricao = 'Horas em que a central confere o ritmo (155d). De hora em hora, a pedido. Tirar horas daqui reduz o volume de sinais.'
 where chave = 'ritmo_cortes';

create or replace function ritmo_do_dia()
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v_hoje date := hoje_local();
  v_agora time := (now() at time zone 'America/Manaus')::time;
  v_janelas jsonb := coalesce(parametro_valor('ritmo_janelas'), '{}'::jsonb);
  v_cortes jsonb := coalesce(parametro_valor('ritmo_cortes'), '[9,10,11,12,13,14,15,16,17,18]'::jsonb);
  c int; v_lim timestamptz; r jsonb := '[]'::jsonb; v_lista jsonb; v_sem int; v_sem_hora int;
begin
  if not eh_gestao() then
    raise exception 'Ritmo e para a gestao.' using errcode = '42501';
  end if;

  for c in select (jsonb_array_elements_text(v_cortes))::int loop
    continue when make_time(c, 0, 0) > v_agora;
    v_lim := (v_hoje + make_time(c, 0, 0)) at time zone 'America/Manaus';

    with tec as materialized (
      select distinct v.tecnico_responsavel_id as id
        from visita v
        left join tipo_atividade ta on ta.id = v.tipo_atividade_id
       where v.empresa_id = minha_empresa() and v.excluido_em is null
         and v.data_agendada = v_hoje
         and v.tecnico_responsavel_id is not null
         and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
         -- 155b: a cidade ATIVA, aqui tambem.
         and v.base_id in (select bases_visiveis())
         and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
    ),
    /*
     * EXECUTADO = concluido, reagendado ou cancelado por codigo.
     * Fora: cancelado pela central (o TOA cancelou antes de alguem ir) e
     * desatribuido/auditar (o 800, que sumiu da planilha). Sao os dois
     * que ele mandou tirar, e os mesmos que ja saem de todo o Dashboard.
     */
    exec as materialized (
      select v.tecnico_responsavel_id as tec,
             case when v.finalizado_toa and v.fim is not null then v.fim
                  when v.bloqueado_em is not null then v.situacao_em end as quando
        from visita v
        left join tipo_atividade ta on ta.id = v.tipo_atividade_id
       where v.tecnico_responsavel_id in (select id from tec)
         and v.data_agendada = v_hoje and v.excluido_em is null
         and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
         and v.situacao in ('CONCLUIDA', 'REAGENDAMENTO', 'CANCELADA')
         and not (v.situacao = 'CANCELADA' and (
                    norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO'
                    or exists (select 1 from ordem_servico o
                                 join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                                where o.visita_id = v.id and cb.codigo = 800)))
    ),
    feito as (
      select tec, count(*) filter (where quando is not null and quando <= v_lim) as qtd,
             count(*) filter (where quando is null) as sem_hora
        from exec group by 1
    ),
    /*
     * O esperado e CUMULATIVO: as janelas cheias que ja passaram, mais a
     * fatia proporcional da janela em curso. Fora de qualquer janela
     * antes da primeira, zero; depois da ultima, o total do dia.
     */
    esperado as (
      select t.id as tec,
             sum(
               case
                 when make_time(c,0,0) >= (j->>'ate')::time then (j->>'qtd')::numeric
                 when make_time(c,0,0) <= (j->>'de')::time  then 0
                 else (j->>'qtd')::numeric
                      * (extract(epoch from (make_time(c,0,0) - (j->>'de')::time))
                         / nullif(extract(epoch from ((j->>'ate')::time - (j->>'de')::time)), 0))
               end) as qtd,
             sum((j->>'qtd')::numeric) as total_dia
        from tec t
        join tecnico tc on tc.id = t.id
        cross join lateral jsonb_array_elements(coalesce(v_janelas -> tc.skill, '[]'::jsonb)) j
       group by t.id
    ),
    conta as (
      select t.id, tc.nome, e.codigo as equipe, tc.skill,
             coalesce(f.qtd, 0)::int as feitos,
             round(es.qtd, 2) as esperado,
             es.total_dia::int as total_dia,
             coalesce(f.sem_hora, 0)::int as sem_hora
        from tec t
        join tecnico tc on tc.id = t.id
        left join equipe e on e.id = tc.equipe_id
        left join feito f on f.tec = t.id
        left join esperado es on es.tec = t.id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'tecnico_id', id, 'nome', nome, 'equipe', equipe, 'frente', skill,
             'feitos', feitos, 'esperado', esperado, 'total_dia', total_dia,
             'detalhe', feitos || ' de ' || esperado || ' contrato(s) ate ' || c
                        || 'h (' || coalesce(skill, 'sem skill')
                        || ', ' || total_dia || ' no dia)')
             order by esperado - feitos desc)
             -- Sem janela cadastrada para a skill: SEM META, nao "abaixo".
             -- E so acende quando falta um contrato INTEIRO.
             filter (where esperado is not null and esperado >= 1 and feitos < esperado), '[]'::jsonb),
           count(*) filter (where esperado is null),
           coalesce(sum(sem_hora), 0)
      into v_lista, v_sem, v_sem_hora
      from conta;

    r := r || jsonb_build_object('corte', c, 'fracao', null,
                                 'abaixo', v_lista, 'sem_meta', v_sem,
                                 'sem_hora', v_sem_hora);
  end loop;
  return r;
end;
$function$;

revoke all on function ritmo_do_dia() from public, anon;
grant execute on function ritmo_do_dia() to authenticated;

notify pgrst, 'reload schema';
