import { useEffect, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import * as Updates from 'expo-updates'
import { supabase } from './supabase'

/**
 * Geo-Rota (130): os colegas por perto e a conversa entre técnicos.
 *
 * ┌─ o que o técnico vê dos colegas, e o que NÃO vê ──────────────────┐
 * │ Só a ÚLTIMA posição (nunca a trilha) de quem é da mesma cidade,   │
 * │ está em rota hoje, foi visto há até 30 min e deu "Estou ciente"   │
 * │ do texto v2 do rastro. Quem decide isso é o BANCO                 │
 * │ (`colegas_por_perto`); a tela só desenha o que voltou.            │
 * │                                                                   │
 * │ A conversa com o colega é lida pelos dois e pela gestão (escolha  │
 * │ do Emanuel, 24/10). O autor é carimbado pelo servidor (D-061).    │
 * └───────────────────────────────────────────────────────────────────┘
 */

export interface Colega {
  tecnico_id: string
  nome: string
  equipe: string | null
  lat: number
  lng: number
  precisao_m: number | null
  visto_em: string
  /** Nulo quando o celular não tinha posição para medir. */
  distancia_m: number | null
}

export interface MensagemColega {
  id: number
  de_tecnico_id: string
  para_tecnico_id: string
  texto: string
  criado_em: string
  lida_em: string | null
}

export async function carregarColegas(lat?: number, lng?: number): Promise<Colega[]> {
  const { data, error } = await supabase.rpc('colegas_por_perto', {
    p_lat: lat ?? null, p_lng: lng ?? null,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as Colega[]
}

export async function carregarConversaColega(eu: string, colega: string): Promise<MensagemColega[]> {
  const { data, error } = await supabase.from('mensagem_colega')
    .select('id, de_tecnico_id, para_tecnico_id, texto, criado_em, lida_em')
    .or(`and(de_tecnico_id.eq.${eu},para_tecnico_id.eq.${colega}),and(de_tecnico_id.eq.${colega},para_tecnico_id.eq.${eu})`)
    .order('criado_em', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  return ((data ?? []) as MensagemColega[]).reverse()
}

export async function enviarAoColega(colega: string, texto: string): Promise<void> {
  const { error } = await supabase.rpc('enviar_ao_colega', { p_para: colega, p_texto: texto })
  if (error) throw new Error(error.message)
}

export async function marcarColegaLida(colega: string): Promise<void> {
  await supabase.rpc('marcar_colega_lida', { p_colega: colega })
}

/** Assina o que chega PARA mim (filtro no servidor: um aparelho por mensagem).
 *  Devolve o cancelamento — chamar no cleanup não é opcional. */
export function assinarMensagensColega(eu: string, aoChegar: (m: MensagemColega) => void): () => void {
  let canal: RealtimeChannel | null = null
  let vivo = true
  supabase.auth.getSession().then(({ data }) => {
    if (!vivo) return
    if (data.session) supabase.realtime.setAuth(data.session.access_token)
    canal = supabase
      .channel(`colega:${eu}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mensagem_colega', filter: `para_tecnico_id=eq.${eu}` },
        carga => aoChegar(carga.new as MensagemColega))
      .subscribe()
  })
  return () => { vivo = false; if (canal) supabase.removeChannel(canal) }
}

/** Quantas mensagens de colegas ele não leu — o selo da aba Geo. */
export function useNaoLidasColegas(eu: string | null): number | null {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    if (!eu) return
    let vivo = true
    const contar = () => {
      supabase.from('mensagem_colega').select('id', { count: 'exact', head: true })
        .eq('para_tecnico_id', eu).is('lida_em', null)
        .then(({ count, error }) => { if (vivo) setN(error ? null : count ?? 0) })
    }
    contar()
    const parar = assinarMensagensColega(eu, contar)
    return () => { vivo = false; parar() }
  }, [eu])
  return n
}

/**
 * O mapa é peça NATIVA (`react-native-maps`). O APK 0.3.0 não tem — e
 * carregar a tela nele fecharia o app. Por isso a tela só existe onde a
 * peça existe: no Expo Go (updates desligado) e no APK 0.4.0 em diante
 * (a política de runtime é a versão do app).
 */
export function temMapaNativo(): boolean {
  if (!Updates.isEnabled) return true
  const r = Updates.runtimeVersion
  if (!r) return false
  const [ma, mi] = r.split('.').map(x => Number(x) || 0)
  return ma > 0 || mi >= 4
}
