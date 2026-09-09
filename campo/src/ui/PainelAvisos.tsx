import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { PESO_AVISO, type Aviso } from '../lib/avisos'
import { rotuloSituacao } from '../lib/dominio'
import { carimbo } from '../lib/formato'
import { cor, raio, sombraCard } from '../ui/tema'

/**
 * Os avisos no alto da agenda.
 *
 * Não é caixa de mensagem: é o que mudou no trabalho dele enquanto ele
 * estava na rua. Por isso fica **acima** da lista e some quando lido —
 * uma lista de notificações que cresce para sempre vira ruído que
 * ninguém abre.
 *
 * `CANCELADO_OPERADORA` é o único vermelho, e o motivo é literal: o
 * técnico pode estar a caminho do endereço neste momento.
 */

const PALETA = {
  urgente: { fundo: '#fef2f3', borda: cor.af500, titulo: cor.af700 },
  atencao: { fundo: cor.ambar50, borda: cor.ambar, titulo: '#92400e' },
  informa: { fundo: cor.graf50, borda: cor.graf300, titulo: cor.graf600 },
} as const

export function PainelAvisos({
  avisos, aoAbrir, aoDispensar, aoDispensarTodos,
}: {
  avisos: Aviso[]
  aoAbrir: (a: Aviso) => void
  aoDispensar: (a: Aviso) => void
  aoDispensarTodos: () => void
}) {
  if (avisos.length === 0) return null

  return (
    <View style={{ gap: 8 }}>
      <View style={e.cabecalho}>
        <Text style={e.titulo}>
          {avisos.length === 1 ? '1 aviso' : `${avisos.length} avisos`}
        </Text>
        {avisos.length > 1 && (
          <Pressable onPress={aoDispensarTodos} hitSlop={8}>
            <Text style={e.limpar}>marcar todos como lidos</Text>
          </Pressable>
        )}
      </View>

      {/* Rola dentro de si a partir de três: quatro avisos empurrando a
          agenda para fora da tela é pior que os avisos. */}
      <ScrollView style={avisos.length > 3 ? { maxHeight: 300 } : undefined}
                  nestedScrollEnabled>
        <View style={{ gap: 8 }}>
          {avisos.map(a => {
            const p = PALETA[PESO_AVISO[a.tipo] ?? 'informa']
            return (
              <Pressable
                key={a.id}
                onPress={() => aoAbrir(a)}
                style={({ pressed }) => [
                  e.card,
                  { backgroundColor: p.fundo, borderLeftColor: p.borda },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View style={e.linhaTopo}>
                  <Text style={[e.cardTitulo, { color: p.titulo }]} numberOfLines={2}>
                    {a.titulo}
                  </Text>
                  <Pressable onPress={() => aoDispensar(a)} hitSlop={12}>
                    <Text style={e.fechar}>✕</Text>
                  </Pressable>
                </View>

                {a.situacao_de && a.situacao_para && (
                  <Text style={e.transicao}>
                    {rotuloSituacao(a.situacao_de)} → {rotuloSituacao(a.situacao_para)}
                  </Text>
                )}

                {/* A observação do controlador. É a "mensagem" que o
                    Emanuel pediu — ela viaja colada à mudança, não num
                    canal separado. */}
                {a.detalhe && <Text style={e.detalhe}>“{a.detalhe}”</Text>}

                <Text style={e.rodape}>
                  {[a.contrato && `contrato ${a.contrato}`, a.servico]
                    .filter(Boolean).join(' · ')}
                </Text>
                <Text style={e.assinatura}>
                  {carimbo(a.criado_em)}
                  {a.autor_login ? ` · ${a.autor_login}` : ''}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </ScrollView>
    </View>
  )
}

const e = StyleSheet.create({
  cabecalho: {
    flexDirection: 'row', alignItems: 'baseline',
    justifyContent: 'space-between', paddingHorizontal: 2,
  },
  titulo: { fontSize: 14, fontWeight: '800', color: cor.tinta },
  limpar: { fontSize: 12, fontWeight: '600', color: cor.graf400 },

  card: {
    borderRadius: raio.m, borderLeftWidth: 4,
    paddingVertical: 10, paddingHorizontal: 12, gap: 2, ...sombraCard,
  },
  linhaTopo: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', gap: 8,
  },
  cardTitulo: { flex: 1, fontSize: 15, fontWeight: '800', lineHeight: 20 },
  fechar: { fontSize: 15, color: cor.graf400, paddingHorizontal: 2 },
  transicao: { fontSize: 13, fontWeight: '600', color: cor.graf600 },
  detalhe: {
    fontSize: 14, color: cor.tinta, lineHeight: 19,
    fontStyle: 'italic', marginTop: 2,
  },
  rodape: { fontSize: 12, color: cor.graf500, marginTop: 4 },
  assinatura: { fontSize: 11, color: cor.graf400 },
})
