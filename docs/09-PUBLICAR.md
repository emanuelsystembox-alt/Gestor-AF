# Publicar o sistema — o endereço para abrir de qualquer máquina

**No ar em https://gestor-af.pages.dev** (Cloudflare Pages, projeto
`gestor-af`, conta `emanuel.systembox@gmail.com`).

O banco **sempre esteve na nuvem** (Supabase). O que estava preso na
máquina do Emanuel era só a tela, em `localhost:5173`. Publicar foi
hospedar essa tela num endereço fixo; ela conversa com o mesmo banco de
sempre.

> **Ninguém vê nada sem login.** A tela pede e-mail e senha, e o RLS do
> Postgres barra por papel. Publicar não expôs contrato, cliente nem
> endereço — mas **exige** criar o usuário de quem for entrar
> (Administração → Novo usuário).

## Como está montado

O build é feito **na máquina**, e sobe a pasta `dist` pronta. O Vite
embute as variáveis `VITE_*` no bundle em tempo de compilação, então
não há variável de ambiente configurada no painel da Cloudflare — o
`app/.env` local é a fonte.

| Peça | Onde |
|---|---|
| Projeto | Cloudflare Pages, `gestor-af`, branch de produção `main` |
| Conteúdo | `app/dist`, enviado pelo Wrangler |
| Rotas | `app/public/_redirects` → `/* /index.html 200` |
| Credencial | OAuth do Wrangler, em `%APPDATA%\xdg.config\.wrangler` |

O `_redirects` não é detalhe: sem ele, abrir direto em
`/controle/servicos` daria **404**, porque o roteamento é do React e o
servidor não conhece essa rota. Conferido no ar: a rota profunda carrega
e cai no login, como tem que ser.

## Commit NÃO publica

Vale dizer com todas as letras, porque já custou confusão: o deploy é
**manual**. Mudar o código, rodar o `tsc` e commitar não muda nada em
`gestor-af.pages.dev` — o site continua servindo o `dist` do último
envio, mesmo que o banco já tenha mudado.

Isso fica perigoso quando a migration e a tela andam juntas. Em 09/09 a
055 passou a exigir GPS na baixa e a esconder o "Trocar código" do
campo; o banco foi atualizado na hora, e o site publicado ficou horas
oferecendo um botão que o servidor já recusava.

**Regra:** migration que muda o que a tela faz → republique a tela no
mesmo dia.

## Republicar depois de mudar o código

```powershell
cd app
npm run build
npx wrangler pages deploy dist --project-name=gestor-af --branch=main --commit-dirty=true
```

> Uma linha por comando: o terminal aqui é PowerShell 5.1, que **não
> tem `&&`** (CLAUDE.md). Encadeado com `&&` isto nem chega a rodar.

Cada envio gera também um endereço só daquela versão (tipo
`https://874da8e7.gestor-af.pages.dev`), útil para comparar antes e
depois. O endereço que se dá para as pessoas é sempre o principal.

### Se um dia quiser que republique sozinho

Dá para ligar o projeto ao GitHub (Pages → Settings → Builds &
deployments → Connect to Git), com **Root directory `app`**, build
`npm run build`, output `dist`. Aí as duas variáveis do `.env` **passam
a ser necessárias no painel**, porque o build deixa de acontecer aqui.
Enquanto o deploy for manual, não são.

## O que foi conferido no ar

- A rota profunda `/controle/servicos` carrega e redireciona ao login.
- Nenhum erro no console.
- O bundle publicado tem a URL do Supabase e a chave **publishable** —
  e **nenhuma** chave secreta. (O texto `sb_secret_` aparece no bundle,
  mas é código da biblioteca `supabase-js` conferindo prefixo de chave,
  não um segredo nosso. Vale saber: uma busca ingênua por essa palavra
  assusta à toa.)

## O que NÃO fazer

- Não colocar a chave `service_role` em variável do front. Ela ignora o
  RLS inteiro. A que está publicada é a *publishable*, feita para viver
  no navegador.
- Não mandar print com nome, telefone ou endereço de assinante por
  WhatsApp ou e-mail: é dado pessoal (LGPD). O link com login existe
  justamente para não precisar disso.

## Antes de passar o link para alguém

1. **Crie o acesso**: Administração → Novo usuário. A senha é gerada
   pelo servidor e aparece **uma vez só**.
2. **Escolha o perfil com cuidado**: COP e Controlador podem **baixar,
   transferir e excluir contrato**. Para quem só deve olhar, ainda não
   existe um perfil de leitura — é preciso criá-lo antes.
