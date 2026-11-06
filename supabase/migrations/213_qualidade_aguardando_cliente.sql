-- 213 · Qualidade: o estagio AGUARDANDO CLIENTE, entre o pendente e o desfecho
--
-- > "A tela da pesquisa pos-atendimento deve ter um estagio inicial de
-- >  status em cada contrato, por exemplo, Aguardando Retorno do Cliente,
-- >  ao lado do Ligacao, WhatsApp, Aguardando Cliente, so para a gente
-- >  saber que estao aguardando retorno do cliente ok? entao precisa
-- >  melhorar um pouco o fluxo da informacao."  -- Emanuel, 05/11
--
-- O analista manda o WhatsApp (ou liga) e o assinante fica de responder.
-- Ate aqui a tela so tinha duas casas: PENDENTE (sem linha em
-- `pesquisa_qualidade`) e o DESFECHO. Quem estava esperando resposta
-- ficava igual a quem ninguem tinha tocado -- e o colega ligava de novo.
--
-- ┌─ por que tabela PROPRIA, e nao uma coluna em pesquisa_qualidade ──┐
-- │ `pesquisa_qualidade.desfecho` e NOT NULL e a 148 escreveu: "a      │
-- │ ausencia de LINHA e que significa PENDENTE". Todo indicador conta  │
-- │ `count(desfecho)` como AVALIADO (cobertura, contato). Pendurar o   │
-- │ aguardando ali exigiria desfecho nulo e reescrever as seis contas  │
-- │ -- e o aguardando NAO e avaliado (pedido explicito). Tabela a      │
-- │ parte deixa os indicadores intactos por construcao: nenhum deles   │
-- │ le esta tabela.                                                    │
-- └────────────────────────────────────────────────────────────────────┘
--
-- AS REGRAS (as que nao vieram na frase estao marcadas para o Emanuel
-- confirmar):
--   * marcar grava QUEM (auth.uid(), nunca do cliente -- D-061), QUANDO
--     e por qual CANAL (LIGACAO / WHATSAPP, o mesmo CHECK da pesquisa);
--   * um aguardando ABERTO por contrato (indice unico parcial); marcar de
--     novo com outro canal atualiza o aberto, nao abre outro;
--   * desmarcar e registrar o desfecho FECHAM o aberto -- nao apagam: a
--     linha fica com quem fechou, quando e como (DESMARCADO / DESFECHO);
--   * [a confirmar] so se marca em contrato SEM desfecho ou cujo
--     desfecho nao falou com ninguem (`qualidade_contatado` falso: Nao
--     atendeu, Sem numero). Normalizado "aguardando cliente" nao faz
--     sentido, e a regra usa a funcao que ja existe em vez de uma lista.
--   * o telefone digitado antes de marcar fica guardado aqui (sem isso,
--     ele so ia para o banco junto com o desfecho e se perdia).
--
-- `qualidade_fila` ganha tres colunas no FIM do retorno -- `create or
-- replace` nao muda tipo de retorno (traps.md), entao drop + create, com
-- a ACL refeita. As tres funcoes que leem a fila (`indicadores`,
-- `observacoes`, `por_grupo`) leem por NOME, e coluna a mais nao quebra o
-- site publicado (o que quebra e RETORNO trocado, D-260).
--
-- Corpo de `registrar_qualidade` e `qualidade_fila` copiado da versao
-- VIVA (pg_get_functiondef, 05/11), nao do arquivo da 148.

-- ------------------------------------------------------------------ --
--  A tabela
-- ------------------------------------------------------------------ --

create table if not exists qualidade_aguardando (
  id            uuid primary key default gen_random_uuid(),
  visita_id     uuid not null references visita(id) on delete cascade,
  empresa_id    uuid not null references empresa(id),
  base_id       uuid references base(id),
  canal         text not null check (canal in ('LIGACAO','WHATSAPP')),
  -- LGPD: dado de assinante, mesmo tratamento de pesquisa_qualidade.telefone
  telefone      text,
  usuario_id    uuid references auth.users(id),
  marcado_em    timestamptz not null default now(),
  encerrado_em  timestamptz,
  encerrado_por uuid references auth.users(id),
  encerrado_como text check (encerrado_como in ('DESMARCADO','DESFECHO')),
  constraint qualidade_aguardando_encerramento_inteiro check (
    (encerrado_em is null and encerrado_por is null and encerrado_como is null)
    or (encerrado_em is not null and encerrado_como is not null))
);

comment on table qualidade_aguardando is
  'Qualidade (213): o contato foi feito e o assinante ficou de retornar. '
  'NAO e desfecho e nao entra em indicador nenhum. Aberto = encerrado_em nulo.';

create unique index if not exists qualidade_aguardando_um_aberto
  on qualidade_aguardando (visita_id) where encerrado_em is null;
create index if not exists ix_qa_empresa_aberto
  on qualidade_aguardando (empresa_id) where encerrado_em is null;

alter table qualidade_aguardando enable row level security;

-- Le quem le a pesquisa: mesma regra de pesquisa_qualidade_ler (147/148).
drop policy if exists qualidade_aguardando_ler on qualidade_aguardando;
create policy qualidade_aguardando_ler on qualidade_aguardando for select
  using (empresa_id = (select minha_empresa())
         and (base_id is null or base_id in (select bases_visiveis()))
         and (select tem_permissao('qualidade.ver')));

-- Escrita so pelas RPCs SECURITY DEFINER abaixo, que conferem a
-- permissao fina. Sem policy de insert/update/delete -- e sem o grant.
revoke all on qualidade_aguardando from anon;
revoke insert, update, delete, truncate on qualidade_aguardando from authenticated;
grant select on qualidade_aguardando to authenticated;

-- ------------------------------------------------------------------ --
--  Marcar / desmarcar
-- ------------------------------------------------------------------ --

create or replace function public.marcar_qualidade_aguardando(
  p_visita_id uuid, p_canal text, p_telefone text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_emp uuid; v_base uuid; v_desf text; v_id uuid;
begin
  if not tem_permissao('qualidade.registrar') then
    raise exception 'Sem permissao para registrar pesquisa de qualidade'
      using errcode = '42501';
  end if;
  if p_canal is null or p_canal not in ('LIGACAO','WHATSAPP') then
    raise exception 'Escolha o canal do contato (Ligacao ou WhatsApp)'
      using errcode = '22023';
  end if;

  -- SECURITY DEFINER ignora o RLS: o escopo se confere AQUI (security.md),
  -- o mesmo de registrar_qualidade.
  select v.empresa_id, v.base_id into v_emp, v_base
    from visita v
   where v.id = p_visita_id and v.excluido_em is null
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  if v_emp is null then
    raise exception 'Contrato nao encontrado ou fora do seu alcance'
      using errcode = 'P0002';
  end if;

  select q.desfecho into v_desf from pesquisa_qualidade q where q.visita_id = p_visita_id;
  if qualidade_contatado(v_desf) then
    raise exception 'Este contrato ja tem desfecho com o assinante; aguardando cliente nao se aplica'
      using errcode = '22023';
  end if;

  update qualidade_aguardando a
     set canal = p_canal,
         telefone = coalesce(nullif(btrim(p_telefone),''), a.telefone),
         usuario_id = auth.uid(),
         marcado_em = now()
   where a.visita_id = p_visita_id and a.encerrado_em is null
  returning a.id into v_id;

  if v_id is null then
    insert into qualidade_aguardando (visita_id, empresa_id, base_id, canal, telefone, usuario_id)
    values (p_visita_id, v_emp, v_base, p_canal, nullif(btrim(p_telefone),''), auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end;
$function$;

revoke all on function public.marcar_qualidade_aguardando(uuid, text, text) from public, anon;
grant execute on function public.marcar_qualidade_aguardando(uuid, text, text) to authenticated, service_role;

create or replace function public.desmarcar_qualidade_aguardando(p_visita_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int;
begin
  if not tem_permissao('qualidade.registrar') then
    raise exception 'Sem permissao para registrar pesquisa de qualidade'
      using errcode = '42501';
  end if;

  update qualidade_aguardando a
     set encerrado_em = now(), encerrado_por = auth.uid(), encerrado_como = 'DESMARCADO'
   where a.visita_id = p_visita_id and a.encerrado_em is null
     and a.empresa_id = (select minha_empresa())
     and a.base_id in (select bases_visiveis());
  get diagnostics n = row_count;
  -- falso = nao havia aguardando aberto (ou fora do alcance): a tela recarrega
  return n > 0;
end;
$function$;

revoke all on function public.desmarcar_qualidade_aguardando(uuid) from public, anon;
grant execute on function public.desmarcar_qualidade_aguardando(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ --
--  registrar_qualidade: o desfecho FECHA o aguardando
--  (create or replace preserva a ACL; corpo da versao viva + o fecho)
-- ------------------------------------------------------------------ --

CREATE OR REPLACE FUNCTION public.registrar_qualidade(p_visita_id uuid, p_desfecho text, p_canal text DEFAULT NULL::text, p_telefone text DEFAULT NULL::text, p_nota smallint DEFAULT NULL::smallint, p_tratou_bem boolean DEFAULT NULL::boolean, p_observacao text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp uuid; v_base uuid; v_id uuid;
begin
  if not tem_permissao('qualidade.registrar') then
    raise exception 'Sem permissao para registrar pesquisa de qualidade'
      using errcode = '42501';
  end if;

  -- SECURITY DEFINER ignora o RLS: o escopo se confere AQUI (security.md).
  select v.empresa_id, v.base_id into v_emp, v_base
    from visita v
   where v.id = p_visita_id and v.excluido_em is null
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis());
  if v_emp is null then
    raise exception 'Contrato nao encontrado ou fora do seu alcance'
      using errcode = 'P0002';
  end if;

  insert into pesquisa_qualidade as q
         (visita_id, empresa_id, base_id, desfecho, canal, telefone,
          nota_tecnico, tratou_bem, observacao, usuario_id, tentativas,
          registrado_em)
  values (p_visita_id, v_emp, v_base, p_desfecho, p_canal,
          -- 213: o telefone guardado ao marcar "aguardando" passa para a
          -- pesquisa, senao some quando o aguardando fecha logo abaixo
          coalesce(nullif(btrim(p_telefone),''),
                   (select a.telefone from qualidade_aguardando a
                     where a.visita_id = p_visita_id and a.telefone is not null
                     order by a.marcado_em desc limit 1)),
          p_nota, p_tratou_bem,
          nullif(btrim(p_observacao),''),
          auth.uid(), 1, now())
  on conflict (visita_id) do update
     set desfecho = excluded.desfecho,
         canal    = coalesce(excluded.canal, q.canal),
         -- telefone digitado nao se perde quando a ligacao nao completa
         telefone = coalesce(excluded.telefone, q.telefone),
         nota_tecnico = excluded.nota_tecnico,
         tratou_bem   = excluded.tratou_bem,
         observacao   = excluded.observacao,
         usuario_id   = auth.uid(),
         tentativas   = q.tentativas + 1,
         registrado_em = now(),
         atualizado_em = now()
  returning q.id into v_id;

  -- 213: registrou desfecho, saiu do "aguardando cliente". Fecha, nao
  -- apaga -- fica quem esperou, desde quando, e que terminou em desfecho.
  update qualidade_aguardando a
     set encerrado_em = now(), encerrado_por = auth.uid(), encerrado_como = 'DESFECHO'
   where a.visita_id = p_visita_id and a.encerrado_em is null;

  return v_id;
end;
$function$;

-- ------------------------------------------------------------------ --
--  qualidade_fila: + aguardando_em, aguardando_canal, aguardando_por
-- ------------------------------------------------------------------ --

drop function if exists public.qualidade_fila(date, date);

CREATE FUNCTION public.qualidade_fila(p_de date, p_ate date)
 RETURNS TABLE(visita_id uuid, contrato text, cliente_nome text, endereco text, bairro text, grupo text, situacao_contrato text, status_toa text, data_agendada date, operacao text, equipe text, area text, tecnico text, tecnico_id uuid, encerrou timestamp with time zone, janela text, baixa_codigo integer, baixa_descricao text, baixa_natureza text, contador_log integer, tem_improdutiva boolean, desfecho text, canal text, telefone text, nota_tecnico smallint, tratou_bem boolean, observacao text, tentativas smallint, registrado_em timestamp with time zone, analista text, aguardando_em timestamp with time zone, aguardando_canal text, aguardando_por text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  /*
   * 148: a fila traz tudo o que os cinco filtros precisam -- tipo de
   * servico, situacao, codigo de baixa, janela e LOG -- numa consulta
   * so. Filtrar no cliente e deliberado: sao ~300 linhas no dia, e cada
   * troca de filtro sem ida ao servidor deixa a tela instantanea para
   * quem passa o dia inteiro nela.
   *
   * A fila continua sendo "tudo onde o tecnico FOI" (D-228).
   *
   * 213: + o "aguardando cliente" ABERTO (no maximo um por contrato,
   * indice unico parcial), com quem marcou. O ultimo telefone guardado
   * ao marcar (aberto ou fechado) entra no coalesce, depois do da pesquisa.
   */
  select v.id, v.contrato, v.cliente_nome,
         concat_ws(', ', v.logradouro, v.complemento),
         v.bairro, coalesce(ts.nome, ta.nome),
         v.situacao,
         nullif(btrim(coalesce(v.dados_origem->>'Status da Atividade','')),''),
         v.data_agendada,
         b.nome,
         e.codigo, a.apelido,
         tc.nome, tc.id, v.fim,
         case when v.janela_inicio is null then null
              else to_char(v.janela_inicio,'HH24:MI') || ' - '
                   || coalesce(to_char(v.janela_fim,'HH24:MI'),'?') end,
         bx.codigo, bx.descricao, bx.natureza,
         nullif(btrim(coalesce(v.dados_origem->>'Contador de log','')),'')::int,
         exists (select 1 from ordem_servico o
                  join codigo_baixa cb on cb.id = o.codigo_baixa_id
                 where o.visita_id = v.id and cb.natureza = 'IMPRODUTIVA'),
         q.desfecho, q.canal, coalesce(q.telefone, agt.telefone, cc.telefone),
         q.nota_tecnico, q.tratou_bem, q.observacao,
         coalesce(q.tentativas, 0::smallint), q.registrado_em, p.nome,
         ag.marcado_em, ag.canal, pa.nome
    from visita v
    join tipo_atividade ta on ta.id = v.tipo_atividade_id
    left join tipo_servico ts on ts.id = v.tipo_servico_id
    left join base b on b.id = v.base_id
    left join equipe e on e.id = v.equipe_id
    left join area_trabalho a on a.id = v.area_id
    left join tecnico tc on tc.id = v.tecnico_responsavel_id
    left join pesquisa_qualidade q on q.visita_id = v.id
    left join perfil p on p.id = q.usuario_id
    left join qualidade_aguardando ag on ag.visita_id = v.id and ag.encerrado_em is null
    left join perfil pa on pa.id = ag.usuario_id
    -- a baixa da O.S. de menor sequencia que tenha uma: e a que a CLARO
    -- reconhece, a mesma escolha da reincidencia (033)
    left join lateral (
      select cb.codigo, cb.descricao, cb.natureza
        from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_id
       where o.visita_id = v.id order by o.sequencia limit 1
    ) bx on true
    -- o ultimo telefone digitado ao marcar aguardando, aberto ou fechado
    left join lateral (
      select x.telefone from qualidade_aguardando x
       where x.visita_id = v.id and x.telefone is not null
       order by x.marcado_em desc limit 1
    ) agt on true
    left join lateral (
      select cc.telefone from contato_cliente cc
       where cc.visita_id = v.id and cc.informou limit 1
    ) cc on true
   where v.data_agendada between p_de and p_ate
     and v.excluido_em is null
     and v.contrato is not null
     and ta.natureza = 'PRODUTIVA'
     and v.situacao in ('CONCLUIDA','CANCELADA','REAGENDAMENTO')
     and not (v.situacao = 'CANCELADA' and (
          (norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO' or v.cancelado_central_em is not null)
          or exists (select 1 from ordem_servico o
                      join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                     where o.visita_id = v.id and cb.codigo = 800)))
     and v.empresa_id = minha_empresa()
     and v.base_id in (select bases_visiveis())
     and (select tem_permissao('qualidade.ver'))
   order by (q.desfecho is null) desc, v.fim desc nulls last;
$function$;

revoke all on function public.qualidade_fila(date, date) from public, anon;
grant execute on function public.qualidade_fila(date, date) to authenticated, service_role;

notify pgrst, 'reload schema';
