# Publicar o sistema — para o gerente abrir de outra máquina

O banco **já está na nuvem** (Supabase). O que roda na sua máquina é só
a tela, em `localhost:5173`. Publicar significa hospedar essa tela num
endereço fixo; ela continua conversando com o mesmo banco de sempre.

> **Ninguém vê nada sem login.** A tela pede e-mail e senha, e o RLS do
> Postgres barra por papel. Publicar não expõe contrato, cliente nem
> endereço para quem não tem acesso — mas **exige** que você crie o
> usuário do gerente (Administração → Novo usuário).

## O que já está pronto no repositório

| Arquivo | Para quê |
|---|---|
| `app/public/_redirects` | Cloudflare Pages e Netlify: manda toda rota para o `index.html`. Sem isso, recarregar em `/controle/servicos` dá **404** — o roteamento é do React, não do servidor. |
| `app/vercel.json` | O mesmo, na sintaxe da Vercel. |

O build já foi conferido: `npm run build` fecha em ~2 s.

## Passo a passo — Cloudflare Pages

1. **Suba o código**: `git push origin main` (sem isso o serviço publica
   uma versão velha).
2. Entre em **dash.cloudflare.com** → *Workers & Pages* → *Create* →
   *Pages* → *Connect to Git* → autorize o GitHub e escolha
   **`emanuelsystembox-alt/Gestor-AF`**.
3. Configure a build:

   | Campo | Valor |
   |---|---|
   | Framework preset | `Vite` |
   | Root directory | `app` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

4. **Variáveis de ambiente** (Settings → Environment variables). O
   `.env` não vai para o Git — é aqui que elas entram:

   ```
   VITE_SUPABASE_URL=https://kqfflkxjijzdtnfshdlv.supabase.co
   VITE_SUPABASE_ANON_KEY=<a chave publishable do app/.env>
   ```

   A chave *publishable* é feita para viver no navegador: quem protege o
   dado é o RLS, não o segredo dela. **Nunca** publique a `service_role`.

5. *Save and Deploy*. Sai um endereço tipo
   `gestor-af.pages.dev` — é esse link que o gerente abre.

Cada `git push` na `main` republica sozinho.

### Vercel, se preferir

Mesmos campos: *Import Project* → o repositório → **Root Directory
`app`** → as duas variáveis de ambiente → *Deploy*. O `vercel.json` já
cuida do roteamento.

## Depois de publicar

1. **Crie o acesso do gerente**: Administração → Novo usuário. Nome,
   e-mail e um **perfil de acesso**. A senha é gerada pelo servidor e
   aparece **uma vez só** — copie e repasse pessoalmente.
2. Escolha o perfil com cuidado: COP e Controlador **podem baixar,
   transferir e excluir contrato**. Se o gerente só deve olhar, peça um
   perfil de leitura antes de criar o acesso.
3. O gerente troca a senha no primeiro acesso.

## O que NÃO fazer

- Não coloque a chave `service_role` em variável do front. Ela ignora o
  RLS inteiro.
- Não mande print de tela com nome, telefone ou endereço de assinante
  por WhatsApp ou e-mail: é dado pessoal (LGPD). O link com login é
  justamente o caminho certo para não precisar disso.
