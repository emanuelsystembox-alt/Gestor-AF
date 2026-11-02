// O caminho DIRETO da varredura (0.7.0, D-250). Roda no MUNDO DA PÁGINA do
// TOA ("world": "MAIN" no manifest), porque é lá que mora a aplicação dele.
//
// ┌─ por que existe ───────────────────────────────────────────────────┐
// │ > "ela é muito lenta, e precisa ter a tela aberta do toa, para      │
// │ > entrar e sair de cada contrato" — Emanuel, 01/11                  │
// │                                                                     │
// │ Até a 0.6 a varredura clicava: bloco → cartão → Detalhes →          │
// │ Equipamento → voltar, ~9 s por contrato, com a janela à vista. Aqui │
// │ ela PEDE os mesmos dados que essas telas pedem, sem abrir nenhuma:  │
// │   · Time/get   — o Gantt de um bucket: cada atividade do dia, de    │
// │                  qual técnico é (p) e o rótulo (L, com o nome).     │
// │                  UMA chamada por bucket.                            │
// │   · sync/write — o que a tela de Detalhes carrega: a atividade      │
// │                  (cname) e o inventário (Instalado, Desinstalado,   │
// │                  Cliente). UMA chamada por técnico, com as aids.    │
// │ As duas chamadas são as que a extensão do Alfa usa (referencia/,    │
// │ 1.0.7); o Time/get vai pela camada de API do PRÓPRIO TOA            │
// │ (jbf/core/api-layer), a estratégia do filtro de área do Emanuel     │
// │ (Projeto - Usabilidade TOA/filtro-area-v2.js).                      │
// │                                                                     │
// │ Continua só LEITURA: o sync/write vai sem ação nenhuma na pilha     │
// │ (é como a aplicação puxa dados) e numa "janela" própria             │
// │ (window_id), para não bagunçar o sincronismo da aba. Não há aqui    │
// │ chamada genérica — só as duas, com parâmetros conferidos.           │
// └─────────────────────────────────────────────────────────────────────┘
//
// Conversa com toa.js (mundo isolado da extensão) por window.postMessage:
//   pedido:   { origem: 'afline-toa-pedido',   id, op, ...parâmetros }
//   resposta: { origem: 'afline-toa-resposta', id, ok, ...resultado | erro }
// Só responde ao que vier da própria janela e com a marca.

(function () {
  'use strict'
  if (window.__aflineToaPagina) return
  window.__aflineToaPagina = true

  const PEDIDO = 'afline-toa-pedido'
  const RESPOSTA = 'afline-toa-resposta'
  const DIA = /^\d{4}-\d{2}-\d{2}$/
  const NUM = /^\d{1,12}$/

  // ── a camada de API do próprio TOA (a do filtro de área) ─────────────
  let transporte = null
  function camada() {
    if (transporte) return transporte
    try {
      const api = window.require('jbf/core/api-layer')
      const Url = window.require('jbf/app/transports/url-builders/module-action-url-builder')
      const t = api.requireSync('api-app', 1).getTransport()
      transporte = { enviar: (m, a, p) => t.send(new Url(m, a), p).then((r) => r.getContent()) }
    } catch { transporte = null }
    return transporte
  }

  // ── o pedido direto, com os cabeçalhos que a aplicação manda ─────────
  // Objetos aninhados viram chaves com colchetes (filter[slider]=10),
  // como o PHP do TOA lê. A ficha anti-falsificação é a que a própria
  // aplicação guardou para esta sessão, nesta aba.
  function achatar(obj, pre, saida) {
    for (const [k, v] of Object.entries(obj)) {
      const chave = pre ? `${pre}[${k}]` : k
      if (v !== null && typeof v === 'object') achatar(v, chave, saida)
      else saida.append(chave, v == null ? '' : String(v))
    }
    return saida
  }
  async function direto(consulta, corpo) {
    const r = await fetch('/?' + consulta, {
      method: 'POST', credentials: 'same-origin',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-oa': '2', 'x-platform': '1', 'x-requested-with': 'XMLHttpRequest',
        'x-ofs-csrf-secure': localStorage.getItem('CSRFSecureToken') || '',
      },
      body: achatar(corpo, '', new URLSearchParams()).toString(),
    })
    if (!r.ok) throw new Error(`o TOA respondeu ${r.status}`)
    const texto = await r.text()
    try { return JSON.parse(texto) } catch { throw new Error('o TOA não respondeu dados (sessão caiu?)') }
  }

  function conferirSessao(j) {
    const erro = j && (j.errorNo || j.error_no || (j.error && j.error.code))
    if (erro) throw new Error(`o TOA recusou: ${erro}`)
    return j
  }

  // ── a árvore: nome do bucket → número (providerId) ───────────────────
  // A estrutura que a aplicação já carregou (t: 2 = bucket, 5 = técnico);
  // sem ela, os itens da árvore na tela (.edt-item[data-id]).
  function normalizar(s) { return String(s || '').trim().replace(/\s+/g, ' ').toUpperCase() }
  function numeroDoBucket(nome) {
    const alvo = normalizar(nome)
    try {
      const est = window.initialTreeData && window.initialTreeData.structure
      if (est) for (const [pid, n] of Object.entries(est)) if (n && n.t === 2 && normalizar(n.n) === alvo) return pid
    } catch { /* segue para a tela */ }
    for (const el of document.querySelectorAll('.edt-item[data-id]')) {
      const n = el.querySelector('.rtl-prov-name')
      if (n && normalizar(n.textContent) === alvo) return el.getAttribute('data-id')
    }
    return null
  }

  // 0.8.0 (D-251): os buckets que ESTE login do TOA enxerga — é daqui que a
  // extensão sabe o que oferecer. Só os buckets (t = 2), não os técnicos.
  function bucketsDaArvore() {
    const vistos = new Map()
    try {
      const est = window.initialTreeData && window.initialTreeData.structure
      if (est) for (const [pid, n] of Object.entries(est)) {
        if (n && n.t === 2 && NUM.test(pid) && n.n) vistos.set(pid, normalizar(n.n))
      }
    } catch { /* segue para a tela */ }
    if (!vistos.size) {
      for (const el of document.querySelectorAll('.edt-item[data-id]')) {
        const n = el.querySelector('.rtl-prov-name'), pid = el.getAttribute('data-id')
        const nome = n && normalizar(n.textContent)
        // na tela também aparecem técnicos: bucket é nome sem espaço (MAN-AFLINE_01_VT)
        if (nome && NUM.test(pid) && /^[A-Z0-9][A-Z0-9_-]*$/.test(nome)) vistos.set(pid, nome)
      }
    }
    return [...vistos].map(([numero, nome]) => ({ numero: Number(numero), nome }))
  }

  // ── Time/get: as atividades do dia de um bucket ──────────────────────
  async function atividadesDoBucket(bucket, dia) {
    const pid = numeroDoBucket(bucket)
    if (!pid) throw new Error(`não achei o bucket ${bucket} na árvore do TOA`)
    const p = {
      parent: pid, selectedGroup: 0, qdate: dia, dates: [dia], panel: 'top',
      filter: { queue_filter: 0, recursively: 0, include_on_call: 0, include_non_working: 0, show_tech_trace: 0, slider: 10, apply: 'apply' },
      versions: { from: 1, to: 76 }, return_shifts: 0, requestId: 'top_time_' + Date.now(),
      sel_pid: pid, is_favorite_pid: 0, is_group: 0,
      resourceTreeSelection: { groupId: 0, rootPid: 0, selectedPid: pid },
      targ_el: 'elId2171', screen: 'view_activities_time',
    }
    let j = null
    const c = camada()
    if (c) {
      try { j = await c.enviar('Time', 'get', { ...achatarObjeto(p), itype: 'manage', output: 'ajax' }) } catch { j = null }
    }
    if (!j || !(j.delta || {}).activities) j = await direto('m=Time&a=get&itype=manage&output=ajax', p)
    conferirSessao(j)
    const lista = (j.delta && j.delta.activities) || null
    if (!lista) throw new Error('o Gantt do bucket veio sem a lista de atividades')
    const atividades = {}
    for (const [aid, a] of Object.entries(lista)) {
      if (!a || typeof a !== 'object') continue
      // L = "Tipo, Nome do cliente, …" (o rótulo do bloco no Gantt)
      const partes = String(a.L || '').trim().replace(/\s+/g, ' ').split(',').map((s) => s.trim())
      atividades[aid] = { tecnico: a.p != null ? String(a.p) : null, rotuloNome: partes[1] || null }
    }
    return { numero: pid, atividades }
  }
  function achatarObjeto(p) {
    const o = {}
    for (const [k, v] of achatar(p, '', new URLSearchParams())) o[k] = v
    return o
  }

  // ── sync/write: atividade + inventário das aids de UM técnico ────────
  const SECAO = { install: 'INSTALADO', deinstall: 'DESINSTALADO', customer: 'CLIENTE' }
  // ┌─ o de/para é pela ORDEM da coluna, não pelo número do campo ────────┐
  // │ Cada campo de `_identifier_structure` vem { type, text, order }, sem │
  // │ rótulo — e o `order` é a ordem das colunas da tela "Lista de         │
  // │ equipamento". Medido no TOA em 01/11 (MAN-AFLINE, 17 atividades,     │
  // │ cliente/instalado/retirado, inclusive troca): 0 ID · 1 Tipo (invtype)│
  // │ · 2 Modelo (192) · 3 Serial (invsn) · 4 Ação (419) · 5 Serial        │
  // │ substituído (420, só na troca) · 6 Ponto (335) · 7 Local do ponto    │
  // │ (307) · 8 Quantidade. Coluna que não veio fica vazia, como na tela.  │
  // └──────────────────────────────────────────────────────────────────────┘
  const PELA_ORDEM = { 1: 'tipo', 2: 'modelo', 3: 'serial', 5: 'serial_substituido', 6: 'ponto', 7: 'local_ponto', 8: 'quantidade' }

  let camposVistos = null   // campo=ordem do inventário, para o diagnóstico (nunca valores)

  function itemDoInventario(d) {
    const est = d._identifier_structure || {}
    const item = {
      secao: SECAO[d.invpool],
      toa_item_id: d.invid != null ? String(d.invid) : '',
      tipo: '', modelo: '', serial: d.invsn != null ? String(d.invsn) : '',
      // o CÓDIGO da ação ("1" nova instalação, "2" troca), como a tela e as
      // leituras de antes gravaram; o texto ("Troca") só se faltar o código
      acao: d['419'] != null && typeof d['419'] !== 'object' ? String(d['419']) : '',
      serial_substituido: '', ponto: '', local_ponto: '',
      quantidade: d.quantity != null ? String(d.quantity) : '',
    }
    for (const v of Object.values(est)) {
      if (!v || typeof v !== 'object' || v.text == null) continue
      if (v.order === 4 && !item.acao) item.acao = String(v.text)
      const k = PELA_ORDEM[v.order]
      if (k) item[k] = String(v.text).trim()
    }
    if (!camposVistos) {
      camposVistos = Object.entries(est).map(([c, v]) => `${c}=${v && v.order}`).slice(0, 40)
    }
    return item
  }

  function lerDv() {
    const dv = window.$md && window.$md.dv
    if (!dv) return null
    try { return typeof dv === 'string' ? JSON.parse(dv) : dv } catch { return null }
  }

  async function detalheDoTecnico(tecnico, aids, dia) {
    const app = window.app
    const trust = app && typeof app.sessionManager === 'function' ? app.sessionManager().getTrustedConnectHash() : null
    const dv = lerDv()
    const login = localStorage.getItem('ulogin')
    if (!trust || !dv || !login) throw new Error('a aplicação do TOA ainda não terminou de carregar nesta aba')
    const j = conferirSessao(await direto(`m=sync&a=write&ajax=1&window_id=${Date.now()}`, {
      __protocol: 7, dv: JSON.stringify({ c: dv.c }), pid: tecnico, u: login, f: 'json',
      pids: JSON.stringify([String(tecnico)]), aids: '[]', restriction: 0, fakeIds: '{}', trust,
      fakeIdsClean: 0, dq: dia, date: dia, dispatcher: 1, skip_delta: 0,
      mandatory: { 1: aids.map(String) },
    }))
    const delta = j.delta
    if (!delta || typeof delta !== 'object') throw new Error('o TOA não devolveu os dados da atividade')
    const porAid = {}
    for (const a of Object.values(delta.Activity || {})) {
      if (a && typeof a === 'object' && a.aid != null) porAid[String(a.aid)] = { nome: a.cname != null ? String(a.cname).trim() : null, itens: [] }
    }
    // Inventário só conta para a atividade que VEIO: atividade ausente é
    // "não sei" (vai pelas telas), não "não tem equipamento".
    const veioInventario = delta.Inventory != null
    for (const d of Object.values(delta.Inventory || {})) {
      if (!d || typeof d !== 'object' || !SECAO[d.invpool]) continue   // Recurso (carga do técnico) fica fora
      const alvo = porAid[String(d.inv_aid)]
      if (alvo) alvo.itens.push(itemDoInventario(d))
    }
    return { porAid, veioInventario }
  }

  // ── o diálogo com toa.js ─────────────────────────────────────────────
  async function atender(d) {
    switch (d.op) {
      case 'pronto': {
        const app = window.app
        const temSessao = !!(app && typeof app.sessionManager === 'function' && localStorage.getItem('ulogin'))
        return { temSessao, camada: !!camada() }
      }
      case 'bucket': {
        if (typeof d.bucket !== 'string' || d.bucket.length > 80 || !DIA.test(d.dia)) throw new Error('pedido inválido')
        return atividadesDoBucket(d.bucket, d.dia)
      }
      case 'tecnico': {
        if (!NUM.test(String(d.tecnico)) || !DIA.test(d.dia) || !Array.isArray(d.aids) || !d.aids.length
            || d.aids.length > 200 || !d.aids.every((a) => NUM.test(String(a)))) throw new Error('pedido inválido')
        return detalheDoTecnico(String(d.tecnico), d.aids, d.dia)
      }
      case 'campos': return { campos: camposVistos }
      case 'arvore': return { itens: bucketsDaArvore() }
    }
    throw new Error('pedido desconhecido')
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return
    const d = ev.data
    if (!d || d.origem !== PEDIDO || typeof d.id !== 'string') return
    atender(d).then(
      (r) => window.postMessage({ origem: RESPOSTA, id: d.id, ok: true, ...r }, location.origin),
      (e) => window.postMessage({ origem: RESPOSTA, id: d.id, ok: false, erro: String((e && e.message) || e) }, location.origin),
    )
  })
})()
