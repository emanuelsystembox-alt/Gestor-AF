-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 200 — Marcador OUVIDORIA                                              │
-- │                                                                      │
-- │ "ouvidoria, sobe o marcador também no app do técnico" — perguntado,  │
-- │ "Criar marcador OUVIDORIA"; "ouvidoria sobe na cor preta" (Emanuel,  │
-- │ 03/11).                                                              │
-- │                                                                      │
-- │ Marcador manual, como os outros: o COP marca no contrato pelo site.  │
-- │ Aparece em preto na lista do site e no app (o mesmo selo "● OUVIDORIA"│
-- │ do caso crítico que vem do TOA, `visita.ouvidoria`, que continua).   │
-- │ Os mesmos valores dos marcadores existentes (meta 100, peso 1), no   │
-- │ fim da lista.                                                        │
-- └──────────────────────────────────────────────────────────────────────┘

insert into public.indicador_qualidade (empresa_id, nome, meta, peso, ordem, ativo)
select e.id, 'OUVIDORIA', 100, 1,
       coalesce((select max(ordem) from public.indicador_qualidade where empresa_id = e.id), 0) + 1, true
  from public.empresa e
 where not exists (select 1 from public.indicador_qualidade iq where iq.empresa_id = e.id and iq.nome = 'OUVIDORIA');

select nome, ordem from public.indicador_qualidade order by ordem;
