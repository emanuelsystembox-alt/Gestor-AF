import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useAuth } from '../lib/auth'
import {
  assinarConversa, carregarColegasDaCidade, carregarConversa, carregarDestinatarios,
  enviarMensagem, marcarLida, type ColegaDaCidade, type Destinatario, type Mensagem,
} from '../lib/mensagens'
import type { Pilha } from '../navegacao'
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
const GRUPOS: { chave: Destinatario['grupo']; rotulo: string }[] = [
  { chave: 'COP', rotulo: 'COP' },
  { chave: 'SUPERVISOR', rotulo: 'Supervisor' },
  { chave: 'COORDENADOR', rotulo: 'Coordenador' },
]

export default function Conversa({ navigation }: NativeStackScreenProps<Pilha, 'Conversa'>) {
  const { tecnicoId } = useAuth()
  const [msgs, setMsgs] = useState<Mensagem[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const rolagem = useRef<ScrollView>(null)
  /**
   * Para quem vai (132, Emanuel 25/10: "o técnico poderá escolher para qual
   * usuário mandar mensagem (...) direcionar a demanda"). Nulo = o controle
   * todo, como sempre. Técnico com técnico abre a conversa entre colegas.
   */
  const [para, setPara] = useState<Destinatario | null>(null)
  const [escolhendo, setEscolhendo] = useState(false)
  const [aba, setAba] = useState<Destinatario['grupo'] | 'TECNICO'>('COP')
  const [destinatarios, setDestinatarios] = useState<Destinatario[] | null>(null)
  const [colegas, setColegas] = useState<ColegaDaCidade[] | null>(null)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    carregarDestinatarios().then(setDestinatarios).catch(() => setDestinatarios([]))
  }, [])
  useEffect(() => {
    if (!escolhendo || aba !== 'TECNICO' || colegas) return
    carregarColegasDaCidade().then(setColegas).catch(() => setColegas([]))
  }, [escolhendo, aba, colegas])

  const nomeDe = (id: string | null | undefined) =>
    id ? destinatarios?.find(d => d.usuario_id === id)?.nome ?? 'gestão' : null

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
      await enviarMensagem(t, para?.usuario_id)
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
      {/* 156g: os grupos que a coordenação montou -- "evitando o uso do
          WhatsApp" (Emanuel, 30/10). Uma faixa só, ao alcance do polegar. */}
      <Pressable onPress={() => navigation.navigate('Grupos')} accessibilityRole="button"
        accessibilityLabel="Abrir os grupos"
        style={({ pressed }) => [e.faixaGrupos, pressed && { opacity: 0.85 }]}>
        <Text style={e.faixaGruposTexto}>👥  Grupos da equipe</Text>
        <Text style={e.faixaGruposSeta}>›</Text>
      </Pressable>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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
                {meu && !!m.para_usuario_id && (
                  <Text style={e.paraQuem}>para {nomeDe(m.para_usuario_id)}</Text>
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

        {/* Para quem vai esta mensagem. */}
        <Pressable onPress={() => setEscolhendo(true)} style={e.paraLinha}
          accessibilityRole="button" accessibilityLabel="Escolher para quem mandar">
          <Text style={e.paraRotulo}>Para:</Text>
          <Text style={e.paraNome} numberOfLines={1}>
            {para ? `${para.nome} · ${GRUPOS.find(g => g.chave === para.grupo)?.rotulo}` : 'Controle (todos)'}
          </Text>
          <Text style={e.paraTrocar}>trocar ›</Text>
        </Pressable>

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

      {/* ---------- escolher o destinatário ---------- */}
      <Modal visible={escolhendo} transparent animationType="slide" onRequestClose={() => setEscolhendo(false)}>
        <Pressable style={e.veu} onPress={() => setEscolhendo(false)} />
        <View style={e.folha}>
          <Text style={e.folhaTitulo}>Para quem é a mensagem?</Text>
          <Pressable onPress={() => { setPara(null); setEscolhendo(false) }}
            style={[e.opcao, !para && e.opcaoAtiva]} accessibilityRole="radio" accessibilityState={{ checked: !para }}>
            <Text style={e.opcaoNome}>Controle (todos)</Text>
            <Text style={e.opcaoMiudo}>Quem estiver com a sua equipe responde</Text>
          </Pressable>
          <View style={e.abas}>
            {[...GRUPOS, { chave: 'TECNICO' as const, rotulo: 'Técnico' }].map(g => (
              <Pressable key={g.chave} onPress={() => setAba(g.chave)}
                style={[e.aba, aba === g.chave && e.abaAtiva]} accessibilityRole="tab"
                accessibilityState={{ selected: aba === g.chave }}>
                <Text style={[e.abaTexto, aba === g.chave && { color: cor.branco }]}>{g.rotulo}</Text>
              </Pressable>
            ))}
          </View>
          {aba === 'TECNICO' && (
            <TextInput value={busca} onChangeText={setBusca} placeholder="Buscar nome ou equipe…"
              placeholderTextColor={cor.graf500} style={e.busca} accessibilityLabel="Buscar técnico" />
          )}
          <ScrollView style={{ maxHeight: 300 }}>
            {aba === 'TECNICO' ? (
              colegas === null ? <Carregando texto="Carregando colegas…" />
              : colegas.filter(c => {
                  const q = busca.trim().toLowerCase()
                  return !q || c.nome.toLowerCase().includes(q) || (c.equipe ?? '').includes(q)
                }).slice(0, 60).map(c => (
                  <Pressable key={c.tecnico_id} style={e.opcao}
                    onPress={() => {
                      setEscolhendo(false)
                      navigation.navigate('ConversaColega', { id: c.tecnico_id, nome: c.nome, equipe: c.equipe })
                    }}>
                    <Text style={e.opcaoNome}>{c.nome}</Text>
                    <Text style={e.opcaoMiudo}>{c.equipe ? `Equipe ${c.equipe}` : 'sem equipe'} · conversa só entre vocês e a gestão</Text>
                  </Pressable>
                ))
            ) : destinatarios === null ? <Carregando texto="Carregando…" />
              : (() => {
                  const lista = destinatarios.filter(d => d.grupo === aba)
                  if (lista.length === 0) {
                    return <Text style={e.vazioTexto}>Ninguém cadastrado ainda nesse grupo para a sua cidade.</Text>
                  }
                  return lista.map(d => (
                    <Pressable key={d.usuario_id} onPress={() => { setPara(d); setEscolhendo(false) }}
                      style={[e.opcao, para?.usuario_id === d.usuario_id && e.opcaoAtiva]}
                      accessibilityRole="radio" accessibilityState={{ checked: para?.usuario_id === d.usuario_id }}>
                      <Text style={e.opcaoNome}>{d.nome}</Text>
                      <Text style={e.opcaoMiudo}>{d.cargo ?? GRUPOS.find(g => g.chave === d.grupo)?.rotulo}</Text>
                    </Pressable>
                  ))
                })()}
          </ScrollView>
        </View>
      </Modal>
      <BarraInferior ativa="Conversa" />
    </SafeAreaView>
  )
}

const e = StyleSheet.create({
  faixaGrupos: {
    flexDirection: 'row', alignItems: 'center', minHeight: TOQUE, paddingHorizontal: 16,
    backgroundColor: cor.branco, borderBottomWidth: 1, borderBottomColor: cor.graf100,
  },
  faixaGruposTexto: { flex: 1, fontSize: 15, fontWeight: '800', color: cor.tinta },
  faixaGruposSeta: { fontSize: 24, color: cor.graf500 },
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
  paraQuem: { fontSize: 11, fontWeight: '700', color: cor.af700, marginBottom: 2, marginRight: 4 },
  paraLinha: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: cor.branco, borderTopWidth: 1, borderTopColor: cor.graf200,
  },
  paraRotulo: { fontSize: 13, color: cor.graf500 },
  paraNome: { flex: 1, fontSize: 14, fontWeight: '800', color: cor.tinta },
  paraTrocar: { fontSize: 13, fontWeight: '700', color: cor.af700 },
  veu: { flex: 1, backgroundColor: 'rgba(15,17,21,0.45)' },
  folha: {
    backgroundColor: cor.branco, padding: 16, gap: 10,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
  },
  folhaTitulo: { fontSize: 17, fontWeight: '800', color: cor.tinta },
  opcao: {
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: raio.m,
    borderWidth: 1, borderColor: cor.graf200, marginBottom: 6,
  },
  opcaoAtiva: { borderColor: cor.af600, borderWidth: 2, backgroundColor: cor.af50 },
  opcaoNome: { fontSize: 15, fontWeight: '700', color: cor.tinta },
  opcaoMiudo: { fontSize: 12, color: cor.graf500, marginTop: 1 },
  abas: { flexDirection: 'row', gap: 6 },
  aba: {
    flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: raio.s, backgroundColor: cor.graf50,
  },
  abaAtiva: { backgroundColor: cor.tinta },
  abaTexto: { fontSize: 13, fontWeight: '700', color: cor.graf600 },
  busca: {
    minHeight: 44, borderWidth: 1, borderColor: cor.graf200, borderRadius: raio.m,
    paddingHorizontal: 12, fontSize: 15, color: cor.tinta, backgroundColor: cor.graf50,
  },
})
