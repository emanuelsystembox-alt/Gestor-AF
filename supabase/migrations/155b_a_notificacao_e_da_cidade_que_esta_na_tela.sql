-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 155b · O SINAL passa a saber de que CIDADE ele é                 ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "as notificacoes tem que ser direcionadas conforme a cidade que
-- >  esta sendo filtrada. Quem esta em Sao Luis nao pode receber uma
-- >  notificacao de Manaus ou de outra cidade"  -- Emanuel, 29/10
--
-- ┌─ a causa, que estava escondida num `or` ─────────────────────────┐
-- │ `equipes_visiveis()` JA filtra por `bases_visiveis()` -- isso    │
-- │ esta certo desde a 103. O que vazava era o atalho que todas as   │
-- │ funcoes da central escreviam:                                     │
-- │                                                                    │
-- │     (eh_gestor() or x.equipe_id in (select equipes_visiveis()))   │
-- │                                                                    │
-- │ Para ADMIN e COP o primeiro lado e verdadeiro, o segundo nunca e  │
-- │ avaliado, e o filtro de cidade some junto. Medido em 29/10:       │
-- │ 510 sinais de Manaus e 16 de Sao Luis no mesmo dia -- e quem      │
-- │ estava com Sao Luis ativa via os 526.                             │
-- │                                                                    │
-- │ O conserto NAO e tirar o `eh_gestor()`: ele existe para o gestor  │
-- │ ver equipe que nao e carteira dele. E acrescentar a cidade ANTES  │
-- │ dele, como uma segunda condicao.                                   │
-- └────────────────────────────────────────────────────────────────────┘
--
-- E `sinal` nao tinha coluna de cidade nenhuma. Em vez de carimbar nos
-- dez INSERTs (e esquecer no decimo primeiro), a cidade vem de GATILHO,
-- deduzida da visita, do tecnico ou da equipe -- o funil, como o
-- `visita_evento` da arquitetura.

alter table sinal add column if not exists base_id uuid references base(id);
create index if not exists sinal_base_idx on sinal (empresa_id, dia, base_id);

create or replace function sinal_carimba_base() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.base_id is null then
    select coalesce(
             (select v.base_id from visita v where v.id = new.visita_id),
             (select t.base_id from tecnico t where t.id = new.tecnico_id),
             (select e.base_id from equipe e where e.id = new.equipe_id))
      into new.base_id;
  end if;
  return new;
end $$;

-- Funcao de gatilho tambem nasce aberta ao anon (a 061 existe por isso).
revoke all on function sinal_carimba_base() from public, anon;

drop trigger if exists sinal_base on sinal;
create trigger sinal_base before insert on sinal
  for each row execute function sinal_carimba_base();

-- Os que ja estavam na tabela.
update sinal s set base_id = coalesce(
         (select v.base_id from visita v where v.id = s.visita_id),
         (select t.base_id from tecnico t where t.id = s.tecnico_id),
         (select e.base_id from equipe e where e.id = s.equipe_id))
 where s.base_id is null;

-- ---------------------------------------------------------------- --
--  central_do_controle: cidade em cada uma das cinco consultas
-- ---------------------------------------------------------------- --
create or replace function central_do_controle()
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v_hoje date := hoje_local(); r jsonb := '{}'::jsonb; v_gestao boolean := eh_gestao();
  v_ajuda jsonb; v_tec1 jsonb; v_quebrou jsonb; v_msg jsonb; v_mat jsonb; v_abast jsonb;
begin
  if not (v_gestao or tem_permissao('almoxarifado.ver') or tem_permissao('frota.ver')) then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;

  if v_gestao then
    -- Pedido de ajuda = Impedimento de hoje cujo ultimo evento veio do CAMPO.
    select coalesce(jsonb_agg(x order by x->>'desde' desc), '[]'::jsonb) into v_ajuda
      from (
        select jsonb_build_object(
                 'visita_id', v.id, 'contrato', v.contrato,
                 'servico', coalesce(ts.nome, ta.nome, 'Visita'),
                 'tecnico', t.nome, 'equipe', e.codigo,
                 'desde', ev.criado_em, 'observacao', ev.observacao) as x
          from visita v
          join lateral (
            select ve.criado_em, ve.observacao, ve.origem from visita_evento ve
             where ve.visita_id = v.id and ve.para->>'situacao' = 'COM_IMPEDIMENTO'
             order by ve.criado_em desc limit 1) ev on ev.origem = 'MOBILE'
          left join tipo_servico ts on ts.id = v.tipo_servico_id
          left join tipo_atividade ta on ta.id = v.tipo_atividade_id
          left join tecnico t on t.id = v.tecnico_responsavel_id
          left join equipe e on e.id = v.equipe_id
         where v.empresa_id = minha_empresa() and v.excluido_em is null
           and v.data_agendada = v_hoje and v.situacao = 'COM_IMPEDIMENTO'
           -- 155b: a cidade ATIVA. `equipes_visiveis()` ja filtra por ela,
           -- mas o `eh_gestor() or` curto-circuitava tudo -- e era por ai
           -- que Manaus chegava em Sao Luis.
           and v.base_id in (select bases_visiveis())
           and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
      ) s;

    select coalesce(jsonb_agg(jsonb_build_object('tecnico_id', tec, 'nome', nome,
                    'equipe', eq, 'qtd', qtd) order by qtd desc), '[]'::jsonb) into v_tec1
      from (
        select v.tecnico_responsavel_id tec, t.nome, e.codigo eq, count(*) qtd
          from visita v
          join tecnico t on t.id = v.tecnico_responsavel_id
          left join equipe e on e.id = t.equipe_id
         where v.empresa_id = minha_empresa() and v.excluido_em is null
           and v.data_agendada = v_hoje and v.tec1 = 'SEM_PADRAO'
           and v.base_id in (select bases_visiveis())
           and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
         group by 1, 2, 3
      ) s;

    -- O escopo filtra ANTES do corte dos 5.
    select coalesce(jsonb_agg(jsonb_build_object('tecnico_id', p.tec, 'nome', p.nome,
                    'equipe', p.eq, 'quebradas', p.quebradas,
                    'pontos_perdidos', p.pontos_perdidos)
                    order by p.quebradas desc, p.pontos_perdidos desc), '[]'::jsonb)
      into v_quebrou
      from (select x.tecnico_id as tec, t.nome, e.codigo as eq, x.quebradas, x.pontos_perdidos
              from producao_por_tecnico(v_hoje, v_hoje) x
              join tecnico t on t.id = x.tecnico_id
              left join equipe e on e.id = t.equipe_id
             where x.quebradas > 0
               and t.base_id in (select bases_visiveis())
               and (eh_gestor() or t.equipe_id in (select equipes_visiveis()))
             order by x.quebradas desc, x.pontos_perdidos desc limit 5) p;

    select coalesce(jsonb_agg(jsonb_build_object('tecnico_id', c.tecnico_id, 'nome', c.nome,
                    'nao_lidas', c.nao_lidas, 'ultima_texto', c.ultima_texto,
                    'ultima_em', c.ultima_em)), '[]'::jsonb)
      into v_msg
      from conversas_do_controle() c where c.nao_lidas > 0;

    r := r || jsonb_build_object('ajuda', v_ajuda, 'tec1', v_tec1,
                                 'ritmo', ritmo_do_dia(), 'quebrou', v_quebrou,
                                 'mensagens', v_msg);
  end if;

  if tem_permissao('almoxarifado.ver') then
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'tipo', s.tipo,
                    'tecnico', t.nome, 'item', coalesce(i.nome, s.serial, s.descricao),
                    'criado_em', s.criado_em) order by s.criado_em desc), '[]'::jsonb)
      into v_mat
      from sinalizacao_material s
      join tecnico t on t.id = s.tecnico_id
      left join item_miscelanea i on i.id = s.item_id
     where s.empresa_id = minha_empresa() and s.situacao = 'ABERTA'
       and s.assunto = 'FERRAMENTAL'
       and t.base_id in (select bases_visiveis());
    r := r || jsonb_build_object('material', v_mat);
  end if;

  if tem_permissao('frota.ver') then
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'placa', v.placa,
                    'tecnico', t.nome, 'valor', a.valor, 'criado_em', a.criado_em)
                    order by a.criado_em desc), '[]'::jsonb)
      into v_abast
      from abastecimento a
      join veiculo v on v.id = a.veiculo_id
      left join tecnico t on t.id = a.tecnico_id
     where a.empresa_id = minha_empresa() and a.situacao = 'EM_ABERTO'
       -- Sem condutor, a cidade e a do CARRO: o pedido continua sendo
       -- de alguma praca, e sumir dele seria pior que mostrar demais.
       and coalesce(t.base_id, v.base_id) in (select bases_visiveis());
    r := r || jsonb_build_object('abastecimento', v_abast);
  end if;

  return r || jsonb_build_object('gerado_em', now());
end;
$function$;

revoke all on function central_do_controle() from public, anon;
grant execute on function central_do_controle() to authenticated;

notify pgrst, 'reload schema';
