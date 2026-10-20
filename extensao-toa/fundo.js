// O fundo da extensão: faz a MESMA chamada do botão Ações › Exportar do
// Console de Alocação do TOA, com a sessão de quem logou no TOA neste
// Chrome (111, D-189).
//
// ┌─ o que esta extensão pode e não pode ──────────────────────────────┐
// │ Só EXPORTA. A URL é montada aqui, a partir de um número de bucket  │
// │ e de um dia conferidos; a página do Gestor AF não consegue pedir   │
// │ outra coisa ao TOA. Nada é gravado no TOA.                         │
// │                                                                    │
// │ A chamada foi lida da aba de rede do TOA em 19/10/2026: um GET     │
// │ que devolve o .xlsx pronto (206 KB em 2,2 s para MAN-AFLINE), com  │
// │ o nome `Atividades-<BUCKET>_DD_MM_AA.xlsx` no Content-Disposition. │
// │ Se a Oracle mudar a tela, é AQUI que se conserta.                  │
// └────────────────────────────────────────────────────────────────────┘

const TOA = 'https://clarobrasil.fs.ocs.oraclecloud.com'

const doToa = (url) => typeof url === 'string' && url.startsWith(TOA + '/')

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  // Só os nossos scripts de conteúdo falam com o fundo.
  if (sender.id !== chrome.runtime.id || !msg) return false

  if (msg.tipo === 'exportar') {
    exportar(msg.numero, msg.dia)
      .then(responder)
      .catch((e) => responder({ ok: false, motivo: 'ERRO', mensagem: String((e && e.message) || e) }))
    return true // a resposta vem depois (assíncrona)
  }

  // ── a varredura (117): Gestor AF → aba do TOA → andamento de volta ──
  if (msg.tipo === 'varrer' && sender.tab && !doToa(sender.url)) {
    iniciarVarredura(msg, sender.tab.id).then(responder)
    return true
  }
  if (msg.tipo === 'cancelar-varredura' && sender.tab && !doToa(sender.url)) {
    abasDoToa().then((abas) => { for (const a of abas) chrome.tabs.sendMessage(a.id, { tipo: 'cancelar-varredura' }).catch(() => {}) })
    responder({ ok: true })
    return false
  }
  if (msg.tipo === 'varredura-evento' && doToa(sender.url) && Number.isInteger(msg.abaGestor)) {
    // A porcentagem no ícone — visível de qualquer aba.
    const pct = msg.total ? Math.floor((msg.feitos / msg.total) * 100) : 0
    chrome.action.setBadgeBackgroundColor({ color: '#c81a23' })
    chrome.action.setBadgeText({ text: msg.evento === 'fim' ? '' : `${pct}%` })
    chrome.action.setTitle({ title: msg.evento === 'fim'
      ? 'AFLINE — varredura terminada'
      : `AFLINE — varrendo o TOA: ${msg.feitos} de ${msg.total}` })
    chrome.tabs.sendMessage(msg.abaGestor, msg).catch(() => {})
    return false
  }
  return false
})

async function abasDoToa() {
  return chrome.tabs.query({ url: TOA + '/*' })
}

/** Acha a aba do TOA, entrega a lista e devolve se ela aceitou. */
async function iniciarVarredura(msg, abaGestor) {
  if (!Array.isArray(msg.itens) || !msg.itens.every((i) => i && /^\d{1,12}$/.test(String(i.aid)))) {
    return { aceito: false, mensagem: 'Lista de contratos inválida.' }
  }
  const abas = await abasDoToa()
  if (!abas.length) {
    return { aceito: false, mensagem: 'Abra o TOA (Console de Alocação, bucket e dia de hoje) numa aba deste Chrome.' }
  }
  // Prefere a aba que já está no Console.
  const aba = abas.find((a) => /^Console de Aloca/.test(a.title || '')) || abas[0]
  try {
    const r = await chrome.tabs.sendMessage(aba.id, {
      tipo: 'varrer', idPedido: String(msg.idPedido), abaGestor,
      itens: msg.itens.map((i) => ({ aid: String(i.aid), precisa_equipamento: !!i.precisa_equipamento })),
    })
    if (r && r.aceito) chrome.action.setBadgeText({ text: '0%' })
    return r || { aceito: false, mensagem: 'A aba do TOA não respondeu.' }
  } catch {
    return { aceito: false, mensagem: 'A aba do TOA não respondeu. Recarregue a aba do TOA (F5) depois de instalar ou atualizar a extensão.' }
  }
}

async function exportar(numero, dia) {
  if (!Number.isInteger(numero) || numero <= 0 || numero > 99999999) {
    return { ok: false, motivo: 'ERRO', mensagem: 'Número do bucket no TOA inválido.' }
  }
  if (typeof dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    return { ok: false, motivo: 'ERRO', mensagem: 'Dia inválido.' }
  }

  const pedido = Math.random().toString(36).slice(2)
  const url = `${TOA}/?m=gridexport&a=download&itype=manage&providerId=${numero}`
    + `&date=${dia}&panel=top&view=time&downloadId=${pedido}&dates=${dia}&${Date.now()}`

  let r
  try {
    r = await fetch(url, { credentials: 'include', cache: 'no-store' })
  } catch (e) {
    return { ok: false, motivo: 'ERRO', mensagem: 'Sem conexão com o TOA: ' + String((e && e.message) || e) }
  }
  const bytes = new Uint8Array(await r.arrayBuffer())

  // .xlsx é um zip: começa com "PK\x03\x04". Qualquer outra coisa não é a
  // planilha — e HTML é o TOA pedindo login de novo.
  const ehPlanilha = bytes.length > 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  if (!ehPlanilha) {
    const tipo = r.headers.get('content-type') || ''
    if (/html/i.test(tipo) || r.status === 401 || r.status === 403) {
      return {
        ok: false, motivo: 'SEM_SESSAO',
        mensagem: 'O TOA devolveu uma página em vez da planilha: a sessão caiu. Entre no TOA de novo neste computador.',
      }
    }
    return { ok: false, motivo: 'ERRO', mensagem: `O TOA respondeu ${r.status} (${tipo || 'sem tipo'}), e não uma planilha.` }
  }

  const disp = r.headers.get('content-disposition') || ''
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disp) || /filename="?([^";]+)"?/i.exec(disp)
  let nome = null
  try { nome = m ? decodeURIComponent(m[1].trim()) : null } catch { nome = null }

  return { ok: true, nome, base64: paraBase64(bytes) }
}

function paraBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}
