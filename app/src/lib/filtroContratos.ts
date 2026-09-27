import { EM_ABERTO, type Situacao } from './supabase'
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
export interface FiltroContrato {
  situacao: Situacao | 'TODAS' | 'ABERTAS'
  grupo: string                 // 'TODOS' ou o nome do grupo de serviço
  origem: string                // 'TODAS' | 'TOA' | 'MANUAL'
  resultado: 'TODOS' | 'SUCESSO' | 'IMPRODUTIVA' | 'SEM_BAIXA'
  culpa: string                 // 'TODAS' ou a responsabilidade da improdutiva
  /** 'TODAS', uma chave de `janelaDe`, ou SEM_JANELA. */
  janela: string
  /** 'TODOS', o "Status da Atividade" como veio do TOA, ou SEM_STATUS. */
  statusToa: string
}

export const SEM_JANELA = '__sem_janela__'
export const SEM_STATUS = '__sem_status__'

export const FILTRO_VAZIO: FiltroContrato = {
  situacao: 'TODAS', grupo: 'TODOS', origem: 'TODAS', resultado: 'TODOS',
  culpa: 'TODAS', janela: 'TODAS', statusToa: 'TODOS',
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
    .filter(k => f[k] !== FILTRO_VAZIO[k]).length
}

export function passaNoFiltro(v: ContratoLinha, f: FiltroContrato): boolean {
  if (f.situacao === 'ABERTAS' && !EM_ABERTO.includes(v.situacao)) return false
  if (f.situacao !== 'TODAS' && f.situacao !== 'ABERTAS' && v.situacao !== f.situacao) return false
  if (f.grupo !== 'TODOS' && v.tipo_servico?.nome !== f.grupo) return false
  if (f.origem !== 'TODAS' && v.origem !== f.origem) return false

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
