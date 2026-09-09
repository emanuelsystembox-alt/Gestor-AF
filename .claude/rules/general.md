# Convenções gerais

Vale para o repositório inteiro. Coisa que vale só para uma parte tem
arquivo próprio nesta pasta, com `paths:` no frontmatter.

## Idioma

**Português do Brasil** em tudo: código, comentários, documentação,
mensagem de commit, nome de migration. O repositório é assim por
decisão — quem lê é a equipe da AFLINE.

Identificadores de banco sem acento (`situacao`, `codigo_baixa`), como
já são hoje.

## Nomes

- Tabelas e colunas em `snake_case`, singular: `visita`, `ordem_servico`.
- Funções do banco em português, verbo no infinitivo: `baixar_os`,
  `registrar_etapa`, `pode_anexar_na_visita`.
- Componentes React em `PascalCase`; arquivos de `lib/` em minúscula.
- Migrations: `NNN_frase_curta_do_que_faz.sql`, número em ordem.

## Comentário de código

Comente **o porquê**, não o quê. O padrão do repositório é explicar a
decisão e o defeito que ela evita — inclusive citando o número da
decisão (`Ver D-118`) ou da migration (`055-G`).

Caixa de comentário (`┌─ … ─┐`) para o raciocínio que uma pessoa nova
precisaria reconstruir sozinha. Não é enfeite: é onde mora o motivo.

## Commit

Título curto no imperativo, sem prefixo de tipo. O corpo explica o
**porquê**, o que foi **medido** e o que **não** foi verificado.

```
O escopo do RLS resolve uma vez, nao uma vez por linha

Medido como `authenticated` (nunca como dono — D-081): 121 ms.
[…]
VERIFICADO ATE ONDE DEU: […]
```

Sem acento no corpo do commit (o terminal do Windows embaralha).
Acento normal em tudo o mais.

## Migration

- Cabeçalho explicando **o que resolve e por quê**, com a frase do
  Emanuel quando houver.
- Toda função nova: `revoke ... from public, anon` + `grant` explícito.
  Inclusive função de gatilho.
- Terminar com `notify pgrst, 'reload schema';` quando houver DDL.
- Arquivo em `supabase/migrations/`, aplicado pelo MCP ou SQL Editor.

## Nunca

- `&&` em comando na documentação (PowerShell 5.1).
- `toISOString()` / `current_date` para pegar "hoje".
- Planilha de cliente (`*.xlsx`, `*.csv`) no Git.
- `service_role` fora da máquina do Emanuel.
