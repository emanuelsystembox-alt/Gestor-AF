# DESCOBERTA CRÍTICA — o AFLINE 360 já existe

Data: 2026-09-04

## O que encontrei

O Supabase `BANCO PRO - AFLINE 360` (`ndweddfgitchtxhwqufj`) **não está vazio**.
É uma plataforma madura, em produção:

| | |
|---|---|
| Migrations aplicadas | **350+** (de 13/07/2026 a 04/09/2026) |
| Tabelas | ~70 |
| Materialized views | 41 |
| Views | 54 |
| Funções / RPCs | 257 |
| Volume | ANALITICO_TABLE_CERTIFICADO 359k linhas · PRODUTIVIDADE1 343k · TEC1 292k · GESTOR_POR_OS 238k · SLA 213k |

### Já está construído

**Autenticação e usuários** — `profiles` (35), `user_roles` (35), `pre_aprovados`,
`SESSOES_ATIVAS`, `LOG_ACESSOS`, `senha_reset_codigo` (recuperação por WhatsApp),
sessão única por login, senha provisória, revogação de leitura anônima.

**Ingestão do TOA** — `ANALITICO_TABLE_TOA` (10.525 linhas) já mapeia **as 120
colunas** do arquivo `Atividades-MAN-AFLINE`, com derivados próprios
(`duracao_min`, `deslocamento_min`, `arquivo_origem`, `imported_at`, `imported_by`).
Grão = `id_atividade`. **Exatamente a modelagem que eu ia propor — já feita.**

**Ingestão do ngestor** — `CARGA_NGESTOR_LOG` (2.462), `CARGA_NGESTOR_FILA`,
fila serializada, cron `pg_cron`, guarda de refresh que só roda quando a fonte muda.

**Dicionários** — `DIM_CODIGO_BAIXA` com **166 códigos** extraídos do
*GUIA_CODIGO_BAIXAv4 2026* oficial da CLARO. `DIM_TIPO_ATIVIDADE_TOA` (34) com o
de/para tipo→natureza. `DIM_FP2_ESCOPO`, `DIM_INDICADOR`, `DIM_UN_OPERACAO`.

**Cadastro de equipes** — `LOGIN_AFLINE` (172): login, ÁREA, SUPERVISOR, EQUIPE,
NOME TÉCNICO, CIDADE. Mais `BASE_EQUIPES_AUTORIZADAS` e RPCs de manutenção.

**Indicadores** — SLA, Novo SLA, AT1, AT5, Produtividade, TNPS (instalação,
manutenção, não comparecimento), Certidão, Certificado, FCA, FP2, Gerencial,
Comparador, Mapa de calor geográfico, TOA Primeira WO.

**Infra de aplicativo** — `REUNIOES` + push, `APP_REPORTE`, `APP_AVISO_VISTO`,
`PUSH_SUBSCRIPTIONS`, `WHATSAPP_ENVIO_LOG`, `PAINEL_ACESSO` (acesso nominal).

## A conclusão que muda o projeto

> **O AFLINE 360 é a camada ANALÍTICA. O ngestor é a camada OPERACIONAL.
> São coisas diferentes, e você já venceu metade da briga.**

O 360 lê o passado: consome exports do TOA e do ngestor e calcula indicadores.
É read-only sobre fatos consumados.

O ngestor é onde a O.S. **vive**: despacho, técnico executando em campo, baixa
em tempo real, foto, material.

**Não existe nenhuma tabela operacional no 360.** Não há despacho, não há
execução, não há estado de O.S. mutável. É esse o buraco.

## Consequência para o plano

O projeto **não é construir do zero**. É **acoplar a camada operacional a uma
plataforma que já tem** auth, papéis, cadastro de equipes, ingestão do TOA,
dicionários oficiais da CLARO e 41 matviews de indicador.

O que muda:

| Eu ia fazer | Situação real |
|---|---|
| `codigo_baixa` com 24 códigos | `DIM_CODIGO_BAIXA` já tem **166**, do guia oficial |
| `tipo_atividade` + natureza | `DIM_TIPO_ATIVIDADE_TOA` já faz isso |
| Parser das 120 colunas do TOA | `ANALITICO_TABLE_TOA` já ingere tudo |
| `perfil` + `usuario_papel` | `profiles` + `user_roles` já existem |
| `equipe` + `tecnico` | `LOGIN_AFLINE` já tem 172 vínculos |
| Migrations 001-004 que escrevi | **NÃO APLICAR** — duplicariam tudo isso |

### O que realmente falta construir
1. Tabelas operacionais: `visita`, `ordem_servico`, execução, evidência.
2. Despacho: o Controlador distribuindo a agenda do dia.
3. Interface de campo do técnico (a que hoje é o app Android).
4. Ligação entre o operacional novo e as 41 matviews que já existem.
5. Ampliar `user_roles` — hoje só tem `admin` e `user`, insuficiente para
   TÉCNICO / CONTROLADOR / COP.

## ⚠ Achado de segurança (não corrigido — decisão do Emanuel)

Três tabelas estão com **RLS desabilitado**, expostas a qualquer um que tenha a
chave `anon`:

- `public.DIM_CHAVE_CARGA`
- `public.REPORTE_NOTIFICACOES`
- `public._BACKUP_LOGIN_AFLINE_20260825` — **183 linhas com nome de técnico,
  equipe, supervisor e área**

A última é a preocupante: é backup de 25/08, o próprio comentário diz
"Candidata a DROP", e contém dados de pessoas.

SQL de correção (**não apliquei** — habilitar RLS sem policy bloqueia todo acesso,
então precisa ser decidido tabela a tabela):

```sql
ALTER TABLE public.DIM_CHAVE_CARGA ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.REPORTE_NOTIFICACOES ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._BACKUP_LOGIN_AFLINE_20260825 ENABLE ROW LEVEL SECURITY;
```

Para a de backup, a decisão provavelmente não é RLS — é `DROP TABLE`.
