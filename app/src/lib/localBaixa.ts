import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Onde a baixa foi dada, e a que distância da casa do cliente (096).
 *
 * > "técnicos precisam baixar no local, temos que ver o raio na tela de
 * >  contratos ou equipe quando ele baixar" — Emanuel, 27/09
 *
 * Vem de `local_da_baixa`, que devolve por contrato o registro do campo
 * MAIS LONGE do endereço (baixa de O.S. ou encerramento): basta uma
 * afirmação feita de longe para "baixou no local?" ser não. A conta é
 * feita na leitura, não guardada — se o TOA corrigir a coordenada do
 * endereço, a distância acompanha.
 *
 * Desde a 135 há DUAS fontes: o registro do campo (APP) e, para a baixa
 * feita no TOA, o RASTRO do celular. Desde a 155h o ponto do rastro é o
 * MAIS PERTO DO CLIENTE durante a execução inteira (início − 10 min até
 * fim + 10 min), e não mais o mais perto da hora da baixa: o técnico
 * baixa no TOA muitas vezes já no carro, e a pergunta é se ele ESTEVE
 * lá. Até 200 m (menor ou igual) é dentro — Emanuel, 29/10.
 *
 * Três ausências que NÃO são "dentro do raio" (regra 6):
 *   · sem linha aqui          → não houve registro do campo nem ponto de
 *                               rastro perto da hora da baixa;
 *   · `distancia_m` nulo      → o endereço veio sem coordenada do TOA;
 *   · `precisao_m` nulo       → versão do app anterior à 096.
 */
export interface LocalBaixa {
  visita_id: string
  em: string
  tipo: string
  login: string | null
  lat: number
  lng: number
  precisao_m: number | null
  cliente_lat: number | null
  cliente_lng: number | null
  distancia_m: number | null
  raio_m: number
  fora_do_raio: boolean | null
  registros: number
  registros_fora: number
  /** De onde saiu a posição (135): APP = registro do campo com GPS;
   *  RASTRO = o ponto do rastro mais perto do cliente durante a
   *  execução, quando a baixa foi no TOA (155h). */
  fonte: 'APP' | 'RASTRO'
  /** Quantos minutos separam esse ponto da hora da baixa. Só no RASTRO.
   *  No RASTRO, `registros` é quantos pontos houve na execução. */
  minutos_do_ponto: number | null
}

/** O PostgREST aceita a lista no corpo do POST; em lote para não
 *  mandar 2.000 uuids numa chamada quando Serviços abre um mês. */
const LOTE = 400

export async function carregarLocais(ids: string[]): Promise<Map<string, LocalBaixa>> {
  const m = new Map<string, LocalBaixa>()
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await supabase.rpc('local_da_baixa', { p_visitas: ids.slice(i, i + LOTE) })
    if (error) throw error
    for (const l of (data ?? []) as LocalBaixa[]) m.set(l.visita_id, l)
  }
  return m
}

/** Carrega os locais das visitas na tela. `versao` força recarregar. */
export function useLocaisDaBaixa(ids: string[], versao = 0): Map<string, LocalBaixa> {
  const [m, setM] = useState<Map<string, LocalBaixa>>(new Map())
  // A chave é o conjunto, não a referência do array: a lista é refeita a
  // cada render e isso recarregaria sem parar.
  const chave = ids.join(',')
  useEffect(() => {
    if (!chave) { setM(new Map()); return }
    let vivo = true
    carregarLocais(chave.split(','))
      .then(r => { if (vivo) setM(r) })
      .catch(() => { if (vivo) setM(new Map()) })
    return () => { vivo = false }
  }, [chave, versao])
  return m
}

/** "35 m", "1,2 km". */
export function textoDistancia(m: number | null | undefined): string {
  if (m == null) return '—'
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`
}

/** Link do Google Maps com o ponto da baixa e o endereço — para o
 *  controlador ver os dois lados sem sair da tela. */
export function linkMapaDaBaixa(l: LocalBaixa): string {
  if (l.cliente_lat != null && l.cliente_lng != null) {
    return `https://www.google.com/maps/dir/?api=1&origin=${l.lat},${l.lng}&destination=${l.cliente_lat},${l.cliente_lng}&travelmode=walking`
  }
  return `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`
}

/** Distância em metros entre dois pontos (Haversine) — a mesma conta de
 *  `distancia_m` no banco e de `distanciaM` no aplicativo. */
export function metrosEntre(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const rad = (g: number) => (g * Math.PI) / 180
  const s = Math.sin(rad(bLat - aLat) / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(s)))
}
