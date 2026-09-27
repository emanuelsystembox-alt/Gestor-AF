import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StackActions, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useAuth } from '../lib/auth'
import { useNaoLidas } from '../lib/mensagens'
import { cor, TOQUE_GRANDE } from './tema'
import type { Aba, Pilha } from '../navegacao'

/**
 * A barra de baixo — as cinco portas do dia (091).
 *
 * Texto, sem ícone: sem biblioteca (regra do `campo/`), um ícone
 * desenhado à mão em View seria adivinhação, e "Abastecer" escrito não
 * precisa de legenda. O alvo inteiro da aba é tocável (60 px de altura),
 * e a aba ativa se lê por três sinais ao mesmo tempo — a faixa vermelha,
 * o peso da letra e a cor — para não depender só de cor (WCAG 1.4.1).
 *
 * O selo da Conversa só aparece quando SABE quantas mensagens faltam
 * ler: `null` (carregando, sem sinal) não vira "0".
 */
const ABAS: { nome: Aba; rotulo: string }[] = [
  { nome: 'Agenda', rotulo: 'Agenda' },
  { nome: 'Painel', rotulo: 'Painel' },
  { nome: 'Conversa', rotulo: 'Conversa' },
  { nome: 'Material', rotulo: 'Material' },
  { nome: 'Abastecer', rotulo: 'Abastecer' },
]

export function BarraInferior({ ativa }: { ativa: Aba }) {
  const nav = useNavigation<NativeStackNavigationProp<Pilha>>()
  const { bottom } = useSafeAreaInsets()
  const { tecnicoId } = useAuth()
  const naoLidas = useNaoLidas(tecnicoId)

  return (
    <View style={[e.barra, { paddingBottom: Math.max(bottom, 6) }]} accessibilityRole="tablist">
      {ABAS.map(a => {
        const eh = a.nome === ativa
        const selo = a.nome === 'Conversa' && naoLidas != null && naoLidas > 0 ? naoLidas : null
        return (
          <Pressable
            key={a.nome}
            onPress={() => { if (!eh) nav.dispatch(StackActions.replace(a.nome)) }}
            accessibilityRole="tab"
            accessibilityState={{ selected: eh }}
            accessibilityLabel={selo ? `${a.rotulo}, ${selo} não lida(s)` : a.rotulo}
            style={({ pressed }) => [e.aba, pressed && !eh && { backgroundColor: cor.graf50 }]}
          >
            <View style={[e.faixa, eh && { backgroundColor: cor.af600 }]} />
            <View style={e.rotuloLinha}>
              <Text style={[e.rotulo, eh && e.rotuloAtivo]} numberOfLines={1}>{a.rotulo}</Text>
              {selo != null && (
                <View style={e.selo}>
                  <Text style={e.seloTexto}>{selo > 99 ? '99+' : selo}</Text>
                </View>
              )}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

const e = StyleSheet.create({
  barra: {
    flexDirection: 'row', backgroundColor: cor.branco,
    borderTopWidth: 1, borderTopColor: cor.graf200,
  },
  aba: { flex: 1, minHeight: TOQUE_GRANDE, alignItems: 'center' },
  faixa: { alignSelf: 'stretch', height: 3, marginHorizontal: 10, borderRadius: 2 },
  rotuloLinha: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 2 },
  rotulo: { fontSize: 13, fontWeight: '600', color: cor.graf500 },
  rotuloAtivo: { color: cor.tinta, fontWeight: '800' },
  selo: {
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5,
    backgroundColor: cor.af600, alignItems: 'center', justifyContent: 'center',
  },
  seloTexto: { color: cor.branco, fontSize: 11, fontWeight: '800' },
})
