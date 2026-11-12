import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { lerPlanilhaTOA, validarPlanilha, type LinhaTOA } from '../src/lib/toa'
import { importarLinhasToa, impressaoDasLinhas, ErroImportacao } from '../src/lib/importarToaNucleo'
import { bucketDoNome, nomePadrao } from '../src/lib/toaNomes'
import { CHAVE, ESTADO_VAZIO, INTERVALOS, agoraManaus, fimFeito, horaValida, janelaAgora, lerEstado, type Importacao, type BucketDisponivel, type BucketFora, type Estado, type LinhaLog, type OQueVarrer, type Pedido, type VezDoBucket } from './estado'

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

// ── quem está logado ───────────────────────────────────────────────────
async function carregarQuemSou(): Promise<boolean> {
  const { data: { session } } = await sb.auth.getSession()
  if (!session) { await mudar(e => { e.usuario = null }); return false }
  const { data: p } = await sb.from('perfil').select('id, nome, email').eq('id', session.user.id).maybeSingle()
  await mudar(e => {
    e.usuario = { id: session.user.id, nome: (p?.nome as string) ?? null, email: (p?.email as string) ?? session.user.email ?? null }
    if (!e.maquina) e.maquina = crypto.randomUUID()
  })
  return true
}

/**
 * Um cliente do banco por CIDADE (0.8.0, 167, D-251).
 *
 * ┌─ por que não trocar a cidade ativa ──────────────────────────────┐
 * │ A importação inteira confere a cidade por `bases_visiveis()` — a  │
 * │ cidade ATIVA do topo do site. Trocá-la para importar outra cidade │
 * │ mudaria a tela de quem está usando o site com o mesmo login. O    │
 * │ cliente de cada cidade manda `x-afline-cidade`, e o banco só      │
 * │ honra uma cidade que a pessoa PODE ver (ADMIN: todas). A sessão é │
 * │ a mesma do `sb` — só o cabeçalho muda.                            │
 * └───────────────────────────────────────────────────────────────────┘
 */
const clientes = new Map<string, SupabaseClient>()
function naCidade(base: string): SupabaseClient {
  let c = clientes.get(base)
  if (!c) {
    c = createClient(__SUPABASE_URL__, __SUPABASE_KEY__, {
      accessToken: async () => (await sb.auth.getSession()).data.session?.access_token ?? null,
      global: { headers: { 'x-afline-cidade': base } },
    })
    clientes.set(base, c)
  }
  return c
}

// ── os buckets do login: árvore do TOA ∩ cidades do PulsoLine ─────────
async function lerArvoreDoToa(): Promise<{ numero: number; nome: string }[] | null> {
  const aba = await abaDoToa()
  if (!aba?.id) return null
  try {
    const r = await chrome.tabs.sendMessage(aba.id, { tipo: 'arvore' }) as { ok?: boolean; itens?: { numero: number; nome: string }[] } | undefined
    return r?.ok && r.itens?.length ? r.itens : null
  } catch { return null }
}

interface BucketDoLogin extends BucketDisponivel {
  vez: { minha: boolean; nome: string | null; visto_em: string; rota_min: number | null } | null
}

async function atualizarDisponiveis(): Promise<{ ok: boolean; mensagem?: string }> {
  const arvore = await lerArvoreDoToa()
  if (!arvore) {
    return { ok: false, mensagem: 'Para listar os buckets do seu login, abra o TOA numa aba deste Chrome (se acabou de atualizar a extensão, dê F5 na aba do TOA).' }
  }
  const e = await lerEstado()
  const { data, error } = await sb.rpc('sincronismo_meus_buckets', { p_arvore: arvore, p_maquina: e.maquina })
  if (error) return { ok: false, mensagem: error.message }
  const d = data as { buckets: BucketDoLogin[]; fora: BucketFora[] }
  await mudar(x => {
    x.disponiveis = {
      em: Date.now(),
      itens: d.buckets.map(({ id, nome, numero_toa, base_id, cidade }) => ({ id, nome, numero_toa, base_id, cidade })),
      fora: d.fora,
    }
    // marcado que saiu do login (bucket desligado, cidade tirada) deixa de ser marcado
    x.config.buckets = x.config.buckets.filter(id => d.buckets.some(b => b.id === id))
    // a vez de quem já sincroniza cada um, para a lista mostrar antes do 1º pulso
    const vezes: Record<string, VezDoBucket> = {}
    for (const b of d.buckets) {
      if (!b.vez) continue
      vezes[b.id] = { id: b.id, nome: b.nome, numero_toa: b.numero_toa, base_id: b.base_id, cidade: b.cidade,
                      vez: b.vez.minha, outro: b.vez.minha ? null : (b.vez.nome ?? 'outro computador'),
                      ultima: x.vezes[b.id]?.ultima ?? null }
    }
    x.vezes = vezes
  })
  return { ok: true }
}

/** Os buckets (com cidade) destes ids: do último pulso ou da última leitura da árvore. */
function infoDosBuckets(e: Estado, ids: string[]): BucketDisponivel[] {
  return ids.map((id): BucketDisponivel | undefined => e.vezes[id] ?? e.disponiveis?.itens.find(b => b.id === id))
    .filter((b): b is BucketDisponivel => !!b)
}

// ── o ciclo: pulso → baixa dos buckets vencidos → varredura vencida ────
interface OrdemBucket extends BucketDisponivel {
  vez: boolean; outro: { nome: string | null; visto_em: string } | null
  ultima: string | null; impressao: string | null
}
interface Ordem { agora: string; hoje: string; buckets: OrdemBucket[] }

async function travar(chave: string, minutos: number): Promise<boolean> {
  const r = await chrome.storage.session.get(chave)
  const em = r[chave] as number | undefined
  if (em && Date.now() - em < minutos * 60_000) return false
  await chrome.storage.session.set({ [chave]: Date.now() })
  return true
}
const soltar = (chave: string) => chrome.storage.session.remove(chave)

async function soltarBuckets() {
  const e = await lerEstado()
  if (e.maquina && e.usuario) await sb.rpc('sincronismo_soltar_buckets', { p_maquina: e.maquina })
  await mudar(x => { x.vezes = {} })
}

/** A última rodada do dia desta importação foi feita (D-374): não repete até amanhã. */
async function marcarFim(qual: Importacao, texto: string | null) {
  const { dia } = agoraManaus()
  await mudar(x => {
    const f = x.fimDoDia
    const mesma = f && f.dia === dia && f.fim === x.config.horaFim
    x.fimDoDia = { dia, fim: x.config.horaFim ?? '', feitos: [...new Set([...(mesma ? f!.feitos : []), qual])] }
  })
  if (texto) await anotar(texto, 'ok')
}

/** "Parar" pedido no painel: quem está rodando confere entre um passo e outro. */
async function pararPedido(chave: 'rota_parar' | 'portal_parar'): Promise<boolean> {
  return !!(await chrome.storage.session.get(chave))[chave]
}

/**
 * O ciclo de cada minuto. `rota`: importar a rota mesmo fora do intervalo
 * (o Iniciar do painel); sem ele, só se a rota estiver ligada e vencida.
 */
async function ciclo(rota: boolean, assumir: string[] = []) {
  const est = await lerEstado()
  if (!est.ligado) return
  if (!(await travar('trava_baixa', 15))) return
  try {
    if (!(await carregarQuemSou())) return
    const e = await lerEstado()
    if (!e.config.buckets.length) { await mudar(x => { x.pulsoEm = Date.now(); x.vezes = {} }); return }
    const navegador = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[0] ?? 'Chrome'
    const { data, error } = await sb.rpc('sincronismo_pulso_buckets', {
      p_maquina: e.maquina, p_info: `extensão ${VERSAO} · ${navegador}`, p_buckets: e.config.buckets,
      p_assumir: assumir, p_rota_min: e.config.rotaLigada ? e.config.rotaMin : null,
      p_varredura_min: e.config.varreduraLigada ? e.config.varreduraMin : null,
      p_toa_sessao: e.toaSessao,
    })
    if (error) { await anotar(`Pulso recusado: ${error.message}`, 'erro'); return }
    const o = data as Ordem
    await mudar(x => {
      x.pulsoEm = Date.now()
      x.vezes = Object.fromEntries(o.buckets.map(b => [b.id, {
        id: b.id, nome: b.nome, numero_toa: b.numero_toa, base_id: b.base_id, cidade: b.cidade,
        vez: b.vez, outro: b.vez ? null : (b.outro?.nome ?? 'outro computador'), ultima: b.ultima,
      }]))
    })
    if (assumir.length) await anotar(`Este computador assumiu ${assumir.length} bucket(s).`, 'ok')

    // O intervalo é DESTE computador; a conta usa o relógio do servidor. O
    // servidor só devolve a última rodada de HOJE (`hoje_local()`): na virada
    // do dia o bucket vence na hora, sem esperar o intervalo.
    const agora = new Date(o.agora).getTime()
    const passo = e.config.rotaMin * 60_000 - 30_000
    // 0.11.0 (D-374): fora do horário nada roda sozinho; na hora fim, a última
    // rodada de cada importação, sem esperar o intervalo. O Iniciar do painel
    // (`rota`) continua valendo a qualquer hora: quem opera decide.
    const janela = janelaAgora(e.config)
    const noHorario = janela === 'SEM_HORARIO' || janela === 'DENTRO'
    const rotaFinal = janela === 'DEPOIS' && e.config.rotaLigada && !fimFeito(e, 'ROTA')
    if (rota || rotaFinal || (e.config.rotaLigada && noHorario)) {
      const vencidos = o.buckets.filter(b => b.vez && (rota || rotaFinal || !b.ultima || agora - new Date(b.ultima).getTime() >= passo))
      if (vencidos.length) await chrome.storage.session.remove('rota_parar')
      for (const b of vencidos) {
        if (await pararPedido('rota_parar')) { await anotar('Rota: parada a pedido; os outros buckets ficaram para depois.'); break }
        // a última rodada não força reimportar a planilha IGUAL: só não espera o intervalo
        await rodarBucket(b, o.hoje, rota, e.usuario!.id)
      }
      if (rotaFinal) await marcarFim('ROTA', vencidos.length
        ? `Rota: hora fim (${e.config.horaFim}) — feita a última importação do dia.` : null)
    }

    // A varredura sozinha, no ritmo que este computador escolheu.
    const x = await lerEstado()
    const minhas = o.buckets.filter(b => b.vez).map(b => b.id)
    if (x.config.varreduraLigada && minhas.length && !x.varredura.rodando) {
      if (janela === 'DEPOIS' && !fimFeito(x, 'EQUIPAMENTOS')) {
        await marcarFim('EQUIPAMENTOS', `Equipamentos: hora fim (${x.config.horaFim}) — começando a última varredura do dia.`)
        await varrer(minhas)
      } else if (noHorario) {
        const ult = (await chrome.storage.local.get('varredura_tentativa')).varredura_tentativa as number | undefined
        if (!ult || Date.now() - ult >= x.config.varreduraMin * 60_000 - 30_000) await varrer(minhas)
      }
    }
  } catch (err) {
    await anotar(`Falha no ciclo: ${String((err as Error)?.message ?? err)}`, 'erro')
  } finally {
    await mudar(x => { x.baixa.rodando = false; x.baixa.atual = null })
    await soltar('trava_baixa')
    // o sinal do portal Claro, no ritmo DELE (0.10.0): devagar, e sem segurar o
    // ciclo — ele mesmo confere se está ligado, vencido ou em pausa
    lerPortal(false).catch(() => {})
  }
}

async function registrar(cli: SupabaseClient, base: string, bucketId: string, dia: string, iniciada: string,
                         resultado: 'IMPORTADA' | 'SEM_MUDANCA' | 'SEM_SESSAO' | 'ERRO',
                         extra: { mensagem?: string; importacao?: string | null; impressao?: string; linhas?: number } = {}) {
  const { error } = await cli.rpc('sincronismo_registrar_rodada', {
    p_base: base, p_bucket: bucketId, p_dia: dia, p_iniciada_em: iniciada, p_resultado: resultado,
    p_mensagem: extra.mensagem ?? null, p_importacao: extra.importacao ?? null,
    p_impressao: extra.impressao ?? null, p_linhas: extra.linhas ?? null,
  })
  if (error) await anotar(`Não consegui registrar a rodada: ${error.message}`, 'erro')
}

/** Uma rodada de baixa de um bucket — o mesmo caminho da importação manual, na cidade DELE. */
async function rodarBucket(b: OrdemBucket, dia: string, forcar: boolean, usuarioId: string, rotuloDia?: string) {
  // 0.9.0: num dia para trás, o log diz qual dia foi
  const nomeB = rotuloDia ? `${b.nome} (${rotuloDia})` : b.nome
  const base = b.base_id
  const cli = naCidade(base)
  const iniciada = new Date().toISOString()
  const fim = async (texto: string, tom: LinhaLog['tom']) => {
    await anotar(texto, tom)
    await mudar(x => { x.baixa.ultimaEm = Date.now(); x.baixa.ultima = texto })
  }
  await mudar(x => { x.baixa.rodando = true; x.baixa.atual = `${nomeB}: baixando do TOA…` })

  const r = await exportar(b.numero_toa, dia)
  if (!r.ok) {
    await registrar(cli, base, b.id, dia, iniciada, r.motivo, { mensagem: r.mensagem })
    if (r.motivo === 'SEM_SESSAO') {
      await mudar(x => { x.toaSessao = 'CAIU' })
      selo('!', '#b45309', 'AFLINE — a sessão do TOA caiu: entre no TOA de novo')
    }
    return fim(`${nomeB}: ${r.mensagem}`, 'erro')
  }
  await mudar(x => { x.toaSessao = 'OK' })
  chrome.action.getBadgeText({}).then(t => { if (t === '!') selo('') })

  const nome = r.nome ?? nomePadrao(b.nome, dia)
  const doNome = bucketDoNome(nome)
  if (doNome && doNome !== b.nome) {
    const msg = `O número ${b.numero_toa} no TOA é do bucket ${doNome}, não de ${nomeB}. Corrija o número no Gestor AF.`
    await registrar(cli, base, b.id, dia, iniciada, 'ERRO', { mensagem: msg })
    return fim(msg, 'erro')
  }

  let linhas: LinhaTOA[]
  try {
    const leitura = await lerPlanilhaTOA(new File([r.bytes], nome))
    if (leitura.linhas.length === 0) {
      await registrar(cli, base, b.id, dia, iniciada, 'SEM_MUDANCA', { mensagem: 'Planilha sem nenhuma atividade.', linhas: 0 })
      return fim(`${nomeB}: conferido — o TOA não tem atividade neste bucket hoje.`, 'info')
    }
    const problemas = validarPlanilha(leitura)
    if (problemas.length) throw new Error(problemas.join(' '))
    linhas = leitura.linhas
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    const vazia = /vazia/i.test(msg)
    await registrar(cli, base, b.id, dia, iniciada, vazia ? 'SEM_MUDANCA' : 'ERRO',
      { mensagem: vazia ? 'Planilha sem nenhuma atividade.' : msg, linhas: vazia ? 0 : undefined })
    return fim(vazia ? `${nomeB}: conferido — o TOA não tem atividade neste bucket hoje.` : `${nomeB}: ${msg}`, vazia ? 'info' : 'erro')
  }

  const impressao = await impressaoDasLinhas(linhas)
  if (!forcar && b.impressao && b.impressao === impressao) {
    await registrar(cli, base, b.id, dia, iniciada, 'SEM_MUDANCA', { impressao, linhas: linhas.length })
    return fim(`${nomeB}: conferido — ${linhas.length} atividades iguais à última importação; contratos em dia.`, 'ok')
  }

  try {
    const res = await importarLinhasToa(cli, {
      linhas, arquivoNome: nome, baseId: base, dia, usuarioId, origem: 'sincronismo', impressao,
      aoAvancar: (_e, n) => { mudar(x => { x.baixa.atual = `${nomeB}: importando (${n}/${linhas.length})…` }) },
      // 165: a fila da cidade — o robô espera a vez como a gente espera.
      aoEsperar: f => { mudar(x => { x.baixa.atual = `${nomeB}: na fila de ${b.cidade} (posição ${f.posicao ?? '?'}), esperando ${f.na_frente ?? 'outra importação'} terminar…` }) },
    })
    await registrar(cli, base, b.id, dia, iniciada, 'IMPORTADA', { importacao: res.importacaoId, impressao, linhas: linhas.length })
    const s = res.resumo
    return fim(`${nomeB}: importado com sucesso — ${linhas.length} atividades, ${s.criadas} novas, ${s.atualizadas} atualizadas`
      + (s.erros ? `, ${s.erros} com erro` : '')
      + (res.desatribuicao?.desatribuidos ? `; ${res.desatribuicao.desatribuidos} desatribuídos (saíram do TOA)` : '')
      + (res.desatribuicao?.devolvidos ? `; ${res.desatribuicao.devolvidos} voltaram Na entrada` : '')
      + (res.reconciliou ? '.' : '. A 2ª parte (TEC1, jornada) não terminou; a próxima rodada refaz.'),
      s.erros ? 'erro' : 'ok')
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    await registrar(cli, base, b.id, dia, iniciada, 'ERRO', {
      mensagem: msg, importacao: e instanceof ErroImportacao ? e.importacaoId : null, linhas: linhas.length,
    })
    return fim(`${nomeB}: ${msg}`, 'erro')
  }
}

// ── a varredura: a aba do TOA lê, o fundo grava ────────────────────────
const ROTULO_O_QUE: Record<OQueVarrer, string> = {
  TUDO: 'nome e equipamento', NOME: 'só nome', EQUIPAMENTO: 'só equipamento',
}
// `bucket` (120): a aba do TOA abre o bucket na árvore antes de procurar o contrato (0.5.0)
interface Pendente { aid: string; contrato: string | null; precisa_nome: boolean; precisa_equipamento: boolean; bucket: string | null }

/** Os buckets agrupados pela cidade de cada um: cada cidade, uma chamada. */
function porCidade(bs: BucketDisponivel[]): Map<string, BucketDisponivel[]> {
  const m = new Map<string, BucketDisponivel[]>()
  for (const b of bs) m.set(b.base_id, [...(m.get(b.base_id) ?? []), b])
  return m
}

/** Quanto falta nos buckets marcados, para a lista da janelinha. */
async function contarPendentes() {
  const e = await lerEstado()
  if (!e.usuario) return
  const m = new Map<string, { bucket: string; nomes: number; listas: number }>()
  for (const [base, bs] of porCidade(infoDosBuckets(e, e.config.buckets))) {
    const { data, error } = await naCidade(base).rpc('varredura_pendentes', { p_base: base, p_buckets: bs.map(b => b.nome) })
    if (error) continue
    for (const p of (data ?? []) as Pendente[]) {
      const b = p.bucket ?? ''
      const x = m.get(b) ?? { bucket: b, nomes: 0, listas: 0 }
      if (p.precisa_nome) x.nomes++
      if (p.precisa_equipamento) x.listas++
      m.set(b, x)
    }
  }
  await mudar(s => { s.pendentes = { em: Date.now(), porBucket: [...m.values()] } })
}

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

/**
 * Sem aba do TOA, a extensão abre uma — fixada e ao fundo (0.7.0, D-250).
 * O caminho direto não pilota tela: basta a aplicação do TOA carregada,
 * escondida ou não. Espera o toa.js dizer que a aplicação está pronta; se a
 * sessão caiu, a aba fica lá para a pessoa entrar.
 */
async function abaDoToaOuAbrir(): Promise<chrome.tabs.Tab | null> {
  const ja = await abaDoToa()
  if (ja) return ja
  const aba = await chrome.tabs.create({ url: TOA + '/', active: false, pinned: true })
  if (!aba.id) return null
  await anotar('Varredura: abri o TOA numa aba fixada, ao fundo. Se ela pedir login, entre nela.')
  // ~90 s: cada chamada à API do Chrome mantém o fundo acordado
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 2000))
    try {
      const r = await chrome.tabs.sendMessage(aba.id, { tipo: 'toa-estado' }) as { direto?: boolean } | undefined
      if (r?.direto) return aba
    } catch { /* a aba ainda está carregando */ }
  }
  return aba
}

/** O dia de hoje em Manaus — o mesmo `hoje_local()` do banco (registrar_varredura). */
const hojeLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus' }).format(new Date())

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

/** A varredura dos buckets `ids`, cada um na cidade dele (0.8.0). */
async function varrer(ids: string[]) {
  const e = await lerEstado()
  if (!e.usuario) return
  // uma varredura de mais de 3 h é uma que se perdeu: libera
  if (e.varredura.rodando && e.varredura.inicio && Date.now() - e.varredura.inicio < 3 * 3600_000) {
    await anotar('Já há uma varredura em andamento.'); return
  }
  await chrome.storage.local.set({ varredura_tentativa: Date.now() })
  const grupos = porCidade(infoDosBuckets(e, ids))
  if (!grupos.size) { await anotar('Varredura: marque ao menos um bucket na lista.', 'erro'); return }

  const pend: (Pendente & { base: string })[] = []
  for (const [base, bs] of grupos) {
    const { data, error } = await naCidade(base).rpc('varredura_pendentes', {
      p_base: base, p_buckets: bs.map(b => b.nome), p_o_que: e.escolha.oQue,
    })
    if (error) { await anotar(`Varredura em ${bs[0].cidade}: ${error.message}`, 'erro'); continue }
    for (const p of (data ?? []) as Pendente[]) pend.push({ ...p, base })
  }
  if (!pend.length) {
    for (const base of grupos.keys()) await naCidade(base).rpc('varredura_estado', { p_base: base, p_terminou: 'nada pendente', p_contratos: 0 })
    await anotar(e.escolha.oQue === 'TUDO'
      ? 'Varredura: nada a varrer — os contratos de hoje dos buckets marcados já têm nome, e os encerrados já têm o equipamento lido.'
      : `Varredura: nada a varrer em "${ROTULO_O_QUE[e.escolha.oQue]}".`, 'ok')
    return
  }
  const aba = await abaDoToaOuAbrir()
  if (!aba?.id) { await anotar('Varredura: não consegui abrir o TOA numa aba deste Chrome.', 'erro'); return }

  const idPedido = crypto.randomUUID()
  await chrome.storage.session.set({
    varredura_contratos: Object.fromEntries(pend.map(p => [p.aid, { contrato: p.contrato ?? p.aid, base: p.base }])),
    varredura_bases: [...grupos.keys()],
  })
  let r: { aceito?: boolean; mensagem?: string; bucket?: string | null; direto?: boolean } | undefined
  try {
    r = await chrome.tabs.sendMessage(aba.id, {
      tipo: 'varrer', idPedido, dia: hojeLocal(),
      itens: pend.map(p => ({ aid: p.aid, precisa_equipamento: p.precisa_equipamento, bucket: p.bucket })),
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
  const porBucket = new Map<string, number>()
  for (const p of pend) porBucket.set(p.bucket ?? 'sem bucket', (porBucket.get(p.bucket ?? 'sem bucket') ?? 0) + 1)
  await anotar(`Varredura começou (${ROTULO_O_QUE[e.escolha.oQue]}${r.direto ? ', direto do TOA' : ', pelas telas'}): ${pend.length} contratos (${[...porBucket].map(([b, n]) => `${b}: ${n}`).join(', ')}).`)
}

interface EventoVarredura {
  tipo: 'varredura-evento'; idPedido: string; evento: 'item' | 'fim' | 'pausa' | 'retoma'
  aid?: string; feitos: number; total: number; cancelado?: boolean
  /** 0.7.0, no 'fim': quantos vieram pelo caminho direto, por que o resto não
   *  veio, e os campos do inventário que o TOA mandou (só nomes — diagnóstico). */
  diretos?: number; motivos?: string[]; campos?: string[] | null
  resultado?: { ok: boolean; motivo?: string; mensagem?: string; nome?: string | null; leuEquipamento?: boolean; itens?: Record<string, string>[] }
}

const avisosDeBucket = new Set<string>()

async function aoEventoDaVarredura(ev: EventoVarredura) {
  const e = await lerEstado()
  if (!e.usuario || ev.idPedido !== e.varredura.idPedido) return   // evento de uma varredura antiga

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
    const contratos = (await chrome.storage.session.get('varredura_contratos')).varredura_contratos as Record<string, { contrato: string; base: string }> | undefined
    const alvo = contratos?.[ev.aid]
    const contrato = alvo?.contrato ?? ev.aid
    const lido = ev.resultado
    let delta = { nomes: 0, listas: 0, fora: 0, erros: 0 }
    if (!lido.ok) {
      if (lido.motivo === 'FORA_DO_CONSOLE') delta.fora = 1
      else if (lido.motivo === 'SEM_BUCKET' || lido.motivo === 'SEM_DIRETO') {
        // o mesmo recado para todos os contratos do bucket: anota uma vez só
        delta.erros = 1
        const chave = `${ev.idPedido}|${lido.mensagem}`
        if (!avisosDeBucket.has(chave)) { avisosDeBucket.add(chave); await anotar(`Varredura: ${lido.mensagem}`, 'erro') }
      } else { delta.erros = 1; await anotar(`Varredura, ${contrato}: ${lido.mensagem ?? 'erro'}`, 'erro') }
    } else if (!alvo) {
      delta.erros = 1; await anotar(`Varredura, ${contrato}: não sei de que cidade é — não gravou.`, 'erro')
    } else {
      const { error } = await naCidade(alvo.base).rpc('registrar_varredura', {
        p_base: alvo.base, p_aid: ev.aid, p_nome: lido.nome ?? null,
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
    const telas = ev.feitos - (ev.diretos ?? 0) - v.erros - v.fora
    const resumo = `${v.nomes} nome(s), ${v.listas} lista(s) de equipamento`
      + (ev.diretos != null ? ` (${ev.diretos} direto do TOA${telas > 0 ? `, ${telas} pelas telas` : ''})` : '')
      + (v.fora ? `; ${v.fora} fora do Console aberto` : '')
      + (v.erros ? `; ${v.erros} com erro` : '')
      + (ev.cancelado ? '; parada no meio' : '')
    if (ev.motivos?.length) await anotar(`Varredura, caminho direto: ${ev.motivos.join('; ')}`, 'erro')
    // os campos do inventário, uma vez por versão: acusam se a Oracle mudar
    if (ev.campos?.length) {
      const visto = (await chrome.storage.local.get('campos_inventario')).campos_inventario
      if (visto !== VERSAO) {
        await chrome.storage.local.set({ campos_inventario: VERSAO })
        await anotar(`Campos do inventário no TOA: ${ev.campos.join(', ')}`)
      }
    }
    // o histórico de cada cidade varrida ganha a rodada (118)
    const bases = ((await chrome.storage.session.get('varredura_bases')).varredura_bases as string[] | undefined) ?? []
    for (const base of bases) await naCidade(base).rpc('varredura_estado', { p_base: base, p_terminou: resumo, p_contratos: ev.feitos })
    await mudar(s => { s.varredura.rodando = false; s.varredura.pausada = false; s.varredura.ultimaEm = Date.now(); s.varredura.ultima = resumo })
    await anotar(`Varredura terminou: ${resumo}.`, v.erros ? 'erro' : 'ok')
    selo('', '#c81a23', 'AFLINE — ponte com o TOA')
    await contarPendentes()   // a lista mostra o que sobrou
  }
}

// ── o Portal Técnico da Claro: o sinal antes/depois (0.9.0, 222, D-330) ─
/*
 * ┌─ o que é e o que não é ──────────────────────────────────────────┐
 * │ > "quero mostrar em cada contrato, se os niveis estão regular ou │
 * │ >  irregulares, antes e depois da visita" — Emanuel, 06/11       │
 * │                                                                  │
 * │ O Portal Gestor da Claro (Timeline de falhas) lê a API           │
 * │ prd-worker-mangerportal com o COOKIE do login da Claro: sem ele, │
 * │ 401. A extensão faz o mesmo GET, com o login aberto neste Chrome,│
 * │ junto com a rota. SÓ LEITURA: nunca o "new-measurement" (na AWS),│
 * │ que dispara medição nova no equipamento do cliente.              │
 * │                                                                  │
 * │ O filtro da lista é o login do LÍDER no portal — quem informa é a│
 * │ aba do portal (portal-claro.js lê o "User" dela). Nome e endereço│
 * │ do assinante não saem daqui: só vão os campos de CAMPOS_PORTAL.  │
 * │ O detalhe por equipamento (os níveis) é um pedido por O.S.: só se│
 * │ pede o que mudou desde a última leitura, ou que ficou velho.      │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * ┌─ no ritmo de uma pessoa (0.10.0, D-342) ─────────────────────────┐
 * │ Na frente do portal há um firewall da Claro (FortiWeb). Em 08/11 │
 * │ ele bloqueou o IP de onde a extensão lia ("Web Page Blocked",    │
 * │ Attack ID 20000046) — e com o IP, o celular e o PC de quem usava │
 * │ a mesma internet. A 0.9.0 pedia a lista e logo o detalhe de TODAS│
 * │ as 95 O.S., 4 de cada vez, sem pausa: ~100 pedidos em segundos, a│
 * │ cada login, a cada "Ler o portal", a cada virada de dia. A regra │
 * │ exata é da Claro e não a conhecemos; o que está aqui é pedir como│
 * │ quem clica:                                                       │
 * │  • um pedido por vez, PORTAL_PAUSA_MS entre um e outro;          │
 * │  • no máximo PORTAL_TETO detalhes por rodada — o resto fica para │
 * │    a próxima, e a memória (por dia) sabe o que já foi lido;      │
 * │  • "ler agora" não relê o que não mudou; o login no portal não   │
 * │    dispara leitura nenhuma;                                       │
 * │  • bloqueio ou resposta vazia → para NA HORA e não pede nada até │
 * │    `pausaAte`: insistir estende o bloqueio.                       │
 * │ Não se disfarça nada (navegador, IP): é a nossa carga que diminui.│
 * └──────────────────────────────────────────────────────────────────┘
 */
const PORTAL = 'https://portaltecnico.clarobrasil.mobi'
const PORTAL_API = 'https://prd-worker-mangerportal.clarobrasil.mobi/v1'
const CAMPOS_PORTAL = ['id', 'osNumber', 'workOrderCode', 'operatorCode', 'initialDiagnosis', 'validationDiagnosis',
  'pnmDiagnosis', 'osStatus', 'attendingType', 'technologyType', 'technicianLogin', 'workOrderStatus', 'updatedAt'] as const
/** Detalhe já lido que não mudou só é relido depois disso. */
const DETALHE_VELHO_MS = 4 * 3600_000
/** Entre um pedido e outro ao portal. Escolha nossa, não regra conhecida da Claro.
 *  0.10.2: 9 s — *"8 a 10 seg por contrato (...) não me importo que demore 2 a 5
 *  minutos, desde que eu não seja bloqueado"* (Emanuel, 08/11). 30 × 9 s ≈ 4,5 min.
 *  Fixo, de propósito: é para pedir menos, não para parecer gente. */
const PORTAL_PAUSA_MS = 9000
/** Detalhes (níveis) por rodada; o resto fica para a próxima. */
const PORTAL_TETO = 30
/** O firewall mostrou a página de bloqueio: não pedir nada por este tempo. */
const PORTAL_BLOQUEIO_MS = 3 * 3600_000
/** O portal não respondeu (conexão cortada, resposta vazia). */
const PORTAL_FALHA_MS = 30 * 60_000
/** Quantos dias de memória do que já foi lido. */
const PORTAL_MEMORIA_DIAS = 7

interface Rotulo { type?: number; text?: string; color?: string }
interface ItemPortal {
  id: number; osNumber?: string; updatedAt?: string
  initialDiagnosis?: Rotulo; validationDiagnosis?: Rotulo; osStatus?: Rotulo
  equipamentos?: unknown[]
  [k: string]: unknown
}

type RespostaPortal =
  | { tipo: 'OK'; json: unknown }
  | { tipo: 'SESSAO'; status: number }
  /** a página "Web Page Blocked" do firewall da Claro */
  | { tipo: 'BLOQUEIO'; status: number }
  /** sem resposta: conexão cortada, resposta vazia, rede fora */
  | { tipo: 'FALHA'; mensagem: string }
  | { tipo: 'ERRO'; status: number }

async function pedirAoPortal(caminho: string): Promise<RespostaPortal> {
  let r: Response
  try { r = await fetch(PORTAL_API + caminho, { credentials: 'include', cache: 'no-store' }) } catch (e) {
    return { tipo: 'FALHA', mensagem: String((e as Error)?.message ?? e) }
  }
  const texto = await r.text().catch(() => '')
  // o firewall responde HTML com "blocked" (e o Attack ID) — em qualquer código
  if (/web page blocked|url you requested has been blocked|attack id/i.test(texto)) return { tipo: 'BLOQUEIO', status: r.status }
  if (r.status === 401 || r.status === 403) return { tipo: 'SESSAO', status: r.status }
  if (!r.ok) return { tipo: 'ERRO', status: r.status }
  try { return { tipo: 'OK', json: JSON.parse(texto) } } catch { return { tipo: 'ERRO', status: r.status } }
}

/**
 * O que, mudando, pede o detalhe de novo: a classificação Antes/Depois e o
 * status da O.S. Até a 0.10.0 entrava o `updatedAt`, que muda a cada passo
 * do técnico — e o detalhe era relido sem medição nova. Medido em 08/11: as
 * 68 finalizadas de 07/11 não mudaram depois de lidas (D-342).
 */
const impressaoPortal = (i: ItemPortal) =>
  ['v2', i.initialDiagnosis?.type, i.validationDiagnosis?.type, i.osStatus?.type].join('|')
/** Compara com o que foi guardado — inclusive no formato da 0.10.0
 *  (`updatedAt|inicial|validação|status`), para a troca não reler tudo. */
function mesmaImpressao(guardada: string, i: ItemPortal): boolean {
  const nova = impressaoPortal(i)
  if (guardada.startsWith('v2|')) return guardada === nova
  return guardada.split('|').slice(1).join('|') === nova.split('|').slice(1).join('|')
}
/** Finalizada ou cancelada: o que já foi lido dela não se relê sem mudança. */
const encerradaNoPortal = (i: ItemPortal) => /finaliz|cancel/i.test(i.osStatus?.text ?? '')
/** "Pendente" nos dois: costuma não ter medição (22 de 31 vazias, 08/11) — vai por último, não sai. */
const pendenteNosDois = (i: ItemPortal) => i.initialDiagnosis?.type === 1 && i.validationDiagnosis?.type === 1

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))

/** `sem`: lido, mas a O.S. não tinha contrato no dia — tenta de novo a cada 4 h
 *  (o contrato pode entrar numa importação depois). */
type Memoria = Record<string, { imp: string; em: number; sem?: boolean }>

/** As O.S. do dia que já têm os níveis no BANCO (232). Nulo se não deu para
 *  perguntar (função ainda não aplicada, sem rede): fica só a memória. */
async function jaLidosNoBanco(dia: string): Promise<Set<string> | null> {
  const { data, error } = await sb.rpc('sinal_claro_ja_lidos', { p_dia: dia })
  if (error || !Array.isArray(data)) return null
  return new Set((data as (number | string)[]).map(String))
}
/** A memória do que já foi lido, por DIA (a 0.9.0 só guardava hoje, e um
 *  dia para trás relia as ~100 O.S. de uma vez). */
async function memoriaDoPortal(): Promise<Record<string, Memoria>> {
  const g = await chrome.storage.local.get('portal_memoria')
  return (g.portal_memoria as Record<string, Memoria> | undefined) ?? {}
}

/**
 * Uma rodada de leitura do portal. `agora`: o Iniciar do painel — lê já,
 * fora do intervalo, mesmo com a leitura automática parada. Não relê o que
 * não mudou, e não passa por cima da pausa (quem tira é o "retomar").
 */
async function lerPortal(agora: boolean, diaPedido?: string) {
  const e = await lerEstado()
  if (!e.ligado || !e.usuario || !e.portal.login) return
  if (e.portal.pausaAte) {
    if (Date.now() < e.portal.pausaAte) return
    // a pausa venceu: some do painel e do ícone
    await mudar(x => { x.portal.pausaAte = null; x.portal.pausaMotivo = null })
    chrome.action.getBadgeText({}).then(t => { if (t === 'II') selo('') })
  }
  // 0.11.0 (D-374): fora do horário, só a última leitura da hora fim
  const janela = janelaAgora(e.config)
  const final = !agora && e.config.portalLigado && janela === 'DEPOIS' && !fimFeito(e, 'NIVEIS')
  if (!agora && !final && (!e.config.portalLigado || janela === 'ANTES' || janela === 'DEPOIS'
      || (e.portal.ultimaEm && Date.now() - e.portal.ultimaEm < e.config.portalMin * 60_000 - 30_000))) return
  if (!(await travar('trava_portal', 15))) return
  if (final) await marcarFim('NIVEIS', `Portal Claro: hora fim (${e.config.horaFim}) — começando a última leitura do dia.`)
  await chrome.storage.session.remove('portal_parar')
  const login = e.portal.login
  // Só HOJE sozinho; um dia para trás, só pelo Iniciar com o dia escolhido.
  // (Uma revisão automática de ontem foi oferecida e recusada — Emanuel, 08/11.)
  const dia = diaPedido ?? hojeLocal()
  // dia para trás: a leitura do relógio (`ultimaEm`) continua sendo a de hoje
  const deHoje = dia === hojeLocal()
  await mudar(x => { x.portal.rodando = true; x.portal.feitos = 0; x.portal.total = 0 })
  const fim = async (texto: string, tom: LinhaLog['tom']) => {
    const t = deHoje ? texto : `${dia.slice(8, 10)}/${dia.slice(5, 7)}: ${texto}`
    await anotar(`Portal Claro: ${t}`, tom)
    await mudar(x => { if (deHoje) x.portal.ultimaEm = Date.now(); x.portal.ultima = t })
  }
  /** Bloqueio ou silêncio: para tudo e não pede nada até a hora. */
  const pausar = async (r: Extract<RespostaPortal, { tipo: 'BLOQUEIO' | 'FALHA' }>) => {
    const bloqueio = r.tipo === 'BLOQUEIO'
    const ate = Date.now() + (bloqueio ? PORTAL_BLOQUEIO_MS : PORTAL_FALHA_MS)
    const motivo = bloqueio
      ? 'o firewall da Claro bloqueou o acesso (Web Page Blocked)'
      : 'o portal não respondeu (conexão cortada)'
    const hhmm = new Date(ate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    await mudar(x => { x.portal.pausaAte = ate; x.portal.pausaMotivo = motivo })
    selo('II', '#b45309', `AFLINE — portal Claro em pausa até ${hhmm}`)
    return fim(`${motivo}. Parei e não peço nada até ${hhmm} — insistir estende o bloqueio.`, 'erro')
  }
  try {
    // 1. a lista do dia, página a página
    const lidos: ItemPortal[] = []
    for (let p = 0; p < 20; p++) {
      if (p > 0) await esperar(PORTAL_PAUSA_MS)
      const r = await pedirAoPortal(`/workorder?date=${dia}&filter=${encodeURIComponent(login)}&size=50&page=${p}`)
      if (r.tipo === 'BLOQUEIO' || r.tipo === 'FALHA') return pausar(r)
      if (r.tipo === 'SESSAO') {
        await mudar(x => { x.portal.sessao = 'CAIU' })
        return fim('a sessão caiu. Entre no Portal Técnico da Claro de novo neste navegador.', 'erro')
      }
      if (r.tipo === 'ERRO') return fim(`o portal respondeu ${r.status}.`, 'erro')
      const j = r.json as { content?: ItemPortal[]; totalPages?: number }
      lidos.push(...(j.content ?? []))
      if (p >= (j.totalPages ?? 1) - 1) break
    }
    await mudar(x => { x.portal.sessao = 'OK' })
    if (!lidos.length) return fim(`nenhuma O.S. no dia para ${login}.`, 'info')

    // só os campos de medição e de cruzamento — nada do assinante
    const itens = lidos.map(i => Object.fromEntries(CAMPOS_PORTAL.map(k => [k, i[k]])) as ItemPortal)

    // 2. os níveis: o que mudou → o nunca lido → o nunca lido "Pendente" nos
    //    dois → o aberto lido há muito tempo. Encerrada sem mudança: nunca.
    //    No máximo PORTAL_TETO, um por vez.
    //    "Já lido" = na memória deste navegador OU com nível no banco (232):
    //    nenhum contrato fica sem nível porque a memória se perdeu.
    const memorias = await memoriaDoPortal()
    const memoria: Memoria = memorias[dia] ?? {}
    const noBanco = await jaLidosNoBanco(dia)
    const t0 = Date.now()
    const ordem = (i: ItemPortal) => {
      const m = memoria[i.id]
      if (m?.sem) return t0 - m.em > DETALHE_VELHO_MS ? 4 : -1
      if (m && !mesmaImpressao(m.imp, i)) return 0
      if (!m) {
        if (noBanco?.has(String(i.id))) return -1   // já gravado; muda → a impressão pega depois
        return pendenteNosDois(i) ? 2 : 1
      }
      if (encerradaNoPortal(i)) return -1
      return t0 - m.em > DETALHE_VELHO_MS ? 3 : -1
    }
    const fila = itens.map(i => ({ i, o: ordem(i) })).filter(x => x.o >= 0).sort((a, b) => a.o - b.o).map(x => x.i)
    const pedir = fila.slice(0, PORTAL_TETO)
    await mudar(x => { x.portal.total = pedir.length })
    let lidosAgora = 0, falhas = 0, parou: string | null = null
    for (const i of pedir) {
      if (await pararPedido('portal_parar')) { parou = 'parada a pedido'; break }
      await esperar(PORTAL_PAUSA_MS)
      const r = await pedirAoPortal(`/workorder/${i.id}/equipment`)
      if (r.tipo === 'BLOQUEIO' || r.tipo === 'FALHA') {
        // grava o que já veio antes de parar (o banco guarda os níveis lidos)
        await gravarSinal(dia, itens, memoria, memorias)
        return pausar(r)
      }
      if (r.tipo === 'SESSAO') { await mudar(x => { x.portal.sessao = 'CAIU' }); parou = 'a sessão caiu'; break }
      if (r.tipo === 'OK' && Array.isArray(r.json)) { i.equipamentos = r.json; lidosAgora++ } else falhas++
      await mudar(x => { x.portal.feitos = lidosAgora + falhas })
    }

    // 3. grava (todos: a lista é barata; os níveis só de quem foi lido)
    const g = await gravarSinal(dia, itens, memoria, memorias)
    if (typeof g === 'string') return fim(`não gravou — ${g}`, 'erro')
    const faltam = fila.length - lidosAgora
    return fim(`${itens.length} O.S. de ${login}, ${g.gravados} ligadas a contratos`
      + (g.semContrato ? `, ${g.semContrato} sem contrato no dia` : '')
      + `; níveis lidos de ${lidosAgora}` + (falhas ? ` (${falhas} falharam)` : '')
      + (faltam > 0 ? `; faltam ${faltam}, ficam para a próxima rodada` : '')
      + (parou ? ` — ${parou}` : '') + '.',
      g.semContrato || falhas || parou ? 'info' : 'ok')
  } catch (err) {
    return fim(`falhou — ${String((err as Error)?.message ?? err)}`, 'erro')
  } finally {
    await mudar(x => { x.portal.rodando = false })
    await soltar('trava_portal')
  }
}

/** Grava o dia no banco em lotes e atualiza a memória. Erro → a mensagem. */
async function gravarSinal(dia: string, itens: ItemPortal[], memoria: Memoria, memorias: Record<string, Memoria>)
  : Promise<{ gravados: number; semContrato: number } | string> {
  let gravados = 0, semContrato = 0
  const sem = new Set<string>()
  for (let k = 0; k < itens.length; k += 40) {
    const { data, error } = await sb.rpc('registrar_sinal_claro', { p_dia: dia, p_itens: itens.slice(k, k + 40) })
    if (error) return error.message
    const d = data as { gravados: number; sem_contrato: number; sem_contrato_os: string[] }
    gravados += d.gravados; semContrato += d.sem_contrato
    for (const os of d.sem_contrato_os ?? []) sem.add(os)
  }
  // quem não achou contrato fica marcado `sem` e pede o detalhe de novo em 4 h
  // (antes era a cada rodada: 7 pedidos por hora à toa em 07/11)
  const agora = Date.now()
  for (const i of itens) {
    if (i.equipamentos) {
      memoria[i.id] = sem.has(String(i.osNumber ?? ''))
        ? { imp: impressaoPortal(i), em: agora, sem: true }
        : { imp: impressaoPortal(i), em: agora }
    }
  }
  const dias = Object.keys({ ...memorias, [dia]: memoria }).sort().slice(-PORTAL_MEMORIA_DIAS)
  const guardar = Object.fromEntries(dias.map(d => [d, d === dia ? memoria : memorias[d]]))
  await chrome.storage.local.set({ portal_memoria: guardar })
  await chrome.storage.local.remove(['portal_detalhe', 'portal_detalhe_dia'])   // a da 0.9.0
  return { gravados, semContrato }
}

// ── um dia para trás (0.9.0) ───────────────────────────────────────────
/*
 * > "deve ter um sistema de seletor de data, pra eu querer atualizar a
 * >  importação de outro dia para trás" — Emanuel, 06/11
 *
 * O dia de atuação é escolha de quem importa (D-166): aqui a pessoa escolhe,
 * e o arquivo do TOA daquele dia entra NAQUELE dia — o mesmo caminho da
 * importação manual com outra data. Só os buckets marcados neste computador,
 * na cidade de cada um; depois, o sinal do portal do mesmo dia. Usa a mesma
 * trava da rota: um dia por vez, sem atropelar a rodada de hoje.
 */
const DIAS_PARA_TRAS = 31
function diaValido(dia: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false
  const hoje = hojeLocal()
  if (dia > hoje) return false
  const [a, m, d] = hoje.split('-').map(Number)
  const x = new Date(Date.UTC(a, m - 1, d - DIAS_PARA_TRAS))
  const min = `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`
  return dia >= min
}

async function rodarDia(dia: string) {
  if (!(await travar('trava_baixa', 15))) { await anotar('Já há uma rodada em andamento: tente de novo em instantes.'); return }
  const rotulo = `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
  try {
    if (!(await carregarQuemSou())) return
    const e = await lerEstado()
    const bs = infoDosBuckets(e, e.config.buckets)
    // 0.10.0: só a rota — os níveis do dia têm o Iniciar deles (D-342)
    await anotar(`Rota do dia ${rotulo}: ${bs.length} bucket(s).`)
    await chrome.storage.session.remove('rota_parar')
    for (const b of bs) {
      if (await pararPedido('rota_parar')) { await anotar(`Rota do dia ${rotulo}: parada a pedido.`); break }
      await rodarBucket({ ...b, vez: true, outro: null, ultima: null, impressao: null }, dia, true, e.usuario!.id, rotulo)
    }
  } catch (err) {
    await anotar(`Dia ${rotulo}: ${String((err as Error)?.message ?? err)}`, 'erro')
  } finally {
    await mudar(x => { x.baixa.rodando = false; x.baixa.atual = null })
    await soltar('trava_baixa')
  }
}

// ── as mensagens: janelinha, aba do TOA ────────────────────────────────
let filaVarredura: Promise<unknown> = Promise.resolve()

interface LoginDoPortal { tipo: 'portal-claro-login'; login: unknown; nome: string | null }

chrome.runtime.onMessage.addListener((msg: Pedido | EventoVarredura | LoginDoPortal, sender, responder) => {
  if (sender.id !== chrome.runtime.id || !msg) return false

  if (msg.tipo === 'varredura-evento') {
    if (!sender.url?.startsWith(TOA + '/')) return false
    // um de cada vez, na ordem: quem grava grava antes do próximo
    filaVarredura = filaVarredura.then(() => aoEventoDaVarredura(msg)).catch(() => {})
    return false
  }

  // 0.9.0: a aba do Portal Técnico da Claro diz qual é o login do líder
  if (msg.tipo === 'portal-claro-login') {
    if (!sender.url?.startsWith(PORTAL + '/')) return false
    const login = typeof msg.login === 'string' && /^[A-Z]\d{4,9}$/i.test(msg.login) ? msg.login.toUpperCase() : null
    if (!login) return false
    lerEstado().then(async e => {
      if (e.portal.login === login && e.portal.sessao !== 'CAIU') return
      await mudar(x => { x.portal.login = login; x.portal.nome = msg.nome ?? null; x.portal.sessao = null })
      await anotar(`Portal Claro: login ${login} ligado a este computador.`, 'ok')
      // 0.10.0 (D-342): entrar no portal NÃO dispara leitura — a 0.9.0 lia as
      // ~100 O.S. logo depois do login, que é quando o firewall está de olho.
      // A próxima rodada (ou o Iniciar) lê, no ritmo de uma pessoa.
    })
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
      atualizarDisponiveis().then(r => { if (!r.ok && r.mensagem) anotar(r.mensagem) })
      return { ok: true }
    }
    case 'sair': {
      await soltarBuckets().catch(() => {})
      await sb.auth.signOut()
      // o computador e a configuração dele ficam: são DESTE computador
      const e = await lerEstado()
      await chrome.storage.local.set({ [CHAVE]: { ...ESTADO_VAZIO, maquina: e.maquina, config: e.config } })
      selo('')
      return { ok: true }
    }
    case 'ligar': {
      await mudar(x => { x.ligado = p.sim })
      if (p.sim) { await anotar('Este computador vai sincronizar.', 'ok'); ciclo(false) }
      else { await soltarBuckets(); await anotar('Este computador parou de sincronizar (os buckets ficaram livres para outro).') }
      return { ok: true }
    }
    case 'configurar': {
      const c = p.config
      for (const k of ['rotaMin', 'varreduraMin', 'portalMin'] as const) {
        if (c[k] !== undefined && !INTERVALOS.includes(c[k]!)) return { ok: false, mensagem: 'Intervalo inválido.' }
      }
      if (c.portalMin !== undefined && c.portalMin < 15) return { ok: false, mensagem: 'O portal da Claro: no mínimo a cada 15 min.' }
      for (const k of ['horaInicio', 'horaFim'] as const) {
        if (c[k] !== undefined && c[k] !== null && !horaValida(c[k])) return { ok: false, mensagem: 'Hora inválida.' }
      }
      const e = await lerEstado()
      const novo = { ...e.config }
      if (c.horaInicio !== undefined) novo.horaInicio = c.horaInicio
      if (c.horaFim !== undefined) novo.horaFim = c.horaFim
      if (novo.horaInicio && novo.horaFim && novo.horaInicio >= novo.horaFim) {
        return { ok: false, mensagem: 'A hora início tem de ser antes da hora fim.' }
      }
      if (c.rotaMin !== undefined) novo.rotaMin = c.rotaMin
      if (c.varreduraMin !== undefined) novo.varreduraMin = c.varreduraMin
      if (c.portalMin !== undefined) novo.portalMin = c.portalMin
      if (c.buckets !== undefined) {
        const conhecidos = new Set([...(e.disponiveis?.itens ?? []).map(b => b.id), ...Object.keys(e.vezes)])
        novo.buckets = [...new Set(c.buckets)].filter(id => conhecidos.has(id))
      }
      await mudar(x => { x.config = novo })
      if (e.ligado) ciclo(false)
      return { ok: true }
    }
    // 0.10.0 (D-342): o menu Importar — cada importação com o seu Iniciar e Parar
    case 'iniciar': {
      const e = await lerEstado()
      if (!e.ligado) return { ok: false, mensagem: 'Ligue "Sincronizar por este computador" em Configuração.' }
      if (!diaValido(p.dia)) return { ok: false, mensagem: `Escolha um dia entre hoje e ${DIAS_PARA_TRAS} dias atrás.` }
      const hoje = p.dia === hojeLocal()
      if (p.oQue === 'ROTA') {
        if (!e.config.buckets.length) return { ok: false, mensagem: 'Marque ao menos um bucket em Configuração.' }
        // hoje: liga a automática e importa já; outro dia: importa aquele dia, uma vez
        if (hoje) { await mudar(x => { x.config.rotaLigada = true }); ciclo(true) } else rodarDia(p.dia)
        return { ok: true }
      }
      if (p.oQue === 'EQUIPAMENTOS') {
        // a varredura é dos contratos de HOJE (varredura_pendentes / hoje_local)
        if (!hoje) return { ok: false, mensagem: 'Equipamentos só se leem do dia de hoje.' }
        if (!e.config.buckets.length) return { ok: false, mensagem: 'Marque ao menos um bucket em Configuração.' }
        if (!(await carregarQuemSou())) return { ok: false, mensagem: 'Entre no Gestor AF primeiro.' }
        await mudar(x => { x.config.varreduraLigada = true })
        varrer(e.config.buckets)
        return { ok: true }
      }
      // NIVEIS
      if (!e.portal.login) return { ok: false, mensagem: 'Abra o Portal Técnico da Claro numa aba deste navegador, já logado.' }
      if (e.portal.pausaAte && Date.now() < e.portal.pausaAte) {
        return { ok: false, mensagem: 'O portal está em pausa pelo bloqueio da Claro. Use "Retomar" se quiser tentar antes da hora.' }
      }
      if (hoje) await mudar(x => { x.config.portalLigado = true })
      lerPortal(true, p.dia)
      return { ok: true }
    }
    case 'parar': {
      if (p.oQue === 'ROTA') {
        await chrome.storage.session.set({ rota_parar: true })
        await mudar(x => { x.config.rotaLigada = false })
        await anotar('Rota parada: não importa mais sozinha (o bucket em andamento termina).')
      } else if (p.oQue === 'EQUIPAMENTOS') {
        await mudar(x => { x.config.varreduraLigada = false })
        const e = await lerEstado()
        if (e.varredura.rodando) return tratar({ tipo: 'parar-varredura' })
        await anotar('Equipamentos parados: a varredura não roda mais sozinha.')
      } else {
        await chrome.storage.session.set({ portal_parar: true })
        await mudar(x => { x.config.portalLigado = false })
        await anotar('Níveis parados: o portal da Claro não é mais lido sozinho.')
      }
      return { ok: true }
    }
    case 'retomar-portal': {
      await mudar(x => { x.portal.pausaAte = null; x.portal.pausaMotivo = null })
      chrome.action.getBadgeText({}).then(t => { if (t === 'II') selo('') })
      await anotar('Portal Claro: pausa tirada a pedido.')
      return { ok: true }
    }
    case 'atualizar-buckets': {
      const r = await atualizarDisponiveis()
      contarPendentes()
      return r
    }
    case 'sincronizar-agora': ciclo(true); return { ok: true }
    case 'assumir': ciclo(false, p.buckets); return { ok: true }
    case 'varrer-agora': {
      if (!(await carregarQuemSou())) return { ok: false, mensagem: 'Entre no Gestor AF primeiro.' }
      const e = await lerEstado()
      if (!e.config.buckets.length) return { ok: false, mensagem: 'Marque ao menos um bucket na lista.' }
      varrer(e.config.buckets); return { ok: true }
    }
    case 'escolher-varredura': {
      await mudar(x => { x.escolha = { oQue: p.oQue } })
      return { ok: true }
    }
    case 'contar-pendentes': await contarPendentes(); return { ok: true }
    case 'abrir-janela-toa': return abrirJanelaDaVarredura()
    case 'ler-portal': {
      const e = await lerEstado()
      if (!e.portal.login) return { ok: false, mensagem: 'Abra o Portal Técnico da Claro numa aba deste Chrome, já logado.' }
      if (!e.ligado) return { ok: false, mensagem: 'Ligue "Sincronizar por este computador" primeiro.' }
      const dia = p.dia ?? hojeLocal()
      if (!diaValido(dia)) return { ok: false, mensagem: `Escolha um dia entre hoje e ${DIAS_PARA_TRAS} dias atrás.` }
      lerPortal(true, dia); return { ok: true }
    }
    case 'sincronizar-dia': {
      const e = await lerEstado()
      if (!e.ligado) return { ok: false, mensagem: 'Ligue "Sincronizar por este computador" primeiro.' }
      if (!diaValido(p.dia)) return { ok: false, mensagem: `Escolha um dia entre hoje e ${DIAS_PARA_TRAS} dias atrás.` }
      if (!e.config.buckets.length) return { ok: false, mensagem: 'Marque ao menos um bucket na lista.' }
      if (p.dia === hojeLocal()) { ciclo(true); return { ok: true } }
      rodarDia(p.dia); return { ok: true }
    }
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
