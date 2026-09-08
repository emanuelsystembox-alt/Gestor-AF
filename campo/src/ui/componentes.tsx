import type { ReactNode } from 'react'
import {
  ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle,
} from 'react-native'
import { corSituacao, rotuloSituacao } from '../lib/dominio'
import { cor, raio, sombraCard, TOQUE, TOQUE_GRANDE } from './tema'

export function Cartao({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[e.cartao, style]}>{children}</View>
}

export function Etiqueta({ situacao }: { situacao: string }) {
  const c = corSituacao(situacao)
  return (
    <View style={[e.etiqueta, { backgroundColor: c + '1a', borderColor: c + '55' }]}>
      <View style={[e.bolinha, { backgroundColor: c }]} />
      <Text style={[e.etiquetaTexto, { color: c }]}>{rotuloSituacao(situacao)}</Text>
    </View>
  )
}

type Tom = 'principal' | 'sucesso' | 'contorno' | 'discreto' | 'perigo'

export function Botao({
  titulo, aoTocar, tom = 'principal', grande = false,
  desativado = false, carregando = false, style,
}: {
  titulo: string
  aoTocar: () => void
  tom?: Tom
  grande?: boolean
  desativado?: boolean
  carregando?: boolean
  style?: ViewStyle
}) {
  const inerte = desativado || carregando
  const fundo: Record<Tom, string> = {
    principal: cor.af600,
    sucesso: cor.verde,
    contorno: 'transparent',
    discreto: cor.graf50,
    perigo: cor.ambar,
  }
  const texto: Record<Tom, string> = {
    principal: cor.branco,
    sucesso: cor.branco,
    contorno: cor.tinta,
    discreto: cor.graf500,
    perigo: cor.branco,
  }
  return (
    <Pressable
      onPress={aoTocar}
      disabled={inerte}
      style={({ pressed }) => [
        e.botao,
        {
          minHeight: grande ? TOQUE_GRANDE : TOQUE,
          backgroundColor: fundo[tom],
          borderWidth: tom === 'contorno' ? 2 : 0,
          borderColor: cor.graf200,
          opacity: inerte ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {carregando && <ActivityIndicator color={texto[tom]} style={{ marginRight: 8 }} />}
      <Text style={[e.botaoTexto, { color: texto[tom] }]} numberOfLines={1}>
        {titulo}
      </Text>
    </Pressable>
  )
}

export function Aviso({
  tipo = 'erro', children,
}: { tipo?: 'erro' | 'atencao' | 'ok'; children: ReactNode }) {
  const paleta = {
    erro: { fundo: cor.af50, borda: cor.af500, texto: cor.af700 },
    atencao: { fundo: cor.ambar50, borda: cor.ambar, texto: '#92400e' },
    ok: { fundo: cor.verde50, borda: cor.verde, texto: cor.verde900 },
  }[tipo]
  return (
    <View style={[e.aviso, { backgroundColor: paleta.fundo, borderLeftColor: paleta.borda }]}>
      <Text style={[e.avisoTexto, { color: paleta.texto }]}>{children}</Text>
    </View>
  )
}

export function Vazio({ titulo, descricao }: { titulo: string; descricao?: string }) {
  return (
    <View style={e.vazio}>
      <Text style={e.vazioTitulo}>{titulo}</Text>
      {descricao && <Text style={e.vazioDesc}>{descricao}</Text>}
    </View>
  )
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <View style={e.vazio}>
      <ActivityIndicator color={cor.af600} size="large" />
      <Text style={[e.vazioDesc, { marginTop: 12 }]}>{texto}</Text>
    </View>
  )
}

const e = StyleSheet.create({
  cartao: {
    backgroundColor: cor.branco,
    borderWidth: 1,
    borderColor: cor.graf200,
    borderRadius: raio.g,
    ...sombraCard,
  },
  etiqueta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  bolinha: { width: 7, height: 7, borderRadius: 999 },
  etiquetaTexto: { fontSize: 12, fontWeight: '700' },
  botao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: raio.m,
    paddingHorizontal: 18,
  },
  botaoTexto: { fontSize: 16, fontWeight: '700' },
  aviso: {
    borderLeftWidth: 4,
    borderRadius: raio.s,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  avisoTexto: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  vazio: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  vazioTitulo: { fontSize: 16, fontWeight: '700', color: cor.graf600 },
  vazioDesc: {
    marginTop: 6, fontSize: 14, color: cor.graf400, textAlign: 'center', lineHeight: 20,
  },
})
