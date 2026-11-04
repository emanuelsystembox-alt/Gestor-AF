-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ Carga histórica do ngestor — o procedimento está em                  │
-- │ docs/14-CARGA-HISTORICA.md. Leia antes de rodar.                     │
-- │                                                                      │
-- │ Entrada: /tmp/ngestor.jsonl (de exporta_ngestor.cjs), dentro do      │
-- │ container supabase-db. Roda numa transação só. NÃO termina sozinho:  │
-- │ acrescente `rollback;` (ensaio) ou `commit;` (valer) no fim.         │
-- │                                                                      │
-- │ Usada em 03/11/2026 (Manaus e São Luís, jan–out, 97.600 contratos,   │
-- │ D-282). Decisões do Emanuel: entra em tudo; equipe que não existe é  │
-- │ criada com o nome da planilha (ativa); aberto entra como estava.     │
-- │ Marca por dentro: visita.importacao_id = importação fonte NGESTOR,   │
-- │ arquivo_path 'carga-historica-ngestor' — é por ela que se desfaz.    │
-- └──────────────────────────────────────────────────────────────────────┘
\set ON_ERROR_STOP 1
\timing on
begin;
set local statement_timeout = 0;
-- IMPORTACAO: marca_bloqueio e um_status não interferem; o aviso de "dois
-- ativos" que isso dispara é apagado no fim (é de dia passado)
select set_config('app.origem', 'IMPORTACAO', true) is not null as origem;

create temp table _j (t text);
\copy _j from '/tmp/ngestor.jsonl' with (format csv, quote e'\x01', delimiter e'\x02')

-- ADAPTE: uma linha por cidade da planilha. `op` é o que exporta_ngestor.cjs
-- grava; o prefixo da WO é o que o TOA manda naquela cidade (confira:
-- select split_part(wo_numero,'|',1), count(*) from visita where base_id = …
-- group by 1); o fuso é o da cidade (Manaus −4, São Luís −3).
create temp table _b as
  select 'MAN'::text as op, id as base_id, empresa_id, '00121|'::text as wo_pref,
         'America/Manaus'::text as tz from base where nome = 'Manaus - AM'
  union all
  select 'SLS', id, empresa_id, '00696|', 'America/Fortaleza' from base where nome = 'São Luís - MA';

create temp table _v as
  select gen_random_uuid() as id, l.j, b.base_id, b.empresa_id, b.wo_pref, b.tz
    from (select t::jsonb as j from _j) l join _b b on b.op = l.j->>'op';
select count(*) as linhas_lidas from _v;

-- uma importação por cidade, para marcar a carga
create temp table _imp as select null::uuid as id, null::uuid as base_id limit 0;
with ins as (
  insert into importacao (base_id, empresa_id, arquivo_nome, arquivo_path, fonte, status,
                          total_linhas, qtd_criadas, aplicado_em, data_atuacao)
  select base_id, empresa_id, 'BANCO - SLS E MAN - VISTA - INST - REINST - SERV.xlsx',
         'carga-historica-ngestor', 'NGESTOR', 'APLICADA', count(*), count(*), now(), null
    from _v group by base_id, empresa_id
  returning id, base_id)
insert into _imp select id, base_id from ins;

-- equipes: pelo nome; depois pelo número; o que faltar é criado (ativo)
create temp table _eq as
  select distinct base_id, empresa_id, j->>'equipe' as nome from _v where coalesce(j->>'equipe', '') <> '';
alter table _eq add column cod text, add column equipe_id uuid;
update _eq set cod = case when nome ~ '^\d{1,3} - EQUIPE'
                          then lpad(substring(nome from '^(\d{1,3})'), 3, '0')
                          else upper(btrim(nome)) end;
update _eq e set equipe_id = q.id from equipe q
 where q.base_id = e.base_id and norm_txt(q.nome) = norm_txt(e.nome);
update _eq e set equipe_id = q.id from equipe q
 where e.equipe_id is null and q.base_id = e.base_id and q.codigo = e.cod;
insert into equipe (base_id, empresa_id, codigo, nome, ativo)
select distinct on (base_id, cod) base_id, empresa_id, cod, nome, true
  from _eq where equipe_id is null order by base_id, cod, nome;
select count(*) as equipes_criadas from equipe q
 where exists (select 1 from _eq e where e.equipe_id is null and e.base_id = q.base_id and e.cod = q.codigo);
update _eq e set equipe_id = q.id from equipe q
 where e.equipe_id is null and q.base_id = e.base_id and q.codigo = e.cod;

-- de/para dos cadastros
create temp table _cb as
  select distinct on (codigo) codigo, id from codigo_baixa
   where empresa_id is null or empresa_id = (select empresa_id from _b limit 1)
   order by codigo, empresa_id nulls last;
create temp table _tos as
  select distinct on (norm_txt(descricao)) norm_txt(descricao) as chave, id from tipo_os order by norm_txt(descricao), codigo;
-- tipo de atividade pelo grupo: o par mais frequente no dado de 03/11
create temp table _ta as
  select g.nome as grupo, (select id from tipo_atividade where nome = g.ativ) as id
    from (values ('ADESAO', 'Instalacao'), ('VISITA TECNICA', 'Visita Tecnica'),
                 ('SERVICO', 'Mudanca de Pacote'), ('RETORNO DE CREDENCIADA', 'Retorno Credenciada'),
                 ('MUDANCA DE ENDERECO', 'Mudanca de Endereco'), ('REINSTALACAO', 'Reinstalacao')) g(nome, ativ);

insert into visita (
  id, base_id, empresa_id, origem, wo_numero, contrato, tipo_atividade_id, tipo_servico_id,
  area_id, node, cliente_nome, tipo_pessoa, telefones, tipo_residencia, logradouro, bairro,
  cidade, uf, cep, lat, lng, data_agendada, janela_inicio, janela_fim,
  equipe_id, situacao, situacao_em, fim, finalizado_toa, tec1, observacao, importacao_id, dados_origem)
select v.id, v.base_id, v.empresa_id, v.j->>'origem',
       -- WO "0" é marcador do ngestor, não WO
       case when coalesce(v.j->>'wo', '') !~ '^0*$' then v.wo_pref || (v.j->>'wo') end,
       v.j->>'contrato',
       ta.id, ts.id, ar.id, v.j->>'node', v.j->>'cliente', v.j->>'pessoa',
       case when jsonb_array_length(v.j->'tel') > 0
            then array(select jsonb_array_elements_text(v.j->'tel')) end,
       v.j->>'res', v.j->>'end', v.j->>'bairro', v.j->>'cidade', v.j->>'uf', v.j->>'cep',
       (v.j->>'clat')::numeric, (v.j->>'clng')::numeric,
       (v.j->>'dt')::date, (v.j->>'ji')::time, (v.j->>'jf')::time,
       eq.equipe_id, v.j->>'sit',
       coalesce(((v.j->>'dsit')::timestamp at time zone v.tz), now()),
       case when v.j->>'sit' in ('CONCLUIDA', 'CANCELADA', 'REAGENDAMENTO') and v.j->>'dsit' is not null
            then (v.j->>'dsit')::timestamp at time zone v.tz end,
       v.j->>'st_op' is not null,
       v.j->>'tec1', v.j->>'obs', i.id, v.j->'extra'
  from _v v
  join _imp i on i.base_id = v.base_id
  left join tipo_servico ts on ts.nome = v.j->>'grupo'
  left join _ta ta on ta.grupo = v.j->>'grupo'
  left join area_trabalho ar on ar.codigo = v.j->>'area'
  left join _eq eq on eq.base_id = v.base_id and eq.nome = v.j->>'equipe';

insert into ordem_servico (visita_id, sequencia, numero_os, tipo_os_id, status_operadora,
                           codigo_baixa_id, codigo_baixa_afline_id, baixa_em, origem, descricao)
select v.id, x.seq::int, x.e->>0, tos.id, v.j->>'st_op',
       cbt.id, cbn.id,
       case when cbn.id is not null and v.j->>'dsit' is not null
            then (v.j->>'dsit')::timestamp at time zone v.tz end,
       v.j->>'origem', x.e->>1
  from _v v
  cross join lateral jsonb_array_elements(v.j->'os') with ordinality x(e, seq)
  left join _tos tos on tos.chave = norm_txt(x.e->>1)
  left join _cb cbt on cbt.codigo = (v.j->>'cod_toa')::int
  left join _cb cbn on cbn.codigo = (v.j->>'cod_ng')::int;

-- o gatilho de cada O.S. recalcula o grupo; vale o da planilha
update visita vv set tipo_servico_id = ts.id
  from _v v join tipo_servico ts on ts.nome = v.j->>'grupo'
 where vv.id = v.id and vv.tipo_servico_id is distinct from ts.id;

-- a baixa no histórico: quem baixou (login do sistema anterior), quando e,
-- quando houver, onde a equipe estava (Lat/Lng_Equipe)
insert into visita_evento (visita_id, tipo, para, origem, login, criado_em, lat, lng, observacao, importacao_id)
select v.id, 'BAIXA', jsonb_build_object('situacao', v.j->>'sit'),
       case when v.j->>'elat' is not null then 'MOBILE' else 'TELA' end,
       v.j->>'login',
       (v.j->>'dsit')::timestamp at time zone v.tz,
       (v.j->>'elat')::numeric, (v.j->>'elng')::numeric,
       v.j->>'cod_ng_txt', i.id
  from _v v join _imp i on i.base_id = v.base_id
 where v.j->>'sit' in ('CONCLUIDA', 'CANCELADA', 'REAGENDAMENTO') and v.j->>'dsit' is not null;

-- dia passado não gera aviso nem sinal
delete from aviso where visita_id in (select id from _v);
delete from sinal where visita_id in (select id from _v);

select 'visitas' item, count(*) n from visita where importacao_id in (select id from _imp)
union all select 'ordens de servico', count(*) from ordem_servico where visita_id in (select id from _v)
union all select 'os sem tipo', count(*) from ordem_servico where visita_id in (select id from _v) and tipo_os_id is null
union all select 'os com baixa afline', count(*) from ordem_servico where visita_id in (select id from _v) and codigo_baixa_afline_id is not null
union all select 'os com baixa toa', count(*) from ordem_servico where visita_id in (select id from _v) and codigo_baixa_id is not null
union all select 'eventos de baixa', count(*) from visita_evento where visita_id in (select id from _v)
union all select 'visitas sem equipe', count(*) from visita where id in (select id from _v) and equipe_id is null
union all select 'visitas sem grupo', count(*) from visita where id in (select id from _v) and tipo_servico_id is null
union all select 'visitas sem area', count(*) from visita where id in (select id from _v) and area_id is null
union all select 'avisos restantes da carga', count(*) from aviso where visita_id in (select id from _v);
