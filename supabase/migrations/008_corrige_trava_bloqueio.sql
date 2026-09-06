-- D-006 corrigido.
-- Antes: o trigger armava a trava tambem no INSERT, entao uma visita
-- que ja chegava concluida do TOA nascia travada e o TOA jamais
-- conseguia corrigi-la. A trava passa a significar o que deveria:
-- "uma acao de CAMPO mexeu nesta visita".
--
-- Regra: so arma em UPDATE, e nunca quando o autor e a importacao.
-- A importacao se identifica com  set local app.origem = 'IMPORTACAO'.

create or replace function marca_bloqueio()
returns trigger language plpgsql as $fn$
begin
  new.atualizado_em := now();

  -- INSERT nunca trava: o estado inicial e sempre do TOA
  if TG_OP = 'INSERT' then
    return new;
  end if;

  -- escrita feita pelo importador nao trava
  if coalesce(current_setting('app.origem', true), '') = 'IMPORTACAO' then
    return new;
  end if;

  if new.bloqueado_em is null
     and new.situacao is distinct from old.situacao
     and new.situacao in ('EM_DESLOCAMENTO','EM_EXECUCAO','CONCLUIDA',
                          'REAGENDAMENTO','COM_IMPEDIMENTO') then
    new.bloqueado_em := now();
  end if;

  return new;
end;
$fn$;

update visita set bloqueado_em = null
where bloqueado_em is not null
  and not exists (
    select 1 from visita_evento ev
    where ev.visita_id = visita.id and ev.tipo <> 'IMPORTADA'
  );
