import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ondeEstou, type EstadoGps } from '../lib/gps'
import { carregarColegas, temMapaNativo, type Colega } from '../lib/colegas'
import { corSituacao, rotuloSituacao } from '../lib/dominio'
import { hhmm, isoLocal } from '../lib/formato'
import { Aviso, Botao, Carregando } from '../ui/componentes'
import { CabecalhoAba } from '../ui/CabecalhoAba'
import { BarraInferior } from '../ui/BarraInferior'
import { cor, raio, sombraCard } from '../ui/tema'
import type { LinhaAgenda } from './Agenda'
import type { Pilha } from '../navegacao'

/**
 * Geo-Rota (130) — "onde cada contrato caiu pra ele no mapa (...) e os
 * outros colegas, onde cada um está, caso ele queira pedir ajuda de alguém
 * próximo ou pedir algum equipamento" (Emanuel, 24/10).
 *
 * ┌─ minimalista de propósito ────────────────────────────────────────┐
 * │ Os contratos do dia são alfinetes na COR da situação — a mesma    │
 * │ rampa da agenda e da web (dominio.ts). Os colegas são uma bolha   │
 * │ escura com o NÚMERO DA EQUIPE, que é como o pessoal se chama no   │
 * │ rádio. Um toque abre o cartão embaixo com o único gesto que      │
 * │ importa: abrir o contrato, ou mandar mensagem ao colega.          │
 * │                                                                   │
 * │ Embaixo do mapa, os 3 colegas MAIS PERTO, em lista: no sol, ler   │
 * │ "Equipe 012 · 800 m" é mais rápido que achar uma bolha no mapa.   │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * O mapa é peça nativa: no APK 0.3.0 não existe, e a tela mostra só a
 * lista (ver `temMapaNativo`). A lista funciona em qualquer versão.
 */

type Props = NativeStackScreenProps<Pilha, 'Geo'>
type Selecao = { tipo: 'contrato'; l: LinhaAgenda } | { tipo: 'colega'; c: Colega } | null

const LEGENDA: { rotulo: string; cor: string }[] = [
  { rotulo: 'A fazer', cor: corSituacao('ENTRADA') },
  { rotulo: 'Em andamento', cor: corSituacao('EM_EXECUCAO') },
  { rotulo: 'Concluída', cor: corSituacao('CONCLUIDA') },
  { rotulo: 'Reagendada', cor: corSituacao('REAGENDAMENTO') },
  { rotulo: 'Cancelada', cor: corSituacao('CANCELADA') },
]

const distancia = (m: number | null) =>
  m == null ? null : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`

const haQuanto = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return min <= 1 ? 'agora' : `há ${min} min`
}

export default function GeoRota({ navigation }: Props) {
  const { tecnicoId } = useAuth()
  const [contratos, setContratos] = useState<LinhaAgenda[]>([])
  const [colegas, setColegas] = useState<Colega[]>([])
  const [gps, setGps] = useState<EstadoGps | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [sel, setSel] = useState<Selecao>(null)
  const comMapa = useMemo(temMapaNativo, [])
  const mapa = useRef<{ fitToCoordinates: (c: { latitude: number; longitude: number }[], o?: object) => void } | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    const g = await ondeEstou()
    setGps(g)
    const pos = g.ok ? g.posicao : null
    const [a, c] = await Promise.all([
      supabase.rpc('agenda_do_campo', { p_data: isoLocal() }),
      carregarColegas(pos?.lat, pos?.lng).catch(err => {
        setErro(err instanceof Error ? err.message : String(err)); return [] as Colega[]
      }),
    ])
    if (a.error) setErro(a.error.message)
    else setContratos((a.data ?? []) as LinhaAgenda[])
    setColegas(c)
  }, [])

  useEffect(() => {
    let vivo = true
    carregar().finally(() => { if (vivo) setCarregando(false) })
    // Os colegas andam: a cada 1 min a posição deles é refeita (o rastro
    // grava de 2 em 2 min — mais que isso não traria nada novo).
    const t = setInterval(() => { carregar() }, 60 * 1000)
    return () => { vivo = false; clearInterval(t) }
  }, [carregar])

  const noMapa = contratos.filter(l => l.lat != null && l.lng != null)
  const semCoordenada = contratos.length - noMapa.length
  const pertos = colegas.slice(0, 3)

  // Enquadra tudo (contratos, colegas e eu) quando os dados chegam.
  useEffect(() => {
    if (!comMapa || !mapa.current) return
    const pts = [
      ...noMapa.map(l => ({ latitude: Number(l.lat), longitude: Number(l.lng) })),
      ...colegas.map(c => ({ latitude: c.lat, longitude: c.lng })),
      ...(gps?.ok ? [{ latitude: gps.posicao.lat, longitude: gps.posicao.lng }] : []),
    ]
    if (pts.length > 0) {
      mapa.current.fitToCoordinates(pts, {
        edgePadding: { top: 60, right: 40, bottom: 40, left: 40 }, animated: false,
      })
    }
  }, [comMapa, noMapa.length, colegas.length, gps?.ok]) // eslint-disable-line react-hooks/exhaustive-deps

  async function puxar() {
    setAtualizando(true); await carregar(); setAtualizando(false)
  }

  function falarCom(c: Colega) {
    navigation.navigate('ConversaColega', { id: c.tecnico_id, nome: c.nome, equipe: c.equipe })
  }

  // O módulo do mapa só é CARREGADO onde a peça nativa existe.
  const Mapas = comMapa
    ? (require('react-native-maps') as typeof import('react-native-maps'))
    : null

  return (
    <SafeAreaView style={e.tela} edges={['top']}>
      <CabecalhoAba titulo="Geo-Rota" subtitulo="Seus contratos de hoje e os colegas por perto" />

      {carregando && <Carregando texto="Montando o mapa…" />}

      {!carregando && (
        <>
          {Mapas ? (
            <View style={e.mapaCaixa}>
              <Mapas.default
                ref={r => { mapa.current = r as unknown as typeof mapa.current }}
                style={StyleSheet.absoluteFill}
                provider={Mapas.PROVIDER_GOOGLE}
                showsUserLocation
                showsMyLocationButton
                toolbarEnabled={false}
                initialRegion={{
                  latitude: gps?.ok ? gps.posicao.lat : -3.1019,
                  longitude: gps?.ok ? gps.posicao.lng : -60.025,
                  latitudeDelta: 0.08, longitudeDelta: 0.08,
                }}
                onPress={() => setSel(null)}
              >
                {noMapa.map(l => (
                  <Mapas.Marker
                    key={l.visita_id}
                    coordinate={{ latitude: Number(l.lat), longitude: Number(l.lng) }}
                    pinColor={corSituacao(l.situacao)}
                    onPress={ev => { ev.stopPropagation(); setSel({ tipo: 'contrato', l }) }}
                  />
                ))}
                {colegas.map(c => (
                  <Mapas.Marker
                    key={c.tecnico_id}
                    coordinate={{ latitude: c.lat, longitude: c.lng }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    onPress={ev => { ev.stopPropagation(); setSel({ tipo: 'colega', c }) }}
                  >
                    <View style={e.bolha}>
                      <Text style={e.bolhaTexto}>{c.equipe ?? '•'}</Text>
                    </View>
                  </Mapas.Marker>
                ))}
              </Mapas.default>

              {/* A legenda flutua em cima do mapa, discreta. */}
              <ScrollView horizontal style={e.legenda} contentContainerStyle={{ gap: 6, paddingHorizontal: 8 }}
                showsHorizontalScrollIndicator={false}>
                {LEGENDA.map(x => (
                  <View key={x.rotulo} style={e.legendaItem}>
                    <View style={[e.ponto, { backgroundColor: x.cor }]} />
                    <Text style={e.legendaTexto}>{x.rotulo}</Text>
                  </View>
                ))}
                <View style={e.legendaItem}>
                  <View style={[e.ponto, { backgroundColor: cor.tinta }]} />
                  <Text style={e.legendaTexto}>Colega (nº da equipe)</Text>
                </View>
              </ScrollView>
            </View>
          ) : (
            <View style={{ padding: 12 }}>
              <Aviso tipo="atencao">
                O mapa precisa do aplicativo novo (versão 0.4). Peça o APK atualizado ao
                supervisor. Os colegas por perto continuam aqui embaixo.
              </Aviso>
            </View>
          )}

          <ScrollView style={e.painel} contentContainerStyle={e.painelConteudo}
            refreshControl={<RefreshControl refreshing={atualizando} onRefresh={puxar} tintColor={cor.af600} />}>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            {gps && !gps.ok && <Aviso tipo="atencao">{gps.recado} Sem a sua posição, a distância dos colegas não aparece.</Aviso>}

            {/* O que foi tocado no mapa. */}
            {sel?.tipo === 'contrato' && (
              <View style={e.cartao}>
                <View style={e.linhaEntre}>
                  <Text style={e.cartaoTitulo}>{sel.l.servico}</Text>
                  <Text style={[e.situacao, { color: corSituacao(sel.l.situacao) }]}>
                    {rotuloSituacao(sel.l.situacao)}
                  </Text>
                </View>
                <Text style={e.cartaoMiudo}>
                  {[sel.l.contrato && `contrato ${sel.l.contrato}`,
                    sel.l.janela_inicio && `${hhmm(sel.l.janela_inicio)}${sel.l.janela_fim ? `–${hhmm(sel.l.janela_fim)}` : ''}`]
                    .filter(Boolean).join(' · ')}
                </Text>
                {!!sel.l.logradouro && <Text style={e.cartaoMiudo}>{sel.l.logradouro}</Text>}
                <Botao titulo="Abrir o contrato" tom="contorno"
                  aoTocar={() => navigation.navigate('Visita', { id: sel.l.visita_id })} />
              </View>
            )}
            {sel?.tipo === 'colega' && (
              <View style={e.cartao}>
                <Text style={e.cartaoTitulo}>{sel.c.nome}</Text>
                <Text style={e.cartaoMiudo}>
                  {[sel.c.equipe && `Equipe ${sel.c.equipe}`, distancia(sel.c.distancia_m),
                    `visto ${haQuanto(sel.c.visto_em)}`].filter(Boolean).join(' · ')}
                </Text>
                <Botao titulo="Mandar mensagem" aoTocar={() => falarCom(sel.c)} />
              </View>
            )}

            <Text style={e.secao}>Colegas mais perto</Text>
            {colegas.length === 0 ? (
              <Text style={e.vazio}>
                Nenhum colega em rota por perto agora. Aparece quem está com contrato aberto
                hoje na sua cidade e deu ciência do aviso de localização.
              </Text>
            ) : pertos.map(c => (
              <View key={c.tecnico_id} style={e.colega}>
                <View style={e.bolhaLista}><Text style={e.bolhaTexto}>{c.equipe ?? '•'}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={e.colegaNome} numberOfLines={1}>{c.nome}</Text>
                  <Text style={e.cartaoMiudo}>
                    {[distancia(c.distancia_m), `visto ${haQuanto(c.visto_em)}`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Pressable onPress={() => falarCom(c)} hitSlop={8} style={e.msgBotao}
                  accessibilityRole="button" accessibilityLabel={`Mandar mensagem para ${c.nome}`}>
                  <Text style={e.msgTexto}>Mensagem</Text>
                </Pressable>
              </View>
            ))}
            {colegas.length > 3 && (
              <Text style={e.cartaoMiudo}>+ {colegas.length - 3} colega(s) no mapa</Text>
            )}
            {semCoordenada > 0 && (
              <Text style={e.cartaoMiudo}>
                {semCoordenada} contrato(s) de hoje sem coordenada do TOA — fora do mapa.
              </Text>
            )}
            {!tecnicoId && (
              <Aviso tipo="atencao">Este login não está ligado a um técnico.</Aviso>
            )}
          </ScrollView>
        </>
      )}
      <BarraInferior ativa="Geo" />
    </SafeAreaView>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.graf50 },
  mapaCaixa: { flex: 1.3, minHeight: 260 },
  legenda: { position: 'absolute', top: 8, left: 0, right: 0, flexGrow: 0 },
  legendaItem: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 999,
    paddingHorizontal: 9, paddingVertical: 5, ...sombraCard,
  },
  ponto: { width: 9, height: 9, borderRadius: 5 },
  legendaTexto: { fontSize: 11, fontWeight: '700', color: cor.graf600 },
  bolha: {
    minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 6,
    backgroundColor: cor.tinta, borderWidth: 2, borderColor: cor.branco,
    alignItems: 'center', justifyContent: 'center',
  },
  bolhaLista: {
    minWidth: 38, height: 38, borderRadius: 19, paddingHorizontal: 6,
    backgroundColor: cor.tinta, alignItems: 'center', justifyContent: 'center',
  },
  bolhaTexto: { color: cor.branco, fontSize: 11, fontWeight: '900' },
  painel: { flex: 1 },
  painelConteudo: { padding: 12, gap: 8, paddingBottom: 24 },
  cartao: {
    backgroundColor: cor.branco, borderRadius: raio.g, borderWidth: 1, borderColor: cor.graf200,
    padding: 12, gap: 6, ...sombraCard,
  },
  linhaEntre: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  cartaoTitulo: { fontSize: 16, fontWeight: '800', color: cor.tinta, flexShrink: 1 },
  situacao: { fontSize: 13, fontWeight: '800' },
  cartaoMiudo: { fontSize: 13, color: cor.graf500, lineHeight: 18 },
  secao: {
    fontSize: 12, fontWeight: '800', color: cor.graf600, marginTop: 4,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  vazio: { fontSize: 13, color: cor.graf500, lineHeight: 18 },
  colega: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: cor.branco, borderRadius: raio.m, borderWidth: 1, borderColor: cor.graf200,
    padding: 10,
  },
  colegaNome: { fontSize: 15, fontWeight: '700', color: cor.tinta },
  msgBotao: {
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: raio.s,
    borderWidth: 2, borderColor: cor.af600,
  },
  msgTexto: { fontSize: 13, fontWeight: '800', color: cor.af700 },
})
