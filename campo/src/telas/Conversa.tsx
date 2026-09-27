import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '../lib/auth'
import {
  assinarConversa, carregarConversa, enviarMensagem, marcarLida, type Mensagem,
} from '../lib/mensagens'
import { carimbo, isoLocal } from '../lib/formato'
import { Aviso, Carregando } from '../ui/componentes'
import { CabecalhoAba } from '../ui/CabecalhoAba'
import { BarraInferior } from '../ui/BarraInferior'
import { cor, raio, TOQUE } from '../ui/tema'

/**
 * A conversa com o controle (091).
 *
 * Não é o aviso: o aviso é a observação colada numa mudança de status
 * (059). Aqui é conversa solta — "o cliente pediu para voltar às 15h",
 * "preciso de apoio no poste". O técnico escreve para O CONTROLE, e quem
 * estiver com a equipe dele responde; o nome de quem respondeu vem em
 * cada mensagem.
 *
 * Sem sinal, o envio falha e o TEXTO FICA na caixa — perder o que o
 * técnico digitou no sol, com uma mão, é o pior defeito possível aqui.
 */
export default function Conversa() {
  const { tecnicoId } = useAuth()
  const [msgs, setMsgs] = useState<Mensagem[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const rolagem = useRef<ScrollView>(null)

  useEffect(() => {
    if (!tecnicoId) { setCarregando(false); return }
    let vivo = true
    carregarConversa(tecnicoId)
      .then(l => { if (vivo) setMsgs(l) })
      .catch(err => { if (vivo) setErro(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (vivo) setCarregando(false) })
    marcarLida().catch(() => {})
    const parar = assinarConversa(tecnicoId, m => {
      setMsgs(atual => atual.some(x => x.id === m.id) ? atual : [...atual, m])
      // Chegou com a tela aberta: está lida.
      if (!m.do_campo) marcarLida().catch(() => {})
    })
    return () => { vivo = false; parar() }
  }, [tecnicoId])

  async function enviar() {
    const t = texto.trim()
    if (!t || enviando) return
    setEnviando(true); setErro(null)
    try {
      await enviarMensagem(t)
      setTexto('')
      // O Realtime traz a linha de volta; se ele estiver atrasado, a
      // leitura garante (a linha é a verdade).
      if (tecnicoId) setMsgs(await carregarConversa(tecnicoId))
    } catch (err) {
      setErro(`Não foi enviada — o texto continua aí. ${err instanceof Error ? err.message : ''}`)
    } finally {
      setEnviando(false)
    }
  }

  if (!tecnicoId && !carregando) {
    return (
      <SafeAreaView style={e.tela} edges={['top']}>
        <CabecalhoAba titulo="Conversa" />
        <View style={{ padding: 16 }}>
          <Aviso tipo="atencao">
            Este login não está ligado a um técnico, então não tem conversa com o controle.
          </Aviso>
        </View>
        <View style={{ flex: 1 }} />
        <BarraInferior ativa="Conversa" />
      </SafeAreaView>
    )
  }

  const hoje = isoLocal()
  return (
    <SafeAreaView style={e.tela} edges={['top']}>
      <CabecalhoAba titulo="Conversa com o controle" subtitulo="Quem estiver com a sua equipe responde" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={rolagem}
          contentContainerStyle={e.lista}
          onContentSizeChange={() => rolagem.current?.scrollToEnd({ animated: false })}
        >
          {carregando && <Carregando texto="Abrindo a conversa…" />}
          {!carregando && msgs.length === 0 && (
            <View style={e.vazio}>
              <Text style={e.vazioTitulo}>Nenhuma mensagem ainda</Text>
              <Text style={e.vazioTexto}>
                Escreva para o controle: um apoio, uma dúvida sobre o contrato, um
                recado do cliente. Para pedir ajuda num contrato, use também o
                Impedimento na tela dele — é o que acende o alerta na central.
              </Text>
            </View>
          )}
          {msgs.map((m, i) => {
            const meu = m.do_campo
            const quando = m.criado_em.slice(0, 10) === hoje
              ? carimbo(m.criado_em).slice(6) : carimbo(m.criado_em)
            const mesmoAutor = i > 0 && msgs[i - 1].do_campo === m.do_campo
              && msgs[i - 1].autor_nome === m.autor_nome
            return (
              <View key={m.id} style={[e.linha, meu ? e.linhaMinha : e.linhaDele,
                                        !mesmoAutor && { marginTop: 8 }]}>
                {!meu && !mesmoAutor && (
                  <Text style={e.autor}>{m.autor_nome ?? 'Controle'}</Text>
                )}
                <View style={[e.balao, meu ? e.balaoMeu : e.balaoDele]}>
                  <Text style={[e.texto, meu && { color: cor.branco }]}>{m.texto}</Text>
                </View>
                <Text style={e.hora}>
                  {quando}{meu ? (m.lida_em ? ' · lida' : ' · enviada') : ''}
                </Text>
              </View>
            )
          })}
        </ScrollView>

        {erro && <View style={{ paddingHorizontal: 12 }}><Aviso tipo="erro">{erro}</Aviso></View>}

        <View style={e.compor}>
          <TextInput
            value={texto}
            onChangeText={setTexto}
            placeholder="Escreva para o controle…"
            placeholderTextColor={cor.graf500}
            multiline
            maxLength={2000}
            style={e.caixa}
            accessibilityLabel="Mensagem para o controle"
          />
          <Pressable onPress={enviar} disabled={!texto.trim() || enviando}
            accessibilityRole="button" accessibilityLabel="Enviar"
            style={({ pressed }) => [e.enviar,
              (!texto.trim() || enviando) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}>
            <Text style={e.enviarTexto}>{enviando ? '…' : 'Enviar'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <BarraInferior ativa="Conversa" />
    </SafeAreaView>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.graf50 },
  lista: { padding: 12, paddingBottom: 16 },
  vazio: { padding: 24, alignItems: 'center' },
  vazioTitulo: { fontSize: 16, fontWeight: '800', color: cor.graf600 },
  vazioTexto: { fontSize: 14, color: cor.graf500, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  linha: { maxWidth: '84%', marginTop: 3 },
  linhaMinha: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  linhaDele: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  autor: { fontSize: 12, fontWeight: '800', color: cor.af700, marginBottom: 2, marginLeft: 4 },
  balao: { borderRadius: raio.g, paddingHorizontal: 13, paddingVertical: 9 },
  balaoMeu: { backgroundColor: cor.tinta, borderBottomRightRadius: 4 },
  balaoDele: {
    backgroundColor: cor.branco, borderWidth: 1, borderColor: cor.graf200, borderBottomLeftRadius: 4,
  },
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
