import { CHAVE, agoraManaus, fimFeito, janelaAgora, lerEstado, type BucketDisponivel, type Estado, type Importacao, type Intervalo, type OQueVarrer, type Pedido } from './estado'

/**
 * O painel da extensão (clique no ícone) — D-193.
 * Só mostra o estado e manda pedidos ao fundo; quem trabalha é o fundo,
 * e ele continua trabalhando com o painel fechado.
 *
 * 0.10.0 (D-342): um menu no topo com duas abas.
 *   Configuração — as cidades e os buckets DESTE computador.
 *   Importar     — o dia, e o Iniciar/Parar de cada importação (rota,
 *                  equipamentos, níveis), cada uma com o seu intervalo.
 * > "eu preciso ter o controle disso" — Emanuel, 08/11
 *
 * ┌─ o dia não fica preso em ontem ──────────────────────────────────┐
 * │ Até a 0.9.0 o campo Dia recebia "hoje" UMA vez, ao abrir. O     │
 * │ painel lateral fica aberto dias a fio (no Edge da VPS, sempre): │
 * │ depois da meia-noite o campo continuava no dia anterior, "Ler o │
 * │ portal" lia ONTEM inteiro (o "07/11: 102 O.S." do registro de   │
 * │ 08/11) e o botão importava a rota de ontem. Agora "hoje" é a    │
 * │ AUSÊNCIA de escolha (`diaEscolhido` nulo) e é recalculado a cada│
 * │ desenho; só um dia para trás escolhido fica parado.             │
 * └──────────────────────────────────────────────────────────────────┘
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// O painel lê os arquivos novos da pasta, mas o fundo só troca quando a
// extensão é recarregada: um fundo velho não conhece o pedido e devolve
// vazio. Visto em 01/11, com a 0.8.0 no painel e a 0.7.0 no fundo.
const FUNDO_VELHO = 'O fundo da extensão é de outra versão. Em extensões, clique em recarregar (↻) na extensão AFLINE e dê F5 na aba do TOA.'

async function pedir(p: Pedido): Promise<{ ok: boolean; mensagem?: string }> {
  try {
    const r = await chrome.runtime.sendMessage(p) as { ok: boolean; mensagem?: string } | undefined
    return r ?? { ok: false, mensagem: FUNDO_VELHO }
  } catch {
    return { ok: false, mensagem: FUNDO_VELHO }
  }
}

/** Hoje em Manaus — o mesmo `hoje_local()` do banco (nunca toISOString, D-084). */
const hojeLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus' }).format(new Date())
/** Até quantos dias para trás se pode importar pela extensão. */
const DIAS_PARA_TRAS = 31
function diasAtras(n: number) {
  const [a, m, d] = hojeLocal().split('-').map(Number)
  const x = new Date(Date.UTC(a, m - 1, d - n))
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`
}
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** Nulo = hoje, e hoje anda sozinho na virada do dia. */
let diaEscolhido: string | null = null
const diaAtual = () => {
  if (diaEscolhido && diaEscolhido >= hojeLocal()) diaEscolhido = null
  return diaEscolhido ?? hojeLocal()
}

const hora = (ms: number | null) =>
  ms ? new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'

function haQuanto(ms: number | null): string {
  if (!ms) return 'nunca'
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return `há ${s} s`
  return `há ${Math.round(s / 60)} min`
}
const cada = (min: number) => min === 60 ? '1 hora' : `${min} min`

const MOTIVO_FORA: Record<string, string> = {
  NAO_CADASTRADO: 'não cadastrado no PulsoLine',
  OUTRA_CIDADE: 'de uma cidade que você não acessa',
  DESLIGADO: 'desligado no PulsoLine',
  NUMERO_DIFERENTE: 'o número no PulsoLine não bate com o do TOA',
}

/** Grava a configuração mudando só um pedaço dela. */
async function configurar(config: Partial<Estado['config']>) {
  const r = await pedir({ tipo: 'configurar', config })
  if (!r?.ok) alert(r?.mensagem ?? 'Não consegui gravar.')
}

// ── as abas do topo (a última aberta fica lembrada neste navegador) ──────
type Aba = 'config' | 'importar'
function lerAba(): Aba {
  try { return localStorage.getItem('af_aba') === 'config' ? 'config' : 'importar' } catch { return 'importar' }
}
function mostrarAba(a: Aba) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('nav.abas button')) {
    b.setAttribute('aria-selected', String(b.dataset.aba === a))
  }
  $('pagina-config').hidden = a !== 'config'
  $('pagina-importar').hidden = a !== 'importar'
  try { localStorage.setItem('af_aba', a) } catch { /* sem armazenamento: só não lembra */ }
}

/**
 * O selo de uma importação LIGADA e parada no momento, conforme o horário
 * (D-374): no horário, o intervalo; antes, quando começa; depois da hora fim,
 * se a última rodada do dia já foi feita.
 */
function seloLigado(e: Estado, qual: Importacao, min: number): [string, '' | 'ligado'] {
  const c = e.config
  switch (janelaAgora(c)) {
    case 'ANTES': return [`começa ${c.horaInicio}`, '']
    case 'DEPOIS': return fimFeito(e, qual) ? ['encerrada hoje', ''] : ['última rodada', 'ligado']
    default: return [`a cada ${cada(min)}`, 'ligado']
  }
}

/** O selo do cartão: o que a importação está fazendo agora. */
function estado(id: string, texto: string, classe: '' | 'ligado' | 'rodando' | 'pausa') {
  const s = $(id); s.textContent = texto; s.className = `estado ${classe}`
}

function desenhar(e: Estado) {
  const logado = !!e.usuario
  $('entrar').hidden = logado
  $('painel').hidden = !logado
  if (!logado) return

  $('quem').textContent = e.usuario!.nome ?? e.usuario!.email ?? '—'
  ;($('ligado') as HTMLInputElement).checked = e.ligado

  // A situação, em uma frase — e nunca "tudo certo" sem saber (regra 6).
  const marcados = e.config.buckets
  const meus = marcados.filter(id => e.vezes[id]?.vez)
  const deOutro = marcados.filter(id => e.vezes[id] && !e.vezes[id].vez)
  const st = $('situacao')
  let texto: string, classe: string
  if (!e.ligado) { texto = 'Este computador não está sincronizando. Ligue acima.'; classe = 'neutro' }
  else if (!marcados.length) { texto = 'Marque ao menos um bucket em Configuração.'; classe = 'aviso' }
  else if (e.toaSessao === 'CAIU') { texto = 'A sessão do TOA caiu neste navegador: entre no TOA de novo.'; classe = 'erro' }
  else if (!e.pulsoEm) { texto = 'Aguardando o primeiro pulso…'; classe = 'neutro' }
  else if (!meus.length) { texto = `De reserva: os ${deOutro.length} bucket(s) marcados estão com outro computador. Assume sozinho se ele parar.`; classe = 'aviso' }
  else {
    texto = `${meus.length} bucket(s) com este computador`
      + (deOutro.length ? ` (${deOutro.length} com outro)` : '') + `. Pulso ${haQuanto(e.pulsoEm)}.`
    classe = deOutro.length ? 'aviso' : 'ok'
  }
  st.textContent = texto; st.className = `situacao ${classe}`

  desenharBuckets(e)
  ;($('assumir') as HTMLButtonElement).hidden = !(e.ligado && deOutro.length)
  desenharImportar(e)
}

function desenharImportar(e: Estado) {
  const c = e.config
  // ── o dia ──
  const hoje = hojeLocal()
  const dia = diaAtual()
  const outro = dia !== hoje
  const campoDia = $('dia') as HTMLInputElement
  campoDia.max = hoje; campoDia.min = diasAtras(DIAS_PARA_TRAS)
  if (document.activeElement !== campoDia) campoDia.value = dia
  $('dia-caixa').classList.toggle('outro', outro)
  $('dia-hoje').hidden = !outro
  $('dia-rotulo').textContent = outro ? `importa só ${dataBR(dia)}, uma vez` : 'hoje'

  // ── o horário (D-374) ──
  const inicio = $('hora-inicio') as HTMLInputElement
  const fimH = $('hora-fim') as HTMLInputElement
  if (document.activeElement !== inicio) inicio.value = c.horaInicio ?? ''
  if (document.activeElement !== fimH) fimH.value = c.horaFim ?? ''
  const { hhmm } = agoraManaus()
  const jan = janelaAgora(c)
  $('horario-rotulo').textContent = `Manaus ${hhmm} · ` + (
    jan === 'SEM_HORARIO' ? 'o dia inteiro'
    : jan === 'ANTES' ? `começa às ${c.horaInicio}`
    : jan === 'DEPOIS' ? `encerrado${c.horaInicio ? `; volta amanhã às ${c.horaInicio}` : ''}`
    : c.horaFim ? `até ${c.horaFim}` : 'no horário')

  // ── rota ──
  const b = e.baixa
  if (b.rodando) estado('rota-estado', 'importando', 'rodando')
  else if (c.rotaLigada) estado('rota-estado', ...seloLigado(e, 'ROTA', c.rotaMin))
  else estado('rota-estado', 'parada', '')
  ;($('rota-min') as HTMLSelectElement).value = String(c.rotaMin)
  ;($('rota-iniciar') as HTMLButtonElement).textContent = outro ? `Importar ${dataBR(dia)}` : 'Iniciar'
  ;($('rota-parar') as HTMLButtonElement).disabled = !c.rotaLigada && !b.rodando
  $('rota-texto').textContent = b.rodando ? (b.atual ?? 'Importando…')
    : b.ultima ? `Última (${hora(b.ultimaEm)}): ${b.ultima}` : 'Nenhuma rodada ainda.'

  // ── equipamentos (varredura) ──
  const v = e.varredura
  const pct = v.total ? Math.floor((v.feitos / v.total) * 100) : 0
  if (v.rodando && v.pausada) estado('var-estado', 'pausada', 'pausa')
  else if (v.rodando) estado('var-estado', `${pct}%`, 'rodando')
  else if (c.varreduraLigada) estado('var-estado', ...seloLigado(e, 'EQUIPAMENTOS', c.varreduraMin))
  else estado('var-estado', 'parada', '')
  ;($('var-min') as HTMLSelectElement).value = String(c.varreduraMin)
  ;($('var-oque') as HTMLSelectElement).value = e.escolha.oQue
  ;($('var-oque') as HTMLSelectElement).disabled = v.rodando
  ;($('var-iniciar') as HTMLButtonElement).disabled = outro || v.rodando
  ;($('var-parar') as HTMLButtonElement).disabled = !c.varreduraLigada && !v.rodando
  $('var-barra').hidden = !v.rodando
  ;($('var-preenche') as HTMLDivElement).style.width = `${pct}%`
  $('var-texto').textContent = outro ? 'Equipamentos só se leem do dia de hoje.'
    : v.rodando && v.pausada
    ? `Pausada (${v.feitos} de ${v.total}): a leitura pelas telas precisa da aba do TOA à vista.`
    : v.rodando
    ? `${v.feitos} de ${v.total} — ${v.nomes} nome(s), ${v.listas} lista(s)${v.erros ? `, ${v.erros} erro(s)` : ''}`
    : v.ultima ? `Última (${hora(v.ultimaEm)}): ${v.ultima}` : 'Nenhuma varredura ainda.'

  // ── níveis (portal) ──
  const po = e.portal
  const pausado = !!po.pausaAte && Date.now() < po.pausaAte
  if (pausado) estado('portal-estado', `pausa até ${hora(po.pausaAte)}`, 'pausa')
  else if (po.rodando) estado('portal-estado', po.total ? `${po.feitos} de ${po.total}` : 'lendo', 'rodando')
  else if (c.portalLigado) estado('portal-estado', ...seloLigado(e, 'NIVEIS', c.portalMin))
  else estado('portal-estado', 'parado', '')
  ;($('portal-min') as HTMLSelectElement).value = String(c.portalMin)
  ;($('portal-iniciar') as HTMLButtonElement).textContent = outro ? `Ler ${dataBR(dia)}` : 'Iniciar'
  ;($('portal-iniciar') as HTMLButtonElement).disabled = po.rodando || pausado || !po.login
  ;($('portal-parar') as HTMLButtonElement).disabled = !c.portalLigado && !po.rodando
  $('portal-pausa').hidden = !pausado
  $('portal-pausa-texto').textContent = pausado
    ? `Em pausa até ${hora(po.pausaAte)}: ${po.pausaMotivo ?? 'bloqueio'}. Tentar antes pode estender o bloqueio.` : ''
  $('portal-barra').hidden = !(po.rodando && po.total)
  ;($('portal-preenche') as HTMLDivElement).style.width = `${po.total ? Math.floor((po.feitos / po.total) * 100) : 0}%`
  $('portal-texto').textContent = !po.login
    ? 'Abra o Portal Técnico da Claro numa aba deste navegador, já logado.'
    : po.sessao === 'CAIU' ? `A sessão do portal caiu (login ${po.login}): entre no portal de novo.`
    : po.ultima ? `Login ${po.login}. Última (${hora(po.ultimaEm)}): ${po.ultima}`
    : `Login ${po.login}.`

  const log = $('log')
  log.replaceChildren(...e.log.slice(0, 15).map(l => {
    const li = document.createElement('li')
    li.className = l.tom
    li.textContent = `${new Date(l.em).toLocaleTimeString('pt-BR')} ${l.texto}`
    return li
  }))
}

/**
 * As cidades e os buckets do login. A caixinha da CIDADE marca ou desmarca
 * todos os buckets dela; a de cada bucket, só ele. Bucket marcado que não
 * está na última leitura da árvore continua aparecendo (vindo do pulso),
 * para não sumir calado.
 */
function desenharBuckets(e: Estado) {
  const caixa = $('buckets')
  const lista = new Map<string, BucketDisponivel>()
  for (const b of e.disponiveis?.itens ?? []) lista.set(b.id, b)
  for (const id of e.config.buckets) if (!lista.has(id) && e.vezes[id]) lista.set(id, e.vezes[id])
  const itens = [...lista.values()].sort((a, b) => a.cidade.localeCompare(b.cidade) || a.nome.localeCompare(b.nome))

  if (!itens.length) {
    caixa.innerHTML = e.disponiveis
      ? '<p class="pequeno">Nenhum bucket do seu login está cadastrado numa cidade que você acessa.</p>'
      : '<p class="pequeno">Abra o TOA numa aba deste navegador e clique em "Atualizar a lista".</p>'
  } else {
    const porCidade = new Map<string, BucketDisponivel[]>()
    for (const b of itens) porCidade.set(b.cidade, [...(porCidade.get(b.cidade) ?? []), b])
    const marcados = new Set(e.config.buckets)
    const filhos: HTMLElement[] = []
    for (const [cidade, bs] of porCidade) {
      const n = bs.filter(b => marcados.has(b.id)).length
      const lc = document.createElement('label'); lc.className = 'cidade'
      const cc = document.createElement('input'); cc.type = 'checkbox'
      cc.checked = n === bs.length; cc.indeterminate = n > 0 && n < bs.length
      cc.addEventListener('change', () => {
        const ids = new Set(bs.map(b => b.id))
        const fora = e.config.buckets.filter(id => !ids.has(id))
        configurar({ buckets: cc.checked ? [...fora, ...ids] : fora })
      })
      const nc = document.createElement('span'); nc.textContent = cidade
      const conta = document.createElement('span'); conta.className = 'conta'; conta.textContent = `${n} de ${bs.length}`
      lc.append(cc, nc, conta)
      filhos.push(lc)
      for (const b of bs) {
        const label = document.createElement('label'); label.className = 'bucket'
        const cx = document.createElement('input')
        cx.type = 'checkbox'; cx.checked = marcados.has(b.id)
        cx.addEventListener('change', () => {
          const atual = e.config.buckets
          configurar({ buckets: cx.checked ? [...atual, b.id] : atual.filter(x => x !== b.id) })
        })
        const nome = document.createElement('span'); nome.textContent = b.nome
        label.append(cx, nome)
        // só o que muda a ação: o bucket marcado que está com OUTRO computador
        const v = e.vezes[b.id]
        if (cx.checked && v?.outro) {
          const vez = document.createElement('span')
          vez.className = 'vez outro'; vez.textContent = `com ${v.outro}`
          label.append(vez)
        }
        filhos.push(label)
      }
    }
    caixa.replaceChildren(...filhos)
  }

  const fora = e.disponiveis?.fora ?? []
  $('fora').textContent = fora.length
    ? `Fora da lista: ${fora.map(f => `${f.nome} (${MOTIVO_FORA[f.motivo] ?? f.motivo})`).join('; ')}.`
    : e.disponiveis ? `Lista lida do TOA às ${hora(e.disponiveis.em)}.` : ''
}

async function iniciarImportacao(oQue: Importacao, botao: HTMLButtonElement) {
  botao.disabled = true
  const r = await pedir({ tipo: 'iniciar', oQue, dia: diaAtual() })
  botao.disabled = false
  if (!r?.ok) alert(r?.mensagem ?? 'Não consegui iniciar.')
}

async function iniciar() {
  mostrarAba(lerAba())
  desenhar(await lerEstado())
  chrome.storage.onChanged.addListener((mud, area) => {
    if (area === 'local' && mud[CHAVE]) lerEstado().then(desenhar)
  })
  // o "há X s" do pulso, a pausa e a virada do dia andam sozinhos
  setInterval(() => lerEstado().then(desenhar), 10_000)

  for (const b of document.querySelectorAll<HTMLButtonElement>('nav.abas button')) {
    b.addEventListener('click', () => mostrarAba(b.dataset.aba as Aba))
  }

  $('form-entrar').addEventListener('submit', async ev => {
    ev.preventDefault()
    const erro = $('erro-entrar'); erro.textContent = ''
    const botao = $('botao-entrar') as HTMLButtonElement; botao.disabled = true; botao.textContent = 'Entrando…'
    const r = await pedir({
      tipo: 'entrar',
      email: ($('email') as HTMLInputElement).value,
      senha: ($('senha') as HTMLInputElement).value,
    })
    botao.disabled = false; botao.textContent = 'Entrar'
    ;($('senha') as HTMLInputElement).value = ''
    if (!r?.ok) erro.textContent = r?.mensagem ?? 'Não consegui entrar.'
  })
  $('ligado').addEventListener('change', ev => pedir({ tipo: 'ligar', sim: (ev.target as HTMLInputElement).checked }))
  $('atualizar').addEventListener('click', async () => {
    const b = $('atualizar') as HTMLButtonElement
    b.disabled = true; b.textContent = 'Lendo o TOA…'
    const r = await pedir({ tipo: 'atualizar-buckets' })
    b.disabled = false; b.textContent = 'Atualizar a lista'
    if (!r?.ok) alert(r?.mensagem ?? 'Não consegui ler a lista.')
  })
  $('assumir').addEventListener('click', async () => {
    const e = await lerEstado()
    pedir({ tipo: 'assumir', buckets: e.config.buckets.filter(id => e.vezes[id] && !e.vezes[id].vez) })
  })

  // ── o dia ──
  const campoDia = $('dia') as HTMLInputElement
  campoDia.addEventListener('change', async () => {
    const v = campoDia.value
    diaEscolhido = v && v >= diasAtras(DIAS_PARA_TRAS) && v < hojeLocal() ? v : null
    desenhar(await lerEstado())
  })
  $('dia-hoje').addEventListener('click', async () => { diaEscolhido = null; desenhar(await lerEstado()) })

  // ── Iniciar / Parar / intervalo de cada importação ──
  $('rota-iniciar').addEventListener('click', ev => iniciarImportacao('ROTA', ev.currentTarget as HTMLButtonElement))
  $('var-iniciar').addEventListener('click', ev => iniciarImportacao('EQUIPAMENTOS', ev.currentTarget as HTMLButtonElement))
  $('portal-iniciar').addEventListener('click', ev => iniciarImportacao('NIVEIS', ev.currentTarget as HTMLButtonElement))
  $('rota-parar').addEventListener('click', () => pedir({ tipo: 'parar', oQue: 'ROTA' }))
  $('var-parar').addEventListener('click', () => pedir({ tipo: 'parar', oQue: 'EQUIPAMENTOS' }))
  $('portal-parar').addEventListener('click', () => pedir({ tipo: 'parar', oQue: 'NIVEIS' }))
  $('rota-min').addEventListener('change', ev => configurar({ rotaMin: Number((ev.target as HTMLSelectElement).value) as Intervalo }))
  $('var-min').addEventListener('change', ev => configurar({ varreduraMin: Number((ev.target as HTMLSelectElement).value) as Intervalo }))
  $('portal-min').addEventListener('change', ev => configurar({ portalMin: Number((ev.target as HTMLSelectElement).value) as Intervalo }))
  // vazio = sem limite daquele lado; o fundo recusa início depois do fim
  $('hora-inicio').addEventListener('change', ev => configurar({ horaInicio: (ev.target as HTMLInputElement).value || null }))
  $('hora-fim').addEventListener('change', ev => configurar({ horaFim: (ev.target as HTMLInputElement).value || null }))
  $('var-oque').addEventListener('change', ev => pedir({ tipo: 'escolher-varredura', oQue: (ev.target as HTMLSelectElement).value as OQueVarrer }))
  $('portal-retomar').addEventListener('click', () => {
    if (confirm('A Claro bloqueou o acesso há pouco. Tentar de novo antes da hora pode estender o bloqueio. Retomar mesmo assim?')) {
      pedir({ tipo: 'retomar-portal' })
    }
  })

  // a lista do login, ao abrir o painel
  pedir({ tipo: 'atualizar-buckets' })
  $('janela-toa').addEventListener('click', ev => { ev.preventDefault(); pedir({ tipo: 'abrir-janela-toa' }) })
  $('sair').addEventListener('click', () => pedir({ tipo: 'sair' }))
  $('abrir').addEventListener('click', () => chrome.tabs.create({ url: 'https://pulsoline.grupoafline.com.br/controle/sincronismo' }))
}

iniciar()
