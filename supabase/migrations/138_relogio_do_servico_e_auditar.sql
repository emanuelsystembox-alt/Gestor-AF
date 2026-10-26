-- ┌─ 138 · o relógio do serviço, e o status AUDITAR ───────────────────┐
-- │ > "a gente pode colocar um relógio de tempo (...) já tenho algumas │
-- │ >  métricas que é aceitável: ADESÃO 90, VISITA TÉCNICA 50, MUDANÇA │
-- │ >  DE ENDEREÇO 100, MIGRAÇÃO 90, PACOTE 30 (...) isso deve ter no  │
-- │ >  botão configurações uma tela dela para configurar os horários"  │
-- │ >  — Emanuel, 25/10                                                │
-- │                                                                     │
-- │ É o tempo da EXECUÇÃO (chegou → encerrou), escolha dele entre as   │
-- │ três opções oferecidas. O DESLOCAMENTO também ganhou relógio, mas  │
-- │ **sem meta**: distância na cidade varia demais para um número só,  │
-- │ e ninguém definiu um.                                              │
-- │                                                                     │
-- │ Cadastro, não constante: mora em `tipo_servico`, editável em       │
-- │ Configurações › Tipo de serviço. Grupo sem meta NÃO vira zero nem  │
-- │ vermelho — o relógio fica cinza e diz "sem meta" (regra 6).        │
-- │                                                                     │
-- │ PACOTE (30 min) ficou de fora: não existe grupo com esse nome. Os  │
-- │ 8 de hoje são ADESAO, VISITA TECNICA, SERVICO, MIGRACAO GPON,      │
-- │ RETORNO DE CREDENCIADA, MUDANCA DE ENDERECO, REINSTALACAO e        │
-- │ DESCONEXAO. Entra quando o Emanuel mexer nos tipos.                │
-- └─────────────────────────────────────────────────────────────────────┘

alter table tipo_servico
  add column if not exists meta_execucao_min integer
    check (meta_execucao_min is null or meta_execucao_min between 1 and 1440);

comment on column tipo_servico.meta_execucao_min is
  'Minutos aceitaveis de EXECUCAO (chegou ate encerrar) para este grupo de servico (138). Nulo = sem meta: a tela diz que nao sabe.';

update tipo_servico set meta_execucao_min = x.m
  from (values ('ADESAO', 90), ('VISITA TECNICA', 50),
               ('MUDANCA DE ENDERECO', 100), ('MIGRACAO GPON', 90)) as x(n, m)
 where upper(btrim(tipo_servico.nome)) = x.n
   and tipo_servico.meta_execucao_min is distinct from x.m;

-- A tela precisa de RPC, não de UPDATE: os 8 grupos são GLOBAIS
-- (`empresa_id is null`) e a policy `tipo_servico_admin` só deixa o
-- ADMIN mexer no que é da empresa dele. Sem isto, Configurações salvaria
-- zero linhas em silêncio.
create or replace function public.definir_meta_execucao(p_tipo_servico uuid, p_min integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int;
begin
  if not tem_papel('ADMIN') then
    raise exception 'So o ADMIN muda o tempo de execucao.' using errcode = '42501';
  end if;
  if p_min is not null and (p_min < 1 or p_min > 1440) then
    raise exception 'O tempo tem de ficar entre 1 e 1440 minutos.' using errcode = '23514';
  end if;

  update tipo_servico
     set meta_execucao_min = p_min
   where id = p_tipo_servico
     and (empresa_id is null or empresa_id = minha_empresa());
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Grupo de servico nao encontrado.' using errcode = 'P0002';
  end if;
  return n;
end;
$function$;

revoke all on function public.definir_meta_execucao(uuid, integer) from public, anon;
grant execute on function public.definir_meta_execucao(uuid, integer) to authenticated, service_role;

-- AUDITAR, DESATRIBUÍDO e ENTREGAS são só TELA — nada aqui no banco:
--  · "Desatribuído" vira **Auditar** nas etiquetas (o código de baixa
--    800 continua com o nome dele no cadastro, por decisão do Emanuel:
--    é ele que explica o que aconteceu);
--  · a aba "Romaneios" vira **Entregas** (o documento continua
--    `romaneio` no banco — é o termo do almoxarifado);
--  · o selo de Serviços no menu passa a ser AZUL, a cor de "em aberto".

notify pgrst, 'reload schema';
