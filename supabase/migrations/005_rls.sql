-- ============================================================
-- 004 - Row Level Security
-- D-007: o tecnico NAO ve visitas de outras equipes, valores
--        financeiros, nem a avaliacao de qualidade sobre ele.
--        O tecnico VE a reincidencia do cliente.
--
-- Aqui esta a diferenca real para o sistema atual: a permissao
-- vive no Postgres. Burlar a interface nao devolve o dado.
-- ============================================================

alter table perfil            enable row level security;
alter table usuario_papel     enable row level security;
alter table equipe            enable row level security;
alter table tecnico           enable row level security;
alter table carteira          enable row level security;
alter table visita            enable row level security;
alter table ordem_servico     enable row level security;
alter table evidencia         enable row level security;
alter table equipamento_movimento enable row level security;
alter table reincidencia      enable row level security;
alter table visita_evento     enable row level security;
alter table importacao        enable row level security;
alter table importacao_linha  enable row level security;

-- ---------- Perfil ----------
create policy perfil_leitura on perfil for select
  using (id = auth.uid() or eh_gestor() or tem_papel('CONTROLADOR'));

create policy perfil_autoedicao on perfil for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy perfil_admin on perfil for all
  using (tem_papel('ADMIN')) with check (tem_papel('ADMIN'));

-- ---------- Papeis: so ADMIN mexe ----------
create policy papel_leitura on usuario_papel for select
  using (usuario_id = auth.uid() or eh_gestor());

create policy papel_admin on usuario_papel for all
  using (tem_papel('ADMIN')) with check (tem_papel('ADMIN'));

-- ---------- Equipe / Tecnico ----------
create policy equipe_leitura on equipe for select
  using (id in (select equipes_visiveis()));

create policy equipe_escrita on equipe for all
  using (eh_gestor()) with check (eh_gestor());

create policy tecnico_leitura on tecnico for select
  using (
    usuario_id = auth.uid()
    or equipe_id in (select equipes_visiveis())
  );

create policy tecnico_escrita on tecnico for all
  using (eh_gestor()) with check (eh_gestor());

create policy carteira_leitura on carteira for select
  using (controlador_id = auth.uid() or eh_gestor());

create policy carteira_escrita on carteira for all
  using (eh_gestor()) with check (eh_gestor());

-- ============================================================
-- VISITA - o coracao do D-007
-- ============================================================

-- Gestor ve tudo. Controlador ve sua carteira. Tecnico ve so a
-- propria equipe. Nao existe caminho para ver de outra equipe.
create policy visita_leitura on visita for select
  using (
    eh_gestor()
    or equipe_id in (select equipes_visiveis())
  );

-- Controlador e gestor despacham e corrigem.
create policy visita_gestao on visita for all
  using (eh_gestor() or equipe_id in (select equipes_visiveis()))
  with check (eh_gestor() or equipe_id in (select equipes_visiveis()));

-- O tecnico atualiza SOMENTE visitas da sua equipe e SOMENTE
-- enquanto nao concluidas/canceladas.
create policy visita_execucao_tecnico on visita for update
  using (
    tem_papel('TECNICO')
    and equipe_id in (select equipes_visiveis())
    and situacao not in ('CONCLUIDA','CANCELADA')
  )
  with check (
    equipe_id in (select equipes_visiveis())
  );

-- ---------- Ordem de servico ----------
create policy os_leitura on ordem_servico for select
  using (visita_id in (select id from visita));

create policy os_escrita on ordem_servico for all
  using (visita_id in (select id from visita))
  with check (visita_id in (select id from visita));

-- ---------- Evidencias / equipamentos / eventos ----------
create policy evidencia_leitura on evidencia for select
  using (visita_id in (select id from visita));

create policy evidencia_insercao on evidencia for insert
  with check (visita_id in (select id from visita));

create policy equip_leitura on equipamento_movimento for select
  using (visita_id in (select id from visita));

create policy equip_insercao on equipamento_movimento for insert
  with check (visita_id in (select id from visita));

-- D-007: reincidencia e VISIVEL para o tecnico
create policy reincidencia_leitura on reincidencia for select
  using (visita_id in (select id from visita));

-- Trilha de auditoria: leitura restrita a gestao; ninguem edita ou apaga.
create policy evento_leitura on visita_evento for select
  using (eh_gestor() or tem_papel('CONTROLADOR'));

create policy evento_insercao on visita_evento for insert
  with check (visita_id in (select id from visita));

-- ---------- Importacao: so gestao ----------
create policy importacao_gestao on importacao for all
  using (eh_gestor() or tem_papel('CONTROLADOR'))
  with check (eh_gestor() or tem_papel('CONTROLADOR'));

create policy importacao_linha_gestao on importacao_linha for all
  using (eh_gestor() or tem_papel('CONTROLADOR'))
  with check (eh_gestor() or tem_papel('CONTROLADOR'));

-- ============================================================
-- D-007: esconder valores financeiros e avaliacao de qualidade
--
-- RLS filtra LINHAS, nao COLUNAS. Para esconder coluna, o tecnico
-- nao le a tabela base: le esta view, que simplesmente nao expoe
-- os campos proibidos. O GRANT abaixo e o que garante isso.
-- ============================================================

create view visita_campo
with (security_invoker = true)
as select
  v.id, v.toa_atividade_id, v.wo_numero, v.contrato,
  v.tipo_atividade_id, v.tipo_servico_id, v.area_id, v.node,
  v.cliente_nome, v.tipo_pessoa, v.telefones, v.tipo_residencia,
  v.logradouro, v.complemento, v.bairro, v.cidade, v.uf, v.cep,
  v.lat, v.lng,
  v.data_agendada, v.janela_inicio, v.janela_fim,
  v.equipe_id, v.tecnico_responsavel_id,
  v.situacao, v.situacao_em, v.inicio, v.fim, v.observacao
from visita v;
-- Ausentes de proposito: qualquer campo financeiro futuro,
-- avaliacao/afericao/sub-falha, controlador_id, dados_origem.

comment on view visita_campo is
  'D-007: visao do tecnico. Nao expoe financeiro nem avaliacao de '
  'qualidade. Reincidencia continua acessivel por tabela propria.';

-- ============================================================
-- Tabelas de dominio (referencia)
-- Sem RLS elas ficariam legiveis pela chave anon -- exatamente o
-- problema apontado no projeto antigo. Leitura para quem esta
-- logado; escrita so para ADMIN.
-- ============================================================

alter table area_trabalho       enable row level security;
alter table tipo_atividade      enable row level security;
alter table tipo_servico        enable row level security;
alter table tipo_os             enable row level security;
alter table codigo_baixa        enable row level security;
alter table segmentacao         enable row level security;
alter table categoria_capacidade enable row level security;
alter table base                enable row level security;

do $do$
declare t text;
begin
  foreach t in array array['area_trabalho','tipo_atividade','tipo_servico',
                           'tipo_os','codigo_baixa','segmentacao',
                           'categoria_capacidade','base']
  loop
    execute format(
      'create policy %I_leitura on %I for select to authenticated using (true)', t, t);
    execute format(
      'create policy %I_admin on %I for all to authenticated
         using (tem_papel(''ADMIN'')) with check (tem_papel(''ADMIN''))', t, t);
  end loop;
end
$do$;

-- Nenhuma tabela deste schema pode ficar sem RLS. Conferencia:
--   select tablename from pg_tables
--   where schemaname='public' and tablename not in (
--     select tablename from pg_tables t
--     join pg_class c on c.relname=t.tablename
--     where c.relrowsecurity);
