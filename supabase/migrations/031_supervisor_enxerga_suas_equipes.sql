-- 031 · O papel SUPERVISOR não enxergava nada.
--
-- ┌─ COMO ISTO APARECEU ─────────────────────────────────────────────┐
-- │ Ao montar os logins de teste (app/scripts/criar-usuarios-teste),  │
-- │ o usuário com papel SUPERVISOR entrava e via tela vazia.          │
-- │                                                                   │
-- │ `equipes_visiveis()` decidia visibilidade por três caminhos: ser   │
-- │ gestor, ser controlador da equipe (direto ou por carteira), ou    │
-- │ ser técnico dela. O supervisor não estava em nenhum.              │
-- └───────────────────────────────────────────────────────────────────┘
--
-- A coluna `equipe.supervisor_id` já existia para isto e estava em
-- 0 de 89 equipes: ninguém tinha sido ligado ainda. Acrescentar o
-- caminho é inócuo hoje — não muda uma linha sequer do que se enxerga —
-- e faz o papel funcionar no instante em que os supervisores forem
-- vinculados.
--
-- `supervisor_nome` (85 de 89) é texto vindo do TOA e NÃO serve de
-- chave: nome bate por acaso e deixa de bater por acento. O vínculo
-- tem de ser pelo id do usuário.
--
-- ⚠ PENDENTE PARA O EMANUEL: ligar cada supervisor real ao usuário
--   dele em `equipe.supervisor_id`. Enquanto isso não acontecer, o
--   papel SUPERVISOR continua enxergando zero — o que está certo, e é
--   melhor que enxergar tudo.

create or replace function equipes_visiveis()
returns setof uuid language sql stable security definer
set search_path to 'public' as $fn$
  with permitidas as (select id from base where id in (select bases_visiveis()))
  select e.id from equipe e
   where e.empresa_id = minha_empresa()
     and e.base_id in (select id from permitidas)
     and (
       eh_gestor()
       or e.controlador_id = auth.uid()
       or e.supervisor_id  = auth.uid()
       or exists (select 1 from carteira c
                   where c.equipe_id = e.id and c.controlador_id = auth.uid()
                     and c.inicio <= current_date
                     and (c.fim is null or c.fim >= current_date))
       or exists (select 1 from tecnico t
                   where t.equipe_id = e.id and t.usuario_id = auth.uid())
     );
$fn$;

revoke all on function equipes_visiveis() from public, anon;

-- Conferido depois de aplicar:
--   has_function_privilege('anon', 'equipes_visiveis()', 'EXECUTE') = false
--   select * from testar_policies();  -- 16 de 16
