# Gestor AF

A **AFLINE** é prestadora da **CLARO**: recebe ordens de serviço pelo
**TOA (Oracle Field Service)**, manda técnico a campo, executa e dá
baixa. Este projeto é a camada operacional própria — importar,
despachar, executar, medir e cobrar — substituindo o **Alfa Gestor /
ngestor**, que é caro e cujo roadmap não controlamos.

**Assumindo o projeto agora? Leia `HANDOFF.md` primeiro.**

# Regras de ouro

1. **Não invente regra de negócio.** Se não souber, **pergunte ao
   Emanuel**. Prefira a pergunta ao palpite bem-intencionado.
2. **Derive do dado real.** O de/para de grupo de serviço saiu do
   cruzamento de dois exports pela WO. Faça o mesmo, e diga de onde veio.
3. **Planilha de cliente não entra no Git.** Nome, telefone e endereço
   de assinante são LGPD.
4. **Permissão vive no banco.** RLS no Postgres, não na tela.
5. **Documente a decisão E o porquê** em `docs/03-DECISOES.md`.
6. **Zero e desconhecido não são a mesma coisa.** Quando o sistema não
   sabe, ele diz que não sabe.

# Stack

```
app/     web do controle    Vite 5 · React 18 · TypeScript 5.6 · Tailwind 4
campo/   app do técnico     Expo SDK 57 · React Native 0.86 · React 19 · TS 6
banco    Supabase           Postgres + PostgREST + Storage + Realtime  (plano Free)
deploy   web → Cloudflare Pages (manual) · app → Expo Go / EAS Build
Node 24 · npm · Windows PowerShell 5.1 (sem `&&`)
```

> **Verificar à mão:** a web está em React 18 / Vite 5 enquanto o
> aplicativo já usa React 19. Existem majors mais novos dos dois; a
> checagem de versão não pôde ser feita na sessão de setup.

# Comandos

```powershell
# Web — instalar e rodar
cd app
npm install
cp .env.example .env
npm run dev

# Aplicativo — abre no celular pelo Expo Go, sem build
cd campo
npm install
cp .env.example .env
npx expo start

# Conferir (nos dois projetos, antes de commitar)
npx tsc --noEmit
npm run build                                    # só na web
npx expo export --platform android --output-dir ../.tmp-export   # só no app

# Publicar a web
cd app
npm run build
npx wrangler pages deploy dist --project-name=gestor-af --branch=main --commit-dirty=true
```

**Uma linha por comando** — o PowerShell 5.1 não tem `&&`.

Depois de qualquer mudança em RLS, papel ou permissão:

```sql
select * from testar_policies();   -- 16 cenários, todos têm que passar
select * from testar_campo();      -- 14 cenários das travas do campo
```

# Estrutura

```
app/                  web do controle (13 telas)
  src/lib/            toa.ts (leitor da planilha) · metricas · relatorio
                      supabase · auth · tempoReal · formato
  src/components/     Shell, gráficos (SVG à mão), TabelaContratos, ui
  src/pages/          Controle · Servicos · Equipes · Rota · Produtividade
                      Relatorios · Importacao · Administracao · Visita…
  scripts/            criar-usuarios-teste.mjs (exige service_role)
campo/                APLICATIVO do técnico (Expo) — projeto Node separado
  src/lib/            gps · midia · avisos · dominio · formato · auth
  src/telas/          Entrar · Agenda · Visita · Captura
docs/                 mapeamento, domínio, 157 decisões, mapa do concorrente
supabase/migrations/  schema, em ordem (61)
agent_docs/           o contexto profundo — ver abaixo
```

# Regras de trabalho

- Rode `tsc --noEmit` e o build **antes** de considerar a tarefa pronta.
- Mexeu em RLS/papel/permissão → as duas baterias, verdes, sem exceção.
- Mexeu em DDL → `notify pgrst, 'reload schema';`
- Mexeu no que a tela faz → **republique a web no mesmo dia** da
  migration. Commit não publica nada.
- Meça e teste como `authenticated`, nunca como owner — owner tem
  `BYPASSRLS` e mente.
- Não mande `usuario_id` do cliente: quem carimba autor é o servidor.
- Diga o que **não** foi verificado. "Compila" não é "funciona".

# Contexto profundo (leia quando for relevante)

Estes arquivos não são carregados inteiros toda sessão — leia o que a
tarefa pedir.

- Regras de negócio e domínio: @agent_docs/business-rules.md
- Armadilhas que já morderam: @agent_docs/traps.md
- Segurança, RLS e chaves: @agent_docs/security.md
- Padrões de engenharia: @agent_docs/engineering-standards.md
- Arquitetura e decisões estruturais: @agent_docs/architecture.md
- Ferramentas e publicação: @agent_docs/productivity.md
- Convenções por caminho: `.claude/rules/`

# Índice da documentação

| Arquivo | Para quê |
|---|---|
| `HANDOFF.md` | **comece por aqui** — passagem de bastão |
| `docs/08-ESTADO-DO-PROJETO.md` | inventário: números, migrations, pendências |
| `docs/03-DECISOES.md` | as 157 decisões, com o porquê de cada uma |
| `docs/10-APP-DO-TECNICO.md` | o aplicativo, e o concorrente tela a tela |
| `docs/09-PUBLICAR.md` | o site no ar e como republicar |
| `docs/06-PONTUACAO.md` | faturamento — **8 perguntas em aberto** |
| `docs/01` `02` `05` `07` | mapeamento, domínio, concorrente, telas |
| `supabase/README.md` | ordem das migrations e conferências |
| `campo/README.md` | rodar no Expo Go e publicar nas lojas |

# Mantendo este arquivo vivo

Se durante o trabalho aparecer algo que deveria ser regra permanente —
uma regra de negócio, uma restrição de segurança, uma decisão de
arquitetura, um erro que não pode se repetir — **não aplique em
silêncio**. Pergunte se entra, e coloque no arquivo certo acima, não
neste. Quando você errar porque faltava uma regra, isso é sinal de que a
documentação precisa mudar: **diga isso**.

# Idioma

Responda sempre em **português do Brasil**, e escreva a documentação e
os comentários de código em português — o repositório inteiro é assim, e
quem lê é a equipe da AFLINE.
