-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 192 — Os telefones que o cliente já deu, em atendimentos anteriores   │
-- │                                                                      │
-- │ "os números de telefone já subir no nosso sistema, para quando esse  │
-- │  contrato voltar de novo, já aparecer para o técnico que já foi      │
-- │  cadastrado anteriormente" — Emanuel, 03/11, com a carga histórica   │
-- │ do ngestor (jan–out/2026, D-282).                                    │
-- │                                                                      │
-- │ Para a visita aberta: os telefones das OUTRAS visitas do mesmo       │
-- │ contrato (o TOA e a carga histórica gravam em visita.telefones) e o  │
-- │ melhor contato que um técnico informou (096, contato_cliente), do    │
-- │ mais recente para o mais antigo, sem repetir. O que já está nesta    │
-- │ visita não volta.                                                    │
-- │                                                                      │
-- │ DEFINER porque as visitas anteriores são de outras equipes (o RLS do │
-- │ técnico não as mostra). O escopo é o de `casa_do_cliente`: quem não  │
-- │ vê a visita pedida não recebe nada. Só o número sai — nunca o resto  │
-- │ da visita antiga.                                                    │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.telefones_do_cliente(p_visita uuid)
returns table (telefone text, origem text, visto_em date)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with vis as materialized (
    select v.id, v.empresa_id, v.contrato, coalesce(v.telefones, '{}') as atuais
      from visita v
     where v.id = p_visita
       and v.empresa_id = (select minha_empresa())
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_legiveis()))
       and v.contrato is not null
  ),
  todos as (
    select btrim(t) as telefone, 'ATENDIMENTO'::text as origem, a.data_agendada as visto_em
      from vis
      join visita a on a.empresa_id = vis.empresa_id and a.contrato = vis.contrato
                   and a.id <> vis.id and a.excluido_em is null
      cross join lateral unnest(a.telefones) t
    union all
    select btrim(c.telefone), 'MELHOR_CONTATO', a.data_agendada
      from vis
      join visita a on a.empresa_id = vis.empresa_id and a.contrato = vis.contrato
                   and a.excluido_em is null
      join contato_cliente c on c.visita_id = a.id
     where c.telefone is not null
  ),
  unicos as (
    select distinct on (regexp_replace(t.telefone, '\D', '', 'g'))
           t.telefone, t.origem, t.visto_em
      from todos t
     where t.telefone <> ''
       and regexp_replace(t.telefone, '\D', '', 'g') not in
           (select regexp_replace(x, '\D', '', 'g') from vis, unnest(vis.atuais) x)
     order by regexp_replace(t.telefone, '\D', '', 'g'),
              (t.origem = 'MELHOR_CONTATO') desc, t.visto_em desc
  )
  -- todos: "se no histórico tiver mais de um número, tem que trazer sempre
  -- todos" (Emanuel, 03/11)
  select telefone, origem, visto_em from unicos
   order by (origem = 'MELHOR_CONTATO') desc, visto_em desc;
$function$;

revoke all on function public.telefones_do_cliente(uuid) from public, anon;
grant execute on function public.telefones_do_cliente(uuid) to authenticated;

-- a busca é por contrato: sem índice, cada abertura varre a tabela inteira
create index if not exists visita_empresa_contrato_ix on public.visita (empresa_id, contrato);

notify pgrst, 'reload schema';
