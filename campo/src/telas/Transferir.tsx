import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, Pressable, TextInput, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { supabase } from '../lib/supabase'
import { Botao, Cartao, Aviso, Vazio, Carregando } from '../ui/componentes'
import { cor, raio, TOQUE } from '../ui/tema'
import type { Pilha } from '../navegacao'

/**
 * Transferir para um colega — o técnico PEDE (089-C, D-165).
 *
 * ┌─ AS TRÊS MÃOS ───────────────────────────────────────────────────┐
 * │ > "o técnico envia, o outro aceita, e o time central do almox     │
 * │ >  precisa aprovar" — Emanuel                                     │
 * │                                                                   │
 * │ Esta tela é a primeira mão: escolhe o colega e o que vai. Nada    │
 * │ muda de carga aqui. O colega aceita no celular DELE (com a        │
 * │ digital), e só quando o almoxarifado aprova a peça sai da sua     │
 * │ conta e entra na dele. Até lá, se desistir, é só cancelar.        │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * Só aparece o que está na carga dele: o banco recusaria o resto
 * (`solicitar_transferencia`), e oferecer o que vai falhar é ruim.
 */

type Props = NativeStackScreenProps<Pilha, 'Transferir'>

interface Colega { id: string; nome: string; matricula: string | null }
interface Peca { serial: string; tipo: string | null; modelo: string | null }
interface Material { item_id: string; nome: string; unidade: string; saldo: number }

const qtdTexto = (n: number) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

export default function Transferir({ navigation }: Props) {
  const [colegas, setColegas] = useState<Colega[]>([])
  const [pecas, setPecas] = useState<Peca[]>([])
  const [materiais, setMateriais] = useState<Material[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const [busca, setBusca] = useState('')
  const [destino, setDestino] = useState<Colega | null>(null)
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [qtds, setQtds] = useState<Record<string, string>>({})
  const [obs, setObs] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [c, p, m] = await Promise.all([
      supabase.rpc('tecnicos_para_transferir'),
      supabase.rpc('minha_carga'),
      supabase.rpc('minha_miscelanea'),
    ])
    if (c.error || p.error || m.error) setErro((c.error ?? p.error ?? m.error)!.message)
    setColegas((c.data ?? []) as Colega[])
    setPecas((p.data ?? []) as Peca[])
    setMateriais((m.data ?? []) as Material[])
    setCarregando(false)
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const achados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (t.length < 2) return []
    return colegas.filter(c => c.nome.toLowerCase().includes(t)
      || (c.matricula ?? '').toLowerCase().includes(t)).slice(0, 8)
  }, [busca, colegas])

  const itensValidos = materiais
    .map(m => ({ m, q: Number((qtds[m.item_id] ?? '').replace(',', '.')) }))
    .filter(x => x.q > 0)
  const passou = itensValidos.some(x => x.q > x.m.saldo)
  const total = marcadas.size + itensValidos.length

  function alternar(serial: string) {
    setMarcadas(s => { const n = new Set(s); if (n.has(serial)) n.delete(serial); else n.add(serial); return n })
  }

  function confirmarEnvio() {
    if (!destino || total === 0 || passou) return
    Alert.alert(
      'Enviar o pedido?',
      `${marcadas.size} equipamento(s) e ${itensValidos.length} material(is) para ${destino.nome}. `
        + 'Ele precisa aceitar no celular dele e o almoxarifado aprovar. Até lá, continua na sua carga.',
      [{ text: 'Agora não', style: 'cancel' }, { text: 'Enviar', onPress: () => { enviar() } }],
    )
  }

  async function enviar() {
    if (!destino) return
    setEnviando(true); setErro(null)
    const { data, error } = await supabase.rpc('solicitar_transferencia', {
      p_destino: destino.id,
      p_seriais: [...marcadas],
      p_itens: itensValidos.map(x => ({ item_id: x.m.item_id, quantidade: x.q })),
      p_observacao: obs.trim() || null,
    })
    setEnviando(false)
    if (error) { setErro(error.message); return }
    const r = data as { numero: number }
    Alert.alert('Pedido enviado', `Romaneio ${r.numero}: agora ${destino.nome} aceita e o almoxarifado aprova.`)
    navigation.goBack()
  }

  return (
    <SafeAreaView style={e.tela} edges={['top', 'bottom']}>
      <View style={e.topo}>
        <Pressable onPress={() => navigation.goBack()} style={e.voltar}
          accessibilityRole="button" accessibilityLabel="Voltar para meu material">
          <Text style={e.voltarTexto}>‹ Meu material</Text>
        </Pressable>
        <Text style={e.titulo}>Transferir para um colega</Text>
        <Text style={e.sub}>Ele aceita, o almoxarifado aprova — só aí sai da sua carga</Text>
      </View>

      {carregando ? <Carregando texto="Buscando…" /> : (
        <ScrollView contentContainerStyle={e.corpo} keyboardShouldPersistTaps="handled">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}

          {pecas.length === 0 && materiais.length === 0 ? (
            <Vazio titulo="Nada na sua carga"
              descricao="Quando você tiver equipamento ou material, dá para passar para um colega por aqui." />
          ) : (<>
            {/* ---- 1. para quem ---- */}
            <Cartao style={{ marginBottom: 12 }}>
              <Text style={e.passo}>1 · Para quem</Text>
              {destino ? (
                <View style={e.escolhido}>
                  <Text style={e.escolhidoNome}>{destino.nome}</Text>
                  <Pressable onPress={() => setDestino(null)} hitSlop={8} accessibilityRole="button">
                    <Text style={e.trocar}>trocar</Text>
                  </Pressable>
                </View>
              ) : (<>
                <TextInput value={busca} onChangeText={setBusca} placeholder="digite o nome ou a matrícula"
                  placeholderTextColor={cor.graf300} autoCorrect={false} style={e.campo}
                  accessibilityLabel="Buscar colega" />
                {achados.map(c => (
                  <Pressable key={c.id} onPress={() => { setDestino(c); setBusca('') }} style={e.opcao}
                    accessibilityRole="button" accessibilityLabel={`Escolher ${c.nome}`}>
                    <Text style={e.opcaoTexto}>{c.nome}</Text>
                    {!!c.matricula && <Text style={e.miudo}>{c.matricula}</Text>}
                  </Pressable>
                ))}
                {busca.trim().length >= 2 && achados.length === 0 && (
                  <Text style={e.miudo}>Ninguém com esse nome.</Text>
                )}
              </>)}
            </Cartao>

            {/* ---- 2. o que vai ---- */}
            {pecas.length > 0 && (
              <Cartao style={{ marginBottom: 12 }}>
                <Text style={e.passo}>2 · Equipamentos · {marcadas.size} de {pecas.length}</Text>
                {pecas.map(p => {
                  const on = marcadas.has(p.serial)
                  return (
                    <Pressable key={p.serial} onPress={() => alternar(p.serial)}
                      style={[e.linhaMarcar, on && e.linhaMarcada]}
                      accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                      accessibilityLabel={`Serial ${p.serial}`}>
                      <View style={[e.caixa, on && e.caixaMarcada]}>
                        {on && <Text style={e.check}>✓</Text>}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={e.serial}>{p.serial}</Text>
                        <Text style={e.miudo} numberOfLines={1}>
                          {[p.tipo, p.modelo].filter(Boolean).join(' · ') || '—'}
                        </Text>
                      </View>
                    </Pressable>
                  )
                })}
              </Cartao>
            )}

            {materiais.length > 0 && (
              <Cartao style={{ marginBottom: 12 }}>
                <Text style={e.passo}>Material · quantidade a passar</Text>
                {materiais.map(m => {
                  const q = Number((qtds[m.item_id] ?? '').replace(',', '.'))
                  return (
                    <View key={m.item_id} style={e.linhaMaterial}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={e.opcaoTexto} numberOfLines={2}>{m.nome}</Text>
                        <Text style={[e.miudo, q > m.saldo && { color: cor.af700 }]}>
                          você tem {qtdTexto(m.saldo)} {m.unidade}
                        </Text>
                      </View>
                      <TextInput value={qtds[m.item_id] ?? ''} keyboardType="decimal-pad"
                        onChangeText={t => setQtds(x => ({ ...x, [m.item_id]: t }))}
                        placeholder="0" placeholderTextColor={cor.graf300}
                        style={[e.campoQtd, q > m.saldo && { borderColor: cor.af600 }]}
                        accessibilityLabel={`Quantidade de ${m.nome}`} />
                    </View>
                  )
                })}
              </Cartao>
            )}

            <TextInput value={obs} onChangeText={setObs} placeholder="observação (opcional)"
              placeholderTextColor={cor.graf300} style={[e.campo, { marginBottom: 12 }]}
              accessibilityLabel="Observação" />

            {passou && <Aviso tipo="atencao">Tem quantidade maior do que você tem.</Aviso>}
            <Botao grande titulo={total === 0 ? 'Escolha o que vai' : `Enviar pedido (${total})`}
              desativado={!destino || total === 0 || passou} carregando={enviando}
              aoTocar={confirmarEnvio} />
          </>)}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.graf50 },
  topo: {
    backgroundColor: cor.branco, paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: cor.graf100,
  },
  voltar: { minHeight: TOQUE, justifyContent: 'center' },
  voltarTexto: { fontSize: 16, color: cor.af600, fontWeight: '600' },
  titulo: { fontSize: 22, fontWeight: '700', color: cor.tinta },
  sub: { fontSize: 13, color: cor.graf400, marginTop: 2 },
  corpo: { padding: 16, paddingBottom: 40 },
  passo: {
    fontSize: 12, fontWeight: '700', color: cor.graf500, textTransform: 'uppercase',
    letterSpacing: 0.4, marginBottom: 8,
  },
  campo: {
    minHeight: TOQUE, borderWidth: 1, borderColor: cor.graf200, borderRadius: raio.m,
    paddingHorizontal: 12, fontSize: 16, color: cor.tinta, backgroundColor: cor.branco,
  },
  opcao: {
    minHeight: TOQUE, justifyContent: 'center', paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: cor.graf100,
  },
  opcaoTexto: { fontSize: 15, color: cor.tinta, fontWeight: '600' },
  miudo: { fontSize: 13, color: cor.graf500 },
  escolhido: { flexDirection: 'row', alignItems: 'center', minHeight: TOQUE },
  escolhidoNome: { flex: 1, fontSize: 17, fontWeight: '700', color: cor.tinta },
  trocar: { fontSize: 15, color: cor.af600, fontWeight: '600' },
  linhaMarcar: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TOQUE,
    paddingVertical: 6, borderTopWidth: 1, borderTopColor: cor.graf100,
  },
  linhaMarcada: { backgroundColor: cor.verde50 },
  caixa: {
    width: 28, height: 28, borderRadius: raio.s, borderWidth: 2, borderColor: cor.graf300,
    alignItems: 'center', justifyContent: 'center', backgroundColor: cor.branco,
  },
  caixaMarcada: { borderColor: cor.verde, backgroundColor: cor.verde },
  check: { color: cor.branco, fontWeight: '800', fontSize: 16 },
  serial: { fontSize: 15, fontWeight: '600', color: cor.tinta, fontVariant: ['tabular-nums'] },
  linhaMaterial: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: cor.graf100,
  },
  campoQtd: {
    width: 80, minHeight: TOQUE, borderWidth: 1, borderColor: cor.graf200, borderRadius: raio.m,
    paddingHorizontal: 10, fontSize: 16, color: cor.tinta, textAlign: 'right',
    backgroundColor: cor.branco,
  },
})
