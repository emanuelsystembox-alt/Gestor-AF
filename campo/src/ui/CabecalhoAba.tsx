import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Marca } from './componentes'
import { cor } from './tema'

/** O topo das abas novas (091): a marca, o nome da tela e, à direita,
 *  o que a tela quiser pôr (um filtro, um botão). */
export function CabecalhoAba({ titulo, subtitulo, direita }: {
  titulo: string; subtitulo?: string; direita?: ReactNode
}) {
  return (
    <View style={e.cabecalho}>
      <Marca tamanho={34} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={e.titulo} accessibilityRole="header" numberOfLines={1}>{titulo}</Text>
        {subtitulo ? <Text style={e.subtitulo} numberOfLines={1}>{subtitulo}</Text> : null}
      </View>
      {direita}
    </View>
  )
}

const e = StyleSheet.create({
  cabecalho: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: cor.branco, borderBottomWidth: 1, borderBottomColor: cor.graf100,
  },
  titulo: { fontSize: 17, fontWeight: '800', color: cor.tinta },
  subtitulo: { fontSize: 12, color: cor.graf500 },
})
