import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  abrirOpcoesDoDesenvolvedor, ligarLocalizacao, pedirPermissaoDeNovo, reportar,
  verificarAparelho, verificarGps, type EstadoGuarda,
} from '../lib/antifraude'
import { Botao } from './componentes'
import { cor, raio } from './tema'

/** De quanto em quanto o app confere o GPS com a tela aberta. */
const CONFERIR_MS = 20 * 1000

/**
 * A guarda do GPS (097). Com a localização desligada, negada ou
 * simulada, o app fica PAUSADO por esta janela até corrigir — e diz o
 * que fazer, com o botão que leva direto ao lugar certo.
 *
 * O tom é o de um aviso, não o de uma acusação (Emanuel: "intuitivos sem
 * ser agressivo"): diz o que aconteceu, por que pausa e como resolver.
 * Uma `Modal` e não uma camada comum: modal aberta depois fica por cima
 * de qualquer outra (a da baixa, por exemplo).
 */
export function GuardaGps({ ativo, children }: { ativo: boolean; children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoGuarda>('VERIFICANDO')
  const [podePedir, setPodePedir] = useState(true)
  const [conferindo, setConferindo] = useState(false)
  const ocupado = useRef(false)

  const conferir = useCallback(async (pedir: boolean) => {
    if (ocupado.current) return
    ocupado.current = true
    setConferindo(true)
    try {
      const l = await verificarGps(pedir)
      setEstado(l.estado)
      setPodePedir(l.podePedir)
      reportar(l)
    } finally {
      ocupado.current = false
      setConferindo(false)
    }
  }, [])

  useEffect(() => {
    if (!ativo) return
    conferir(true)
    verificarAparelho()
    const t = setInterval(() => {
      if (AppState.currentState === 'active') conferir(false)
    }, CONFERIR_MS)
    // Voltou para o app (depois de ir aos ajustes, por exemplo): confere já.
    const sub = AppState.addEventListener('change', s => { if (s === 'active') conferir(false) })
    return () => { clearInterval(t); sub.remove() }
  }, [ativo, conferir])

  const pausado = ativo && (estado === 'DESLIGADO' || estado === 'SEM_PERMISSAO' || estado === 'SIMULADO')

  return (
    <>
      {children}
      <Modal visible={pausado} animationType="fade" transparent onRequestClose={() => {}}>
        <View style={e.fundo}>
          <ScrollView contentContainerStyle={e.centro}>
            <View style={e.caixa} accessibilityRole="alert">
              {estado === 'DESLIGADO' && (
                <>
                  <Text style={e.icone}>📍</Text>
                  <Text style={e.titulo}>Ligue a localização para continuar</Text>
                  <Text style={e.texto}>
                    O Gestor AF registra onde cada atendimento acontece. Com a
                    localização do celular desligada, as ações do aplicativo ficam
                    pausadas até ela voltar.
                  </Text>
                  <Botao titulo="Ligar localização" grande aoTocar={ligarLocalizacao} />
                  <Botao titulo="Já liguei" tom="contorno" carregando={conferindo}
                    aoTocar={() => conferir(false)} />
                </>
              )}

              {estado === 'SEM_PERMISSAO' && (
                <>
                  <Text style={e.icone}>📍</Text>
                  <Text style={e.titulo}>Permita o acesso à localização</Text>
                  <Text style={e.texto}>
                    O aplicativo precisa da localização para registrar os
                    atendimentos. Toque em "Permitir" e escolha
                    {' '}<Text style={e.forte}>Permitir durante o uso do app</Text>
                    {' '}ou <Text style={e.forte}>Permitir o tempo todo</Text>.
                  </Text>
                  <Botao titulo="Permitir" grande aoTocar={async () => {
                    await pedirPermissaoDeNovo(podePedir)
                    conferir(false)
                  }} />
                  <Botao titulo="Já permiti" tom="contorno" carregando={conferindo}
                    aoTocar={() => conferir(false)} />
                </>
              )}

              {estado === 'SIMULADO' && (
                <>
                  <Text style={e.icone}>🛰️</Text>
                  <Text style={e.titulo}>Localização com comportamento anormal</Text>
                  <Text style={e.texto}>
                    O celular está informando uma posição que não vem do GPS —
                    normalmente um aplicativo de localização simulada ligado nas
                    Opções do desenvolvedor. Enquanto isso continuar, as ações do
                    aplicativo ficam pausadas e o controle é avisado.
                  </Text>
                  <View style={e.passos}>
                    <Text style={e.passosTitulo}>Como resolver</Text>
                    <Text style={e.passo}>1. Abra as Opções do desenvolvedor.</Text>
                    <Text style={e.passo}>2. Em "Selecionar app de local fictício", escolha Nenhum.</Text>
                    <Text style={e.passo}>3. Volte aqui e toque em Verificar de novo.</Text>
                  </View>
                  <Botao titulo="Abrir opções do desenvolvedor" grande aoTocar={abrirOpcoesDoDesenvolvedor} />
                  <Botao titulo="Verificar de novo" tom="contorno" carregando={conferindo}
                    aoTocar={() => conferir(false)} />
                </>
              )}

              <Text style={e.rodape}>Precisa de ajuda? Fale com o seu controlador.</Text>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </>
  )
}

const e = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(15,17,21,0.72)' },
  centro: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  caixa: { backgroundColor: cor.branco, borderRadius: 20, padding: 20, gap: 10 },
  icone: { fontSize: 36, textAlign: 'center' },
  titulo: { fontSize: 20, fontWeight: '800', color: cor.tinta, textAlign: 'center', lineHeight: 26 },
  texto: { fontSize: 15, color: cor.graf600, lineHeight: 22, marginBottom: 4 },
  forte: { fontWeight: '700', color: cor.tinta },
  passos: { backgroundColor: cor.graf50, borderRadius: raio.m, padding: 12, gap: 4, marginBottom: 4 },
  passosTitulo: { fontSize: 13, fontWeight: '800', color: cor.graf600, marginBottom: 2 },
  passo: { fontSize: 14, color: cor.graf600, lineHeight: 20 },
  rodape: { fontSize: 12, color: cor.graf500, textAlign: 'center', marginTop: 6 },
})
