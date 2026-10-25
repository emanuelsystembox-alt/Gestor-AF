import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useVideoPlayer, VideoView } from 'expo-video'
import { urlAssinada } from '../lib/midia'
import { carimbo } from '../lib/formato'
import { rotuloEvidencia } from '../lib/dominio'
import { cor } from './tema'

/**
 * Ver a foto ou assistir o vídeo que já subiu (Emanuel, 25/10: "o técnico
 * poderá assistir ele no app pra ver como ficou, e poderá abrir a foto").
 *
 * O arquivo vem do servidor por URL assinada (o bucket é privado) — não
 * fica uma cópia no celular: o player lê direto, e o cache não engorda.
 * A ficha embaixo diz o que o auditor vai ver: tipo, hora, GPS e se veio
 * da galeria.
 */
export interface EvidenciaVista {
  id: string; tipo: string; midia: string; arquivo_path: string
  capturada_em: string | null; lat: number | null; precisao_m: number | null
  da_galeria?: boolean | null
}

export function VisorEvidencia({ ev, aoFechar }: { ev: EvidenciaVista | null; aoFechar: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    setUrl(null); setErro(false)
    if (!ev) return
    let vivo = true
    urlAssinada(ev.arquivo_path).then(u => {
      if (!vivo) return
      if (u) setUrl(u); else setErro(true)
    })
    return () => { vivo = false }
  }, [ev])

  return (
    <Modal visible={!!ev} animationType="fade" onRequestClose={aoFechar} statusBarTranslucent>
      <SafeAreaView style={e.tela} edges={['top', 'bottom']}>
        <View style={e.topo}>
          <Text style={e.titulo} numberOfLines={1}>
            {ev ? `${ev.midia === 'VIDEO' ? 'Vídeo' : 'Foto'} · ${rotuloEvidencia(ev.tipo)}` : ''}
          </Text>
          <Pressable onPress={aoFechar} hitSlop={12} accessibilityRole="button" accessibilityLabel="Fechar">
            <Text style={e.fechar}>Fechar</Text>
          </Pressable>
        </View>

        <View style={e.palco}>
          {erro ? (
            <Text style={e.recado}>Não consegui abrir. Confira o sinal e tente de novo.</Text>
          ) : !url ? (
            <ActivityIndicator color={cor.branco} size="large" />
          ) : ev?.midia === 'VIDEO' ? (
            <Video url={url} />
          ) : (
            <Image source={{ uri: url }} style={e.midia} resizeMode="contain"
              onError={() => setErro(true)} accessibilityLabel="Foto enviada" />
          )}
        </View>

        {ev && (
          <View style={e.ficha}>
            <Text style={e.fichaTexto}>
              {ev.capturada_em ? carimbo(ev.capturada_em) : 'hora não informada'}
              {' · '}
              {ev.lat != null
                ? `com GPS${ev.precisao_m ? ` (±${Math.round(ev.precisao_m)} m)` : ''}`
                : 'sem GPS'}
            </Text>
            {!!ev.da_galeria && (
              <Text style={e.galeria}>Enviada da galeria — hora e GPS são os do arquivo.</Text>
            )}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  )
}

/** O player: só monta quando há URL — `useVideoPlayer` não aceita trocar
 *  de nulo para vídeo no meio. */
function Video({ url }: { url: string }) {
  const player = useVideoPlayer(url, p => { p.loop = false; p.play() })
  return <VideoView player={player} style={e.midia} nativeControls contentFit="contain" />
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: '#000' },
  topo: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  titulo: { flex: 1, color: cor.branco, fontSize: 16, fontWeight: '700' },
  fechar: { color: cor.branco, fontSize: 15, fontWeight: '800' },
  palco: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  midia: { width: '100%', height: '100%' },
  recado: { color: '#d1d5db', fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
  ficha: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  fichaTexto: { color: '#d1d5db', fontSize: 13 },
  galeria: { color: '#fbbf24', fontSize: 13, fontWeight: '700' },
})
