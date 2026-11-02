-- ┌─ 174 · os sinais do contrato, como o TOA: prédio, casa e o vai-e-volta (D-261) ┐
-- │ > "precisamos sinalizar nossos contratos igual ao do TOA: o que for prédio, │
-- │ >  colocar um desenho de prédio, se for casa a mesma coisa, quando for     │
-- │ >  revisita, colocar esse símbolo de vai e volta (...) olhando nosso banco │
-- │ >  (...) ADESÃO, MDE, SERV, MIG e etc — o símbolo entra se não foi atendido│
-- │ >  as mesmas O.S. anteriormente como concluído em nosso sistema no grupo   │
-- │ >  de instalação (...) para VT é se for VT da VT, ou retorno do retorno"   │
-- │ >  — Emanuel, 02/11                                                         │
-- │                                                                             │
-- │ Perguntado, decidiu: olhar 30 dias para trás (o prazo da revisita da       │
-- │ D-245); VT da VT e retorno do retorno em QUALQUER situação da anterior;    │
-- │ APTO e LOJA = prédio, CASA e BECO = casa (QUALQUER, sem endereço, nada).   │
-- │                                                                             │
-- │ O vai-e-volta, por grupo de serviço da visita de hoje:                      │
-- │   VISITA TECNICA         → houve VT do MESMO contrato nos 30 dias antes.    │
-- │   RETORNO DE CREDENCIADA → houve retorno do mesmo contrato nos 30 dias.     │
-- │   qualquer outro grupo   → alguma O.S. de hoje (o NÚMERO da CLARO, 10       │
-- │   (instalação: ADESAO,     dígitos) já esteve numa visita de instalação     │
-- │   MUDANCA DE ENDERECO,     nos 30 dias antes que NÃO foi concluída — a      │
-- │   SERVICO, MIGRACAO…)      mesma O.S. voltando.                             │
-- │ Sem grupo (a jornada) não ganha sinal.                                      │
-- │                                                                             │
-- │ É DIFERENTE da revisita da D-245 (`revisita_dos_contratos`, a do card do   │
-- │ técnico e da janela do LOG): aquela é sobre o serviço CONCLUÍDO que voltou; │
-- │ este é o sinal da tela, a regra que o Emanuel ditou para ele. Não troque   │
-- │ uma pela outra.                                                             │
-- │                                                                             │
-- │ DEFINER porque o técnico (no app) não enxerga as visitas de outras equipes │
-- │ e o sinal sairia falso; por isso o escopo é conferido aqui (empresa +      │
-- │ cidades que o login acessa) e a resposta é só sinal e data — nada do       │
-- │ cliente.                                                                    │
-- └─────────────────────────────────────────────────────────────────────────────┘

create or replace function public.sinais_das_visitas(p_visitas uuid[])
 returns table(visita_id uuid, edificacao text, revisita boolean, revisita_motivo text,
               anterior_data date, anterior_situacao text, anterior_grupo text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with alvo as materialized (
    select v.id, v.contrato, v.data_agendada as dia, v.empresa_id, ts.nome as grupo,
           edificacao_de(v.tipo_residencia, v.complemento, v.logradouro) as ed
      from visita v
      left join tipo_servico ts on ts.id = v.tipo_servico_id
     where v.id = any(p_visitas)
       and v.empresa_id = (select minha_empresa())
       and v.base_id in (select bases_permitidas())
       and v.excluido_em is null
  )
  select a.id,
         case when a.ed in ('APTO', 'LOJA') then 'PREDIO'
              when a.ed in ('CASA', 'BECO') then 'CASA' end,
         coalesce(vt.dia, ins.dia) is not null,
         case when vt.dia is not null then
                case a.grupo when 'VISITA TECNICA' then 'VT_DA_VT' else 'RETORNO_DO_RETORNO' end
              when ins.dia is not null then 'OS_NAO_CONCLUIDA' end,
         coalesce(vt.dia, ins.dia), coalesce(vt.situacao, ins.situacao), coalesce(vt.grupo, ins.grupo)
    from alvo a
    -- VT da VT / retorno do retorno: o mesmo contrato, o mesmo grupo
    left join lateral (
      select v2.data_agendada as dia, v2.situacao, ts2.nome as grupo
        from visita v2
        join tipo_servico ts2 on ts2.id = v2.tipo_servico_id
       where a.grupo in ('VISITA TECNICA', 'RETORNO DE CREDENCIADA')
         and a.contrato is not null
         and v2.empresa_id = a.empresa_id and v2.contrato = a.contrato
         and v2.id <> a.id and v2.excluido_em is null
         and v2.data_agendada >= a.dia - 30 and v2.data_agendada < a.dia
         and ts2.nome = a.grupo
       order by v2.data_agendada desc limit 1
    ) vt on true
    -- instalação: a mesma O.S. da CLARO numa visita de instalação não concluída
    left join lateral (
      select v2.data_agendada as dia, v2.situacao, ts2.nome as grupo
        from ordem_servico o
        join ordem_servico o2 on o2.numero_os = o.numero_os and o2.visita_id <> a.id
        join visita v2 on v2.id = o2.visita_id
        left join tipo_servico ts2 on ts2.id = v2.tipo_servico_id
       where a.grupo is not null
         and a.grupo not in ('VISITA TECNICA', 'RETORNO DE CREDENCIADA')
         and o.visita_id = a.id and o.numero_os ~ '^\d{10}$'
         and v2.empresa_id = a.empresa_id and v2.excluido_em is null
         and v2.data_agendada >= a.dia - 30 and v2.data_agendada < a.dia
         and v2.situacao <> 'CONCLUIDA'
         and coalesce(ts2.nome, '') not in ('VISITA TECNICA', 'RETORNO DE CREDENCIADA')
       order by v2.data_agendada desc limit 1
    ) ins on true;
$function$;

revoke all on function public.sinais_das_visitas(uuid[]) from public, anon;
grant execute on function public.sinais_das_visitas(uuid[]) to authenticated;

notify pgrst, 'reload schema';
