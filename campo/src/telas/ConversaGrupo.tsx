import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useAuth } from '../lib/auth'
import {
  assinarGrupo, carregarMensagensGrupo, enviarAoGrupo, marcarGrupoLido, type MensagemGrupo,
} from '../lib/grupos'
import { carimbo, isoLocal } from '../lib/formato'
import { Aviso, Carregando } from '../ui/componentes'
import { cor, raio, TOQUE } from '../ui/tema'
import type { Pilha } from '../navegacao'

/**
 * Um grupo do chat (156g). Todos os membros escrevem (decisão do
 * Emanuel, 30/10). Como nas outras conversas do app: sem sinal, o TEXTO
 * FICA na caixa — mensagem perdida no trajeto é pior que mensagem
 * atrasada.
 */
type Props = NativeStackScreenProps<Pilha, 'ConversaGrupo'>

export default function ConversaGrupo({ route, navigation }: Props) {
  const { id: grupo, nome } = route.params
  const eu = useAuth().session?.user.id ?? null
  const [msgs, setMsgs] = useState<MensagemGrupo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const rolagem = useRef<ScrollView>(null)

  useEffect(() => {
    let vivo = true
    carregarMensagensGrupo(grupo)
      .then(l => { if (vivo) setMsgs(l) })
      .catch(err => { if (vivo) setErro(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (vivo) setCarregando(false) })
    marcarGrupoLido(grupo).catch(() => {})
    const parar = assinarGrupo(grupo, m => {
      setMsgs(atual => atual.some(x => x.id === m.id) ? atual : [...atual, m])
      marcarGrupoLido(grupo).catch(() => {})
    })
    return () => { vivo = false; parar() }
  }, [grupo])

  async function enviar() {
    const t = texto.trim()
    if (!t || enviando) return
    setEnviando(true); setErro(null)
    try {
      await enviarAoGrupo(grupo, t)
      setTexto('')
      setMsgs(await carregarMensagensGrupo(grupo))
    } catch (err) {
      setErro(`Não foi enviada — o texto continua aí. ${err instanceof Error ? err.message : ''}`)
    } finally {
      setEnviando(false)
    }
  }

  const hoje = isoLocal()
  return (
    <SafeAreaView style={e.tela} edges={['top']}>
      <View style={e.cabecalho}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={e.voltar}
          accessibilityRole="button" accessibilityLabel="Voltar">
          <Text style={e.voltarTexto}>‹</Text>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={e.titulo} numberOfLines={1}>{nome}</Text>
          <Text style={e.sub} numberOfLines={1}>Grupo · todos os membros leem e escrevem</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView ref={rolagem} contentContainerStyle={e.lista}
          onContentSizeChange={() => rolagem.current?.scrollToEnd({ animated: false })}>
          {carregando && <Carregando texto="Abrindo o grupo…" />}
          {!carregando && msgs.length === 0 && (
            <Text style={e.vazio}>Nenhuma mensagem ainda. Escreva a primeira.</Text>
          )}
          {msgs.map((m, i) => {
            const meu = m.usuario_id === eu
            const quando = m.criado_em.slice(0, 10) === hoje
              ? carimbo(m.criado_em).slice(6) : carimbo(m.criado_em)
            const mesmoAutor = i > 0 && msgs[i - 1].usuario_id === m.usuario_id
            return (
              <View key={m.id} style={[e.linha, meu ? e.linhaMinha : e.linhaDele,
                                        !mesmoAutor && { marginTop: 8 }]}>
                {!meu && !mesmoAutor && <Text style={e.autor}>{m.autor_nome ?? '—'}</Text>}
                <View style={[e.balao, meu ? e.balaoMeu : e.balaoDele]}>
                  <Text style={[e.texto, meu && { color: cor.branco }]}>{m.texto}</Text>
                </View>
                <Text style={e.hora}>{quando}</Text>
              </View>
            )
          })}
        </ScrollView>

        {erro && <View style={{ paddingHorizontal: 12 }}><Aviso tipo="erro">{erro}</Aviso></View>}

        <View style={e.compor}>
          <TextInput value={texto} onChangeText={setTexto}
            placeholder="Escreva para o grupo…" placeholderTextColor={cor.graf500}
            multiline maxLength={2000} style={e.caixa} accessibilityLabel="Mensagem para o grupo" />
          <Pressable onPress={enviar} disabled={!texto.trim() || enviando}
            accessibilityRole="button" accessibilityLabel="Enviar"
            style={({ pressed }) => [e.enviar,
              (!texto.trim() || enviando) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}>
            <Text style={e.enviarTexto}>{enviando ? '…' : 'Enviar'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.graf50 },
  cabecalho: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 10,
    backgroundColor: cor.branco, borderBottomWidth: 1, borderBottomColor: cor.graf100,
  },
  voltar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  voltarTexto: { fontSize: 30, color: cor.graf500, lineHeight: 32 },
  titulo: { fontSize: 16, fontWeight: '800', color: cor.tinta },
  sub: { fontSize: 12, color: cor.graf500 },
  lista: { padding: 12, paddingBottom: 16 },
  vazio: { fontSize: 14, color: cor.graf500, textAlign: 'center', padding: 24 },
  linha: { maxWidth: '84%', marginTop: 4 },
  linhaMinha: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  linhaDele: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  autor: { fontSize: 12, fontWeight: '800', color: cor.af600, marginBottom: 2, marginHorizontal: 4 },
  balao: { borderRadius: raio.g, paddingHorizontal: 13, paddingVertical: 9 },
  balaoMeu: { backgroundColor: cor.tinta, borderBottomRightRadius: 4 },
  balaoDele: { backgroundColor: cor.branco, borderWidth: 1, borderColor: cor.graf200, borderBottomLeftRadius: 4 },
  texto: { fontSize: 15, lineHeight: 21, color: cor.tinta },
  hora: { fontSize: 11, color: cor.graf500, marginTop: 2, marginHorizontal: 4 },
  compor: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8,
    backgroundColor: cor.branco, borderTopWidth: 1, borderTopColor: cor.graf200,
  },
  caixa: {
    flex: 1, minHeight: TOQUE, maxHeight: 130, borderWidth: 1, borderColor: cor.graf200,
    borderRadius: raio.m, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15,
    color: cor.tinta, backgroundColor: cor.graf50,
  },
  enviar: {
    minHeight: TOQUE, paddingHorizontal: 18, borderRadius: raio.m,
    backgroundColor: cor.af600, alignItems: 'center', justifyContent: 'center',
  },
  enviarTexto: { color: cor.branco, fontSize: 16, fontWeight: '800' },
})
