-- Grupo de servico (o agrupamento de NEGOCIO)
--
--   tipo_atividade = o que o TOA chama a visita
--   tipo_servico   = como a operacao e a CLARO agrupam
--
-- O de/para NAO foi inventado: foi derivado cruzando o export do TOA com
-- o export do ngestor de 04/09/2026 pela WO (240 visitas em comum).
--
-- REGRA DESCOBERTA: o grupo pertence a VISITA, nao a O.S. E nao e a
-- primeira O.S. que manda (acerta 50,8%) -- e a de maior PRIORIDADE de
-- negocio, que acerta 95,4%.

alter table tipo_servico
  add column if not exists prioridade smallint not null default 99,
  add column if not exists descricao text;

update tipo_servico set prioridade = p.n from (values
  ('MUDANCA DE ENDERECO', 1), ('ADESAO', 2), ('REINSTALACAO', 3),
  ('MIGRACAO GPON', 4), ('VISITA TECNICA', 5),
  ('RETORNO DE CREDENCIADA', 6), ('DESCONEXAO', 7), ('SERVICO', 8)
) as p(nome, n) where tipo_servico.nome = p.nome;

alter table tipo_os
  add column if not exists tipo_servico_id uuid references tipo_servico(id),
  add column if not exists depende_de_contexto boolean not null default false;

comment on column tipo_os.depende_de_contexto is
  'Tipo cujo grupo varia conforme as outras O.S. da mesma visita. '
  'Observado em 24, 156 e 208 no cruzamento de 04/09/2026.';

insert into tipo_os (codigo, descricao) values
  (33,'REINSTALACAO - ASSINATURA'),
  (53,'INSTALAR SERVICO CONEXAO ADICIONAL DIGITAL'),
  (55,'MUDANCA ENDERECO - INSTALAR SERVICO CONEXAO ADIC DIGITAL'),
  (83,'INSTALAR PONTO VOIP'), (125,'MODERNIZACAO BL'),
  (158,'VISITA TECNICA WIFI MESH'), (176,'REFAZER MANUTENCAO PON'),
  (190,'INSTALACAO DE CABO HFC'),
  (514,'MUDANCA DE ENDERECO - ENTREGA STREAMING')
on conflict (codigo) do nothing;

update tipo_os t set tipo_servico_id = s.id
from (values
  (1,'ADESAO'), (4,'SERVICO'), (12,'MUDANCA DE ENDERECO'), (15,'SERVICO'),
  (24,'SERVICO'), (33,'REINSTALACAO'), (43,'ADESAO'), (44,'SERVICO'),
  (45,'MUDANCA DE ENDERECO'), (46,'REINSTALACAO'), (48,'VISITA TECNICA'),
  (51,'ADESAO'), (52,'ADESAO'), (53,'SERVICO'), (54,'MUDANCA DE ENDERECO'),
  (55,'MUDANCA DE ENDERECO'), (57,'SERVICO'), (62,'VISITA TECNICA'),
  (69,'RETORNO DE CREDENCIADA'), (83,'SERVICO'), (101,'ADESAO'),
  (125,'SERVICO'), (129,'SERVICO'), (148,'SERVICO'), (156,'SERVICO'),
  (158,'VISITA TECNICA'), (176,'SERVICO'), (190,'SERVICO'),
  (191,'MIGRACAO GPON'), (208,'SERVICO'), (307,'VISITA TECNICA'),
  (510,'MIGRACAO GPON'), (511,'SERVICO'), (512,'REINSTALACAO'),
  (514,'MUDANCA DE ENDERECO'), (516,'ADESAO'), (517,'ADESAO')
) as d(cod, grupo)
join tipo_servico s on s.nome = d.grupo
where t.codigo = d.cod;

update tipo_os set depende_de_contexto = true where codigo in (24, 156, 208);

create or replace function grupo_da_visita(p_visita uuid)
returns uuid language sql stable set search_path = public as $fn$
  select ts.id
  from ordem_servico o
  join tipo_os t on t.id = o.tipo_os_id
  join tipo_servico ts on ts.id = t.tipo_servico_id
  where o.visita_id = p_visita
  order by ts.prioridade
  limit 1;
$fn$;

create or replace function aplica_grupo_servico()
returns trigger language plpgsql set search_path = public as $fn$
begin
  update visita v set tipo_servico_id = grupo_da_visita(v.id)
  where v.id = coalesce(new.visita_id, old.visita_id);
  return null;
end;
$fn$;

create trigger trg_os_grupo_servico
  after insert or update of tipo_os_id or delete on ordem_servico
  for each row execute function aplica_grupo_servico();

update visita v set tipo_servico_id = grupo_da_visita(v.id)
where exists (select 1 from ordem_servico o where o.visita_id = v.id);
