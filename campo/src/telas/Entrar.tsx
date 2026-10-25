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
 * A porta do aplicativo, com a cara da logo nova (Emanuel, 25/10: "a tela
 * principal do app precisa ser remodelada, de acordo com a logo, deve ter
 * efeitos antes de entrar, e animações quando estiver fazendo o login").
 *
 * ┌─ escura por fora, clara onde se digita ───────────────────────────┐
 * │ O campo é claro por condição de trabalho (D-011: tela escura no   │
 * │ sol vira espelho). Aqui o fundo é o grafite da logo — é a marca,  │
 * │ vista uma vez por dia — mas o FORMULÁRIO fica num cartão branco,  │
 * │ com os mesmos campos claros do resto do app: é onde se lê e digita.│
 * │                                                                   │
 * │ As animações são do próprio React Native (`Animated`, no thread   │
 * │ nativo): nada de biblioteca nova (regra do `campo/`). Quem pede   │
 * │ menos movimento no celular ganha a abertura curta, sem pulsos.    │
 * └───────────────────────────────────────────────────────────────────┘
 */

const FUNDO = '#16181b'
const LOGO = 132

export default function Entrar() {
  const { entrar } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, setIndo] = useState(false)

  // A abertura: a logo nasce, os anéis se espalham, o brilho passa; depois
  // a logo sobe e encolhe e o formulário entra.
  const nasce = useRef(new Animated.Value(0)).current
  const anelA = useRef(new Animated.Value(0)).current
  const anelB = useRef(new Animated.Value(0)).current
  const brilho = useRef(new Animated.Value(0)).current
  const sobe = useRef(new Animated.Value(0)).current
  // O login: o anel gira e a logo pulsa enquanto o servidor confere.
  const gira = useRef(new Animated.Value(0)).current
  const pulso = useRef(new Animated.Value(0)).current
  // O erro: o cartão balança.
  const balanca = useRef(new Animated.Value(0)).current

  useEffect(() => {
    let vivo = true
    AccessibilityInfo.isReduceMotionEnabled().then(menos => {
      if (!vivo) return
      if (menos) {
        Animated.parallel([
          Animated.timing(nasce, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(sobe, { toValue: 1, duration: 250, useNativeDriver: true }),
        ]).start()
        return
      }
      const anel = (v: Animated.Value, atraso: number) => Animated.sequence([
        Animated.delay(atraso),
        Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ])
      Animated.sequence([
        Animated.parallel([
          Animated.spring(nasce, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
          anel(anelA, 150),
          anel(anelB, 420),
          Animated.sequence([
            Animated.delay(450),
            Animated.timing(brilho, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          ]),
        ]),
        Animated.timing(sobe, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start()
    })
    return () => { vivo = false }
  }, [nasce, anelA, anelB, brilho, sobe])

  useEffect(() => {
    if (!indo) {
      gira.stopAnimation(); pulso.stopAnimation()
      gira.setValue(0); pulso.setValue(0)
      return
    }
    const g = Animated.loop(Animated.timing(gira, {
      toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true,
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

  const escalaLogo = Animated.multiply(
    nasce.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
    Animated.add(
      sobe.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] }),
      pulso.interpolate({ inputRange: [0, 1], outputRange: [0, 0.05] }),
    ),
  )
  const anelEstilo = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 2.1] }) }],
  })

  return (
    <View style={e.tela}>
      <StatusBar style="light" />
      {/* Um clarão vermelho difuso atrás de tudo — o brilho do selo da logo. */}
      <View pointerEvents="none" style={e.claraoA} />
      <View pointerEvents="none" style={e.claraoB} />

      <KeyboardAvoidingView style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={e.rolagem} keyboardShouldPersistTaps="handled">
          <Animated.View style={[e.palco, {
            transform: [{ translateY: sobe.interpolate({ inputRange: [0, 1], outputRange: [90, 0] }) }],
          }]}>
            <Animated.View pointerEvents="none" style={[e.anel, anelEstilo(anelA)]} />
            <Animated.View pointerEvents="none" style={[e.anel, anelEstilo(anelB)]} />
            {/* O anel do login: um arco vermelho que gira em volta da logo. */}
            <Animated.View pointerEvents="none" style={[e.arco, {
              opacity: indo ? 1 : 0,
              transform: [{ rotate: gira.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
            }]} />
            <Animated.View style={{
              opacity: nasce.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
              transform: [{ scale: escalaLogo }],
            }}>
              <View style={e.logoCaixa}>
                <Image source={require('../../assets/logo-afline.png')} style={e.logo}
                  accessibilityLabel="AFLINE" />
                {/* O brilho que atravessa a logo uma vez, na abertura. */}
                <Animated.View pointerEvents="none" style={[e.brilho, {
                  opacity: brilho.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 0.9, 0.9, 0] }),
                  transform: [
                    { translateX: brilho.interpolate({ inputRange: [0, 1], outputRange: [-LOGO, LOGO * 1.3] }) },
                    { rotate: '20deg' },
                  ],
                }]} />
              </View>
            </Animated.View>
          </Animated.View>

          <Animated.View style={{
            opacity: sobe,
            transform: [
              { translateY: sobe.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
              { translateX: balanca },
            ],
          }}>
            <Text style={e.titulo}>Gestor AF · Campo</Text>
            <Text style={e.subtitulo}>
              {indo ? 'Entrando…' : 'Entre com o mesmo login do sistema.'}
            </Text>

            <View style={e.cartao}>
              {erro && <Aviso tipo="erro">{erro}</Aviso>}
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
                />
              </View>
              <Botao titulo="Entrar" aoTocar={enviar} carregando={indo} grande />
            </View>

            <Text style={e.rodape}>
              Esqueceu a senha? Fale com o controlador — ele redefine pela
              tela de Administração.
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: FUNDO, overflow: 'hidden' },
  claraoA: {
    position: 'absolute', width: 420, height: 420, borderRadius: 210,
    top: -120, right: -160, backgroundColor: '#d11a24', opacity: 0.16,
  },
  claraoB: {
    position: 'absolute', width: 360, height: 360, borderRadius: 180,
    bottom: -150, left: -140, backgroundColor: '#d11a24', opacity: 0.1,
  },
  rolagem: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 48 },
  palco: { alignItems: 'center', justifyContent: 'center', height: LOGO + 40, marginBottom: 8 },
  anel: {
    position: 'absolute', width: LOGO, height: LOGO, borderRadius: LOGO * 0.26,
    borderWidth: 2, borderColor: '#ef3b3b',
  },
  arco: {
    position: 'absolute', width: LOGO + 26, height: LOGO + 26, borderRadius: (LOGO + 26) / 2,
    borderWidth: 3, borderColor: 'transparent', borderTopColor: '#ef3b3b', borderRightColor: '#ef3b3b55',
  },
  logoCaixa: {
    width: LOGO, height: LOGO, borderRadius: LOGO * 0.24, overflow: 'hidden',
    shadowColor: '#d11a24', shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 6 },
    elevation: 14, backgroundColor: '#22252a',
  },
  logo: { width: LOGO, height: LOGO },
  brilho: {
    position: 'absolute', top: -LOGO * 0.3, width: 26, height: LOGO * 1.6,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  titulo: { textAlign: 'center', fontSize: 24, fontWeight: '800', color: cor.branco, letterSpacing: 0.3 },
  subtitulo: { textAlign: 'center', marginTop: 4, fontSize: 14, color: '#b9c0cc' },
  cartao: {
    marginTop: 20, gap: 12, padding: 18, borderRadius: 20, backgroundColor: cor.branco,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  rotulo: { marginBottom: 6, fontSize: 13, fontWeight: '600', color: cor.graf500 },
  campo: {
    minHeight: TOQUE, borderWidth: 1, borderColor: cor.graf200, borderRadius: raio.m,
    paddingHorizontal: 14, fontSize: 16, color: cor.tinta, backgroundColor: cor.graf50,
  },
  rodape: {
    marginTop: 22, fontSize: 12, lineHeight: 18, color: '#9aa3af', textAlign: 'center',
  },
})
