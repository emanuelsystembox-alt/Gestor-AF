-- 182 · O estoque conferido pelo TOA: a divergência vira fila do almoxarifado
--
-- O QUE RESOLVE
--   A varredura (117, D-250) já grava em `visita_equipamento_toa` o que o TOA
--   diz que foi INSTALADO e DESINSTALADO (retirado) em cada contrato. O
--   almoxarifado sabe o que está na carga de cada técnico (`equipamento.posse`,
--   romaneios) e o que o técnico lançou no campo (`equipamento_movimento`).
--   Ninguém cruzava as três. Pacote de inteligência operacional (D-262).
--
-- DECISÃO DO EMANUEL (02/11): SÓ ACUSAR.
--   "Estoque × TOA: só acusar — vira fila de divergência para o almoxarifado."
--   Nada aqui move posse nem saldo: a posse continua se movendo só por romaneio
--   ou pelo campo (D-154, D-157). A função é de LEITURA; a única escrita é a
--   tratativa da fila (quem olhou, quando e por quê), que não toca no estoque.
--
-- ┌─ AS SEIS DIVERGÊNCIAS ───────────────────────────────────────────────┐
-- │ Instalado no TOA (seção INSTALADO, item com serial):                  │
-- │   SEM_CADASTRO       o serial não existe em `equipamento`;            │
-- │   FORA_DA_CARGA      existe, mas não estava na carga de ninguém       │
-- │                      (sem posse, no almoxarifado, em trânsito…);      │
-- │   CARGA_DE_OUTRO     estava na carga de OUTRO técnico;                │
-- │   POSSE_NAO_BAIXADA  continua na carga do próprio técnico: o campo    │
-- │                      não lançou, e a posse não saiu dele.             │
-- │ Retirado no TOA (seção DESINSTALADO):                                 │
-- │   RETIRADO_SEM_DEVOLUTIVA  passou do prazo e não voltou em devolutiva │
-- │                      confirmada (nem está no almoxarifado).           │
-- │ Lançado no campo (equipamento_movimento):                             │
-- │   LANCADO_SEM_TOA    o técnico lançou um serial que a leitura do TOA  │
-- │                      daquele contrato não mostra — e a posse já se    │
-- │                      moveu por causa desse lançamento (079).          │
-- └───────────────────────────────────────────────────────────────────────┘
--
-- "QUAL ERA A POSSE" NO INSTALADO
--   Se o campo lançou o serial NESTE contrato, a posse de agora já é
--   COM_ASSINANTE (o gatilho da 079 moveu). A pergunta "estava na carga de
--   quem?" se responde pela posse ANTES do lançamento, que o gatilho da 126
--   guarda em `equipamento_movimento.posse_antes/posse_tecnico_antes`. Sem
--   lançamento, vale a posse de agora.
--
-- O TÉCNICO DO CONTRATO
--   `visita.tecnico_responsavel_id`. Contrato sem técnico (4 de 682 varridos
--   em Manaus): compara pela EQUIPE do técnico que tem a peça.
--
-- ZERO E "NÃO CONFERIDO" (regra 6)
--   Só entra na conta o contrato que o TOA ENCERROU (antes disso a lista do
--   TOA está incompleta — 117) e que a varredura LEU (`toa_varrido_em`).
--   Encerrado e não lido é "não conferido", contado à parte — nunca "sem
--   divergência". Medido em 02/11: dos 3.223 contratos encerrados de Manaus em
--   30 dias, 2.541 nunca foram lidos.
--
-- O PRAZO DO RETIRADO (parâmetro `retirado_devolutiva_dias`)
--   Nasce em 7 — PROPOSTA, para aprovação do Emanuel. Não há dado nosso de
--   quanto uma devolutiva leva: em 02/11 a base tinha 0 romaneios de
--   devolução. Troca-se pelo parâmetro, sem migration. Ver integracao.md.
--
-- O SERIAL
--   O TOA manda em caixa alta e sem espaço (2.388 de 2.388 conferidos). A
--   carga do Atlas tem seriais com '*' na frente ("*00214324ED8C"); casa-se
--   o serial do TOA com ele mesmo ou com '*' + ele.
--
-- CIDADE
--   O equipamento é da EMPRESA (o almoxarifado não tem cidade); o CONTRATO é
--   da cidade ativa (`bases_visiveis()`), como em toda tela.
--
-- QUEM VÊ / QUEM TRATA
--   Ver: `almoxarifado.ver` (o ADMIN passa dentro de `tem_permissao`).
--   Tratar (tirar da fila com motivo): `almoxarifado.editar`.
--   A tabela da tratativa não tem policy: só as duas funções leem e gravam.

-- ─── A · O prazo do retirado ───────────────────────────────────────────
insert into parametro (empresa_id, chave, valor, descricao)
select e.id, 'retirado_devolutiva_dias', '7'::jsonb,
       'Dias depois do contrato em que a peca RETIRADA do cliente (lida do TOA) '
       || 'ainda pode estar com o tecnico sem virar divergencia na Conferencia TOA '
       || 'do almoxarifado (182). So acusa: nao bloqueia nada.'
  from empresa e
on conflict do nothing;

-- ─── B · A tratativa da fila ───────────────────────────────────────────
-- Tratar não corrige o estoque: diz "o almoxarifado viu, e foi isto". A
-- correção, quando houver, continua sendo o romaneio ou o campo. Se a
-- divergência deixar de existir (a devolutiva chegou), a linha some da fila
-- sozinha — e a tratativa fica como histórico.
create table if not exists public.conferencia_toa_tratada (
  empresa_id  uuid not null references empresa(id),
  visita_id   uuid not null references visita(id) on delete cascade,
  tipo        text not null check (tipo in ('SEM_CADASTRO', 'FORA_DA_CARGA', 'CARGA_DE_OUTRO',
                                            'POSSE_NAO_BAIXADA', 'RETIRADO_SEM_DEVOLUTIVA',
                                            'LANCADO_SEM_TOA')),
  serial      text not null,
  motivo      text not null check (length(btrim(motivo)) >= 3),
  tratada_em  timestamptz not null default now(),
  tratada_por uuid references perfil(id) default auth.uid(),
  primary key (visita_id, tipo, serial)
);
alter table public.conferencia_toa_tratada enable row level security;
revoke all on table public.conferencia_toa_tratada from anon, authenticated;

-- ─── C · A conferência ─────────────────────────────────────────────────
create or replace function public.conferencia_estoque_toa(p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp   uuid := minha_empresa();
  v_hoje  date := hoje_local();
  v_ate   date := coalesce(p_ate, hoje_local());
  v_de    date := coalesce(p_de, coalesce(p_ate, hoje_local()) - 30);
  v_prazo int;
  v_res   jsonb;
begin
  if not tem_permissao('almoxarifado.ver') then
    raise exception 'Sem permissao para ver o almoxarifado.' using errcode = '42501';
  end if;
  if v_de > v_ate then
    raise exception 'Periodo invertido.' using errcode = '22023';
  end if;
  if v_ate - v_de > 92 then
    raise exception 'Periodo de ate 3 meses.' using errcode = '22023';
  end if;

  select (valor #>> '{}')::int into v_prazo
    from parametro where empresa_id = v_emp and chave = 'retirado_devolutiva_dias';
  v_prazo := coalesce(v_prazo, 7);

  with vis as materialized (
    -- Os contratos que o TOA encerrou, na cidade ativa e no período.
    select v.id, v.contrato, v.data_agendada as dia, v.tecnico_responsavel_id as tec,
           v.equipe_id, v.toa_varrido_em
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.empresa_id = v_emp
       and v.base_id in (select bases_visiveis())
       and v.data_agendada between v_de and v_ate
       and v.excluido_em is null
       and coalesce(v.finalizado_toa, false)
       and coalesce(ta.natureza, '') <> 'JORNADA'
  ),
  toa as materialized (
    -- O que o TOA diz, só dos contratos LIDOS; item com serial.
    select vi.id as visita_id, vi.contrato, vi.dia, vi.tec, vi.equipe_id,
           t.secao, upper(regexp_replace(t.serial, '\s', '', 'g')) as serial,
           t.tipo as eq_tipo, t.modelo, t.lido_em
      from vis vi
      join visita_equipamento_toa t on t.visita_id = vi.id
     where vi.toa_varrido_em is not null
       and not t.miscelanea
       and t.secao in ('INSTALADO', 'DESINSTALADO')
  ),
  cruz as materialized (
    select o.*, e.id as equip_id, e.serial as serial_cadastro,
           e.posse, e.posse_tecnico_id, e.posse_em,
           m.posse_antes, m.posse_tecnico_antes, (m.id is not null) as campo_lancou,
           -- a posse que vale para "estava na carga de quem": antes do
           -- lançamento do campo neste contrato, ou a de agora
           case when m.id is not null then m.posse_antes else e.posse end as posse_ref,
           case when m.id is not null then m.posse_tecnico_antes else e.posse_tecnico_id end as tec_ref
      from toa o
      left join lateral (
        select e.* from equipamento e
         where e.empresa_id = v_emp and e.serial in (o.serial, '*' || o.serial)
         order by (e.serial = o.serial) desc
         limit 1) e on true
      left join lateral (
        select m.* from equipamento_movimento m
         where m.visita_id = o.visita_id and m.serial = o.serial
           and m.operacao = case o.secao when 'INSTALADO' then 'INSTALADO' else 'RETIRADO' end
         order by m.criado_em
         limit 1) m on true
  ),
  classe as materialized (
    select c.*,
           case
             when c.secao = 'INSTALADO' and c.equip_id is null then 'SEM_CADASTRO'
             when c.secao = 'INSTALADO' and c.posse_ref = 'COM_TECNICO'
                  and (case when c.tec is not null then c.tec_ref = c.tec
                            else (select t.equipe_id from tecnico t where t.id = c.tec_ref)
                                   is not distinct from c.equipe_id end)
                  then case when c.campo_lancou then null else 'POSSE_NAO_BAIXADA' end
             when c.secao = 'INSTALADO' and c.posse_ref = 'COM_TECNICO' then 'CARGA_DE_OUTRO'
             -- COM_ASSINANTE sem lançamento neste contrato é peça que, para nós,
             -- estava em outro cliente: também não saiu da carga de ninguém.
             when c.secao = 'INSTALADO' then 'FORA_DA_CARGA'
             when c.secao = 'DESINSTALADO' and v_hoje - c.dia > v_prazo
                  and not (
                    -- devolutiva confirmada depois do contrato…
                    (c.equip_id is not null and exists (
                       select 1 from romaneio_item ri
                         join romaneio r on r.id = ri.romaneio_id
                        where ri.equipamento_id = c.equip_id
                          and r.tipo = 'DEVOLUCAO' and r.situacao = 'CONFIRMADO'
                          and (r.confirmado_em at time zone 'America/Manaus')::date >= c.dia))
                    -- …ou a peça já está de volta, por qualquer documento
                    -- (coalesce: peça fora do cadastro tem posse NULA, e `not null`
                    --  é nulo — a linha sumia da fila calada; pegou no 1º teste)
                    or coalesce(c.posse in ('NO_ALMOXARIFADO', 'DEVOLVIDO_CLARO')
                        and (c.posse_em at time zone 'America/Manaus')::date >= c.dia, false))
                  then 'RETIRADO_SEM_DEVOLUTIVA'
           end as tipo
      from cruz c
  ),
  campo as materialized (
    -- O que o técnico lançou num contrato LIDO e o TOA não mostra.
    select vi.id as visita_id, vi.contrato, vi.dia, vi.tec, vi.equipe_id,
           case m.operacao when 'INSTALADO' then 'INSTALADO' else 'DESINSTALADO' end as secao,
           m.serial, m.tipo as eq_tipo, m.modelo, null::timestamptz as lido_em,
           m.tecnico_id as tec_lancou, m.criado_em as lancado_em
      from vis vi
      join equipamento_movimento m on m.visita_id = vi.id
     where vi.toa_varrido_em is not null
       and not exists (
         select 1 from visita_equipamento_toa t
          where t.visita_id = vi.id and not t.miscelanea
            and upper(regexp_replace(t.serial, '\s', '', 'g')) = m.serial
            and t.secao = case m.operacao when 'INSTALADO' then 'INSTALADO' else 'DESINSTALADO' end)
  ),
  fila as (
    select k.tipo, k.visita_id, k.contrato, k.dia, k.tec, k.equipe_id, k.secao, k.serial,
           k.eq_tipo, k.modelo, k.lido_em, k.posse, k.posse_tecnico_id, k.posse_em,
           k.tec_ref, null::timestamptz as lancado_em
      from classe k
     where k.tipo is not null
    union all
    select 'LANCADO_SEM_TOA', c.visita_id, c.contrato, c.dia, c.tec, c.equipe_id, c.secao, c.serial,
           c.eq_tipo, c.modelo, c.lido_em, e.posse, e.posse_tecnico_id, e.posse_em,
           c.tec_lancou, c.lancado_em
      from campo c
      left join equipamento e on e.empresa_id = v_emp and e.serial = c.serial
  ),
  itens as (
    select f.*, tr.motivo, tr.tratada_em,
           (select p.nome from perfil p where p.id = tr.tratada_por) as tratada_por
      from fila f
      left join conferencia_toa_tratada tr
        on tr.visita_id = f.visita_id and tr.tipo = f.tipo and tr.serial = f.serial
  )
  select jsonb_build_object(
    'de', v_de, 'ate', v_ate, 'prazo_retirado_dias', v_prazo,
    'cadastro_pecas', (select count(*) from equipamento where empresa_id = v_emp),
    'contratos', jsonb_build_object(
      'encerrados', (select count(*) from vis),
      'conferidos', (select count(*) from vis where toa_varrido_em is not null),
      'nao_conferidos', (select count(*) from vis where toa_varrido_em is null)),
    'seriais_lidos', jsonb_build_object(
      'instalados', (select count(*) from toa where secao = 'INSTALADO'),
      'retirados', (select count(*) from toa where secao = 'DESINSTALADO')),
    -- retirado ainda dentro do prazo: não é divergência, mas é o que vem
    'retirados_no_prazo', (select count(*) from classe
                            where secao = 'DESINSTALADO' and v_hoje - dia <= v_prazo),
    'por_tipo', coalesce((
      select jsonb_object_agg(x.tipo, jsonb_build_object('abertas', x.a, 'tratadas', x.t))
        from (select tipo, count(*) filter (where motivo is null) a,
                     count(*) filter (where motivo is not null) t
                from itens group by tipo) x), '{}'::jsonb),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tipo', i.tipo, 'visita_id', i.visita_id, 'contrato', i.contrato, 'dia', i.dia,
               'secao', i.secao, 'serial', i.serial, 'equipamento', i.eq_tipo, 'modelo', i.modelo,
               'tecnico', (select t.nome from tecnico t where t.id = i.tec),
               'equipe', (select q.codigo from equipe q where q.id = i.equipe_id),
               'posse', i.posse,
               'posse_tecnico', (select t.nome from tecnico t where t.id = i.posse_tecnico_id),
               'posse_em', i.posse_em,
               -- CARGA_DE_OUTRO: de quem era; LANCADO_SEM_TOA: quem lançou
               'outro_tecnico', case when i.tipo in ('CARGA_DE_OUTRO', 'LANCADO_SEM_TOA')
                                     then (select t.nome from tecnico t where t.id = i.tec_ref) end,
               'dias', v_hoje - i.dia,
               'lido_em', i.lido_em, 'lancado_em', i.lancado_em,
               'tratada', case when i.motivo is not null then jsonb_build_object(
                             'motivo', i.motivo, 'em', i.tratada_em, 'por', i.tratada_por) end)
             order by i.dia desc, i.contrato, i.serial)
        from itens i), '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$$;
revoke all on function public.conferencia_estoque_toa(date, date) from public, anon;
grant execute on function public.conferencia_estoque_toa(date, date) to authenticated;

-- ─── D · Tratar uma linha da fila ──────────────────────────────────────
-- Motivo obrigatório: "visto" sem porquê é a mesma linha voltando amanhã
-- para outra pessoa olhar. O autor é o servidor (D-061).
create or replace function public.tratar_divergencia_toa(
  p_visita uuid, p_tipo text, p_serial text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_emp uuid;
begin
  if not tem_permissao('almoxarifado.editar') then
    raise exception 'Sem permissao para tratar a conferencia.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escreva o motivo.' using errcode = '23514';
  end if;
  select v.empresa_id into v_emp from visita v
   where v.id = p_visita and v.empresa_id = (select minha_empresa())
     and v.base_id in (select bases_visiveis());
  if v_emp is null then
    raise exception 'Contrato fora da cidade ativa.' using errcode = '42501';
  end if;

  insert into conferencia_toa_tratada (empresa_id, visita_id, tipo, serial, motivo)
  values (v_emp, p_visita, p_tipo, upper(regexp_replace(coalesce(p_serial, ''), '\s', '', 'g')),
          left(btrim(p_motivo), 300))
  on conflict (visita_id, tipo, serial) do update
     set motivo = excluded.motivo, tratada_em = now(), tratada_por = auth.uid();
end;
$$;
revoke all on function public.tratar_divergencia_toa(uuid, text, text, text) from public, anon;
grant execute on function public.tratar_divergencia_toa(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
