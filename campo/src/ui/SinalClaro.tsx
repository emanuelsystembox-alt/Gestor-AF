import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { supabase } from '../lib/supabase'
import { carimbo } from '../lib/formato'
import { cor, raio } from './tema'

/**
 * O sinal do contrato, lido do Portal Técnico da Claro (222, 223; D-330 a D-333).
 * Cópia DECLARADA de `app/src/components/SinalClaro.tsx` (D-112): a regra
 * do "fora / offline / ok" é a mesma — mudou lá, mude aqui.
 *
 * > "se eles tiverem alguma forma de olhar os niveis antes e depois na tela
 * >  deles sem atualizar o app seria bom também" — Emanuel, 06/11
 *
 * ANTES = Diagnóstico Inicial do portal; DEPOIS = Validação. O rótulo e a
 * cor de cada canal são da CLARO. Só mostra: não trava a baixa. Sem leitura
 * do portal para o contrato, a caixa não aparece — o portal só cobre as
 * equipes do login que a extensão lê, e uma caixa "não lido" em todo
 * contrato das outras seria ruído (e não é "pendente": regra 6).
 *
 * O técnico lê pelo RLS (`sinal_claro_leitura`: quem vê o contrato vê o
 * sinal) — medido: o técnico vê só os seus.
 */

type Estado = 'FORA' | 'OFFLINE' | 'ERRO' | 'OK'
interface Canal {
  frequency?: number | null; centerFrequency?: number | null
  txLevel?: number | null; rxLevel?: number | null; snrLevel?: number | null
  signalColor?: { color?: string } | null
}
interface Aparelho {
  etapa_tipo: number | null; tipo: string | null; status: string | null
  modelo: string | null; tecnologia: string | null; coletado_em: string | null
  upstreams: Canal[]; downstreams: Canal[]; ofdm: Canal[]; ofdma?: Canal[]
}
interface Sinal {
  inicial_texto: string | null; inicial_cor: string | null
  validacao_texto: string | null; validacao_cor: string | null
  status_os_texto: string | null; equipamentos: Aparelho[] | null; lido_em: string
}

type Tom = 'ok' | 'ruim' | 'pendente' | 'neutro'
const TOM: Record<Tom, { fundo: string; texto: string; borda: string }> = {
  ok: { fundo: cor.verde50, texto: cor.verde900, borda: '#86efac' },
  ruim: { fundo: cor.af50, texto: cor.af700, borda: '#fca5a5' },
  pendente: { fundo: cor.ambar50, texto: cor.ambar900, borda: '#fcd34d' },
  neutro: { fundo: cor.graf50, texto: cor.graf600, borda: cor.graf200 },
}
const tomDaCor = (c: string | null | undefined): Tom => {
  const x = (c ?? '').toLowerCase()
  return x === 'green' ? 'ok' : x === 'red' ? 'ruim' : x === 'yellow' ? 'pendente' : 'neutro'
}
const TOM_ESTADO: Record<Estado, Tom> = { FORA: 'ruim', OFFLINE: 'ruim', ERRO: 'pendente', OK: 'ok' }
const ROTULO: Record<Estado, string> = { FORA: 'fora', OFFLINE: 'offline', ERRO: 'erro na coleta', OK: 'ok' }

const vermelho = (c: Canal) => (c.signalColor?.color ?? '').toUpperCase() === 'RED'
const canais = (a: Aparelho) => [...a.upstreams, ...a.downstreams, ...a.ofdm, ...(a.ofdma ?? [])]
/** A mesma regra de `resumir_sinal` (223) e da web. */
function estadoDo(a: Aparelho): Estado {
  if (canais(a).some(vermelho)) return 'FORA'
  const st = (a.status ?? '').toLowerCase()
  return st === 'offline' ? 'OFFLINE' : st === 'error' ? 'ERRO' : 'OK'
}
function pior(l: Aparelho[]): Estado | null {
  if (!l.length) return null
  const e = l.map(estadoDo)
  return e.includes('FORA') ? 'FORA' : e.includes('OFFLINE') ? 'OFFLINE' : e.includes('ERRO') ? 'ERRO' : 'OK'
}
const nomeTipo = (t: string | null) => !t ? 'Aparelho' : t.length <= 3 ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1).toLowerCase()
const num = (n: number) => String(n).replace('.', ',')
function faixa(l: Canal[], campo: 'txLevel' | 'rxLevel' | 'snrLevel'): string | null {
  const v = l.map(c => c[campo]).filter((x): x is number => typeof x === 'number')
  if (!v.length) return null
  const a = Math.min(...v), b = Math.max(...v)
  return a === b ? num(a) : `${num(a)} a ${num(b)}`
}

export function SinalClaro({ visitaId }: { visitaId: string }) {
  const [s, setS] = useState<Sinal | null>(null)
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    let vivo = true
    supabase.from('sinal_claro')
      .select('inicial_texto, inicial_cor, validacao_texto, validacao_cor, status_os_texto, equipamentos, lido_em')
      .eq('visita_id', visitaId).maybeSingle()
      .then(({ data }) => { if (vivo) setS((data as Sinal | null) ?? null) })
    return () => { vivo = false }
  }, [visitaId])

  if (!s) return null
  const semValidacao = tomDaCor(s.validacao_cor) === 'pendente'
    && (s.status_os_texto ?? '').toLowerCase() === 'finalizada'
  const eq = s.equipamentos ?? []
  const tipos = [...new Set(eq.map(a => a.tipo ?? '?'))].sort()
  const da = (t: string, etapa: number) => eq.filter(a => (a.tipo ?? '?') === t && Number(a.etapa_tipo) === etapa)

  return (
    <View style={e.caixa}>
      <View style={e.topo}>
        <Text style={e.titulo}>Sinal (portal Claro)</Text>
        <Text style={e.lido}>lido {carimbo(s.lido_em)}</Text>
      </View>

      <Linha rotulo="Antes" texto={s.inicial_texto ?? '—'} tom={tomDaCor(s.inicial_cor)} />
      <Linha rotulo="Depois" texto={semValidacao ? 'Sem validação' : (s.validacao_texto ?? '—')}
        tom={semValidacao ? 'pendente' : tomDaCor(s.validacao_cor)} />

      {tipos.length > 0 && (<>
        {tipos.map(t => {
          const a = pior(da(t, 1)), d = pior(da(t, 2))
          return (
            <View key={t} style={e.tipo}>
              <Text style={e.tipoNome}>{nomeTipo(t)}</Text>
              <Estadinho e={a} />
              <Text style={e.seta}>→</Text>
              <Estadinho e={d} />
            </View>
          )
        })}
        <Pressable onPress={() => setAberto(x => !x)} hitSlop={8} accessibilityRole="button">
          <Text style={e.abrir}>{aberto ? 'Esconder os níveis' : 'Ver os níveis'}</Text>
        </Pressable>
        {aberto && tipos.map(t => (
          <View key={`n${t}`} style={{ gap: 6 }}>
            <Text style={e.secao}>{nomeTipo(t)}</Text>
            {[1, 2].map(etapa => {
              const l = da(t, etapa)
              return (
                <View key={etapa} style={{ gap: 4 }}>
                  <Text style={e.etapa}>{etapa === 1 ? 'Antes' : 'Depois'}</Text>
                  {l.length === 0
                    ? <Text style={e.miudo}>{etapa === 2 && semValidacao ? 'Não validado.' : 'Sem medição.'}</Text>
                    : l.map((x, k) => <Medida key={k} a={x} />)}
                </View>
              )
            })}
          </View>
        ))}
      </>)}
    </View>
  )
}

function Linha({ rotulo, texto, tom }: { rotulo: string; texto: string; tom: Tom }) {
  const t = TOM[tom]
  return (
    <View style={e.linha}>
      <Text style={e.rotulo}>{rotulo}</Text>
      <View style={[e.chip, { backgroundColor: t.fundo, borderColor: t.borda }]}>
        <Text style={[e.chipTexto, { color: t.texto }]}>{texto}</Text>
      </View>
    </View>
  )
}

function Estadinho({ e: est }: { e: Estado | null }) {
  if (!est) return <Text style={e.miudo}>—</Text>
  const t = TOM[TOM_ESTADO[est]]
  return (
    <View style={[e.chip, { backgroundColor: t.fundo, borderColor: t.borda }]}>
      <Text style={[e.chipTexto, { color: t.texto }]}>{ROTULO[est]}</Text>
    </View>
  )
}

function Medida({ a }: { a: Aparelho }) {
  const gpon = (a.tecnologia ?? '').toUpperCase() === 'GPON'
  const est = estadoDo(a)
  const ruins = canais(a).filter(vermelho).length
  const partes = gpon
    ? [faixa(a.downstreams, 'rxLevel') && `Rx óptico ${faixa(a.downstreams, 'rxLevel')}`,
       faixa(a.upstreams, 'txLevel') && `Tx ${faixa(a.upstreams, 'txLevel')}`]
    : [faixa(a.upstreams, 'txLevel') && `Up Tx ${faixa(a.upstreams, 'txLevel')}`,
       faixa(a.downstreams, 'rxLevel') && `Down Rx ${faixa(a.downstreams, 'rxLevel')}`,
       faixa(a.downstreams, 'snrLevel') && `SNR ${faixa(a.downstreams, 'snrLevel')}`]
  const niveis = partes.filter(Boolean).join(' · ')
  return (
    <View style={e.medida}>
      <View style={e.linha}>
        <Estadinho e={est} />
        <Text style={e.modelo} numberOfLines={1}>{a.modelo ?? '—'}</Text>
        {!!a.coletado_em && <Text style={e.lido}>{carimbo(a.coletado_em)}</Text>}
      </View>
      {!!niveis && <Text style={e.niveis}>{niveis}</Text>}
      {ruins > 0 && <Text style={e.fora}>{ruins} canal(is) fora</Text>}
    </View>
  )
}

const e = StyleSheet.create({
  caixa: {
    backgroundColor: cor.branco, borderWidth: 1, borderColor: cor.graf200,
    borderRadius: raio.g, padding: 14, gap: 8,
  },
  topo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  titulo: { fontSize: 15, fontWeight: '800', color: cor.tinta },
  lido: { fontSize: 12, color: cor.graf500 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rotulo: { width: 56, fontSize: 12, fontWeight: '800', color: cor.graf600, textTransform: 'uppercase' },
  chip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chipTexto: { fontSize: 13, fontWeight: '800' },
  tipo: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: cor.graf100 },
  tipoNome: { width: 72, fontSize: 14, fontWeight: '700', color: cor.tinta },
  seta: { fontSize: 13, color: cor.graf500 },
  abrir: { fontSize: 14, fontWeight: '700', color: cor.af700, paddingVertical: 6 },
  secao: { fontSize: 12, fontWeight: '800', color: cor.graf600, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 },
  etapa: { fontSize: 13, fontWeight: '700', color: cor.tinta },
  miudo: { fontSize: 13, color: cor.graf500 },
  medida: { borderWidth: 1, borderColor: cor.graf100, borderRadius: 8, padding: 8, gap: 4 },
  modelo: { flex: 1, fontSize: 13, fontWeight: '700', color: cor.tinta },
  niveis: { fontSize: 13, color: cor.graf600, fontVariant: ['tabular-nums'] },
  fora: { fontSize: 12, fontWeight: '800', color: cor.af700 },
})
