import { StyleSheet, Text, View } from 'react-native'
import { cor } from './tema'

/**
 * Os sinais do contrato que o controlador já vê na central (123, 124):
 * ouvidoria, segmento do cliente e TEC1. Cópia DECLARADA de
 * `app/src/components/MarcasCliente.tsx` e das etiquetas de TEC1 da
 * `TabelaContratos` — mudou lá, mude aqui (D-112).
 *
 * > "a sinalização de ouvidoria técnico tem que visualizar também, e na
 * >  tela principal de cada contrato podemos colocar se perdeu tec1 ou
 * >  não" — Emanuel, 21/10
 *
 * ┌─ por que assim ───────────────────────────────────────────────────┐
 * │ Ouvidoria é EXCEÇÃO (1 em 468 em 21/10): etiqueta preta sólida, a │
 * │ coisa mais escura do cartão, e só quando é. "Não" e "não sei"     │
 * │ (nulo) não desenham nada.                                         │
 * │                                                                   │
 * │ Segmento é contexto: etiqueta clara com bolinha, o nome como o    │
 * │ TOA mandou (PME, PURPLE PME PF…). BLACK é bolinha preta num       │
 * │ contorno, para não se confundir com a ouvidoria.                  │
 * │                                                                   │
 * │ TEC1 nulo = o TOA ainda não encerrou; a regra não se aplica e não │
 * │ se desenha nada — não é "no padrão" (regra 6).                    │
 * └───────────────────────────────────────────────────────────────────┘
 */

const COR_SEGMENTO: Record<string, string> = {
  PURPLE: '#7c3aed',
  'PURPLE PME PF': '#7c3aed',
  PURPLE_INTERNET: '#7c3aed',
  PME: '#0284c7',
  BLACK: '#111111',
  WHITE: '#f8fafc',
}

export function SeloOuvidoria({ ouvidoria }: { ouvidoria?: boolean | null }) {
  if (!ouvidoria) return null
  return (
    <View style={[e.selo, e.ouvidoria]} accessibilityLabel="Caso crítico de ouvidoria">
      <Text style={e.ouvidoriaTexto}>● OUVIDORIA</Text>
    </View>
  )
}

export function SeloSegmento({ segmento }: { segmento?: string | null }) {
  if (!segmento) return null
  const sem = segmento === 'SEM SEGMENTO'
  const bolinha = COR_SEGMENTO[segmento] ?? (segmento.includes('PURPLE') ? '#7c3aed' : null)
  return (
    <View style={[e.selo, e.segmento]} accessibilityLabel={`Segmento do cliente: ${segmento}`}>
      {!!bolinha && <View style={[e.bolinha, { backgroundColor: bolinha }]} />}
      <Text style={[e.segmentoTexto, sem && { color: cor.graf500 }]}>
        {sem ? 'sem segmento' : segmento}
      </Text>
    </View>
  )
}

const TEC1: Record<string, { texto: string; fundo: string; tinta: string }> = {
  PADRAO: { texto: 'TEC1 no padrão', fundo: cor.verde50, tinta: cor.verde900 },
  SEM_PADRAO: { texto: 'Perdeu TEC1', fundo: cor.af100, tinta: cor.af700 },
  EXPURGADA: { texto: 'TEC1 fora do cálculo', fundo: cor.graf50, tinta: cor.graf500 },
}

export function SeloTec1({ tec1 }: { tec1?: string | null }) {
  const t = tec1 ? TEC1[tec1] : undefined
  if (!t) return null
  return (
    <View style={[e.selo, { backgroundColor: t.fundo }]}>
      <Text style={[e.seloTexto, { color: t.tinta }]}>{t.texto}</Text>
    </View>
  )
}

const e = StyleSheet.create({
  selo: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
  },
  seloTexto: { fontSize: 12, fontWeight: '700' },
  ouvidoria: { backgroundColor: cor.tinta },
  ouvidoriaTexto: { fontSize: 12, fontWeight: '800', color: cor.branco, letterSpacing: 0.5 },
  segmento: { borderWidth: 1, borderColor: cor.graf200, backgroundColor: cor.branco },
  segmentoTexto: { fontSize: 12, fontWeight: '700', color: cor.graf600 },
  bolinha: {
    width: 8, height: 8, borderRadius: 4,
    borderWidth: 1, borderColor: 'rgba(124,134,154,0.7)',
  },
})
