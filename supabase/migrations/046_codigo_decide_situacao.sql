-- 046 · O código de baixa decide a situação · e a baixa automática
--
-- ┌─ O QUE O EMANUEL PEDIU ──────────────────────────────────────────┐
-- │ "Analise os 2 meses do analítico do concorrente: quais códigos    │
-- │  executados devem ir para cancelado, concluído ou reagendado. São │
-- │  códigos específicos, e o sistema deve ter um painel de           │
-- │  configurações para isso.                                          │
-- │                                                                    │
-- │  Quando o técnico finaliza no TOA, com status concluído ou não    │
-- │  concluído, significa que o contrato foi baixado de fato — aí o   │
-- │  nosso sistema deve baixar automático. Ou, em configurações, um   │
-- │  controle para habilitar ou desativar essa função: fazer só a     │
-- │  leitura dos códigos, contratos, deslocamento e em execução, e o  │
-- │  usuário escolhe se o sistema baixa automático igual ao TOA ou se │
-- │  o técnico baixa manual."                                          │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ============================================================
-- O QUE O DADO DISSE
-- ============================================================
-- Cruzamento de **67.485 linhas** do analítico do ngestor (meses 06 e
-- 07/2026), pela coluna `Código De Baixa` × `Situação`:
--
--   Concluido ........ 41.952      Em execução ......... 336
--   Reagendamento .... 11.779      Em deslocamento ..... 204
--   Cancelado ......... 9.829      Pendente ............. 42
--   Entrada - In Box .. 3.318      Com Impedimento ...... 25
--
-- **206 códigos aparecem com situação final. 203 deles são
-- determinísticos** — cada um cai sempre na mesma situação, em 57.281
-- das 63.560 linhas. Não é tendência: é regra.
--
--   409 · Instalacao Efetuada ........... CONCLUIDA      21.222×  100%
--   106 · Cliente Ausente ............... REAGENDAMENTO   3.550×  100%
--   430 · EQUIPAMENTO RETIRADO .......... CONCLUIDA       2.399×  100%
--   101 · Endereco Nao Localizado ....... REAGENDAMENTO   1.305×  100%
--   301 · Tipo de OS Incorreta .......... CANCELADA         882×  100%
--   302 · Desistencia da Assinatura ..... CANCELADA         551×  100%
--
-- **Os 3 que não são puros ficam registrados com a pureza medida**, em
-- vez de virarem regra silenciosa:
--
--   800 · Desatribuido ....... CANCELADA      90,2%  (601× Reagendamento)
--   217 · BACKBONE GPON ...... REAGENDAMENTO  85,6%  ( 21× Concluído)
--   "-" (sem código) ......... ignorado, não é código
--
-- ⚠ **O status da operadora NÃO decide a situação.** Foi a primeira
--   coisa que testei, porque era o caminho óbvio:
--
--     EXECUTADA     → Concluído 33.688 · Reagendamento 1.075 · Cancelado 657
--     NÃO EXECUTADA → Reagendamento 6.597 · Cancelado 2.090 · Concluído 502
--
--   Quem decide é o CÓDIGO. O status diz apenas que houve baixa — que é
--   o gatilho, não o resultado. Por isso as duas coisas ficam separadas
--   aqui: `codigo_baixa.situacao_destino` (o que a baixa significa) e o
--   parâmetro `baixa_automatica` (se agimos sozinhos quando ela chega).

-- ============================================================
-- A · O que cada código significa
-- ============================================================
alter table codigo_baixa add column if not exists situacao_destino text
  references situacao_visita(codigo);
alter table codigo_baixa add column if not exists situacao_origem text
  check (situacao_origem in ('ANALISE', 'CADASTRO'));
alter table codigo_baixa add column if not exists situacao_por uuid references perfil(id);
alter table codigo_baixa add column if not exists situacao_em timestamptz;

comment on column codigo_baixa.situacao_destino is
  'Para qual situacao a visita vai quando a baixa e este codigo.';
comment on column codigo_baixa.situacao_origem is
  'ANALISE = derivado do analitico do ngestor (046). CADASTRO = alguem digitou na tela.';

-- valores derivados de 67.485 linhas do analitico do ngestor
-- (meses 06 e 07 de 2026). Coluna `pureza`: a fracao das vezes em que
-- aquele codigo caiu NAQUELA situacao. 1.0 = sempre.
with analise (codigo, situacao, ocorrencias, pureza) as (values
  (1, 'CONCLUIDA', 6, 1.0000),
  (2, 'CANCELADA', 17, 1.0000),
  (3, 'REAGENDAMENTO', 1, 1.0000),
  (100, 'REAGENDAMENTO', 820, 1.0000),
  (101, 'REAGENDAMENTO', 1305, 1.0000),
  (102, 'REAGENDAMENTO', 11, 1.0000),
  (103, 'REAGENDAMENTO', 80, 1.0000),
  (104, 'REAGENDAMENTO', 36, 1.0000),
  (105, 'REAGENDAMENTO', 24, 1.0000),
  (106, 'REAGENDAMENTO', 3550, 1.0000),
  (107, 'REAGENDAMENTO', 605, 1.0000),
  (108, 'REAGENDAMENTO', 5, 1.0000),
  (109, 'CANCELADA', 6, 1.0000),
  (110, 'REAGENDAMENTO', 536, 1.0000),
  (111, 'REAGENDAMENTO', 156, 1.0000),
  (112, 'REAGENDAMENTO', 148, 1.0000),
  (113, 'REAGENDAMENTO', 1, 1.0000),
  (114, 'REAGENDAMENTO', 3, 1.0000),
  (125, 'REAGENDAMENTO', 939, 1.0000),
  (126, 'REAGENDAMENTO', 84, 1.0000),
  (127, 'REAGENDAMENTO', 2, 1.0000),
  (128, 'REAGENDAMENTO', 47, 1.0000),
  (134, 'CANCELADA', 19, 1.0000),
  (200, 'REAGENDAMENTO', 1, 1.0000),
  (201, 'REAGENDAMENTO', 2, 1.0000),
  (202, 'REAGENDAMENTO', 26, 1.0000),
  (203, 'REAGENDAMENTO', 765, 1.0000),
  (204, 'CONCLUIDA', 325, 1.0000),
  (205, 'CANCELADA', 16, 1.0000),
  (206, 'CANCELADA', 238, 1.0000),
  (209, 'REAGENDAMENTO', 29, 1.0000),
  (211, 'CANCELADA', 66, 1.0000),
  (217, 'REAGENDAMENTO', 146, 0.8562),
  (301, 'CANCELADA', 882, 1.0000),
  (302, 'CANCELADA', 551, 1.0000),
  (303, 'CANCELADA', 22, 1.0000),
  (305, 'CANCELADA', 277, 1.0000),
  (306, 'REAGENDAMENTO', 525, 1.0000),
  (307, 'REAGENDAMENTO', 4, 1.0000),
  (308, 'CANCELADA', 92, 1.0000),
  (310, 'CANCELADA', 1, 1.0000),
  (311, 'REAGENDAMENTO', 1, 1.0000),
  (312, 'REAGENDAMENTO', 778, 1.0000),
  (314, 'REAGENDAMENTO', 51, 1.0000),
  (316, 'CANCELADA', 271, 1.0000),
  (328, 'CONCLUIDA', 60, 1.0000),
  (400, 'CONCLUIDA', 41, 1.0000),
  (402, 'REAGENDAMENTO', 173, 1.0000),
  (404, 'CANCELADA', 620, 1.0000),
  (405, 'CONCLUIDA', 2, 1.0000),
  (407, 'CONCLUIDA', 9, 1.0000),
  (408, 'CONCLUIDA', 6, 1.0000),
  (409, 'CONCLUIDA', 21222, 1.0000),
  (410, 'CONCLUIDA', 14, 1.0000),
  (413, 'CONCLUIDA', 1, 1.0000),
  (416, 'CONCLUIDA', 2, 1.0000),
  (417, 'CONCLUIDA', 66, 1.0000),
  (418, 'CONCLUIDA', 11, 1.0000),
  (419, 'CONCLUIDA', 2, 1.0000),
  (421, 'CONCLUIDA', 2, 1.0000),
  (422, 'CONCLUIDA', 13, 1.0000),
  (423, 'CONCLUIDA', 8, 1.0000),
  (424, 'CONCLUIDA', 10, 1.0000),
  (425, 'CONCLUIDA', 313, 1.0000),
  (427, 'CONCLUIDA', 18, 1.0000),
  (428, 'CONCLUIDA', 1, 1.0000),
  (429, 'CONCLUIDA', 3, 1.0000),
  (430, 'CONCLUIDA', 2399, 1.0000),
  (431, 'CONCLUIDA', 13, 1.0000),
  (436, 'CONCLUIDA', 1, 1.0000),
  (437, 'CONCLUIDA', 3, 1.0000),
  (439, 'CONCLUIDA', 1, 1.0000),
  (440, 'CONCLUIDA', 37, 1.0000),
  (443, 'CONCLUIDA', 1, 1.0000),
  (444, 'CONCLUIDA', 9, 1.0000),
  (446, 'CONCLUIDA', 1, 1.0000),
  (447, 'CONCLUIDA', 2, 1.0000),
  (449, 'CONCLUIDA', 3, 1.0000),
  (451, 'CONCLUIDA', 23, 1.0000),
  (453, 'CONCLUIDA', 4, 1.0000),
  (455, 'CONCLUIDA', 4, 1.0000),
  (458, 'CONCLUIDA', 1, 1.0000),
  (459, 'CONCLUIDA', 4, 1.0000),
  (460, 'CONCLUIDA', 2, 1.0000),
  (463, 'CONCLUIDA', 3, 1.0000),
  (464, 'CONCLUIDA', 12, 1.0000),
  (467, 'CONCLUIDA', 8, 1.0000),
  (471, 'CONCLUIDA', 9, 1.0000),
  (472, 'CONCLUIDA', 6, 1.0000),
  (473, 'CONCLUIDA', 38, 1.0000),
  (474, 'CONCLUIDA', 25, 1.0000),
  (475, 'CONCLUIDA', 3, 1.0000),
  (476, 'CONCLUIDA', 59, 1.0000),
  (477, 'CONCLUIDA', 13, 1.0000),
  (478, 'CONCLUIDA', 25, 1.0000),
  (479, 'REAGENDAMENTO', 337, 1.0000),
  (483, 'CONCLUIDA', 21, 1.0000),
  (484, 'CONCLUIDA', 9, 1.0000),
  (500, 'CONCLUIDA', 1852, 1.0000),
  (501, 'CONCLUIDA', 13, 1.0000),
  (502, 'CONCLUIDA', 8, 1.0000),
  (504, 'CONCLUIDA', 4, 1.0000),
  (505, 'CONCLUIDA', 1040, 1.0000),
  (506, 'CONCLUIDA', 97, 1.0000),
  (507, 'CONCLUIDA', 29, 1.0000),
  (508, 'CONCLUIDA', 3, 1.0000),
  (509, 'CONCLUIDA', 190, 1.0000),
  (510, 'CONCLUIDA', 641, 1.0000),
  (511, 'CONCLUIDA', 4, 1.0000),
  (512, 'CONCLUIDA', 20, 1.0000),
  (513, 'CONCLUIDA', 2, 1.0000),
  (514, 'CONCLUIDA', 151, 1.0000),
  (515, 'CONCLUIDA', 6, 1.0000),
  (516, 'CONCLUIDA', 1130, 1.0000),
  (517, 'CONCLUIDA', 1091, 1.0000),
  (518, 'CONCLUIDA', 415, 1.0000),
  (519, 'CONCLUIDA', 5, 1.0000),
  (520, 'CONCLUIDA', 52, 1.0000),
  (521, 'CONCLUIDA', 648, 1.0000),
  (522, 'CONCLUIDA', 381, 1.0000),
  (523, 'CONCLUIDA', 271, 1.0000),
  (524, 'CONCLUIDA', 212, 1.0000),
  (525, 'CONCLUIDA', 56, 1.0000),
  (526, 'CONCLUIDA', 85, 1.0000),
  (527, 'CONCLUIDA', 364, 1.0000),
  (528, 'CONCLUIDA', 5, 1.0000),
  (529, 'CONCLUIDA', 34, 1.0000),
  (530, 'CONCLUIDA', 17, 1.0000),
  (532, 'CONCLUIDA', 3, 1.0000),
  (533, 'CONCLUIDA', 157, 1.0000),
  (534, 'CONCLUIDA', 106, 1.0000),
  (535, 'CONCLUIDA', 43, 1.0000),
  (536, 'CONCLUIDA', 146, 1.0000),
  (537, 'CONCLUIDA', 833, 1.0000),
  (538, 'CONCLUIDA', 35, 1.0000),
  (539, 'CONCLUIDA', 17, 1.0000),
  (540, 'CONCLUIDA', 144, 1.0000),
  (541, 'CONCLUIDA', 165, 1.0000),
  (542, 'CONCLUIDA', 76, 1.0000),
  (543, 'CONCLUIDA', 103, 1.0000),
  (544, 'CONCLUIDA', 45, 1.0000),
  (545, 'CONCLUIDA', 27, 1.0000),
  (546, 'CONCLUIDA', 3, 1.0000),
  (547, 'CONCLUIDA', 19, 1.0000),
  (548, 'CONCLUIDA', 21, 1.0000),
  (549, 'CONCLUIDA', 119, 1.0000),
  (550, 'CONCLUIDA', 4, 1.0000),
  (551, 'CONCLUIDA', 29, 1.0000),
  (552, 'CONCLUIDA', 199, 1.0000),
  (553, 'CONCLUIDA', 11, 1.0000),
  (554, 'CONCLUIDA', 16, 1.0000),
  (555, 'CONCLUIDA', 1102, 1.0000),
  (556, 'CONCLUIDA', 219, 1.0000),
  (557, 'CONCLUIDA', 77, 1.0000),
  (558, 'CONCLUIDA', 107, 1.0000),
  (560, 'CONCLUIDA', 184, 1.0000),
  (561, 'CONCLUIDA', 6, 1.0000),
  (562, 'CONCLUIDA', 344, 1.0000),
  (563, 'CONCLUIDA', 24, 1.0000),
  (564, 'CONCLUIDA', 27, 1.0000),
  (565, 'CONCLUIDA', 15, 1.0000),
  (566, 'CONCLUIDA', 999, 1.0000),
  (567, 'CONCLUIDA', 229, 1.0000),
  (568, 'CONCLUIDA', 1, 1.0000),
  (569, 'CONCLUIDA', 2, 1.0000),
  (570, 'CONCLUIDA', 285, 1.0000),
  (571, 'CONCLUIDA', 9, 1.0000),
  (572, 'CONCLUIDA', 1, 1.0000),
  (573, 'CONCLUIDA', 25, 1.0000),
  (574, 'CONCLUIDA', 91, 1.0000),
  (575, 'CONCLUIDA', 2, 1.0000),
  (576, 'CONCLUIDA', 2, 1.0000),
  (577, 'CONCLUIDA', 1, 1.0000),
  (578, 'CONCLUIDA', 2, 1.0000),
  (579, 'CONCLUIDA', 62, 1.0000),
  (580, 'CONCLUIDA', 6, 1.0000),
  (581, 'CONCLUIDA', 1, 1.0000),
  (582, 'CONCLUIDA', 6, 1.0000),
  (583, 'CONCLUIDA', 197, 1.0000),
  (584, 'CONCLUIDA', 1043, 1.0000),
  (585, 'CONCLUIDA', 31, 1.0000),
  (586, 'CONCLUIDA', 214, 1.0000),
  (588, 'CONCLUIDA', 89, 1.0000),
  (589, 'CONCLUIDA', 411, 1.0000),
  (590, 'CONCLUIDA', 3, 1.0000),
  (591, 'CONCLUIDA', 1, 1.0000),
  (594, 'CONCLUIDA', 70, 1.0000),
  (597, 'CONCLUIDA', 6, 1.0000),
  (599, 'CONCLUIDA', 2, 1.0000),
  (600, 'CANCELADA', 115, 1.0000),
  (601, 'CANCELADA', 1, 1.0000),
  (603, 'CANCELADA', 3, 1.0000),
  (605, 'CANCELADA', 1, 1.0000),
  (606, 'CANCELADA', 1, 1.0000),
  (611, 'CANCELADA', 8, 1.0000),
  (615, 'CANCELADA', 2, 1.0000),
  (700, 'CONCLUIDA', 6, 1.0000),
  (706, 'CONCLUIDA', 6, 1.0000),
  (800, 'CANCELADA', 6114, 0.9017),
  (1000, 'REAGENDAMENTO', 1, 1.0000),
  (2002, 'CONCLUIDA', 2, 1.0000)
)
update codigo_baixa cb
   set situacao_destino = a.situacao,
       situacao_origem  = 'ANALISE',
       situacao_em      = now()
  from analise a
 where cb.codigo = a.codigo
   and cb.situacao_destino is null;

-- ============================================================
-- B · Parâmetros da operação
-- ============================================================
-- Chave/valor por empresa, com autor. Serve para a baixa automática e
-- para o que vier — mas cada chave nasce aqui, declarada: parâmetro que
-- qualquer tela inventa vira configuração fantasma.
create table if not exists parametro (
  empresa_id     uuid not null references empresa(id),
  chave          text not null,
  valor          jsonb not null,
  descricao      text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references perfil(id),
  primary key (empresa_id, chave)
);

alter table parametro enable row level security;

drop policy if exists parametro_leitura on parametro;
create policy parametro_leitura on parametro for select to authenticated
  using (empresa_id = minha_empresa());

-- Escrita só por quem administra: um parâmetro deste muda o que o
-- sistema faz sozinho com o contrato de todo mundo.
drop policy if exists parametro_escrita on parametro;
create policy parametro_escrita on parametro for all to authenticated
  using (empresa_id = minha_empresa() and tem_papel('ADMIN'))
  with check (empresa_id = minha_empresa() and tem_papel('ADMIN'));

insert into parametro (empresa_id, chave, valor, descricao)
select e.id, 'baixa_automatica', 'false'::jsonb,
       'Quando o TOA traz a baixa, o sistema aplica a situacao do codigo sozinho. Desligado, a importacao so le e quem baixa e o tecnico.'
  from empresa e
 where not exists (select 1 from parametro p
                    where p.empresa_id = e.id and p.chave = 'baixa_automatica');

-- Nasce DESLIGADO. Ligar muda o que acontece com contrato de verdade —
-- quem liga tem de ser alguém, não a migration.

create or replace function ler_parametro(p_chave text)
returns jsonb language sql stable security definer set search_path to 'public' as $fn$
  select valor from parametro
   where empresa_id = minha_empresa() and chave = p_chave;
$fn$;

revoke all on function ler_parametro(text) from public, anon;
grant execute on function ler_parametro(text) to authenticated;

create or replace function definir_parametro(p_chave text, p_valor jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_antes jsonb;
begin
  if not tem_papel('ADMIN') then
    raise exception 'Somente ADMIN muda parametro da operacao.' using errcode = '42501';
  end if;
  select valor into v_antes from parametro
   where empresa_id = minha_empresa() and chave = p_chave;
  if v_antes is null then
    raise exception 'Parametro "%" nao existe.', p_chave using errcode = 'P0002';
  end if;

  update parametro
     set valor = p_valor, atualizado_em = now(), atualizado_por = auth.uid()
   where empresa_id = minha_empresa() and chave = p_chave;

  return jsonb_build_object('chave', p_chave, 'de', v_antes, 'para', p_valor);
end;
$fn$;

revoke all on function definir_parametro(text, jsonb) from public, anon;
grant execute on function definir_parametro(text, jsonb) to authenticated;

-- ============================================================
-- C · Declarar o destino de um código na tela
-- ============================================================
-- Quem digita vira CADASTRO e nunca mais é sobrescrito por análise
-- nenhuma (D-089: o que a pessoa declarou vale mais que o que eu
-- deduzi, mesmo quando deduzi de 67 mil linhas).
create or replace function definir_situacao_do_codigo(
  p_codigo integer, p_situacao text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_antes text; v_desc text;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  if not tem_permissao('configuracoes.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar" em configuracoes.'
      using errcode = '42501';
  end if;
  if p_situacao is not null
     and not exists (select 1 from situacao_visita where codigo = p_situacao) then
    raise exception 'Situacao "%" nao existe.', p_situacao using errcode = '23514';
  end if;

  select situacao_destino, descricao into v_antes, v_desc
    from codigo_baixa where codigo = p_codigo and empresa_id = minha_empresa();
  if v_desc is null then
    raise exception 'Codigo de baixa % nao encontrado.', p_codigo using errcode = 'P0002';
  end if;

  update codigo_baixa
     set situacao_destino = p_situacao,
         situacao_origem  = case when p_situacao is null then null else 'CADASTRO' end,
         situacao_por     = auth.uid(),
         situacao_em      = now()
   where codigo = p_codigo and empresa_id = minha_empresa();

  return jsonb_build_object('codigo', p_codigo, 'descricao', v_desc,
                            'de', v_antes, 'para', p_situacao);
end;
$fn$;

revoke all on function definir_situacao_do_codigo(integer, text) from public, anon;
grant execute on function definir_situacao_do_codigo(integer, text) to authenticated;

-- ============================================================
-- D · A situação que a baixa produz
-- ============================================================
-- Uma visita tem de 1 a 10 O.S. (D-002), e cada uma tem seu código. A
-- visita só fecha quando TODAS baixaram — e o resultado da visita é o
-- da O.S. mais "grave": cancelada manda em reagendada, que manda em
-- concluída. Sem isso, a visita com uma O.S. cancelada e outra
-- concluída viraria concluída e o cancelamento sumiria do painel.
create or replace function situacao_da_baixa(p_visita uuid)
returns text language sql stable set search_path to 'public' as $fn$
  with os as (
    select o.id, cb.situacao_destino
      from ordem_servico o
      left join codigo_baixa cb on cb.id = o.codigo_baixa_id
     where o.visita_id = p_visita
  )
  select case
    when count(*) = 0 then null
    when count(*) filter (where situacao_destino is null) > 0 then null
    when count(*) filter (where situacao_destino = 'CANCELADA') > 0 then 'CANCELADA'
    when count(*) filter (where situacao_destino = 'REAGENDAMENTO') > 0 then 'REAGENDAMENTO'
    else 'CONCLUIDA'
  end
  from os;
$fn$;

revoke all on function situacao_da_baixa(uuid) from public, anon;
grant execute on function situacao_da_baixa(uuid) to authenticated;

notify pgrst, 'reload schema';
