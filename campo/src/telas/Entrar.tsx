import { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo, Animated, Easing, Image, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useAuth } from '../lib/auth'
import { Aviso, Botao } from '../ui/componentes'
import { cor, raio, TOQUE } from '../ui/tema'

/**
 * A porta do aplicativo — NEXUS MANAGER, assinado pela AFLINE (D-247).
 *
 * > "precisamos melhorar a entrada do nosso app quando o técnico abrir
 * >  igual como fizemos com o site, incluir mais o nome do Nexus Manager
 * >  (...) melhore o design do app por favor igual como fizemos com a
 * >  entrada do site" — Emanuel, 31/10
 *
 * ┌─ o mesmo desenho do site (D-242), no celular ─────────────────────┐
 * │ · a AFLINE assina em cima, com a logo e as duas frases — a        │
 * │   história ("16 anos conectando vidas.") e o rumo ("Conectados    │
 * │   com o futuro."); é ela que financia o sistema;                  │
 * │ · o símbolo do Nexus: duas órbitas, azul e vermelha (o par do     │
 * │   logo), com o sinal correndo por elas, e o N no núcleo;          │
 * │ · o letreiro NEXUS / MANAGER: o "NE" azul vira no "X" e chega ao  │
 * │   "US" vermelho, como o degradê do site — aqui letra a letra,     │
 * │   porque o React Native não recorta degradê em texto sem          │
 * │   biblioteca, e biblioteca nova no `campo/` não entra.            │
 * │                                                                   │
 * │ Escura por fora, clara onde se digita (25/10, D-011): o fundo é o │
 * │ grafite da logo, visto uma vez por dia; o FORMULÁRIO fica num     │
 * │ cartão branco, com os campos claros do resto do app.              │
 * │                                                                   │
 * │ As órbitas não são SVG (não há `react-native-svg`): cada uma é um │
 * │ círculo com borda, achatado em `scaleY` e inclinado — e o sinal   │
 * │ anda pela elipse calculada (x = a·cos t, y = b·sin t) em pontos,  │
 * │ no thread nativo. Quem pede menos movimento ganha tudo parado.    │
 * └───────────────────────────────────────────────────────────────────┘
 */

const FUNDO = '#16181b'
/** O par do logo, na versão clara para fundo escuro (a do site no `escuro`). */
const AZUL = '#4f9bff'
const AZUL_FUNDO = '#1d5fbf'
const VERMELHO = '#ff4d58'
const VERMELHO_FUNDO = '#c10f1b'
/** NEXUS letra a letra: do azul ao vermelho, passando pela virada no X. */
const LETRAS: [string, string][] = [
  ['N', '#5aa2ff'], ['E', '#7896f0'], ['X', '#b97cc6'], ['U', '#ff6470'], ['S', VERMELHO],
]

/** O clarão: do maior e mais fraco ao menor — somadas, esmaecem para a borda. */
const CLARAO = [{ d: 560, o: 0.05 }, { d: 460, o: 0.06 }, { d: 360, o: 0.07 }, { d: 260, o: 0.08 }]

/** O símbolo: lado do quadrado, e a elipse da órbita (46 × 17 de 100, como no site). */
const SIMBOLO = 126
const A = SIMBOLO * 0.46
const B = SIMBOLO * 0.17
const NUCLEO = SIMBOLO * 0.36
const SINAL = 8

/** A elipse amostrada: o sinal anda de ponto em ponto (25 pontos, volta fechada). */
const PASSOS = Array.from({ length: 25 }, (_, i) => i / 24)
const EIXO_X = PASSOS.map(t => A * Math.cos(t * 2 * Math.PI))
const EIXO_Y = PASSOS.map(t => B * Math.sin(t * 2 * Math.PI))

export default function Entrar() {
  const { entrar } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, setIndo] = useState(false)
  const [parado, setParado] = useState(false)

  // A abertura: o símbolo nasce, os anéis se espalham, o NEXUS monta letra
  // a letra; depois o palco sobe e o formulário entra.
  const nasce = useRef(new Animated.Value(0)).current
  const anelA = useRef(new Animated.Value(0)).current
  const anelB = useRef(new Animated.Value(0)).current
  const letras = useRef(LETRAS.map(() => new Animated.Value(0))).current
  const manager = useRef(new Animated.Value(0)).current
  const sobe = useRef(new Animated.Value(0)).current
  // O sinal correndo nas duas órbitas.
  const sinalA = useRef(new Animated.Value(0)).current
  const sinalB = useRef(new Animated.Value(0)).current
  // O login: as órbitas giram e o núcleo pulsa enquanto o servidor confere.
  const gira = useRef(new Animated.Value(0)).current
  const pulso = useRef(new Animated.Value(0)).current
  // O erro: o cartão balança.
  const balanca = useRef(new Animated.Value(0)).current

  useEffect(() => {
    let vivo = true
    const loops: Animated.CompositeAnimation[] = []
    AccessibilityInfo.isReduceMotionEnabled().then(menos => {
      if (!vivo) return
      if (menos) {
        setParado(true)
        ;[nasce, manager, sobe, ...letras].forEach(v => v.setValue(1))
        return
      }
      const anel = (v: Animated.Value, atraso: number) => Animated.sequence([
        Animated.delay(atraso),
        Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ])
      Animated.sequence([
        Animated.parallel([
          Animated.spring(nasce, { toValue: 1, friction: 6, tension: 55, useNativeDriver: true }),
          anel(anelA, 150),
          anel(anelB, 420),
          Animated.sequence([
            Animated.delay(320),
            Animated.stagger(70, letras.map(v =>
              Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }))),
            Animated.timing(manager, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          ]),
        ]),
        Animated.timing(sobe, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start()
      // O sinal nas órbitas, em velocidades diferentes (3,2 s e 3,8 s, como no site).
      for (const [v, dur] of [[sinalA, 3200], [sinalB, 3800]] as const) {
        const l = Animated.loop(Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.linear, useNativeDriver: true }))
        l.start(); loops.push(l)
      }
    })
    return () => { vivo = false; loops.forEach(l => l.stop()) }
  }, [nasce, anelA, anelB, letras, manager, sobe, sinalA, sinalB])

  useEffect(() => {
    if (!indo) {
      gira.stopAnimation(); pulso.stopAnimation()
      gira.setValue(0); pulso.setValue(0)
      return
    }
    const g = Animated.loop(Animated.timing(gira, {
      toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true,
    }))
    const p = Animated.loop(Animated.sequence([
      Animated.timing(pulso, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulso, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]))
    g.start(); p.start()
    return () => { g.stop(); p.stop() }
  }, [indo, gira, pulso])

  function balancar() {
    balanca.setValue(0)
    Animated.sequence([10, -10, 7, -7, 3, 0].map(x =>
      Animated.timing(balanca, { toValue: x, duration: 55, useNativeDriver: true }))).start()
  }

  async function enviar() {
    if (indo) return
    if (!email.trim() || !senha) {
      setErro('Preencha e-mail e senha.'); balancar()
      return
    }
    setIndo(true); setErro(null)
    const problema = await entrar(email, senha)
    if (problema) { setErro(problema); setIndo(false); balancar() }
    // Sucesso não desliga o `indo`: a árvore troca sozinha quando a
    // sessão chega, e desligar antes faria o botão piscar "Entrar".
  }

  const anelEstilo = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 2.2] }) }],
  })
  const giro = gira.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })

  return (
    <View style={e.tela}>
      <StatusBar style="light" />
      {/* O par do logo atrás de tudo: o azul do Nexus encontra o vermelho da
          AFLINE. Sem desfoque no React Native, um disco só fica com borda
          dura (visto na réplica, 31/10); camadas concêntricas bem fracas
          fazem o esmaecido. */}
      {CLARAO.map((c, i) => (
        <View key={`a${i}`} pointerEvents="none" style={[e.clarao, {
          width: c.d, height: c.d, borderRadius: c.d / 2, opacity: c.o,
          top: -150 - (c.d - 420) / 2, right: -170 - (c.d - 420) / 2, backgroundColor: AZUL_FUNDO,
        }]} />
      ))}
      {CLARAO.map((c, i) => (
        <View key={`v${i}`} pointerEvents="none" style={[e.clarao, {
          width: c.d, height: c.d, borderRadius: c.d / 2, opacity: c.o * 0.75,
          bottom: -170 - (c.d - 420) / 2, left: -150 - (c.d - 420) / 2, backgroundColor: '#d11a24',
        }]} />
      ))}

      <KeyboardAvoidingView style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={e.rolagem} keyboardShouldPersistTaps="handled">

          {/* ---- quem assina: a AFLINE ---- */}
          <Animated.View style={[e.assinatura, { opacity: nasce }]}>
            <Image source={require('../../assets/logo-afline.png')} style={e.logo}
              accessibilityLabel="AFLINE" />
            <View style={e.frases}>
              <Text style={e.frase}>
                <Text style={e.dezesseis}>16 anos</Text> conectando vidas.
              </Text>
              <Text style={e.fraseRumo}>Conectados com o futuro.</Text>
            </View>
          </Animated.View>

          {/* ---- o símbolo do Nexus ---- */}
          <Animated.View style={[e.palco, {
            transform: [{ translateY: sobe.interpolate({ inputRange: [0, 1], outputRange: [36, 0] }) }],
          }]}>
            <Animated.View pointerEvents="none" style={[e.anel, { borderColor: AZUL }, anelEstilo(anelA)]} />
            <Animated.View pointerEvents="none" style={[e.anel, { borderColor: VERMELHO }, anelEstilo(anelB)]} />
            <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
              style={[e.simbolo, {
                opacity: nasce.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1] }),
                transform: [{ scale: nasce.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
              }]}>
              <View style={e.halo} />
              {/* As órbitas giram juntas enquanto o login confere. */}
              <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: giro }] }]}>
                <Orbita giro="-32deg" tinta={AZUL} sinal="#9cc8ff" corre={!parado} volta={sinalA} />
                <Orbita giro="32deg" tinta={VERMELHO} sinal="#ffb3b8" corre={!parado} volta={sinalB} />
              </Animated.View>
              <Animated.View style={[e.nucleo, {
                transform: [{ scale: pulso.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }],
              }]}>
                <Text style={e.nucleoN}>N</Text>
              </Animated.View>
            </Animated.View>
          </Animated.View>

          {/* ---- o letreiro: o nome do sistema ---- */}
          <View accessible accessibilityRole="header" accessibilityLabel="Nexus Manager"
            style={e.letreiro}>
            <View style={e.nexus}>
              {LETRAS.map(([l, c], i) => (
                <Animated.Text key={l} style={[e.letra, { color: c }, {
                  opacity: letras[i],
                  transform: [{ translateY: letras[i].interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
                }]}>{l}</Animated.Text>
              ))}
            </View>
            <Animated.Text style={[e.manager, {
              opacity: manager,
              transform: [{ translateY: manager.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
            }]}>MANAGER</Animated.Text>
            <Animated.View style={[e.tagline, { opacity: manager }]}>
              <View style={e.traco}>
                <View style={[e.tracoMetade, { backgroundColor: AZUL_FUNDO }]} />
                <View style={[e.tracoMetade, { backgroundColor: VERMELHO_FUNDO }]} />
              </View>
              <Text style={e.taglineTexto}>SISTEMA DE GESTÃO INTELIGENTE</Text>
            </Animated.View>
          </View>

          {/* ---- o formulário, claro ---- */}
          <Animated.View style={{
            opacity: sobe,
            transform: [
              { translateY: sobe.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
              { translateX: balanca },
            ],
          }}>
            <View style={e.cartao}>
              <View>
                <Text style={e.cartaoTitulo}>Acesso do técnico</Text>
                <Text style={e.cartaoSub}>
                  {indo ? 'Conferindo o seu acesso…' : 'Entre com o mesmo login do sistema.'}
                </Text>
              </View>
              {!!erro && <Aviso tipo="erro">{erro}</Aviso>}
              <View>
                <Text style={e.rotulo}>E-mail</Text>
                <TextInput
                  value={email}
                  onChangeText={t => { setEmail(t); setErro(null) }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="username"
                  placeholder="voce@afline.com.br"
                  placeholderTextColor={cor.graf300}
                  editable={!indo}
                  style={e.campo}
                  accessibilityLabel="E-mail"
                />
              </View>
              <View>
                <Text style={e.rotulo}>Senha</Text>
                <TextInput
                  value={senha}
                  onChangeText={t => { setSenha(t); setErro(null) }}
                  secureTextEntry
                  autoCapitalize="none"
                  textContentType="password"
                  placeholder="••••••••"
                  placeholderTextColor={cor.graf300}
                  editable={!indo}
                  style={e.campo}
                  onSubmitEditing={enviar}
                  returnKeyType="go"
                  accessibilityLabel="Senha"
                />
              </View>
              <Botao titulo="Entrar" aoTocar={enviar} carregando={indo} grande />
            </View>

            <Text style={e.rodape}>
              Esqueceu a senha? Fale com o controlador — ele redefine pela
              tela de Administração.
            </Text>
            <Text style={e.marca}>AFLINE · NEXUS MANAGER</Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

/**
 * Uma órbita: o círculo com borda achatado em elipse e inclinado, e o
 * sinal que corre por ela. O achatamento afina a borda em cima e embaixo —
 * fica como a órbita vista de lado, que é a ideia do desenho.
 */
function Orbita({ giro, tinta, sinal, corre, volta }: {
  giro: string; tinta: string; sinal: string; corre: boolean
  /** 0 → 1 = uma volta inteira do sinal pela elipse. */
  volta: Animated.Value
}) {
  return (
    <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: giro }] }]}>
      <View style={[e.orbita, { borderColor: tinta, transform: [{ scaleY: B / A }] }]} />
      {corre && (
        <Animated.View style={[e.sinal, { backgroundColor: sinal, shadowColor: sinal, transform: [
          { translateX: volta.interpolate({ inputRange: PASSOS, outputRange: EIXO_X }) },
          { translateY: volta.interpolate({ inputRange: PASSOS, outputRange: EIXO_Y }) },
        ] }]} />
      )}
    </View>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: FUNDO, overflow: 'hidden' },
  clarao: { position: 'absolute' },
  rolagem: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 40 },

  assinatura: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 12, marginBottom: 6,
  },
  logo: { width: 52, height: 52, borderRadius: 12 },
  frases: {
    borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.16)', paddingLeft: 12, gap: 2,
  },
  frase: { fontSize: 14, fontWeight: '700', color: '#eef0f4' },
  dezesseis: { fontWeight: '900', fontStyle: 'italic', color: VERMELHO },
  fraseRumo: { fontSize: 12.5, fontWeight: '600', color: '#a9b0bd' },

  palco: { alignItems: 'center', justifyContent: 'center', height: SIMBOLO + 36, marginTop: 4 },
  anel: {
    position: 'absolute', width: SIMBOLO * 0.8, height: SIMBOLO * 0.8,
    borderRadius: SIMBOLO * 0.4, borderWidth: 2,
  },
  simbolo: { width: SIMBOLO, height: SIMBOLO, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute', width: SIMBOLO * 0.7, height: SIMBOLO * 0.7, borderRadius: SIMBOLO * 0.35,
    backgroundColor: AZUL_FUNDO, opacity: 0.18,
  },
  orbita: {
    position: 'absolute', left: SIMBOLO / 2 - A, top: SIMBOLO / 2 - A,
    width: A * 2, height: A * 2, borderRadius: A, borderWidth: 5,
  },
  sinal: {
    position: 'absolute', left: SIMBOLO / 2 - SINAL / 2, top: SIMBOLO / 2 - SINAL / 2,
    width: SINAL, height: SINAL, borderRadius: SINAL / 2,
    shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, elevation: 4,
  },
  nucleo: {
    width: NUCLEO, height: NUCLEO, borderRadius: NUCLEO / 2,
    backgroundColor: '#232838', borderWidth: 2.5, borderColor: cor.branco,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  nucleoN: { fontSize: NUCLEO * 0.5, fontWeight: '900', color: cor.branco, marginTop: -1 },

  letreiro: { alignItems: 'center', marginTop: 2 },
  nexus: { flexDirection: 'row' },
  letra: {
    fontSize: 54, lineHeight: 58, fontWeight: '900', letterSpacing: 1.5,
    fontFamily: Platform.select({ android: 'sans-serif-condensed', ios: 'AvenirNextCondensed-Heavy' }),
  },
  manager: {
    marginTop: 2, fontSize: 18, fontWeight: '600', letterSpacing: 9.5, color: '#e9ebf1',
    // o espaçamento empurra a última letra: o recuo à esquerda centraliza de volta
    paddingLeft: 9.5,
  },
  tagline: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  traco: { flexDirection: 'row', width: 26, height: 2, borderRadius: 1, overflow: 'hidden' },
  tracoMetade: { flex: 1 },
  taglineTexto: { fontSize: 10.5, fontWeight: '700', letterSpacing: 2.4, color: '#a9b0bd' },

  cartao: {
    marginTop: 24, gap: 12, padding: 18, borderRadius: 20, backgroundColor: cor.branco,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  cartaoTitulo: { fontSize: 18, fontWeight: '800', color: cor.tinta },
  cartaoSub: { marginTop: 2, fontSize: 13.5, color: cor.graf500 },
  rotulo: { marginBottom: 6, fontSize: 13, fontWeight: '600', color: cor.graf500 },
  campo: {
    minHeight: TOQUE, borderWidth: 1, borderColor: cor.graf200, borderRadius: raio.m,
    paddingHorizontal: 14, fontSize: 16, color: cor.tinta, backgroundColor: cor.graf50,
  },
  rodape: {
    marginTop: 20, fontSize: 12, lineHeight: 18, color: '#9aa3af', textAlign: 'center',
  },
  marca: {
    marginTop: 14, fontSize: 10, fontWeight: '700', letterSpacing: 2.2,
    color: '#8a929f', textAlign: 'center',
  },
})
