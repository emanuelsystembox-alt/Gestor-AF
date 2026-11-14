-- 268 · A Manutenção Indoor não entra na revisita (D-383)
--
-- > "não é para considerar como revisita, uma o.s de manutenção indoor, apesar de ser uma o.s de VT
-- >  ela não causa impacto (...) precisa corrigir em nossos medidores de revisita" — Emanuel, 14/11
--
-- Perguntado e respondido (14/11):
--   · a Indoor NUNCA é revisita (quando é a visita nova);
--   · quando é a ANTERIOR, é PULADA: vale a visita antes dela (como o Auditar e o cancelado pela
--     central na Revisita 30 D, D-363);
--   · ela FICA NA BASE (o "VT na conta", o denominador da Revisita 30 D e da nota do técnico);
--   · só a Indoor — Manut Drop, Manut Ruído, Atendimento Prioritário e VT Cump Especial seguem como VT.
--
-- O tipo NÃO fica escrito nas funções: `tipo_atividade.fora_da_revisita` (marcado na
-- "Manutencao Indoor"). Outro tipo que um dia precise sair é marcar, não reescrever régua.
--
-- Mexe nas três funções que decidem revisita — todas as telas e relógios seguem delas:
--   anteriores_dos_contratos ← revisita_dos_contratos: Revisita por causa, REV D-10 (o relógio já
--     tira a marca do dia que deixou de valer; os dias passados ficam), resumo das 18h, sinal do
--     contrato, risco de quebra, a janela do LOG, a revisita ofensora do Dashboard VT;
--   revisita_30d_vt: Revisita 30 D do Dashboard VT, indicador Revisita Técnica, risco de revisita;
--   revisita_do_tecnico: o card do aplicativo (conta própria, D-246).
-- Funções lidas do BANCO (pg_get_functiondef).

alter table public.tipo_atividade add column if not exists fora_da_revisita boolean not null default false;
comment on column public.tipo_atividade.fora_da_revisita is
  'D-383: visita deste tipo nunca é revisita e é pulada como anterior; fica na base. Hoje: Manutencao Indoor.';
update public.tipo_atividade set fora_da_revisita = true where norm_txt(nome) = 'MANUTENCAO INDOOR';

CREATE OR REPLACE FUNCTION public.anteriores_dos_contratos(p_visitas uuid[], p_qualquer_situacao boolean)
 RETURNS TABLE(visita_id uuid, anterior_id uuid, anterior_data date, anterior_grupo text, anterior_situacao text, anterior_equipe text, anterior_tecnico text, anterior_baixa_codigo integer, anterior_baixa_descricao text, dias integer, revisita boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select v.id,
         a.id, a.data_agendada, a.grupo, a.situacao,
         e.codigo, t.nome,
         cb.codigo, cb.descricao,
         v.data_agendada - a.data_agendada,
         coalesce(
           (p_qualquer_situacao or a.situacao = 'CONCLUIDA')
           and v.data_agendada - a.data_agendada between 0 and 30
           and par_de_revisita(gv.nome, a.grupo)
           -- 268 (D-383): a Manutenção Indoor (tipo marcado) nunca é revisita
           and not coalesce(tv.fora_da_revisita, false), false)
    from visita v
    left join tipo_servico gv on gv.id = v.tipo_servico_id
    left join tipo_atividade tv on tv.id = v.tipo_atividade_id
    left join lateral (
      select x.*, gx.nome as grupo from visita x
        left join tipo_servico gx on gx.id = x.tipo_servico_id
       where x.empresa_id = v.empresa_id and x.contrato = v.contrato
         and x.id <> v.id and x.excluido_em is null
         and (x.data_agendada < v.data_agendada
              or (x.data_agendada = v.data_agendada and x.criado_em < v.criado_em))
         -- 241: na janela do LOG, só os 30 dias antes
         and (not p_qualquer_situacao or x.data_agendada >= v.data_agendada - 30)
         -- 268 (D-383): a Manutenção Indoor é PULADA como anterior — vale a visita antes dela
         and not exists (select 1 from tipo_atividade tx
                          where tx.id = x.tipo_atividade_id and tx.fora_da_revisita)
       -- sem o interruptor: a concluída mais recente; sem concluída, a mais recente
       -- de todas (163). Com ele: primeiro a que faz par (241).
       order by (p_qualquer_situacao and par_de_revisita(gv.nome, gx.nome)) desc,
                (x.situacao = 'CONCLUIDA') desc, x.data_agendada desc, x.criado_em desc
       limit 1
    ) a on true
    left join equipe e        on e.id = a.equipe_id
    left join tecnico t       on t.id = a.tecnico_responsavel_id
    -- A baixa da OPERADORA na menor sequência (a que a CLARO reconhece,
    -- D-042, como na 033); sem ela, a da AFLINE.
    left join lateral (
      select coalesce(o.codigo_baixa_id, o.codigo_baixa_afline_id) as id
        from ordem_servico o
       where o.visita_id = a.id
         and (o.codigo_baixa_id is not null or o.codigo_baixa_afline_id is not null)
       order by (o.codigo_baixa_id is null), o.sequencia
       limit 1
    ) ob on true
    left join codigo_baixa cb on cb.id = ob.id
   where v.id = any(p_visitas)
     and v.contrato is not null;
$function$;

CREATE OR REPLACE FUNCTION public.revisita_30d_vt(p_visitas uuid[])
 RETURNS TABLE(visita_id uuid, anterior_id uuid, anterior_data date, anterior_situacao text, anterior_equipe text, anterior_tecnico text, anterior_baixa_codigo integer, anterior_baixa_descricao text, dias integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select v.id, a.id, a.data_agendada, a.situacao, e.codigo, t.nome, cb.codigo, cb.descricao,
         v.data_agendada - a.data_agendada
    from visita v
    join tipo_servico gv on gv.id = v.tipo_servico_id and gv.nome = 'VISITA TECNICA'
    join lateral (
      select x.* from visita x
        join tipo_servico gx on gx.id = x.tipo_servico_id and gx.nome = 'VISITA TECNICA'
       where x.empresa_id = v.empresa_id and x.contrato = v.contrato
         and x.id <> v.id and x.excluido_em is null
         and (x.data_agendada < v.data_agendada
              or (x.data_agendada = v.data_agendada and x.criado_em < v.criado_em))
         and x.data_agendada >= v.data_agendada - 30
         -- 268 (D-383): pula a Manutenção Indoor — olha a VT antes dela
         and not exists (select 1 from tipo_atividade tx
                          where tx.id = x.tipo_atividade_id and tx.fora_da_revisita)
         -- pula o Auditar e o cancelado pela central — e olha a VT antes dela
         and not (x.situacao = 'CANCELADA' and (
               x.cancelado_central_em is not null
               or cancelado_pela_central(x.dados_origem->>'Status da Atividade',
                                         x.dados_origem->>'Motivo de Fechamento Externo')
               or exists (select 1 from ordem_servico o
                            join codigo_baixa c8 on c8.id = o.codigo_baixa_afline_id
                           where o.visita_id = x.id and c8.codigo = 800)))
       order by x.data_agendada desc, x.criado_em desc
       limit 1
    ) a on true
    left join equipe e  on e.id = a.equipe_id
    left join tecnico t on t.id = a.tecnico_responsavel_id
    -- a baixa da OPERADORA na menor sequência; sem ela, a da AFLINE (como na 241)
    left join lateral (
      select coalesce(o.codigo_baixa_id, o.codigo_baixa_afline_id) as id
        from ordem_servico o
       where o.visita_id = a.id
         and (o.codigo_baixa_id is not null or o.codigo_baixa_afline_id is not null)
       order by (o.codigo_baixa_id is null), o.sequencia
       limit 1
    ) ob on true
    left join codigo_baixa cb on cb.id = ob.id
   where v.id = any(p_visitas)
     and v.contrato is not null
     -- 268 (D-383): a Manutenção Indoor nunca é revisita
     and not exists (select 1 from tipo_atividade tv
                      where tv.id = v.tipo_atividade_id and tv.fora_da_revisita);
$function$;

CREATE OR REPLACE FUNCTION public.revisita_do_tecnico(p_de date, p_ate date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           -- 268 (D-383): a Manutenção Indoor fica na BASE, mas nunca "voltou"
           coalesce(ta.fora_da_revisita, false) as fora,
           -- o "Status da Atividade" do TOA vem só no JSON cru (como na web)
           case when v.cancelado_central_em is not null then 'CANCELADO'
                else norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) end as status_toa
      from visita v
      left join tipo_servico g on g.id = v.tipo_servico_id
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
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
     where not m.fora
       and exists (
       select 1 from visita d
         left join tipo_servico gd on gd.id = d.tipo_servico_id
        where d.empresa_id = m.empresa_id and d.contrato = m.contrato
          and d.id <> m.id and d.excluido_em is null
          and (d.data_agendada > m.data_agendada
               or (d.data_agendada = m.data_agendada and d.criado_em > m.criado_em))
          and d.data_agendada - m.data_agendada <= 30
          -- a Indoor que veio depois não é a volta
          and not exists (select 1 from tipo_atividade td
                           where td.id = d.tipo_atividade_id and td.fora_da_revisita)
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

notify pgrst, 'reload schema';
