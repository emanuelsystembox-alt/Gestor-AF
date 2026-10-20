// A ponte entre a página do Gestor AF e a extensão (D-189, D-193).
//
// Desde a 0.3.0 quem trabalha é o FUNDO da extensão — a página não manda
// mais exportar nem varrer. A ponte só responde "estou aqui, versão X",
// para a tela Sincronismo dizer se este Chrome tem a extensão. Roda num
// mundo isolado e só responde ao que vier da própria página, com a marca.

const DA_PAGINA = 'afline-gestor'
const DA_EXTENSAO = 'afline-ponte-toa'
const VERSAO = chrome.runtime.getManifest().version

window.addEventListener('message', (ev) => {
  if (ev.source !== window) return
  const d = ev.data
  if (!d || d.origem !== DA_PAGINA || typeof d.id !== 'string') return
  if (d.tipo === 'ping') {
    window.postMessage({ origem: DA_EXTENSAO, id: d.id, versao: VERSAO }, window.location.origin)
  }
})
