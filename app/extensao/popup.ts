import { CHAVE, lerEstado, type BucketDisponivel, type Estado, type Intervalo, type OQueVarrer, type Pedido } from './estado'

/**
 * A janelinha da extensão (clique no ícone) — D-193.
 * Só mostra o estado e manda pedidos ao fundo; quem trabalha é o fundo,
 * e ele continua trabalhando com a janelinha fechada.
 *
 * 0.8.0 (D-251): aqui se escolhe o que ESTE computador sincroniza — os
 * buckets do login (por cidade) e os tempos da rota e da varredura. Cada
 * mudança grava na hora, como já era a escolha da varredura.
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// O painel lê os arquivos novos da pasta, mas o fundo só troca quando a
// extensão é recarregada: um fundo velho não conhece o pedido e devolve
// vazio. Visto em 01/11, com a 0.8.0 no painel e a 0.7.0 no fundo.
const FUNDO_VELHO = 'O fundo da extensão é de outra versão. Em chrome://extensions clique em recarregar (↻) na extensão AFLINE e dê F5 na aba do TOA.'

async function pedir(p: Pedido): Promise<{ ok: boolean; mensagem?: string }> {
  try {
    const r = await chrome.runtime.sendMessage(p) as { ok: boolean; mensagem?: string } | undefined
    return r ?? { ok: false, mensagem: FUNDO_VELHO }
  } catch {
    return { ok: false, mensagem: FUNDO_VELHO }
  }
}

const hora = (ms: number | null) =>
  ms ? new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'

function haQuanto(ms: number | null): string {
  if (!ms) return 'nunca'
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return `há ${s} s`
  return `há ${Math.round(s / 60)} min`
}

const MOTIVO_FORA: Record<string, string> = {
  NAO_CADASTRADO: 'não cadastrado no PulsoLine',
  OUTRA_CIDADE: 'de uma cidade que você não acessa',
  DESLIGADO: 'desligado no PulsoLine',
  NUMERO_DIFERENTE: 'o número no PulsoLine não bate com o do TOA',
}

/** Grava a configuração mudando só um pedaço dela. */
async function configurar(m: Partial<{ rotaMin: Intervalo; varreduraMin: Intervalo | null; buckets: string[] }>) {
  const e = await lerEstado()
  const r = await pedir({ tipo: 'configurar', ...e.config, ...m })
  if (!r?.ok) alert(r?.mensagem ?? 'Não consegui gravar.')
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
  else if (!marcados.length) { texto = 'Marque ao menos um bucket na lista abaixo.'; classe = 'aviso' }
  else if (e.toaSessao === 'CAIU') { texto = 'A sessão do TOA caiu neste Chrome: entre no TOA de novo.'; classe = 'erro' }
  else if (!e.pulsoEm) { texto = 'Aguardando o primeiro pulso…'; classe = 'neutro' }
  else if (!meus.length) { texto = `De reserva: os ${deOutro.length} bucket(s) marcados estão com outro computador. Assume sozinho se ele parar.`; classe = 'aviso' }
  else {
    texto = `Sincronizando ${meus.length} bucket(s) a cada ${e.config.rotaMin} min`
      + (deOutro.length ? ` (${deOutro.length} com outro computador)` : '') + `. Pulso ${haQuanto(e.pulsoEm)}.`
    classe = deOutro.length ? 'aviso' : 'ok'
  }
  st.textContent = texto; st.className = `situacao ${classe}`

  desenharBuckets(e)
  ;($('assumir') as HTMLButtonElement).hidden = !(e.ligado && deOutro.length)

  for (const b of document.querySelectorAll<HTMLButtonElement>('#rota-min button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.min) === e.config.rotaMin))
  }
  ;($('var-min') as HTMLSelectElement).value = e.config.varreduraMin?.toString() ?? ''

  $('baixa-atual').textContent = e.baixa.rodando ? (e.baixa.atual ?? 'Sincronizando…') : ''
  $('baixa-ultima').textContent = e.baixa.ultima ? `Última (${hora(e.baixa.ultimaEm)}): ${e.baixa.ultima}` : 'Nenhuma rodada ainda.'

  const v = e.varredura
  const pct = v.total ? Math.floor((v.feitos / v.total) * 100) : 0
  $('var-barra').hidden = !v.rodando
  ;($('var-preenche') as HTMLDivElement).style.width = `${pct}%`
  $('var-texto').textContent = v.rodando && v.pausada
    ? `PAUSADA (${v.feitos} de ${v.total}): a leitura pelas telas precisa da aba do TOA à vista. Deixe-a à vista e a varredura continua sozinha.`
    : v.rodando
    ? `Varrendo o TOA… ${v.feitos} de ${v.total} (${pct}%) — ${v.nomes} nome(s), ${v.listas} lista(s)${v.erros ? `, ${v.erros} erro(s)` : ''}`
    : v.ultima ? `Última (${hora(v.ultimaEm)}): ${v.ultima}` : 'Nenhuma varredura ainda.'
  ;($('varrer') as HTMLButtonElement).hidden = v.rodando
  ;($('parar') as HTMLButtonElement).hidden = !v.rodando
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name=oque]')) {
    r.checked = r.value === e.escolha.oQue; r.disabled = v.rodando
  }

  const log = $('log')
  log.replaceChildren(...e.log.slice(0, 12).map(l => {
    const li = document.createElement('li')
    li.className = l.tom
    li.textContent = `${new Date(l.em).toLocaleTimeString('pt-BR')} ${l.texto}`
    return li
  }))
}

/**
 * Os buckets do login, por cidade: caixinha (sincronizar e varrer), de quem
 * é a vez e quanto falta varrer. Bucket marcado que não está na última
 * leitura da árvore continua aparecendo (vindo do pulso), para não sumir
 * calado.
 */
function desenharBuckets(e: Estado) {
  const caixa = $('buckets')
  const lista = new Map<string, BucketDisponivel>()
  for (const b of e.disponiveis?.itens ?? []) lista.set(b.id, b)
  for (const id of e.config.buckets) if (!lista.has(id) && e.vezes[id]) lista.set(id, e.vezes[id])
  const itens = [...lista.values()].sort((a, b) => a.cidade.localeCompare(b.cidade) || a.nome.localeCompare(b.nome))
  const pend = new Map((e.pendentes?.porBucket ?? []).map(p => [p.bucket, p]))

  if (!itens.length) {
    caixa.innerHTML = e.disponiveis
      ? '<p class="pequeno">Nenhum bucket do seu login está cadastrado numa cidade que você acessa.</p>'
      : '<p class="pequeno">Abra o TOA numa aba deste Chrome e clique em "Atualizar a lista".</p>'
  } else {
    const filhos: HTMLElement[] = []
    let cidade = ''
    for (const b of itens) {
      if (b.cidade !== cidade) {
        cidade = b.cidade
        const t = document.createElement('p'); t.className = 'cidade'; t.textContent = cidade
        filhos.push(t)
      }
      const label = document.createElement('label')
      const cx = document.createElement('input')
      cx.type = 'checkbox'; cx.checked = e.config.buckets.includes(b.id)
      cx.addEventListener('change', () => {
        const atual = e.config.buckets
        configurar({ buckets: cx.checked ? [...atual, b.id] : atual.filter(x => x !== b.id) })
      })
      const nome = document.createElement('span'); nome.textContent = b.nome
      const vez = document.createElement('span')
      const v = e.vezes[b.id]
      if (v?.vez) { vez.className = 'vez minha'; vez.textContent = 'este computador' }
      else if (v?.outro) { vez.className = 'vez outro'; vez.textContent = `com ${v.outro}` }
      else { vez.className = 'vez'; vez.textContent = 'livre' }
      const conta = document.createElement('span'); conta.className = 'conta'
      const p = pend.get(b.nome)
      conta.textContent = cx.checked ? (p ? `${p.nomes} s/ nome · ${p.listas} equip.` : (e.pendentes ? 'nada a varrer' : '')) : ''
      label.append(cx, nome, vez, conta)
      filhos.push(label)
    }
    caixa.replaceChildren(...filhos)
  }

  const fora = e.disponiveis?.fora ?? []
  $('fora').textContent = fora.length
    ? `Fora da lista: ${fora.map(f => `${f.nome} (${MOTIVO_FORA[f.motivo] ?? f.motivo})`).join('; ')}.`
    : e.disponiveis ? `Lista lida do TOA às ${hora(e.disponiveis.em)}.` : ''
}

async function iniciar() {
  desenhar(await lerEstado())
  chrome.storage.onChanged.addListener((mud, area) => {
    if (area === 'local' && mud[CHAVE]) lerEstado().then(desenhar)
  })
  // o "há X s" do pulso anda sozinho
  setInterval(() => lerEstado().then(desenhar), 10_000)

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
  for (const b of document.querySelectorAll<HTMLButtonElement>('#rota-min button')) {
    b.addEventListener('click', () => configurar({ rotaMin: Number(b.dataset.min) as Intervalo }))
  }
  $('var-min').addEventListener('change', ev => {
    const v = (ev.target as HTMLSelectElement).value
    configurar({ varreduraMin: v ? Number(v) as Intervalo : null })
  })
  $('sincronizar').addEventListener('click', () => pedir({ tipo: 'sincronizar-agora' }))
  $('varrer').addEventListener('click', async () => {
    const r = await pedir({ tipo: 'varrer-agora' })
    if (!r?.ok) alert(r?.mensagem ?? 'Não consegui começar a varredura.')
  })
  $('parar').addEventListener('click', () => pedir({ tipo: 'parar-varredura' }))
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name=oque]')) {
    r.addEventListener('change', () => pedir({ tipo: 'escolher-varredura', oQue: r.value as OQueVarrer }))
  }
  // a lista do login e quanto falta: ao abrir o painel, e a cada 2 min com ele aberto
  pedir({ tipo: 'atualizar-buckets' })
  setInterval(() => pedir({ tipo: 'contar-pendentes' }), 120_000)
  $('janela-toa').addEventListener('click', ev => { ev.preventDefault(); pedir({ tipo: 'abrir-janela-toa' }) })
  $('sair').addEventListener('click', () => pedir({ tipo: 'sair' }))
  $('abrir').addEventListener('click', () => chrome.tabs.create({ url: 'https://pulsoline.grupoafline.com.br/controle/sincronismo' }))
}

iniciar()
