# Banco — Supabase `AFLINE manager`

| | |
|---|---|
| Projeto | `kqfflkxjijzdtnfshdlv` |
| Região | `sa-east-1` (São Paulo — perto de Manaus, importa para o técnico no 4G) |
| Postgres | 17 |

**26 tabelas · 2 views · 35 funções · 50 policies · zero tabela sem RLS ·
zero função `SECURITY DEFINER` acessível ao `anon`.**

---

## ⚠ Leia antes de mexer: o banco é a fonte da verdade

**22 migrations estão aplicadas no Supabase.** A pasta `migrations/` tem
**15 delas**. As restantes (`007`, `009`, `016`, `017`, `019`, `021`,
`022`) foram aplicadas via MCP e não chegaram a virar arquivo local.

Isto é uma dívida conhecida, não um esquecimento silencioso.

### Como sincronizar (jeito certo)

```bash
npx supabase login
npx supabase link --project-ref kqfflkxjijzdtnfshdlv
npx supabase db pull        # traz o schema aplicado para migrations/
```

### Como ver o que está aplicado, sem CLI

```sql
select version, name, array_to_string(statements, E'\n') as sql
from supabase_migrations.schema_migrations
order by version;
```

Essa tabela guarda o SQL completo de cada migration. Nada se perdeu.

### Os arquivos locais são consolidados, não espelho

Onde uma função foi criada e depois substituída, o arquivo local traz a
versão que faz sentido ler, com uma NOTA apontando onde ela é alterada
depois. Rodar `001` → `022` em ordem reproduz o estado; ler os arquivos
conta a história.

---

## As 22 migrations aplicadas

| # | O que faz | Arquivo local |
|---|---|---|
| 001 | Domínios: áreas, tipos de atividade (com natureza), tipos de serviço, tipos de O.S. | ✓ |
| 002 | 166 códigos de baixa da CLARO + classificação própria | ✓ |
| 003 | Base, perfil, papéis, equipe, técnico, carteira, funções de permissão | ✓ |
| 004 | Importação, **visita → ordem_servico**, evidência, equipamento, reincidência, auditoria | ✓ |
| 005 | RLS em todas as tabelas + view do técnico | ✓ |
| 006 | Helpers de leitura do JSONB do TOA | ✓ |
| 007 | Importador do TOA | — |
| 008 | Correção da trava D-006 | ✓ |
| 009 | Importador reconstruído | — |
| 010 | `SECURITY DEFINER` checa papel por dentro; `search_path` fixo | ✓ |
| 011 | Revoga `anon` nominalmente; `unaccent` sai do `public` | ✓ |
| 012 | Pseudo-códigos `-1` e `-2` do NETSMS | ✓ |
| 013 | Tempo de atribuição real do TOA | ✓ |
| 014 | Grupo de serviço derivado do cruzamento TOA × ngestor | ✓ |
| 015 | Cadastro de equipes | ✓ |
| 016 | Multi-tenant: empresa, 18 praças | — |
| 017 | RLS por tenant | — |
| 018 | Carimbo automático de empresa | ✓ |
| 019 | Isolamento por praça | — |
| 020 | Recursos fora do cadastro + `vw_equipe_resumo` | ✓ |
| 021 | Login TOA da equipe, com histórico por período | — |
| 022 | Sub-falha, histórico completo e transferência | — |
| 023 | Conjunto de sub-falha vigente (`definir_conjunto_sub_falha`) + `resumo_sub_falhas` | ✓ |
| 024 | `painel_equipes(data)`: contratos, períodos, situações e OCIOSO por dia | ✓ |
| 025 | Cadastro de situação, indicadores de qualidade e marcador no contrato | ✓ |
| 026 | Reatendimento (O.S. em N visitas), dupla baixa TOA×AFLINE, exclusão com motivo | ✓ |
| 027 | **Pontuação por combinação de O.S.** × edificação + log de alteração | ✓ |
| 028 | **Administração**: cargos, perfis de acesso, permissões e a trava de escalada (D-050) | ✓ |
| 029 | **Bateria de teste de policy** (16 cenários) + permissão fina nas RPCs | ✓ |

---

## Conferências obrigatórias depois de qualquer mudança

```sql
-- 1. nenhuma tabela pode ficar sem RLS
select tablename from pg_tables t
join pg_class c on c.relname = t.tablename
join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname
where t.schemaname = 'public' and not c.relrowsecurity;
-- esperado: zero linhas

-- 2. nenhuma funcao SECURITY DEFINER acessivel ao anon
select p.proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE');
-- esperado: zero linhas
-- NAO confie no lint do Supabase para isto: ele demora a atualizar.

-- 3. toda policy operacional filtra por tenant
select tablename, policyname from pg_policies
where schemaname = 'public'
  and tablename in ('visita','equipe','tecnico','perfil','base','importacao')
  and coalesce(qual,'') not like '%minha_empresa%'
  and coalesce(with_check,'') not like '%minha_empresa%'
  and coalesce(qual,'') not like '%auth.uid()%';
-- esperado: zero linhas

-- 4. norm_txt sobrevive ao unaccent fora do public
select norm_txt('  Instalação  de  Assinatura ');
-- esperado: INSTALACAO DE ASSINATURA
```

---

## Armadilhas do Postgres/Supabase que já morderam

**`revoke ... from public` não remove concessão nominal.** O Supabase
concede `EXECUTE` explicitamente a `anon` em toda função criada no schema
`public`. Tem que ser `revoke ... from anon`.

**`CREATE OR REPLACE` preserva a ACL; função criada do zero, não.** Depois
de um `RENAME`, a nova função nasce aberta de novo. Sempre reconfira com
`has_function_privilege`.

**`SECURITY DEFINER` ignora o RLS.** Se a função faz algo privilegiado,
cheque o papel **dentro** dela — revogar do `anon` não impede um técnico
logado de chamar.

**`LIMIT` antes de `UNION ALL` é erro de sintaxe.** Precisa de parênteses
em cada ramo.

**Trigger de histórico dispara em `UPDATE` que você achou inofensivo.**
O `equipe_login_toa` duplicou quando espelhei o valor corrente. Índice
único resolveu.

---

## Dados carregados (06/09/2026)

1 empresa · 18 praças · 89 equipes · 104 técnicos · 470 visitas ·
564 O.S. · 168 códigos de baixa · 9 logins TOA mapeados · 2 dias de dado
(04 e 05/09/2026).
