-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 238 — Pós-atendimento: cancelado pela central na fila, os filtros de │
-- │       ouvidoria / marcador / supervisor / área e o desfecho          │
-- │       "Refazer cabeamento"                                           │
-- │                                                                      │
-- │ > "Pós atendimento não mostra contratos cancelado pela central, o    │
-- │ >  pós deve enxergar esses casos para tratativa."                    │
-- │ > "O sistema de Pós atendimento deve mostrar filtros de log,         │
-- │ >  ouvidoria, e marcadores, supervisor, área."  — Emanuel, 09/11     │
-- │                                                                      │
-- │ A. A FILA tirava o cancelado pela central de propósito (148: "tudo   │
-- │    onde o técnico FOI", D-228): `not (CANCELADA and (status TOA      │
-- │    CANCELADO or cancelado_central_em or 800))`. Agora só o 800       │
-- │    (Desatribuído, cancelamento do PRÓPRIO sistema) continua fora; o  │
-- │    cancelado pela central entra, com a marca `cancelado_central`.    │
-- │    A regra é a canônica — `cancelado_pela_central(status, motivo)`   │
-- │    OU a marca do COP (208, D-306), a mesma de `origem_do_cancelamento`│
-- │    e de `origemCancelada()` na web. A conta antiga olhava só o       │
-- │    status CANCELADO e não via o NETSMS (198, 227).                   │
-- │                                                                      │
-- │    Efeito colateral, esperado: os indicadores do Painel leem a fila  │
-- │    (`qualidade_indicadores`, `_por_grupo`, `_observacoes`), então o  │
-- │    "na fila" e a cobertura passam a contar esses contratos.          │
-- │                                                                      │
-- │ B. A fila devolve o que os filtros novos precisam: `ouvidoria`       │
-- │    (caso crítico da planilha, 123, OU o marcador OUVIDORIA, 200/201 —│
-- │    o automático nasce da mesma coluna, o manual é do COP),           │
-- │    `supervisor` na ordem da D-134 (173: o declarado no técnico → o   │
-- │    login ligado à equipe → o texto da planilha) e `marcadores`, os   │
-- │    nomes dos indicadores aplicados. A área já vinha.                 │
-- │    Coluna nova no `returns table` exige DROP (traps.md) — e função   │
-- │    recriada nasce com a ACL aberta: revoke/grant logo abaixo.        │
-- │                                                                      │
-- │ C. Desfecho REFAZER_CABEAMENTO: o CHECK de `pesquisa_qualidade`      │
-- │    é lista fechada (traps.md) e se amplia aqui. Conta como           │
-- │    `qualidade_conclusivo` — veredito técnico, não normalizado, logo  │
-- │    PROBLEMA nos contadores — como o SERVICO_FALHA. `qualidade_       │
-- │    contatado` já o aceita (só recusa NAO_ATENDEU e SEM_NUMERO).      │
-- │    ⚠ O grupo é escolha da sessão, a confirmar com o Emanuel.         │
-- └──────────────────────────────────────────────────────────────────────┘

-- ─── C. o desfecho novo ─────────────────────────────────────────────────
alter table public.pesquisa_qualidade drop constraint pesquisa_qualidade_desfecho_check;
alter table public.pesquisa_qualidade add constraint pesquisa_qualidade_desfecho_check
  check (desfecho = any (array['NORMALIZADO','SERVICO_FALHA','REFAZER_CABEAMENTO',
    'PROBLEMA_CRITICO','SEM_ATIVO','DESEJA_CANCELAMENTO','REDE_EXTERNA',
    'NAO_QUIS_RESPONDER','NAO_ATENDEU','SEM_NUMERO']));

-- create or replace preserva a ACL (é IMMUTABLE, sem SECURITY DEFINER)
create or replace function public.qualidade_conclusivo(p_desfecho text)
 returns boolean
 language sql
 immutable
as $function$
  select p_desfecho in ('NORMALIZADO','SERVICO_FALHA','REFAZER_CABEAMENTO',
                        'PROBLEMA_CRITICO','SEM_ATIVO','DESEJA_CANCELAMENTO');
$function$;

-- ─── A + B. a fila ─────────────────────────────────────────────────────
drop function public.qualidade_fila(date, date);

create function public.qualidade_fila(p_de date, p_ate date)
 returns table(visita_id uuid, contrato text, cliente_nome text, endereco text, bairro text,
   grupo text, situacao_contrato text, status_toa text, data_agendada date, operacao text,
   equipe text, area text, tecnico text, tecnico_id uuid, encerrou timestamp with time zone,
   janela text, baixa_codigo integer, baixa_descricao text, baixa_natureza text,
   contador_log integer, tem_improdutiva boolean, desfecho text, canal text, telefone text,
   nota_tecnico smallint, tratou_bem boolean, observacao text, tentativas smallint,
   registrado_em timestamp with time zone, analista text,
   aguardando_em timestamp with time zone, aguardando_canal text, aguardando_por text,
   cancelado_central boolean, ouvidoria boolean, supervisor text, marcadores text[])
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  /*
   * 148: a fila traz tudo o que os filtros precisam numa consulta so;
   * filtrar no cliente e deliberado (~300 linhas no dia).
   *
   * 213: + o "aguardando cliente" ABERTO, com quem marcou.
   *
   * 238: o cancelado pela central ENTRA (antes ficava fora, D-228) e vem
   * marcado em `cancelado_central`; so o Desatribuido (800) continua fora.
   * + ouvidoria, supervisor (D-134) e marcadores, para os filtros da tela.
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
         q.desfecho, q.canal, coalesce(q.telefone, agt.telefone, cc.telefone),
         q.nota_tecnico, q.tratou_bem, q.observacao,
         coalesce(q.tentativas, 0::smallint), q.registrado_em, p.nome,
         ag.marcado_em, ag.canal, pa.nome,
         -- a regra canonica (198, 208, 227): status/motivo do TOA OU a marca do COP
         (v.situacao = 'CANCELADA'
          and (cancelado_pela_central(v.dados_origem->>'Status da Atividade',
                                      v.dados_origem->>'Motivo de Fechamento Externo')
               or v.cancelado_central_em is not null)),
         coalesce(v.ouvidoria, false) or coalesce('OUVIDORIA' = any (mk.nomes), false),
         -- D-134: o declarado no tecnico -> o login ligado a equipe -> a planilha
         coalesce(ps.nome, pe.nome, nullif(btrim(e.supervisor_nome), '')),
         coalesce(mk.nomes, '{}'::text[])
    from visita v
    join tipo_atividade ta on ta.id = v.tipo_atividade_id
    left join tipo_servico ts on ts.id = v.tipo_servico_id
    left join base b on b.id = v.base_id
    left join equipe e on e.id = v.equipe_id
    left join perfil pe on pe.id = e.supervisor_id
    left join area_trabalho a on a.id = v.area_id
    left join tecnico tc on tc.id = v.tecnico_responsavel_id
    left join perfil ps on ps.id = tc.supervisor_id
    left join pesquisa_qualidade q on q.visita_id = v.id
    left join perfil p on p.id = q.usuario_id
    left join qualidade_aguardando ag on ag.visita_id = v.id and ag.encerrado_em is null
    left join perfil pa on pa.id = ag.usuario_id
    -- a baixa da O.S. de menor sequencia que tenha uma: e a que a CLARO
    -- reconhece, a mesma escolha da reincidencia (033)
    left join lateral (
      select cb.codigo, cb.descricao, cb.natureza
        from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_id
       where o.visita_id = v.id order by o.sequencia limit 1
    ) bx on true
    -- o ultimo telefone digitado ao marcar aguardando, aberto ou fechado
    left join lateral (
      select x.telefone from qualidade_aguardando x
       where x.visita_id = v.id and x.telefone is not null
       order by x.marcado_em desc limit 1
    ) agt on true
    left join lateral (
      select cc.telefone from contato_cliente cc
       where cc.visita_id = v.id and cc.informou limit 1
    ) cc on true
    left join lateral (
      select array_agg(iq.nome order by iq.ordem, iq.nome) as nomes
        from visita_marcador vm join indicador_qualidade iq on iq.id = vm.indicador_id
       where vm.visita_id = v.id
    ) mk on true
   where v.data_agendada between p_de and p_ate
     and v.excluido_em is null
     and v.contrato is not null
     and ta.natureza = 'PRODUTIVA'
     and v.situacao in ('CANCELADA','CONCLUIDA','REAGENDAMENTO')
     -- so o Desatribuido (800 na baixa da AFLINE, D-191) fica fora
     and not (v.situacao = 'CANCELADA' and exists (
          select 1 from ordem_servico o
            join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
           where o.visita_id = v.id and cb.codigo = 800))
     and v.empresa_id = (select minha_empresa())
     and v.base_id in (select bases_visiveis())
     and (select tem_permissao('qualidade.ver'))
   order by (q.desfecho is null) desc, v.fim desc nulls last;
$function$;

revoke all on function public.qualidade_fila(date, date) from public, anon;
grant execute on function public.qualidade_fila(date, date) to authenticated, service_role;

notify pgrst, 'reload schema';
