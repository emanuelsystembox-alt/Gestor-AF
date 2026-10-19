-- ┌─ 108 · o código de baixa se cadastra e se corrige pela tela ───────┐
-- │ > "preciso que me deixe editar ou adicionar algum codigo no menu   │
-- │ >  dos codigos ok?" — Emanuel, 19/10                               │
-- │                                                                    │
-- │ Até aqui a tela só trocava o DESTINO (`definir_situacao_do_codigo`)│
-- │ — código novo do TOA (o 425, D-184) dependia de migration, e o     │
-- │ contrato ficava preso em EM_EXECUCAO, calado, até alguém notar.    │
-- │                                                                    │
-- │  · salvar_codigo_baixa: adiciona ou edita descrição, família,      │
-- │    natureza e destino. Mesma porta da edição de hoje: gestão +     │
-- │    permissão "configuracoes.editar". Quem salva fica carimbado     │
-- │    (situacao_por/em) e o código deixa de estar "a revisar".        │
-- │  · codigos_sem_cadastro: o que o TOA mandou e o cadastro não       │
-- │    conhece, com quantos contratos e quantos estão presos — o       │
-- │    aviso que faltava, na mesma tela onde se corrige.               │
-- │                                                                    │
-- │ Vale daqui para frente, como o grupo de serviço (D-143): contrato  │
-- │ já importado fecha quando a planilha do dia for importada de novo. │
-- │ Ver D-185.                                                         │
-- └────────────────────────────────────────────────────────────────────┘

-- ARN-AFLINE é de Araguaína (Emanuel, 19/10). Ficou fora da semente da
-- 103 porque as linhas dele diziam ARAGUAINA e ARACAJU (D-180).
insert into toa_bucket (empresa_id, base_id, nome, origem, criado_por)
select b.empresa_id, b.id, 'ARN-AFLINE', 'CADASTRO',
       (select p.id from perfil p where p.email = 'admin@afline.com.br')
  from base b where b.codigo = 'AUX'
on conflict (empresa_id, nome) do nothing;

create or replace function public.salvar_codigo_baixa(
  p_codigo integer, p_descricao text, p_familia text, p_natureza text,
  p_situacao text, p_novo boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_desc text := nullif(btrim(coalesce(p_descricao, '')), '');
  v_fam  text := nullif(upper(btrim(coalesce(p_familia, ''))), '');
  v_nat  text := upper(btrim(coalesce(p_natureza, '')));
  v_sit  text := nullif(btrim(coalesce(p_situacao, '')), '');
  v      record;
begin
  -- A mesma porta de definir_situacao_do_codigo.
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  if not tem_permissao('configuracoes.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar" em configuracoes.'
      using errcode = '42501';
  end if;

  if p_codigo is null or p_codigo <= 0 or p_codigo > 99999 then
    raise exception 'Codigo invalido: use o numero que o TOA mostra (ex.: 425).';
  end if;
  if v_desc is null then
    raise exception 'Escreva a descricao do codigo, como o TOA mostra.';
  end if;
  if v_fam is null then
    raise exception 'Escolha a familia do codigo.';
  end if;
  if v_nat not in ('SUCESSO', 'IMPRODUTIVA', 'CANCELAMENTO', 'REAGENDAMENTO', 'INDEFINIDA') then
    raise exception 'Natureza invalida.';
  end if;
  if v_sit is not null and not exists (select 1 from situacao_visita where codigo = v_sit) then
    raise exception 'Situacao "%" nao existe.', v_sit using errcode = '23514';
  end if;

  select * into v from codigo_baixa
   where codigo = p_codigo and (empresa_id is null or empresa_id = minha_empresa());

  if p_novo then
    if found then
      raise exception 'O codigo % ja existe (%). Edite na lista.', p_codigo, v.descricao;
    end if;
    insert into codigo_baixa (codigo, descricao, familia, natureza, responsabilidade,
                              revisar, ativo, empresa_id,
                              situacao_destino, situacao_origem, situacao_por, situacao_em)
    values (p_codigo, v_desc, v_fam, v_nat, null,
            false, true, null,
            v_sit, case when v_sit is null then null else 'CADASTRO' end, auth.uid(), now());
  else
    if not found then
      raise exception 'Codigo de baixa % nao encontrado.', p_codigo using errcode = 'P0002';
    end if;
    update codigo_baixa
       set descricao        = v_desc,
           familia          = v_fam,
           natureza         = v_nat,
           -- CHECK da tabela: SUCESSO nao tem responsavel.
           responsabilidade = case when v_nat = 'SUCESSO' then null else responsabilidade end,
           situacao_destino = v_sit,
           situacao_origem  = case when v_sit is null then null
                                   when v_sit is distinct from v.situacao_destino then 'CADASTRO'
                                   else coalesce(situacao_origem, 'CADASTRO') end,
           situacao_por     = auth.uid(),
           situacao_em      = now(),
           -- quem salvou olhou: deixa de estar "a revisar".
           revisar          = false
     where id = v.id;
  end if;

  return jsonb_build_object('codigo', p_codigo, 'descricao', v_desc, 'familia', v_fam,
                            'natureza', v_nat, 'situacao', v_sit, 'novo', p_novo);
end;
$function$;

-- O que o TOA mandou e o cadastro não conhece. Lê `visita.dados_origem`
-- (a linha do TOA guardada no contrato) das cidades visíveis, nos últimos
-- p_dias — ou só os contratos de uma importação, para o resultado dela.
create or replace function public.codigos_sem_cadastro(
  p_dias integer default 30, p_importacao uuid default null)
 returns table(codigo integer, texto text, contratos bigint, presos bigint, ultimo_dia date)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with alvo as materialized (
    select v.id, v.situacao, v.data_agendada, v.dados_origem
      from visita v
     where v.base_id in (select bases_visiveis())
       and v.excluido_em is null
       and (case when p_importacao is null
                 then v.data_agendada >= hoje_local() - greatest(coalesce(p_dias, 30), 1)
                 else v.id in (select l.visita_id from importacao_linha l
                                where l.importacao_id = p_importacao and l.visita_id is not null)
            end)
  ),
  cods as (
    select a.id, a.situacao, a.data_agendada,
           extrai_codigo(a.dados_origem ->> ('Cód de Baixa ' || k)) as codigo,
           btrim(a.dados_origem ->> ('Cód de Baixa ' || k))        as texto
      from alvo a cross join generate_series(1, 10) k
     where nullif(btrim(coalesce(a.dados_origem ->> ('Cód de Baixa ' || k), '')), '') is not null
  )
  select c.codigo, max(c.texto), count(distinct c.id),
         count(distinct c.id) filter (where c.situacao <> all (situacoes_terminais())),
         max(c.data_agendada)
    from cods c
   where c.codigo is not null
     and not exists (select 1 from codigo_baixa b where b.codigo = c.codigo)
   group by c.codigo
   order by 4 desc, 3 desc;
$function$;

revoke all on function public.salvar_codigo_baixa(integer, text, text, text, text, boolean) from public, anon;
revoke all on function public.codigos_sem_cadastro(integer, uuid) from public, anon;
grant execute on function public.salvar_codigo_baixa(integer, text, text, text, text, boolean) to authenticated;
grant execute on function public.codigos_sem_cadastro(integer, uuid) to authenticated;
