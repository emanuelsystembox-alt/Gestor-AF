-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 161d · O rastro responde se o técnico está EM EXECUÇÃO           ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "GPS de alta precisao durante a execucao: esta so proposto." --
-- > "pode rodar."  -- Emanuel, 31/10
--
-- O aplicativo passa a tirar leitura de ALTA precisao (satelite) a cada
-- 2 min enquanto houver contrato do tecnico EM EXECUCAO -- e so entao: e
-- quando o local da baixa e decidido (155h, a janela de execucao inteira) e
-- o raio de 200 m precisa de ponto bom. Fora disso a leitura continua
-- "Balanced", que gasta menos bateria.
--
-- Quem sabe se ha execucao em andamento e o banco, nao a tela: o app ja
-- pergunta a cada envio de pontos se a rota esta aberta; agora a resposta
-- traz tambem `em_execucao`. App antigo ignora a chave nova.
-- (`situacao_em` nao entra aqui: so a situacao atual importa.)
--
-- Jornada (Refeicao, Na Base) fica de fora, como na `rota_aberta`: medido
-- no primeiro teste, o tecnico estava "em execucao" de uma jornada com a
-- rota fechada -- satelite ligado no almoco nao serve a nada.

do $$
declare d text; antes text;
begin
  d := pg_get_functiondef('registrar_rastro(jsonb)'::regprocedure); antes := d;
  d := replace(d,
    $a$  return jsonb_build_object('gravados', v_n, 'rota_aberta', v_aberta,
                            'bloqueado', gps_bloqueado(v_tec));$a$,
    $b$  return jsonb_build_object('gravados', v_n, 'rota_aberta', v_aberta,
                            'bloqueado', gps_bloqueado(v_tec),
                            -- 161d: o app liga a leitura de alta precisao.
                            'em_execucao', exists (
                              select 1 from visita v
                                left join tipo_atividade ta on ta.id = v.tipo_atividade_id
                               where v.data_agendada = hoje_local()
                                 and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
                                 and v.excluido_em is null
                                 and v.situacao = 'EM_EXECUCAO'
                                 and (v.tecnico_responsavel_id = v_tec
                                      or (v.tecnico_responsavel_id is null and v.equipe_id = v_equipe))));$b$);
  if d = antes then raise exception '161d: retorno de registrar_rastro nao achado'; end if;
  execute d;
end $$;
-- No banco foi aplicada em DUAS vezes: `161d_rastro_diz_se_esta_em_execucao`
-- (sem o filtro de jornada) e `161d2_em_execucao_sem_jornada` (acrescenta o
-- filtro). O bloco acima e o estado final, para quem recriar do zero.
