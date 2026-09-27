import { useCallback, useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { isoLocal, num2, reais } from '../lib/formato'
import { Aviso, Carregando, Cartao, TituloSecao, Vazio } from '../ui/componentes'
import { CabecalhoAba } from '../ui/CabecalhoAba'
import { BarraInferior } from '../ui/BarraInferior'
import { cor, raio } from '../ui/tema'

/**
 * O painel do técnico (091) — "quantos pontos eu fiz, quanto falta, onde
 * eu estou".
 *
 * ┌─ o que cada número é, e de onde vem ─────────────────────────────┐
 * │ Tudo sai de `painel_do_tecnico` e `ranking_tecnicos`, que usam a  │
 * │ MESMA conta (`producao_por_tecnico`) da central do controlador: o │
 * │ técnico e o COP leem o mesmo número para o mesmo dia.             │
 * │                                                                   │
 * │ · pontos: só contrato CONCLUÍDO, jornada fora (é a regra da       │
 * │   produção do mês que já existia);                                │
 * │ · quebrado: visita com O.S. de baixa IMPRODUTIVA (Emanuel, 27/09);│
 * │ · pontos perdidos: o que a quebrada valeria, se não concluiu —    │
 * │   quebrada SEM regra de pontuação é contada à parte, nunca como   │
 * │   zero perdido (D-117);                                           │
 * │ · meta: da skill. Sem meta cadastrada, a tela DIZ isso — antes    │
 * │   ela escrevia "de 0,00 pts / faltam 0,00", que é mentira.        │
 * └───────────────────────────────────────────────────────────────────┘
 */

interface Painel {
  tecnico: string; skill: string | null
  pontos: number; visitas: number; concluidas: number; dias: number
  quebradas: number; pontos_perdidos: number; perdidos_sem_regra: number
  tec1_perdidos: number
  meta: number | null; meta_dia: number | null
  fator: number | null; valor: number | null; proxima_faixa: number | null
  posicao: number | null; total: number | null; pontos_do_de_cima: number | null
  hoje: { pontos: number; concluidas: number; quebradas: number; a_fazer: number }
  por_dia: { dia: string; pontos: number }[]
}

interface LinhaRanking {
  posicao: number; tecnico_id: string; nome: string; equipe: string | null
  pontos: number; concluidas: number; eu: boolean
}

type Periodo = 'atual' | 'anterior'

function intervalo(p: Periodo) {
  const h = new Date()
  const m = p === 'atual' ? h.getMonth() : h.getMonth() - 1
  const de = new Date(h.getFullYear(), m, 1)
  const ate = new Date(h.getFullYear(), m + 1, 0)
  const nome = de.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return { de: isoLocal(de), ate: isoLocal(ate), nome }
}

const n = (x: unknown) => Number(x ?? 0)

export default function Painel() {
  const [periodo, setPeriodo] = useState<Periodo>('atual')
  const [painel, setPainel] = useState<Painel | null>(null)
  const [ranking, setRanking] = useState<LinhaRanking[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [rankingAberto, setRankingAberto] = useState(false)

  const carregar = useCallback(async (p: Periodo) => {
    const { de, ate } = intervalo(p)
    setErro(null)
    const [a, b] = await Promise.all([
      supabase.rpc('painel_do_tecnico', { p_de: de, p_ate: ate }),
      supabase.rpc('ranking_tecnicos', { p_de: de, p_ate: ate }),
    ])
    if (a.error) { setErro(a.error.message); return }
    setPainel(a.data as Painel)
    setRanking(((b.data ?? []) as LinhaRanking[]))
  }, [])

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    carregar(periodo).finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [periodo, carregar])

  async function puxar() {
    setAtualizando(true); await carregar(periodo); setAtualizando(false)
  }

  const { nome: nomeMes } = intervalo(periodo)
  const p = painel
  const pontos = n(p?.pontos)
  const meta = p?.meta == null ? null : n(p.meta)
  const pct = meta && meta > 0 ? Math.min(100, (pontos / meta) * 100) : 0
  const maxDia = Math.max(1, ...(p?.por_dia ?? []).map(d => n(d.pontos)))
  const eu = ranking.find(r => r.eu)
  // Aberto, o ranking mostra todo mundo; fechado, os 5 de cima e a linha
  // dele — quem está em 40º não precisa rolar 39 nomes para se achar.
  const visiveis = rankingAberto ? ranking
    : ranking.filter((r, i) => i < 5 || r.eu)

  return (
    <SafeAreaView style={e.tela} edges={['top']}>
      <CabecalhoAba titulo="Meu painel" subtitulo={p ? `${p.tecnico}${p.skill ? ` · ${p.skill}` : ''}` : undefined} />

      <View style={e.periodos}>
        {(['atual', 'anterior'] as Periodo[]).map(x => (
          <Pressable key={x} onPress={() => setPeriodo(x)}
            accessibilityRole="button" accessibilityState={{ selected: periodo === x }}
            style={[e.periodo, periodo === x && e.periodoAtivo]}>
            <Text style={[e.periodoTexto, periodo === x && e.periodoTextoAtivo]}>
              {x === 'atual' ? 'Este mês' : 'Mês passado'}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={e.conteudo}
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={puxar} tintColor={cor.af600} />}
      >
        {erro && <Aviso tipo="erro">Não consegui carregar o painel: {erro}</Aviso>}
        {carregando && !p && <Carregando texto="Somando seus pontos…" />}

        {p && (<>
          {/* ---------- o número do mês ---------- */}
          <Cartao style={e.heroi}>
            <Text style={e.rotuloHeroi}>Pontos em {nomeMes}</Text>
            <View style={e.linhaNumero}>
              <Text style={e.numero} accessibilityLabel={`${num2(pontos)} pontos`}>{num2(pontos)}</Text>
              {meta != null && <Text style={e.deMeta}>de {num2(meta)}</Text>}
            </View>

            {meta != null ? (<>
              <View style={e.trilho} accessibilityRole="progressbar"
                    accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}>
                <View style={[e.progresso, { width: `${pct}%` }]} />
              </View>
              <Text style={e.linhaMeta}>
                {pontos >= meta
                  ? `Meta batida — ${num2(pontos - meta)} pts acima.`
                  : `Faltam ${num2(meta - pontos)} pts para a meta.`}
                {p.meta_dia != null ? `  Meta do dia: ${num2(n(p.meta_dia))} pts.` : ''}
              </Text>
            </>) : (
              // D-117: sem meta não é "meta zero". A tela diz o que falta.
              <View style={e.semMeta}>
                <Text style={e.semMetaTexto}>
                  Ainda não há meta cadastrada para a sua skill
                  {p.skill ? ` (${p.skill})` : ''}. Os pontos contam — a
                  meta é o controlador que define.
                </Text>
              </View>
            )}

            {p.fator != null
              ? <Text style={e.faixa}>Faixa com fator {num2(n(p.fator))} · a receber {reais(n(p.valor))}</Text>
              : p.proxima_faixa != null
                ? <Text style={e.faixa}>Faltam {num2(n(p.proxima_faixa) - pontos)} pts para entrar na primeira faixa.</Text>
                : null}
            <Text style={e.notinha}>
              Só entra contrato concluído. É prévia: muda até o fim do mês.
            </Text>
          </Cartao>

          {/* ---------- hoje ---------- */}
          {periodo === 'atual' && (<>
            <TituloSecao titulo="Hoje" />
            <View style={e.faixaHoje}>
              <Celula valor={num2(n(p.hoje.pontos))} rotulo="pontos" />
              <View style={e.divisor} />
              <Celula valor={String(n(p.hoje.concluidas))} rotulo="concluídos" />
              <View style={e.divisor} />
              <Celula valor={String(n(p.hoje.a_fazer))} rotulo="a fazer" />
              <View style={e.divisor} />
              <Celula valor={String(n(p.hoje.quebradas))} rotulo="quebrados"
                      alerta={n(p.hoje.quebradas) > 0} />
            </View>
          </>)}

          {/* ---------- o mês em quatro números ---------- */}
          <TituloSecao titulo="O mês" extra={`${n(p.dias)} dia(s) com produção`} />
          <View style={e.grade}>
            <Bloco rotulo="Concluídos" valor={String(n(p.concluidas))}
                   nota={`de ${n(p.visitas)} contratos`} />
            <Bloco rotulo="Quebrados" valor={String(n(p.quebradas))}
                   nota="com baixa improdutiva" alerta={n(p.quebradas) > 0} />
            <Bloco rotulo="Pontos perdidos" valor={num2(n(p.pontos_perdidos))}
                   nota={n(p.perdidos_sem_regra) > 0
                     ? `+ ${n(p.perdidos_sem_regra)} quebrado(s) sem regra de pontos`
                     : 'o que os quebrados valeriam'}
                   alerta={n(p.pontos_perdidos) > 0} />
            <Bloco rotulo="TEC1 perdido" valor={String(n(p.tec1_perdidos))}
                   nota="fora da janela do cliente" alerta={n(p.tec1_perdidos) > 0} />
          </View>

          {/* ---------- dia a dia ---------- */}
          <TituloSecao titulo="Pontos por dia" />
          <Cartao style={{ padding: 14, gap: 8 }}>
            {p.por_dia.length === 0 && (
              <Text style={e.nada}>Nenhum contrato concluído neste mês ainda.</Text>
            )}
            {p.por_dia.map(d => {
              const [, mes, dia] = d.dia.split('-')
              const largura = (n(d.pontos) / maxDia) * 100
              return (
                <View key={d.dia} style={e.linhaDia}
                      accessibilityLabel={`${dia}/${mes}: ${num2(n(d.pontos))} pontos`}>
                  <Text style={e.diaRotulo}>{dia}/{mes}</Text>
                  <View style={e.diaTrilho}>
                    <View style={[e.diaBarra, { width: `${Math.max(2, largura)}%` },
                      meta != null && p.meta_dia != null && n(d.pontos) >= n(p.meta_dia)
                        && { backgroundColor: cor.verde }]} />
                  </View>
                  <Text style={e.diaValor}>{num2(n(d.pontos))}</Text>
                </View>
              )
            })}
            {p.meta_dia != null && p.por_dia.length > 0 && (
              <Text style={e.notinha}>Verde: dia que bateu a meta do dia ({num2(n(p.meta_dia))} pts).</Text>
            )}
          </Cartao>

          {/* ---------- ranking ---------- */}
          <TituloSecao titulo="Ranking" extra={p.total ? `${p.total} técnicos` : undefined} />
          <Cartao style={{ overflow: 'hidden' }}>
            {eu ? (
              <View style={e.minhaPosicao}>
                <Text style={e.posicaoGrande}>{eu.posicao}º</Text>
                <View style={{ flex: 1 }}>
                  <Text style={e.posicaoTexto}>
                    {eu.posicao === 1 ? 'Você é o primeiro.' : `Você está em ${eu.posicao}º de ${ranking.length}.`}
                  </Text>
                  {p.pontos_do_de_cima != null && (
                    <Text style={e.posicaoNota}>
                      Faltam {num2(n(p.pontos_do_de_cima) - pontos)} pts para subir uma posição.
                    </Text>
                  )}
                </View>
              </View>
            ) : (
              <Text style={[e.nada, { padding: 14 }]}>
                Você entra no ranking quando tiver contrato no mês.
              </Text>
            )}

            {ranking.length === 0 && <Vazio titulo="Ninguém no ranking ainda" />}
            {visiveis.map((r, i) => {
              const pulou = !rankingAberto && i > 0 && visiveis[i - 1] && r.posicao - visiveis[i - 1].posicao > 1
              return (
                <View key={r.tecnico_id}>
                  {pulou && <Text style={e.reticencias}>⋯</Text>}
                  <View style={[e.linhaRanking, r.eu && e.linhaEu]}>
                    <Text style={[e.rkPos, r.posicao <= 3 && e.rkPodio]}>{r.posicao}º</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[e.rkNome, r.eu && { color: cor.af700 }]} numberOfLines={1}>
                        {r.eu ? `${r.nome} (você)` : r.nome}
                      </Text>
                      <Text style={e.rkEquipe}>
                        {r.equipe ? `equipe ${r.equipe} · ` : ''}{n(r.concluidas)} concluído(s)
                      </Text>
                    </View>
                    <Text style={e.rkPontos}>{num2(n(r.pontos))}</Text>
                  </View>
                </View>
              )
            })}
            {ranking.length > visiveis.length || rankingAberto ? (
              <Pressable onPress={() => setRankingAberto(a => !a)} style={e.verTodos}
                         accessibilityRole="button">
                <Text style={e.verTodosTexto}>
                  {rankingAberto ? 'Mostrar só o topo' : `Ver os ${ranking.length} técnicos`}
                </Text>
              </Pressable>
            ) : null}
          </Cartao>
        </>)}
      </ScrollView>
      <BarraInferior ativa="Painel" />
    </SafeAreaView>
  )
}

function Celula({ valor, rotulo, alerta }: { valor: string; rotulo: string; alerta?: boolean }) {
  return (
    <View style={e.celula}>
      <Text style={[e.celulaValor, alerta && { color: cor.af700 }]}>{valor}</Text>
      <Text style={e.celulaRotulo}>{rotulo}</Text>
    </View>
  )
}

function Bloco({ rotulo, valor, nota, alerta }: {
  rotulo: string; valor: string; nota: string; alerta?: boolean
}) {
  return (
    <View style={[e.bloco, alerta && { borderLeftColor: cor.af500 }]}>
      <Text style={e.blocoRotulo}>{rotulo}</Text>
      <Text style={[e.blocoValor, alerta && { color: cor.af700 }]}>{valor}</Text>
      <Text style={e.blocoNota}>{nota}</Text>
    </View>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.graf50 },
  periodos: {
    flexDirection: 'row', gap: 6, padding: 8,
    backgroundColor: cor.branco, borderBottomWidth: 1, borderBottomColor: cor.graf100,
  },
  periodo: {
    flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: raio.s, backgroundColor: cor.graf50,
  },
  periodoAtivo: { backgroundColor: cor.tinta },
  periodoTexto: { fontSize: 14, fontWeight: '700', color: cor.graf500 },
  periodoTextoAtivo: { color: cor.branco },
  conteudo: { padding: 12, gap: 10, paddingBottom: 32 },

  heroi: { padding: 16, gap: 4 },
  rotuloHeroi: { fontSize: 13, fontWeight: '700', color: cor.graf600, textTransform: 'capitalize' },
  linhaNumero: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  numero: {
    fontSize: 44, fontWeight: '900', color: cor.tinta, lineHeight: 48,
    fontVariant: ['tabular-nums'], letterSpacing: -1,
  },
  deMeta: { fontSize: 16, fontWeight: '700', color: cor.graf500, paddingBottom: 7 },
  trilho: { height: 10, borderRadius: 999, backgroundColor: cor.graf100, overflow: 'hidden', marginTop: 8 },
  progresso: { height: 10, borderRadius: 999, backgroundColor: cor.af600 },
  linhaMeta: { fontSize: 14, fontWeight: '600', color: cor.tinta, marginTop: 6 },
  semMeta: {
    marginTop: 8, backgroundColor: cor.ambar50, borderLeftWidth: 4, borderLeftColor: cor.ambar,
    borderRadius: raio.s, padding: 10,
  },
  semMetaTexto: { fontSize: 13, color: '#92400e', lineHeight: 18, fontWeight: '500' },
  faixa: { fontSize: 13, color: cor.graf600, marginTop: 6 },
  notinha: { fontSize: 12, color: cor.graf500, marginTop: 4, lineHeight: 16 },

  faixaHoje: {
    flexDirection: 'row', backgroundColor: cor.tinta, borderRadius: raio.g,
    paddingVertical: 12,
  },
  celula: { flex: 1, alignItems: 'center' },
  celulaValor: { fontSize: 22, fontWeight: '900', color: cor.branco, fontVariant: ['tabular-nums'] },
  celulaRotulo: { fontSize: 11, fontWeight: '600', color: cor.graf200, marginTop: 2 },
  divisor: { width: 1, backgroundColor: cor.graf600 },

  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bloco: {
    flexBasis: '48%', flexGrow: 1, backgroundColor: cor.branco, borderRadius: raio.m,
    borderWidth: 1, borderColor: cor.graf200, borderLeftWidth: 4, borderLeftColor: cor.graf300,
    padding: 12,
  },
  blocoRotulo: { fontSize: 12, fontWeight: '700', color: cor.graf600 },
  blocoValor: { fontSize: 26, fontWeight: '900', color: cor.tinta, fontVariant: ['tabular-nums'], marginTop: 2 },
  blocoNota: { fontSize: 12, color: cor.graf500, marginTop: 2, lineHeight: 16 },

  nada: { fontSize: 14, color: cor.graf500 },
  linhaDia: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  diaRotulo: { width: 42, fontSize: 13, fontWeight: '700', color: cor.graf600, fontVariant: ['tabular-nums'] },
  diaTrilho: { flex: 1, height: 14, backgroundColor: cor.graf50, borderRadius: 4, overflow: 'hidden' },
  diaBarra: { height: 14, backgroundColor: cor.tinta, borderRadius: 4 },
  diaValor: { width: 52, textAlign: 'right', fontSize: 13, fontWeight: '800', color: cor.tinta, fontVariant: ['tabular-nums'] },

  minhaPosicao: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14,
    backgroundColor: cor.af50, borderBottomWidth: 1, borderBottomColor: cor.af100,
  },
  posicaoGrande: { fontSize: 36, fontWeight: '900', color: cor.af700, fontVariant: ['tabular-nums'] },
  posicaoTexto: { fontSize: 15, fontWeight: '800', color: cor.tinta },
  posicaoNota: { fontSize: 13, color: cor.graf600, marginTop: 2 },
  linhaRanking: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52,
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: cor.graf100,
    borderLeftWidth: 4, borderLeftColor: 'transparent',
  },
  linhaEu: { backgroundColor: cor.af50, borderLeftColor: cor.af600 },
  rkPos: { width: 34, fontSize: 15, fontWeight: '800', color: cor.graf500, fontVariant: ['tabular-nums'] },
  rkPodio: { color: cor.tinta },
  rkNome: { fontSize: 15, fontWeight: '700', color: cor.tinta },
  rkEquipe: { fontSize: 12, color: cor.graf500 },
  rkPontos: { fontSize: 16, fontWeight: '900', color: cor.tinta, fontVariant: ['tabular-nums'] },
  reticencias: { textAlign: 'center', color: cor.graf500, paddingVertical: 2 },
  verTodos: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  verTodosTexto: { fontSize: 14, fontWeight: '700', color: cor.af700 },
})
