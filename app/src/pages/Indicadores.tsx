import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta, Avatar } from '../components/ui'
import { isoLocal } from '../lib/formato'

/**
 * Indicadores (140).
 *
 * ┌─ o primeiro é PRIMEIRA WO ────────────────────────────────────────┐
 * │ > "o primeiro contrato que o técnico chegou na casa do cliente.   │
 * │ >  Ignore os contratos informativos, tem que ser o contrato real  │
 * │ >  mesmo (...) a meta para esse indicador é 8 e vinte (...) uma   │
 * │ >  tabela de todos os técnicos, quem é que mais chega atrasado,   │
 * │ >  fazer gráficos dos 10 piores, para que o coordenador possa     │
 * │ >  atuar" — Emanuel, 25/10                                        │
 * │                                                                    │
 * │ A tela nasce com UM indicador e lugar para os próximos: a aba     │
 * │ existe desde já para o segundo não virar outra tela no menu.      │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * CHEGOU = o `início` da atividade no TOA. É a única fonte que existe
 * PARA TRÁS — o aplicativo começou agora e não tem histórico. Lido em
 * horário de Manaus, nunca em UTC (traps.md).
 *
 * DIA SEM ATENDIMENTO NÃO ENTRA: folga e dia sem rota não são atraso.
 * O gráfico diz quantos dias cada um tem, para ninguém confundir "o
 * pior" com "o que trabalhou mais dias".
 */

interface PorDia {
  tecnico_id: string; nome: string; equipe: string | null
  dia: string; hora: string; visita_id: string; contrato: string | null
  grupo: string | null; endereco: string | null
  minutos_depois: number; dentro: boolean
}
interface PorTecnico {
  tecnico_id: string; nome: string; equipe: string | null
  dias: number; media_hora: string; pior_hora: string; melhor_hora: string
  dias_dentro: number; dias_fora: number; pct_dentro: number
  media_atraso_min: number | null
}

const hhmm = (t: string | null) => (t ?? '').slice(0, 5) || '—'
const diaBr = (d: string) => new Date(d + 'T12:00').toLocaleDateString('pt-BR',
  { day: '2-digit', month: '2-digit', weekday: 'short' })

/** Média de horas em texto: a conta é em minutos desde a meia-noite. */
function mediaHoras(horas: string[]): string {
  if (horas.length === 0) return '—'
  const m = horas.map(h => {
    const [a, b] = h.split(':')
    return Number(a) * 60 + Number(b)
  })
  const med = Math.round(m.reduce((s, x) => s + x, 0) / m.length)
  return `${String(Math.floor(med / 60)).padStart(2, '0')}:${String(med % 60).padStart(2, '0')}`
}

export default function Indicadores() {
  const hoje = isoLocal(new Date())
  const [de, setDe] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 14); return isoLocal(d)
  })
  const [ate, setAte] = useState(hoje)
  const [meta, setMeta] = useState('08:20')
  const [dias, setDias] = useState<PorDia[]>([])
  const [tecs, setTecs] = useState<PorTecnico[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    Promise.all([
      supabase.rpc('primeira_wo_dia', { p_de: de, p_ate: ate }),
      supabase.rpc('primeira_wo_tecnico', { p_de: de, p_ate: ate }),
      supabase.rpc('ler_parametro', { p_chave: 'primeira_wo_meta' }),
    ]).then(([d, t, m]) => {
      if (!vivo) return
      if (d.error || t.error) { setErro((d.error ?? t.error)!.message); setCarregando(false); return }
      setDias((d.data ?? []) as PorDia[])
      setTecs((t.data ?? []) as PorTecnico[])
      if (typeof m.data === 'string') setMeta(m.data)
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [de, ate])

  const resumo = useMemo(() => {
    const dentro = dias.filter(d => d.dentro).length
    return {
      medicoes: dias.length,
      tecnicos: tecs.length,
      media: mediaHoras(dias.map(d => d.hora)),
      dentro,
      pct: dias.length ? Math.round((100 * dentro) / dias.length) : null,
      atrasoMedio: (() => {
        const fora = dias.filter(d => !d.dentro).map(d => d.minutos_depois)
        return fora.length ? Math.round(fora.reduce((s, x) => s + x, 0) / fora.length) : null
      })(),
    }
  }, [dias, tecs])

  /** Os 10 piores: mais dias fora primeiro, depois o atraso médio maior. */
  const piores = useMemo(() => tecs.filter(t => t.dias_fora > 0).slice(0, 10), [tecs])
  const maiorAtraso = Math.max(1, ...piores.map(p => Number(p.media_atraso_min ?? 0)))

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return q ? tecs.filter(t => t.nome.toLowerCase().includes(q)
      || (t.equipe ?? '').toLowerCase().includes(q)) : tecs
  }, [tecs, busca])

  const porTecnico = useMemo(() => {
    const m = new Map<string, PorDia[]>()
    for (const d of dias) {
      const l = m.get(d.tecnico_id) ?? []
      l.push(d); m.set(d.tecnico_id, l)
    }
    return m
  }, [dias])

  return (
    <Shell>
      <div className="pagina-entra space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">Indicadores</h1>
            <p className="mt-0.5 text-sm text-graf-400">
              <strong className="text-graf-200">Primeira WO</strong> — que horas o técnico
              chega no primeiro cliente do dia. Meta: até{' '}
              <strong className="text-graf-200">{hhmm(meta)}</strong>.
            </p>
          </div>
          <label className="text-[11px] text-graf-400">
            De
            <input type="date" value={de} max={ate} onChange={e => setDe(e.target.value)}
              className="ml-1 rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-sm" />
          </label>
          <label className="text-[11px] text-graf-400">
            até
            <input type="date" value={ate} min={de} max={hoje} onChange={e => setAte(e.target.value)}
              className="ml-1 rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-sm" />
          </label>
        </div>

        {/* A aba existe com um indicador só: o segundo não vira tela nova. */}
        <div className="flex gap-1 border-b border-graf-800">
          <span className="-mb-px border-b-2 border-af-500 px-3 py-2 text-sm font-medium text-graf-100">
            Primeira WO
          </span>
          <span className="px-3 py-2 text-sm text-graf-600">mais indicadores em breve</span>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}

        {carregando ? (
          <p className="py-12 text-center text-graf-400">Carregando…</p>
        ) : dias.length === 0 ? (
          <Alerta tipo="info">
            Nenhuma primeira WO no período. Só entram contratos <strong>reais</strong>
            {' '}(com número de contrato) e com hora de início vinda do TOA — jornada,
            refeição e apoio ficam de fora de propósito.
          </Alerta>
        ) : (<>
          {/* ---------- os números do período ---------- */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { r: 'Chegada média', v: resumo.media, t: 'Média do horário da primeira WO no período' },
              { r: 'Dentro da meta', v: resumo.pct == null ? '—' : `${resumo.pct}%`,
                t: `${resumo.dentro} de ${resumo.medicoes} dias-técnico dentro de ${hhmm(meta)}`,
                cor: (resumo.pct ?? 0) >= 80 ? 'text-emerald-300' : (resumo.pct ?? 0) >= 50 ? 'text-amber-300' : 'text-af-300' },
              { r: 'Atraso médio', v: resumo.atrasoMedio == null ? 'nenhum' : `${resumo.atrasoMedio} min`,
                t: 'Média dos minutos acima da meta, contando só os dias em que passou dela' },
              { r: 'Técnicos medidos', v: String(resumo.tecnicos), t: 'Quem teve pelo menos um contrato real no período' },
              { r: 'Dias-técnico', v: String(resumo.medicoes), t: 'Cada dia com atendimento de cada técnico. Folga não conta.' },
            ].map(c => (
              <div key={c.r} className="card-controle p-3" title={c.t}>
                <p className="text-[10px] uppercase tracking-wide text-graf-500">{c.r}</p>
                <p className={`tabular mt-1 text-2xl font-semibold ${c.cor ?? 'text-graf-100'}`}>{c.v}</p>
              </div>
            ))}
          </section>

          {/* ---------- os 10 piores ---------- */}
          <section className="card-controle p-4">
            <h2 className="text-sm font-semibold">Os 10 que mais chegam atrasados</h2>
            <p className="mt-0.5 text-xs text-graf-400">
              Ordenado por <strong>dias fora da meta</strong>; a barra é o atraso médio em
              minutos. Quem tem poucos dias no período aparece com a contagem ao lado —
              dois dias ruins não são o mesmo problema que dez.
            </p>
            {piores.length === 0 ? (
              <p className="py-6 text-center text-sm text-emerald-300">
                Ninguém fora da meta no período.
              </p>
            ) : (
              <div className="mt-3 space-y-1.5">
                {piores.map(t => {
                  const atraso = Number(t.media_atraso_min ?? 0)
                  const larg = Math.max(4, (atraso / maiorAtraso) * 100)
                  return (
                    <button key={t.tecnico_id}
                      onClick={() => setAberto(a => a === t.tecnico_id ? null : t.tecnico_id)}
                      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-graf-900">
                      <Avatar nome={t.nome} tamanho={24} />
                      <span className="w-48 shrink-0 truncate text-xs">{t.nome}</span>
                      <span className="w-14 shrink-0 text-[11px] text-graf-500">{t.equipe ?? '—'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block h-4 rounded-sm bg-af-600/70"
                          style={{ width: `${larg}%` }} aria-hidden />
                      </span>
                      <span className="tabular w-16 shrink-0 text-right text-xs text-af-300">
                        +{atraso.toFixed(0)} min
                      </span>
                      <span className="tabular w-28 shrink-0 text-right text-[11px] text-graf-400">
                        {t.dias_fora}/{t.dias} dias · {hhmm(t.media_hora)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* ---------- todos os técnicos ---------- */}
          <section className="card-controle overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-graf-800 px-4 py-3">
              <h2 className="text-sm font-semibold">Todos os técnicos</h2>
              <input value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar técnico ou equipe…" aria-label="Buscar técnico"
                className="ml-auto min-w-56 rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-800 bg-graf-900 text-left text-[11px]
                                  uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Técnico</th>
                    <th className="px-3 py-2 font-medium">Equipe</th>
                    <th className="px-3 py-2 text-right font-medium">Dias</th>
                    <th className="px-3 py-2 text-right font-medium">Chegada média</th>
                    <th className="px-3 py-2 text-right font-medium">Mais cedo</th>
                    <th className="px-3 py-2 text-right font-medium">Mais tarde</th>
                    <th className="px-3 py-2 text-right font-medium">Dentro</th>
                    <th className="px-3 py-2 text-right font-medium">Atraso médio</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map(t => {
                    const abertoAqui = aberto === t.tecnico_id
                    return (
                      <>
                        <tr key={t.tecnico_id}
                          onClick={() => setAberto(a => a === t.tecnico_id ? null : t.tecnico_id)}
                          className={`cursor-pointer border-b border-graf-800/60 hover:bg-graf-900 ${
                            abertoAqui ? 'bg-graf-900' : ''}`}>
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-2">
                              <Avatar nome={t.nome} tamanho={22} />
                              <span className="truncate">{t.nome}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-graf-400">{t.equipe ?? '—'}</td>
                          <td className="tabular px-3 py-2 text-right text-xs">{t.dias}</td>
                          <td className="tabular px-3 py-2 text-right font-medium">{hhmm(t.media_hora)}</td>
                          <td className="tabular px-3 py-2 text-right text-xs text-emerald-300">{hhmm(t.melhor_hora)}</td>
                          <td className="tabular px-3 py-2 text-right text-xs text-af-300">{hhmm(t.pior_hora)}</td>
                          <td className="tabular px-3 py-2 text-right">
                            <span className={Number(t.pct_dentro) >= 80 ? 'text-emerald-300'
                              : Number(t.pct_dentro) >= 50 ? 'text-amber-300' : 'text-af-300'}>
                              {Number(t.pct_dentro).toFixed(0)}%
                            </span>
                            <span className="ml-1 text-[11px] text-graf-500">
                              {t.dias_dentro}/{t.dias}
                            </span>
                          </td>
                          <td className="tabular px-3 py-2 text-right text-xs">
                            {t.media_atraso_min == null
                              ? <span className="text-emerald-300">no horário</span>
                              : <span className="text-af-300">+{Number(t.media_atraso_min).toFixed(0)} min</span>}
                          </td>
                        </tr>
                        {abertoAqui && (
                          <tr key={`${t.tecnico_id}-dias`} className="border-b border-graf-800/60 bg-graf-950">
                            <td colSpan={8} className="px-3 py-2">
                              {/* "mostrar no sistema que horas o técnico vem chegando
                                  todos os dias" — dia a dia, com o contrato que ele
                                  abriu, para o coordenador poder conferir. */}
                              <div className="flex flex-wrap gap-1.5">
                                {(porTecnico.get(t.tecnico_id) ?? [])
                                  .slice().sort((a, b) => a.dia.localeCompare(b.dia))
                                  .map(d => (
                                    <Link key={d.dia} to={`/controle/visita/${d.visita_id}`}
                                      title={`${d.grupo ?? ''} · contrato ${d.contrato ?? '—'} · ${d.endereco ?? ''}`}
                                      className={`rounded-md border px-2 py-1 text-[11px] ${
                                        d.dentro ? 'border-emerald-700/50 bg-emerald-900/25 text-emerald-200'
                                                 : 'border-af-700/50 bg-af-900/25 text-af-200'}`}>
                                      <span className="block text-[10px] uppercase opacity-70">{diaBr(d.dia)}</span>
                                      <span className="tabular font-semibold">{hhmm(d.hora)}</span>
                                      {!d.dentro && <span className="ml-1 opacity-80">+{d.minutos_depois}</span>}
                                    </Link>
                                  ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-graf-800 px-4 py-2.5 text-xs text-graf-500">
              Clique no técnico para ver <strong>dia a dia</strong> a que horas ele chegou —
              e o contrato que ele abriu. Só entram contratos reais: jornada, refeição e
              apoio a outro técnico ficam de fora.
            </p>
          </section>
        </>)}
      </div>
    </Shell>
  )
}
