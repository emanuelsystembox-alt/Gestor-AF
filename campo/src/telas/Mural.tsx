import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, FlatList, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text,
  useWindowDimensions, View,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { supabase } from '../lib/supabase'
import { Aviso, Carregando } from '../ui/componentes'
import { cor, raio, sombraCard } from '../ui/tema'
import type { Pilha } from '../navegacao'

/**
 * ┌─ Mural Nexus no aplicativo (163, D-245) ─────────────────────────────┐
 * │ > "vamos adicionar no app o canal de comunicação da AFLINE para que  │
 * │ >  o time possa visualizar os ganhadores, informativos, campanhas    │
 * │ >  entre outros. o mesmo do mural do site, só que no app."           │
 * │ >  — Emanuel, 31/10                                                  │
 * │                                                                      │
 * │ SÓ LEITURA. Quem publica é o ADMIN, pelo site; quem barra a escrita  │
 * │ é o banco (policies de `mural_post` e do bucket `mural`), não esta   │
 * │ tela — aqui simplesmente não existe formulário.                      │
 * │                                                                      │
 * │ O mesmo comportamento de `app/src/pages/Mural.tsx`: as imagens       │
 * │ passam sozinhas a cada 7 s, param enquanto a pessoa mexe (no celular │
 * │ é o dedo arrastando, no site é o mouse em cima) e embaixo ficam os   │
 * │ dizeres do item atual — título, data e texto.                        │
 * │                                                                      │
 * │ O bucket é PRIVADO, como o da evidência: a imagem sai por URL        │
 * │ assinada, o lote inteiro numa ida só (um 4G fraco não aguenta uma    │
 * │ requisição por imagem).                                              │
 * └──────────────────────────────────────────────────────────────────────┘
 */

export interface PostMural {
  id: string
  titulo: string
  texto: string | null
  imagem_path: string
  ordem: number
  criado_em: string
}

/** Quanto tempo cada imagem fica no slide — o mesmo do site. */
const INTERVALO_MS = 7000
/** Validade da URL assinada. Uma hora: quem fica mais que isso na tela
 *  puxa para atualizar, e a imagem já baixada continua no cache. */
const VALIDADE_S = 3600

const dois = (n: number) => String(n).padStart(2, '0')

/** "31/10/2026" no fuso do APARELHO — sem `toISOString()`, que é UTC
 *  e em Manaus vira o dia às 20h (D-084). Sem depender do Intl do
 *  Hermes, que muda de aparelho para aparelho. */
export function dataMural(ts: string): string {
  const d = new Date(ts)
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`
}

/**
 * A capa do mural para o cartão da Agenda: só o PRIMEIRO post no ar e uma
 * URL assinada. Leve de propósito — a agenda é a tela que abre o app, e
 * não pode esperar o mural inteiro para aparecer. Devolve nulo quando não
 * há nada no ar (o cartão some, não ocupa espaço).
 */
export async function capaDoMural(): Promise<{ titulo: string; url: string | null } | null> {
  const { data, error } = await supabase.from('mural_post')
    .select('titulo, imagem_path')
    .eq('ativo', true)
    .order('ordem').order('criado_em', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  const p = (data ?? [])[0] as { titulo: string; imagem_path: string } | undefined
  if (!p) return null
  // Sem a URL o cartão ainda vale: o título leva ao mural do mesmo jeito.
  const { data: assinada } = await supabase.storage.from('mural')
    .createSignedUrl(p.imagem_path, VALIDADE_S)
  return { titulo: p.titulo, url: assinada?.signedUrl ?? null }
}

type Props = NativeStackScreenProps<Pilha, 'Mural'>

export default function Mural({ navigation }: Props) {
  const [posts, setPosts] = useState<PostMural[] | null>(null)
  /** path → URL assinada. Nulo = ainda assinando. */
  const [urls, setUrls] = useState<Record<string, string> | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [erroImagens, setErroImagens] = useState<string | null>(null)
  const [atualizando, setAtualizando] = useState(false)

  const ler = useCallback(async () => {
    setErro(null); setErroImagens(null)
    const { data, error } = await supabase.from('mural_post')
      .select('id, titulo, texto, imagem_path, ordem, criado_em')
      .eq('ativo', true)
      .order('ordem').order('criado_em', { ascending: false })
    if (error) {
      // A mensagem real, não "algo deu errado": é ela que o suporte lê.
      setErro(error.message)
      setPosts(p => p ?? [])
      return
    }
    const lista = (data ?? []) as PostMural[]
    setPosts(lista)
    if (!lista.length) { setUrls({}); return }
    setUrls(null)
    const { data: assinadas, error: e2 } = await supabase.storage.from('mural')
      .createSignedUrls(lista.map(p => p.imagem_path), VALIDADE_S)
    if (e2) setErroImagens(e2.message)
    const m: Record<string, string> = {}
    for (const u of assinadas ?? []) if (u.path && u.signedUrl) m[u.path] = u.signedUrl
    setUrls(m)
  }, [])

  useEffect(() => { ler() }, [ler])

  async function puxar() {
    setAtualizando(true)
    await ler()
    setAtualizando(false)
  }

  return (
    <SafeAreaView style={e.tela} edges={['top']}>
      <View style={e.cabecalho}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={e.voltar}
          accessibilityRole="button" accessibilityLabel="Voltar">
          <Text style={e.voltarTexto}>‹</Text>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={e.titulo} accessibilityRole="header" numberOfLines={1}>Mural Nexus</Text>
          <Text style={e.sub} numberOfLines={1}>Campanhas, premiações e recados da AFLINE</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={e.conteudo}
        refreshControl={
          <RefreshControl refreshing={atualizando} onRefresh={puxar} tintColor={cor.af600} />
        }>
        {posts === null ? (
          <Carregando texto="Abrindo o mural…" />
        ) : (
          <>
            {!!erro && (
              <View style={e.margem}>
                <Aviso tipo="erro">Não consegui carregar o mural: {erro}</Aviso>
              </View>
            )}
            {!!erroImagens && (
              <View style={e.margem}>
                <Aviso tipo="atencao">
                  As imagens não carregaram: {erroImagens}. Puxe para atualizar.
                </Aviso>
              </View>
            )}
            {posts.length === 0 && !erro && (
              <View style={e.vazio}>
                <Text style={e.vazioTitulo}>Nada no mural ainda.</Text>
                <Text style={e.vazioTexto}>
                  Quando a AFLINE publicar uma campanha ou um recado, ele aparece aqui.
                </Text>
              </View>
            )}
            {posts.length > 0 && <Carrossel posts={posts} urls={urls} />}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// ------------------------------------------------------------------ slide

/**
 * Página horizontal, uma imagem por vez, na largura da tela em 16:9. A
 * imagem se AJUSTA dentro da caixa (`contain`): cartaz de campanha tem
 * texto na borda, e cortar o nome do ganhador seria o pior defeito
 * possível aqui. A caixa tem altura fixa, então trocar de imagem não
 * faz os dizeres de baixo pularem.
 *
 * A troca automática para enquanto o dedo arrasta e recomeça a contar do
 * zero quando ele solta — quem voltou uma imagem para ler não perde a
 * frase no meio.
 */
function Carrossel({ posts, urls }: { posts: PostMural[]; urls: Record<string, string> | null }) {
  const { width: W } = useWindowDimensions()
  const lista = useRef<FlatList<PostMural>>(null)
  const [i, setI] = useState(0)
  const [arrastando, setArrastando] = useState(false)
  const [falhas, setFalhas] = useState<Record<string, true>>({})
  const n = posts.length
  const atual = posts[Math.min(i, n - 1)]

  const ir = useCallback((k: number, animar = true) => {
    lista.current?.scrollToOffset({ offset: k * W, animated: animar })
    setI(k)
  }, [W])

  // Atualizou e a lista encolheu: volta para a primeira.
  useEffect(() => { if (i >= n) ir(0, false) }, [i, n, ir])

  useEffect(() => {
    if (arrastando || n < 2) return
    const t = setTimeout(() => ir((i + 1) % n), INTERVALO_MS)
    return () => clearTimeout(t)
  }, [i, arrastando, n, ir])

  function parou(ev: NativeSyntheticEvent<NativeScrollEvent>) {
    const k = Math.round(ev.nativeEvent.contentOffset.x / W)
    setI(Math.max(0, Math.min(n - 1, k)))
    setArrastando(false)
  }

  const altura = Math.round((W * 9) / 16)

  return (
    <View>
      <FlatList
        ref={lista}
        data={posts}
        keyExtractor={p => p.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, k) => ({ length: W, offset: W * k, index: k })}
        onScrollBeginDrag={() => setArrastando(true)}
        onScrollEndDrag={() => setArrastando(false)}
        onMomentumScrollEnd={parou}
        renderItem={({ item: p }) => {
          const url = urls?.[p.imagem_path]
          return (
            <View style={[e.slide, { width: W, height: altura }]}>
              {url && !falhas[p.id] ? (
                <Image source={{ uri: url }} style={{ width: W, height: altura }}
                  resizeMode="contain" accessibilityLabel={p.titulo}
                  onError={() => setFalhas(f => ({ ...f, [p.id]: true }))} />
              ) : urls === null ? (
                <ActivityIndicator color={cor.branco} />
              ) : (
                <Text style={e.semImagem}>
                  Não consegui abrir a imagem. Puxe para atualizar.
                </Text>
              )}
            </View>
          )
        }}
      />

      {n > 1 && (
        <View style={e.bolinhas}>
          {posts.map((p, k) => (
            <Pressable key={p.id} onPress={() => ir(k)} hitSlop={10} style={e.bolinhaToque}
              accessibilityRole="button"
              accessibilityLabel={`Ir para ${k + 1} de ${n}: ${p.titulo}`}
              accessibilityState={{ selected: k === i }}>
              <View style={[e.bolinha, k === i && e.bolinhaAtual]} />
            </Pressable>
          ))}
        </View>
      )}

      {/* Os dizeres do item atual, embaixo da imagem — como no site. */}
      {!!atual && (
        <View style={e.dizeres} accessibilityLiveRegion="polite">
          <Text style={e.dizeresTitulo}>{atual.titulo}</Text>
          <Text style={e.dizeresData}>
            {dataMural(atual.criado_em)}{n > 1 ? ` · ${i + 1} de ${n}` : ''}
          </Text>
          {!!atual.texto && <Text style={e.dizeresTexto}>{atual.texto}</Text>}
        </View>
      )}
    </View>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.graf50 },
  cabecalho: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 10,
    backgroundColor: cor.branco, borderBottomWidth: 1, borderBottomColor: cor.graf100,
  },
  voltar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  voltarTexto: { fontSize: 30, color: cor.graf500, lineHeight: 32 },
  titulo: { fontSize: 17, fontWeight: '800', color: cor.tinta },
  sub: { fontSize: 12, color: cor.graf500 },
  conteudo: { paddingBottom: 40, flexGrow: 1 },
  margem: { paddingHorizontal: 12, paddingTop: 12 },
  vazio: { padding: 28, gap: 6, alignItems: 'center' },
  vazioTitulo: { fontSize: 16, fontWeight: '800', color: cor.tinta, textAlign: 'center' },
  vazioTexto: { fontSize: 14, color: cor.graf500, textAlign: 'center', lineHeight: 20 },

  // O fundo da caixa é escuro como no site: a imagem `contain` deixa
  // faixa nas bordas, e faixa preta some; faixa cinza parece defeito.
  slide: { backgroundColor: cor.tinta, alignItems: 'center', justifyContent: 'center' },
  semImagem: { color: cor.graf200, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },

  bolinhas: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: 6, backgroundColor: cor.branco,
  },
  bolinhaToque: { minWidth: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  bolinha: { width: 8, height: 8, borderRadius: 4, backgroundColor: cor.graf200 },
  bolinhaAtual: { width: 22, backgroundColor: cor.af600 },

  dizeres: {
    margin: 12, padding: 16, gap: 4, backgroundColor: cor.branco,
    borderRadius: raio.g, borderWidth: 1, borderColor: cor.graf200, ...sombraCard,
  },
  dizeresTitulo: { fontSize: 18, fontWeight: '800', color: cor.tinta },
  dizeresData: { fontSize: 12, color: cor.graf500, fontVariant: ['tabular-nums'] },
  dizeresTexto: { fontSize: 15, lineHeight: 22, color: cor.graf600, marginTop: 6 },
})
