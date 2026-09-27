import { useEffect, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { Aviso, Botao } from './componentes'
import { cor } from './tema'

/**
 * A ciência do técnico sobre o registro de localização (097, D-171).
 *
 * > "Aviso formal ao técnico sobre o rastro […] pode fazer também"
 * > — Emanuel, 27/09 (o concorrente mostra um aviso com "Estou ciente")
 *
 * É AVISO, não pedido de licença: um botão só, "Estou ciente", como no
 * concorrente. O rastro só começa depois dele. A ciência fica gravada no
 * banco (`ciencia_rastro`), com a VERSÃO do texto: mudou o texto, muda a
 * versão, e todo mundo vê de novo.
 *
 * ┌─ O TEXTO NÃO É PARECER JURÍDICO ─────────────────────────────────┐
 * │ Descreve o que o sistema FAZ (096/097), em linguagem simples. A   │
 * │ AFLINE deve passá-lo pelo jurídico; trocando, suba a VERSAO.      │
 * └───────────────────────────────────────────────────────────────────┘
 */
export const VERSAO_AVISO = 'rastro-v1-2026-09-27'

/** Devolve `true` quando o técnico já deu ciência desta versão. */
export function useCienciaRastro(usuarioId: string | null, ativo: boolean) {
  const [ciente, setCiente] = useState<boolean | null>(null)
  const chave = `ciencia:${usuarioId}:${VERSAO_AVISO}`

  useEffect(() => {
    if (!ativo || !usuarioId) { setCiente(null); return }
    let vivo = true
    ;(async () => {
      // O aparelho lembra (abre sem internet); o banco é a prova.
      const local = await AsyncStorage.getItem(chave).catch(() => null)
      if (local === '1') { if (vivo) setCiente(true); return }
      const { data } = await supabase.from('ciencia_rastro').select('aceito_em')
        .eq('usuario_id', usuarioId).eq('versao', VERSAO_AVISO).maybeSingle()
      if (!vivo) return
      if (data) { await AsyncStorage.setItem(chave, '1').catch(() => {}); setCiente(true) }
      else setCiente(false)
    })()
    return () => { vivo = false }
  }, [usuarioId, ativo, chave])

  async function darCiencia(): Promise<string | null> {
    const { error } = await supabase.rpc('registrar_ciencia_rastro', { p_versao: VERSAO_AVISO })
    if (error) {
      return error.message.toLowerCase().includes('network')
        ? 'Sem internet. Conecte e toque de novo.' : error.message
    }
    await AsyncStorage.setItem(chave, '1').catch(() => {})
    setCiente(true)
    return null
  }

  return { ciente, darCiencia }
}

export function AvisoRastro({ visivel, aoCiente }: {
  visivel: boolean
  aoCiente: () => Promise<string | null>
}) {
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  return (
    <Modal visible={visivel} animationType="slide" transparent onRequestClose={() => {}}>
      <View style={e.fundo}>
        <ScrollView contentContainerStyle={e.centro}>
          <View style={e.caixa}>
            <Text style={e.titulo}>Aviso sobre o registro de localização</Text>
            <Text style={e.texto}>
              Para comprovar os atendimentos e apoiar a sua segurança em campo, este
              aplicativo registra a localização do celular durante o dia de trabalho:
            </Text>
            <Text style={e.item}>• a cada 2 a 5 minutos enquanto houver contrato aberto no dia, inclusive com o aplicativo fechado;</Text>
            <Text style={e.item}>• no momento de cada baixa e de cada encerramento;</Text>
            <Text style={e.item}>• o registro para sozinho quando o último contrato do dia é encerrado, e quando você sai do login.</Text>
            <Text style={e.texto}>
              <Text style={e.forte}>Quem vê:</Text> apenas a gestão da AFLINE (COP,
              controladores e supervisores da sua equipe).
            </Text>
            <Text style={e.texto}>
              <Text style={e.forte}>Por quanto tempo:</Text> 90 dias. Depois é apagado
              automaticamente.
            </Text>
            <Text style={e.texto}>
              Com a localização desligada ou simulada, as ações do aplicativo ficam
              pausadas e o controle é avisado.
            </Text>
            <Text style={e.miudo}>Dúvidas: fale com o seu supervisor.</Text>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <Botao titulo="Estou ciente" grande carregando={salvando} aoTocar={async () => {
              setSalvando(true); setErro(null)
              const r = await aoCiente()
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
  caixa: { backgroundColor: cor.branco, borderRadius: 20, padding: 20, gap: 8 },
  titulo: { fontSize: 19, fontWeight: '800', color: cor.tinta, lineHeight: 25, marginBottom: 4 },
  texto: { fontSize: 15, color: cor.graf600, lineHeight: 22 },
  item: { fontSize: 15, color: cor.graf600, lineHeight: 22, paddingLeft: 4 },
  forte: { fontWeight: '700', color: cor.tinta },
  miudo: { fontSize: 13, color: cor.graf500, marginVertical: 4 },
})
