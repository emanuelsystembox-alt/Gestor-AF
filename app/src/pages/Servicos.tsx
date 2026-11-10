import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { lerLog } from '../lib/log'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, EM_ABERTO, SITUACAO_INFO } from '../lib/supabase'
import { useMudancasAoVivo } from '../lib/tempoReal'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'
import { MenuContrato, type AcaoContrato } from '../components/MenuContrato'
import { dataBR, equipeRotulo, isoLocal, pts } from '../lib/formato'
import { useUltimoDiaComVisita } from '../lib/dia'
import { useLocaisDaBaixa } from '../lib/localBaixa'
import { BotaoAtualizar } from '../components/BotaoAtualizar'
import { NovoContratoModal } from '../components/NovoContratoModal'
import { BarraComposicao } from '../components/telemetria'
import {
  FILTRO_VAZIO, OPCOES_CULPA, OPCOES_ORIGEM, OPCOES_RESULTADO, SEM_JANELA, SEM_SEGMENTO,
  SITUACOES_DE_TELA, clicarSituacao, infoSituacaoDeTela, janelaDe, opcoesDeLog,
  opcoesDeMarcador, passaNoFiltro, situacaoDeTela, situacoesDaUrl, temRevD10,
  type FiltroContrato, type SituacaoDeTela, type SituacaoDoFiltro,
} from '../lib/filtroContratos'
import { tecnologiaTxt } from '../lib/relatorio'
import { SeletorBuckets, opcoesDeBucket } from '../components/SeletorBuckets'
import { SelecaoMultipla, opcoesContadas } from '../components/SelecaoMultipla'
// A linha do contrato e o SELECT que a alimenta moram no componente —
// Serviços e Equipes mostram o mesmo objeto do mesmo jeito (D-095).
import {
  TabelaContratos, SELECT_CONTRATO,
  type ContratoLinha, type PontoVisita,
} from '../components/TabelaContratos'
import { LinkContrato, useAbrirContrato } from '../components/LinkContrato'

const SELECT = SELECT_CONTRATO

/**
 * Quantos contratos por página.
 *
 * > "vamos deixar essa página dos contratos paginada, ex: 1/30 […] de 50
 * >  em 50, quando a operação tiver acima de 50 contratos" — Emanuel
 *
 * ┌─ por que a página é do LADO DE CÁ ───────────────────────────────┐
 * │ Paginar no banco (`range()`) traria 50 linhas e quebraria tudo o  │
 * │ que esta tela faz em cima do conjunto: os nove filtros, a soma de │
 * │ pontos "no filtro", o exportar e o marcar em lote passariam a ver │
 * │ só o pedaço carregado — e continuariam dizendo o total inteiro.   │
 * │ Mentira silenciosa, que é a pior.                                 │
 * │                                                                   │
 * │ Então a consulta continua trazendo o período inteiro e a página é │
 * │ só o RECORTE DA TELA. O custo disso é a consulta: um período      │
 * │ longo carrega muita linha de uma vez. Está medido? Não. Fica      │
 * │ escrito como o próximo lugar a olhar se a tela pesar.             │
 * └───────────────────────────────────────────────────────────────────┘
 */
const POR_PAGINA = 50

/**
 * Quem responde por este contrato.
 *
 * O DECLARADO do técnico primeiro (068); só cai no nome que veio da
 * planilha de equipes quando ninguém declarou. Sem isto, o filtro
 * "Todo supervisor" listava `SUPERVISOR - RAPHAEL FELIPE` para
 * contratos cuja linha já mostrava "Supervisor X" — dois nomes para o
 * mesmo contrato, na mesma tela (D-135).
 */
function supervisorDo(v: V): string | null {
  return v.tecnico?.supervisor?.nome ?? v.equipe?.supervisor_nome ?? null
}

interface Indicador { id: string; nome: string; meta: number; peso: number; ordem: number }
type V = ContratoLinha

/** Onde o navegador guarda "filtros recolhidos" (09/11). */
const CHAVE_RECOLHIDO = 'servicos.filtros.recolhidos'
function lerRecolhido(): boolean {
  try { return localStorage.getItem(CHAVE_RECOLHIDO) === '1' } catch { return false }
}

/**
 * ┌─ 09/11 · o REV D-10 pronto para o grupo do WhatsApp ───────────────┐
 * │ > "ao selecionar revisita 10 dias, o sistema deve mostrar uma      │
 * │ >  opção de mostrar print dos contratos: com quem está, o técnico, │
 * │ >  código de baixa, janela — algo rápido de mandar no grupo"       │
 * │ >  — Emanuel                                                       │
 * │                                                                     │
 * │ É TEXTO copiado, não imagem e não envio: nada sai daqui sozinho, a  │
 * │ pessoa cola onde quiser. LGPD: nada do assinante — nem nome, nem    │
 * │ iniciais, nem telefone, nem endereço. Só o que é da operação.       │
 * │ O *negrito* é o do próprio WhatsApp.                                │
 * └─────────────────────────────────────────────────────────────────────┘
 */
function textoParaWhatsApp(vs: V[], de: string, ate: string): string {
  const periodo = de === ate ? dataBR(de) : `${dataBR(de)} a ${dataBR(ate)}`
  // Mais de um dia na lista: cada bloco diz o seu.
  const variosDias = new Set(vs.map(v => v.data_agendada)).size > 1
  const codigos = (xs: ({ codigo: number; descricao: string } | null)[]) =>
    [...new Set(xs.filter((x): x is { codigo: number; descricao: string } => !!x)
      .map(x => `${x.codigo} · ${x.descricao}`))]
  const blocos = vs.map(v => {
    const toa = codigos(v.ordem_servico.map(o => o.codigo_baixa))
    const afline = codigos(v.ordem_servico.map(o => o.baixa_afline))
    // "falta saber qual é o log, é importante colocar" (Emanuel, 09/11). O mesmo
    // leitor do selo da tabela; sem a coluna no TOA é "sem leitura", não 0.
    const log = lerLog(v.contador_log)
    return [
      `*Contrato ${v.contrato ?? '—'}* · ${log == null ? 'LOG sem leitura do TOA' : `LOG ${log}`}`,
      ...(variosDias ? [`Data: ${dataBR(v.data_agendada)}`] : []),
      `Equipe: ${v.equipe ? equipeRotulo(v.equipe.codigo, v.equipe.nome) : 'sem equipe'}`,
      `Técnico: ${v.tecnico?.nome ?? 'sem técnico'}`,
      `Janela: ${janelaDe(v) ?? (v.janela_imediata ? 'Imediata' : 'sem janela')}`,
      `Situação: ${infoSituacaoDeTela(situacaoDeTela(v)).label}`,
      `Baixa TOA: ${toa.length ? toa.join(' / ') : 'sem baixa'}`,
      ...(afline.length ? [`Baixa AFLINE: ${afline.join(' / ')}`] : []),
    ].join('\n')
  })
  return [`*REV D-10 · ${periodo}* — ${vs.length} contrato${vs.length === 1 ? '' : 's'}`, ...blocos]
    .join('\n\n')
}

/** Copia para a área de transferência. O `execCommand` é o plano B de quando
 *  o navegador recusa a API nova (permissão, foco fora da página). */
async function copiarTexto(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true } catch { /* tenta o plano B */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = texto
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}

/** Teto da busca em massa: o in.(…) vai na URL, e 500 contratos já são ~5 KB. */
const MAX_MASSA = 500

/** Os números de 6+ dígitos de um texto colado, sem repetir. */
function numerosDe(texto: string): string[] {
  return [...new Set(texto.match(/\d{6,}/g) ?? [])]
}

/** Valor para o `in.(…)` do PostgREST: entre aspas, para vírgula não quebrar a lista. */
const lista = (xs: string[]) => xs.map(x => `"${x.replace(/"/g, '')}"`).join(',')

/**
 * ┌─ 162 · o número que a pessoa digitou → o CONTRATO ─────────────────┐
 * │ Até aqui a busca por número só procurava em `contrato`. Quem colava │
 * │ a WO, a O.S. ou o ID da atividade do TOA via a lista vazia — e      │
 * │ concluía que o contrato não existia. Agora o número é procurado nos │
 * │ quatro lugares, e o que volta é o CONTRATO: é por ele que o         │
 * │ histórico se monta (todas as vezes que veio na agenda).            │
 * │ A WO vem como "00696|741543349": casa pelo fim, depois da barra.   │
 * └─────────────────────────────────────────────────────────────────────┘
 */
async function resolverNumeros(nums: string[]): Promise<{ contratos: string[]; ids: string[] }> {
  const filtros = [`contrato.in.(${lista(nums)})`, `toa_atividade_id.in.(${lista(nums)})`]
  // A WO é um `like` por número; numa lista grande isso vira uma URL enorme,
  // e quem cola 300 contratos está colando contratos.
  if (nums.length <= 30) filtros.push(...nums.map(n => `wo_numero.like.*|${n}`))
  const [v, o] = await Promise.all([
    supabase.from('visita').select('id, contrato').is('excluido_em', null).or(filtros.join(',')),
    supabase.from('ordem_servico').select('visita:visita_id ( id, contrato )').in('numero_os', nums),
  ])
  if (v.error) throw new Error(v.error.message)
  if (o.error) throw new Error(o.error.message)
  const achadas = [
    ...((v.data ?? []) as { id: string; contrato: string | null }[]),
    ...((o.data ?? []) as unknown as { visita: { id: string; contrato: string | null } | null }[])
      .map(x => x.visita).filter((x): x is { id: string; contrato: string | null } => !!x),
  ]
  return {
    contratos: [...new Set(achadas.map(a => a.contrato).filter((c): c is string => !!c))],
    // Visita sem contrato (cadastro manual antigo) entra pelo próprio id.
    ids: [...new Set(achadas.filter(a => !a.contrato).map(a => a.id))],
  }
}

/** O número da lista aparece nesta visita? (contrato, WO, atividade ou O.S.) */
function visitaTemNumero(v: V, n: string): boolean {
  return v.contrato === n || v.toa_atividade_id === n
    || !!v.wo_numero?.endsWith(`|${n}`)
    || v.ordem_servico.some(o => o.numero_os === n)
}

export default function Servicos() {
  const [params] = useSearchParams()
  // ┌─ o Dashboard entra aqui pela URL ────────────────────────────────┐
  // │ Clicar em "Cancelada 41" no painel tem de cair nas 41 canceladas │
  // │ DAQUELE período. Sem `de`/`ate` a lista abria em hoje e mostrava │
  // │ outro número — o drill-down mentia sobre o que tinha sido        │
  // │ clicado. Os parâmetros são validados: data fora do formato ou    │
  // │ situação que não existe voltam ao padrão em vez de filtrar por   │
  // │ lixo e devolver tela vazia sem explicação.                      │
  // └──────────────────────────────────────────────────────────────────┘
  const paramData = (chave: string) => {
    const v = params.get(chave)
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
  }
  // HOJE, sempre. Abria no último dia COM visita, e isso fazia a tela
  // mostrar o movimento de ontem sob a data de hoje (ver lib/dia.ts).
  // Dia sem importação aparece VAZIO, que é a informação certa.
  const [de, setDe] = useState(paramData('de') ?? isoLocal())
  const [ate, setAte] = useState(paramData('ate') ?? isoLocal())
  const [linhas, setLinhas] = useState<V[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  // O contrato abre em JANELA, nao em linha expandida (D-056).
  /*
   * ┌─ 155 · o contrato abre na PÁGINA, não mais numa janela ──────────┐
   * │ > "o sistema deve desconsiderar essa tela menor. O ideal é       │
   * │ >  aparecer somente a tela maior (...) ele pode apertar ESC e    │
   * │ >  volta para a tela que estava antes" — Emanuel, 29/10          │
   * │                                                                    │
   * │ A ação escolhida no menu do botão direito viaja no ESTADO da     │
   * │ rota, não na URL: "quero baixar este contrato" é um gesto, não   │
   * │ um endereço para guardar nos favoritos.                           │
   * └────────────────────────────────────────────────────────────────────┘
   */
  // 156: abre POR CIMA da lista (janela com X), levando a lista de fundo.
  const abrirContratoPorCima = useAbrirContrato()
  const abrirContrato = useCallback((visitaId: string, acao?: AcaoContrato) => {
    abrirContratoPorCima(visitaId, acao)
  }, [abrirContratoPorCima])

  // A ação com que o modal abre quando vem do menu (Mudar status, Baixar…).
  // Cadastro manual: o serviço que não veio do TOA precisa entrar
  // mesmo assim, senão não é despachado nem cobrado.
  const [novo, setNovo] = useState(false)
  // Sobe de 1 quando o modal muda algo; os carregamentos ouvem.
  const [versao, setVersao] = useState(0)
  /** Mudanças que chegaram ao vivo enquanto o controlador estava com
   *  contratos marcados. Ver o bloco de tempo real mais abaixo. */
  const [mudancasEmEspera, setMudancasEmEspera] = useState(0)
  /** Quando a lista chegou do banco pela última vez — o botão Atualizar
   *  mostra, para o controlador saber quão velho é o que está vendo. */
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null)

  // filtros — cada um é um CONJUNTO (vazio = todos), ver lib/filtroContratos (05/11)
  // A URL antiga (um valor só, vinda do Dashboard) continua valendo.
  const [situacoes, setSituacoes] = useState<SituacaoDoFiltro[]>(() =>
    params.get('filtro') === 'abertas' ? ['ABERTAS'] : situacoesDaUrl(params.get('situacao')))
  const [busca, setBusca] = useState('')
  const [areas, setAreas] = useState<string[]>([])
  const [supervisores, setSupervisores] = useState<string[]>([])
  const [equipes, setEquipes] = useState<string[]>([])
  const [grupos, setGrupos] = useState<string[]>(() => {
    const g = params.get('grupo')
    return g && g !== 'TODOS' ? [g] : []
  })
  /** 109: separar GPON (Emanuel, 19/10). SEM = sem GPON identificado. */
  const [tecnologias, setTecnologias] = useState<string[]>([])
  const [origens, setOrigens] = useState<string[]>([])
  const [buckets, setBuckets] = useState<string[]>([])
  // 123: segmento do cliente e caso crítico (ouvidoria)
  const [segmentos, setSegmentos] = useState<string[]>([])
  const [soOuvidoria, setSoOuvidoria] = useState(false)
  // D-290: LOG do TOA e REV D-10 (Emanuel, 03/11)
  const [logs, setLogs] = useState<string[]>([])
  const [soRevD10, setSoRevD10] = useState(false)
  const [resultados, setResultados] = useState<FiltroContrato['resultados']>([])
  const [culpas, setCulpas] = useState<string[]>([])
  // 05/11: Janela e Marcador também em Serviços (já existiam em Equipes / na linha)
  const [janelas, setJanelas] = useState<string[]>([])
  const [marcadores, setMarcadores] = useState<string[]>([])
  const [soProdutivas, setSoProdutivas] = useState(true)
  // Quanto a linha mostra. "Detalhada" traz a O.S. e o código de baixa
  // para a própria linha — sem isso o COP precisava abrir uma por uma
  // só para saber por que a visita não fechou.
  const [densidade, setDensidade] = useState<'detalhada' | 'compacta'>('detalhada')
  const detalhada = densidade === 'detalhada'

  // 09/11: "opção de recolher o menu de filtros da tela Serviços para ampliar
  // um pouco mais a tela" (Emanuel). A escolha é da pessoa e fica no navegador
  // dela — sem armazenamento (aba anônima), vale só nesta visita.
  const [recolhido, setRecolhido] = useState(lerRecolhido)

  // ┌─ o quadro ocupa o que SOBRA da janela ─────────────────────────────┐
  // │ "quando encolher o sistema deve ganhar mais tela (...) escolher a  │
  // │  tela serve justamente para isso" (Emanuel, 09/11). A altura era   │
  // │ fixa (100vh − 21rem, pensada com a barra de filtros aberta), e     │
  // │ recolher só abria um buraco embaixo. Agora: do topo do quadro até  │
  // │ o pé da janela, menos o que vem depois dele (paginação, rodapé).   │
  // │ Nenhuma das duas medidas depende da altura do quadro — não há laço.│
  // └─────────────────────────────────────────────────────────────────────┘
  const quadroRef = useRef<HTMLDivElement>(null)
  const [alturaQuadro, setAlturaQuadro] = useState<number | null>(null)
  useLayoutEffect(() => {
    const medir = () => {
      const q = quadroRef.current
      if (!q) return
      // O que vem depois: do pé do quadro ao pé do CONTEÚDO da página (o
      // bloco dentro do <main>). Não o documento — o <main> estica até o pé
      // da janela, e a medida pelo documento virava a altura do próprio quadro.
      const r = q.getBoundingClientRect()
      const pagina = q.closest('main')?.firstElementChild
      const depois = pagina ? pagina.getBoundingClientRect().bottom - r.bottom : 60
      setAlturaQuadro(Math.max(260, Math.floor(window.innerHeight - r.top - depois)))
    }
    medir()
    const ro = new ResizeObserver(medir)
    const main = document.querySelector('main')
    if (main) ro.observe(main)
    window.addEventListener('resize', medir)
    return () => { ro.disconnect(); window.removeEventListener('resize', medir) }
  }, [recolhido])
  useEffect(() => {
    try { localStorage.setItem(CHAVE_RECOLHIDO, recolhido ? '1' : '0') } catch { /* sem armazenamento */ }
  }, [recolhido])

  // Marcadores (indicadores de qualidade) — o analista aponta no contrato
  // qual foi cumprido. Catálogo vem de `indicador_qualidade` (025).
  const [indicadores, setIndicadores] = useState<Indicador[]>([])
  // O menu do contrato: qual linha e onde desenhar. O sistema atual abre
  // onde o mouse esta, nao encostado na borda direita da tabela.
  const [menu, setMenu] = useState<{ v: ContratoLinha; x: number; y: number } | null>(null)
  const fecharMenu = useCallback(() => setMenu(null), [])

  // Selecao em lote. Guarda IDs, nao objetos: a lista e recarregada e
  // objeto novo com conteudo igual nao e o mesmo objeto (D-085).
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [excluindo, setExcluindo] = useState(false)

  useEffect(() => {
    supabase.from('indicador_qualidade')
      .select('id, nome, meta, peso, ordem').eq('ativo', true).order('ordem')
      .then(({ data }) => setIndicadores((data ?? []) as Indicador[]))
  }, [])

  function alternarSelecao(id: string, marcado: boolean) {
    setSelecionados(s => {
      const n = new Set(s)
      if (marcado) n.add(id); else n.delete(id)
      return n
    })
  }

  /**
   * Exclusao em lote — DELETE de verdade (D-101).
   *
   * Duas confirmacoes, porque nao se desfaz: o motivo (que o banco
   * exige) e a palavra APAGAR digitada. Clicar duas vezes em "ok" e
   * facil de fazer sem ler; digitar, nao.
   */
  async function excluirSelecionados() {
    const ids = [...selecionados]
    if (!ids.length) return

    const motivo = prompt(
      `APAGAR ${ids.length} contrato(s) do banco.\n\n`
      + 'Isto NÃO se desfaz: some o contrato, as O.S., o histórico e as fotos.\n'
      + 'Fica registrado quem apagou, quando e por quê.\n\n'
      + 'Informe o motivo:')
    if (!motivo || !motivo.trim()) return

    const confirma = prompt(
      `Última confirmação.\n\n`
      + `${ids.length} contrato(s) serão apagados e não voltam.\n`
      + 'Digite APAGAR para continuar:')
    if ((confirma ?? '').trim().toUpperCase() !== 'APAGAR') return

    setExcluindo(true)
    const { data, error } = await supabase.rpc('excluir_visitas_definitivo',
      { p_visitas: ids, p_motivo: motivo.trim() })
    if (error) {
      setErro(error.message)
    } else {
      const r = data as { apagados: number }
      setErro(null)
      setSelecionados(new Set())
      setVersao(v => v + 1)
      alert(`${r.apagados} contrato(s) apagado(s) do banco.`)
    }
    setExcluindo(false)
  }

  const porIndicador = useMemo(
    () => new Map(indicadores.map(i => [i.id, i])), [indicadores])

  /** O último dia que tem contrato. NÃO é para onde a tela abre — é o
   *  atalho que a tela oferece quando o dia escolhido está vazio. Quem
   *  decide mudar de dia é quem está olhando (ver lib/dia.ts). */
  const ultimoDia = useUltimoDiaComVisita()


  // ---- pontuação do contrato (D-045) ----
  // Uma chamada por período, não uma por linha: `pontos_por_periodo`
  // resolve as ~90 visitas do dia de uma vez.
  const [pontos, setPontos] = useState<Map<string, PontoVisita>>(new Map())

  useEffect(() => {
    if (!de || !ate) return
    supabase.rpc('pontos_por_periodo', { p_de: de, p_ate: ate }).then(({ data }) => {
      const m = new Map<string, PontoVisita>()
      for (const p of (data ?? []) as PontoVisita[]) m.set(p.visita_id, p)
      setPontos(m)
    })
  }, [de, ate, versao])


  // 155: equipes, códigos de baixa e conjunto de sub-falha saíram daqui
  // com a janela do contrato — eram três consultas por abertura de tela
  // que só a janela usava. Quem precisa delas agora é VisitaDetalhe, e
  // ela as carrega sozinha.

  // ---- histórico do contrato (D-069), busca em GRUPO (D-105) e em MASSA (162) ----
  // Um número de contrato inteiro deixa de ser filtro do período e vira
  // a pergunta "o que já aconteceu neste contrato" — o período
  // esconderia justamente as outras visitas.
  //
  // Vários números, separados por espaço, vírgula ou linha, são um
  // GRUPO: o COP cola a lista que recebeu e vê os contratos dela. Aí o
  // período volta a valer por padrão, porque quem cola 40 contratos
  // quase sempre quer o dia (ou o mês) que está na tela — e pode
  // desligar isso num clique.
  //
  // ┌─ 162 · o campo de "Vários contratos" ─────────────────────────────┐
  // │ > "um campo, uma opção onde eu clico e posso colocar mais de um   │
  // │ >  contrato em uma vez para ele pesquisar todos aqueles contratos │
  // │ >  do dia para ele saber o status, e se eu manipular na data ele  │
  // │ >  também pesquisa em outros dias" — Emanuel, 30/10               │
  // │                                                                    │
  // │ Colar 40 números na mesma caixa da busca de texto funcionava pela │
  // │ metade: o filtro de texto procurava a lista INTEIRA ("3148634     │
  // │ 3186579") dentro de cada campo e esvaziava a tela. A lista ganhou  │
  // │ caixa própria; a busca de cima continua livre para estreitar.     │
  // │ Vale o PERÍODO de cima, e trocar a data busca de novo. A tela diz │
  // │ quais números da lista não estão no período — "não veio" é        │
  // │ informação, não lista curta calada.                               │
  // └────────────────────────────────────────────────────────────────────┘
  const [contratosBuscados, setContratosBuscados] = useState<string[]>([])
  /** Na busca por contrato, respeitar o período escolhido em cima. */
  const [contratoNoPeriodo, setContratoNoPeriodo] = useState(false)
  /** 162: a lista colada no campo "Vários contratos" (aplicada). */
  const [massa, setMassa] = useState<string[]>([])
  const [massaAberta, setMassaAberta] = useState(false)
  const [massaTexto, setMassaTexto] = useState('')

  useEffect(() => {
    // Com a lista em massa aplicada, a caixa de cima é só filtro de texto
    // sobre o que a lista trouxe.
    if (massa.length) { setContratosBuscados([]); return }
    const t = busca.trim()
    // Só vale como lista de contrato se a busca for SÓ números e
    // separadores — senão "R JOAO 123456" viraria busca de contrato.
    const soNumeros = t.length > 0 && /^[\d\s,;\n\r.|-]+$/.test(t)
    const alvo = soNumeros ? numerosDe(t) : []
    // Espera o usuário parar de digitar: sem isto, "226803663" dispara
    // nove consultas.
    const id = setTimeout(() => {
      setContratosBuscados(alvo)
      // Um contrato só: histórico completo, como sempre foi.
      // Vários: o padrão é o período da tela.
      if (alvo.length <= 1) setContratoNoPeriodo(false)
      else setContratoNoPeriodo(true)
    }, 350)
    return () => clearTimeout(id)
  }, [busca, massa.length])

  /** Os números que a consulta procura: a lista em massa, ou o que foi digitado. */
  const numeros = massa.length ? massa : contratosBuscados
  const chaveNumeros = numeros.join(',')

  function aplicarMassa() {
    const ns = numerosDe(massaTexto).slice(0, MAX_MASSA)
    setMassa(ns)
    // A lista em massa é "do dia": o período de cima vale.
    setContratoNoPeriodo(true)
    if (ns.length) setMassaAberta(false)
  }
  function limparMassa() {
    setMassa([]); setMassaTexto(''); setMassaAberta(false); setContratoNoPeriodo(false)
  }





  useEffect(() => {
    const nums = chaveNumeros ? chaveNumeros.split(',') : []
    if (!nums.length && (!de || !ate)) return
    let vivo = true
    setCarregando(true); setErro(null)

    ;(async () => {
      try {
        // Número → contratos (162). Sem nada achado, a lista é vazia — e a
        // tela diz quais números não vieram, em vez de mostrar o período.
        let porNumero: string | null = null
        if (nums.length) {
          const { contratos, ids } = await resolverNumeros(nums)
          if (!vivo) return
          const partes = [
            ...(contratos.length ? [`contrato.in.(${lista(contratos)})`] : []),
            ...(ids.length ? [`id.in.(${lista(ids)})`] : []),
          ]
          if (!partes.length) {
            setLinhas([]); setAtualizadoEm(new Date()); setCarregando(false)
            return
          }
          porNumero = partes.join(',')
        }

        // Pagina até acabar: o PostgREST devolve no máximo mil por pedido,
        // e uma semana de Manaus passa disso (D-221). A ordem termina no
        // `id` para a página seguinte não repetir nem pular linha.
        const PAGINA = 1000
        const tudo: V[] = []
        for (let p = 0; p < 30; p++) {
          // Contrato excluido some da lista, mas continua no banco (D-043).
          let q = supabase.from('visita').select(SELECT).is('excluido_em', null)
          if (porNumero) q = q.or(porNumero)
          // O grupo pode ser lido dentro do período ou dia a dia, como o
          // histórico de um contrato só.
          if ((!porNumero || contratoNoPeriodo) && de && ate) {
            q = q.gte('data_agendada', de).lte('data_agendada', ate)
          }
          const { data, error } = await q
            .order('data_agendada', { ascending: false })
            .order('janela_inicio', { ascending: true, nullsFirst: false })
            .order('id')
            .range(p * PAGINA, (p + 1) * PAGINA - 1)
          if (!vivo) return
          if (error) throw new Error(error.message)
          const lote = (data ?? []) as unknown as V[]
          tudo.push(...lote)
          if (lote.length < PAGINA) break
        }
        setLinhas(tudo); setAtualizadoEm(new Date())
      } catch (e) {
        if (vivo) setErro((e as Error).message)
      }
      if (vivo) setCarregando(false)
    })()
    return () => { vivo = false }
  }, [de, ate, versao, chaveNumeros, contratoNoPeriodo])

  /** 162: os números da lista em massa que não vieram nesta consulta. */
  const naoAchados = useMemo(
    () => massa.filter(n => !linhas.some(v => visitaTemNumero(v, n))),
    [massa, linhas])

  /**
   * ┌─ O CONTROLE DEIXA DE CLICAR EM ATUALIZAR ─────────────────────┐
   * │ O técnico sai, chega e baixa; a lista aqui reflete na hora.    │
   * │                                                                 │
   * │ Mas recarregar por baixo de quem está trabalhando é pior que    │
   * │ o botão: se o controlador tem contratos MARCADOS, ele está a    │
   * │ um clique de transferir ou apagar em lote — trocar as linhas    │
   * │ nesse instante é como puxar o papel da mesa.                    │
   * │                                                                 │
   * │ Então: lista com seleção guardava o aviso e deixava ele decidir.│
   * │                                                                 │
   * │ 31/10: agora a lista NUNCA se troca sozinha — com ou sem        │
   * │ seleção. "Não quero que o sistema atualize quando alguém fizer  │
   * │ uma importação" (Emanuel). O tempo real só CONTA o que chegou;  │
   * │ quem recarrega é o Atualizar, ou o relógio que a pessoa ligou   │
   * │ nele (2 ou 5 min).                                              │
   * └─────────────────────────────────────────────────────────────────┘
   */
  const aoVivo = useMudancasAoVivo(quantas => {
    setMudancasEmEspera(n => n + quantas)
  })

  function aplicarMudancas() {
    setMudancasEmEspera(0)
    setVersao(v => v + 1)
  }

  const base = useMemo(() => soProdutivas
    ? linhas.filter(v => v.tipo_atividade?.natureza !== 'JORNADA')
    : linhas, [linhas, soProdutivas])

  // As opções saem do que a lista carregada TEM, com a contagem.
  const opBuckets = useMemo(() => opcoesDeBucket(base), [base])
  const opCliente = useMemo(() => {
    const contratos = base.filter(v => v.tipo_atividade?.natureza !== 'JORNADA')
    const semSegmento = contratos.filter(v => !v.segmentacao?.nome).length
    const semJanela = base.filter(v => !janelaDe(v)).length
    return {
      segmentos: [
        ...opcoesContadas(base, v => v.segmentacao?.nome),
        ...(semSegmento ? [{ valor: SEM_SEGMENTO, rotulo: 'Segmento não informado', qtd: semSegmento }] : []),
      ],
      janelas: [
        ...opcoesContadas(base, janelaDe),
        ...(semJanela ? [{ valor: SEM_JANELA, rotulo: 'Sem janela', qtd: semJanela }] : []),
      ],
      ouvidorias: base.filter(v => v.ouvidoria).length,
      revD10: base.filter(temRevD10).length,
      logs: opcoesDeLog(base),
      marcadores: opcoesDeMarcador(contratos),
    }
  }, [base])

  const filtro = useMemo<FiltroContrato>(() => ({
    ...FILTRO_VAZIO, situacoes, grupos, origens, resultados, culpas, buckets, segmentos, soOuvidoria,
    logs, soRevD10, janelas, marcadores,
  }), [situacoes, grupos, origens, resultados, culpas, buckets, segmentos, soOuvidoria, logs,
       soRevD10, janelas, marcadores])

  /**
   * ┌─ as etiquetas contam o que o FILTRO deixa (24/10) ─────────────────┐
   * │ > "quando eu filtrar os resultados de TODOS, EM ABERTO, NA ENTRADA │
   * │ >  devem mudar" — Emanuel                                          │
   * │                                                                    │
   * │ Contavam sobre `base` (só sem jornada), e a tabela mostrava o      │
   * │ filtrado: "2 buckets" marcados e "Todas 223" na etiqueta. Agora a  │
   * │ conta passa por TODOS os filtros MENOS o da própria situação — com │
   * │ ele, clicar em "Concluída" zeraria as outras etiquetas e não daria │
   * │ para ver para onde ir. A lista é esta, filtrada pela situação.     │
   * └────────────────────────────────────────────────────────────────────┘
   */
  const filtroSemSituacao = useMemo<FiltroContrato>(
    () => ({ ...filtro, situacoes: [] }), [filtro])

  const semSituacao = useMemo(() => {
    // Número(s) digitado(s) em cima já foram resolvidos no servidor (162):
    // filtrar de novo pelo texto apagaria a WO (que aqui tem "00696|") e
    // a lista colada inteira, que não cabe em campo nenhum.
    const t = contratosBuscados.length ? '' : busca.trim().toLowerCase()
    // D-283: número pesquisado em "todas as vezes que veio na agenda" é o
    // HISTÓRICO do contrato — o filtro da lista (bucket, área, equipe…) não
    // corta visita. O histórico do ngestor (D-282) não tem bucket, e o
    // filtro de bucket escondia 2 de 3 visitas do 226670442 (Emanuel, 03/11).
    if (contratosBuscados.length && !contratoNoPeriodo) return base
    return base.filter(v => {
      // Grupo, origem, resultado, responsável, bucket, segmento: a regra é a
      // mesma de Equipes, e mora em um lugar só (lib/filtroContratos).
      if (!passaNoFiltro(v, filtroSemSituacao)) return false
      if (areas.length
        && !areas.some(a => v.area?.apelido === a || v.area?.codigo === a)) return false
      if (supervisores.length && !supervisores.includes(supervisorDo(v) ?? '')) return false
      if (equipes.length && !equipes.includes(v.equipe?.codigo ?? '')) return false
      if (tecnologias.length
        && !tecnologias.includes(v.tecnologia === 'GPON' ? 'GPON' : 'SEM')) return false

      if (!t) return true
      return [
        v.cliente_nome, v.logradouro, v.bairro, v.wo_numero, v.contrato,
        v.toa_atividade_id, v.node, v.equipe?.codigo, v.tecnico?.nome, v.tecnico?.matricula,
        ...v.ordem_servico.map(o => o.numero_os),
        ...v.ordem_servico.map(o => o.codigo_baixa
          ? `${o.codigo_baixa.codigo} ${o.codigo_baixa.descricao}` : ''),
      ].some(x => x?.toLowerCase().includes(t))
    })
  }, [base, filtroSemSituacao, busca, contratosBuscados, contratoNoPeriodo, areas, supervisores,
      equipes, tecnologias])

  const visiveis = useMemo(() => (situacoes.length === 0
    ? semSituacao
    : semSituacao.filter(v => passaNoFiltro(v, filtro))), [semSituacao, filtro, situacoes])

  // ---- paginação ----
  const [pagina, setPagina] = useState(1)
  const paginas = Math.max(1, Math.ceil(visiveis.length / POR_PAGINA))
  // Filtro que muda joga de volta para a primeira: continuar na página 7
  // de um filtro que agora tem 2 páginas é cair num vazio sem explicação.
  useEffect(() => { setPagina(1) },
    [situacoes, busca, areas, supervisores, equipes, grupos, origens, resultados,
     culpas, soProdutivas, de, ate, tecnologias, buckets, segmentos, soOuvidoria, logs, soRevD10,
     janelas, marcadores])
  // A lista pode encolher por baixo (chegou baixa ao vivo, filtro do
  // Realtime): a página nunca passa do fim.
  const paginaAtual = Math.min(pagina, paginas)
  const inicio = (paginaAtual - 1) * POR_PAGINA
  const naPagina = useMemo(
    () => (visiveis.length > POR_PAGINA
      ? visiveis.slice(inicio, inicio + POR_PAGINA)
      : visiveis),
    [visiveis, inicio])

  // Onde baixou (096): só a PÁGINA na tela — 50 contratos, não o mês.
  const locais = useLocaisDaBaixa(naPagina.map(v => v.id), versao)

  const totalPontos = useMemo(
    () => visiveis.reduce((soma, v) => soma + Number(pontos.get(v.id)?.pontos_claro ?? 0), 0),
    [visiveis, pontos])

  // opções derivadas do que está carregado
  // (com a contagem, como os buckets — quantos o período tem de cada)
  const op = useMemo(() => ({
    areas: opcoesContadas(base, v => v.area?.apelido),
    supers: opcoesContadas(base, supervisorDo),
    equipes: opcoesContadas(base, v => v.equipe?.codigo, equipeRotulo),
    grupos: opcoesContadas(base, v => v.tipo_servico?.nome),
    tecnologias: [
      { valor: 'GPON', rotulo: 'Só GPON', qtd: base.filter(v => v.tecnologia === 'GPON').length },
      { valor: 'SEM', rotulo: 'Sem GPON identificado',
        qtd: base.filter(v => v.tecnologia !== 'GPON').length },
    ],
  }), [base])

  // Desatribuído e Cancelado pela central contam à parte de Cancelada
  // (origem, não situação — ver filtroContratos.ts).
  const contagem = useMemo(() => {
    const c: Partial<Record<SituacaoDeTela, number>> = {}
    for (const v of semSituacao) { const s = situacaoDeTela(v); c[s] = (c[s] ?? 0) + 1 }
    return c
  }, [semSituacao])

  /** As fatias da barra de composicao, na ordem do dominio -- da
   *  entrada ao impedimento. Situacao sem nenhuma linha nao vira fatia
   *  de largura zero: ela simplesmente nao esta no dia. */
  const fatias = useMemo(() => SITUACOES_DE_TELA.map(s => ({
    chave: s as string,
    rotulo: infoSituacaoDeTela(s).label,
    cor: infoSituacaoDeTela(s).cor,
    qtd: contagem[s] ?? 0,
  })), [contagem])

  const abertas = semSituacao.filter(v => EM_ABERTO.includes(v.situacao)).length
  // O nome de cada filtro ligado: a conta do "limpar N" e o resumo da barra
  // recolhida saem da mesma lista — recolher não pode esconder que há filtro.
  const conta = (n: number, nome: string) => (n > 1 ? `${nome} (${n})` : nome)
  const filtrosLigados: string[] = [
    situacoes.length
      ? situacoes.map(s => (s === 'ABERTAS' ? 'Em aberto' : infoSituacaoDeTela(s).label)).join(' + ')
      : null,
    grupos.length ? conta(grupos.length, 'Grupo') : null,
    tecnologias.length ? conta(tecnologias.length, 'Tecnologia') : null,
    janelas.length ? conta(janelas.length, 'Janela') : null,
    buckets.length ? conta(buckets.length, 'Bucket') : null,
    areas.length ? conta(areas.length, 'Área') : null,
    supervisores.length ? conta(supervisores.length, 'Supervisor') : null,
    equipes.length ? conta(equipes.length, 'Equipe') : null,
    resultados.length ? conta(resultados.length, 'Resultado') : null,
    culpas.length ? conta(culpas.length, 'Responsável') : null,
    origens.length ? conta(origens.length, 'Origem') : null,
    logs.length ? conta(logs.length, 'LOG') : null,
    marcadores.length ? conta(marcadores.length, 'Marcador') : null,
    segmentos.length ? conta(segmentos.length, 'Segmento') : null,
    soOuvidoria ? 'Ouvidoria' : null,
    soRevD10 ? 'REV D-10' : null,
    busca.trim() ? 'Busca' : null,
  ].filter((x): x is string => !!x)
  const filtrando = filtrosLigados.length

  // 09/11: o REV D-10 para o WhatsApp. Lê `visiveis` (o filtro inteiro, não só a
  // página) e confere o marcador de novo: no histórico de um contrato a lista
  // não passa pelos filtros (D-283).
  const revParaCopiar = useMemo(
    () => (soRevD10 ? visiveis.filter(temRevD10) : []), [soRevD10, visiveis])
  const [copiado, setCopiado] = useState<'ok' | 'erro' | null>(null)
  useEffect(() => {
    if (!copiado) return
    const id = setTimeout(() => setCopiado(null), 2500)
    return () => clearTimeout(id)
  }, [copiado])
  async function copiarParaWhatsApp() {
    if (!revParaCopiar.length) return
    setCopiado(await copiarTexto(textoParaWhatsApp(revParaCopiar, de, ate)) ? 'ok' : 'erro')
  }

  function limpar() {
    setSituacoes([]); setAreas([]); setSupervisores([]); setEquipes([])
    setGrupos([]); setOrigens([]); setResultados([]); setCulpas([]); setBusca('')
    setTecnologias([]); setBuckets([]); setSegmentos([]); setSoOuvidoria(false)
    setLogs([]); setSoRevD10(false); setJanelas([]); setMarcadores([])
  }

  function exportar() {
    const cab = ['Data', 'Janela', 'Situação', 'Grupo', 'Tecnologia', 'Tipo atividade', 'Equipe',
      'Supervisor', 'Área', 'Contrato', 'Segmento', 'Ouvidoria', 'Endereço', 'Bairro', 'O.S.', 'Baixas']
    const linhasCsv = visiveis.map(v => [
      new Date(v.data_agendada + 'T12:00').toLocaleDateString('pt-BR'),
      `${v.janela_inicio?.slice(0, 5) ?? ''}${v.janela_fim ? '-' + v.janela_fim.slice(0, 5) : ''}`,
      SITUACAO_INFO[v.situacao]?.label ?? v.situacao,
      v.tipo_servico?.nome ?? '', tecnologiaTxt(v.tecnologia), v.tipo_atividade?.nome ?? '',
      v.equipe?.codigo ?? '', supervisorDo(v) ?? '', v.area?.apelido ?? '',
      v.contrato ?? '', v.segmentacao?.nome ?? '',
      // 123: vazio quando a linha do TOA não trouxe — não é "não"
      v.ouvidoria == null ? '' : v.ouvidoria ? 'SIM' : 'NÃO',
      v.logradouro ?? '', v.bairro ?? '',
      v.ordem_servico.map(o => o.numero_os).join(' '),
      v.ordem_servico.map(o => o.codigo_baixa
        ? `${o.codigo_baixa.codigo}-${o.codigo_baixa.descricao}` : '').filter(Boolean).join(' | '),
    ])
    const csv = [cab, ...linhasCsv]
      .map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `afline-servicos-${de}${de !== ate ? '-a-' + ate : ''}.csv`
    a.click(); URL.revokeObjectURL(a.href)
  }

  /**
   * `/` foca a busca, `Esc` limpa e sai.
   *
   * O controlador trabalha muito mais rapido no teclado que no mouse --
   * o proprio design system diz isso na regra de foco visivel. Levar a
   * mao ao mouse para clicar num campo de busca que ja esta na tela e o
   * tipo de atrito que custa segundos, 200 vezes por turno.
   */
  const buscaRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null
      const digitando = !!alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)
      if (e.key === '/' && !digitando) {
        e.preventDefault()
        buscaRef.current?.focus()
        buscaRef.current?.select()
      }
      if (e.key === 'Escape' && alvo === buscaRef.current) {
        setBusca('')
        buscaRef.current?.blur()
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [])

  const sel = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs outline-none focus:border-af-500'

  return (
    <Shell acoes={
      <div className="flex items-center gap-1.5">
        <input type="date" value={de} onChange={e => setDe(e.target.value)}
          className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
        <span className="text-xs text-graf-500">a</span>
        <input type="date" value={ate} onChange={e => setAte(e.target.value)}
          className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
        {/* Atualizar = o mesmo que aceitar as mudanças em espera: busca
            de novo e zera o contador. */}
        <BotaoAtualizar aoAtualizar={aplicarMudancas} carregando={carregando}
          atualizadoEm={atualizadoEm} />
        <button onClick={() => setNovo(true)}
          className="ml-1 rounded-md bg-af-600 px-3 py-1 text-xs font-semibold text-white
                     hover:bg-af-500">
          + Nova O.S.
        </button>
      </div>
    }>
      <div className="space-y-3 p-4">
        {erro && <Alerta tipo="erro">Não consegui carregar: {erro}</Alerta>}

        {/* ====== filtros ====== */}
        <section className={`card-controle sobe space-y-2 ${recolhido ? 'px-3 py-2' : 'p-3'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-72 flex-1">
              <input ref={buscaRef} value={busca} onChange={e => setBusca(e.target.value)}
                aria-label="Buscar contrato, cliente, endereço, WO, O.S., node ou matrícula"
                placeholder="Cliente, endereço, WO, contrato, O.S., node, matrícula…"
                className="w-full rounded-md border border-graf-700 bg-graf-900 py-1.5 pl-3 pr-16
                           text-sm outline-none placeholder-graf-500 focus:border-af-500" />
              {/* A tecla fica escrita: atalho que ninguem descobre nao
                  existe. Some quando o campo esta em uso. */}
              {!busca && (
                <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2
                                rounded border border-graf-700 bg-graf-800 px-1.5 py-0.5
                                text-[10px] font-medium text-graf-500">
                  / buscar
                </kbd>
              )}
            </div>
            {/* Recolhido: o resumo do que está ligado — esconder a barra não pode
                esconder que há filtro (09/11). */}
            {recolhido && filtrando > 0 && (
              <span title={filtrosLigados.join(' · ')}
                className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-af-900/30 px-2 py-1
                           text-[11px] text-af-300 ring-1 ring-af-700/40">
                <span className="tabular font-semibold">
                  {filtrando} filtro{filtrando === 1 ? '' : 's'}
                </span>
                <span className="max-w-64 truncate text-graf-200">{filtrosLigados.join(' · ')}</span>
                <button onClick={limpar} className="underline underline-offset-2 hover:text-af-200">
                  limpar
                </button>
              </span>
            )}
            {/* 162: a lista de contratos em massa tem caixa própria. */}
            <button onClick={() => setMassaAberta(a => !a)} aria-expanded={massaAberta}
              className={`rounded-md border px-3 py-1.5 text-xs hover:border-af-600 hover:text-af-400 ${
                massa.length ? 'border-af-600 text-af-400' : 'border-graf-700 text-graf-300'}`}>
              Vários contratos{massa.length > 0 && <span className="tabular"> ({massa.length})</span>}
            </button>
            <button onClick={exportar} disabled={visiveis.length === 0}
              className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400 disabled:opacity-40">
              Exportar {visiveis.length} linhas
            </button>
            {/* 09/11: com o REV D-10 ligado, o texto pronto para o grupo. */}
            {soRevD10 && (
              <button onClick={copiarParaWhatsApp} disabled={revParaCopiar.length === 0}
                aria-live="polite"
                title="Copia contrato, equipe, técnico, janela, situação e código de baixa de cada REV D-10 — sem nome, telefone ou endereço do cliente"
                className={`rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
                  copiado === 'ok' ? 'border-emerald-600 text-emerald-400'
                  : copiado === 'erro' ? 'border-af-600 text-af-400'
                  : 'border-graf-700 text-graf-300 hover:border-af-600 hover:text-af-400'}`}>
                {copiado === 'ok' ? `✓ Copiado (${revParaCopiar.length})`
                  : copiado === 'erro' ? 'Não consegui copiar'
                  : `Copiar ${revParaCopiar.length} para o WhatsApp`}
              </button>
            )}
            {/* Detalhada/Compacta subiu para cá: vale com a barra recolhida também. */}
            <div className="flex rounded-md bg-graf-900 p-0.5">
              {(['detalhada', 'compacta'] as const).map(d => (
                <button key={d} onClick={() => setDensidade(d)}
                  title={d === 'detalhada'
                    ? 'Mostra O.S. e código de baixa na própria linha'
                    : 'Uma linha por visita: o número da baixa, sem a frase'}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                    densidade === d ? 'bg-af-600 text-white' : 'text-graf-400 hover:text-graf-200'}`}>
                  {d === 'detalhada' ? 'Detalhada' : 'Compacta'}
                </button>
              ))}
            </div>
            <button onClick={() => setRecolhido(r => !r)}
              aria-expanded={!recolhido} aria-controls="filtros-servicos"
              title={recolhido ? 'Mostrar os filtros' : 'Recolher os filtros e ganhar espaço para a lista'}
              className="inline-flex items-center gap-1 rounded-md border border-graf-700 px-2.5 py-1.5
                         text-xs text-graf-300 hover:border-af-600 hover:text-af-400">
              <span aria-hidden className={`inline-block transition-transform ${recolhido ? '' : 'rotate-180'}`}>▾</span>
              {recolhido ? 'Filtros' : 'Recolher'}
            </button>
          </div>

          {massaAberta && (
            <div className="space-y-2 rounded-lg border border-graf-700 bg-graf-900/60 p-3">
              <label className="block text-xs text-graf-300" htmlFor="massa-contratos">
                Cole os contratos — um por linha, ou separados por espaço ou vírgula. A busca
                vale para o período escolhido em cima ({dataBR(de)}
                {de !== ate && <> a {dataBR(ate)}</>}); troque a data para ver outros dias.
              </label>
              <textarea id="massa-contratos" value={massaTexto} autoFocus rows={4}
                onChange={e => setMassaTexto(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) aplicarMassa() }}
                placeholder={'3148634\n3186579\n3174830'}
                className="tabular w-full rounded-md border border-graf-700 bg-graf-900 px-3 py-2
                           text-sm outline-none placeholder-graf-600 focus:border-af-500" />
              <div className="flex flex-wrap items-center gap-2">
                {(() => {
                  const n = numerosDe(massaTexto).length
                  return (
                    <>
                      <button onClick={aplicarMassa} disabled={n === 0}
                        className="rounded-md bg-af-600 px-3 py-1.5 text-xs font-semibold text-white
                                   hover:bg-af-500 disabled:opacity-40">
                        Buscar {n} contrato{n === 1 ? '' : 's'}
                      </button>
                      {n > MAX_MASSA && (
                        <span className="text-xs text-amber-400">
                          Só os {MAX_MASSA} primeiros entram — divida a lista.
                        </span>
                      )}
                    </>
                  )
                })()}
                <span className="text-[11px] text-graf-400">Ctrl+Enter também busca</span>
                {massa.length > 0 && (
                  <button onClick={limparMassa}
                    className="ml-auto text-xs text-graf-300 underline underline-offset-2 hover:text-af-400">
                    tirar a lista
                  </button>
                )}
              </div>
            </div>
          )}

          {!recolhido && (<>
          {/* ┌─ 09/11 · a ordem dos filtros ──────────────────────────────┐
              │ "Só ouvidoria e Só REV D-10 deveriam ficar juntos" (Emanuel)│
              │ — estavam separados pelo "Todo LOG". Agora em blocos: o     │
              │ serviço · onde e quem · o resultado · as marcas do contrato │
              │ e, por último, as caixas de marcar, juntas num quadro só.   │
              └─────────────────────────────────────────────────────────────┘ */}
          <div id="filtros-servicos" className="flex flex-wrap items-center gap-2">
            {/* 05/11: todo filtro de lista aceita mais de uma opção (SelecaoMultipla) */}
            {/* o serviço */}
            <SelecaoMultipla rotulo="Grupo de serviço" todos="Todo grupo de serviço" plural="grupos"
              opcoes={op.grupos} valor={grupos} onChange={setGrupos} className={sel} />
            <SelecaoMultipla rotulo="Tecnologia" todos="Toda tecnologia" plural="tecnologias"
              opcoes={op.tecnologias} valor={tecnologias} onChange={setTecnologias} className={sel} />
            <SelecaoMultipla rotulo="Janela" todos="Toda janela" plural="janelas"
              opcoes={opCliente.janelas} valor={janelas} onChange={setJanelas} className={sel} />
            {/* onde e quem */}
            <SeletorBuckets opcoes={opBuckets.buckets} semBucket={opBuckets.semBucket}
              valor={buckets} onChange={setBuckets} className={sel} />
            <SelecaoMultipla rotulo="Área" todos="Toda área" plural="áreas"
              opcoes={op.areas} valor={areas} onChange={setAreas} className={sel} />
            <SelecaoMultipla rotulo="Supervisor" todos="Todo supervisor" plural="supervisores"
              opcoes={op.supers} valor={supervisores} onChange={setSupervisores} className={sel} />
            <SelecaoMultipla rotulo="Equipe" todos="Toda equipe" plural="equipes"
              opcoes={op.equipes} valor={equipes} onChange={setEquipes} className={sel} />
            {/* o resultado */}
            <SelecaoMultipla rotulo="Resultado" todos="Qualquer resultado" plural="resultados"
              opcoes={OPCOES_RESULTADO} valor={resultados}
              onChange={v => setResultados(v as FiltroContrato['resultados'])} className={sel} />
            <SelecaoMultipla rotulo="Responsável pela improdutiva" todos="Qualquer responsável"
              plural="responsáveis" opcoes={OPCOES_CULPA} valor={culpas} onChange={setCulpas}
              className={sel} />
            <SelecaoMultipla rotulo="Origem" todos="Toda origem" plural="origens"
              opcoes={OPCOES_ORIGEM} valor={origens} onChange={setOrigens} className={sel} />
            {/* as marcas do contrato — D-290: o LOG do TOA; 05/11: até "7 ou mais" */}
            <SelecaoMultipla rotulo="LOG do TOA" todos="Todo LOG" plural="LOGs"
              opcoes={opCliente.logs} valor={logs} onChange={setLogs} className={sel} />
            <SelecaoMultipla rotulo="Marcador" todos="Todo marcador" plural="marcadores"
              opcoes={opCliente.marcadores} valor={marcadores} onChange={setMarcadores} className={sel} />
            <SelecaoMultipla rotulo="Segmentação do cliente" todos="Todo segmento" plural="segmentos"
              opcoes={opCliente.segmentos} valor={segmentos} onChange={setSegmentos} className={sel} />
            {/* as caixas de marcar, juntas */}
            <div role="group" aria-label="Recortes rápidos"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-graf-700
                         px-2.5 py-1.5">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-graf-300">
                <input type="checkbox" checked={soOuvidoria} className="accent-af-600"
                  onChange={e => setSoOuvidoria(e.target.checked)} />
                Só ouvidoria <span className="tabular text-graf-400">({opCliente.ouvidorias})</span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-graf-300">
                <input type="checkbox" checked={soRevD10} className="accent-af-600"
                  onChange={e => setSoRevD10(e.target.checked)} />
                Só REV D-10 <span className="tabular text-graf-400">({opCliente.revD10})</span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-graf-300">
                <input type="checkbox" checked={soProdutivas}
                  onChange={e => setSoProdutivas(e.target.checked)} className="accent-af-600" />
                Ocultar jornada
              </label>
            </div>
            {filtrando > 0 && (
              <button onClick={limpar}
                className="text-xs text-af-400 underline underline-offset-2">
                limpar {filtrando} filtro(s)
              </button>
            )}
          </div>

          {/* ====== a composicao do dia ======
              A barra e a proporcao; os botoes sao o comando. 165
              concluidas e 13 canceladas escritas em etiquetas do mesmo
              tamanho parecem numeros vizinhos -- na barra, uma fatia e
              treze vezes a outra, e isso se ve antes de ler.

              A barra e decorativa de proposito (aria-hidden): filtrar
              e trabalho dos botoes abaixo, que tem nome, contagem e
              `aria-pressed`. Fatia de 5% e alvo de clique ruim para
              qualquer pessoa. */}
          <div className="space-y-2 border-t border-graf-800 pt-2.5">
            {/* Com várias pílulas (Ctrl+clique) a barra acende todas elas;
                Em aberto não é fatia, e com ela a barra fica inteira. */}
            <BarraComposicao fatias={fatias}
              ativa={situacoes.includes('ABERTAS') ? null : situacoes} />

            <div className="flex flex-wrap gap-1.5">
              {(['TODAS', 'ABERTAS', ...SITUACOES_DE_TELA] as const).map(s => {
                const n = s === 'TODAS' ? semSituacao.length
                  : s === 'ABERTAS' ? abertas : contagem[s as SituacaoDeTela] ?? 0
                // A pílula marcada não some mesmo zerada: é por ela que se desmarca.
                if (n === 0 && s !== 'TODAS' && s !== 'ABERTAS' && !situacoes.includes(s)) return null
                const ativo = s === 'TODAS' ? situacoes.length === 0 : situacoes.includes(s)
                // A cor do botao e a cor da SITUACAO, nao a da marca:
                // "Concluida" ligada nao pode acender em vermelho.
                const cor = s === 'TODAS' ? 'var(--color-graf-400)'
                  : s === 'ABERTAS' ? 'var(--st-execucao)'
                  : infoSituacaoDeTela(s as SituacaoDeTela).cor
                return (
                  <button key={s} aria-pressed={ativo}
                    onClick={e => setSituacoes(atual => clicarSituacao(atual, s, e.ctrlKey || e.metaKey))}
                    title={s === 'TODAS' ? undefined : 'Ctrl+clique soma'}
                    style={{ ['--pill-cor' as string]: cor }}
                    className={`pill pill-filtro ${ativo ? 'pill-ativo' : 'pill-apagada'}`}>
                    {s === 'TODAS' ? 'Todas' : s === 'ABERTAS' ? 'Em aberto'
                      : infoSituacaoDeTela(s as SituacaoDeTela).label}
                    <span className="tabular font-bold opacity-70">{n}</span>
                  </button>
                )
              })}
            </div>
          </div>
          </>)}
        </section>

        {/* Quando a busca vira histórico de contrato, a tela precisa
            dizer isso — senão o usuário acha que o filtro de data quebrou. */}
        {massa.length > 0 && !carregando && (
          <Alerta tipo={naoAchados.length ? 'aviso' : 'info'}>
            <strong className="tabular">{massa.length}</strong> contrato{massa.length === 1 ? '' : 's'} na
            lista —{' '}
            {contratoNoPeriodo
              ? <>no período escolhido ({dataBR(de)}{de !== ate && <> a {dataBR(ate)}</>}).</>
              : <>em <strong>todas</strong> as datas.</>}
            {' '}
            <strong className="tabular">{massa.length - naoAchados.length}</strong> encontrado
            {massa.length - naoAchados.length === 1 ? '' : 's'}
            {naoAchados.length > 0 && (
              <>, <strong className="tabular">{naoAchados.length}</strong> não{' '}
                {contratoNoPeriodo
                  ? (naoAchados.length === 1 ? 'está neste período' : 'estão neste período')
                  : (naoAchados.length === 1 ? 'existe no sistema' : 'existem no sistema')}:{' '}
                <span className="tabular select-all break-all">{naoAchados.join(', ')}</span></>
            )}.{' '}
            <button onClick={() => setContratoNoPeriodo(p => !p)}
              className="underline underline-offset-2 hover:text-af-400">
              {contratoNoPeriodo ? 'ver todas as datas' : 'limitar ao período'}
            </button>
            {' · '}
            <button onClick={() => setMassaAberta(true)}
              className="underline underline-offset-2 hover:text-af-400">
              editar a lista
            </button>
            {' · '}
            <button onClick={limparMassa}
              className="underline underline-offset-2 hover:text-af-400">
              tirar a lista
            </button>
          </Alerta>
        )}

        {contratosBuscados.length > 0 && (
          <Alerta tipo="info">
            {contratosBuscados.length === 1 ? (
              <>Número <strong className="tabular">{contratosBuscados[0]}</strong></>
            ) : (
              <><strong className="tabular">{contratosBuscados.length}</strong> contratos
                na busca</>
            )}
            {contratoNoPeriodo
              ? <> — mostrando só o que está <strong>no período</strong> escolhido.</>
              : <> — mostrando <strong>todas as vezes que veio na agenda</strong>:{' '}
                  <span className="tabular">{linhas.length}</span> visita{linhas.length === 1 ? '' : 's'}
                  {' '}em <span className="tabular">{new Set(linhas.map(l => l.data_agendada)).size}</span>{' '}
                  dia{new Set(linhas.map(l => l.data_agendada)).size === 1 ? '' : 's'}, fora do período
                  e sem os filtros da lista.</>}
            {' '}
            <button onClick={() => setContratoNoPeriodo(p => !p)}
              className="underline underline-offset-2 hover:text-af-400">
              {contratoNoPeriodo ? 'ver todas as datas' : 'limitar ao período'}
            </button>
            {' · '}
            <button onClick={() => setBusca('')}
              className="underline underline-offset-2 hover:text-af-400">
              limpar
            </button>
          </Alerta>
        )}

        {/* ====== o pulso do tempo real ====== */}
        {/* A bolinha existe para o controlador saber em que mundo ele
            está: verde, a tela se atualiza sozinha; apagada, ele voltou
            a depender do F5 e precisa saber disso. Silêncio de rede é
            indistinguível de silêncio de operação. */}
        <div className="flex flex-wrap items-center gap-3 px-0.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-graf-500">
            <span className={`h-1.5 w-1.5 rounded-full ${
              aoVivo ? 'ponto-vivo bg-emerald-500' : 'bg-graf-600'}`} />
            {aoVivo ? 'ao vivo — avisa as mudanças, a lista só troca quando você atualizar'
                    : 'sem conexão ao vivo — o aviso de mudanças está parado'}
          </span>

          {mudancasEmEspera > 0 && (
            <button
              onClick={aplicarMudancas}
              className="rounded-md bg-af-600 px-2.5 py-1 text-[11px] font-semibold
                         text-white hover:bg-af-500"
            >
              {mudancasEmEspera === 1
                ? '1 mudança no campo — atualizar'
                : `${mudancasEmEspera} mudanças no campo — atualizar`}
            </button>
          )}
        </div>

        {/* ====== tabela ====== */}
        <section className="card-controle sobe sobe-2 overflow-hidden">
          {/* A barra do lote fica FORA do quadro, presa no topo do
              cartao: ela fala das linhas selecionadas, e sumir de vista
              enquanto se rola a lista que ela apaga e o pior lugar
              possivel para um botao que nao se desfaz. */}
          {selecionados.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b border-af-700/40
                            bg-af-900/20 px-4 py-2.5">
              <span className="text-sm font-medium text-af-300">
                {selecionados.size} contrato(s) selecionado(s)
              </span>
              <button onClick={() => setSelecionados(new Set())}
                className="text-xs text-graf-400 underline underline-offset-2
                           hover:text-graf-200">
                limpar seleção
              </button>
              <span className="text-xs text-graf-400">
                apagar aqui é definitivo — não se desfaz
              </span>
              <button onClick={excluirSelecionados} disabled={excluindo}
                className="ml-auto rounded-md bg-af-600 px-4 py-1.5 text-xs font-semibold
                           text-white hover:bg-af-500 disabled:opacity-50">
                {excluindo ? 'Apagando…' : `Apagar ${selecionados.size} do banco`}
              </button>
            </div>
          )}

          {/* O quadro rola por dentro e o cabecalho fica: na segunda
              tela de 265 linhas, a coluna do meio sem cabecalho e um
              numero sem nome. */}
          <div className="quadro" ref={quadroRef}
            style={alturaQuadro ? { ['--quadro-altura' as string]: `${alturaQuadro}px` } : undefined}>
            {/* A caixa do cabeçalho marca O QUE SE VÊ — a página. Antes
                ela marcava o filtro inteiro, e com 1.400 linhas invisíveis
                isso é um botão de apagar em lote apontado para o escuro.
                Para marcar o filtro todo existe o botão explícito na barra
                de páginas, com o número escrito nele. */}
            <TabelaContratos
              linhas={naPagina}
              selecionados={selecionados}
              aoSelecionar={alternarSelecao}
              aoSelecionarTodos={marcado => setSelecionados(
                marcado ? new Set(naPagina.map(v => v.id)) : new Set())}
              detalhada={detalhada}
              pontos={pontos}
              porIndicador={porIndicador}
              locais={locais}
              carregando={carregando}
              aoAbrir={v => abrirContrato(v.id)}
              aoMenuContexto={(v, e) => {
                // Botão direito abre as ações do contrato — é como o COP
                // está acostumado a trabalhar.
                setMenu({ v, x: e.clientX, y: e.clientY })
              }}
              vazio={
                <Vazio
                  titulo={linhas.length === 0
                    ? (de === ate ? `Nenhuma visita em ${dataBR(de)}`
                                  : 'Nenhuma visita neste período')
                    : 'Nenhuma visita para este filtro'}
                  descricao={linhas.length === 0
                    ? 'Dia sem importação aparece vazio — e vazio aqui quer dizer'
                      + ' que ainda não chegou nada, não que deu erro.'
                    : `${base.length} carregadas, nenhuma passa nos ${filtrando} filtro(s).`}
                  acao={linhas.length === 0
                    ? <div className="flex flex-wrap items-center justify-center gap-2">
                        <Link to="/controle/importar"
                          className="rounded-lg bg-af-600 px-4 py-2 text-sm font-medium text-white
                                     hover:bg-af-500">Importar planilha</Link>
                        {/* O atalho para o último dia com movimento existe,
                            mas quem clica é o usuário: a tela não troca a
                            data dele por conta própria. */}
                        {ultimoDia && ultimoDia !== de && (
                          <button onClick={() => { setDe(ultimoDia); setAte(ultimoDia) }}
                            className="rounded-lg border border-graf-700 px-4 py-2 text-sm
                                       text-graf-300 hover:border-af-600 hover:text-af-400">
                            ver {dataBR(ultimoDia)} — último dia com movimento
                          </button>
                        )}
                      </div>
                    : <button onClick={limpar}
                        className="rounded-lg border border-graf-700 px-4 py-2 text-sm
                                   text-graf-300 hover:border-af-600">Limpar filtros</button>} />
              }
              renderAcoes={v => (
                <div className="flex items-center justify-end gap-1">
                  <LinkContrato to={`/controle/visita/${v.id}`} onClick={e => e.stopPropagation()}
                    className="rounded border border-graf-700 px-2 py-0.5 text-[11px]
                               text-graf-400 hover:border-af-600 hover:text-af-400">
                    abrir
                  </LinkContrato>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      setMenu(menu?.v.id === v.id ? null : { v, x: e.clientX, y: e.clientY })
                    }}
                    title="Ações do contrato"
                    className="rounded border border-graf-700 px-1.5 py-0.5 text-[11px]
                               leading-none text-graf-400 hover:border-af-600
                               hover:text-af-400">
                    ⋯
                  </button>
                </div>
              )}
            />
          </div>

          {/* Só existe quando há o que paginar (D-151). Abaixo de 50
              contratos a barra seria ruído: uma página de uma. */}
          {visiveis.length > POR_PAGINA && (
            <nav aria-label="Páginas de contratos"
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t
                         border-graf-800 px-4 py-2.5 text-xs">
              <span className="tabular text-graf-400">
                {inicio + 1}–{Math.min(inicio + POR_PAGINA, visiveis.length)}
                {' de '}{visiveis.length}
              </span>

              <span className="ml-auto flex items-center gap-1.5">
                <button onClick={() => setPagina(1)} disabled={paginaAtual === 1}
                  aria-label="Primeira página"
                  className="rounded-md border border-graf-700 px-2 py-1 text-graf-300
                             hover:border-af-600 hover:text-af-400 disabled:opacity-35
                             disabled:hover:border-graf-700 disabled:hover:text-graf-300">
                  «
                </button>
                <button onClick={() => setPagina(p => Math.max(1, p - 1))}
                  disabled={paginaAtual === 1} aria-label="Página anterior"
                  className="rounded-md border border-graf-700 px-2.5 py-1 text-graf-300
                             hover:border-af-600 hover:text-af-400 disabled:opacity-35
                             disabled:hover:border-graf-700 disabled:hover:text-graf-300">
                  ‹ anterior
                </button>

                {/* O "1/30" que ele pediu, e que também é o campo de pulo:
                    com 30 páginas, clicar 14 vezes em "próxima" é trabalho. */}
                <span className="tabular flex items-center gap-1 px-1 text-graf-200"
                  aria-current="page">
                  <label className="sr-only" htmlFor="pagina-atual">Ir para a página</label>
                  <input id="pagina-atual" type="number" min={1} max={paginas}
                    value={paginaAtual}
                    onChange={e => {
                      const n = Number(e.target.value)
                      if (Number.isFinite(n)) setPagina(Math.min(paginas, Math.max(1, n)))
                    }}
                    className="tabular w-12 rounded-md border border-graf-700 bg-graf-900
                               px-1.5 py-1 text-center outline-none focus:border-af-500" />
                  <span className="text-graf-400">/ {paginas}</span>
                </span>

                <button onClick={() => setPagina(p => Math.min(paginas, p + 1))}
                  disabled={paginaAtual === paginas} aria-label="Próxima página"
                  className="rounded-md border border-graf-700 px-2.5 py-1 text-graf-300
                             hover:border-af-600 hover:text-af-400 disabled:opacity-35
                             disabled:hover:border-graf-700 disabled:hover:text-graf-300">
                  próxima ›
                </button>
                <button onClick={() => setPagina(paginas)} disabled={paginaAtual === paginas}
                  aria-label="Última página"
                  className="rounded-md border border-graf-700 px-2 py-1 text-graf-300
                             hover:border-af-600 hover:text-af-400 disabled:opacity-35
                             disabled:hover:border-graf-700 disabled:hover:text-graf-300">
                  »
                </button>
              </span>

              {/* Marcar além do que se vê só acontece dizendo o número. */}
              <button
                onClick={() => setSelecionados(
                  selecionados.size === visiveis.length
                    ? new Set()
                    : new Set(visiveis.map(v => v.id)))}
                className="w-full text-left text-[11px] text-af-400 underline
                           underline-offset-2 sm:w-auto">
                {selecionados.size === visiveis.length
                  ? 'desmarcar tudo'
                  : `marcar os ${visiveis.length} do filtro, não só esta página`}
              </button>
            </nav>
          )}
        </section>

        <p className="pb-6 text-center text-xs text-graf-600">
          {visiveis.length > POR_PAGINA && (
            <>página {paginaAtual} de {paginas} · </>
          )}
          {visiveis.length} de {base.length} visitas
          {totalPontos > 0 && (
            <> · <strong className="tabular text-emerald-400">
              {pts(totalPontos)}
            </strong> CLARO no filtro</>
          )}
          {soProdutivas && linhas.length !== base.length &&
            ` · ${linhas.length - base.length} apontamentos de jornada ocultos`}
        </p>
      </div>

      {novo && (
        <NovoContratoModal
          onFechar={() => setNovo(false)}
          onCriado={id => {
            setNovo(false)
            setVersao(x => x + 1)
            // Abre o contrato recém-criado: quem cadastrou quase sempre
            // quer conferir ou já atribuir equipe.
            abrirContrato(id)
          }}
        />
      )}

      {menu && (
        <MenuContrato v={menu.v} xy={menu} aoFechar={fecharMenu}
          aoEscolher={acao => abrirContrato(menu.v.id, acao)} />
      )}

    </Shell>
  )
}
