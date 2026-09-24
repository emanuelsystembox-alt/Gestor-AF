import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { supabase } from '../lib/supabase'
import { Botao, Cartao, Aviso, Vazio, Carregando } from '../ui/componentes'
import { cor, raio, TOQUE } from '../ui/tema'
import type { Pilha } from '../navegacao'

/**
 * Meus romaneios — o recibo do que o técnico recebeu e devolveu.
 *
 * ┌─ POR QUE ESTA TELA EXISTE ───────────────────────────────────────┐
 * │ > "o almoxarife monta a carga […] e o TÉCNICO CONFIRMA"          │
 * │ >  — Emanuel                                                      │
 * │                                                                   │
 * │ Na fase 2 quem confirmava era o almoxarife, no balcão, porque o   │
 * │ aplicativo não tinha onde. Confirmar no lugar de alguém é assinar │
 * │ por ele — funciona enquanto os dois estão frente a frente e       │
 * │ deixa de funcionar no dia da divergência, que é justamente o dia  │
 * │ em que o documento importa.                                       │
 * │                                                                   │
 * │ Aqui o técnico lê o que está saindo na mão dele e confirma com o  │
 * │ próprio dedo. `confirmado_por` passa a ser ele (079).             │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * A tela é de LEITURA e um botão. O técnico não monta carga, não tira
 * item, não corrige quantidade — se algo está errado, ele fala com o
 * almoxarife, que é quem tem o documento aberto do outro lado. Dar
 * edição aqui seria transformar o recibo em negociação.
 */

type Props = NativeStackScreenProps<Pilha, 'Romaneios'>

interface Peca { serial: string; tipo: string | null; modelo: string | null }
interface ItemMisc { nome: string; codigo: string; unidade: string; qtd: number }

interface Romaneio {
  id: string
  numero: number
  tipo: 'ENTREGA' | 'DEVOLUCAO'
  situacao: 'ABERTO' | 'CONFIRMADO' | 'CANCELADO'
  observacao: string | null
  criado_em: string
  confirmado_em: string | null
  pecas: Peca[]
  itens: ItemMisc[]
}

const qtd = (n: number) =>
  Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

export default function Romaneios({ navigation }: Props) {
  const [lista, setLista] = useState<Romaneio[]>([])
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true)
    setErro(null)
    const { data, error } = await supabase.rpc('meus_romaneios')
    if (error) setErro(error.message)
    else setLista((data ?? []) as Romaneio[])
    setCarregando(false)
    setAtualizando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function perguntar(r: Romaneio) {
    const total = r.pecas.length + r.itens.length
    Alert.alert(
      r.tipo === 'ENTREGA' ? 'Confirmar o recebimento?' : 'Confirmar a devolução?',
      r.tipo === 'ENTREGA'
        ? `Você está declarando que RECEBEU ${total} lançamento(s) do romaneio `
          + `${r.numero}. A partir daqui as peças ficam na sua responsabilidade.`
        : `Você está declarando que DEVOLVEU ${total} lançamento(s) ao almoxarifado `
          + `no romaneio ${r.numero}.`,
      [
        { text: 'Agora não', style: 'cancel' },
        { text: 'Confirmar', style: 'default', onPress: () => confirmar(r) },
      ],
    )
  }

  async function confirmar(r: Romaneio) {
    setConfirmando(r.id); setErro(null); setOk(null)
    const { error } = await supabase.rpc('confirmar_romaneio', { p_romaneio: r.id })
    if (error) {
      setErro(/permiss/i.test(error.message)
        ? 'Este romaneio não é seu.'
        : error.message)
    } else {
      setOk(`Romaneio ${r.numero} confirmado. Ele fica no seu histórico.`)
      await carregar(true)
    }
    setConfirmando(null)
  }

  return (
    <SafeAreaView style={e.tela} edges={['top', 'bottom']}>
      <View style={e.topo}>
        <Pressable onPress={() => navigation.goBack()} style={e.voltar}
          accessibilityRole="button" accessibilityLabel="Voltar para a agenda">
          <Text style={e.voltarTexto}>‹ Agenda</Text>
        </Pressable>
        <Text style={e.titulo}>Meus romaneios</Text>
        <Text style={e.sub}>O que o almoxarifado entregou e o que voltou</Text>
      </View>

      {carregando ? (
        <Carregando texto="Buscando…" />
      ) : (
        <ScrollView contentContainerStyle={e.corpo}
          refreshControl={
            <RefreshControl refreshing={atualizando} tintColor={cor.graf400}
              onRefresh={() => { setAtualizando(true); carregar(true) }} />
          }>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {ok && <Aviso tipo="ok">{ok}</Aviso>}

          {lista.length === 0 ? (
            <Vazio titulo="Nenhum romaneio"
              descricao="Quando o almoxarifado montar uma carga no seu nome, ela aparece aqui para você conferir e confirmar." />
          ) : lista.map(r => {
            const aberto = r.situacao === 'ABERTO'
            return (
              <Cartao key={r.id} style={{ marginBottom: 12 }}>
                <View style={e.cabecalho}>
                  <Text style={e.numero}>Romaneio {r.numero}</Text>
                  <View style={[e.selo, {
                    backgroundColor: aberto ? cor.ambar50 : cor.verde50,
                    borderColor: aberto ? cor.ambar : cor.verde,
                  }]}>
                    <Text style={[e.seloTexto, { color: aberto ? '#92400e' : cor.verde900 }]}>
                      {aberto ? 'a confirmar' : 'confirmado'}
                    </Text>
                  </View>
                </View>
                <Text style={e.tipo}>
                  {r.tipo === 'ENTREGA' ? 'Entrega para você' : 'Devolução ao almoxarifado'}
                  {r.observacao ? ` · ${r.observacao}` : ''}
                </Text>

                {r.pecas.length > 0 && (
                  <View style={e.bloco}>
                    <Text style={e.blocoTitulo}>
                      Equipamentos · {r.pecas.length}
                    </Text>
                    {r.pecas.map(p => (
                      <View key={p.serial} style={e.linha}>
                        <Text style={e.serial}>{p.serial}</Text>
                        <Text style={e.descricao} numberOfLines={1}>
                          {[p.tipo, p.modelo].filter(Boolean).join(' · ') || '—'}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {r.itens.length > 0 && (
                  <View style={e.bloco}>
                    <Text style={e.blocoTitulo}>Materiais · {r.itens.length}</Text>
                    {r.itens.map(i => (
                      <View key={i.codigo} style={e.linha}>
                        <Text style={e.qtdTexto}>{qtd(i.qtd)} {i.unidade}</Text>
                        <Text style={e.descricao} numberOfLines={1}>{i.nome}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {aberto ? (
                  <>
                    {/* O que ele está assinando, escrito antes do botão —
                        não depois, num aviso que some. */}
                    <Text style={e.recado}>
                      {r.tipo === 'ENTREGA'
                        ? 'Confira item por item antes de confirmar. Depois de confirmado, isto é o que consta como recebido por você.'
                        : 'Confirmando, estes itens saem da sua responsabilidade.'}
                    </Text>
                    <Botao grande
                      titulo={r.tipo === 'ENTREGA' ? 'Confirmo que recebi' : 'Confirmo a devolução'}
                      tom="sucesso"
                      carregando={confirmando === r.id}
                      desativado={confirmando !== null}
                      aoTocar={() => perguntar(r)}
                      style={{ marginTop: 10 }} />
                  </>
                ) : (
                  <Text style={e.confirmado}>
                    Confirmado em{' '}
                    {r.confirmado_em
                      ? new Date(r.confirmado_em).toLocaleString('pt-BR')
                      : '—'}
                  </Text>
                )}
              </Cartao>
            )
          })}
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
  corpo: { padding: 16 },
  cabecalho: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  numero: { fontSize: 17, fontWeight: '700', color: cor.tinta },
  selo: { borderWidth: 1, borderRadius: raio.s, paddingHorizontal: 8, paddingVertical: 2 },
  seloTexto: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  tipo: { fontSize: 13, color: cor.graf400, marginTop: 2 },
  bloco: { marginTop: 12 },
  blocoTitulo: {
    fontSize: 11, fontWeight: '700', color: cor.graf400,
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4,
  },
  linha: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 6, borderTopWidth: 1, borderTopColor: cor.graf100,
  },
  serial: { fontSize: 15, fontWeight: '600', color: cor.tinta, fontVariant: ['tabular-nums'] },
  qtdTexto: {
    fontSize: 15, fontWeight: '700', color: cor.tinta, minWidth: 74,
    fontVariant: ['tabular-nums'],
  },
  descricao: { flex: 1, fontSize: 13, color: cor.graf400 },
  recado: { fontSize: 13, color: cor.graf500, marginTop: 12, lineHeight: 19 },
  confirmado: { fontSize: 13, color: cor.verde900, marginTop: 12, fontWeight: '600' },
})
