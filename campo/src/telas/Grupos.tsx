import { useCallback, useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { carregarGrupos, type Grupo } from '../lib/grupos'
import { carimbo, isoLocal } from '../lib/formato'
import { Aviso, Carregando } from '../ui/componentes'
import { cor, raio } from '../ui/tema'
import type { Pilha } from '../navegacao'

/**
 * Os grupos de que o técnico é membro (156g).
 *
 * Quem monta o grupo é a gestão, pelo site; aqui o técnico entra nos que
 * já é membro, lê e escreve. Lista vazia é "ninguém te pôs num grupo
 * ainda" — e a tela diz isso, em vez de parecer quebrada.
 */
type Props = NativeStackScreenProps<Pilha, 'Grupos'>

export default function Grupos({ navigation }: Props) {
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const ler = useCallback(async () => {
    setErro(null)
    try { setGrupos(await carregarGrupos()) }
    catch (err) { setErro(err instanceof Error ? err.message : String(err)) }
    finally { setCarregando(false) }
  }, [])

  // Relê ao voltar de um grupo: o número de não lidas muda lá dentro.
  useEffect(() => navigation.addListener('focus', ler), [navigation, ler])

  const hoje = isoLocal()
  return (
    <SafeAreaView style={e.tela} edges={['top']}>
      <View style={e.cabecalho}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={e.voltar}
          accessibilityRole="button" accessibilityLabel="Voltar">
          <Text style={e.voltarTexto}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={e.titulo}>Grupos</Text>
          <Text style={e.sub}>Os grupos da sua cidade em que você está</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={e.lista}
        refreshControl={<RefreshControl refreshing={false} onRefresh={ler} />}>
        {carregando && <Carregando texto="Buscando seus grupos…" />}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!carregando && !erro && grupos.length === 0 && (
          <View style={e.vazio}>
            <Text style={e.vazioTitulo}>Você ainda não está em nenhum grupo</Text>
            <Text style={e.vazioTexto}>
              Os grupos são criados pela coordenação, no site. Quando alguém te colocar
              num grupo, ele aparece aqui.
            </Text>
          </View>
        )}
        {grupos.map(g => (
          <Pressable key={g.grupo_id}
            onPress={() => navigation.navigate('ConversaGrupo', { id: g.grupo_id, nome: g.nome })}
            accessibilityRole="button" accessibilityLabel={`Abrir o grupo ${g.nome}`}
            style={({ pressed }) => [e.item, pressed && { opacity: 0.85 }]}>
            <View style={e.inicial}><Text style={e.inicialTexto}>{g.nome.slice(0, 1).toUpperCase()}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={e.nome} numberOfLines={1}>{g.nome}</Text>
                <Text style={e.quando}>
                  {g.ultima_em.slice(0, 10) === hoje ? carimbo(g.ultima_em).slice(6) : carimbo(g.ultima_em)}
                </Text>
              </View>
              <Text style={e.ultima} numberOfLines={1}>
                {g.ultima_texto
                  ? `${g.ultima_minha ? 'Você' : g.ultima_autor ?? '—'}: ${g.ultima_texto}`
                  : `${g.membros} membro(s) — nenhuma mensagem ainda`}
              </Text>
            </View>
            {g.nao_lidas > 0 && (
              <View style={e.selo}><Text style={e.seloTexto}>{g.nao_lidas}</Text></View>
            )}
          </Pressable>
        ))}
      </ScrollView>
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
  titulo: { fontSize: 17, fontWeight: '800', color: cor.tinta },
  sub: { fontSize: 12, color: cor.graf500 },
  lista: { padding: 12, gap: 8 },
  vazio: { padding: 20, gap: 6, alignItems: 'center' },
  vazioTitulo: { fontSize: 16, fontWeight: '800', color: cor.tinta, textAlign: 'center' },
  vazioTexto: { fontSize: 14, color: cor.graf500, textAlign: 'center', lineHeight: 20 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64,
    backgroundColor: cor.branco, borderRadius: raio.m, borderWidth: 1, borderColor: cor.graf200,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  inicial: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: cor.af600,
    alignItems: 'center', justifyContent: 'center',
  },
  inicialTexto: { color: cor.branco, fontSize: 17, fontWeight: '800' },
  nome: { flex: 1, fontSize: 16, fontWeight: '800', color: cor.tinta },
  quando: { fontSize: 12, color: cor.graf500 },
  ultima: { fontSize: 14, color: cor.graf500, marginTop: 2 },
  selo: {
    minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6,
    backgroundColor: cor.af600, alignItems: 'center', justifyContent: 'center',
  },
  seloTexto: { color: cor.branco, fontSize: 13, fontWeight: '800' },
})
