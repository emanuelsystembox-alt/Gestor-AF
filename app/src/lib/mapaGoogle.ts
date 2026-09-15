/**
 * O carregador do Google Maps.
 *
 * ┌─ por que carregado por script, e não por pacote npm ─────────────┐
 * │ A API do Maps não é uma biblioteca que se empacota: o `<script>`  │
 * │ é o produto, e ele se atualiza do lado do Google. Um wrapper npm  │
 * │ (`@googlemaps/js-api-loader`) faria exatamente estas 30 linhas e  │
 * │ mais uma dependência para manter. Os TIPOS, sim, vêm do npm       │
 * │ (`@types/google.maps`, devDependency): zero byte no bundle e o    │
 * │ `tsc` continua estrito.                                           │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌─ a chave ─────────────────────────────────────────────────────────┐
 * │ `VITE_GOOGLE_MAPS_API_KEY` vai para o BUNDLE — não tem outro       │
 * │ jeito: quem chama a API do Maps é o navegador de quem abre a tela. │
 * │ Isso é normal e previsto pelo Google, MAS só é seguro com a chave  │
 * │ **restrita por referenciador HTTP** no Cloud Console:              │
 * │                                                                    │
 * │     https://gestor-af.pages.dev/*    e    http://localhost:5173/*  │
 * │                                                                    │
 * │ Sem essa restrição, qualquer um que leia o bundle usa a chave e a  │
 * │ fatura é nossa. Ver docs/09-PUBLICAR.md.                           │
 * │                                                                    │
 * │ A chave NÃO entra no Git: mora no `app/.env`, que está no          │
 * │ `.gitignore`. O `.env.example` traz só o nome, vazio.              │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LGPD ────────────────────────────────────────────────────────────┐
 * │ O que vai para o Google é o que qualquer mapa precisa: a área da   │
 * │ tela, para desenhar o ladrilho. As bolhas são posicionadas NO      │
 * │ NAVEGADOR, e são médias por BAIRRO — não o endereço do assinante.  │
 * │ Nenhum nome, telefone ou endereço sai daqui.                       │
 * └────────────────────────────────────────────────────────────────────┘
 */

const CHAVE = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '') as string

/** Sem chave a tela NÃO quebra: cai no mapa em SVG, que sempre funciona.
 *  Um clone novo do repositório tem `.env.example` sem chave nenhuma. */
export const temChaveDoMapa = CHAVE.trim().length > 0

let promessa: Promise<void> | null = null

/**
 * A falha que o `onerror` do <script> NAO pega.
 *
 * Chave restrita a outro domínio, cota estourada ou faturamento
 * desligado: o script CARREGA, a promessa resolve, o mapa é criado — e
 * só então a API desiste e pinta ela mesma um "Ops! Algo deu errado"
 * dentro do nosso div. A tela fica com um retângulo morto e nenhum
 * caminho de volta.
 *
 * O Google avisa por uma global: `window.gm_authFailure`. É o único
 * gancho que existe — e não é hipótese: apareceu na primeira abertura
 * desta tela, `RefererNotAllowedMapError`, porque a chave estava
 * restrita e `http://localhost:5173/*` não estava na lista.
 */
let falhouAuth = false
const ouvintes = new Set<() => void>()

;(window as unknown as Record<string, unknown>).gm_authFailure = () => {
  falhouAuth = true
  for (const f of ouvintes) f()
}

export const autenticacaoFalhou = () => falhouAuth

/** Avisa quando a API recusar a chave. Devolve o cancelador. */
export function aoFalharAutenticacao(f: () => void): () => void {
  ouvintes.add(f)
  return () => { ouvintes.delete(f) }
}

/** Injeta o script uma vez por sessão e resolve quando `google.maps`
 *  existir. Chamar de novo devolve a MESMA promessa — dois painéis na
 *  mesma tela não podem carregar a API duas vezes. */
export function carregarMapaGoogle(): Promise<void> {
  if (!temChaveDoMapa) return Promise.reject(new Error('sem chave'))
  if (promessa) return promessa

  promessa = new Promise<void>((resolve, reject) => {
    if (typeof google !== 'undefined' && google.maps) { resolve(); return }

    const cb = '__afline_mapa_pronto'
    ;(window as unknown as Record<string, unknown>)[cb] = () => resolve()

    const s = document.createElement('script')
    const p = new URLSearchParams({
      key: CHAVE,
      v: 'weekly',
      language: 'pt-BR',
      region: 'BR',
      loading: 'async',
      callback: cb,
    })
    s.src = `https://maps.googleapis.com/maps/api/js?${p}`
    s.async = true
    // Só falha de REDE chega aqui: script bloqueado, offline, DNS. Chave
    // recusada não — o script carrega normalmente e a recusa vem depois,
    // por `gm_authFailure` (acima). Nos dois casos quem chama volta para
    // o SVG: a tela nunca fica em branco por causa do mapa.
    s.onerror = () => { promessa = null; reject(new Error('falhou ao carregar')) }
    document.head.appendChild(s)
  })

  return promessa
}
