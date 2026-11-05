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

/*
 * ┌─ D-308 · um mapa só para as janelas ──────────────────────────────────┐
 * │ O Google cobra (e, sem faturamento, limita a 100/dia) por MAPA CRIADO │
 * │ — `new google.maps.Map`. As janelas (onde baixou, intervalo da        │
 * │ jornada) criavam um a cada abertura: dez cliques, dez "map loads".    │
 * │ Aqui o mapa nasce uma vez por tema e por sessão, num <div> próprio,   │
 * │ e cada janela que abre só o PENDURA no seu espaço e redesenha os      │
 * │ pontos. Reabrir fica mais rápido, não mais lento: o mapa já está      │
 * │ pronto. Um por tema porque `colorScheme` só vale na construção        │
 * │ (traps.md). Quem usa limpa os próprios desenhos ao fechar.            │
 * └────────────────────────────────────────────────────────────────────────┘
 */
const reaproveitados = new Map<string, { el: HTMLDivElement; mapa: google.maps.Map }>()

export function mapaReaproveitado(destino: HTMLElement, tema: string,
                                  opcoes: google.maps.MapOptions): google.maps.Map {
  let x = reaproveitados.get(tema)
  if (!x) {
    const el = document.createElement('div')
    el.style.width = '100%'
    el.style.height = '100%'
    const mapa = new google.maps.Map(el, { ...opcoes, colorScheme: tema === 'claro' ? 'LIGHT' : 'DARK' })
    x = { el, mapa }
    reaproveitados.set(tema, x)
  } else {
    x.mapa.setOptions(opcoes)
    if (opcoes.center) x.mapa.setCenter(opcoes.center)
    if (opcoes.zoom != null) x.mapa.setZoom(opcoes.zoom)
  }
  if (x.el.parentElement !== destino) destino.appendChild(x.el)
  return x.mapa
}

/** Guarda o que foi desenhado num mapa reaproveitado, para tirar ao fechar. */
export function camada() {
  const itens: { setMap: (m: google.maps.Map | null) => void }[] = []
  return {
    guarda: <T extends { setMap: (m: google.maps.Map | null) => void }>(o: T): T => { itens.push(o); return o },
    limpa: () => { for (const o of itens) o.setMap(null); itens.length = 0 },
  }
}
