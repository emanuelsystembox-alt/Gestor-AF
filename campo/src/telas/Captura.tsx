import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Image, Pressable, StyleSheet, Text, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  CameraView, useCameraPermissions, useMicrophonePermissions,
} from 'expo-camera'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { rotuloEvidencia } from '../lib/dominio'
import { duracao } from '../lib/formato'
import { ondeEstou } from '../lib/gps'
import { enfileirar, enviarEvidencia, type Captura as Arquivo } from '../lib/midia'
import { Aviso, Botao } from '../ui/componentes'
import { cor, raio } from '../ui/tema'
import type { Pilha } from '../navegacao'

/** Teto de gravação. Um minuto de vídeo em 4G de rua já são ~15 MB e
 *  meio minuto de upload; acima disso o técnico grava e não consegue
 *  mandar — que é o pior dos mundos, porque ele acha que mandou. */
const MAX_SEG = 60

type Props = NativeStackScreenProps<Pilha, 'Captura'>

export default function Captura({ route, navigation }: Props) {
  const { visitaId, osId, tipo, modo } = route.params
  const ehVideo = modo === 'VIDEO'

  const camera = useRef<CameraView>(null)
  const [permCam, pedirCam] = useCameraPermissions()
  const [permMic, pedirMic] = useMicrophonePermissions()

  const [arquivo, setArquivo] = useState<Arquivo | null>(null)
  const [gravando, setGravando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [recado, setRecado] = useState<string | null>(null)

  useEffect(() => { if (!permCam?.granted) pedirCam() }, [permCam?.granted])
  useEffect(() => { if (ehVideo && !permMic?.granted) pedirMic() }, [ehVideo, permMic?.granted])

  // Relógio da gravação. Sem ele o técnico não sabe se está gravando há
  // 5 ou 50 segundos, e o corte automático em 60 s vira surpresa.
  useEffect(() => {
    if (!gravando) return
    const t = setInterval(() => setSegundos(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [gravando])

  async function fotografar() {
    if (!camera.current || ocupado) return
    setOcupado(true); setErro(null)
    try {
      const foto = await camera.current.takePictureAsync({ quality: 0.9 })
      if (foto?.uri) setArquivo({ uri: foto.uri, midia: 'FOTO' })
    } catch (x) {
      setErro(`A câmera não respondeu: ${(x as Error).message}`)
    }
    setOcupado(false)
  }

  async function gravar() {
    if (!camera.current || ocupado) return
    setErro(null); setSegundos(0); setGravando(true)
    try {
      const v = await camera.current.recordAsync({ maxDuration: MAX_SEG })
      if (v?.uri) setArquivo({ uri: v.uri, midia: 'VIDEO', duracaoSeg: segundos || 1 })
    } catch (x) {
      setErro(`Não consegui gravar: ${(x as Error).message}`)
    }
    setGravando(false)
  }

  function parar() {
    camera.current?.stopRecording()
    setGravando(false)
  }

  /**
   * Onde a evidência realmente vira prova.
   *
   * A coordenada entra na foto porque é ela que responde "o técnico
   * estava lá?" — a mesma pergunta que a trava da baixa faz. Mas aqui
   * ela NÃO bloqueia: foto sem GPS ainda é melhor que nenhuma foto, e o
   * `precisao_m` deixa registrado o quanto ela vale.
   */
  async function usar() {
    if (!arquivo) return
    setOcupado(true); setErro(null); setRecado('Enviando…')

    const g = await ondeEstou()
    const dados = {
      visitaId,
      osId: osId ?? null,
      tipo,
      lat: g.ok ? g.posicao.lat : null,
      lng: g.ok ? g.posicao.lng : null,
      precisao: g.ok ? g.posicao.precisao : null,
      capturadaEm: new Date().toISOString(),
    }

    try {
      await enviarEvidencia(arquivo, dados)
      navigation.goBack()
      return
    } catch (x) {
      const msg = (x as Error).message
      // Recusa do banco (fora do dia, sem permissão, contrato de outra
      // equipe) não adianta enfileirar: vai falhar de novo amanhã.
      const semRede = /network|fetch|timeout|Network request failed/i.test(msg)
      if (semRede) {
        await enfileirar(arquivo, dados)
        setRecado(null)
        setErro('Sem sinal. A evidência ficou guardada e sobe sozinha quando a internet voltar.')
      } else {
        setRecado(null)
        setErro(msg)
      }
    }
    setOcupado(false)
  }

  if (!permCam) {
    return <View style={e.preto}><ActivityIndicator color={cor.branco} /></View>
  }

  if (!permCam.granted) {
    return (
      <SafeAreaView style={e.telaClara}>
        <View style={{ padding: 20, gap: 14 }}>
          <Aviso tipo="atencao">
            O aplicativo precisa da câmera para registrar a evidência do
            serviço. Autorize nos ajustes do celular.
          </Aviso>
          <Botao titulo="Autorizar câmera" aoTocar={() => pedirCam()} grande />
          <Botao titulo="Voltar" tom="contorno" aoTocar={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    )
  }

  // ---------- conferência antes de mandar ----------
  if (arquivo) {
    return (
      <SafeAreaView style={e.preto} edges={['top', 'bottom']}>
        <View style={e.previa}>
          {arquivo.midia === 'FOTO' ? (
            <Image source={{ uri: arquivo.uri }} style={e.previaImagem} resizeMode="contain" />
          ) : (
            <View style={e.previaVideo}>
              <Text style={e.previaVideoTexto}>Vídeo gravado</Text>
              <Text style={e.previaVideoMiudo}>{duracao(arquivo.duracaoSeg)}</Text>
            </View>
          )}
        </View>

        <View style={e.rodapeEscuro}>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {recado && <Text style={e.recado}>{recado}</Text>}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Botao
              titulo="Refazer" tom="contorno" style={{ flex: 1 }}
              aoTocar={() => { setArquivo(null); setErro(null); setSegundos(0) }}
              desativado={ocupado}
            />
            <Botao
              titulo={erro ? 'Tentar de novo' : 'Usar esta'}
              style={{ flex: 1.4 }} grande
              aoTocar={usar} carregando={ocupado}
            />
          </View>
          {erro && (
            <Botao titulo="Voltar para a visita" tom="discreto"
                   aoTocar={() => navigation.goBack()} />
          )}
        </View>
      </SafeAreaView>
    )
  }

  // ---------- câmera ----------
  return (
    <View style={e.preto}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode={ehVideo ? 'video' : 'picture'}
      />

      <SafeAreaView style={e.sobreposicao} edges={['top', 'bottom']} pointerEvents="box-none">
        <View style={e.faixaTopo}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={e.fechar}>
            <Text style={e.fecharTexto}>✕</Text>
          </Pressable>
          <Text style={e.faixaTexto}>{rotuloEvidencia(tipo)}</Text>
          {gravando
            ? <Text style={e.relogio}>● {duracao(segundos)}</Text>
            : <View style={{ width: 56 }} />}
        </View>

        {erro && <View style={{ paddingHorizontal: 16 }}><Aviso tipo="erro">{erro}</Aviso></View>}

        <View style={e.faixaBaixo}>
          {ehVideo && !permMic?.granted && (
            <Text style={e.semMic}>Sem microfone autorizado — o vídeo sai mudo.</Text>
          )}
          <Pressable
            onPress={ehVideo ? (gravando ? parar : gravar) : fotografar}
            disabled={ocupado}
            style={({ pressed }) => [
              e.disparo,
              gravando && e.disparoGravando,
              { opacity: ocupado ? 0.5 : pressed ? 0.8 : 1 },
            ]}
          >
            {gravando
              ? <View style={e.quadrado} />
              : <View style={[e.miolo, ehVideo && { backgroundColor: cor.af500 }]} />}
          </Pressable>
          <Text style={e.dica}>
            {ehVideo
              ? (gravando ? `Toque para parar · máximo ${MAX_SEG}s` : 'Toque para gravar')
              : 'Toque para fotografar'}
          </Text>
        </View>
      </SafeAreaView>
    </View>
  )
}

const e = StyleSheet.create({
  preto: { flex: 1, backgroundColor: '#000' },
  telaClara: { flex: 1, backgroundColor: cor.branco },
  sobreposicao: { flex: 1, justifyContent: 'space-between' },

  faixaTopo: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  fechar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  fecharTexto: { color: '#fff', fontSize: 22, fontWeight: '600' },
  faixaTexto: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '700' },
  relogio: { width: 56, color: '#ff5a5a', fontSize: 14, fontWeight: '800' },

  faixaBaixo: {
    alignItems: 'center', gap: 10, paddingBottom: 18, paddingTop: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  semMic: { color: '#ffd7a3', fontSize: 12 },
  disparo: {
    width: 78, height: 78, borderRadius: 999,
    borderWidth: 4, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  disparoGravando: { borderColor: '#ff5a5a' },
  miolo: { width: 60, height: 60, borderRadius: 999, backgroundColor: '#fff' },
  quadrado: { width: 30, height: 30, borderRadius: 6, backgroundColor: '#ff5a5a' },
  dica: { color: '#e6e6e6', fontSize: 13 },

  previa: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previaImagem: { width: '100%', height: '100%' },
  previaVideo: { alignItems: 'center', gap: 6 },
  previaVideoTexto: { color: '#fff', fontSize: 18, fontWeight: '700' },
  previaVideoMiudo: { color: '#bbb', fontSize: 15 },

  rodapeEscuro: {
    padding: 14, gap: 10, backgroundColor: '#0f1115',
    borderTopLeftRadius: raio.g, borderTopRightRadius: raio.g,
  },
  recado: { color: '#e6e6e6', fontSize: 13, textAlign: 'center' },
})
