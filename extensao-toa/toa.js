// A varredura pelas TELAS do TOA (117, D-192). Roda dentro da aba do TOA.
//
// ┌─ o que este script faz, e o que ele NÃO faz ───────────────────────┐
// │ Faz o que uma pessoa faria com o mouse, contrato por contrato, no  │
// │ Console de Alocação: clica no bloco da atividade, em "Detalhes",   │
// │ lê o Nome; clica em "Equipamento" e lê a tabela. Quem conversa com │
// │ o servidor é a própria aplicação do TOA, do jeito normal.          │
// │                                                                    │
// │ NÃO pede nada ao servidor por conta própria, NÃO copia ficha de    │
// │ segurança, NÃO clica em nada que grave (só "Detalhes",             │
// │ "Equipamento", "voltar" e o bucket na árvore — 0.5.0). Ver         │
// │ docs/11-EXTENSAO-TOA.md.                                           │
// │                                                                    │
// │ "Recurso" (a carga do técnico) não é lido — Emanuel, 19/10.        │
// └────────────────────────────────────────────────────────────────────┘

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

// ┌─ aba escondida = tela parada ──────────────────────────────────────┐
// │ O Chrome quase para uma aba que não está à vista: não desenha a    │
// │ tela e atrasa os relógios. A varredura pilota as telas de verdade  │
// │ do TOA — escondida, o TOA não termina de montar nada, e cada passo │
// │ estourava o prazo ("Não consegui voltar ao Console", "a lista não  │
// │ carregou"). Visto no 1º uso da 0.3.0 (19/10): 5 erros em 16.       │
// │ Por isso: escondida, a varredura PAUSA e avisa; volta sozinha quando│
// │ a aba aparece. E o prazo só corre com a aba à vista.               │
// └────────────────────────────────────────────────────────────────────┘
let avisarPausa = null   // definido pela varredura em andamento
let cancelado = false

async function esperarVisivel() {
  if (document.visibilityState === 'visible' || cancelado) return
  if (avisarPausa) await avisarPausa(true)
  await new Promise((r) => {
    const ver = () => {
      if (document.visibilityState === 'visible' || cancelado) {
        document.removeEventListener('visibilitychange', ver); clearInterval(t); r()
      }
    }
    document.addEventListener('visibilitychange', ver)
    const t = setInterval(ver, 2000)   // e a cada 2 s, para o "Parar" não ficar preso aqui
  })
  if (avisarPausa) await avisarPausa(false)
  await espera(800)   // a tela volta a desenhar
}

/** Espera a condição virar verdadeira (devolve o valor), ou nulo no prazo.
 *  O prazo só corre com a aba à vista: escondida, pausa (ver acima). */
async function ate(cond, max = 10000, passo = 200) {
  let gasto = 0
  while (gasto < max) {
    if (document.visibilityState !== 'visible') await esperarVisivel()
    try { const v = cond(); if (v) return v } catch { /* a tela ainda está montando */ }
    await espera(passo)
    gasto += passo
  }
  return null
}

const noConsole = () => /^Console de Aloca/.test(document.title)
const nosDetalhes = () => /^Detalhes da atividade/.test(document.title)
const naLista = () => /^Lista de equipamento/.test(document.title)

/** O cabeçalho "Console de Alocação" + subtítulo (o bucket aberto). */
function cabecalhoDoConsole() {
  const h = [...document.querySelectorAll('h1, h2, div, span')]
    .find((e) => e.children.length === 0 && e.textContent.trim() === 'Console de Alocação')
  return h ? h.parentElement : null
}

/** O bucket aberto no Console (o subtítulo do título). */
function bucketAberto() {
  const c = cabecalhoDoConsole()
  const linhas = (c ? c.innerText : '').split('\n').map((s) => s.trim()).filter(Boolean)
  return linhas[1] || null
}

const normalizar = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase()
const consoleEm = (bucket) => noConsole() && normalizar(bucketAberto()) === normalizar(bucket)

/**
 * Abre um bucket no Console clicando nele na ÁRVORE de recursos (0.5.0).
 *
 * ┌─ por que ───────────────────────────────────────────────────────────┐
 * │ > "nosso sistema de varrer não pegou dados de nenhum vt" — Emanuel  │
 * │                                                                     │
 * │ O Console mostra UM bucket. A varredura achava o contrato pelo      │
 * │ bloco na tela — com MAN-AFLINE aberto, os 56 da VT                  │
 * │ (MAN-AFLINE_01_VT) eram todos "fora do Console". Agora cada         │
 * │ contrato vem com o bucket dele (120) e o bucket é aberto como uma   │
 * │ pessoa faria: um clique no nome, na árvore à esquerda. Só           │
 * │ navegação — nada se grava. Confere pelo subtítulo do Console que    │
 * │ abriu o certo; se não abrir, avisa e segue (os contratos daquele    │
 * │ bucket ficam pendentes para a próxima varredura).                   │
 * └─────────────────────────────────────────────────────────────────────┘
 */
async function abrirBucket(bucket) {
  if (consoleEm(bucket)) return true
  if (!(await voltarAoConsole())) return false
  if (consoleEm(bucket)) return true
  const alvo = normalizar(bucket)
  const cab = cabecalhoDoConsole()
  // o nome na árvore: uma folha com exatamente esse texto, à vista, que não é o subtítulo do Console
  const item = [...document.querySelectorAll('body *')].find((e) =>
    e.children.length === 0 && normalizar(e.textContent) === alvo
    && !(cab && cab.contains(e)) && e.getClientRects().length > 0)
  if (!item) return false
  item.scrollIntoView({ block: 'center' })
  item.click()
  let ok = await ate(() => consoleEm(bucket), 8000)
  if (!ok) {
    // há árvores que escutam o clique na LINHA, não no texto
    const linha = item.closest('[role="treeitem"], li, a, button')
    if (linha && linha !== item) { linha.click(); ok = await ate(() => consoleEm(bucket), 8000) }
  }
  if (ok) await espera(2000)   // o gráfico do bucket novo termina de montar
  return !!ok
}

/** O botão "voltar" do cabeçalho do TOA (Detalhes ← Lista; Console ← Detalhes). */
function botaoVoltar() {
  return [...document.querySelectorAll('button')].find((b) =>
    /^(Console de Alocação|Detalhes da atividade)$/.test((b.getAttribute('aria-label') || b.textContent || '').trim()))
}

async function voltarAoConsole() {
  for (let i = 0; i < 4 && !noConsole(); i++) {
    const b = botaoVoltar()
    if (!b) break
    const antes = document.title
    b.click()
    await ate(() => document.title !== antes, 8000)
  }
  return noConsole()
}

/** O valor de um campo da tela "Detalhes da atividade", pelo rótulo. */
function valor(rotulo) {
  const l = [...document.querySelectorAll('.form-label-group label')].find((x) => x.textContent.trim() === rotulo)
  const v = l && l.closest('.form-text-field') && l.closest('.form-text-field').querySelector('.form-item')
  return v ? v.innerText.trim() : null
}

const SECOES = { CLIENTE: 'CLIENTE', INSTALADO: 'INSTALADO', DESINSTALADO: 'DESINSTALADO' }
const COLUNAS = {
  'ID do Equipamento': 'toa_item_id',
  'Tipo de Equipamento': 'tipo',
  'Modelo Equipamento': 'modelo',
  'Serial Equipamento Instalado': 'serial',
  'Ação': 'acao',
  'Serial Equipamento Substituído': 'serial_substituido',
  'Ponto': 'ponto',
  'Local do Ponto': 'local_ponto',
  'Quantidade': 'quantidade',
}

/** Lê a "Lista de equipamento": seções Cliente, Instalado, Desinstalado. */
function lerEquipamento() {
  const t = document.querySelector('table.table')
  if (!t) return []
  const itens = []
  let secao = null, colunas = null
  for (const tr of t.querySelectorAll('tr')) {
    const c = String(tr.className || '')
    if (c.includes('section-header')) {
      // "Instalado3" → INSTALADO; "Recurso126" → fora
      const nome = tr.innerText.trim().replace(/\s+/g, ' ').replace(/\s*\d+$/, '').toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
      secao = SECOES[nome] || null
      colunas = null
    } else if (c.includes('table-row--subheader')) {
      colunas = [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())
    } else if (secao && colunas && c.includes('table-row--desktop')) {
      const celulas = [...tr.querySelectorAll('td')].map((td) => td.innerText.trim().replace(/\s+/g, ' '))
      const item = { secao }
      colunas.forEach((nome, i) => { const k = COLUNAS[nome]; if (k) item[k] = celulas[i] || '' })
      itens.push(item)
    }
  }
  return itens
}

/** O texto do cartão (hint) aberto agora — para saber quando ele trocou. */
function textoDoCartao() {
  const link = [...document.querySelectorAll('span.hint_link')].filter((e) => e.textContent.trim() === 'Detalhes').pop()
  const cartao = link && (link.closest('[class*="hint"]:not(.hint_link):not(.hint_links_mobility)') || link.parentElement.parentElement)
  return cartao ? cartao.innerText : ''
}

/**
 * Console → bloco → cartão → Detalhes, até abrir a atividade CERTA.
 *
 * ┌─ o cartão é reaproveitado ───────────────────────────────────────┐
 * │ O TOA não cria um cartão novo a cada clique: troca o conteúdo do │
 * │ mesmo. O link "Detalhes" já existe ANTES do clique — e, clicado  │
 * │ cedo demais, abre a atividade do cartão anterior. Aconteceu no   │
 * │ teste de 19/10 (leu o equipamento de 202944209 pedindo           │
 * │ 203084123). Por isso: espera o cartão mudar, confere o ID na     │
 * │ tela de detalhes e tenta de novo uma vez, com mais calma.        │
 * └──────────────────────────────────────────────────────────────────┘
 */
async function abrirDetalhes(aid) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    if (!(await voltarAoConsole())) throw new Error('Não consegui voltar ao Console de Alocação.')
    const bloco = await ate(() => document.querySelector(`div.toaGantt-tb[aid="${CSS.escape(aid)}"]`), 4000)
    if (!bloco) return 'FORA'

    const antes = textoDoCartao()
    bloco.scrollIntoView({ block: 'center', inline: 'center' })
    bloco.click()
    // o cartão trocou (ou apareceu), e mais um fôlego para terminar de montar
    await ate(() => { const t = textoDoCartao(); return t && t !== antes }, 6000)
    await espera(tentativa ? 1500 : 600)
    const link = [...document.querySelectorAll('span.hint_link')].filter((e) => e.textContent.trim() === 'Detalhes').pop()
    if (!link) continue
    link.click()

    // Confere que abriu a atividade CERTA antes de ler qualquer coisa.
    const id = await ate(() => nosDetalhes() && valor('ID da Atividade'), 15000)
    if (id === aid) return 'OK'
  }
  throw new Error('A tela de detalhes abriu outra atividade (duas tentativas).')
}

/** Um contrato: Console → bloco → Detalhes (nome) → Equipamento (lista). */
async function processar(it) {
  // bucket que não abriu nesta varredura não é tentado de novo a cada contrato (16 s cada)
  if (it.bucket && (bucketsQueNaoAbriram.has(it.bucket) || !(await abrirBucket(it.bucket)))) {
    bucketsQueNaoAbriram.add(it.bucket)
    return { ok: false, motivo: 'SEM_BUCKET', mensagem: `Não consegui abrir o bucket ${it.bucket} na árvore do TOA. Deixe a lista de buckets (à esquerda) à vista na janela da varredura.` }
  }
  const aberto = await abrirDetalhes(it.aid)
  if (aberto === 'FORA') return { ok: false, motivo: 'FORA_DO_CONSOLE' }
  const nome = valor('Nome')

  let itens = null
  if (it.precisa_equipamento) {
    const btn = await ate(() => document.querySelector('button[data-ofsc-id="list_inventories"]'), 6000)
    if (!btn) throw new Error('O botão Equipamento não apareceu.')
    btn.click()
    // listas grandes (a seção Recurso tem 80–140 linhas) levam vários segundos no próprio TOA
    const pronto = await ate(() => naLista() && document.querySelector('table.table tr.section-header'), 25000)
    if (!pronto) throw new Error('A lista de equipamento não carregou.')
    itens = lerEquipamento()
  }
  return { ok: true, nome, leuEquipamento: it.precisa_equipamento && itens !== null, itens: itens || [] }
}

let rodando = false
const bucketsQueNaoAbriram = new Set()

async function varrer(pedido) {
  rodando = true; cancelado = false
  bucketsQueNaoAbriram.clear()
  const total = pedido.itens.length
  const avisar = (evento) => chrome.runtime.sendMessage({
    tipo: 'varredura-evento', idPedido: pedido.idPedido, abaGestor: pedido.abaGestor, total, ...evento,
  }).catch(() => {})
  let feitos = 0
  const bucketInicial = noConsole() ? bucketAberto() : null
  // escondida → 'pausa'; à vista de novo → 'retoma' (a janelinha mostra)
  avisarPausa = (sim) => avisar({ evento: sim ? 'pausa' : 'retoma', feitos })
  try {
    for (const it of pedido.itens) {
      if (cancelado) { await avisar({ evento: 'fim', feitos, cancelado: true }); return }
      let r
      await esperarVisivel()
      if (cancelado) { await avisar({ evento: 'fim', feitos, cancelado: true }); return }
      // Uma segunda tentativa antes de anotar erro: o TOA às vezes só está lento.
      try { r = await processar(it) } catch (e1) {
        try { await espera(1500); r = await processar(it) }
        catch (e) { r = { ok: false, motivo: 'ERRO', mensagem: String((e && e.message) || e) } }
      }
      feitos++
      await avisar({ evento: 'item', aid: it.aid, feitos, resultado: r })
      // Fôlego entre um contrato e outro: o TOA é usado por gente também.
      await espera(400)
    }
    await voltarAoConsole()
    // deixa o Console no bucket em que estava (quem olha a janela não se perde)
    if (bucketInicial && !consoleEm(bucketInicial)) await abrirBucket(bucketInicial).catch(() => {})
    await avisar({ evento: 'fim', feitos })
  } finally {
    rodando = false
    avisarPausa = null
  }
}

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  if (sender.id !== chrome.runtime.id || !msg) return false
  if (msg.tipo === 'varrer') {
    if (rodando) { responder({ aceito: false, mensagem: 'Esta aba do TOA já está varrendo.' }); return false }
    if (!noConsole() && !nosDetalhes() && !naLista()) {
      responder({ aceito: false, mensagem: 'Deixe a aba do TOA no Console de Alocação (bucket e dia de hoje) e tente de novo.' })
      return false
    }
    responder({ aceito: true, bucket: noConsole() ? bucketAberto() : null })
    varrer(msg)
    return false
  }
  if (msg.tipo === 'cancelar-varredura') { cancelado = true; responder({ ok: true }); return false }
  if (msg.tipo === 'toa-estado') { responder({ noConsole: noConsole(), bucket: noConsole() ? bucketAberto() : null, rodando }); return false }
  return false
})
