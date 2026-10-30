-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 158d · Os selos do menu (e três leituras) ficaram na regra velha ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "login do renan nao aparece a quantidade de equipes? qual o motivo?"
-- >  -- Emanuel, 31/10 (Servicos 0, Equipes 0 no menu)
--
-- A 156a/158b trocaram o escopo de leitura ("toda a gestao ve a cidade")
-- nas policies e nas funcoes que a tela de Rota/Servicos usa -- mas nao
-- nestas cinco, que ainda diziam `eh_gestor() or x in equipes_visiveis()`:
-- so ADMIN/COP passavam, e o controlador (sem carteira, D-238) via ZERO.
--   volume_do_dia      -> selo de Servicos no menu
--   equipes_em_rota    -> selo de Equipes no menu
--   impacto_quebra     -> painel de quebra do Dashboard
--   material_do_toa, miscelanea_do_contrato -> cartoes do contrato
-- Achadas pelo padrao no texto de TODAS as funcoes, nao uma a uma.
--
-- Troca: `(ve_cidade_inteira() and v.base_id in (select bases_visiveis()))
-- or v.equipe_id in (select equipes_legiveis())`. A cidade vem como
-- condicao propria, ANTES do "ou" (armadilha da D-235): duas destas cinco
-- nao filtravam cidade, e com o `eh_gestor()` solto o COP ja via contrato
-- de outra cidade por elas.
--
-- Ficaram DE FORA, de proposito: conversas_do_controle, enviar_mensagem,
-- marcar_conversa_lida, marcar_avisos_lidos -- conversa nao abre pela
-- cidade (D-236).

do $$
declare f text; d text; antes text;
begin
  foreach f in array array['volume_do_dia','equipes_em_rota','impacto_quebra',
                           'material_do_toa','miscelanea_do_contrato'] loop
    d := pg_get_functiondef(f::regproc); antes := d;
    d := regexp_replace(d,
      'eh_gestor\(\)\s+or\s+([a-z_]+)\.equipe_id\s+in\s+\(select equipes_visiveis\(\)\)',
      '(ve_cidade_inteira() and \1.base_id in (select bases_visiveis())) or \1.equipe_id in (select equipes_legiveis())',
      'g');
    if d = antes then raise exception '158d: padrao nao achado em %', f; end if;
    execute d;
  end loop;
end $$;
