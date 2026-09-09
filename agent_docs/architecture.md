# Arquitetura

O que uma sessão nova precisa saber para não trabalhar contra o desenho
do sistema. As decisões completas, com o porquê de cada uma, estão em
`docs/03-DECISOES.md` (120 entradas).

---

## Três peças, três ritmos de atualização

```
app/     web do controle    Vite + React + Tailwind   → Cloudflare Pages (deploy MANUAL)
campo/   app do técnico     Expo + React Native       → Expo Go / EAS Build
         banco + auth +     Supabase (Postgres,
         storage + realtime  PostgREST, Storage, Realtime)
```

**Elas se atualizam por caminhos diferentes, e isso já causou confusão.**
O banco muda quando a migration é aplicada; o site, quando alguém roda o
Wrangler; o aplicativo, quando alguém compila. **Commit não publica
nada.**

> Regra: migration que muda o que a tela faz → **republique a tela no
> mesmo dia**. Em 09/09 a 055 passou a recusar a troca de código pelo
> campo e o site ficou horas oferecendo um botão que o servidor já
> recusava.

---

## Por que `campo/` é projeto separado, e não monorepo (D-112)

`app/` é Vite + Tailwind; `campo/` é Metro + `StyleSheet`. As duas
árvores não compartilham build, e compartilhar `node_modules` custaria
mais do que as ~150 linhas de domínio que de fato se repetem.

**`campo/src/lib/dominio.ts` e `formato.ts` duplicam a web de
propósito.** A duplicação é escrita e declarada, não acidental. Mudou
uma regra de situação ou de formatação? Mude nos dois.

---

## O banco é a fonte da verdade

**A lógica de negócio mora em função no Postgres, não na tela.** As
telas chamam RPC; o RLS decide o que cada uma enxerga.

Consequência prática: **arquivo de migration é histórico, o banco é o
estado.** 7 migrations foram aplicadas sem arquivo local (`007`, `009`,
`016`, `017`, `019`, `021`, `022`) — ver `supabase/README.md`. Antes de
supor o que existe, **consulte o banco**.

**`visita_evento` é o funil.** Toda mudança passa por lá — importação,
operadora, controlador, transferência, reversão, campo. É por isso que
o gatilho de avisos (059) mora nela e não em cada RPC: pendurar em cada
porta seria escrever a mesma regra cinco vezes e esquecer na sexta.

---

## Realtime: quem publica o quê, e por quê

| tabela | quem assina | por quê essa e não outra |
|---|---|---|
| `aviso` | o aplicativo, **filtrando por `equipe_id`** | linha magra, sem dado de assinante; com 300 técnicos cada evento vai para os poucos da equipe |
| `visita_evento` | a web do controle | é o que mostra o campo agindo (`origem = MOBILE`), que o `aviso` ignora de propósito |

**`visita` não é publicada, e é decisão.** Traria a linha inteira do
assinante pela rede a cada mudança, e uma importação de 300 linhas
viraria ~90 mil entregas com RLS avaliado por conexão.

**A linha é a verdade; o Realtime é só o carregador.** Quem estava sem
sinal lê o que perdeu ao voltar — é por isso que `aviso` é tabela, e não
só um evento.

---

## Duas linguagens visuais (D-011)

- **Controle** (COP/Controlador): escuro, denso. Passa horas na tela.
- **Campo** (Técnico): **claro**, espaçado, alvo de toque 48–52 px.

Não é gosto: o campo é usado no sol de Manaus, e tela escura sob luz
direta vira espelho. Classes `.sup-controle` / `.sup-campo` em
`app/src/styles.css`; no aplicativo, `campo/src/ui/tema.ts`.

A rampa de cor é a mesma nos dois para parecerem o mesmo produto.

---

## O que NÃO fazer

- **Não instale biblioteca de gráfico.** Os gráficos são SVG escrito à
  mão — controle de tema, bundle pequeno, nada para manter. Todo gráfico
  tem "Ver tabela".
- **Não instale biblioteca de UI no `campo/`.** `StyleSheet` e nada
  mais, pela mesma razão.
- **Não mande `usuario_id` do cliente.** Quem carimba autor é o servidor.
- **Não duplique regra de escopo.** Se já existe função
  (`equipes_visiveis`, `pode_anexar_na_visita`, `situacoes_terminais`),
  chame — não reescreva a condição.
- **Não publique `visita` no Realtime** (acima).

---

## Telas

**Web:** Login · Controle · Serviços · Equipes · Rota do Dia ·
Produtividade · Relatórios · Importação · Sub-falhas · Configurações ·
Administração · Visita (detalhe) · Campo.

**Aplicativo:** Entrar · Agenda · Visita · Captura. A agenda é a tela
inicial de propósito — o concorrente abre com doze ícones e enterra o
trabalho do dia atrás de dois toques (D-112).

Detalhe de cada uma em `docs/07-TELAS-DETALHADAS.md` e
`docs/10-APP-DO-TECNICO.md`.
