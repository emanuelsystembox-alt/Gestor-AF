// ┌─ o endereço antigo manda para o novo ─────────────────────────────────┐
// │ Desde a troca para a VPS (01/11/2026), o site é                       │
// │ https://pulsoline.grupoafline.com.br. O Emanuel pediu que o           │
// │ gestor-af.pages.dev "não deve mais carregar a página nele".           │
// │                                                                       │
// │ A Cloudflare não deixa apagar o *.pages.dev de um projeto: ele é o    │
// │ nome do projeto. Então toda requisição que chega por ele (inclusive   │
// │ os endereços de prévia, tipo 5d61968b.gestor-af.pages.dev) volta 301  │
// │ para o endereço novo, com o mesmo caminho: /entrar vai para /entrar.  │
// │ Quem chega pelo nome novo passa direto.                               │
// └───────────────────────────────────────────────────────────────────────┘
const NOVO = 'pulsoline.grupoafline.com.br'

export async function onRequest({ request, next }) {
  const url = new URL(request.url)
  if (url.hostname === 'gestor-af.pages.dev' || url.hostname.endsWith('.gestor-af.pages.dev')) {
    url.hostname = NOVO
    url.protocol = 'https:'
    url.port = ''
    return Response.redirect(url.toString(), 301)
  }
  return next()
}
