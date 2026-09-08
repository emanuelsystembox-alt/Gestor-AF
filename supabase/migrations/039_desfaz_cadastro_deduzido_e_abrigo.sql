-- 039 · Desfaz o cadastro de login que eu deduzi, e o abrigo
--
-- ┌─ O QUE EU FIZ DE ERRADO NA 034 ──────────────────────────────────┐
-- │ Semeei 45 cadastros em `equipe.login_toa`, deduzidos da matrícula │
-- │ do técnico. Ninguém cadastrou aquilo. A tela de Equipes passou a  │
-- │ mostrar "Login TOA Z125771" como se fosse declaração do usuário,  │
-- │ e não havia como distinguir o que ele registrou do que eu inferi. │
-- │                                                                   │
-- │ Cadastro é declaração de quem opera. Dedução minha não vira       │
-- │ cadastro só porque ficou parecida com um.                         │
-- └───────────────────────────────────────────────────────────────────┘
--
-- Apagar as 45 NÃO muda para onde os contratos vão: `equipe_do_login`
-- tem três critérios em cascata, e o terceiro é `tecnico.matricula →
-- tecnico.equipe_id`, que veio da planilha de equipes. As 45 linhas
-- eram cópia desse terceiro critério no lugar do segundo.

delete from equipe_login_toa where criado_em >= '2026-09-07';

update equipe e
   set login_toa = null
 where e.login_toa is not null
   and not exists (select 1 from equipe_login_toa h where h.equipe_id = e.id);

-- Volta a 9 equipes com login cadastrado: 001, 004, 005, 010, 011,
-- 014, 016, 033, 036 — as que já estavam lá em 06/09.

-- ============================================================
-- SEM CADASTRO, SEM EQUIPE
-- ============================================================
--
-- A 036 mandava o contrato de login desconhecido para uma equipe abrigo
-- ("SEM-LOGIN"). O Emanuel reviu: o certo é NÃO ir para equipe nenhuma.
--
-- A razão é boa. Contrato dentro de uma equipe — qualquer equipe — já
-- entra em contagem, em produtividade e em comissão. O abrigo tinha
-- nome de alarme mas cheiro de atribuição. Fora de equipe, o contrato
-- aparece no cartão "Fora do cadastro" da tela de Equipes, que é onde
-- ele deve incomodar até alguém cadastrar o login.

do $$
declare src text; novo text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'importar_toa_interno';

  novo := replace(src,
    'v_equipe  := equipe_do_contrato(v_base, v_login, v_data);',
    'v_equipe  := equipe_do_login(v_base, v_login, v_data);');

  if novo = src then
    raise exception 'Nao achei a chamada a equipe_do_contrato no importador.';
  end if;
  execute novo;
end $$;

revoke all on function importar_toa_interno(uuid, boolean) from public, anon;

update visita set equipe_id = null
 where equipe_id in (select id from equipe where codigo = 'SEM-LOGIN');

-- Os eventos que a 036 gerou descrevem uma atribuição que deixou de
-- existir. Histórico tem de contar o que É, não o que chegou a ser por
-- um dia por engano meu.
delete from visita_evento
 where observacao = 'Login nao cadastrado — contrato foi para a equipe abrigo';

drop function if exists equipe_do_contrato(uuid, text, date);
drop function if exists equipe_abrigo(uuid);

delete from equipe where codigo = 'SEM-LOGIN';
comment on table equipe is null;

-- ============================================================
-- Onde cada contrato vai parar, hoje (medido depois de desfazer)
-- ============================================================
--
--   sem login no TOA (jornada) ....................... 158 visitas
--   1 · cadastro de login da equipe .................. 118 visitas ·  9 logins
--   3 · matrícula do técnico → equipe (planilha) ..... 323 visitas · 45 logins
--   4 · login não cadastrado em lugar nenhum ..........  8 visitas ·  1 login
--
-- ⚠ PENDENTE DO EMANUEL: o critério 3 conta como cadastro? Ele não é
--   palpite — sai da planilha de equipes, que é dado declarado —, mas é
--   uma frase diferente de "esta equipe usa o login X do TOA". Se ele
--   NÃO valer, 323 visitas (73% das produtivas) passam a ficar sem
--   equipe até alguém cadastrar login por login.
