import { CHAVE, lerEstado, type Estado, type Pedido } from './estado'

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

  const log = $('log')
  log.replaceChildren(...e.log.slice(0, 12).map(l => {
    const li = document.createElement('li')
    li.className = l.tom
    li.textContent = `${new Date(l.em).toLocaleTimeString('pt-BR')} ${l.texto}`
    return li
  }))
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
  $('sair').addEventListener('click', () => pedir({ tipo: 'sair' }))
  $('abrir').addEventListener('click', () => chrome.tabs.create({ url: 'https://gestor-af.pages.dev/controle/sincronismo' }))
}

iniciar()
