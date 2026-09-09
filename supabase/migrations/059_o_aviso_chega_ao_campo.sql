-- 059 · O aviso chega ao campo
--
-- > *"apenas status do contrato... o operador tem esse poder de mudar o
-- >  status e colocar obs para cada mudança, quando ele fizer isso o
-- >  técnico precisa ver essa mudança"* — Emanuel, 09/09
--
-- Hoje o técnico só descobre o que mudou se puxar a tela. O controlador
-- cancela um contrato às 9h e o técnico chega no endereço às 10h.
--
-- ┌─ POR QUE UMA TABELA, E NÃO SÓ REALTIME ──────────────────────────┐
-- │ Realtime é *fire-and-forget*: quem estava no elevador, no subsolo │
-- │ ou sem 4G **não recebe, e nunca vai saber**. No campo isso não é  │
-- │ exceção, é o dia.                                                 │
-- │                                                                    │
-- │ Então o que vale é a LINHA na tabela; o Realtime é só o           │
-- │ carregador. Quem ficou sem sinal lê o que perdeu quando voltar.   │
-- └────────────────────────────────────────────────────────────────────┘
--
-- ┌─ POR QUE O GATILHO É `visita_evento` ────────────────────────────┐
-- │ Toda mudança já passa por lá — e são cinco portas diferentes:     │
-- │                                                                    │
-- │   IMPORTADA/IMPORTACAO ..... 1.320   contrato novo                │
-- │   SITUACAO/IMPORTACAO ......   530   a operadora mexeu            │
-- │   TRANSFERENCIA/SISTEMA ....   465   trocou de equipe             │
-- │   SITUACAO/WEB|TELA ........     8   o controlador mexeu          │
-- │   REVERSAO/WEB .............     —   o controlador reabriu        │
-- │                                                                    │
-- │ Pendurar o aviso em cada RPC seria escrever a mesma regra cinco   │
-- │ vezes, e esquecer na sexta. Um gatilho no funil pega todas,        │
-- │ inclusive as que ainda não existem.                                │
-- └────────────────────────────────────────────────────────────────────┘
--
-- Ver D-119.

-- ============================================================
-- A · A tabela
-- ============================================================
create table if not exists aviso (
  id            bigserial primary key,
  empresa_id    uuid not null references empresa(id),

  -- O destinatário é a EQUIPE, não a pessoa: o Emanuel pediu que
  -- "apareça para a equipe também". Quem estiver nela vê.
  equipe_id     uuid not null references equipe(id),
  visita_id     uuid references visita(id) on delete cascade,
  evento_id     bigint references visita_evento(id) on delete cascade,

  tipo          text not null check (tipo in (
                  'NOVO', 'SITUACAO', 'REABERTO',
                  'CANCELADO_OPERADORA', 'CHEGOU', 'SAIU')),
  titulo        text not null,
  -- A "mensagem livre" que o Emanuel pediu: é a observação que o
  -- controlador escreve ao mudar o status. Não é chat — é o porquê
  -- da mudança, viajando junto com ela.
  detalhe       text,

  situacao_de   text,
  situacao_para text,

  -- Desnormalizados de propósito: o aviso tem de ser legível sozinho,
  -- sem uma segunda ida ao banco, e continuar legível depois que o
  -- contrato sair da agenda do técnico.
  contrato      text,
  servico       text,
  autor_login   text,

  criado_em     timestamptz not null default now()
);

create index if not exists aviso_equipe_ix on aviso (equipe_id, criado_em desc);
create index if not exists aviso_visita_ix on aviso (visita_id);

comment on table aviso is
  'O que o campo precisa saber sem pedir. Gerado por gatilho em visita_evento (059). A linha é a verdade; o Realtime é só o carregador — quem ficou sem sinal lê ao voltar.';

-- Lido é por PESSOA, não por aviso: uma equipe pode ter mais de um
-- técnico, e o que um leu o outro não leu.
create table if not exists aviso_leitura (
  aviso_id    bigint not null references aviso(id) on delete cascade,
  usuario_id  uuid   not null references perfil(id) on delete cascade,
  lido_em     timestamptz not null default now(),
  primary key (aviso_id, usuario_id)
);

alter table aviso         enable row level security;
alter table aviso_leitura enable row level security;

-- ============================================================
-- B · Quem vê o quê
-- ============================================================
-- Escopo já resolvido uma vez por consulta — D-118 vale para policy
-- nova também.
drop policy if exists aviso_leitura_pol on aviso;
create policy aviso_leitura_pol on aviso for select to authenticated
  using (empresa_id = (select minha_empresa())
         and ((select eh_gestor()) or equipe_id in (select equipes_visiveis())));

-- Ninguém escreve aviso pela API: quem escreve é o gatilho.
drop policy if exists aviso_marca_lido on aviso_leitura;
create policy aviso_marca_lido on aviso_leitura for all to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));

-- ============================================================
-- C · O gatilho
-- ============================================================
create or replace function aviso_do_evento()
returns trigger language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v visita%rowtype;
  v_equipe_nova uuid;
  v_servico text;
  v_tipo text;
  v_titulo text;
  v_de text; v_para text;
begin
  -- ┌─ REGRA ZERO: um aviso nunca pode derrubar quem o gerou ────────┐
  -- │ Se este gatilho estourar, ele leva junto a baixa do técnico ou  │
  -- │ a importação inteira. Aviso é conveniência; baixa é dinheiro.   │
  -- └──────────────────────────────────────────────────────────────────┘
  begin
    select * into v from visita where id = new.visita_id;
    if not found or v.excluido_em is not null then return new; end if;

    -- O que o próprio técnico fez no celular ele já viu acontecer.
    if new.origem = 'MOBILE' then return new; end if;

    select coalesce(ts.nome, ta.nome, 'Visita') into v_servico
      from visita vv
      left join tipo_servico   ts on ts.id = vv.tipo_servico_id
      left join tipo_atividade ta on ta.id = vv.tipo_atividade_id
     where vv.id = new.visita_id;

    v_de   := new.de->>'situacao';
    v_para := new.para->>'situacao';

    if new.tipo = 'IMPORTADA' then
      if v.equipe_id is null then return new; end if;
      v_tipo := 'NOVO'; v_titulo := 'Contrato novo na sua agenda';

    elsif new.tipo = 'REVERSAO' then
      v_tipo := 'REABERTO';
      v_titulo := 'O controlador reabriu este contrato';

    elsif new.tipo = 'TRANSFERENCIA' then
      -- `transferir_visita` grava a equipe ANTIGA no evento e só DEPOIS
      -- altera a visita. Por isso a equipe nova sai do `para` (que
      -- guarda o código, não o id) e não de `visita.equipe_id`, que
      -- neste instante ainda é a antiga.
      select id into v_equipe_nova from equipe
       where codigo = new.para->>'equipe' and empresa_id = v.empresa_id;

      if new.equipe_id is not null then
        insert into aviso (empresa_id, equipe_id, visita_id, evento_id, tipo,
                           titulo, detalhe, contrato, servico, autor_login)
        values (v.empresa_id, new.equipe_id, v.id, new.id, 'SAIU',
                'Contrato saiu da sua agenda', new.observacao,
                v.contrato, v_servico, new.login);
      end if;
      if v_equipe_nova is not null then
        insert into aviso (empresa_id, equipe_id, visita_id, evento_id, tipo,
                           titulo, detalhe, contrato, servico, autor_login)
        values (v.empresa_id, v_equipe_nova, v.id, new.id, 'CHEGOU',
                'Contrato transferido para a sua equipe', new.observacao,
                v.contrato, v_servico, new.login);
      end if;
      return new;

    elsif new.tipo = 'SITUACAO' then
      if v_para is null or v_de is not distinct from v_para then
        return new;
      end if;
      -- Cancelamento vindo da importação é a operadora, não nós — e é o
      -- aviso mais urgente que existe: o técnico pode estar a caminho.
      if v_para = 'CANCELADA' and new.origem = 'IMPORTACAO' then
        v_tipo := 'CANCELADO_OPERADORA';
        v_titulo := 'A operadora cancelou — não vá';
      else
        v_tipo := 'SITUACAO';
        v_titulo := 'O status mudou';
      end if;

    else
      return new;   -- BAIXA, EVIDENCIA, EQUIPAMENTO: não viram aviso
    end if;

    if v.equipe_id is null then return new; end if;

    insert into aviso (empresa_id, equipe_id, visita_id, evento_id, tipo,
                       titulo, detalhe, situacao_de, situacao_para,
                       contrato, servico, autor_login)
    values (v.empresa_id, v.equipe_id, v.id, new.id, v_tipo,
            v_titulo, new.observacao, v_de, v_para,
            v.contrato, v_servico, new.login);

  exception when others then
    -- Engolido de propósito, e o motivo fica no log do Postgres.
    raise warning 'aviso_do_evento falhou no evento %: %', new.id, sqlerrm;
  end;

  return new;
end;
$fn$;

-- Função de gatilho também precisa de revoke: o Supabase concede
-- EXECUTE nominal a `anon` em TODA função nova do schema public, e
-- DEFINER alcançável pelo anon é o defeito que este projeto não aceita.
-- (Faltou aqui e foi corrigido na 061 — a conferência do CLAUDE.md
-- pegou.)
revoke all on function aviso_do_evento() from public, anon, authenticated;

drop trigger if exists trg_aviso_do_evento on visita_evento;
create trigger trg_aviso_do_evento after insert on visita_evento
  for each row execute function aviso_do_evento();

-- ============================================================
-- D · O que o aplicativo chama
-- ============================================================
create or replace function meus_avisos(p_limite int default 50)
returns table (
  id bigint, visita_id uuid, tipo text, titulo text, detalhe text,
  situacao_de text, situacao_para text, contrato text, servico text,
  autor_login text, criado_em timestamptz, lido boolean
)
language sql stable security definer set search_path to 'public' as $fn$
  with escopo as materialized (
    select minha_empresa() as empresa, eh_gestor() as gestor, auth.uid() as eu
  ),
  equipes_ok as materialized (select e from equipes_visiveis() e)
  select a.id, a.visita_id, a.tipo, a.titulo, a.detalhe,
         a.situacao_de, a.situacao_para, a.contrato, a.servico,
         a.autor_login, a.criado_em,
         (l.aviso_id is not null) as lido
    from aviso a
    cross join escopo s
    left join aviso_leitura l on l.aviso_id = a.id and l.usuario_id = s.eu
   where a.empresa_id = s.empresa
     and (s.gestor or a.equipe_id in (select e from equipes_ok))
   order by a.criado_em desc
   limit greatest(1, least(coalesce(p_limite, 50), 200));
$fn$;

revoke all on function meus_avisos(int) from public, anon;
grant execute on function meus_avisos(int) to authenticated;

create or replace function marcar_avisos_lidos(p_ids bigint[])
returns int language plpgsql security definer set search_path to 'public'
as $fn$
declare n int;
begin
  insert into aviso_leitura (aviso_id, usuario_id)
  select a.id, auth.uid() from aviso a
   where a.id = any (coalesce(p_ids, '{}'))
     and a.empresa_id = minha_empresa()
     and (eh_gestor() or a.equipe_id in (select equipes_visiveis()))
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function marcar_avisos_lidos(bigint[]) from public, anon;
grant execute on function marcar_avisos_lidos(bigint[]) to authenticated;

-- ============================================================
-- E · O carregador
-- ============================================================
-- Só `aviso` entra no Realtime, e de propósito:
--
--  · a linha é MAGRA — não trafega nome, telefone nem endereço de
--    assinante pela rede (LGPD). O aparelho recebe o aviso e vai
--    buscar o contrato se precisar;
--  · o aplicativo assina filtrando por `equipe_id`, então com 300
--    técnicos cada evento vai para os ~3 da equipe, não para os 300.
--
-- Publicar `visita` aqui seria o contrário das duas coisas.
do $$ begin
  alter publication supabase_realtime add table aviso;
exception when duplicate_object then null; end $$;

alter table aviso replica identity full;

notify pgrst, 'reload schema';
