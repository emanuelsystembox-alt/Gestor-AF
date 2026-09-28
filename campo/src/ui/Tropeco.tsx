import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { aoErroFatal, registrarErro, VERSAO_APP } from '../lib/diagnostico'
import { Botao } from './componentes'
import { cor, raio } from './tema'

/**
 * A rede embaixo das telas (098, D-172).
 *
 * No APK, um erro numa tela FECHA o aplicativo — foi o que o Emanuel viu
 * ao abrir um contrato. Aqui o erro vira uma tela que diz o que houve,
 * com a mensagem de verdade (para o print chegar a quem conserta), manda
 * o erro ao banco e oferece voltar para a agenda. O técnico perde a tela,
 * não o dia.
 *
 * Pega os dois caminhos: erro ao DESENHAR (limite de erro do React) e
 * erro fatal FORA do desenho (toque, relógio — pela rede de
 * `diagnostico.ts`).
 */
export function Tropeco({ children }: { children: ReactNode }) {
  const [fatal, setFatal] = useState<Error | null>(null)
  const [geracao, setGeracao] = useState(0)

  useEffect(() => {
    aoErroFatal(e => setFatal(e))
    return () => aoErroFatal(null)
  }, [])

  const recomecar = () => { setFatal(null); setGeracao(g => g + 1) }

  if (fatal) return <TelaDoTropeco erro={fatal} aoRecomecar={recomecar} />
  // A chave nova remonta a navegação inteira: volta para a Agenda limpa.
  return <Limite key={geracao} aoRecomecar={recomecar}>{children}</Limite>
}

class Limite extends Component<
  { children: ReactNode; aoRecomecar: () => void },
  { erro: Error | null }
> {
  state = { erro: null as Error | null }

  static getDerivedStateFromError(erro: Error) { return { erro } }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    registrarErro('TELA', erro, { componente: info.componentStack?.slice(0, 2000) ?? null })
  }

  render() {
    if (this.state.erro) {
      return <TelaDoTropeco erro={this.state.erro} aoRecomecar={this.props.aoRecomecar} />
    }
    return this.props.children
  }
}

function TelaDoTropeco({ erro, aoRecomecar }: { erro: Error; aoRecomecar: () => void }) {
  return (
    <View style={e.fundo}>
      <ScrollView contentContainerStyle={e.centro}>
        <View style={e.caixa} accessibilityRole="alert">
          <Text style={e.titulo}>Esta tela tropeçou</Text>
          <Text style={e.texto}>
            O aplicativo não fechou, e o que você já registrou está salvo.
            O erro foi enviado para a equipe do sistema. Volte para a agenda
            e tente de novo.
          </Text>
          {/* A mensagem real, como veio: é ela que diz onde consertar. */}
          <View style={e.detalhe}>
            <Text style={e.detalheTexto} selectable>{erro.message}</Text>
            <Text style={e.versao}>versão {VERSAO_APP}</Text>
          </View>
          <Botao titulo="Voltar para a agenda" grande aoTocar={aoRecomecar} />
        </View>
      </ScrollView>
    </View>
  )
}

const e = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: cor.graf50 },
  centro: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  caixa: { backgroundColor: cor.branco, borderRadius: raio.g, padding: 22, gap: 14 },
  titulo: { fontSize: 20, fontWeight: '800', color: cor.tinta },
  texto: { fontSize: 15, lineHeight: 21, color: cor.graf600 },
  detalhe: { backgroundColor: cor.graf50, borderRadius: raio.m, padding: 12, gap: 4 },
  detalheTexto: { fontSize: 13, color: cor.tinta, fontFamily: 'monospace' },
  versao: { fontSize: 11, color: cor.graf500 },
})
