// A ponte entre a tela Sincronismo do Gestor AF e o fundo da extensão
// (111, D-189). Roda dentro da página do Gestor AF, num mundo isolado: a
// página fala por window.postMessage, e só o que vier DELA MESMA, com a
// nossa marca, é repassado. Ver app/src/lib/ponteToa.ts (o outro lado).

const DA_PAGINA = 'afline-gestor'
const DA_EXTENSAO = 'afline-ponte-toa'
const VERSAO = chrome.runtime.getManifest().version

// O andamento da varredura (117), vindo da aba do TOA pelo fundo, vai para
// a página — com a mesma marca e o id do pedido.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id || !msg || msg.tipo !== 'varredura-evento') return
  window.postMessage({ origem: DA_EXTENSAO, canal: 'varredura', ...msg }, window.location.origin)
})

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

  // 117: a varredura — a lista vai ao fundo; o andamento volta abaixo.
  if (d.tipo === 'varrer' || d.tipo === 'cancelar-varredura') {
    chrome.runtime.sendMessage({ tipo: d.tipo, idPedido: d.id, itens: d.itens }, (r) => {
      if (chrome.runtime.lastError) responder({ aceito: false, mensagem: chrome.runtime.lastError.message })
      else responder(r || { aceito: false, mensagem: 'A extensão não respondeu.' })
    })
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
