# Gestor AF · Campo — o aplicativo do técnico

Android e iPhone, em **Expo (SDK 57)**. Faz o que o navegador não faz:
câmera, vídeo e GPS de verdade. Ver `docs/03-DECISOES.md`, D-112 a D-116.

> A tela `/campo` da web **continua existindo**. Serve o controlador
> conferindo do computador e o técnico sem o aplicativo instalado.

---

## Rodar agora, no seu celular

```bash
cd campo
npm install
cp .env.example .env
npx expo start
```

1. Instale o **Expo Go** (Play Store / App Store).
2. Aponte a câmera para o QR Code que aparece no terminal.
3. O celular e o computador precisam estar **na mesma rede**. Se não
   estiverem, use `npx expo start --tunnel`.

Nada de build, nada de loja. Câmera, vídeo e GPS funcionam no Expo Go.

---

## Antes de conseguir entrar

O aplicativo usa o **mesmo login do sistema**. Mas a agenda só aparece
para quem o banco reconhece como técnico de uma equipe:

| | onde |
|---|---|
| 1. usuário com papel **TECNICO** e perfil de acesso **Técnico de Campo** | web · Administração |
| 2. esse usuário **vinculado a um técnico** (`tecnico.usuario_id`) | web · Administração |
| 3. esse técnico **numa equipe** que tenha contrato do dia | web · Equipes |

Sem o passo 2 a pessoa entra e vê a agenda vazia — `equipes_visiveis()`
não acha equipe nenhuma para ela. Não é bug do aplicativo.

---

## Publicar nas lojas

A pasta **já está ligada** ao projeto EAS
`@afline-instalacao-e-manutencao-eletrica/afline-manager`
(`24f5284f-5f83-4a9d-8e9c-f76ab94bc12d`), e o `eas.json` tem três perfis:

| perfil | para quê |
|---|---|
| `development` | build de desenvolvimento, com dev client |
| `preview` | **APK** para instalar no celular sem loja — é o que você quer para testar em equipe |
| `production` | build de loja, com `autoIncrement` do número de versão |

```bash
npx eas-cli@latest build --platform android --profile preview
npx eas-cli@latest build --platform ios --profile production
```

O iPhone exige conta paga de desenvolvedor Apple; o Android não.

> **As variáveis do Supabase estão no `env` de cada perfil do
> `eas.json`, e isso é de propósito.** O `.env` local não vai para o Git
> nem sobe para a nuvem da EAS: sem isto, o build sai e o aplicativo
> abre com *"Faltam EXPO_PUBLIC_SUPABASE_URL…"*. A chave é
> **publishable** — ela não dá acesso a nada sozinha; quem protege os
> dados é o RLS (migration 005). É a mesma chave que já está em
> `app/.env.example`, versionada.

---

## O que tem dentro

```
App.tsx                  sessão + as três telas
src/navegacao.ts         Agenda · Visita · Captura
src/lib/supabase.ts      cliente (AsyncStorage, sem detectSessionInUrl)
src/lib/auth.tsx         sessão, perfil, papéis — guarda o ID, não o objeto (D-085)
src/lib/gps.ts           a trava do D-113, e a cara dela
src/lib/midia.ts         foto/vídeo → Storage → registrar_evidencia, com fila
src/lib/dominio.ts       situações, cores e tipos de evidência
src/lib/formato.ts       datas em fuso local (D-084)
src/ui/tema.ts           a linguagem CAMPO: clara, 52 px de toque (D-011)
src/telas/Entrar.tsx     login
src/telas/Agenda.tsx     o dia: a fazer · baixadas · minha produção
src/telas/Visita.tsx     endereço, O.S., baixa, evidência, equipamento, histórico
src/telas/Captura.tsx    câmera e vídeo
```

**Sem biblioteca de UI.** `StyleSheet` e nada mais — a mesma decisão dos
gráficos SVG à mão na web: controle do tema, bundle pequeno, nada para
manter.

---

## As quatro regras que o aplicativo obedece

Elas **não** moram aqui. Moram no banco (migration 055), e o aplicativo
só as explica antes de o botão falhar:

1. **Sem GPS não há baixa** — nem encerramento de visita. `baixar_os`
   recusa a chamada do campo sem coordenada.
2. **Baixa dada não se desfaz pelo campo**, e contrato encerrado não
   volta — inclusive o que a baixa automática do TOA fechou.
3. **Depois de baixado ele ainda anexa** foto, vídeo e equipamento —
   enquanto o contrato for do dia.
4. **Quem carimba o autor é o servidor.** Nenhuma tela manda
   `usuario_id` (D-061).

Confira que continuam valendo:

```sql
select * from testar_campo();      -- 14 cenários
select * from testar_policies();   -- 16 cenários
```

---

## Antes de commitar

```bash
cd campo
npx tsc --noEmit
npx expo export --platform android --output-dir ../.tmp-export
```

O `export` é o teste de bundle: ele pega import quebrado e módulo nativo
faltando, que o `tsc` não vê.
