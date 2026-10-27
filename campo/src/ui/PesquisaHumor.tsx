import { useCallback, useEffect, useState } from 'react'
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { isoLocal } from '../lib/formato'
import { Aviso, Botao } from './componentes'
import { cor, raio, TOQUE_GRANDE } from './tema'

/**
 * Como você está hoje? (146, D-226)
 *
 * > "toda vez que o técnico logar depois das 6 horas da manhã, todos os
 * > dias o sistema deve mostrar uma pesquisa de como o técnico se sente
 * > naquele dia […] O técnico não poderá pular esta etapa"
 * > — Emanuel, 26/10
 *
 * ┌─ obrigatória, mas não refém do sinal ─────────────────────────────┐
 * │ Não tem "pular": a folha só sai com uma resposta. Mas a resposta  │
 * │ dada SEM INTERNET não prende o técnico do lado de fora do dia de  │
 * │ trabalho: fica numa fila no aparelho, com o dia e a hora em que   │
 * │ ele tocou, e sobe quando o sinal voltar (o banco aceita hoje ou   │
 * │ ontem — `registrar_humor`). O que é obrigatório é RESPONDER.      │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * Antes das 6h não pergunta. O app aberto que atravessa as 6h (ou a
 * meia-noite) pergunta na hora: o relógio é conferido a cada minuto e a
 * cada volta do segundo plano.
 *
 * Quem lê a resposta: só a coordenação (permissão `campo.humor`). O texto
 * da folha diz isso — o técnico tem de saber quem vê.
 */

export type Humor = 'FELIZ' | 'INDIFERENTE' | 'DESANIMADO' | 'TRISTE' | 'ESTRESSADO'

const OPCOES: { humor: Humor; rotulo: string; rosto: string }[] = [
  { humor: 'FELIZ',       rotulo: 'Feliz',       rosto: '😀' },
  { humor: 'INDIFERENTE', rotulo: 'Indiferente', rosto: '😐' },
  { humor: 'DESANIMADO',  rotulo: 'Desanimado',  rosto: '😔' },
  { humor: 'TRISTE',      rotulo: 'Triste',      rosto: '😢' },
  { humor: 'ESTRESSADO',  rotulo: 'Estressado',  rosto: '😤' },
]

const HORA_INICIO = 6

interface NaFila { humor: Humor; dia: string; em: string }

const chaveDia = (usuario: string, dia: string) => `humor:${usuario}:${dia}`
const chaveFila = (usuario: string) => `humor:fila:${usuario}`

/** "2026-10-26|1" — string, e não objeto: objeto novo a cada minuto
 *  re-renderizaria o app inteiro à toa (D-085). */
function momento(): string {
  const d = new Date()
  return `${isoLocal(d)}|${d.getHours() >= HORA_INICIO ? 1 : 0}`
}

const semRede = (msg: string) => /network|fetch|internet|timeout/i.test(msg)

async function lerFila(usuario: string): Promise<NaFila[]> {
  try { return JSON.parse((await AsyncStorage.getItem(chaveFila(usuario))) ?? '[]') as NaFila[] }
  catch { return [] }
}

/** Sobe o que ficou sem sinal. O que o banco recusar de vez (não é rede)
 *  sai da fila: tentar para sempre não conserta resposta inválida. */
async function descarregarFila(usuario: string) {
  const fila = await lerFila(usuario)
  if (fila.length === 0) return
  const resta: NaFila[] = []
  for (const r of fila) {
    const { error } = await supabase.rpc('registrar_humor', {
      p_humor: r.humor, p_dia: r.dia, p_respondido_em: r.em,
    })
    if (error && semRede(error.message)) resta.push(r)
  }
  await AsyncStorage.setItem(chaveFila(usuario), JSON.stringify(resta)).catch(() => {})
}

/** `pendente` é true quando a folha tem de aparecer agora. */
export function useHumorDoDia(usuarioId: string | null, ativo: boolean) {
  const [pendente, setPendente] = useState(false)
  const [agora, setAgora] = useState(momento)

  useEffect(() => {
    if (!ativo) return
    const t = setInterval(() => setAgora(momento()), 60_000)
    const s = AppState.addEventListener('change', st => { if (st === 'active') setAgora(momento()) })
    return () => { clearInterval(t); s.remove() }
  }, [ativo])

  useEffect(() => {
    if (!ativo || !usuarioId) { setPendente(false); return }
    const [dia, depois] = agora.split('|')
    if (depois !== '1') { setPendente(false); return }
    let vivo = true
    ;(async () => {
      await descarregarFila(usuarioId).catch(() => {})
      // O aparelho lembra (abre sem internet); o banco é a prova.
      const local = await AsyncStorage.getItem(chaveDia(usuarioId, dia)).catch(() => null)
      if (local) { if (vivo) setPendente(false); return }
      const { data, error } = await supabase.rpc('humor_de_hoje')
      if (!vivo) return
      if (!error && data) {
        await AsyncStorage.setItem(chaveDia(usuarioId, dia), String(data)).catch(() => {})
        setPendente(false)
        return
      }
      // Sem resposta no banco — ou sem como perguntar: pergunta. Responder
      // duas vezes no mesmo dia não faz mal (a primeira vale).
      setPendente(true)
    })()
    return () => { vivo = false }
  }, [usuarioId, ativo, agora])

  const responder = useCallback(async (humor: Humor): Promise<string | null> => {
    if (!usuarioId) return 'Sem login.'
    const dia = isoLocal()
    const em = new Date().toISOString()
    const { error } = await supabase.rpc('registrar_humor', {
      p_humor: humor, p_dia: dia, p_respondido_em: em,
    })
    if (error) {
      if (!semRede(error.message)) return error.message
      const fila = await lerFila(usuarioId)
      await AsyncStorage.setItem(chaveFila(usuarioId),
        JSON.stringify([...fila, { humor, dia, em }])).catch(() => {})
    }
    await AsyncStorage.setItem(chaveDia(usuarioId, dia), humor).catch(() => {})
    setPendente(false)
    return null
  }, [usuarioId])

  return { pendente, responder }
}

export function PesquisaHumor({ visivel, aoResponder }: {
  visivel: boolean
  aoResponder: (h: Humor) => Promise<string | null>
}) {
  const [escolha, setEscolha] = useState<Humor | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => { if (visivel) { setEscolha(null); setErro(null) } }, [visivel])

  return (
    // onRequestClose vazio: o "voltar" do Android não fecha. Não há pular.
    <Modal visible={visivel} animationType="slide" transparent onRequestClose={() => {}}>
      <View style={e.fundo}>
        <ScrollView contentContainerStyle={e.centro}>
          <View style={e.caixa}>
            <Text style={e.titulo}>Como você está hoje?</Text>
            <Text style={e.texto}>
              Uma pergunta por dia, antes de começar. Responda com sinceridade: só a
              coordenação da AFLINE vê a resposta.
            </Text>

            <View style={e.opcoes} accessibilityRole="radiogroup">
              {OPCOES.map(o => {
                const marcada = escolha === o.humor
                return (
                  <Pressable key={o.humor} onPress={() => setEscolha(o.humor)}
                    accessibilityRole="radio" accessibilityState={{ checked: marcada }}
                    accessibilityLabel={o.rotulo}
                    style={[e.opcao, marcada && e.opcaoMarcada]}>
                    <Text style={e.rosto}>{o.rosto}</Text>
                    <Text style={[e.rotulo, marcada && { color: cor.branco }]}>{o.rotulo}</Text>
                  </Pressable>
                )
              })}
            </View>

            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <Botao titulo="Responder" grande desativado={!escolha} carregando={salvando}
              aoTocar={async () => {
                if (!escolha) return
                setSalvando(true); setErro(null)
                const r = await aoResponder(escolha)
                setSalvando(false)
                if (r) setErro(r)
              }} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

const e = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(15,17,21,0.6)' },
  centro: { flexGrow: 1, justifyContent: 'center', padding: 18 },
  caixa: { backgroundColor: cor.branco, borderRadius: 20, padding: 20, gap: 12 },
  titulo: { fontSize: 21, fontWeight: '800', color: cor.tinta, lineHeight: 27 },
  texto: { fontSize: 15, color: cor.graf600, lineHeight: 22 },
  opcoes: { gap: 8 },
  opcao: {
    flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: TOQUE_GRANDE,
    paddingHorizontal: 16, borderRadius: raio.m, borderWidth: 2, borderColor: cor.graf200,
  },
  opcaoMarcada: { backgroundColor: cor.tinta, borderColor: cor.tinta },
  rosto: { fontSize: 28 },
  rotulo: { fontSize: 17, fontWeight: '700', color: cor.tinta },
})
