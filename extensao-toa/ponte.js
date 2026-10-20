// A ponte entre a tela Sincronismo do Gestor AF e o fundo da extensão
// (111, D-189). Roda dentro da página do Gestor AF, num mundo isolado: a
// página fala por window.postMessage, e só o que vier DELA MESMA, com a
// nossa marca, é repassado. Ver app/src/lib/ponteToa.ts (o outro lado).

const DA_PAGINA = 'afline-gestor'
const DA_EXTENSAO = 'afline-ponte-toa'
const VERSAO = chrome.runtime.getManifest().version

window.addEventListener('message', (ev) => {
  if (ev.source !== window) return
  const d = ev.data
  if (!d || d.origem !== DA_PAGINA || typeof d.id !== 'string') return

  const responder = (r) =>
    window.postMessage({ origem: DA_EXTENSAO, id: d.id, ...r }, window.location.origin)

  if (d.tipo === 'ping') {
    responder({ versao: VERSAO })
    return
  }

  if (d.tipo === 'exportar') {
    chrome.runtime.sendMessage({ tipo: 'exportar', numero: d.numero, dia: d.dia }, (r) => {
      if (chrome.runtime.lastError) {
        responder({ ok: false, motivo: 'ERRO', mensagem: chrome.runtime.lastError.message })
      } else {
        responder(r ?? { ok: false, motivo: 'ERRO', mensagem: 'A extensão não respondeu.' })
      }
    })
  }
})
