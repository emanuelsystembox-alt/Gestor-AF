import { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo, Animated, Easing, Image, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useAuth } from '../lib/auth'
import { Aviso, Botao } from '../ui/componentes'
import { cor, raio, TOQUE } from '../ui/tema'

/**
 * A porta do aplicativo — PULSOLINE, Sistema de gestão AFLINE (D-249).
 *
 * > "A marca Nexus Manager vai ter que mudar para PulsoLine, Sistema de
 * >  gestão AFLINE (...) no aplicativo, na hora que abrir, precisa ter
 * >  essa marca aparecendo e Nexus Manager sai (...) não vamos tirar a
 * >  logomarca oficial da AFLINE" — Emanuel, 31/10
 *
 * ┌─ a arte de verdade, no preto dela ────────────────────────────────┐
 * │ O logo é a ARTE que o Emanuel mandou (`assets/logo-pulsoline.png`),│
 * │ não um redesenho: no app não há SVG, e a arte já traz o P, o       │
 * │ batimento, o "Pulso" prata, o "Line" vermelho e "SISTEMA DE GESTÃO │
 * │ AFLINE". O fundo dela é preto puro (0,0,0) — por isso a tela é    │
 * │ preta pura: a imagem some na tela, sem retângulo. Os brilhos do   │
 * │ fundo ficam nos CANTOS, longe do logo, pelo mesmo motivo.          │
 * │                                                                   │
 * │ O movimento é o do nome: um BATIMENTO. O logo bate duas vezes     │
 * │ (tum-tum) e descansa; embaixo dele, um pulso vermelho corre de um │
 * │ lado ao outro, como o traço de um monitor. No login, o batimento  │
 * │ acelera enquanto o servidor confere. `Animated`, no thread nativo; │
 * │ quem pede menos movimento recebe a tela pronta, parada.            │
 * │                                                                   │
 * │ Escura por fora, clara onde se digita (25/10, D-011): o formulário│
 * │ fica num cartão branco, com os campos claros do resto do app.     │
 * └───────────────────────────────────────────────────────────────────┘
 */

const FUNDO = '#000000'
/** A arte: 1600 × 533. */
const PROPORCAO = 533 / 1600

export default function Entrar() {
  const { entrar } = useAuth()
  const { width } = useWindowDimensions()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, setIndo] = useState(false)
  const [parado, setParado] = useState(false)

  // A abertura: a assinatura da AFLINE e o logo nascem; depois o palco sobe
  // e o formulário entra.
  const nasce = useRef(new Animated.Value(0)).current
  const sobe = useRef(new Animated.Value(0)).current
  // O batimento do logo (escala) e o pulso que corre embaixo dele.
  const bate = useRef(new Animated.Value(0)).current
  const corre = useRef(new Animated.Value(0)).current
  // O erro: o cartão balança.
  const balanca = useRef(new Animated.Value(0)).current

  const larguraLogo = Math.min(width - 32, 520)
  const alturaLogo = larguraLogo * PROPORCAO

  useEffect(() => {
    let vivo = true
    let laco: Animated.CompositeAnimation | null = null
    AccessibilityInfo.isReduceMotionEnabled().then(menos => {
      if (!vivo) return
      if (menos) { setParado(true); nasce.setValue(1); sobe.setValue(1); return }
      Animated.sequence([
        Animated.timing(nasce, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(sobe, { toValue: 1, duration: 560, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start()
      // O monitor: o pulso atravessa a cada 2,4 s, sem parar.
      laco = Animated.loop(Animated.sequence([
        Animated.timing(corre, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(700),
        Animated.timing(corre, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]))
      laco.start()
    })
    return () => { vivo = false; laco?.stop() }
  }, [nasce, sobe, corre])

  // O batimento: tum-tum e descanso; no login, mais rápido.
  useEffect(() => {
    if (parado) return
    const pulsar = (to: number, ms: number) =>
      Animated.timing(bate, { toValue: to, duration: ms, easing: Easing.out(Easing.quad), useNativeDriver: true })
    const l = Animated.loop(Animated.sequence([
      pulsar(1, 110), pulsar(0, 140), pulsar(0.6, 100), pulsar(0, 180),
      Animated.delay(indo ? 260 : 1300),
    ]))
    l.start()
    return () => l.stop()
  }, [bate, indo, parado])

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

  const faixa = larguraLogo * 0.72

  return (
    <View style={e.tela}>
      <StatusBar style="light" />
      {/* Os brilhos nos cantos: prata em cima, vermelho embaixo — camadas
          fracas que esmaecem (o React Native não desfoca; D-247). */}
      {[260, 200, 140].map((d, i) => (
        <View key={`p${d}`} pointerEvents="none" style={[e.clarao, {
          width: d, height: d, borderRadius: d / 2, top: -d / 2, right: -d / 2,
          backgroundColor: '#9da2ad', opacity: 0.05 + i * 0.02,
        }]} />
      ))}
      {[320, 240, 160].map((d, i) => (
        <View key={`v${d}`} pointerEvents="none" style={[e.clarao, {
          width: d, height: d, borderRadius: d / 2, bottom: -d / 2, left: -d / 2,
          backgroundColor: '#d11a24', opacity: 0.07 + i * 0.03,
        }]} />
      ))}

      <KeyboardAvoidingView style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={e.rolagem} keyboardShouldPersistTaps="handled">

          {/* ---- quem assina: a AFLINE (a logomarca oficial fica) ---- */}
          <Animated.View style={[e.assinatura, { opacity: nasce }]}>
            <Image source={require('../../assets/logo-afline.png')} style={e.selo}
              accessibilityLabel="AFLINE" />
            <View style={e.frases}>
              <Text style={e.frase}>
                <Text style={e.dezesseis}>16 anos</Text> conectando vidas.
              </Text>
              <Text style={e.fraseRumo}>Conectados com o futuro.</Text>
            </View>
          </Animated.View>

          {/* ---- a marca: PulsoLine, com o batimento ---- */}
          <Animated.View style={{
            alignItems: 'center', marginTop: 18,
            opacity: nasce,
            transform: [
              { translateY: sobe.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
              { scale: Animated.multiply(
                  nasce.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }),
                  bate.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] })) },
            ],
          }}>
            <Image source={require('../../assets/logo-pulsoline.png')}
              style={{ width: larguraLogo, height: alturaLogo }} resizeMode="contain"
              accessible accessibilityRole="header"
              accessibilityLabel="PulsoLine, sistema de gestão AFLINE" />
          </Animated.View>

          {/* O monitor: a linha fina e o pulso vermelho que corre nela. */}
          <View style={[e.monitor, { width: faixa }]} pointerEvents="none">
            {!parado && (
              <Animated.View style={[e.pulso, {
                transform: [{ translateX: corre.interpolate({ inputRange: [0, 1], outputRange: [-60, faixa] }) }],
                opacity: corre.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] }),
              }]} />
            )}
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
            <Text style={e.marca}>AFLINE · PULSOLINE</Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: FUNDO, overflow: 'hidden' },
  clarao: { position: 'absolute' },
  rolagem: { flexGrow: 1, justifyContent: 'center', padding: 16, paddingTop: 44, paddingBottom: 28 },

  assinatura: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 12,
  },
  selo: { width: 50, height: 50, borderRadius: 12 },
  frases: {
    borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.16)', paddingLeft: 12, gap: 2,
  },
  frase: { fontSize: 14, fontWeight: '700', color: '#eef0f4' },
  dezesseis: { fontWeight: '900', fontStyle: 'italic', color: '#ff4d58' },
  fraseRumo: { fontSize: 12.5, fontWeight: '600', color: '#a9b0bd' },

  monitor: {
    alignSelf: 'center', height: 2, marginTop: 2, borderRadius: 1, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  pulso: {
    position: 'absolute', left: 0, top: 0, width: 60, height: 2, borderRadius: 1,
    backgroundColor: '#ff3b46',
  },

  cartao: {
    marginTop: 26, gap: 12, padding: 18, borderRadius: 20, backgroundColor: cor.branco,
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
