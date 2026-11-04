-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 202 — Marcadores CLIENTE ATIVADO e FP2 (D-297)                        │
-- │                                                                      │
-- │ "Adicione os dois marcadores também, Cliente ativado vai ser um azul │
-- │  claro, e fp2 um laranja claro ok quando for inserido, técnico deve  │
-- │  visualizar também igual o rev - 10 dias" — Emanuel, 04/11.          │
-- │                                                                      │
-- │ Manuais, como o OUVIDORIA (200): o COP marca no contrato pelo site.  │
-- │ A cor mora na tela (web: TabelaContratos; app: MarcasCliente), não   │
-- │ aqui — `indicador_qualidade` não tem coluna de cor, e os outros      │
-- │ marcadores também não. O técnico vê o selo na Agenda e no contrato,  │
-- │ como o REV D-10: não há aviso no sino para marcador (nenhum dos      │
-- │ existentes tem). Mesmos valores dos demais (meta 100, peso 1), no    │
-- │ fim da lista. Sem DDL: o PostgREST não precisa recarregar.           │
-- └──────────────────────────────────────────────────────────────────────┘

insert into public.indicador_qualidade (empresa_id, nome, meta, peso, ordem, ativo)
select e.id, x.nome, 100, 1,
       coalesce((select max(ordem) from public.indicador_qualidade where empresa_id = e.id), 0) + x.n, true
  from public.empresa e
 cross join (values ('CLIENTE ATIVADO', 1), ('FP2', 2)) as x(nome, n)
 where not exists (select 1 from public.indicador_qualidade iq where iq.empresa_id = e.id and iq.nome = x.nome);

select nome, ordem from public.indicador_qualidade order by ordem;
