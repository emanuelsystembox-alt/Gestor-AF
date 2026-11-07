import { EM_ABERTO, SITUACOES, SITUACAO_INFO, type Situacao } from './supabase'
import type { ContratoLinha } from '../components/TabelaContratos'

/**
 * O filtro de CONTRATO, um só para Serviços e Equipes.
 *
 * ┌─ por que saiu de dentro de Serviços ────────────────────────────┐
 * │ > "vamos colocar os filtros no menu equipes, inclusive de       │
 * │ >  janela, status entre outros" — Emanuel, 23/09               │
 * │                                                                 │
 * │ A regra morava inline em `Servicos.tsx`. Copiá-la para Equipes  │
 * │ seria o caminho de "Com improdutiva" querer dizer uma coisa     │
 * │ numa tela e outra na vizinha no dia em que alguém mexer em uma  │
 * │ só. É o mesmo motivo da linha de contrato única (D-095).        │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Aqui mora só o que é do CONTRATO. Área, supervisor, equipe e a busca
 * livre ficam em cada tela: em Equipes eles escolhem a equipe, não o
 * contrato.
 */
/**
 * ┌─ Desatribuído e Cancelado pela central: ORIGEM, não situação ─────┐
 * │ > "temos que adicionar outro menu chamado desatribuído (...) se ele│
 * │ >  for importado no novo relatório e o contrato não existe mais    │
 * │ >  deve ir pra aí como desatribuído 800 ok, contrato com status    │
 * │ >  cancelados pela central no TOA devem ir para o menu cancelados  │
 * │ >  pela central (...) eu preciso saber a origem" — Emanuel, 24/10  │
 * │                                                                    │
 * │ No banco os três são CANCELADA, e continuam: pontos, TEC1, rela-   │
 * │ tórios e a trava de situação terminal não mudam. A tela separa     │
 * │ pela origem, que o dado já diz:                                    │
 * │  · DESATRIBUIDO — a baixa da AFLINE tem o 800 (sumiu da planilha   │
 * │    do bucket, 116/D-191);                                          │
 * │  · CANCELADO_CENTRAL — a planilha trouxe "Status da Atividade" =   │
 * │    cancelado (a central cancelou no TOA, sem código);              │
 * │  · o resto segue CANCELADA (cancelado por código: 302, 301…).      │
 * │ Medido nos 7 dias até 24/10: 86 / 126 / 75.                        │
 * └────────────────────────────────────────────────────────────────────┘
 */
export type OrigemCancelada = 'DESATRIBUIDO' | 'CANCELADO_CENTRAL'
export type SituacaoDeTela = Situacao | OrigemCancelada

export const ORIGEM_CANCELADA_INFO: Record<OrigemCancelada, { label: string; cor: string; origem: string }> = {
  // 138: "vamos mudar esse status para AUDITAR, esse status serve para
  // verificar o que houve de fato com ele" (Emanuel, 25/10). Só o rótulo
  // muda — o código de baixa 800 continua "Desatribuído" no cadastro,
  // porque é ele que explica o que aconteceu. A cor saiu do cinza: o
  // status agora pede AÇÃO de alguém, e cinza apagado não pede nada.
  DESATRIBUIDO: { label: 'Auditar', cor: '#b08640',
                  origem: 'sumiu da planilha do TOA (cód. 800) — conferir o que houve' },
  CANCELADO_CENTRAL: { label: 'Cancelado pela central', cor: '#b65a55', origem: 'cancelado pela central no TOA' },
}

type ParaOrigem = Pick<ContratoLinha, 'situacao' | 'status_toa'> & {
  ordem_servico: { baixa_afline?: { codigo: number } | null }[]
  motivo_fechamento_toa?: string | null
  /** 208 (D-306): o COP afirmou pela baixa que a central cancelou. */
  cancelado_central_em?: string | null
}

const semAcento = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()

/** De onde veio o cancelamento — nulo quando não é um dos dois menus.
 *  198 (D-289): "Cancelado no Sistema NETSMS" (vem com "não concluído") também
 *  é cancelado pela central — a mesma regra de `cancelado_pela_central()` no banco. */
export function origemCancelada(v: ParaOrigem): OrigemCancelada | null {
  if (v.situacao !== 'CANCELADA') return null
  if (v.ordem_servico.some(o => o.baixa_afline?.codigo === 800)) return 'DESATRIBUIDO'
  // 208 (D-306): a marca do site vale como o TOA — no banco, a mesma
  // troca foi feita nas funções que separam o cancelado pela central.
  if (v.cancelado_central_em) return 'CANCELADO_CENTRAL'
  const motivo = semAcento(v.motivo_fechamento_toa)
  if (semAcento(v.status_toa) === 'CANCELADO'
      || motivo.includes('CANCELADO NO SISTEMA')
      // 227 (D-338): o "Liberado no Sistema NETSMS" também — fora o que o TOA concluiu
      || (motivo.includes('LIBERADO NO SISTEMA') && semAcento(v.status_toa) !== 'CONCLUIDO')) {
    return 'CANCELADO_CENTRAL'
  }
  return null
}

/** A situação como as etiquetas de filtro contam. */
export const situacaoDeTela = (v: ParaOrigem): SituacaoDeTela =>
  origemCancelada(v) ?? (v.situacao as Situacao)

/** A ordem das etiquetas: os dois menus novos logo depois de Cancelada. */
export const SITUACOES_DE_TELA: SituacaoDeTela[] = SITUACOES.flatMap(s =>
  s === 'CANCELADA' ? ['CANCELADA', 'CANCELADO_CENTRAL', 'DESATRIBUIDO'] as SituacaoDeTela[] : [s])

export function infoSituacaoDeTela(s: SituacaoDeTela): { label: string; cor: string } {
  return s in ORIGEM_CANCELADA_INFO
    ? ORIGEM_CANCELADA_INFO[s as OrigemCancelada]
    : SITUACAO_INFO[s as Situacao] ?? { label: s, cor: '#64748b' }
}

export const ehSituacaoDeTela = (s: string | null): s is SituacaoDeTela =>
  !!s && (SITUACOES_DE_TELA as string[]).includes(s)

/** O que a pílula de situação marca: uma situação de tela ou "Em aberto". */
export type SituacaoDoFiltro = SituacaoDeTela | 'ABERTAS'

/**
 * ┌─ cada filtro é um CONJUNTO de valores (05/11) ───────────────────┐
 * │ > "ambos o filtro tem que dar liberdade de selecionar mais de uma │
 * │ >  opção do filtro" · "o time pudesse filtrar mais de uma        │
 * │ >  situação de status, segurando control" — Emanuel, 05/11       │
 * │                                                                   │
 * │ Até aqui cada campo guardava UM valor e um "TODOS" de sentinela.  │
 * │ Agora é lista: vazia = todos (o mesmo dos buckets, 119), e o     │
 * │ contrato passa se casar com QUALQUER valor marcado. O significado │
 * │ de cada valor não mudou — "Cancelado pela central" e "Auditar"    │
 * │ continuam saindo de `origemCancelada()`, "Com improdutiva" da     │
 * │ natureza do código. Só "um" virou "um destes".                    │
 * └───────────────────────────────────────────────────────────────────┘
 */
export interface FiltroContrato {
  /** Pílulas de situação. Vazio = Todas; 'ABERTAS' = Em aberto. */
  situacoes: SituacaoDoFiltro[]
  /** Nomes do grupo de serviço. */
  grupos: string[]
  /** 'TOA' | 'MANUAL'. */
  origens: string[]
  resultados: ('SUCESSO' | 'IMPRODUTIVA' | 'SEM_BAIXA')[]
  /** A responsabilidade da improdutiva (TECNICO, CLIENTE…). */
  culpas: string[]
  /** Chaves de `janelaDe`, ou SEM_JANELA. */
  janelas: string[]
  /** O "Status da Atividade" como veio do TOA, ou SEM_STATUS. */
  statusToa: string[]
  /** Os buckets do TOA marcados (119). SEM_BUCKET = manual. */
  buckets: string[]
  /** Segmentação do cliente: o nome, ou SEM_SEGMENTO (o TOA não disse). */
  segmentos: string[]
  /** Só os casos críticos de ouvidoria (123). */
  soOuvidoria: boolean
  /** D-290: o "Contador de log" do TOA, pela faixa de `faixaDeLog`. */
  logs: string[]
  /** D-290: só os contratos com o marcador REV D-10 (automático ou manual). */
  soRevD10: boolean
  /** Os marcadores (`indicador_id`) — o contrato tem ao menos um deles —, ou SEM_MARCADOR. */
  marcadores: string[]
}

export const SEM_JANELA = '__sem_janela__'
export const SEM_STATUS = '__sem_status__'
export const SEM_BUCKET = '__sem_bucket__'
export const SEM_SEGMENTO = '__sem_segmento__'
export const SEM_LOG = '__sem_log__'
export const SEM_MARCADOR = '__sem_marcador__'

export const FILTRO_VAZIO: FiltroContrato = {
  situacoes: [], grupos: [], origens: [], resultados: [], culpas: [], janelas: [],
  statusToa: [], buckets: [], segmentos: [], soOuvidoria: false, logs: [],
  soRevD10: false, marcadores: [],
}

/** O LOG do contrato como número; nulo quando o TOA não mandou ("log ?"). */
export function logDe(v: Pick<ContratoLinha, 'contador_log'>): number | null {
  const n = Number.parseInt(String(v.contador_log ?? '').trim(), 10)
  return Number.isFinite(n) ? n : null
}

/**
 * As faixas do filtro de LOG: 0 a 6 um a um, "7 ou mais" e "Sem LOG".
 * > "o log deve ir até o 7 quando houver o filtro, e deve dar opção de
 * >  selecionar mais de um" — Emanuel, 05/11
 * Antes parava em "2 ou mais". Medido nos 30 dias até 05/11: LOG 3 em 12
 * visitas e LOG 4 em 3 — iam todas para o mesmo balaio do LOG 2.
 */
export const LOG_TETO = 7
export const FAIXAS_LOG: string[] = [
  ...Array.from({ length: LOG_TETO }, (_, i) => String(i)), `${LOG_TETO}+`, SEM_LOG,
]
export function faixaDeLog(n: number | null): string {
  return n === null ? SEM_LOG : n >= LOG_TETO ? `${LOG_TETO}+` : String(n)
}
export const rotuloFaixaLog = (f: string) =>
  f === SEM_LOG ? 'Sem LOG' : f.endsWith('+') ? `LOG ${f.slice(0, -1)} ou mais` : `LOG ${f}`

/** Tem o marcador REV D-10 (193) — o nome vem no embed de `visita_marcador`. */
export const temRevD10 = (v: Pick<ContratoLinha, 'visita_marcador'>) =>
  (v.visita_marcador ?? []).some(m => m.indicador?.nome === 'REV D-10')

/** `08:00–12:00` — a janela como a coluna Janela escreve. Nula quando o
 *  contrato não tem janela; aí o filtro usa SEM_JANELA. */
export function janelaDe(v: Pick<ContratoLinha, 'janela_inicio' | 'janela_fim'>): string | null {
  if (!v.janela_inicio) return null
  return `${v.janela_inicio.slice(0, 5)}–${v.janela_fim?.slice(0, 5) ?? '?'}`
}

/** Quantos campos do filtro estão ligados — para o "limpar N filtro(s)". */
export function quantosLigados(f: FiltroContrato): number {
  return (Object.keys(FILTRO_VAZIO) as (keyof FiltroContrato)[])
    // lista compara pelo tamanho: [] novo não é "ligado"
    .filter(k => Array.isArray(f[k]) ? (f[k] as string[]).length > 0 : f[k] !== FILTRO_VAZIO[k]).length
}

/**
 * O clique na pílula de situação. Simples: só ela (como sempre foi).
 * Com Ctrl (Cmd no Mac): soma ou tira da seleção. "Todas" limpa.
 */
export function clicarSituacao(
  atual: SituacaoDoFiltro[], s: SituacaoDoFiltro | 'TODAS', somar: boolean,
): SituacaoDoFiltro[] {
  if (s === 'TODAS') return []
  if (!somar) return [s]
  return atual.includes(s) ? atual.filter(x => x !== s) : [...atual, s]
}

/** Lê `?situacao=` da URL: um valor só (como os links antigos mandam) ou
 *  vários separados por vírgula. O que não for situação é ignorado. */
export function situacoesDaUrl(bruto: string | null): SituacaoDoFiltro[] {
  return (bruto ?? '').split(',').map(s => s.trim())
    .filter((s): s is SituacaoDoFiltro => s === 'ABERTAS' || ehSituacaoDeTela(s))
}

/** A situação passa nas pílulas marcadas? Vazio = todas. */
export function passaNaSituacao(v: ContratoLinha, situacoes: SituacaoDoFiltro[]): boolean {
  if (!situacoes.length) return true
  const tela = situacaoDeTela(v)
  return situacoes.some(s => s === 'ABERTAS' ? EM_ABERTO.includes(v.situacao) : s === tela)
}

export function passaNoFiltro(v: ContratoLinha, f: FiltroContrato): boolean {
  if (!passaNaSituacao(v, f.situacoes)) return false
  if (f.grupos.length && !f.grupos.includes(v.tipo_servico?.nome ?? '')) return false
  if (f.origens.length && !f.origens.includes(v.origem ?? '')) return false
  if (f.buckets.length && !f.buckets.includes(v.toa_bucket ?? SEM_BUCKET)) return false
  if (f.soOuvidoria && !v.ouvidoria) return false
  if (f.soRevD10 && !temRevD10(v)) return false
  if (f.logs.length && !f.logs.includes(faixaDeLog(logDe(v)))) return false
  if (f.segmentos.length && !f.segmentos.includes(v.segmentacao?.nome ?? SEM_SEGMENTO)) return false
  if (f.janelas.length && !f.janelas.includes(janelaDe(v) ?? SEM_JANELA)) return false
  if (f.marcadores.length) {
    const ms = (v.visita_marcador ?? []).map(m => m.indicador_id)
    const casa = f.marcadores.some(k => k === SEM_MARCADOR ? ms.length === 0 : ms.includes(k))
    if (!casa) return false
  }
  // O status do TOA é comparado como VEIO — é a palavra da operadora, e
  // a opção do filtro sai do próprio dado carregado.
  if (f.statusToa.length && !f.statusToa.includes(v.status_toa?.trim() || SEM_STATUS)) return false

  if (f.resultados.length) {
    const casa = f.resultados.some(r =>
      r === 'SEM_BAIXA' ? !v.ordem_servico.some(o => o.codigo_baixa)
      : v.ordem_servico.some(o => o.codigo_baixa?.natureza === r))
    if (!casa) return false
  }
  if (f.culpas.length
    && !v.ordem_servico.some(o => f.culpas.includes(o.codigo_baixa?.responsabilidade ?? ''))) return false

  return true
}

/** As opções de LOG com a contagem de cada faixa. "Sem LOG" só conta
 *  contrato (a jornada não tem LOG, e não é por falta do TOA). */
export function opcoesDeLog(cs: ContratoLinha[]): { valor: string; rotulo: string; qtd: number }[] {
  const m = new Map<string, number>()
  for (const v of cs) {
    const f = faixaDeLog(logDe(v))
    if (f === SEM_LOG && v.tipo_atividade?.natureza === 'JORNADA') continue
    m.set(f, (m.get(f) ?? 0) + 1)
  }
  return FAIXAS_LOG
    .filter(f => f !== SEM_LOG || (m.get(f) ?? 0) > 0)
    .map(f => ({ valor: f, rotulo: rotuloFaixaLog(f), qtd: m.get(f) ?? 0 }))
}

/** As opções de marcador: os que aparecem nos contratos, com a contagem,
 *  e "Sem marcador" quando algum contrato não tem nenhum. */
export function opcoesDeMarcador(cs: ContratoLinha[]): { valor: string; rotulo: string; qtd: number }[] {
  const m = new Map<string, { nome: string; qtd: number }>()
  let sem = 0
  for (const v of cs) {
    const ms = v.visita_marcador ?? []
    if (!ms.length) { sem++; continue }
    for (const id of new Set(ms.map(x => x.indicador_id))) {
      const nome = ms.find(x => x.indicador_id === id)?.indicador?.nome ?? 'Marcador sem nome'
      const a = m.get(id) ?? { nome, qtd: 0 }
      a.qtd++; m.set(id, a)
    }
  }
  return [
    ...[...m.entries()].map(([valor, x]) => ({ valor, rotulo: x.nome, qtd: x.qtd }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
    ...(sem > 0 ? [{ valor: SEM_MARCADOR, rotulo: 'Sem marcador', qtd: sem }] : []),
  ]
}

/** Os rótulos fixos dos filtros que não saem do dado. */
export const OPCOES_RESULTADO: { valor: FiltroContrato['resultados'][number]; rotulo: string }[] = [
  { valor: 'SUCESSO', rotulo: 'Com O.S. executada' },
  { valor: 'IMPRODUTIVA', rotulo: 'Com improdutiva' },
  { valor: 'SEM_BAIXA', rotulo: 'Sem baixa ainda' },
]
export const OPCOES_CULPA = [
  { valor: 'TECNICO', rotulo: 'Improdutiva nossa' },
  { valor: 'CLIENTE', rotulo: 'Improdutiva do cliente' },
  { valor: 'REDE', rotulo: 'Improdutiva de rede' },
  { valor: 'OPERADORA', rotulo: 'Improdutiva da operadora' },
  { valor: 'TERCEIRO', rotulo: 'Improdutiva de terceiro' },
]
export const OPCOES_ORIGEM = [
  { valor: 'TOA', rotulo: 'TOA' },
  { valor: 'MANUAL', rotulo: 'Manual' },
]
