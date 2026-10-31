-- ┌─ 164 · o card de REVISITA no painel do técnico ───────────────────┐
-- │ > "colocar um card chamado revisita (...) para o técnico de adesão │
-- │ >  ou instalação: é tudo que ele conclui; as revisitas é tudo que  │
-- │ >  volta de retorno, então a conta seria retorno dividido pelo     │
-- │ >  total de conclusão (...) Para o time de manutenção e somente    │
-- │ >  visita técnica, é tudo que é concluída, reagendado, cancelado — │
-- │ >  cancelado central não conta e auditar também não — então é a VT │
-- │ >  que retornou dividido pelo total que ele fez e visitou o        │
-- │ >  cliente" — Emanuel, 31/10                                       │
-- │                                                                    │
-- │ Respostas do Emanuel às perguntas (31/10):                         │
-- │  · a revisita conta para quem fez o serviço ANTERIOR (o trabalho   │
-- │    dele voltou), não para quem atendeu o retorno;                  │
-- │  · o total são os serviços dele NO PERÍODO; o retorno conta até 30 │
-- │    dias depois, mesmo caindo no mês seguinte (o "este mês" ainda   │
-- │    sobe até fechar 30 dias);                                       │
-- │  · ADESÃO (e toda skill que não é MANUTENÇÃO):                     │
-- │      total    = os contratos que ele CONCLUIU;                     │
-- │      revisita = desses, os que voltaram com o par da 163:          │
-- │                 qualquer → VISITA TECNICA; ADESAO, MIGRACAO GPON,  │
-- │                 REINSTALACAO, MUDANCA DE ENDERECO, RETORNO →       │
-- │                 RETORNO DE CREDENCIADA ("retorno e também VT");    │
-- │  · MANUTENÇÃO:                                                     │
-- │      total    = as VISITAS TÉCNICAS dele concluídas, reagendadas   │
-- │                 ou canceladas — fora o cancelado pela central e o  │
-- │                 desatribuído (o "Auditar"), onde ninguém foi;      │
-- │      revisita = desses, os que voltaram em VISITA TECNICA, depois  │
-- │                 de QUALQUER visita dele (concluída, reagendada ou  │
-- │                 cancelada — escolha do Emanuel).                   │
-- │                                                                    │
-- │ "Voltou" = outra visita do MESMO contrato, de 0 a 30 dias depois   │
-- │ (no mesmo dia, criada depois). Total zero = pct NULO, nunca 0%     │
-- │ (regra 6). Jornada não entra (não tem contrato).                   │
-- │                                                                    │
-- │ O cancelado pela central e o desatribuído são os mesmos de         │
-- │ `origemCancelada()` da web (lib/filtroContratos.ts): CANCELADA com │
-- │ "Status da Atividade" do TOA = cancelado (no `dados_origem`), e    │
-- │ qualquer visita com 800 na baixa da AFLINE.                        │
-- └────────────────────────────────────────────────────────────────────┘

create or replace function public.revisita_do_tecnico(p_de date, p_ate date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tec uuid := meu_tecnico_id();
  v_skill text;
  v_manut boolean;
  v_total bigint;
  v_rev bigint;
begin
  if v_tec is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  select skill into v_skill from tecnico where id = v_tec;
  v_manut := norm_txt(coalesce(v_skill, '')) = norm_txt('MANUTENÇÃO');

  with base as materialized (
    select v.id, v.empresa_id, v.contrato, v.data_agendada, v.criado_em, v.situacao,
           g.nome as grupo,
           -- o "Status da Atividade" do TOA vem só no JSON cru (como na web)
           norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) as status_toa
      from visita v
      left join tipo_servico g on g.id = v.tipo_servico_id
     where v.tecnico_responsavel_id = v_tec
       and v.excluido_em is null
       and v.contrato is not null
       and v.data_agendada between p_de and p_ate
  ),
  meus as (
    select b.* from base b
     where case when v_manut then
             b.grupo = 'VISITA TECNICA'
             and b.situacao in ('CONCLUIDA', 'REAGENDAMENTO', 'CANCELADA')
             -- o desatribuído (800 na baixa da AFLINE) — o "Auditar"
             and not exists (select 1 from ordem_servico o
                               join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                              where o.visita_id = b.id and cb.codigo = 800)
             -- o cancelado pela central (status do TOA "CANCELADO")
             and not (b.situacao = 'CANCELADA' and b.status_toa = 'CANCELADO')
           else
             b.situacao = 'CONCLUIDA'
           end
  ),
  voltou as (
    select m.id from meus m
     where exists (
       select 1 from visita d
         left join tipo_servico gd on gd.id = d.tipo_servico_id
        where d.empresa_id = m.empresa_id and d.contrato = m.contrato
          and d.id <> m.id and d.excluido_em is null
          and (d.data_agendada > m.data_agendada
               or (d.data_agendada = m.data_agendada and d.criado_em > m.criado_em))
          and d.data_agendada - m.data_agendada <= 30
          and case when v_manut then
                gd.nome = 'VISITA TECNICA'
              else
                gd.nome = 'VISITA TECNICA'
                or (gd.nome = 'RETORNO DE CREDENCIADA'
                    and m.grupo in ('ADESAO', 'MIGRACAO GPON', 'REINSTALACAO',
                                    'MUDANCA DE ENDERECO', 'RETORNO DE CREDENCIADA'))
              end)
  )
  select (select count(*) from meus), (select count(*) from voltou)
    into v_total, v_rev;

  return jsonb_build_object(
    'modelo', case when v_manut then 'MANUTENCAO' else 'ADESAO' end,
    'skill', v_skill,
    'total', v_total,
    'revisitas', v_rev,
    'pct', case when v_total = 0 then null
                else round(100.0 * v_rev / v_total, 1) end);
end;
$function$;

revoke all on function public.revisita_do_tecnico(date, date) from public, anon;
grant execute on function public.revisita_do_tecnico(date, date) to authenticated, service_role;

notify pgrst, 'reload schema';
