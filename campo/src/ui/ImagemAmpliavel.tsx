import { useMemo, useRef } from 'react'
import { Animated, PanResponder, StyleSheet, useWindowDimensions, View } from 'react-native'
import type { GestureResponderEvent } from 'react-native'

/**
 * Imagem que amplia com os dedos (D-309).
 *
 * > "no app também sobre a campanha da afline que ela envia no mural, é bom
 * >  ele conseguir ampliar a imagem (...) fica pequeno ainda a foto do mural"
 * >  — Emanuel, 04/11
 *
 * ┌─ sem biblioteca nova ─────────────────────────────────────────────────┐
 * │ No Android a `ScrollView` não tem zoom (o `maximumZoomScale` é só do  │
 * │ iPhone), e o projeto não instala biblioteca de interface no campo/    │
 * │ (architecture.md). Então é o `PanResponder` e o `Animated` do próprio │
 * │ React Native:                                                         │
 * │   · dois dedos = pinça (1× a 5×);                                     │
 * │   · toque duplo = 2,5× ou de volta a 1×;                              │
 * │   · um dedo com a imagem ampliada = arrasta, sem sair da borda.       │
 * │ A transformação roda no thread nativo (`useNativeDriver`) — não pesa. │
 * └────────────────────────────────────────────────────────────────────────┘
 */

const MAX = 5
const DUPLO_MS = 280

const distancia = (t: GestureResponderEvent['nativeEvent']['touches']) =>
  Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY)

export function ImagemAmpliavel({ uri, rotulo, onErro }: {
  uri: string; rotulo?: string; onErro?: () => void
}) {
  const { width: W, height: H } = useWindowDimensions()
  const escala = useRef(new Animated.Value(1)).current
  const tx = useRef(new Animated.Value(0)).current
  const ty = useRef(new Animated.Value(0)).current
  const st = useRef({ s: 1, x: 0, y: 0, s0: 1, x0: 0, y0: 0, d0: 0, dedos: 0, toque: 0 }).current

  const pr = useMemo(() => {
    const limita = (x: number, y: number, s: number) => {
      const mx = (W * (s - 1)) / 2
      const my = (H * (s - 1)) / 2
      return [Math.max(-mx, Math.min(mx, x)), Math.max(-my, Math.min(my, y))]
    }
    const anima = (s: number, x: number, y: number) => {
      st.s = s; st.x = x; st.y = y
      Animated.parallel([
        Animated.timing(escala, { toValue: s, duration: 180, useNativeDriver: true }),
        Animated.timing(tx, { toValue: x, duration: 180, useNativeDriver: true }),
        Animated.timing(ty, { toValue: y, duration: 180, useNativeDriver: true }),
      ]).start()
    }
    // Recomeça a conta do gesto do ponto em que a imagem está agora — trocar
    // de dois dedos para um no meio não pode dar salto.
    const base = (dedos: number, e: GestureResponderEvent, dx = 0, dy = 0) => {
      st.dedos = dedos; st.s0 = st.s; st.x0 = st.x - dx; st.y0 = st.y - dy
      st.d0 = dedos >= 2 ? distancia(e.nativeEvent.touches) : 0
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        const n = e.nativeEvent.touches.length
        base(n, e)
        if (n === 1) {
          const agora = Date.now()
          if (agora - st.toque < DUPLO_MS) {
            st.toque = 0
            if (st.s > 1.05) anima(1, 0, 0)
            else anima(2.5, 0, 0)
          } else st.toque = agora
        }
      },
      onPanResponderMove: (e, g) => {
        const t = e.nativeEvent.touches
        if (t.length !== st.dedos) base(t.length, e, g.dx, g.dy)
        if (t.length >= 2 && st.d0 > 0) {
          const s = Math.max(1, Math.min(MAX, (st.s0 * distancia(t)) / st.d0))
          st.s = s
          escala.setValue(s)
          const [x, y] = limita(st.x, st.y, s)
          st.x = x; st.y = y; tx.setValue(x); ty.setValue(y)
        } else if (t.length === 1 && st.s > 1) {
          const [x, y] = limita(st.x0 + g.dx, st.y0 + g.dy, st.s)
          st.x = x; st.y = y
          tx.setValue(x); ty.setValue(y)
        }
      },
      onPanResponderRelease: () => {
        st.dedos = 0; st.d0 = 0
        if (st.s <= 1.02) anima(1, 0, 0)
      },
    })
  }, [W, H, escala, tx, ty, st])

  return (
    <View style={e.caixa} {...pr.panHandlers}>
      <Animated.Image
        source={{ uri }}
        resizeMode="contain"
        accessibilityLabel={rotulo}
        onError={onErro}
        style={[e.imagem, { transform: [{ translateX: tx }, { translateY: ty }, { scale: escala }] }]}
      />
    </View>
  )
}

const e = StyleSheet.create({
  caixa: { flex: 1, width: '100%', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  imagem: { width: '100%', height: '100%' },
})
