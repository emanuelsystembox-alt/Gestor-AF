import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useAuth } from '../lib/auth'
import {
  assinarMensagensColega, carregarConversaColega, enviarAoColega, marcarColegaLida,
  type MensagemColega,
} from '../lib/colegas'
import { carimbo, isoLocal } from '../lib/formato'
import { Aviso, Carregando } from '../ui/componentes'
import { cor, raio, TOQUE } from '../ui/tema'
import type { Pilha } from '../navegacao'

/**
 * A conversa com um colega (130, Geo-Rota) — pedir ajuda ou material a
 * quem está perto. Os dois leem, e a gestão que vê a equipe de um deles
 * também (escolha do Emanuel, 24/10): o recado aparece no topo para
 * ninguém escrever achando que é privado.
 *
 * Como na Conversa com o controle: sem sinal, o TEXTO FICA na caixa.
 */
type Props = NativeStackScreenProps<Pilha, 'ConversaColega'>

const ATALHOS = ['Preciso de ajuda aqui perto', 'Tem equipamento sobrando?', 'Pode me ligar?']

export default function ConversaColega({ route, navigation }: Props) {
  const { id: colega, nome, equipe } = route.params
  const { tecnicoId } = useAuth()
  const [msgs, setMsgs] = useState<MensagemColega[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const rolagem = useRef<ScrollView>(null)

  useEffect(() => {
    if (!tecnicoId) { setCarregando(false); return }
    let vivo = true
    carregarConversaColega(tecnicoId, colega)
      .then(l => { if (vivo) setMsgs(l) })
      .catch(err => { if (vivo) setErro(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (vivo) setCarregando(false) })
    marcarColegaLida(colega).catch(() => {})
    const parar = assinarMensagensColega(tecnicoId, m => {
      if (m.de_tecnico_id !== colega) return
      setMsgs(atual => atual.some(x => x.id === m.id) ? atual : [...atual, m])
      marcarColegaLida(colega).catch(() => {})
    })
    return () => { vivo = false; parar() }
  }, [tecnicoId, colega])

  async function enviar(t = texto.trim()) {
    if (!t || enviando || !tecnicoId) return
    setEnviando(true); setErro(null)
    try {
      await enviarAoColega(colega, t)
      setTexto('')
      setMsgs(await carregarConversaColega(tecnicoId, colega))
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
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={e.voltar}>
          <Text style={e.voltarTexto}>‹</Text>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={e.titulo} numberOfLines={1}>{nome}</Text>
          <Text style={e.sub} numberOfLines={1}>
            {equipe ? `Equipe ${equipe} · ` : ''}a gestão também lê esta conversa
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView ref={rolagem} contentContainerStyle={e.lista}
          onContentSizeChange={() => rolagem.current?.scrollToEnd({ animated: false })}>
          {carregando && <Carregando texto="Abrindo a conversa…" />}
          {!carregando && msgs.length === 0 && (
            <View style={e.vazio}>
              <Text style={e.vazioTexto}>Comece com um toque:</Text>
              {ATALHOS.map(a => (
                <Pressable key={a} onPress={() => enviar(a)} style={e.atalho} accessibilityRole="button">
                  <Text style={e.atalhoTexto}>{a}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {msgs.map(m => {
            const meu = m.de_tecnico_id === tecnicoId
            const quando = m.criado_em.slice(0, 10) === hoje
              ? carimbo(m.criado_em).slice(6) : carimbo(m.criado_em)
            return (
              <View key={m.id} style={[e.linha, meu ? e.linhaMinha : e.linhaDele]}>
                <View style={[e.balao, meu ? e.balaoMeu : e.balaoDele]}>
                  <Text style={[e.texto, meu && { color: cor.branco }]}>{m.texto}</Text>
                </View>
                <Text style={e.hora}>{quando}{meu ? (m.lida_em ? ' · lida' : ' · enviada') : ''}</Text>
              </View>
            )
          })}
        </ScrollView>

        {erro && <View style={{ paddingHorizontal: 12 }}><Aviso tipo="erro">{erro}</Aviso></View>}

        <View style={e.compor}>
          <TextInput value={texto} onChangeText={setTexto}
            placeholder={`Escreva para ${nome.split(' ')[0]}…`} placeholderTextColor={cor.graf500}
            multiline maxLength={1000} style={e.caixa} accessibilityLabel="Mensagem para o colega" />
          <Pressable onPress={() => enviar()} disabled={!texto.trim() || enviando}
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
  vazio: { padding: 16, gap: 8, alignItems: 'stretch' },
  vazioTexto: { fontSize: 14, color: cor.graf500, textAlign: 'center' },
  atalho: {
    borderWidth: 1, borderColor: cor.graf200, backgroundColor: cor.branco,
    borderRadius: raio.m, paddingVertical: 12, paddingHorizontal: 14,
  },
  atalhoTexto: { fontSize: 15, fontWeight: '700', color: cor.tinta },
  linha: { maxWidth: '84%', marginTop: 6 },
  linhaMinha: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  linhaDele: { alignSelf: 'flex-start', alignItems: 'flex-start' },
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
