-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 160a · O sino diz o CONTRATO e a EQUIPE de cada aviso            ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "essas notificacoes nao mostram o numero do contrato e nem o numero
-- >  da equipe. Mostra apenas o nome. O ideal e que quando eu clique em
-- >  cima, abra o contrato direto"  -- Emanuel, 31/10
--
-- `sinais_do_dia` passa a devolver, em cada sinal:
--   · `equipe`    -- o codigo da equipe (o sinal ja guardava equipe_id);
--   · `contrato`  -- o numero, quando o sinal e de um contrato;
--   · `contratos` -- no QUEBROU, que e agrupado POR TECNICO ("4
--     quebrado(s) hoje"), a lista dos contratos dele quebrados hoje, para
--     a tela abrir cada um. A regra de quebrado e a mesma da
--     `producao_por_tecnico` (D-167): visita nao-jornada com O.S. de
--     codigo IMPRODUTIVO. Lida na hora, nao guardada no sinal.

do $$
declare d text; antes text;
begin
  d := pg_get_functiondef('sinais_do_dia()'::regprocedure); antes := d;
  d := replace(d,
    $a$           'visita_id', s.visita_id, 'tecnico_id', s.tecnico_id, 'criado_em', s.criado_em,$a$,
    $b$           'visita_id', s.visita_id, 'tecnico_id', s.tecnico_id, 'criado_em', s.criado_em,
           'equipe', eq.codigo, 'contrato', vv.contrato, 'contratos', qb.lista,$b$);
  d := replace(d,
    $a$    left join sinal_dispensa d on d.sinal_id = s.id and d.usuario_id = auth.uid()$a$,
    $b$    left join sinal_dispensa d on d.sinal_id = s.id and d.usuario_id = auth.uid()
    -- 160a: equipe, contrato e (no quebrado) os contratos do tecnico hoje.
    left join equipe eq on eq.id = s.equipe_id
    left join visita vv on vv.id = s.visita_id
    left join lateral (
      select jsonb_agg(jsonb_build_object('visita_id', v2.id, 'contrato', v2.contrato)
                       order by v2.janela_inicio nulls last) as lista
        from visita v2
        left join tipo_atividade ta2 on ta2.id = v2.tipo_atividade_id
       where s.tipo = 'QUEBROU'
         and v2.tecnico_responsavel_id = s.tecnico_id
         and v2.data_agendada = s.dia
         and v2.excluido_em is null
         and coalesce(ta2.natureza, 'PRODUTIVA') <> 'JORNADA'
         and exists (select 1 from ordem_servico o
                       join codigo_baixa c on c.id = o.codigo_baixa_id
                      where o.visita_id = v2.id and c.natureza = 'IMPRODUTIVA')
    ) qb on true$b$);
  if d = antes or d !~ 'qb\.lista' or d !~ 'left join lateral' then
    raise exception '160a: as trocas nao pegaram';
  end if;
  execute d;
end $$;
