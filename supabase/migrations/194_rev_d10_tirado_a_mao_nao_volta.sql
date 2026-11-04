-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 194 — REV D-10 tirado à mão não volta naquele contrato                │
-- │                                                                      │
-- │ "se alguém retirar o marcador do sistema manual, o sistema não deve  │
-- │  importar de novo para aquele contrato ok, somente quando for outro  │
-- │  dia e acontece de novo" — Emanuel, 03/11.                           │
-- │                                                                      │
-- │ Até a 193 o relógio recolocava em 5 min o que alguém desmarcou. Agora│
-- │ a retirada do marcador AUTOMÁTICO (observação "Automático:") feita   │
-- │ por gente fica registrada em `rev_d10_recusado`, por VISITA — e      │
-- │ `aplicar_rev_d10` pula essa visita. Outro dia é outra visita: se a   │
-- │ regra valer de novo, marca.                                          │
-- │                                                                      │
-- │ A retirada que o PRÓPRIO relógio faz (caiu em Auditar, cancelado     │
-- │ pela central) não conta como recusa: ele avisa com                   │
-- │ app.origem = 'REV_D10' antes de apagar.                              │
-- └──────────────────────────────────────────────────────────────────────┘

create table if not exists public.rev_d10_recusado (
  visita_id  uuid primary key references public.visita(id) on delete cascade,
  usuario_id uuid,
  em         timestamptz not null default now()
);
-- só o gatilho e o relógio escrevem; ninguém lê nem grava direto
alter table public.rev_d10_recusado enable row level security;
revoke all on public.rev_d10_recusado from anon, authenticated;

create or replace function public.registra_rev_d10_recusado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.observacao like 'Automático:%'
     and coalesce(current_setting('app.origem', true), '') <> 'REV_D10'
     and exists (select 1 from indicador_qualidade iq where iq.id = old.indicador_id and iq.nome = 'REV D-10') then
    insert into rev_d10_recusado (visita_id, usuario_id) values (old.visita_id, auth.uid())
    on conflict (visita_id) do nothing;
  end if;
  return old;
end;
$function$;
revoke all on function public.registra_rev_d10_recusado() from public, anon;

drop trigger if exists trg_rev_d10_recusado on public.visita_marcador;
create trigger trg_rev_d10_recusado after delete on public.visita_marcador
  for each row execute function public.registra_rev_d10_recusado();

create or replace function public.aplicar_rev_d10(p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_de  date := coalesce(p_de, hoje_local());
  v_ate date := coalesce(p_ate, hoje_local() + 1);
  v_ids uuid[];
  n_pos int := 0;
  n_tir int := 0;
begin
  -- só o relógio (sem usuário) ou a gestão chamam
  if auth.uid() is not null and not (select eh_gestao()) then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  -- "só de hoje em diante" (Emanuel, 03/11)
  v_de := greatest(v_de, hoje_local());

  select array_agg(v.id) into v_ids
    from visita v
   where v.data_agendada between v_de and v_ate
     and v.excluido_em is null and v.contrato is not null;
  if v_ids is null then
    return jsonb_build_object('postos', 0, 'tirados', 0);
  end if;

  create temp table if not exists _rev_d10 (visita_id uuid primary key, empresa_id uuid,
                                            marca boolean, obs text) on commit drop;
  truncate _rev_d10;
  insert into _rev_d10
  select v.id, v.empresa_id,
         coalesce(
           r.anterior_situacao = 'CONCLUIDA'
           and r.dias between 0 and 30
           and ((gv.nome = 'VISITA TECNICA' and r.anterior_grupo = 'VISITA TECNICA')
                or (gv.nome = 'RETORNO DE CREDENCIADA'
                    and r.anterior_grupo in ('RETORNO DE CREDENCIADA', 'ADESAO', 'MIGRACAO GPON',
                                             'REINSTALACAO', 'MUDANCA DE ENDERECO')))
           -- Auditar: o 800 do próprio sistema (D-191)
           and v.desatribuido_em is null
           and not exists (select 1 from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                            where o.visita_id = v.id and cb.codigo = 800)
           -- cancelado pela central no TOA
           and not (v.situacao = 'CANCELADA'
                    and norm_txt(coalesce(v.dados_origem ->> 'Status da Atividade', '')) = 'CANCELADO'),
           false),
         'Automático: ' || coalesce(r.anterior_grupo, '?') || ' de '
           || to_char(r.anterior_data, 'DD/MM/YYYY') || ', ' || coalesce(r.dias, 0) || ' dia(s) antes'
           || coalesce(', equipe ' || r.anterior_equipe, '')
    from visita v
    left join tipo_servico gv on gv.id = v.tipo_servico_id
    left join revisita_dos_contratos(v_ids) r on r.visita_id = v.id
   where v.id = any (v_ids);

  -- 194: desmarcado à mão neste contrato → não volta (outro dia é outra visita)
  insert into visita_marcador (visita_id, indicador_id, observacao)
  select x.visita_id, iq.id, x.obs
    from _rev_d10 x
    join indicador_qualidade iq on iq.empresa_id = x.empresa_id and iq.nome = 'REV D-10' and iq.ativo
   where x.marca
     and not exists (select 1 from rev_d10_recusado rr where rr.visita_id = x.visita_id)
  on conflict (visita_id, indicador_id) do nothing;
  get diagnostics n_pos = row_count;

  -- tira só o que ELE pôs e deixou de valer — sem contar como recusa (194)
  perform set_config('app.origem', 'REV_D10', true);
  delete from visita_marcador vm
   using _rev_d10 x, indicador_qualidade iq
   where vm.visita_id = x.visita_id and not x.marca
     and iq.id = vm.indicador_id and iq.nome = 'REV D-10'
     and vm.observacao like 'Automático:%';
  get diagnostics n_tir = row_count;
  perform set_config('app.origem', '', true);

  return jsonb_build_object('postos', n_pos, 'tirados', n_tir);
end;
$function$;

revoke all on function public.aplicar_rev_d10(date, date) from public, anon;
grant execute on function public.aplicar_rev_d10(date, date) to authenticated;

notify pgrst, 'reload schema';
