# Gestor AF — AFLINE Manager

Camada operacional da **AFLINE**, prestadora de serviços da **CLARO**:
importar a rota do **TOA (Oracle Field Service)**, despachar para as
equipes, executar em campo, medir e cobrar. Substitui o Alfa Gestor /
ngestor, que é caro e cujo roadmap a AFLINE não controla.

**Assumindo o projeto? Comece por [`HANDOFF.md`](HANDOFF.md).**

## As três peças

| | o quê | onde roda |
|---|---|---|
| **`app/`** | web do controle (COP, controlador, supervisor, almoxarifado, frota, administração) — Vite 5 · React 18 · TypeScript · Tailwind 4 | **gestor-af.pages.dev** (Cloudflare Pages, deploy manual) |
| **`campo/`** | aplicativo do técnico — Expo SDK 57 · React Native 0.86 | APK Android (EAS Build) com **atualização pelo ar** desde o 0.3.0; Expo Go para teste |
| **banco** | Supabase — Postgres + PostgREST + Storage + Realtime | projeto `kqfflkxjijzdtnfshdlv` (plano Free) |

As três se atualizam por caminhos diferentes: o banco muda quando a
migration é aplicada, o site quando alguém roda o Wrangler, o aplicativo
quando alguém publica a atualização ou gera o APK. **Commit não publica
nada.**

## Como rodar

```bash
cd app
npm install
cp .env.example .env
npm run dev
```

```bash
cd campo
npm install
cp .env.example .env
npx expo start
```

O terminal da AFLINE é Windows PowerShell 5.1: **uma linha por comando**,
sem `&&`. Publicar a web e o aplicativo: [`docs/09-PUBLICAR.md`](docs/09-PUBLICAR.md)
e [`campo/README.md`](campo/README.md).

## O que já faz

- **Importação do TOA** por cidade: o bucket sai do nome do arquivo e
  arquivo de outra cidade é recusado; o dia de atuação é escolhido por quem
  importa; baixa automática pelo **código**, não pelo status.
- **Uma cidade por vez**: seletor no topo; o ADMIN vê todas, os demais só as
  liberadas no cadastro. Quem separa é o banco (RLS).
- **Serviços, Equipes, Rota do dia, Monitoramento** (rastro, cercas,
  antifraude do GPS), **Meta técnica, Relatórios**.
- **Aplicativo do técnico**: agenda, status, baixa com GPS, fotos e vídeo,
  material, ticket de suporte, conversa, painel e ranking.
- **Almoxarifado** (carga, romaneios, aceite pelo celular) e **Frota**
  (condutor, abastecimento, consumo medido).
- **Administração**: usuários, perfis de acesso, cidades que cada um acessa,
  foto, data de contratação; cadastro de uma cidade inteira por planilha
  padrão; códigos de baixa editáveis.

## Regras que o código assume

- **Uma visita carrega de 1 a 10 O.S.** (o comum são 2). Deslocamento conta
  por visita; baixa e faturamento, por O.S.
- **Quem diz o resultado é o código de baixa**, não o status da operadora.
  Código que o cadastro não conhece não trava a importação — trava o
  contrato; a tela avisa.
- **Zero e desconhecido não são a mesma coisa**: sem regra de pontuação, a
  tela diz "sem regra", não `0,00`.
- **A permissão vive no banco.** Se a interface for burlada, o Postgres não
  devolve a linha.

As regras completas, com a frase de quem decidiu, estão em
[`agent_docs/business-rules.md`](agent_docs/business-rules.md) e nas
**186 decisões** de [`docs/03-DECISOES.md`](docs/03-DECISOES.md).

## Documentação

| arquivo | para quê |
|---|---|
| [`HANDOFF.md`](HANDOFF.md) | passagem de bastão — comece por aqui |
| [`docs/08-ESTADO-DO-PROJETO.md`](docs/08-ESTADO-DO-PROJETO.md) | inventário e pendências |
| [`docs/03-DECISOES.md`](docs/03-DECISOES.md) | as decisões e o porquê de cada uma |
| [`supabase/README.md`](supabase/README.md) | as migrations, em ordem (105 arquivos, até a 108) |
| [`campo/README.md`](campo/README.md) | o aplicativo: rodar, gerar APK, publicar atualização |
| [`agent_docs/`](agent_docs/) | regras de negócio, armadilhas, segurança, arquitetura |

## Dados de cliente (LGPD)

Planilhas (`*.xlsx`, `*.csv`) estão no `.gitignore`: nome, telefone e
endereço de assinante não entram no repositório. A chave do Supabase que
está nos arquivos é a **publishable** — sozinha não dá acesso a nada; a
`service_role` nunca entra aqui.
