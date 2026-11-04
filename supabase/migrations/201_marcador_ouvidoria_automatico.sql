-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 201 — O marcador OUVIDORIA entra sozinho, pela planilha do TOA        │
-- │                                                                      │
-- │ "lembrando que esse marcador você sobe automático porque lê a        │
-- │  planilha ok" — Emanuel, 03/11 (o marcador nasceu na 200).           │
-- │                                                                      │
-- │ `visita.ouvidoria` é coluna gerada da coluna "Caso crítico           │
-- │ (ouvidoria)" da planilha (123). Gatilho depois de cada importação    │
-- │ (insert, ou update de dados_origem): ouvidoria passou a SIM → põe o  │
-- │ marcador OUVIDORIA com a observação "Automático: …"; deixou de ser → │
-- │ tira só o automático. Só reage quando o VALOR muda — quem tirou à mão│
-- │ não vê voltar a cada importação (a mesma ideia do REV D-10, 194).    │
-- │ A marcação manual pelo site continua; o gatilho nunca a toca.        │
-- │ "UPDATE OF" não aceita coluna gerada: escuta dados_origem e compara  │
-- │ old/new.ouvidoria (num gatilho AFTER a gerada já está calculada).    │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.marca_ouvidoria_automatica()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ind uuid;
begin
  if tg_op = 'UPDATE' and new.ouvidoria is not distinct from old.ouvidoria then
    return null;
  end if;
  select id into v_ind from indicador_qualidade
   where empresa_id = new.empresa_id and nome = 'OUVIDORIA' and ativo limit 1;
  if v_ind is null then return null; end if;

  if coalesce(new.ouvidoria, false) then
    insert into visita_marcador (visita_id, indicador_id, observacao)
    values (new.id, v_ind, 'Automático: caso crítico de ouvidoria na planilha do TOA')
    on conflict (visita_id, indicador_id) do nothing;
  elsif tg_op = 'UPDATE' then
    delete from visita_marcador
     where visita_id = new.id and indicador_id = v_ind and observacao like 'Automático:%';
  end if;
  return null;
exception when others then
  -- marcador nunca derruba a importação
  raise warning 'marca_ouvidoria_automatica falhou na visita %: %', new.id, sqlerrm;
  return null;
end;
$function$;
revoke all on function public.marca_ouvidoria_automatica() from public, anon;

drop trigger if exists trg_visita_ouvidoria on public.visita;
create trigger trg_visita_ouvidoria after insert or update of dados_origem on public.visita
  for each row execute function public.marca_ouvidoria_automatica();

-- os que já estão marcados como ouvidoria na planilha
insert into public.visita_marcador (visita_id, indicador_id, observacao)
select v.id, iq.id, 'Automático: caso crítico de ouvidoria na planilha do TOA'
  from public.visita v
  join public.indicador_qualidade iq on iq.empresa_id = v.empresa_id and iq.nome = 'OUVIDORIA' and iq.ativo
 where v.ouvidoria and v.excluido_em is null
on conflict (visita_id, indicador_id) do nothing;

select count(*) as ouvidoria_marcados from public.visita_marcador vm
  join public.indicador_qualidade iq on iq.id = vm.indicador_id and iq.nome = 'OUVIDORIA';
