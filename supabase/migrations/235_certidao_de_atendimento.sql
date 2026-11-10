-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 235 — Certidão de Atendimento, o terceiro indicador (D-344)          │
-- │                                                                      │
-- │ "esse indicador olhar os niveis de sinais que o nosso sistema ja     │
-- │  faz (...) preciso saber o % padrão, ou seja, validando, após isso,  │
-- │  (...) validado com falha e validado sem falha que é o regular (...) │
-- │  a nota de cada técnico por dia, deve ter grafico semanal do mês, e  │
-- │  o dia a dia do técnico. % sem validação" — Emanuel, 09/11.          │
-- │                                                                      │
-- │ A fonte é o sinal do Portal Técnico da Claro (`sinal_claro`, 222):   │
-- │ a VALIDAÇÃO é o "depois". A classificação continua sendo a DA CLARO  │
-- │ (a cor que o portal manda, D-330) — nenhuma faixa de dBm nossa:      │
-- │   verde    (Nível Regular)                  → validado SEM falha     │
-- │   vermelho (Nível Irregular, Erro na Coleta) → validado COM falha    │
-- │   amarelo  (Pendente) ou sem leitura         → SEM validação         │
-- │                                                                      │
-- │ A base é a O.S. FINALIZADA no portal — a mesma régua do "sem         │
-- │ validação" da D-332: cancelada sem validação é natural e não entra.  │
-- │ Um contrato = uma linha de `sinal_claro`.                            │
-- │                                                                      │
-- │ A nota do técnico no dia é o % PADRÃO = validados ÷ finalizados. As  │
-- │ porcentagens e as semanas a tela faz sobre as contagens daqui.       │
-- │                                                                      │
-- │ O técnico é o responsável pelo contrato no sistema, como nos outros  │
-- │ indicadores da tela.                                                 │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function certidao_atendimento(
  p_de date, p_ate date, p_equipe text, p_buckets text[])
returns table (
  tecnico_id uuid, nome text, matricula text, equipe text, dia date,
  finalizados integer,     -- O.S. finalizada no portal (a base)
  regular integer,         -- validado sem falha
  com_falha integer,       -- validado com falha
  sem_validacao integer    -- finalizado e não validado
)
language sql
stable
security definer
set search_path = public
as $$
  with s as materialized (
    select v.tecnico_responsavel_id as tec, v.data_agendada as dia,
           lower(coalesce(s.validacao_cor, '')) as cor
      from sinal_claro s
      join visita v on v.id = s.visita_id
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe eq on eq.id = t.equipe_id
     where v.data_agendada between p_de and p_ate
       and v.excluido_em is null
       and v.tecnico_responsavel_id is not null
       and lower(coalesce(s.status_os_texto, '')) = 'finalizada'
       and v.empresa_id = (select minha_empresa())
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
       and (p_equipe is null or eq.codigo = p_equipe)
       and (p_buckets is null or cardinality(p_buckets) = 0
            or coalesce(v.toa_bucket, 'SEM_BUCKET') = any(p_buckets))
  )
  select t.id, t.nome, t.matricula, e.codigo, s.dia,
         count(*)::int,
         count(*) filter (where s.cor = 'green')::int,
         count(*) filter (where s.cor = 'red')::int,
         count(*) filter (where s.cor not in ('green', 'red'))::int
    from s
    join tecnico t on t.id = s.tec
    left join equipe e on e.id = t.equipe_id
   group by t.id, t.nome, t.matricula, e.codigo, s.dia
   order by s.dia, t.nome;
$$;
revoke all on function certidao_atendimento(date, date, text, text[]) from public, anon;
grant execute on function certidao_atendimento(date, date, text, text[]) to authenticated;

notify pgrst, 'reload schema';
