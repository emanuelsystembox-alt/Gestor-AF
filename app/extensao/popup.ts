import { CHAVE, lerEstado, type Estado, type OQueVarrer, type Pedido } from './estado'

/**
 * A janelinha da extensão (clique no ícone) — D-193.
 * Só mostra o estado e manda pedidos ao fundo; quem trabalha é o fundo,
 * e ele continua trabalhando com a janelinha fechada.
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function pedir(p: Pedido): Promise<{ ok: boolean; mensagem?: string }> {
  return chrome.runtime.sendMessage(p)
}

const hora = (ms: number | null) =>
  ms ? new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'

function haQuanto(ms: number | null): string {
  if (!ms) return 'nunca'
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return `há ${s} s`
  return `há ${Math.round(s / 60)} min`
}

function desenhar(e: Estado) {
  const logado = !!e.usuario
  $('entrar').hidden = logado
  $('painel').hidden = !logado
  if (!logado) return

  $('quem').textContent = `${e.usuario!.nome ?? e.usuario!.email ?? '—'} · ${e.cidade?.nome ?? 'sem cidade ativa'}`
  ;($('ligado') as HTMLInputElement).checked = e.ligado

  // A situação, em uma frase — e nunca "tudo certo" sem saber (regra 6).
  const st = $('situacao')
  let texto: string, classe: string
  if (!e.ligado) { texto = 'Este computador não está sincronizando. Ligue acima.'; classe = 'neutro' }
  else if (e.toaSessao === 'CAIU') { texto = 'A sessão do TOA caiu neste Chrome: entre no TOA de novo.'; classe = 'erro' }
  else if (e.vez === 'RESERVA') { texto = `De reserva: a vez é de ${e.reservaDe ?? 'outro computador'}. Assume sozinho se ele parar.`; classe = 'aviso' }
  else if (e.servidorLigado === false) { texto = 'O sincronismo está desligado na configuração do Gestor AF.'; classe = 'aviso' }
  else if (e.vez === 'ESTE') { texto = `Sincronizando a cada ${e.intervalo ?? '?'} min. Pulso ${haQuanto(e.pulsoEm)}.`; classe = 'ok' }
  else { texto = 'Aguardando o primeiro pulso…'; classe = 'neutro' }
  st.textContent = texto; st.className = `situacao ${classe}`

  $('baixa-atual').textContent = e.baixa.rodando ? (e.baixa.atual ?? 'Sincronizando…') : ''
  $('baixa-ultima').textContent = e.baixa.ultima ? `Última (${hora(e.baixa.ultimaEm)}): ${e.baixa.ultima}` : 'Nenhuma rodada ainda.'
  ;($('assumir') as HTMLButtonElement).hidden = e.vez !== 'RESERVA'

  const v = e.varredura
  const pct = v.total ? Math.floor((v.feitos / v.total) * 100) : 0
  $('var-barra').hidden = !v.rodando
  ;($('var-preenche') as HTMLDivElement).style.width = `${pct}%`
  $('var-texto').textContent = v.rodando && v.pausada
    ? `PAUSADA (${v.feitos} de ${v.total}): a aba do TOA está escondida — o Chrome para a tela dela. Deixe a aba do TOA à vista (de preferência numa janela só dela) e a varredura continua sozinha.`
    : v.rodando
    ? `Varrendo o TOA… ${v.feitos} de ${v.total} (${pct}%) — ${v.nomes} nome(s), ${v.listas} lista(s)${v.erros ? `, ${v.erros} erro(s)` : ''}`
    : v.ultima ? `Última (${hora(v.ultimaEm)}): ${v.ultima}` : 'Nenhuma varredura ainda.'
  ;($('varrer') as HTMLButtonElement).hidden = v.rodando
  ;($('parar') as HTMLButtonElement).hidden = !v.rodando

  desenharEscolha(e)

  const log = $('log')
  log.replaceChildren(...e.log.slice(0, 12).map(l => {
    const li = document.createElement('li')
    li.className = l.tom
    li.textContent = `${new Date(l.em).toLocaleTimeString('pt-BR')} ${l.texto}`
    return li
  }))
}

/**
 * O que varrer (121, 0.6.0): uma caixinha por bucket, com quanto falta, e
 * o que ler. Desmarcar grava na hora; vale para o "Varrer agora" e para a
 * rodada automática. Durante a varredura fica travado — a lista já foi.
 */
function desenharEscolha(e: Estado) {
  const caixa = $('var-buckets')
  const contagem = new Map((e.pendentes?.porBucket ?? []).map(p => [p.bucket, p]))
  const nomes = [...new Set([...contagem.keys(), ...e.escolha.fora])].sort((a, b) => a.localeCompare(b))
  const travado = e.varredura.rodando
  if (!e.pendentes) {
    caixa.innerHTML = '<p class="pequeno">Contando o que falta…</p>'
  } else if (!nomes.length) {
    caixa.innerHTML = '<p class="pequeno">Nada pendente hoje.</p>'
  } else {
    caixa.replaceChildren(...nomes.map(b => {
      const c = contagem.get(b)
      const label = document.createElement('label')
      const cx = document.createElement('input')
      cx.type = 'checkbox'; cx.checked = !e.escolha.fora.includes(b); cx.disabled = travado
      cx.addEventListener('change', () => {
        const fora = cx.checked ? e.escolha.fora.filter(x => x !== b) : [...e.escolha.fora, b]
        pedir({ tipo: 'escolher-varredura', fora, oQue: e.escolha.oQue })
      })
      const nome = document.createElement('span'); nome.textContent = b || 'sem bucket'
      const conta = document.createElement('span'); conta.className = 'conta'
      conta.textContent = c ? `${c.nomes} sem nome · ${c.listas} equip.` : 'nada pendente'
      label.append(cx, nome, conta)
      return label
    }))
  }
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name=oque]')) {
    r.checked = r.value === e.escolha.oQue; r.disabled = travado
  }
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
  $('sincronizar').addEventListener('click', () => pedir({ tipo: 'sincronizar-agora' }))
  $('assumir').addEventListener('click', () => pedir({ tipo: 'assumir' }))
  $('varrer').addEventListener('click', async () => {
    const r = await pedir({ tipo: 'varrer-agora' })
    if (!r?.ok) alert(r?.mensagem ?? 'Não consegui começar a varredura.')
  })
  $('parar').addEventListener('click', () => pedir({ tipo: 'parar-varredura' }))
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name=oque]')) {
    r.addEventListener('change', async () => {
      const e = await lerEstado()
      pedir({ tipo: 'escolher-varredura', fora: e.escolha.fora, oQue: r.value as OQueVarrer })
    })
  }
  // quanto falta por bucket: ao abrir o painel, e a cada 2 min com ele aberto
  pedir({ tipo: 'contar-pendentes' })
  setInterval(() => pedir({ tipo: 'contar-pendentes' }), 120_000)
  $('janela-toa').addEventListener('click', () => pedir({ tipo: 'abrir-janela-toa' }))
  $('sair').addEventListener('click', () => pedir({ tipo: 'sair' }))
  $('abrir').addEventListener('click', () => chrome.tabs.create({ url: 'https://gestor-af.pages.dev/controle/sincronismo' }))
}

iniciar()
