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
  DESATRIBUIDO: { label: 'Desatribuído', cor: '#8a8178', origem: 'sumiu da planilha do TOA (cód. 800)' },
  CANCELADO_CENTRAL: { label: 'Cancelado pela central', cor: '#b65a55', origem: 'cancelado pela central no TOA' },
}

type ParaOrigem = Pick<ContratoLinha, 'situacao' | 'status_toa'> & {
  ordem_servico: { baixa_afline?: { codigo: number } | null }[]
}

/** De onde veio o cancelamento — nulo quando não é um dos dois menus. */
export function origemCancelada(v: ParaOrigem): OrigemCancelada | null {
  if (v.situacao !== 'CANCELADA') return null
  if (v.ordem_servico.some(o => o.baixa_afline?.codigo === 800)) return 'DESATRIBUIDO'
  if ((v.status_toa ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase() === 'CANCELADO') {
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

export interface FiltroContrato {
  situacao: SituacaoDeTela | 'TODAS' | 'ABERTAS'
  grupo: string                 // 'TODOS' ou o nome do grupo de serviço
  origem: string                // 'TODAS' | 'TOA' | 'MANUAL'
  resultado: 'TODOS' | 'SUCESSO' | 'IMPRODUTIVA' | 'SEM_BAIXA'
  culpa: string                 // 'TODAS' ou a responsabilidade da improdutiva
  /** 'TODAS', uma chave de `janelaDe`, ou SEM_JANELA. */
  janela: string
  /** 'TODOS', o "Status da Atividade" como veio do TOA, ou SEM_STATUS. */
  statusToa: string
  /** Os buckets do TOA marcados (119). Vazio = todos; SEM_BUCKET = manual. */
  buckets: string[]
  /** Segmentação do cliente: 'TODOS', o nome, ou SEM_SEGMENTO (o TOA não disse). */
  segmento: string
  /** Só os casos críticos de ouvidoria (123). */
  soOuvidoria: boolean
}

export const SEM_JANELA = '__sem_janela__'
export const SEM_STATUS = '__sem_status__'
export const SEM_BUCKET = '__sem_bucket__'
export const SEM_SEGMENTO = '__sem_segmento__'

export const FILTRO_VAZIO: FiltroContrato = {
  situacao: 'TODAS', grupo: 'TODOS', origem: 'TODAS', resultado: 'TODOS',
  culpa: 'TODAS', janela: 'TODAS', statusToa: 'TODOS', buckets: [],
  segmento: 'TODOS', soOuvidoria: false,
}

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

export function passaNoFiltro(v: ContratoLinha, f: FiltroContrato): boolean {
  if (f.situacao === 'ABERTAS' && !EM_ABERTO.includes(v.situacao)) return false
  if (f.situacao !== 'TODAS' && f.situacao !== 'ABERTAS' && situacaoDeTela(v) !== f.situacao) return false
  if (f.grupo !== 'TODOS' && v.tipo_servico?.nome !== f.grupo) return false
  if (f.origem !== 'TODAS' && v.origem !== f.origem) return false
  if (f.buckets.length && !f.buckets.includes(v.toa_bucket ?? SEM_BUCKET)) return false
  if (f.soOuvidoria && !v.ouvidoria) return false
  if (f.segmento !== 'TODOS') {
    const s = v.segmentacao?.nome ?? null
    if (f.segmento === SEM_SEGMENTO ? s !== null : s !== f.segmento) return false
  }

  if (f.janela !== 'TODAS') {
    const j = janelaDe(v)
    if (f.janela === SEM_JANELA ? j !== null : j !== f.janela) return false
  }
  // O status do TOA é comparado como VEIO — é a palavra da operadora, e
  // a opção do filtro sai do próprio dado carregado.
  if (f.statusToa !== 'TODOS') {
    const s = v.status_toa?.trim() || null
    if (f.statusToa === SEM_STATUS ? s !== null : s !== f.statusToa) return false
  }

  if (f.resultado !== 'TODOS') {
    const comBaixa = v.ordem_servico.filter(o => o.codigo_baixa)
    if (f.resultado === 'SEM_BAIXA' && comBaixa.length > 0) return false
    if (f.resultado === 'SUCESSO'
      && !v.ordem_servico.some(o => o.codigo_baixa?.natureza === 'SUCESSO')) return false
    if (f.resultado === 'IMPRODUTIVA'
      && !v.ordem_servico.some(o => o.codigo_baixa?.natureza === 'IMPRODUTIVA')) return false
  }
  if (f.culpa !== 'TODAS'
    && !v.ordem_servico.some(o => o.codigo_baixa?.responsabilidade === f.culpa)) return false

  return true
}
