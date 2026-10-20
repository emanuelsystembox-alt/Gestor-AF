import { createClient } from '@supabase/supabase-js'
import { lerPlanilhaTOA, validarPlanilha, type LinhaTOA } from '../src/lib/toa'
import { importarLinhasToa, impressaoDasLinhas, ErroImportacao } from '../src/lib/importarToaNucleo'
import { bucketDoNome, nomePadrao } from '../src/lib/toaNomes'
import { CHAVE, ESTADO_VAZIO, lerEstado, type Estado, type LinhaLog, type Pedido } from './estado'

/**
 * O fundo da extensão "AFLINE — ponte com o TOA" (0.3.0, D-193).
 *
 * ┌─ a extensão faz tudo sozinha ────────────────────────────────────┐
 * │ > "o ideal era ter um botão na extensão que instalamos e ela ler │
 * │ >  direto os dados do toa atravez do script e enviar os dados    │
 * │ >  direto para o contrato certo e banco (...) se eu sair da tela │
 * │ >  do afline manager, ela meio que para de atualizar" — Emanuel  │
 * │                                                                  │
 * │ Até a 0.2.0 quem trabalhava era a TELA Sincronismo; saiu dela,   │
 * │ parou (a primeira varredura gravou 5 contratos e se perdeu).     │
 * │ Agora o fundo da extensão: entra no Gestor AF com o login de     │
 * │ quem opera (só a SESSÃO fica guardada, nunca a senha), acorda    │
 * │ por alarme do Chrome a cada minuto, bate o pulso, baixa e importa│
 * │ pelo MESMO núcleo da importação manual (`importarToaNucleo`), e  │
 * │ comanda a varredura na aba do TOA, gravando direto no banco.     │
 * │ Funciona com a tela do Gestor AF fechada.                        │
 * │                                                                  │
 * │ Quem decide a vez, o dia e o que está vencido continua sendo o   │
 * │ servidor (113). A regra de negócio não mudou de lugar.           │
 * └──────────────────────────────────────────────────────────────────┘
 */

declare const __SUPABASE_URL__: string
declare const __SUPABASE_KEY__: string

const TOA = 'https://clarobrasil.fs.ocs.oraclecloud.com'
const VERSAO = chrome.runtime.getManifest().version
const ALARME = 'af-pulso'

// ── a sessão do Gestor AF, no armazenamento da extensão ────────────────
const armazenamento = {
  getItem: async (k: string) => ((await chrome.storage.local.get(k))[k] as string | undefined) ?? null,
  setItem: async (k: string, v: string) => { await chrome.storage.local.set({ [k]: v }) },
  removeItem: async (k: string) => { await chrome.storage.local.remove(k) },
}
const sb = createClient(__SUPABASE_URL__, __SUPABASE_KEY__, {
  auth: { storage: armazenamento, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

// ── o estado: uma fila só, para dois eventos não se atropelarem ────────
let fila: Promise<unknown> = Promise.resolve()
function mudar(f: (e: Estado) => void): Promise<Estado> {
  const p = fila.then(async () => {
    const e = await lerEstado()
    f(e)
    await chrome.storage.local.set({ [CHAVE]: e })
    return e
  })
  fila = p.catch(() => {})
  return p
}
function anotar(texto: string, tom: LinhaLog['tom'] = 'info') {
  return mudar(e => { e.log = [{ em: Date.now(), texto, tom }, ...e.log].slice(0, 40) })
}

function selo(texto: string, cor = '#c81a23', titulo?: string) {
  chrome.action.setBadgeBackgroundColor({ color: cor })
  chrome.action.setBadgeText({ text: texto })
  if (titulo) chrome.action.setTitle({ title: titulo })
}

// ── o alarme: o relógio da extensão ────────────────────────────────────
// Um pulso por minuto, como a tela fazia. O Chrome acorda o fundo para cada
// alarme mesmo com nenhuma aba do Gestor AF aberta.
async function garantirAlarme() {
  if (!(await chrome.alarms.get(ALARME))) chrome.alarms.create(ALARME, { periodInMinutes: 1, delayInMinutes: 0.1 })
}
// 0.4.0: o ícone abre o PAINEL LATERAL, fixo ao lado da página enquanto se
// navega — como o do concorrente (Emanuel, 19/10: "a nossa precisa chegar
// nesse nível"). O mesmo popup.html, agora como painel.
function painelNoIcone() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
}
chrome.runtime.onInstalled.addListener(() => { garantirAlarme(); painelNoIcone() })
chrome.runtime.onStartup.addListener(() => { garantirAlarme(); painelNoIcone() })
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARME) ciclo(false) })
garantirAlarme()
painelNoIcone()

// ── o TOA: exportar a planilha (a mesma chamada do botão Exportar) ─────
type Exportacao = { ok: true; nome: string | null; bytes: ArrayBuffer }
  | { ok: false; motivo: 'SEM_SESSAO' | 'ERRO'; mensagem: string }

async function exportar(numero: number, dia: string): Promise<Exportacao> {
  if (!Number.isInteger(numero) || numero <= 0) return { ok: false, motivo: 'ERRO', mensagem: 'Número do bucket no TOA inválido.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { ok: false, motivo: 'ERRO', mensagem: 'Dia inválido.' }
  const pedido = Math.random().toString(36).slice(2)
  const url = `${TOA}/?m=gridexport&a=download&itype=manage&providerId=${numero}`
    + `&date=${dia}&panel=top&view=time&downloadId=${pedido}&dates=${dia}&${Date.now()}`
  let r: Response
  try { r = await fetch(url, { credentials: 'include', cache: 'no-store' }) } catch (e) {
    return { ok: false, motivo: 'ERRO', mensagem: 'Sem conexão com o TOA: ' + String((e as Error)?.message ?? e) }
  }
  const bytes = await r.arrayBuffer()
  const b = new Uint8Array(bytes)
  // .xlsx é zip ("PK\x03\x04"); HTML no lugar dele é o TOA pedindo login.
  const ehPlanilha = b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
  if (!ehPlanilha) {
    const tipo = r.headers.get('content-type') || ''
    if (/html|json/i.test(tipo) || r.status === 401 || r.status === 403) {
      return { ok: false, motivo: 'SEM_SESSAO', mensagem: 'O TOA não devolveu a planilha: a sessão caiu. Entre no TOA de novo neste Chrome.' }
    }
    return { ok: false, motivo: 'ERRO', mensagem: `O TOA respondeu ${r.status} (${tipo || 'sem tipo'}), e não uma planilha.` }
  }
  const disp = r.headers.get('content-disposition') || ''
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disp) || /filename="?([^";]+)"?/i.exec(disp)
  let nome: string | null = null
  try { nome = m ? decodeURIComponent(m[1].trim()) : null } catch { nome = null }
  return { ok: true, nome, bytes }
}

// ── a cidade e quem está logado ────────────────────────────────────────
async function carregarQuemSou(): Promise<boolean> {
  const { data: { session } } = await sb.auth.getSession()
  if (!session) { await mudar(e => { e.usuario = null }); return false }
  const [{ data: p }, { data: cidades }] = await Promise.all([
    sb.from('perfil').select('id, nome, email').eq('id', session.user.id).maybeSingle(),
    sb.rpc('minhas_cidades'),
  ])
  const lista = (cidades ?? []) as { id: string; nome: string; ativa: boolean }[]
  const ativa = lista.find(c => c.ativa) ?? (lista.length === 1 ? lista[0] : null)
  await mudar(e => {
    e.usuario = { id: session.user.id, nome: (p?.nome as string) ?? null, email: (p?.email as string) ?? session.user.email ?? null }
    e.cidade = ativa ? { id: ativa.id, nome: ativa.nome } : null
  })
  return true
}

// ── o ciclo: pulso → baixa dos buckets vencidos → varredura vencida ────
interface Ordem {
  ligado: boolean; intervalo_min: number; hoje: string
  outro: { nome: string | null; visto_em: string } | null
  buckets: { id: string; nome: string; numero_toa: number; vencido: boolean; impressao: string | null }[]
}

async function travar(chave: string, minutos: number): Promise<boolean> {
  const r = await chrome.storage.session.get(chave)
  const em = r[chave] as number | undefined
  if (em && Date.now() - em < minutos * 60_000) return false
  await chrome.storage.session.set({ [chave]: Date.now() })
  return true
}
const soltar = (chave: string) => chrome.storage.session.remove(chave)

async function ciclo(forcar: boolean, modo: 'PULSO' | 'ASSUMIR' = 'PULSO') {
  const est = await lerEstado()
  if (!est.ligado) return
  if (!(await travar('trava_baixa', 15))) return
  try {
    if (!(await carregarQuemSou())) return
    const e = await lerEstado()
    if (!e.cidade) { await anotar('Sem cidade ativa no seu cadastro do Gestor AF.', 'erro'); return }
    const navegador = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[0] ?? 'Chrome'
    const { data, error } = await sb.rpc('sincronismo_pulso', {
      p_base: e.cidade.id, p_info: `extensão ${VERSAO} · ${navegador}`, p_modo: modo,
    })
    if (error) { await anotar(`Pulso recusado: ${error.message}`, 'erro'); return }
    const o = data as Ordem
    await mudar(x => {
      x.pulsoEm = Date.now(); x.servidorLigado = o.ligado; x.intervalo = o.intervalo_min
      x.vez = o.outro ? 'RESERVA' : 'ESTE'; x.reservaDe = o.outro?.nome ?? null
    })
    if (modo === 'ASSUMIR') await anotar('Este computador assumiu o sincronismo.', 'ok')
    if (o.outro || !o.ligado) return

    const fila = o.buckets.filter(b => forcar || b.vencido)
    for (const b of fila) await rodarBucket(e.cidade.id, e.usuario!.id, b, o.hoje, forcar)

    // A varredura sozinha, quando a configuração mandar.
    const { data: ve } = await sb.rpc('varredura_estado', { p_base: e.cidade.id })
    if ((ve as { vencida?: boolean } | null)?.vencida && !(await lerEstado()).varredura.rodando) await varrer()
  } catch (err) {
    await anotar(`Falha no ciclo: ${String((err as Error)?.message ?? err)}`, 'erro')
  } finally {
    await mudar(x => { x.baixa.rodando = false; x.baixa.atual = null })
    await soltar('trava_baixa')
  }
}

async function registrar(base: string, bucketId: string, dia: string, iniciada: string,
                         resultado: 'IMPORTADA' | 'SEM_MUDANCA' | 'SEM_SESSAO' | 'ERRO',
                         extra: { mensagem?: string; importacao?: string | null; impressao?: string; linhas?: number } = {}) {
  const { error } = await sb.rpc('sincronismo_registrar_rodada', {
    p_base: base, p_bucket: bucketId, p_dia: dia, p_iniciada_em: iniciada, p_resultado: resultado,
    p_mensagem: extra.mensagem ?? null, p_importacao: extra.importacao ?? null,
    p_impressao: extra.impressao ?? null, p_linhas: extra.linhas ?? null,
  })
  if (error) await anotar(`Não consegui registrar a rodada: ${error.message}`, 'erro')
}

/** Uma rodada de baixa de um bucket — o mesmo caminho da importação manual. */
async function rodarBucket(base: string, usuarioId: string, b: Ordem['buckets'][number], dia: string, forcar: boolean) {
  const iniciada = new Date().toISOString()
  const fim = async (texto: string, tom: LinhaLog['tom']) => {
    await anotar(texto, tom)
    await mudar(x => { x.baixa.ultimaEm = Date.now(); x.baixa.ultima = texto })
  }
  await mudar(x => { x.baixa.rodando = true; x.baixa.atual = `${b.nome}: baixando do TOA…` })

  const r = await exportar(b.numero_toa, dia)
  if (!r.ok) {
    await registrar(base, b.id, dia, iniciada, r.motivo, { mensagem: r.mensagem })
    if (r.motivo === 'SEM_SESSAO') {
      await mudar(x => { x.toaSessao = 'CAIU' })
      selo('!', '#b45309', 'AFLINE — a sessão do TOA caiu: entre no TOA de novo')
    }
    return fim(`${b.nome}: ${r.mensagem}`, 'erro')
  }
  await mudar(x => { x.toaSessao = 'OK' })
  chrome.action.getBadgeText({}).then(t => { if (t === '!') selo('') })

  const nome = r.nome ?? nomePadrao(b.nome, dia)
  const doNome = bucketDoNome(nome)
  if (doNome && doNome !== b.nome) {
    const msg = `O número ${b.numero_toa} no TOA é do bucket ${doNome}, não de ${b.nome}. Corrija o número no Gestor AF.`
    await registrar(base, b.id, dia, iniciada, 'ERRO', { mensagem: msg })
    return fim(msg, 'erro')
  }

  let linhas: LinhaTOA[]
  try {
    const leitura = await lerPlanilhaTOA(new File([r.bytes], nome))
    if (leitura.linhas.length === 0) {
      await registrar(base, b.id, dia, iniciada, 'SEM_MUDANCA', { mensagem: 'Planilha sem nenhuma atividade.', linhas: 0 })
      return fim(`${b.nome}: conferido — o TOA não tem atividade neste bucket hoje.`, 'info')
    }
    const problemas = validarPlanilha(leitura)
    if (problemas.length) throw new Error(problemas.join(' '))
    linhas = leitura.linhas
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    const vazia = /vazia/i.test(msg)
    await registrar(base, b.id, dia, iniciada, vazia ? 'SEM_MUDANCA' : 'ERRO',
      { mensagem: vazia ? 'Planilha sem nenhuma atividade.' : msg, linhas: vazia ? 0 : undefined })
    return fim(vazia ? `${b.nome}: conferido — o TOA não tem atividade neste bucket hoje.` : `${b.nome}: ${msg}`, vazia ? 'info' : 'erro')
  }

  const impressao = await impressaoDasLinhas(linhas)
  if (!forcar && b.impressao && b.impressao === impressao) {
    await registrar(base, b.id, dia, iniciada, 'SEM_MUDANCA', { impressao, linhas: linhas.length })
    return fim(`${b.nome}: conferido — ${linhas.length} atividades iguais à última importação; contratos em dia.`, 'ok')
  }

  try {
    const res = await importarLinhasToa(sb, {
      linhas, arquivoNome: nome, baseId: base, dia, usuarioId, origem: 'sincronismo', impressao,
      aoAvancar: (_e, n) => { mudar(x => { x.baixa.atual = `${b.nome}: importando (${n}/${linhas.length})…` }) },
    })
    await registrar(base, b.id, dia, iniciada, 'IMPORTADA', { importacao: res.importacaoId, impressao, linhas: linhas.length })
    const s = res.resumo
    return fim(`${b.nome}: importado com sucesso — ${linhas.length} atividades, ${s.criadas} novas, ${s.atualizadas} atualizadas`
      + (s.erros ? `, ${s.erros} com erro` : '')
      + (res.desatribuicao?.desatribuidos ? `; ${res.desatribuicao.desatribuidos} desatribuídos (saíram do TOA)` : '')
      + (res.desatribuicao?.devolvidos ? `; ${res.desatribuicao.devolvidos} voltaram Na entrada` : '')
      + (res.reconciliou ? '.' : '. A 2ª parte (TEC1, jornada) não terminou; a próxima rodada refaz.'),
      s.erros ? 'erro' : 'ok')
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    await registrar(base, b.id, dia, iniciada, 'ERRO', {
      mensagem: msg, importacao: e instanceof ErroImportacao ? e.importacaoId : null, linhas: linhas.length,
    })
    return fim(`${b.nome}: ${msg}`, 'erro')
  }
}

// ── a varredura: a aba do TOA lê, o fundo grava ────────────────────────
interface Pendente { aid: string; contrato: string | null; precisa_nome: boolean; precisa_equipamento: boolean }

/**
 * A aba do TOA que a varredura usa. Prefere a da JANELA DA VARREDURA
 * (0.3.2): uma janela só dela, para quem opera navegar à vontade na outra
 * sem esconder a tela que a varredura pilota (o Chrome não desenha aba
 * escondida). Sem ela, a que está no Console.
 */
async function abaDoToa(): Promise<chrome.tabs.Tab | null> {
  const abas = await chrome.tabs.query({ url: TOA + '/*' })
  const janela = (await chrome.storage.local.get('janela_varredura')).janela_varredura as number | undefined
  return abas.find(a => a.windowId === janela)
    ?? abas.find(a => /^Console de Aloca/.test(a.title || '')) ?? abas[0] ?? null
}

async function abrirJanelaDaVarredura(): Promise<{ ok: boolean; mensagem?: string }> {
  const atual = (await chrome.storage.local.get('janela_varredura')).janela_varredura as number | undefined
  if (atual) {
    try { await chrome.windows.update(atual, { focused: true, state: 'normal' }); return { ok: true } } catch { /* fechada: abre outra */ }
  }
  // 0.4.1: pequena e sem roubar o foco — "eu não queria o site aberto o
  // tempo todo" (Emanuel). Não pode ser minimizada (o Chrome para a tela),
  // mas pode ficar num canto, num segundo monitor ou atrás das outras.
  const j = await chrome.windows.create({ url: TOA + '/', type: 'normal', width: 760, height: 560, focused: false })
  await chrome.storage.local.set({ janela_varredura: j?.id })
  await anotar('Janela da varredura aberta: deixe o TOA nela, no Console de Alocação. Pode cobri-la; não minimize.', 'ok')
  return { ok: true }
}

chrome.windows.onRemoved.addListener(async id => {
  const atual = (await chrome.storage.local.get('janela_varredura')).janela_varredura
  if (atual === id) await chrome.storage.local.remove('janela_varredura')
})

async function varrer() {
  const e = await lerEstado()
  if (!e.cidade || !e.usuario) return
  // uma varredura de mais de 3 h é uma que se perdeu: libera
  if (e.varredura.rodando && e.varredura.inicio && Date.now() - e.varredura.inicio < 3 * 3600_000) {
    await anotar('Já há uma varredura em andamento.'); return
  }
  const { data, error } = await sb.rpc('varredura_pendentes', { p_base: e.cidade.id })
  if (error) { await anotar(`Varredura: ${error.message}`, 'erro'); return }
  const pend = (data ?? []) as Pendente[]
  if (!pend.length) {
    await sb.rpc('varredura_estado', { p_base: e.cidade.id, p_terminou: 'nada pendente', p_contratos: 0 })
    await anotar('Varredura: nada a varrer — todos os contratos de hoje já têm nome, e os encerrados já têm o equipamento lido.', 'ok')
    return
  }
  const aba = await abaDoToa()
  if (!aba?.id) { await anotar('Varredura: abra o TOA no Console de Alocação (bucket e dia de hoje) numa aba deste Chrome.', 'erro'); return }

  const idPedido = crypto.randomUUID()
  await chrome.storage.session.set({ varredura_contratos: Object.fromEntries(pend.map(p => [p.aid, p.contrato ?? p.aid])) })
  let r: { aceito?: boolean; mensagem?: string; bucket?: string | null } | undefined
  try {
    r = await chrome.tabs.sendMessage(aba.id, {
      tipo: 'varrer', idPedido,
      itens: pend.map(p => ({ aid: p.aid, precisa_equipamento: p.precisa_equipamento })),
    })
  } catch {
    r = { aceito: false, mensagem: 'A aba do TOA não respondeu. Recarregue a aba do TOA (F5) depois de instalar ou atualizar a extensão.' }
  }
  if (!r?.aceito) { await anotar(`Varredura não começou: ${r?.mensagem ?? 'a aba do TOA recusou.'}`, 'erro'); return }

  await mudar(x => {
    x.varredura = { ...ESTADO_VAZIO.varredura, rodando: true, idPedido, inicio: Date.now(), total: pend.length,
                    ultimaEm: x.varredura.ultimaEm, ultima: x.varredura.ultima }
  })
  selo('0%', '#c81a23', `AFLINE — varrendo o TOA: 0 de ${pend.length}`)
  await anotar(`Varredura começou: ${pend.length} contratos${r.bucket ? ` (Console em ${r.bucket})` : ''}.`)
}

interface EventoVarredura {
  tipo: 'varredura-evento'; idPedido: string; evento: 'item' | 'fim' | 'pausa' | 'retoma'
  aid?: string; feitos: number; total: number; cancelado?: boolean
  resultado?: { ok: boolean; motivo?: string; mensagem?: string; nome?: string | null; leuEquipamento?: boolean; itens?: Record<string, string>[] }
}

async function aoEventoDaVarredura(ev: EventoVarredura) {
  const e = await lerEstado()
  if (!e.cidade || ev.idPedido !== e.varredura.idPedido) return   // evento de uma varredura antiga
  const base = e.cidade.id

  // A aba do TOA escondida: o Chrome para a tela, e a varredura espera ela voltar.
  if (ev.evento === 'pausa' || ev.evento === 'retoma') {
    const pausada = ev.evento === 'pausa'
    await mudar(s => { s.varredura.pausada = pausada })
    if (pausada) selo('II', '#b45309', 'AFLINE — varredura pausada: deixe a aba do TOA à vista')
    else selo(e.varredura.total ? `${Math.floor((e.varredura.feitos / e.varredura.total) * 100)}%` : '', '#c81a23')
    await anotar(pausada ? 'Varredura pausada: a aba do TOA ficou escondida. Deixe-a à vista para continuar.' : 'Varredura retomada.')
    return
  }

  if (ev.evento === 'item' && ev.aid && ev.resultado) {
    const contratos = (await chrome.storage.session.get('varredura_contratos')).varredura_contratos as Record<string, string> | undefined
    const contrato = contratos?.[ev.aid] ?? ev.aid
    const lido = ev.resultado
    let delta = { nomes: 0, listas: 0, fora: 0, erros: 0 }
    if (!lido.ok) {
      if (lido.motivo === 'FORA_DO_CONSOLE') delta.fora = 1
      else { delta.erros = 1; await anotar(`Varredura, ${contrato}: ${lido.mensagem ?? 'erro'}`, 'erro') }
    } else {
      const { error } = await sb.rpc('registrar_varredura', {
        p_base: base, p_aid: ev.aid, p_nome: lido.nome ?? null,
        p_leu_equipamento: !!lido.leuEquipamento, p_itens: lido.itens ?? [],
      })
      if (error) { delta.erros = 1; await anotar(`Varredura, ${contrato}: não gravou — ${error.message}`, 'erro') }
      else delta = { nomes: lido.nome ? 1 : 0, listas: lido.leuEquipamento ? 1 : 0, fora: 0, erros: 0 }
    }
    const x = await mudar(s => {
      s.varredura.feitos = ev.feitos; s.varredura.total = ev.total
      s.varredura.nomes += delta.nomes; s.varredura.listas += delta.listas
      s.varredura.fora += delta.fora; s.varredura.erros += delta.erros
    })
    const pct = ev.total ? Math.floor((ev.feitos / ev.total) * 100) : 0
    selo(`${pct}%`, '#c81a23', `AFLINE — varrendo o TOA: ${x.varredura.feitos} de ${x.varredura.total}`)
    return
  }

  if (ev.evento === 'fim') {
    const v = e.varredura
    const resumo = `${v.nomes} nome(s), ${v.listas} lista(s) de equipamento`
      + (v.fora ? `; ${v.fora} fora do Console aberto` : '')
      + (v.erros ? `; ${v.erros} com erro` : '')
      + (ev.cancelado ? '; parada no meio' : '')
    await sb.rpc('varredura_estado', { p_base: base, p_terminou: resumo, p_contratos: ev.feitos })
    await mudar(s => { s.varredura.rodando = false; s.varredura.pausada = false; s.varredura.ultimaEm = Date.now(); s.varredura.ultima = resumo })
    await anotar(`Varredura terminou: ${resumo}.`, v.erros ? 'erro' : 'ok')
    selo('', '#c81a23', 'AFLINE — ponte com o TOA')
  }
}

// ── as mensagens: janelinha, aba do TOA ────────────────────────────────
let filaVarredura: Promise<unknown> = Promise.resolve()

chrome.runtime.onMessage.addListener((msg: Pedido | EventoVarredura, sender, responder) => {
  if (sender.id !== chrome.runtime.id || !msg) return false

  if (msg.tipo === 'varredura-evento') {
    if (!sender.url?.startsWith(TOA + '/')) return false
    // um de cada vez, na ordem: quem grava grava antes do próximo
    filaVarredura = filaVarredura.then(() => aoEventoDaVarredura(msg)).catch(() => {})
    return false
  }

  // daqui para baixo, só a janelinha da extensão (não tem aba)
  if (sender.tab) return false
  tratar(msg).then(responder, err => responder({ ok: false, mensagem: String((err as Error)?.message ?? err) }))
  return true
})

async function tratar(p: Pedido): Promise<{ ok: boolean; mensagem?: string }> {
  switch (p.tipo) {
    case 'entrar': {
      const { error } = await sb.auth.signInWithPassword({ email: p.email.trim(), password: p.senha })
      if (error) return { ok: false, mensagem: error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message }
      await carregarQuemSou()
      await anotar('Entrou no Gestor AF.', 'ok')
      return { ok: true }
    }
    case 'sair': {
      const e = await lerEstado()
      if (e.cidade && e.vez === 'ESTE') await sb.rpc('sincronismo_pulso', { p_base: e.cidade.id, p_modo: 'SOLTAR' })
      await sb.auth.signOut()
      await chrome.storage.local.set({ [CHAVE]: { ...ESTADO_VAZIO } })
      selo('')
      return { ok: true }
    }
    case 'ligar': {
      const e = await mudar(x => { x.ligado = p.sim })
      if (p.sim) { await anotar('Este computador vai sincronizar.', 'ok'); ciclo(false) }
      else {
        if (e.cidade && e.vez === 'ESTE') await sb.rpc('sincronismo_pulso', { p_base: e.cidade.id, p_modo: 'SOLTAR' })
        await mudar(x => { x.vez = null })
        await anotar('Este computador parou de sincronizar.')
      }
      return { ok: true }
    }
    case 'sincronizar-agora': ciclo(true); return { ok: true }
    case 'assumir': ciclo(false, 'ASSUMIR'); return { ok: true }
    case 'varrer-agora': {
      if (!(await carregarQuemSou())) return { ok: false, mensagem: 'Entre no Gestor AF primeiro.' }
      varrer(); return { ok: true }
    }
    case 'abrir-janela-toa': return abrirJanelaDaVarredura()
    case 'parar-varredura': {
      const aba = await abaDoToa()
      if (aba?.id) await chrome.tabs.sendMessage(aba.id, { tipo: 'cancelar-varredura' }).catch(() => {})
      await mudar(x => { if (x.varredura.rodando) x.varredura.rodando = false })
      selo('')
      await anotar('Varredura parada.')
      return { ok: true }
    }
  }
}
