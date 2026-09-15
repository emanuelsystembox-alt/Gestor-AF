-- ============================================================
-- 075 · A rota entrega o que o controlador precisa para AGIR
--
-- > "nele é bom mostrar bairro, se é uma adesão, vt, hora início e fim,
-- >  e mostrar talvez o km de um para o outro […] ele deve ser avisado
-- >  de alguma divergência de rota […] o que está pendente para trás ele
-- >  possa mexer e arrastar para outra linha, aí o contrato
-- >  automaticamente seria transferido" — Emanuel, 14/09
--
-- A tela deixa de ser só leitura e passa a ser DESPACHO. Para isso
-- `rota_do_dia` precisa de três colunas que ela não devolvia — e as três
-- já existem na `visita`, nenhuma é cálculo novo:
--
-- ┌─ equipe_id ──────────────────────────────────────────────────────┐
-- │ A função devolvia `equipe` = o CÓDIGO da equipe, texto, bom para  │
-- │ escrever na tela e inútil para agir: `transferir_visita` pede     │
-- │ `p_equipe uuid`. Sem o id, arrastar teria de adivinhar a equipe   │
-- │ pelo código — e código é rótulo, não chave.                       │
-- │                                                                   │
-- │ ⚠ A LINHA DA TELA É O *LOGIN* DO TOA, e a transferência é por     │
-- │ EQUIPE. Dois logins da mesma equipe são duas linhas e uma equipe  │
-- │ só: arrastar entre elas devolve `mudou: false`, de propósito. A   │
-- │ tela tem de dizer isso, não fingir que moveu.                     │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ tec1 ───────────────────────────────────────────────────────────┐
-- │ "Divergência de rota" inclui chegar fora da janela combinada. A   │
-- │ regra disso JÁ EXISTE e é do servidor: `visita.tec1` (047, D-047, │
-- │ lida do painel do próprio Emanuel). Escrever uma segunda          │
-- │ comparação `inicio` × `janela` no front seria inventar uma        │
-- │ aderência paralela, que diverge da primeira no dia em que a regra │
-- │ mudar. Não duplique regra de escopo nem de medição.               │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ finalizado_toa ─────────────────────────────────────────────────┐
-- │ O bloco passa a escrever "08:12–09:48". Só que `visita.fim` vem   │
-- │ preenchido em atividade apenas INICIADA (D-103): sem este         │
-- │ booleano o cartão afirmaria hora de encerramento de quem não      │
-- │ encerrou. Com ele, a tela escreve "08:12 →" e diz que ainda corre.│
-- └───────────────────────────────────────────────────────────────────┘
--
-- O resto do corpo é o da 054, sem uma vírgula de diferença: mesma
-- janela de dia, mesmo escopo de RLS, mesma exclusão de JORNADA, mesmo
-- `km_entre` e mesmo `voltou_ao_bairro`.
--
-- ┌─ por que DROP e não CREATE OR REPLACE ───────────────────────────┐
-- │ Coluna nova no `returns table` ⇒ "cannot change return type". E   │
-- │ função recriada do zero NASCE COM A ACL ABERTA ao anon — esta é   │
-- │ `security definer`, então o revoke no fim é a diferença entre um  │
-- │ painel de despacho e um vazamento (par 059 → 061).                │
-- └───────────────────────────────────────────────────────────────────┘
-- ============================================================

drop function if exists public.rota_do_dia(date);

create function public.rota_do_dia(p_data date)
returns table(visita_id uuid, contrato text, login text, tecnico text,
              equipe text, equipe_id uuid, bairro text, area text,
              lat numeric, lng numeric,
              inicio timestamp with time zone, fim timestamp with time zone,
              finalizado_toa boolean,
              janela_inicio time without time zone,
              janela_fim time without time zone,
              situacao text, tipo_servico text, tec1 text, ordem integer,
              km_desde_anterior double precision, voltou_ao_bairro boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with v as (
    select vi.id, vi.contrato,
           nullif(btrim(coalesce(vi.dados_origem->>'Login do Técnico','')),'') as login,
           nullif(btrim(coalesce(vi.dados_origem->>'Recurso','')),'')          as recurso,
           e.codigo as equipe, vi.equipe_id, vi.bairro, a.apelido as area,
           vi.lat, vi.lng, vi.inicio, vi.fim, vi.finalizado_toa,
           vi.janela_inicio, vi.janela_fim, vi.situacao, ts.nome as tipo_servico,
           vi.tec1::text as tec1
      from visita vi
      left join equipe e on e.id = vi.equipe_id
      left join area_trabalho a on a.id = vi.area_id
      left join tipo_servico ts on ts.id = vi.tipo_servico_id
      left join tipo_atividade ta on ta.id = vi.tipo_atividade_id
     where vi.excluido_em is null
       and vi.data_agendada = p_data
       and vi.empresa_id = minha_empresa()
       and vi.base_id in (select bases_visiveis())
       and (eh_gestor() or vi.equipe_id in (select equipes_visiveis()))
       -- Jornada não é rota: "Na Base" e "Refeição" não são deslocamento
       -- para cliente (regra do CLAUDE.md).
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
  ),
  ord as (
    select v.*, row_number() over (partition by v.login
                                   order by v.inicio nulls last, v.id) as ordem
      from v where v.login is not null
  )
  select o.id, o.contrato, o.login, o.recurso, o.equipe, o.equipe_id,
         o.bairro, o.area, o.lat, o.lng, o.inicio, o.fim, o.finalizado_toa,
         o.janela_inicio, o.janela_fim,
         o.situacao, o.tipo_servico, o.tec1, o.ordem::int,
         km_entre(ant.lat::float8, ant.lng::float8, o.lat::float8, o.lng::float8),
         exists (select 1 from ord x
                  where x.login = o.login and x.ordem < o.ordem - 1
                    and norm_txt(x.bairro) = norm_txt(o.bairro)
                    and o.bairro is not null)
    from ord o
    left join ord ant on ant.login = o.login and ant.ordem = o.ordem - 1
   order by o.login, o.ordem;
$function$;

revoke all on function public.rota_do_dia(date) from public, anon;
grant execute on function public.rota_do_dia(date) to authenticated;

notify pgrst, 'reload schema';
