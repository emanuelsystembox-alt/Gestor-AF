import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'
import { BarrasHorizontais, Painel, TabelaSimples } from '../components/graficos'
import { dataBR, isoLocal } from '../lib/formato'

/**
 * Humor das equipes (146, D-226).
 *
 * > "esse questionário é armazenado […] para que depois ele mostre um
 * > gráfico de como estão as equipes em campo […] como o técnico está se
 * > sentindo, somente os coordenadores" — Emanuel, 26/10
 *
 * ┌─ "sem resposta" não é um humor ───────────────────────────────────┐
 * │ A pesquisa é obrigatória no app, então quem trabalhou respondeu —  │
 * │ ou respondeu sem sinal e ainda não subiu, ou trabalhou sem abrir   │
 * │ o app. "Sem resposta" conta só quem estava ESCALADO (a equipe dele │
 * │ tinha visita no dia): técnico de folga não é falta. E fica numa    │
 * │ barra à parte, cinza, fora da conta das fatias (D-117).            │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * Quem vê: só quem tem `campo.humor` — o banco recusa o resto
 * (`humor_das_equipes`). A tela só não oferece o que vai falhar.
 */

type Humor = 'FELIZ' | 'INDIFERENTE' | 'DESANIMADO' | 'TRISTE' | 'ESTRESSADO'
interface Linha {
  dia: string; tecnico_id: string; tecnico: string; equipe: string | null; base: string | null
  humor: Humor | null; respondido_em: string | null
}

// Do melhor ao pior, na ordem em que o técnico vê no app. Cor escrita
// (não var CSS): o gráfico pinta em `style`, e a escala tem de ler igual
// nos dois temas.
const HUMORES: { chave: Humor; rotulo: string; rosto: string; cor: string }[] = [
  { chave: 'FELIZ',       rotulo: 'Feliz',       rosto: '😀', cor: '#16a34a' },
  { chave: 'INDIFERENTE', rotulo: 'Indiferente', rosto: '😐', cor: '#7c869a' },
  { chave: 'DESANIMADO',  rotulo: 'Desanimado',  rosto: '😔', cor: '#d97706' },
  { chave: 'TRISTE',      rotulo: 'Triste',      rosto: '😢', cor: '#2563eb' },
  { chave: 'ESTRESSADO',  rotulo: 'Estressado',  rosto: '😤', cor: '#d11a24' },
]
const DE: Record<Humor, (typeof HUMORES)[number]> =
  Object.fromEntries(HUMORES.map(h => [h.chave, h])) as Record<Humor, (typeof HUMORES)[number]>
/** Pede atenção: quem não está bem aparece primeiro na lista do dia. */
const ATENCAO = new Set<Humor>(['ESTRESSADO', 'TRISTE', 'DESANIMADO'])

const PERIODOS = [
  { dias: 1, rotulo: 'Hoje' },
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
] as const

/** Dia local + n dias, sem passar por UTC (D-084). */
function somarDias(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  return isoLocal(new Date(a, m - 1, d + n))
}

const hora = (ts: string) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export default function Humor() {
  // Booleano, não a função: `pode` nasce nova a cada render e, como
  // dependência do efeito, recarregaria a tela sem parar.
  const podeVer = useAuth().pode('campo.humor')
  const hoje = isoLocal()
  const [periodo, setPeriodo] = useState<number>(1)
  const [dia, setDia] = useState(hoje)
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const de = somarDias(hoje, -(periodo - 1))

  useEffect(() => {
    if (!podeVer) return
    setLinhas(null); setErro(null)
    supabase.rpc('humor_das_equipes', { p_de: de, p_ate: hoje }).then(({ data, error }) => {
      if (error) setErro(error.message)
      setLinhas((data ?? []) as Linha[])
    })
  }, [de, hoje, podeVer])

  // O dia escolhido tem de estar dentro do período.
  useEffect(() => { if (dia < de) setDia(hoje) }, [de, dia, hoje])

  const respondidas = useMemo(() => (linhas ?? []).filter(l => l.humor), [linhas])
  const semResposta = useMemo(() => (linhas ?? []).filter(l => !l.humor).length, [linhas])

  const distribuicao = HUMORES.map(h => ({
    rotulo: `${h.rosto} ${h.rotulo}`, cor: h.cor,
    valor: respondidas.filter(l => l.humor === h.chave).length,
  }))

  // Por equipe: quantos de cada humor, e a fatia que pede atenção.
  const porEquipe = useMemo(() => {
    const m = new Map<string, Record<Humor, number>>()
    for (const l of respondidas) {
      const k = l.equipe ?? 'sem equipe'
      const c = m.get(k) ?? { FELIZ: 0, INDIFERENTE: 0, DESANIMADO: 0, TRISTE: 0, ESTRESSADO: 0 }
      c[l.humor as Humor]++
      m.set(k, c)
    }
    return [...m.entries()].map(([equipe, c]) => {
      const total = HUMORES.reduce((s, h) => s + c[h.chave], 0)
      const atencao = c.DESANIMADO + c.TRISTE + c.ESTRESSADO
      return { equipe, c, total, atencao }
    }).sort((a, b) => b.atencao / b.total - a.atencao / a.total || a.equipe.localeCompare(b.equipe))
  }, [respondidas])

  // Dia a dia (no período de mais de um dia): barra empilhada por dia.
  const porDia = useMemo(() => {
    const dias: string[] = []
    for (let d = hoje; d >= de; d = somarDias(d, -1)) dias.push(d)
    return dias.map(d => {
      const doDia = (linhas ?? []).filter(l => l.dia === d)
      const c = Object.fromEntries(HUMORES.map(h => [h.chave, doDia.filter(l => l.humor === h.chave).length])) as Record<Humor, number>
      return { dia: d, c, total: doDia.filter(l => l.humor).length, sem: doDia.filter(l => !l.humor).length }
    })
  }, [linhas, de, hoje])

  const doDia = useMemo(() => (linhas ?? []).filter(l => l.dia === dia).sort((a, b) => {
    const pa = a.humor ? (ATENCAO.has(a.humor) ? 0 : 1) : 2
    const pb = b.humor ? (ATENCAO.has(b.humor) ? 0 : 1) : 2
    return pa - pb || a.tecnico.localeCompare(b.tecnico)
  }), [linhas, dia])

  if (!podeVer) {
    return (
      <Shell>
        <Vazio titulo="Sem acesso" descricao='O seu perfil de acesso não inclui "Ver o humor das equipes".' />
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Humor das equipes</h1>
            <p className="mt-0.5 text-sm text-graf-400">
              A pergunta do dia no aplicativo — obrigatória a partir das 6h. Só a coordenação vê.
            </p>
          </div>
          <div className="flex rounded-md bg-graf-900 p-0.5 text-xs" role="group" aria-label="Período">
            {PERIODOS.map(p => (
              <button key={p.dias} onClick={() => setPeriodo(p.dias)} aria-pressed={periodo === p.dias}
                className={`rounded px-3 py-1.5 ${periodo === p.dias ? 'bg-af-600 text-white' : 'text-graf-300'}`}>
                {p.rotulo}
              </button>
            ))}
          </div>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {linhas == null ? (
          <p className="py-10 text-center text-sm text-graf-400">Carregando…</p>
        ) : (<>
          <div className="grid gap-4 lg:grid-cols-2">
            <Painel titulo="Como as equipes estão"
              dica={`${respondidas.length} resposta(s) ${periodo === 1 ? 'hoje' : `em ${periodo} dias`}`}
              tabela={<TabelaSimples colunas={['Humor', 'Respostas']}
                linhas={[...distribuicao.map(d => [d.rotulo, d.valor]), ['Sem resposta (escalados)', semResposta]]} />}
              nota={<>“Sem resposta” = técnico com login cuja equipe tinha visita no dia e que não
                respondeu (ou respondeu sem sinal e ainda não subiu). Fica fora das porcentagens.</>}>
              <BarrasHorizontais dados={distribuicao} parte rotuloLargo />
              <div className="mt-3 flex items-center gap-2 text-xs text-graf-400">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-graf-700" aria-hidden />
                Sem resposta (escalados): <span className="tabular font-semibold text-graf-200">{semResposta}</span>
              </div>
            </Painel>

            <Painel titulo="Por equipe" dica="As equipes com mais gente desanimada, triste ou estressada primeiro"
              tabela={<TabelaSimples colunas={['Equipe', ...HUMORES.map(h => h.rotulo), 'Atenção']}
                linhas={porEquipe.map(e => [e.equipe, ...HUMORES.map(h => e.c[h.chave]),
                  `${Math.round((e.atencao / e.total) * 100)}%`])} />}>
              {porEquipe.length === 0
                ? <p className="py-6 text-center text-sm text-graf-400">Sem respostas no período.</p>
                : <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                    {porEquipe.map(e => (
                      <div key={e.equipe} className="flex items-center gap-2.5 text-xs">
                        <span className="w-24 shrink-0 truncate text-right text-graf-300" title={e.equipe}>{e.equipe}</span>
                        <Pilha c={e.c} total={e.total} />
                        <span className="tabular w-10 shrink-0 text-right text-graf-400">{e.total}</span>
                      </div>
                    ))}
                  </div>}
            </Painel>
          </div>

          {periodo > 1 && (
            <Painel titulo="Dia a dia" dica="A composição das respostas de cada dia — clique para ver os técnicos"
              tabela={<TabelaSimples colunas={['Dia', ...HUMORES.map(h => h.rotulo), 'Sem resposta']}
                linhas={porDia.map(d => [dataBR(d.dia), ...HUMORES.map(h => d.c[h.chave]), d.sem])} />}>
              <div className="space-y-1.5">
                {porDia.map(d => (
                  <button key={d.dia} onClick={() => setDia(d.dia)} aria-pressed={dia === d.dia}
                    className={`flex w-full items-center gap-2.5 rounded px-1 text-left text-xs hover:bg-graf-900 ${
                      dia === d.dia ? 'bg-graf-900 ring-1 ring-graf-700' : ''}`}>
                    <span className="w-20 shrink-0 text-right text-graf-300">{dataBR(d.dia)}</span>
                    <Pilha c={d.c} total={d.total} />
                    <span className="tabular w-20 shrink-0 text-right text-graf-400">
                      {d.total}{d.sem ? ` · ${d.sem} s/r` : ''}
                    </span>
                  </button>
                ))}
              </div>
            </Painel>
          )}

          <section className="card-controle overflow-hidden">
            <div className="border-b border-graf-800 px-4 py-3">
              <h2 className="text-sm font-semibold">Técnicos em {dataBR(dia)}</h2>
              <p className="mt-0.5 text-xs text-graf-400">
                Quem não está bem aparece primeiro. Uma conversa vale mais que o gráfico.
              </p>
            </div>
            {doDia.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-graf-400">Ninguém escalado nem resposta neste dia.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-graf-700 text-left text-[11px] uppercase tracking-wide text-graf-400">
                      <th className="px-4 py-2 font-medium">Técnico</th>
                      <th className="px-2 py-2 font-medium">Equipe</th>
                      <th className="px-2 py-2 font-medium">Cidade</th>
                      <th className="px-2 py-2 font-medium">Como está</th>
                      <th className="px-4 py-2 text-right font-medium">Respondeu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doDia.map(l => (
                      <tr key={l.tecnico_id} className="border-b border-graf-800/60">
                        <td className="px-4 py-2">{l.tecnico}</td>
                        <td className="px-2 py-2 text-graf-300">{l.equipe ?? '—'}</td>
                        <td className="px-2 py-2 text-graf-300">{l.base ?? '—'}</td>
                        <td className="px-2 py-2">
                          {l.humor ? (
                            <span className="inline-flex items-center gap-1.5 font-medium">
                              <span aria-hidden>{DE[l.humor].rosto}</span>
                              <span className="inline-block h-2 w-2 rounded-full" style={{ background: DE[l.humor].cor }} aria-hidden />
                              {DE[l.humor].rotulo}
                            </span>
                          ) : <span className="text-graf-400">sem resposta</span>}
                        </td>
                        <td className="tabular px-4 py-2 text-right text-graf-300">
                          {l.respondido_em ? hora(l.respondido_em) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>)}
      </div>
    </Shell>
  )
}

/** Uma barra empilhada com as cinco cores, na ordem da escala. */
function Pilha({ c, total }: { c: Record<Humor, number>; total: number }) {
  return (
    <div className="flex h-5 flex-1 overflow-hidden rounded-sm bg-graf-900"
      title={HUMORES.map(h => `${h.rotulo}: ${c[h.chave]}`).join(' · ')}>
      {total > 0 && HUMORES.map(h => c[h.chave] > 0 && (
        <div key={h.chave} style={{ width: `${(c[h.chave] / total) * 100}%`, background: h.cor }} />
      ))}
    </div>
  )
}
