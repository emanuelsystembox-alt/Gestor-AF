-- ┌─ 136 · a prova do contrato, a pontuação e o expurgo ───────────────┐
-- │ > "ele precisa enviar 3 evidências em cada contrato concluído para │
-- │ >  gerar pontuação para ele (...) vai gerar pontuação apenas para  │
-- │ >  a empresa, para o controlador COP, mas para o técnico individual│
-- │ >  no aplicativo não deve ser gerado (...) para os contratos       │
-- │ >  cancelados e reagendados, o sistema precisa sinalizar que o     │
-- │ >  contrato precisa de evidência (...) o admin poderá jogar todas  │
-- │ >  as WOs que o sistema deve expurgar (...) expurgar ou retornar a │
-- │ >  pontuação novamente" — Emanuel, 25/10                           │
-- │                                                                     │
-- │ DECISÕES DELE, nesta sessão (as outras opções foram oferecidas e   │
-- │ recusadas):                                                         │
-- │  · 3 ARQUIVOS (foto ou vídeo) por CONTRATO — não por O.S.;         │
-- │  · cancelado/reagendado: 1 evidência faz o sistema parar de cobrar │
-- │    (eles não pontuam de qualquer jeito);                            │
-- │  · PRAZO: a trava do campo deixava anexar só NO DIA (D-114). Quem  │
-- │    concluísse às 18h e esquecesse perderia o ponto para sempre.    │
-- │    Agora ANEXAR EVIDÊNCIA vai até o fim do dia seguinte; BAIXAR,   │
-- │    mudar status, equipamento e contato continuam travados no dia;  │
-- │  · foto da galeria enviada longe do cliente CONTA, e fica marcada; │
-- │  · vale JÁ, sem data de corte. Medido em 25/10: 1.296 concluídos   │
-- │    em 7 dias, NENHUM com 3 evidências — o ranking vai a zero até   │
-- │    o campo começar a anexar. Ele foi avisado disso e escolheu.     │
-- │                                                                     │
-- │ A conta da EMPRESA não muda: o serviço foi feito e é faturado. O   │
-- │ que muda é a conta do TÉCNICO — `producao_por_tecnico`, que é UMA  │
-- │ SÓ e alimenta painel, ranking e central (D-167).                   │
-- └─────────────────────────────────────────────────────────────────────┘

-- ── A · os parâmetros e o prazo da evidência ─────────────────────────
insert into parametro (empresa_id, chave, valor, descricao)
select e.id, x.chave, x.valor, x.descricao
  from empresa e
 cross join (values
   ('evidencia_minima_concluida', '3'::jsonb,
    'Quantas fotos/videos um contrato CONCLUIDO precisa ter para gerar pontuacao para o tecnico (136).'),
   ('evidencia_minima_improdutiva', '1'::jsonb,
    'Quantas fotos/videos um contrato cancelado ou reagendado precisa para o sistema parar de cobrar prova (136).'),
   ('evidencia_prazo_dias', '1'::jsonb,
    'Dias DEPOIS do dia do contrato em que o campo ainda pode ANEXAR evidencia (136). 0 = so no proprio dia.')
 ) as x(chave, valor, descricao)
 where not exists (select 1 from parametro p where p.empresa_id = e.id and p.chave = x.chave);

-- A quarta trava do campo ganha prazo — mas só para a evidência.
drop function if exists public.pode_anexar_na_visita(uuid);

create function public.pode_anexar_na_visita(p_visita uuid, p_evidencia boolean default false)
 returns date
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_data date; v_equipe uuid; v_prazo int;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR')
          or tem_papel('TECNICO')) then
    raise exception 'Sem permissao para anexar.' using errcode = '42501';
  end if;
  if not tem_permissao('servicos.anexar') then
    raise exception 'Seu perfil de acesso nao inclui "Anexar".'
      using errcode = '42501';
  end if;

  select data_agendada, equipe_id into v_data, v_equipe
    from visita
   where id = p_visita and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis())
     and excluido_em is null;
  if not found then
    raise exception 'Contrato nao encontrado.' using errcode = 'P0002';
  end if;

  if not eh_gestor() and (v_equipe is null
      or v_equipe not in (select equipes_visiveis())) then
    raise exception 'Este contrato nao e da sua equipe.' using errcode = '42501';
  end if;

  -- 136: só a EVIDÊNCIA ganhou prazo. Equipamento, miscelânea e contato
  -- continuam no dia — mexer neles depois mudaria o que foi declarado
  -- na hora do serviço.
  v_prazo := case when coalesce(p_evidencia, false)
                  then coalesce((select (valor #>> '{}')::int from parametro
                                  where empresa_id = minha_empresa()
                                    and chave = 'evidencia_prazo_dias'), 1)
                  else 0 end;

  if tem_papel('TECNICO') and not eh_gestor()
     and not (tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'))
     and (v_data > hoje_local() or v_data < hoje_local() - v_prazo) then
    if v_prazo > 0 then
      raise exception 'Contrato de % — o prazo para anexar evidencia era ate %. Fale com o controlador.',
        to_char(v_data, 'DD/MM'), to_char(v_data + v_prazo, 'DD/MM')
        using errcode = '42501';
    else
      raise exception 'Contrato de % — o campo so anexa no dia. Fale com o controlador.',
        to_char(v_data, 'DD/MM')
        using errcode = '42501';
    end if;
  end if;

  return v_data;
end;
$function$;

revoke all on function public.pode_anexar_na_visita(uuid, boolean) from public, anon;
grant execute on function public.pode_anexar_na_visita(uuid, boolean) to authenticated, service_role;

-- ── B · o expurgo do ADMIN, por lote de WOs ──────────────────────────
-- ESCOPO por lote (escolha do Emanuel): TECNICO tira só do painel e do
-- ranking dele; TODOS tira também da conta da empresa.
-- MOTIVO obrigatório — expurgo sem motivo é número que ninguém explica
-- seis meses depois (mesma regra da reversão de situação, D-030).
-- Nada se apaga: devolver a pontuação CARIMBA o desfazimento.
create table if not exists expurgo_pontuacao (
  id             bigint generated always as identity primary key,
  empresa_id     uuid not null references empresa(id),
  visita_id      uuid not null references visita(id) on delete cascade,
  digitado       text,
  escopo         text not null check (escopo in ('TECNICO', 'TODOS')),
  motivo         text not null check (btrim(motivo) <> ''),
  criado_por     uuid not null,
  criado_em      timestamptz not null default now(),
  desfeito_em    timestamptz,
  desfeito_por   uuid,
  desfeito_motivo text
);

comment on table expurgo_pontuacao is
  'Pontuacao tirada a mao pelo ADMIN (136). TECNICO = so a conta dele; TODOS = tambem a da empresa.';

create unique index if not exists expurgo_vigente_uk
  on expurgo_pontuacao (visita_id) where desfeito_em is null;
create index if not exists expurgo_empresa_ix on expurgo_pontuacao (empresa_id, criado_em desc);

alter table expurgo_pontuacao enable row level security;

drop policy if exists expurgo_leitura on expurgo_pontuacao;
create policy expurgo_leitura on expurgo_pontuacao
  for select to authenticated
  using (empresa_id = (select minha_empresa())
         and ((select eh_gestao())
              or visita_id in (select v.id from visita v
                                where v.tecnico_responsavel_id = (select meu_tecnico_id()))));
-- Sem policy de escrita: quem expurga é a RPC, e só o ADMIN.

-- `expurgos_vigentes`, `expurgar_pontuacao`, `devolver_pontuacao` e
-- `lista_expurgos`: ver o corpo aplicado (as quatro nasceram aqui).
-- A busca aceita a WO inteira (00121|232063780), só o número depois do
-- "|", o contrato ou o ID da atividade — e DIZ o que não encontrou.

-- ── C · a prova, e a pontuação do técnico ────────────────────────────
-- `prova_das_visitas(uuid[])` devolve por contrato: quantas evidências
-- tem, o mínimo da situação, quanto falta, o prazo, se ainda cobra
-- prova, se pontua para o técnico, e o expurgo com o motivo.
--
-- `producao_por_tecnico` (drop + create: colunas novas no `returns
-- table`) passa a somar em `pontos` só o concluído PROVADO e não
-- expurgado, e devolve à parte `pontos_sem_prova`/`sem_prova` e
-- `pontos_expurgados`/`expurgados` — o que está esperando foto é
-- MEDIDO, não perdido (regra 6).
--
-- `painel_do_tecnico` acompanha: o gráfico por dia soma o mesmo que o
-- total (D-150 — a mesma tela se contradizendo é o defeito mais caro) e
-- o JSON ganha `pontos_sem_prova`, `contratos_sem_prova` e
-- `evidencia_minima`, para o aplicativo dizer o que falta.
--
-- `painel_equipes` e `produtividade_periodo` ganharam, nos somatórios de
-- pontos, `and not exists (expurgo TODOS)` — aplicado por substituição
-- sobre o corpo VIVO (traps.md: o arquivo pode estar atrasado em relação
-- à função do banco), com a troca conferida antes de executar:
--
--   do $$ declare s text; novo text;
--   begin
--     select pg_get_functiondef(p.oid) into s from pg_proc p ...;
--     novo := replace(s, '<somatório antigo>', '<somatório + expurgo>');
--     if novo = s then raise exception 'nada substituido'; end if;
--     execute novo;
--   end $$;
--
-- Medido como `authenticated`: 52,9076 pts no dia → 51,4428 depois de
-- expurgar uma WO com escopo TODOS → 52,9076 de volta na devolução.

-- ── D · a bateria do campo acompanha a regra nova ────────────────────
-- `testar_campo` tinha o cenário "TECNICO anexa em contrato de ONTEM →
-- barrado". A regra mudou, então o cenário mudou — e virou três:
--   · anexa EVIDÊNCIA em contrato de ONTEM (no prazo) → permitido;
--   · lança EQUIPAMENTO em contrato de ONTEM (sem prazo) → barrado;
--   · anexa evidência de ANTEONTEM (fora do prazo) → barrado.
-- A bateria foi de 27 para 29 cenários. 29/29 e 26/26 verdes.

notify pgrst, 'reload schema';
