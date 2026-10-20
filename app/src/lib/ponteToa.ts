/**
 * A conversa da PÁGINA com a extensão "AFLINE — ponte com o TOA"
 * (`extensao-toa/`, D-189, D-193).
 *
 * Desde a 0.3.0 quem sincroniza e varre é o fundo da extensão, sozinho —
 * a página não manda mais exportar nem varrer (era ela que trabalhava, e
 * parava quando a pessoa saía da tela). Aqui sobrou só a pergunta "este
 * Chrome tem a extensão? qual versão?", para a tela Sincronismo orientar.
 *
 * O canal é `window.postMessage` com o script de conteúdo `ponte.js`,
 * filtrado por origem e por um id por pedido.
 */

const DA_PAGINA = 'afline-gestor'
const DA_EXTENSAO = 'afline-ponte-toa'

export interface InfoExtensao { versao: string }

/** A extensão está instalada e respondendo nesta aba? Nulo = não. */
export function extensaoPresente(): Promise<InfoExtensao | null> {
  return new Promise(resolve => {
    const id = crypto.randomUUID()
    const ouvir = (ev: MessageEvent) => {
      const d = ev.data as { origem?: string; id?: string; versao?: string } | null
      if (ev.source !== window || d?.origem !== DA_EXTENSAO || d.id !== id) return
      clearTimeout(t)
      window.removeEventListener('message', ouvir)
      resolve(d.versao ? { versao: d.versao } : null)
    }
    const t = setTimeout(() => { window.removeEventListener('message', ouvir); resolve(null) }, 1500)
    window.addEventListener('message', ouvir)
    window.postMessage({ origem: DA_PAGINA, id, tipo: 'ping' }, window.location.origin)
  })
}

/** 0.3.0 ou mais nova: a extensão que trabalha sozinha (D-193). */
export function extensaoAutonoma(v: InfoExtensao): boolean {
  const [a, b] = v.versao.split('.').map(Number)
  return a > 0 || b >= 3
}
