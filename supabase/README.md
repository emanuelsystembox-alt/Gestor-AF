# Migrations — Supabase dedicado

Rodar **nesta ordem**, no SQL Editor do projeto dedicado.
Cada arquivo é independente; cole um, rode, confira, passe para o próximo.

| # | Arquivo | O que cria |
|---|---|---|
| 1 | `001_dominios.sql` | Áreas, tipos de atividade (com natureza PRODUTIVA/JORNADA), tipos de serviço, 28 tipos de O.S., segmentação, capacidade |
| 2 | `002_codigo_baixa.sql` | Catálogo com **166 códigos** oficiais da CLARO + classificação própria |
| 3 | `003_pessoas.sql` | Base, perfil, papéis, escopos, equipe, técnico, carteira + funções de permissão |
| 4 | `004_nucleo_os.sql` | Importação, **visita → ordem de serviço**, evidências, equipamentos, reincidência, auditoria |
| 5 | `005_rls.sql` | Row Level Security em **todas** as tabelas + view do técnico |

## Conferência depois de rodar tudo

```sql
-- 1. Nenhuma tabela pode ficar sem RLS
select tablename from pg_tables t
join pg_class c on c.relname = t.tablename
where t.schemaname = 'public' and not c.relrowsecurity;
-- esperado: zero linhas

-- 2. Catálogo de baixa
select natureza, count(*) from codigo_baixa group by natureza order by 2 desc;
-- esperado: SUCESSO 104, IMPRODUTIVA 51, CANCELAMENTO 10, REAGENDAMENTO 1

-- 3. Os 6 códigos que precisam da sua validação
select codigo, descricao, natureza, responsabilidade from codigo_baixa where revisar;
```

## Decisões que estão embutidas no schema

- **D-001** — `visita` 1→N `ordem_servico`. Uma ida ao endereço, várias O.S.
  Deslocamento conta uma vez; baixa conta por O.S.
- **D-002** — login individual: `tecnico.usuario_id` é único.
- **D-004/D-006** — `visita.bloqueado_em`. Assim que o campo age, a importação
  do TOA só pode mexer nos campos de `campos_cadastrais()`. Status, baixa, foto,
  material e observação viram território exclusivo do técnico.
- **D-005** — `visita.equipe_id` + `visita.tecnico_responsavel_id`.
- **D-007** — RLS em `visita` mais a view `visita_campo`, que simplesmente não
  expõe as colunas proibidas ao técnico.

## O que ainda não está aqui

- Função de importação da planilha do TOA (o parser das 120 colunas)
- Frota e abastecimento (Fase 2)
- Almoxarifado e consumo por O.S. (Fase 2, funcionalidade nova — D-009)
- Ampliação de `tipo_os`: hoje tem os 28 que apareceram na planilha de 04/09.
  Vão aparecer outros; a tabela cresce sem migration.
