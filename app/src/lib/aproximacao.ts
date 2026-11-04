import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * A que distância o técnico está da casa do cliente, ao vivo (190).
 *
 * > "quando o contrato estiver em deslocamento, em execução, o sistema deve
 * >  atualizar em tempo real a localização do técnico com relação a casa do
 * >  assinante (...) se a localização mapeada está no raio de 200 metros"
 * >  — Emanuel, 03/11
 *
 * Vem de `aproximacao_do_tecnico`: o último ponto do rastro e o de pelo
 * menos 2 min antes, os dois medidos até o endereço. A tela compara os dois
 * (chegando / se afastando / parado) e diz a idade do ponto — o rastro só
 * anda com o app aberto no Expo Go, e ponto velho não é "onde ele está".
 * O local do ENCERRAMENTO continua sendo o de `local_da_baixa`.
 */
export interface Aproximacao {
  visita_id: string
  situacao: 'EM_DESLOCAMENTO' | 'EM_EXECUCAO'
  ponto_em: string
  lat: number
  lng: number
  precisao_m: number | null
  motivo: string | null
  cliente_lat: number | null
  cliente_lng: number | null
  distancia_m: number | null
  antes_em: string | null
  distancia_antes_m: number | null
  raio_m: number
  no_raio: boolean | null
}

/** De quanto em quanto a tela pergunta de novo (o app manda ponto a cada 2 min andando). */
const INTERVALO_MS = 60_000

export function useAproximacao(ids: string[]): Map<string, Aproximacao> {
  const [m, setM] = useState<Map<string, Aproximacao>>(new Map())
  const chave = ids.join(',')
  useEffect(() => {
    if (!chave) { setM(new Map()); return }
    let vivo = true
    const carregar = () => {
      if (document.visibilityState !== 'visible') return
      supabase.rpc('aproximacao_do_tecnico', { p_visitas: chave.split(',') }).then(({ data, error }) => {
        if (!vivo || error) return
        setM(new Map(((data ?? []) as Aproximacao[]).map(a => [a.visita_id, a])))
      })
    }
    carregar()
    const t = window.setInterval(carregar, INTERVALO_MS)
    document.addEventListener('visibilitychange', carregar)
    return () => {
      vivo = false
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', carregar)
    }
  }, [chave])
  return m
}

export type Tendencia = 'CHEGANDO' | 'AFASTANDO' | 'PARADO' | null

/** Variação menor que isso (ou que a precisão do GPS) é ruído, não movimento. */
const RUIDO_M = 50

export function tendencia(a: Aproximacao): { tipo: Tendencia; delta: number | null } {
  if (a.distancia_m == null || a.distancia_antes_m == null) return { tipo: null, delta: null }
  const delta = a.distancia_m - a.distancia_antes_m
  if (Math.abs(delta) < Math.max(RUIDO_M, a.precisao_m ?? 0)) return { tipo: 'PARADO', delta }
  return { tipo: delta < 0 ? 'CHEGANDO' : 'AFASTANDO', delta }
}

/** Minutos desde o último ponto. */
export const idadeMin = (a: Aproximacao, agora = Date.now()) =>
  Math.max(0, Math.round((agora - new Date(a.ponto_em).getTime()) / 60000))
