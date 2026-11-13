import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { useCentral, type Sinal } from './central'
import { destino } from '../components/PainelCentral'

/**
 * A fila "O que fazer agora" (263, D-378) — fase 3 do pacote preditivo.
 *
 * Junta as duas fontes SEM recalcular nada:
 *  · o banco (`o_que_fazer_agora`): TEC1 que dá para salvar, equipe de VT atrasada na
 *    régua, risco alto de revisita, o que não cabe na jornada;
 *  · o sino (`useCentral().sinais`, já com vigência e dispensa): pessoa esperando, node
 *    em degradação e o sincronismo.
 * A ordem dos grupos é a do Emanuel (13/11): pessoa → TEC1 → atraso → rede → revisita →
 * o resto. Dentro do grupo, a ordem que o banco devolveu (o mais urgente primeiro); no sino,
 * quem espera há mais tempo primeiro.
 */

export type GrupoFila = 1 | 2 | 3 | 4 | 5 | 6
export const GRUPO_FILA: Record<GrupoFila, { rotulo: string; cor: string }> = {
  1: { rotulo: 'Pessoa esperando', cor: 'var(--st-conflito)' },
  2: { rotulo: 'TEC1', cor: 'var(--st-reagendamento)' },
  3: { rotulo: 'Régua da VT', cor: '#f97316' },
  4: { rotulo: 'Rede da CLARO', cor: '#84cc16' },
  5: { rotulo: 'Revisita', cor: '#a855f7' },
  6: { rotulo: 'Jornada e sincronismo', cor: 'var(--color-graf-500)' },
}

/** Tipos do sino que entram na fila, e em que grupo. */
const SINAL_GRUPO: Partial<Record<Sinal['tipo'], GrupoFila>> = {
  AJUDA: 1, GPS: 1, SUMIU_TOA: 1, DOIS_ATIVOS: 1,
  NODE_DEGRADACAO: 4,
  SEM_IMPORTACAO: 6, TOA_SESSAO: 6, SEM_COMPUTADOR: 6, EXECUCAO_LONGA: 6,
}

export interface ItemFila {
  chave: string; grupo: GrupoFila; tipo: string
  titulo: string; detalhe: string | null
  /** para onde o clique leva */
  link: string | null
  equipe: string | null; tecnico: string | null
  /** do sino: dispensa pelo sino; do banco: pela `fila_dispensa` */
  sinalId?: number
}

interface DoBanco {
  agora: string; dia: string; cidade: string | null; meta: number
  tec1: { previsto_pct: number | null; salvar: number } | null
  itens: {
    chave: string; grupo: GrupoFila; tipo: string; titulo: string; detalhe: string | null
    visita_id?: string; link?: string; equipe?: string | null; tecnico?: string | null
  }[]
}

export function useFilaAgora() {
  const { sinais, dispensar: dispensarSinais } = useCentral()
  const [banco, setBanco] = useState<DoBanco | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [escondidos, setEscondidos] = useState<Set<string>>(new Set())

  const carregar = useCallback(() => {
    setCarregando(true)
    supabase.rpc('o_que_fazer_agora').then(({ data, error }) => {
      setCarregando(false)
      if (error) { setErro(error.message); return }
      setErro(null); setBanco(data as DoBanco)
    })
  }, [])
  // A previsão muda com o relógio: relê a cada 2 minutos.
  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 120_000)
    return () => clearInterval(t)
  }, [carregar])

  const itens = useMemo<ItemFila[]>(() => {
    const doSino: ItemFila[] = sinais
      .filter(s => s.vigente && !s.dispensado && SINAL_GRUPO[s.tipo] != null)
      .sort((a, b) => a.criado_em.localeCompare(b.criado_em))
      .map(s => ({
        chave: `SINAL:${s.id}`, grupo: SINAL_GRUPO[s.tipo]!, tipo: s.tipo,
        titulo: s.titulo, detalhe: s.detalhe, link: destino(s),
        equipe: s.equipe ?? null, tecnico: null, sinalId: s.id,
      }))
    const doBanco: ItemFila[] = (banco?.itens ?? []).map(i => ({
      chave: i.chave, grupo: i.grupo, tipo: i.tipo, titulo: i.titulo, detalhe: i.detalhe,
      link: i.visita_id ? `/controle/visita/${i.visita_id}` : i.link ?? null,
      equipe: i.equipe ?? null, tecnico: i.tecnico ?? null,
    }))
    // sort estável: dentro do grupo fica a ordem de cada fonte
    return [...doSino, ...doBanco]
      .filter(i => !escondidos.has(i.chave))
      .sort((a, b) => a.grupo - b.grupo)
  }, [sinais, banco, escondidos])

  const dispensar = useCallback((i: ItemFila) => {
    setEscondidos(s => new Set(s).add(i.chave))
    if (i.sinalId != null) dispensarSinais([i.sinalId])
    else supabase.rpc('dispensar_item_da_fila', { p_chave: i.chave }).then(({ error }) => {
      if (error) {
        setErro(error.message)
        setEscondidos(s => { const n = new Set(s); n.delete(i.chave); return n })
      }
    })
  }, [dispensarSinais])

  return { itens, banco, erro, carregando, carregar, dispensar }
}
