import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * A prova do contrato (136).
 *
 * > "ele precisa enviar 3 evidências em cada contrato concluído para
 * >  gerar pontuação para ele" — Emanuel, 25/10
 *
 * Contrato CONCLUÍDO sem as 3 evidências não pontua PARA O TÉCNICO — a
 * conta da empresa não muda, porque o serviço foi feito e é faturado.
 * Cancelado e reagendado não pontuam de qualquer jeito: ali a cobrança
 * (1 evidência) é só de prova.
 *
 * Os pontos que esperam foto NÃO viram zero: viram "esperando prova",
 * com o prazo escrito (regra 6). O prazo é até o fim do dia seguinte,
 * e é parâmetro — quem muda é a AFLINE.
 */
export interface Prova {
  visita_id: string
  evidencias: number
  /** Quantas a situação exige. 0 = não se cobra prova nesta situação. */
  minimo: number
  falta: number
  prazo_ate: string
  no_prazo: boolean
  cobra_prova: boolean
  pontua_tecnico: boolean
  /** Expurgo do ADMIN: TECNICO (só a conta dele) ou TODOS. */
  expurgo: 'TECNICO' | 'TODOS' | null
  expurgo_motivo: string | null
}

/** Mesmo lote do `local_da_baixa`: a tela de Serviços abre o mês inteiro. */
const LOTE = 400

export async function carregarProvas(ids: string[]): Promise<Map<string, Prova>> {
  const m = new Map<string, Prova>()
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await supabase.rpc('prova_das_visitas', { p_visitas: ids.slice(i, i + LOTE) })
    if (error) throw error
    for (const p of (data ?? []) as Prova[]) m.set(p.visita_id, p)
  }
  return m
}

export function useProvas(ids: string[], versao = 0): Map<string, Prova> {
  const [m, setM] = useState<Map<string, Prova>>(new Map())
  // A chave é o conjunto, não a referência do array (a lista é refeita a
  // cada render e isso recarregaria sem parar).
  const chave = ids.join(',')
  useEffect(() => {
    if (!chave) { setM(new Map()); return }
    let vivo = true
    carregarProvas(chave.split(','))
      .then(r => { if (vivo) setM(r) })
      .catch(() => { if (vivo) setM(new Map()) })
    return () => { vivo = false }
  }, [chave, versao])
  return m
}

/** O texto curto que a tela mostra. Nulo = nada a dizer sobre prova. */
export function recadoDaProva(p: Prova | undefined): string | null {
  if (!p) return null
  if (p.expurgo) {
    return p.expurgo === 'TODOS'
      ? 'pontuação expurgada pelo ADMIN (de todos)'
      : 'pontuação expurgada pelo ADMIN (do técnico)'
  }
  if (!p.cobra_prova) return null
  return p.no_prazo
    ? `faltam ${p.falta} de ${p.minimo} evidências — até ${new Date(p.prazo_ate + 'T12:00').toLocaleDateString('pt-BR')}`
    : `ficou sem as ${p.minimo} evidências (prazo encerrado)`
}
