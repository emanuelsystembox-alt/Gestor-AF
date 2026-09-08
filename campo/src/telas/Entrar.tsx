import { useState } from 'react'
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { useAuth } from '../lib/auth'
import { Aviso, Botao } from '../ui/componentes'
import { cor, raio, TOQUE } from '../ui/tema'

export default function Entrar() {
  const { entrar } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, setIndo] = useState(false)

  async function enviar() {
    if (!email.trim() || !senha) {
      setErro('Preencha e-mail e senha.')
      return
    }
    setIndo(true); setErro(null)
    const problema = await entrar(email, senha)
    if (problema) { setErro(problema); setIndo(false) }
    // Sucesso não desliga o `indo`: a árvore troca sozinha quando a
    // sessão chega, e desligar antes faria o botão piscar "Entrar".
  }

  return (
    <KeyboardAvoidingView
      style={e.tela}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={e.rolagem} keyboardShouldPersistTaps="handled">
        <View style={e.marca}>
          <View style={e.logo}>
            <Text style={e.logoTexto}>AF</Text>
          </View>
          <Text style={e.titulo}>Gestor AF · Campo</Text>
          <Text style={e.subtitulo}>Entre com o mesmo login do sistema.</Text>
        </View>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <View style={{ gap: 12, marginTop: 16 }}>
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
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.branco },
  rolagem: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  marca: { alignItems: 'center', marginBottom: 28 },
  logo: {
    width: 64, height: 64, borderRadius: 18, backgroundColor: cor.af600,
    alignItems: 'center', justifyContent: 'center',
  },
  logoTexto: { color: cor.branco, fontSize: 26, fontWeight: '800', letterSpacing: 1 },
  titulo: { marginTop: 14, fontSize: 22, fontWeight: '800', color: cor.tinta },
  subtitulo: { marginTop: 4, fontSize: 14, color: cor.graf400 },
  rotulo: { marginBottom: 6, fontSize: 13, fontWeight: '600', color: cor.graf500 },
  campo: {
    minHeight: TOQUE,
    borderWidth: 1,
    borderColor: cor.graf200,
    borderRadius: raio.m,
    paddingHorizontal: 14,
    fontSize: 16,
    color: cor.tinta,
    backgroundColor: cor.branco,
  },
  rodape: {
    marginTop: 28, fontSize: 12, lineHeight: 18,
    color: cor.graf400, textAlign: 'center',
  },
})
